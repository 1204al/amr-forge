"""Isaac Sim 6.2.0 standalone runner. Invoke with the distribution's python.sh."""
import argparse
import base64
import io
import json
import math
import os
from pathlib import Path
import time
from urllib.request import Request, urlopen

from isaacsim import SimulationApp

parser = argparse.ArgumentParser()
parser.add_argument("--bridge", default="http://127.0.0.1:8765")
parser.add_argument("--limit", type=float, default=50, help="Stop at this many simulated seconds")
parser.add_argument("--output", type=Path, default=Path("/output"))
parser.add_argument("--smoke", action="store_true", help="Verify wheel motion and sensor output before a full run")
args = parser.parse_args()
token = os.environ["AMR_DRIVER_TOKEN"]
app = SimulationApp({"headless": True, "multi_gpu": False, "enable_motion_bvh": True})

# Kit, rendering and physics APIs are valid only after SimulationApp is initialized.
import numpy as np
import omni.usd
from PIL import Image
from pxr import Gf, PhysxSchema, Sdf, UsdGeom, UsdLux, UsdPhysics, UsdShade
from isaacsim.core.api import World
from isaacsim.robot.experimental.wheeled_robots.controllers import DifferentialController
from isaacsim.robot.experimental.wheeled_robots.robots import WheeledRobot
from isaacsim.sensors.experimental.rtx import CameraSensor, Lidar, LidarSensor, RtxCamera, parse_generic_model_output_data

DT = 1 / 30
RADIUS = 0.16
TRACK = 0.59
LIDAR_HEIGHT = 0.36
LIDAR_RANGE = 5.8
SOURCE = Path(__file__).resolve().parents[2] / "scenarios" / "warehouse.json"
SCENARIO = json.loads(SOURCE.read_text())


def request(path, body=None):
    headers = {"Authorization": f"Bearer {token}"}
    if body is not None:
        headers["Content-Type"] = "application/json"
    address = args.bridge + path
    data = json.dumps(body, allow_nan=False).encode() if body is not None else None
    with urlopen(Request(address, data=data, headers=headers), timeout=6) as response:
        return json.load(response)


def box(stage, path, point, dimensions, color, collision=True):
    cube = UsdGeom.Cube.Define(stage, path)
    cube.CreateSizeAttr(1)
    cube.AddTranslateOp().Set(Gf.Vec3d(*point))
    cube.AddScaleOp().Set(Gf.Vec3d(*dimensions))
    cube.CreateDisplayColorAttr([Gf.Vec3f(*color)])
    if collision:
        UsdPhysics.CollisionAPI.Apply(cube.GetPrim())
    return cube


def material(stage, name, friction):
    obj = UsdShade.Material.Define(stage, "/World/" + name)
    physics = UsdPhysics.MaterialAPI.Apply(obj.GetPrim())
    physics.CreateStaticFrictionAttr(friction)
    physics.CreateDynamicFrictionAttr(friction)
    physics.CreateRestitutionAttr(0)
    if friction < 0.1:
        PhysxSchema.PhysxMaterialAPI.Apply(obj.GetPrim()).CreateFrictionCombineModeAttr("min")
    return obj


def set_material(prim, obj):
    UsdShade.MaterialBindingAPI.Apply(prim).Bind(obj, materialPurpose="physics")


def collision_id(obstacle):
    return "/World/Obstacles/" + obstacle["id"].replace("-", "_")


def author_obstacle(stage, obstacle):
    kind = obstacle["kind"]
    x, y = obstacle["x"], obstacle["y"]
    width, depth = obstacle["w"], obstacle["h"]
    path = collision_id(obstacle)
    if kind == "rack":
        # The pallet load also gives the lidar an observable front face.
        box(stage, path, (x, y, 0.34), (width, depth, 0.68), (0.24, 0.28, 0.32))
        for level in (0.81, 1.68, 2.52):
            box(stage, f"{path}_rail_{int(level * 100)}", (x, y, level),
                (width, depth, 0.095), (0.56, 0.27, 0.10), False)
            for i in range(4):
                box(stage, f"{path}_load_{int(level * 100)}_{i}", (x + (i - 1.5) * 1.18, y, level + 0.29),
                    (1.04, depth * 0.87, 0.51), (0.5, 0.36 + 0.025 * i, 0.23), False)
        return
    if kind == "forklift":
        # One footprint shared by the navigation map, render scene and static collision proxy.
        root = UsdGeom.Xform.Define(stage, path)
        root.AddTranslateOp().Set(Gf.Vec3d(x, y, 0))
        box(stage, path + "/Footprint", (0, 0, 0.19), (width, depth, 0.38), (.82, .41, .05))
        box(stage, path + "/Counterweight", (-0.34, 0, 0.48), (1.05, 1.18, .37), (.64, .29, .035), False)
        box(stage, path + "/Roof", (-.22, 0, 1.58), (1.12, 1.06, .09), (.86, .46, .06), False)
        for i, side in enumerate((-1, 1)):
            box(stage, f"{path}/Mast_{i}", (.54, side * .40, .93), (.12, .12, 1.85), (.06, .07, .08), False)
            box(stage, f"{path}/Post_{i}", (-.70, side * .48, 1.02), (.08, .08, 1.17), (.07, .08, .09), False)
            box(stage, f"{path}/Fork_{i}", (.77, side * .42, .41), (.42, .11, .065), (.10, .11, .12), False)
        return
    height = 2.85 if kind == "wall" else 0.6
    color = (.13, .17, .20) if kind == "wall" else (.77, .34, .10)
    box(stage, path, (x, y, height / 2), (width, depth, height), color)


class Vehicle:
    def __init__(self, stage, seed, tire, skid):
        self.id = seed["id"]
        pose = seed["pose"]
        self.path = "/World/" + self.id.replace("-", "_")
        root = UsdGeom.Xform.Define(stage, self.path)
        root.AddTranslateOp().Set(Gf.Vec3d(pose["x"], pose["y"], 0))
        root.AddRotateZOp().Set(math.degrees(pose["heading"]))
        UsdPhysics.ArticulationRootAPI.Apply(root.GetPrim())
        base_path = self.path + "/Chassis"
        base = UsdGeom.Xform.Define(stage, base_path)
        base.AddTranslateOp().Set(Gf.Vec3d(0, 0, RADIUS + 0.005))
        UsdPhysics.RigidBodyAPI.Apply(base.GetPrim())
        UsdPhysics.MassAPI.Apply(base.GetPrim()).CreateMassAttr(28)
        color = (.14, .63, .76) if self.id.endswith("1") else (.85, .44, .12)
        box(stage, base_path + "/Body", (0, 0, .055), (.70, .49, .22), color)
        box(stage, base_path + "/Deck", (-.03, 0, .18), (.59, .46, .04), (.10, .13, .17), False)
        for i, x in enumerate((-.27, .27)):
            support = UsdGeom.Sphere.Define(stage, f"{base_path}/Glide_{i}")
            support.CreateRadiusAttr(.048)
            support.AddTranslateOp().Set(Gf.Vec3d(x, 0, -.113))
            UsdPhysics.CollisionAPI.Apply(support.GetPrim())
            set_material(support.GetPrim(), skid)

        wheel_names = []
        for side, sign in (("Left", 1), ("Right", -1)):
            wheel_path = self.path + "/" + side
            wheel = UsdGeom.Cylinder.Define(stage, wheel_path)
            wheel.CreateAxisAttr("Y")
            wheel.CreateRadiusAttr(RADIUS)
            wheel.CreateHeightAttr(.095)
            wheel.CreateDisplayColorAttr([Gf.Vec3f(.045, .055, .06)])
            wheel.AddTranslateOp().Set(Gf.Vec3d(0, sign * TRACK / 2, RADIUS + 0.005))
            UsdPhysics.RigidBodyAPI.Apply(wheel.GetPrim())
            UsdPhysics.MassAPI.Apply(wheel.GetPrim()).CreateMassAttr(3)
            UsdPhysics.CollisionAPI.Apply(wheel.GetPrim())
            set_material(wheel.GetPrim(), tire)
            name = side + "Wheel"
            wheel_names.append(name)
            joint = UsdPhysics.RevoluteJoint.Define(stage, self.path + "/" + name)
            joint.CreateBody0Rel().SetTargets([Sdf.Path(base_path)])
            joint.CreateBody1Rel().SetTargets([Sdf.Path(wheel_path)])
            joint.CreateAxisAttr("Y")
            joint.CreateLocalPos0Attr(Gf.Vec3f(0, sign * TRACK / 2, 0))
            joint.CreateLocalPos1Attr(Gf.Vec3f(0))
            joint.CreateCollisionEnabledAttr(False)
            drive_api = UsdPhysics.DriveAPI.Apply(joint.GetPrim(), "angular")
            drive_api.CreateTypeAttr("force")
            drive_api.CreateStiffnessAttr(0)
            drive_api.CreateDampingAttr(7)
            drive_api.CreateMaxForceAttr(90)

        self.robot = WheeledRobot(self.path, wheel_dof_names=wheel_names)
        self.controller = DifferentialController(wheel_radius=RADIUS, wheel_base=TRACK,
                                                 max_linear_speed=1.35, max_angular_speed=2.35)
        self.lidar_path = base_path + "/Lidar"
        lidar = Lidar.create(self.lidar_path, config="Example_Rotary", tick_rate=10,
                             translations=np.array([0, 0, LIDAR_HEIGHT]),
                             attributes={"omni:sensor:Core:elementsCoordsType": "CARTESIAN",
                                         "omni:sensor:Core:outputFrameOfReference": "WORLD"})
        self.lidar = LidarSensor(lidar, annotators=["generic-model-output"])
        camera_path = base_path + "/Camera"
        camera = UsdGeom.Camera.Define(stage, camera_path)
        camera.AddTranslateOp().Set(Gf.Vec3d(.37, 0, .34))
        camera.AddRotateXYZOp().Set(Gf.Vec3f(90, 0, -90))
        camera.CreateFocalLengthAttr(19)
        camera.CreateClippingRangeAttr(Gf.Vec2f(.06, 40))
        self.camera = CameraSensor(RtxCamera(camera_path, reset_xform_op_properties=False),
                                   resolution=(216, 384), annotators=["rgb"])
        self.sensor = None

    def drive(self, speed, angular):
        speeds = self.controller.forward(np.array([speed, angular], dtype=np.float32))
        self.robot.apply_wheel_actions(speeds)

    def observe(self):
        positions, orientations = self.robot.get_world_poses()
        x, y, z = positions.numpy()[0]
        w, a, b, c = orientations.numpy()[0]
        heading = math.atan2(2 * (w * c + a * b), 1 - 2 * (b * b + c * c))
        linear, angular = self.robot.get_velocities()
        vx, vy, _ = linear.numpy()[0]
        return {"id": self.id, "pose": {"x": float(x), "y": float(y), "heading": heading},
                "speed": float(vx * math.cos(heading) + vy * math.sin(heading)),
                "angular": float(angular.numpy()[0, 2]), "height": float(z)}

    def capture(self, observation, now, obstacles):
        rgba, _ = self.camera.get_data("rgb")
        rgb = None
        if rgba is not None:
            array = rgba.numpy()
            if array.size and array.ndim == 3 and array.shape[2] >= 3 and np.ptp(array[:, :, :3]) > 0:
                image = Image.fromarray(array[:, :, :3].astype(np.uint8)).convert("RGB")
                buf = io.BytesIO()
                image.save(buf, format="JPEG", quality=75)
                rgb = "data:image/jpeg;base64," + base64.b64encode(buf.getvalue()).decode("ascii")
        lidar, _ = self.lidar.get_data("generic-model-output")
        if lidar is None or not lidar.size:
            return
        result = parse_generic_model_output_data(lidar)
        if not result.numElements:
            return
        pose = observation["pose"]
        z = observation["height"] + LIDAR_HEIGHT
        xyz = np.column_stack((result.x, result.y, result.z))
        delta = xyz - np.array([pose["x"], pose["y"], z])
        ranges = np.linalg.norm(delta, axis=1)
        accepted = (ranges >= .17) & (ranges <= LIDAR_RANGE) & np.isfinite(xyz).all(axis=1)
        xyz = xyz[accepted]
        if not len(xyz):
            return
        # Associate measured world-space returns to tracked incident geometry.
        # The known outline is only admitted to the shared map after real returns.
        rays = []
        for o in obstacles:
            if o["kind"] not in ("forklift", "barrier"):
                continue
            matching = xyz[(np.abs(xyz[:, 0] - o["x"]) <= o["w"] / 2 + .09)
                           & (np.abs(xyz[:, 1] - o["y"]) <= o["h"] / 2 + .09)
                           & (xyz[:, 2] > .08) & (xyz[:, 2] < 1.9)]
            if len(matching) < 3:
                continue
            point = matching[np.argmin(np.linalg.norm(matching[:, :2] - [pose["x"], pose["y"]], axis=1))]
            dx, dy = point[:2] - [pose["x"], pose["y"]]
            angle = math.atan2(dy, dx) - pose["heading"]
            rays.append({"angle": math.atan2(math.sin(angle), math.cos(angle)),
                         "distance": math.hypot(dx, dy), "obstacleId": o["id"]})
        self.sensor = {"kind": "rtx", "frame": self.lidar_path, "time": now, "height": z, "pose": pose,
                       "range": LIDAR_RANGE, "rays": rays,
                       "worldPoints": xyz[::max(1, math.ceil(len(xyz) / 640))].round(4).tolist()}
        if rgb:
            self.sensor.update(rgb=rgb, rgbTime=now)


def make_scene(obstacles):
    context = omni.usd.get_context()
    World.clear_instance()
    context.new_stage()
    stage = context.get_stage()
    UsdGeom.SetStageUpAxis(stage, UsdGeom.Tokens.z)
    UsdGeom.SetStageMetersPerUnit(stage, 1)
    root = UsdGeom.Xform.Define(stage, "/World")
    stage.SetDefaultPrim(root.GetPrim())
    world = World(physics_dt=DT, rendering_dt=DT, stage_units_in_meters=1)
    floor = box(stage, "/World/Floor", (0, 0, -.15), (24.4, 16.4, .3), (.22, .25, .28))
    tire = material(stage, "Tire", 0.92)
    skid = material(stage, "Glide", 0.02)
    set_material(floor.GetPrim(), tire)
    dome = UsdLux.DomeLight.Define(stage, "/World/Dome")
    dome.CreateIntensityAttr(750)
    for i, x in enumerate((-8, 0, 8)):
        lamp = UsdLux.RectLight.Define(stage, f"/World/Strip_{i}")
        lamp.AddTranslateOp().Set(Gf.Vec3d(x, 0, 6))
        lamp.CreateIntensityAttr(3500)
        lamp.CreateWidthAttr(2.4)
        lamp.CreateHeightAttr(6)
    for obstacle in obstacles:
        author_obstacle(stage, obstacle)
    fleet = [Vehicle(stage, seed, tire, skid) for seed in SCENARIO["robots"]]
    world.reset()
    return world, stage, fleet


def smoke(world, fleet):
    initial = fleet[0].observe()["pose"]
    for i in range(100):
        fleet[0].drive(.65, 0)
        fleet[1].drive(0, 0)
        world.step(render=i % 3 == 0)
        if i % 3 == 0:
            for robot in fleet:
                robot.capture(robot.observe(), world.current_time, [])
    final = fleet[0].observe()["pose"]
    samples = [robot.sensor for robot in fleet]
    moved = math.hypot(final["x"] - initial["x"], final["y"] - initial["y"])
    if final["x"] - initial["x"] < .25 or abs(final["y"] - initial["y"]) > .25:
        raise RuntimeError(f"Wheel motion smoke failed: start {initial}, end {final}.")
    if not all(sample and sample.get("rgb") and sample["worldPoints"] for sample in samples):
        raise RuntimeError("Missing nonempty RTX LiDAR or RGB samples after 100 physics steps.")
    report = {"isaacSim": "6.2.0", "distanceM": moved, "robotIds": [r.id for r in fleet],
              "pointCounts": [len(s["worldPoints"]) for s in samples], "physicsSeconds": world.current_time}
    for robot, sample in zip(fleet, samples):
        (args.output / f"{robot.id}-smoke.jpg").write_bytes(base64.b64decode(sample["rgb"].split(",", 1)[1]))
        np.savez_compressed(args.output / f"{robot.id}-smoke-rtx.npz", points=np.array(sample["worldPoints"]))
    (args.output / "smoke.json").write_text(json.dumps(report, indent=2))
    print(json.dumps(report), flush=True)


def run():
    args.output.mkdir(parents=True, exist_ok=True)
    state = request("/driver/state")
    world, stage, fleet = make_scene(state["obstacles"])
    if args.smoke:
        smoke(world, fleet)
        return
    revision = state["revision"]
    known = {item["id"] for item in state["obstacles"]}
    tick = 0
    while app.is_running():
        if revision != state["revision"]:
            world.stop()
            world, stage, fleet = make_scene(state["obstacles"])
            revision = state["revision"]
            known = {item["id"] for item in state["obstacles"]}
            tick = 0
        for obstacle in state["obstacles"]:
            if obstacle["id"] not in known:
                author_obstacle(stage, obstacle)
                known.add(obstacle["id"])
        moving = state["running"] and state["time"] + 1e-8 < args.limit
        render = moving and tick % 3 == 0
        if moving:
            by_id = {item["id"]: item for item in state["commands"]}
            for robot in fleet:
                command = by_id.get(robot.id)
                robot.drive(command["speed"] if command else 0, command["angular"] if command else 0)
            world.step(render=render)
            tick += 1

        robots = []
        for robot in fleet:
            observation = robot.observe()
            if render:
                robot.capture(observation, state["time"] + DT, state["obstacles"])
            observation.pop("height")
            robots.append({**observation, "sensor": robot.sensor})
        state = request("/driver", {"revision": revision, "serial": state["serial"],
                                    "moved": moving, "robots": robots})
        if state["time"] + 1e-8 >= args.limit:
            stage.Export(str(args.output / "warehouse.usda"))
            print(f"Completed {state['time']:.2f} physics seconds.", flush=True)
            return
        if not moving:
            time.sleep(.08)


try:
    run()
finally:
    app.close()
