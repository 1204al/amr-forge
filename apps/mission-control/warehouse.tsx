import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Billboard, Html, Line, OrbitControls, RoundedBox } from '@react-three/drei';
import { Component, memo, useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import type { ReactNode, Ref } from 'react';
import * as THREE from 'three';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import { bounds, destinations, FLEET, RACKS } from '../../autonomy/world';
import type { Frame, Obstacle, Point, Robot } from '../../telemetry/contract';

export const cameras = ['Orbit', 'Overhead', 'Follow', 'Robot POV'] as const;
export type Camera = typeof cameras[number];
type Triple = [number, number, number];
type Part = { at: Triple; size: Triple; color: string; rotate: number };
type PartGroups = Record<'steel' | 'cargo' | 'paint' | 'light', Part[]>;

function buildWarehouse() {
  const parts: PartGroups = { steel: [], cargo: [], paint: [], light: [] };
  const add = (group: keyof PartGroups, at: Triple, size: Triple, color: string, rotate = 0) =>
    parts[group].push({ at, size, color, rotate });
  for (const [i, rack] of RACKS.entries()) {
    const { x, y, w, h } = rack;
    const height = i < 3 ? 3.55 : i < 6 ? 3.05 : 2.35;
    for (const xx of [x - w / 2 + 0.06, x, x + w / 2 - 0.06]) {
      for (const zz of [y - h / 2 + 0.06, y + h / 2 - 0.06]) {
        add('steel', [xx, height / 2, zz], [0.115, height, 0.12], '#46515c');
        add('steel', [xx, 0.105, zz], [0.19, 0.21, 0.19], '#c1904a');
        add('steel', [xx, height - 0.11, zz], [0.13, 0.17, 0.13], '#a77541');
      }
      for (const level of [0.56, 1.7, height - 0.13]) {
        add('steel', [xx, level, y], [0.083, 0.068, h], '#58616b');
      }
    }
    for (const [levelIndex, level] of [0.18, height * 0.36, height * 0.68].entries()) {
      for (const zz of [y - h / 2 + 0.055, y + h / 2 - 0.055]) {
        add('steel', [x, level, zz], [w, 0.115, 0.11], levelIndex === 0 ? '#8e5c37' : '#b67a49');
        for (const xx of [x - 1.63, x + 1.08]) add('paint', [xx, level, zz + Math.sign(zz - y) * 0.057], [.25, .049, .008], '#e9c792');
      }
      add('steel', [x, level, y], [w - 0.12, 0.055, h - .2], '#383b3e');
      for (let bay = 0; bay < 4; bay++) {
        if ((i + levelIndex * 5 + bay * 11) % 7 === 3) continue;
        const xx = x + (bay - 1.5) * 1.14;
        const palette = ['#a38466', '#80664f', '#786c5d', '#b79571', '#485861', '#9e8d7b'];
        const color = palette[(i * 5 + levelIndex * 2 + bay) % palette.length];
        const boxH = 0.37 + ((i * 7 + bay * 3 + levelIndex) % 6) * 0.064;
        for (const z of [y - .45, y, y + .45]) add('cargo', [xx, level + .065, z], [.96, .09, .14], '#796348');
        add('cargo', [xx, level + .11 + boxH / 2, y], [.9, boxH, 1.05], color);
        add('paint', [xx - .26, level + .16 + boxH / 2, y + .528], [.16, .11, .012], '#d3c1a7');
        add('paint', [xx + .015, level + .11 + boxH + .004, y], [.063, .01, 1.052], '#443e36');
        if ((i + bay + levelIndex) % 5 === 2) {
          add('cargo', [xx + .16, level + .2 + boxH, y + .19], [.51, .17, .51], '#968069');
        }
      }
    }
  }
  add('steel', [0, 1.9, -8.24], [24.3, 3.8, .28], '#343b40');
  add('steel', [-12.25, 1.66, -3.85], [.31, 3.32, 8.85], '#2d373d');
  add('steel', [0, .34, -8.06], [24.4, .67, .19], '#525254');
  for (let i = 0; i < 82; i++) {
    add('steel', [-12 + i * .297, 2.16, -8.078], [0.037, 3.23, .06], i % 5 === 0 ? '#525b60' : '#3e494f');
  }
  for (let i = 0; i < 32; i++) {
    add('steel', [-12.06, 1.75, -8.14 + i * .27], [.066, 2.95, .034], '#3d484e');
  }
  for (const x of [-11.85, -6, 0, 6, 11.81]) {
    add('steel', [x, 2.01, -8.08], [.22, 4, .36], '#536470');
    add('steel', [x, 3.85, -7.86], [.31, .27, .75], '#60696e');
    add('steel', [x, .34, -7.93], [.32, .68, .29], '#937042');
  }
  add('steel', [0, 3.78, -7.98], [24.3, .19, .26], '#596875');
  for (const x of [-9, -3, 3, 9]) {
    add('steel', [x, 1.42, -8.045], [3.08, 2.84, .24], '#181d23');
    add('steel', [x, 1.35, -7.88], [2.77, 2.54, .12], '#4a5255');
    for (let i = 0; i < 18; i++) add('steel', [x, .12 + i * .14, -7.803], [2.77, .034, .03], '#596164');
    add('steel', [x, 2.76, -7.82], [3.3, .18, .29], '#22292d');
    add('light', [x, 2.79, -7.65], [.72, .04, .035], '#b7e7ff');
    add('paint', [x, .016, -6.72], [3.18, .019, .055], '#a78350');
    for (const side of [-1, 1]) {
      add('steel', [x + side * 1.58, .38, -7.57], [.14, .74, .17], '#c1975b');
      add('paint', [x + side * 1.54, .016, -7.29], [.049, .02, 1.19], '#a78350');
    }
  }
  for (const x of [-9.9, -3.68, 3.68, 9.9]) {
    for (const y of [-5.62, .06, 2.68, 6.5]) {
      add('paint', [x, .013, y], [.12, .022, .66], '#a89872');
      add('paint', [x - .13, .013, y + .38], [.37, .02, .072], '#a89872', Math.PI / 4);
      add('paint', [x + .13, .013, y + .38], [.37, .02, .072], '#a89872', -Math.PI / 4);
    }
  }
  for (const y of [-7.82, 7.79]) add('paint', [0, .009, y], [23.8, .013, .06], '#93805d');
  for (const x of [-11.83, 11.83]) add('paint', [x, .01, 0], [.057, .015, 15.55], '#93805d');
  for (const { point: { x, y } } of destinations) {
    for (const side of [-1, 1]) {
      add('paint', [x + side * .85, .025, y], [.043, .017, 1.6], '#bdab86');
      add('paint', [x, .025, y + side * .8], [1.74, .017, .046], '#bdab86');
      for (let i = 0; i < 6; i++) add('paint', [x - .73 + .29 * i, .026, y + side * .7], [.22, .016, .045], '#b7a376', -.64);
    }
  }
  for (const y of [-3.52, -1.84, .12, 2.68, 4.7]) {
    for (let i = 0; i < 27; i++) {
      const x = -11.6 + i * .89;
      add('paint', [x, .014, y], [.51, .018, .027], '#857963');
    }
  }
  for (const x of [-10.6, -3.68, 3.68]) {
    add('steel', [x, .3, 7.58], [1.29, .6, .52], '#394b52');
    add('steel', [x, .67, 7.61], [1.24, .15, .47], '#57636d');
    add('light', [x, .555, 7.302], [.32, .055, .022], '#6ce9ff');
    for (const offset of [-.66, .66]) add('steel', [x + offset, .45, 7.18], [.113, .9, .115], '#ad874b');
  }
  return parts;
}

const parts = buildWarehouse();

function Batch({ group }: { group: keyof PartGroups }) {
  const mesh = useRef<THREE.InstancedMesh>(null);
  useLayoutEffect(() => {
    const pointer = new THREE.Object3D();
    const matrix = mesh.current!;
    parts[group].forEach(({ at, size, color, rotate }, i) => {
      pointer.position.set(...at);
      pointer.scale.set(...size);
      pointer.rotation.y = rotate;
      pointer.updateMatrix();
      matrix.setMatrixAt(i, pointer.matrix);
      matrix.setColorAt(i, new THREE.Color(color));
    });
    matrix.instanceMatrix.needsUpdate = true;
    matrix.computeBoundingSphere();
  }, [group]);
  return <instancedMesh ref={mesh} args={[undefined, undefined, parts[group].length]} castShadow={group === 'steel' || group === 'cargo'} receiveShadow>
    <boxGeometry />
    {group === 'light' ? <meshBasicMaterial /> : <meshStandardMaterial roughness={group === 'steel' ? .65 : .85} metalness={group === 'steel' ? .39 : .06} />}
  </instancedMesh>;
}

const WarehouseStructure = memo(function WarehouseStructure() {
  const texture = useMemo(() => {
    const surface = document.createElement('canvas');
    surface.width = surface.height = 512;
    const ctx = surface.getContext('2d')!;
    let state = 299391;
    const random = () => ((state = Math.imul(state, 1664525) + 1013904223 | 0) >>> 0) / 4294967296;
    ctx.fillStyle = '#5f6367';
    ctx.fillRect(0, 0, 512, 512);
    for (let i = 0; i < 290; i++) {
      const x = random() * 512;
      const y = random() * 512;
      const radius = 2 + random() * 26;
      const grad = ctx.createRadialGradient(x, y, 0, x, y, radius);
      grad.addColorStop(0, i % 3 === 0 ? '#b4afaa22' : '#151b2230');
      grad.addColorStop(1, '#12181d00');
      ctx.fillStyle = grad;
      ctx.fillRect(x - radius, y - radius, 2 * radius, 2 * radius);
    }
    const pixels = ctx.getImageData(0, 0, 512, 512);
    for (let i = 0; i < pixels.data.length; i += 4) {
      const tone = Math.round((random() - .5) * 20);
      for (let c = 0; c < 3; c++) pixels.data[i + c] += tone;
    }
    ctx.putImageData(pixels, 0, 0);
    for (const offset of [0, 256]) {
      ctx.fillStyle = '#292b2f70';
      ctx.fillRect(offset, 0, 2, 512);
      ctx.fillRect(0, offset, 512, 2);
    }
    const map = new THREE.CanvasTexture(surface);
    map.colorSpace = THREE.SRGBColorSpace;
    map.wrapS = map.wrapT = THREE.RepeatWrapping;
    map.repeat.set(4, 3);
    map.anisotropy = 8;
    return map;
  }, []);
  useEffect(() => () => texture.dispose(), [texture]);
  return <>
    <mesh receiveShadow rotation={[-Math.PI / 2, 0, 0]}>
      <planeGeometry args={[24.35, 16.37]} />
      <meshStandardMaterial map={texture} roughness={.82} metalness={.2} />
    </mesh>
    <mesh position={[0, -.26, 0]} receiveShadow>
      <boxGeometry args={[24.4, .47, 16.45]} />
      <meshStandardMaterial color="#292f39" roughness={.88} />
    </mesh>
    {(Object.keys(parts) as (keyof PartGroups)[]).map(group => <Batch key={group} group={group} />)}
  </>;
});

function Box({ at, size, color, glow = false }: { at: Triple; size: Triple; color: string; glow?: boolean }) {
  return <mesh position={at} castShadow={!glow} receiveShadow>
    <boxGeometry args={size} />
    {glow ? <meshBasicMaterial color={color} /> : <meshStandardMaterial color={color} metalness={.36} roughness={.58} />}
  </mesh>;
}

function Forklift({ obstacle, observed }: { obstacle: Obstacle; observed: boolean }) {
  const hue = observed ? '#fb8465' : '#ffb365';
  return <group position={[obstacle.x, 0, obstacle.y]}>
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, .029, 0]}>
      <planeGeometry args={[obstacle.w + .5, obstacle.h + .5]} />
      <meshBasicMaterial color="#fa8a53" transparent opacity={.19} depthWrite={false} />
    </mesh>
    {obstacle.kind === 'forklift' ? <>
      <Box at={[-.24, .36, 0]} size={[1.16, .52, .93]} color="#db9331" />
      <Box at={[-.48, .63, 0]} size={[.51, .26, .8]} color="#b37428" />
      <Box at={[0, 1.52, 0]} size={[.98, .105, .94]} color="#d39b49" />
      <Box at={[-.06, .77, 0]} size={[.31, .16, .42]} color="#15171a" />
      {[-1, 1].flatMap(side => [
        <Box key={`cab-a-${side}`} at={[-.45, 1.05, side * .43]} size={[.07, .86, .07]} color="#252a31" />,
        <Box key={`cab-b-${side}`} at={[.4, 1.03, side * .43]} size={[.07, .92, .07]} color="#252a31" />,
        <Box key={`mast-${side}`} at={[.52, .97, side * .28]} size={[.095, 1.64, .095]} color="#43484b" />,
        <Box key={`fork-${side}`} at={[.72, .13, side * .245]} size={[.62, .07, .13]} color="#555b61" />,
        ...[-.56, .26].map(x => <mesh key={`wheel-${side}-${x}`} position={[x, .23, side * .48]} rotation={[Math.PI / 2, 0, 0]} castShadow>
          <cylinderGeometry args={[.22, .22, .17, 16]} /><meshStandardMaterial color="#202124" roughness={.9} />
        </mesh>),
      ])}
      <Box at={[-.26, 1.64, .24]} size={[.16, .13, .16]} color="#ffb36b" glow />
    </> : <Box at={[0, .26, 0]} size={[obstacle.w, .52, obstacle.h]} color="#c27649" />}
    <Html position={[0, obstacle.kind === 'forklift' ? 2.2 : .9, 0]} center zIndexRange={[6, 3]} className="scene-tag incident-tag">
      <span style={{ color: hue }}>{obstacle.kind === 'forklift' ? 'AISLE BLOCKED' : 'BARRIER'}</span>
    </Html>
  </group>;
}

function RobotModel({ robot, selected, select, pov }: { robot: Robot; selected: boolean; select: () => void; pov: boolean }) {
  const seed = FLEET.find(r => r.id === robot.id);
  const color = seed?.color ?? '#b7e7ff';
  const root = useRef<THREE.Group>(null);
  const forward = useRef<THREE.Group>(null);
  const position = new THREE.Vector3(robot.pose.x, 0, robot.pose.y);
  useFrame((_, delta) => {
    if (!root.current || !forward.current) return;
    const k = 1 - Math.exp(-delta * 22);
    root.current.position.lerp(position, k);
    const angle = -robot.pose.heading - forward.current.rotation.y;
    forward.current.rotation.y += Math.atan2(Math.sin(angle), Math.cos(angle)) * k;
  });
  return <group ref={root} position={position} onClick={event => { event.stopPropagation(); select(); }}>
    <group ref={forward} rotation={[0, -robot.pose.heading, 0]} visible={!pov}>
      <RoundedBox position={[0, .17, 0]} args={[.85, .29, .67]} radius={.095} smoothness={3} castShadow>
        <meshStandardMaterial color="#151b21" metalness={.34} roughness={.46} />
      </RoundedBox>
      <RoundedBox position={[0, .325, 0]} args={[.79, .17, .63]} radius={.063} smoothness={3} castShadow>
        <meshStandardMaterial color={color} metalness={.43} roughness={.34} />
      </RoundedBox>
      <Box at={[.425, .218, 0]} size={[.022, .047, .37]} color={color} glow />
      <Box at={[-.425, .214, 0]} size={[.022, .047, .22]} color="#ec7770" glow />
      <Box at={[.02, .427, 0]} size={[.55, .043, .46]} color="#353d43" />
      <mesh position={[.24, .486, 0]} castShadow>
        <cylinderGeometry args={[.083, .083, .12, 18]} /><meshStandardMaterial color="#b6c5ca" metalness={.72} roughness={.3} />
      </mesh>
      <mesh position={[.24, .535, 0]}>
        <cylinderGeometry args={[.084, .084, .023, 18]} /><meshBasicMaterial color={color} />
      </mesh>
      {[-1, 1].map(side => <mesh key={side} position={[-.025, .136, side * .31]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[.134, .134, .105, 18]} /><meshStandardMaterial color="#161719" roughness={.93} />
      </mesh>)}
    </group>
    {!pov && <>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, .06, 0]}>
        <ringGeometry args={[.62, .66, 48]} /><meshBasicMaterial color={color} transparent opacity={selected ? .95 : .48} />
      </mesh>
      <Html center position={[0, 1.08, 0]} zIndexRange={[8, 4]} className="scene-tag">
        <button onClick={select} style={{ color }} className={selected ? 'current' : ''} aria-label={`Select ${robot.id} in warehouse`}><i />{robot.id}</button>
      </Html>
    </>}
  </group>;
}

const defaultCamera: Triple = [9.7, 19.8, 20.5];
const orbitTarget: Triple = [0, -.66, 0];

function Director({ mode, robot, controls }: { mode: Camera; robot?: Robot; controls: Ref<OrbitControlsImpl> }) {
  const camera = useThree(s => s.camera);
  const aspect = useThree(s => s.size.width / Math.max(s.size.height, 1));
  const controller = useRef<OrbitControlsImpl>(null);
  const snap = useRef(true);
  const currentTarget = useMemo(() => new THREE.Vector3(...orbitTarget), []);
  useEffect(() => { snap.current = true; }, [mode, aspect]);
  useFrame((_, dt) => {
    const orbit = controller.current;
    if (!orbit) return;
    if (mode === 'Orbit' && !snap.current) return;
    const [x, y, heading] = robot ? [robot.pose.x, robot.pose.y, robot.pose.heading] : [0, 0, 0];
    const cx = Math.cos(heading);
    const cy = Math.sin(heading);
    const configurations: Record<Camera, [Triple, Triple]> = {
      Orbit: [defaultCamera, orbitTarget],
      Overhead: [[0, 27, .12], [0, 0, 0]],
      Follow: [[x - cx * 5 + cy * 3.5, 4.7, y - cy * 5 - cx * 3.5], [x + cx * 1.8, .65, y + cy * 1.8]],
      'Robot POV': [[x + cx * .39, .57, y + cy * .39], [x + cx * 5, .62, y + cy * 5]],
    };
    const [eye, target] = configurations[mode];
    const alpha = 1 - Math.exp(-dt * (mode === 'Robot POV' ? 13 : 6));
    const desired = new THREE.Vector3(...eye);
    if (mode === 'Orbit' || mode === 'Overhead') desired.multiplyScalar(Math.max(1, 1.42 / aspect));
    camera.position.lerp(desired, alpha);
    currentTarget.lerp(new THREE.Vector3(...target), alpha);
    if (mode === 'Orbit' && camera.position.distanceTo(desired) < .025) snap.current = false;
    if (mode === 'Orbit') {
      orbit.target.copy(currentTarget);
      orbit.update();
    } else {
      camera.lookAt(currentTarget);
    }
  });
  return <OrbitControls ref={instance => {
    controller.current = instance;
    if (typeof controls === 'function') controls(instance);
    else if (controls) controls.current = instance;
  }} enabled={mode === 'Orbit'} makeDefault enableDamping dampingFactor={.1} minDistance={4} maxDistance={48} maxPolarAngle={Math.PI * .47} target={orbitTarget} />;
}

function Measurements({ robot }: { robot: Robot }) {
  const sensor = robot.sensor;
  if (!sensor) return null;
  const { pose } = sensor;
  if (sensor.kind === 'rtx') return <group>{sensor.worldPoints?.filter((_, i) => i % 8 === 0).map(([x, y, z], i) =>
    <mesh key={i} position={[x, z, y]}><sphereGeometry args={[.035, 6, 4]} /><meshBasicMaterial color="#73ddff" /></mesh>)}</group>;
  const points: Triple[] = sensor.rays.filter((_, i) => i % 3 === 0).flatMap(({ angle, distance }) => {
    const heading = angle + pose.heading;
    return [[pose.x, .12, pose.y], [pose.x + Math.cos(heading) * distance, .12, pose.y + Math.sin(heading) * distance]];
  });
  return <Line points={points} segments color="#6fddf4" lineWidth={.68} transparent opacity={.34} depthWrite={false} />;
}

class SceneBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    return this.state.failed
      ? <div className="scene-failure">WebGL could not start. The occupancy map and telemetry are still available.</div>
      : this.props.children;
  }
}

type Props = {
  frame: Frame; selected: string; camera: Camera; showPaths: boolean; showLidar: boolean;
  placing: boolean; select: (id: string) => void; place: (p: Point) => void;
};

export function WarehouseScene({ frame, selected, camera, showPaths, showLidar, placing, select, place }: Props) {
  const controls = useRef<OrbitControlsImpl>(null);
  const robot = frame.robots.find(r => r.id === selected);
  return <SceneBoundary>
    <Canvas camera={{ position: defaultCamera, fov: 43, near: .08, far: 95 }} dpr={[1, 1.55]} shadows={{ type: THREE.PCFShadowMap }}
      gl={{ antialias: true, powerPreference: 'high-performance', preserveDrawingBuffer: true }}
      performance={{ min: .65 }}
      fallback={<div className="scene-failure">WebGL unavailable. Inspect the occupancy map.</div>}>
      <fog attach="fog" args={['#171f29', 31, 67]} />
      <hemisphereLight args={['#b7d7fa', '#483d32', 2.1]} />
      <directionalLight position={[-4, 14, 1]} intensity={3.1} color="#ffe3be" castShadow
        shadow-mapSize-width={1536} shadow-mapSize-height={1536} shadow-camera-left={-16} shadow-camera-right={16}
        shadow-camera-top={13} shadow-camera-bottom={-13} shadow-normalBias={.036} shadow-bias={-.00018} />
      <directionalLight position={[10, 8, -8]} color="#85b6eb" intensity={1.65} />
      <WarehouseStructure />
      {frame.obstacles.filter(o => o.kind === 'forklift' || o.kind === 'barrier').map(o =>
        <Forklift key={o.id} obstacle={o} observed={frame.observed.includes(o.id)} />)}
      {showPaths && frame.robots.map(r => {
        const color = ['braking', 'stopped', 'blocked'].includes(r.status) ? '#ff9775' : FLEET.find(seed => seed.id === r.id)?.color ?? '#92e4ff';
        const points = [r.pose, ...r.route].map(p => [p.x, .074, p.y] as Triple);
        return <group key={r.id}>
          {points.length > 1 && <Line points={points} color={color} lineWidth={r.id === selected ? 2.5 : 1.65} transparent opacity={.86} />}
          {r.previousRoute.length > 1 && <Line points={r.previousRoute.map(p => [p.x, .085, p.y] as Triple)}
            dashed dashSize={.18} gapSize={.17} lineWidth={1.3} color="#f28c63" transparent opacity={.54} />}
          {r.route.map((p, i) => <mesh key={i} position={[p.x, .081, p.y]} rotation={[-Math.PI / 2, 0, 0]}>
            <ringGeometry args={[i === r.route.length - 1 ? .23 : .09, i === r.route.length - 1 ? .29 : .13, 24]} />
            <meshBasicMaterial color={color} side={THREE.DoubleSide} />
          </mesh>)}
        </group>;
      })}
      {showLidar && robot && camera !== 'Robot POV' && <Measurements robot={robot} />}
      {frame.robots.map(r => <RobotModel key={r.id} robot={r} selected={r.id === selected} select={() => select(r.id)} pov={r.id === selected && camera === 'Robot POV'} />)}
      {destinations.map(({ id, point }) => <Billboard key={id} position={[point.x, .36, point.y]}>
        <Html center zIndexRange={[2, 1]} className="zone-label">{id}</Html>
      </Billboard>)}
      {placing && <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, .018, 0]} onClick={event => {
        event.stopPropagation();
        place({ x: event.point.x, y: event.point.z });
      }}>
        <planeGeometry args={[bounds.x * 2, bounds.y * 2]} /><meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>}
      <Director mode={camera} robot={robot} controls={controls} />
    </Canvas>
  </SceneBoundary>;
}
