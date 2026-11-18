export type Point = { x: number; y: number };
export type Pose = Point & { heading: number };
export type Obstacle = Point & { id: string; kind: 'rack' | 'forklift' | 'barrier' | 'wall'; w: number; h: number };
export type RobotStatus = 'ready' | 'driving' | 'braking' | 'stopped' | 'yielding' | 'blocked' | 'delivered' | 'idle';
export type EventKind = 'system' | 'mission' | 'incident' | 'detection' | 'braking' | 'stop' | 'replan' | 'resume' | 'traffic' | 'delivery' | 'blocked' | 'collision';
export type Entry = { id: number; time: number; kind: EventKind; title: string; detail: string; robotId?: string };
export type Job = { id: string; destination: string; priority: number };
export type Ray = { angle: number; distance: number; obstacleId?: string };
export type Sensors = {
  frame: string;
  time: number;
  pose: Pose;
  kind: 'geometric' | 'rtx';
  range: number;
  rays: Ray[];
  worldPoints?: [number, number, number][];
  rgb?: string;
  rgbTime?: number;
  height?: number;
};
export type Robot = {
  id: string;
  pose: Pose;
  speed: number;
  angular: number;
  status: RobotStatus;
  job: Job | null;
  route: Point[];
  previousRoute: Point[];
  progress: number;
  distance: number;
  lastEvent: string;
  sensor: Sensors | null;
};
export type Metrics = {
  distance: number;
  delivered: number;
  stops: number;
  replans: number;
  collisions: number;
  trafficWaits: number;
  minClearance: number | null;
  throughput: number;
};
export type Frame = {
  version: 1;
  source: 'local' | 'isaac';
  scenario: string;
  coordinates: 'world-xy-m-rad';
  time: number;
  running: boolean;
  robots: Robot[];
  obstacles: Obstacle[];
  observed: string[];
  events: Entry[];
  queue: Job[];
  metrics: Metrics;
};
export type Recording = { version: 1; source: Frame['source']; createdAt: string; frames: Frame[] };
export type Command =
  | { type: 'start' | 'pause' | 'reset' | 'incident' | 'scenario' }
  | { type: 'destination' | 'delivery'; destination: string; robotId?: string; priority: number }
  | { type: 'obstacle'; point: Point };
export type Ack = { ok: boolean; message: string };
export interface SimulationBackend {
  snapshot(): Frame | null;
  subscribe(listener: () => void): () => void;
  command(command: Command): Promise<Ack>;
  dispose(): void;
}
