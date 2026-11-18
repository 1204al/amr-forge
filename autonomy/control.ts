import type { Obstacle, Point, Pose, Ray, Robot, Sensors } from '../telemetry/contract.ts';
import { angleWrap, distance, rayBox } from './geometry.ts';

export const DT = 1 / 30;
export const SPEED = 1.35;
export const ACCEL = 1.25;
export const BRAKE = 2.4;
const TURN = 2.35;
const TURN_ACCEL = 8;
const approach = (from: number, to: number, delta: number) =>
  from + Math.max(-delta, Math.min(delta, to - from));

export function drive(robot: Robot, target: Point | undefined) {
  const { pose, speed, angular } = robot;
  const error = target ? angleWrap(Math.atan2(target.y - pose.y, target.x - pose.x) - pose.heading) : 0;
  const idealTurn = Math.max(-TURN, Math.min(TURN, error * 4));
  const idealSpeed = target
    ? Math.min(SPEED, Math.sqrt(1.8 * distance(pose, target))) * Math.max(0, Math.cos(error) - 0.08) ** 4
    : 0;
  return {
    speed: approach(speed, idealSpeed, (idealSpeed < speed ? BRAKE : ACCEL) * DT),
    angular: approach(angular, idealTurn, TURN_ACCEL * DT),
  };
}

export function integrate(pose: Pose, speed: number, angular: number): Pose {
  const heading = pose.heading + angular * DT / 2;
  return {
    x: pose.x + Math.cos(heading) * speed * DT,
    y: pose.y + Math.sin(heading) * speed * DT,
    heading: angleWrap(pose.heading + angular * DT),
  };
}

export function scan(robot: Robot, obstacles: Obstacle[], time: number): Sensors {
  const range = 5.8;
  const rays: Ray[] = Array.from({ length: 96 }, (_, i) => {
    const angle = i * Math.PI / 48 - Math.PI;
    const world = angle + robot.pose.heading;
    let closest = range;
    let obstacleId: string | undefined;
    for (const o of obstacles) {
      const hit = rayBox(robot.pose, Math.cos(world), Math.sin(world), o);
      if (hit < closest) { closest = hit; obstacleId = o.id; }
    }
    return { angle, distance: closest, obstacleId };
  });
  return { frame: `${robot.id}/scan`, time, pose: { ...robot.pose }, kind: 'geometric', range, rays };
}
