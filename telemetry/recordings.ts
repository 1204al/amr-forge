import type { Frame, Recording } from './contract.ts';

const object = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object';
const finite = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
const text = (x: unknown): x is string => typeof x === 'string';
const point = (x: unknown) => object(x) && finite(x.x) && finite(x.y);
const pose = (x: unknown) => object(x) && point(x) && finite(x.heading);
const job = (x: unknown) => object(x) && text(x.id) && text(x.destination) && finite(x.priority);
const list = (x: unknown, valid: (item: unknown) => boolean) => Array.isArray(x) && x.every(valid);
const statuses = ['ready', 'driving', 'braking', 'stopped', 'yielding', 'blocked', 'delivered', 'idle'];
const metrics = ['distance', 'delivered', 'stops', 'replans', 'collisions', 'trafficWaits', 'throughput'];
const image = /^data:image\/(png|jpeg);base64,[a-z0-9+/=]+$/i;

export function isFrame(x: unknown): x is Frame {
  if (!object(x) || x.version !== 1 || (x.source !== 'local' && x.source !== 'isaac') ||
      x.coordinates !== 'world-xy-m-rad' || !text(x.scenario) || !finite(x.time) || x.time < 0 ||
      typeof x.running !== 'boolean') return false;
  const m = x.metrics;
  return object(m) && metrics.every(key => finite(m[key])) && (m.minClearance === null || finite(m.minClearance))
    && list(x.observed, text) && list(x.queue, job) &&
    list(x.obstacles, o => object(o) && text(o.id) && ['rack', 'forklift', 'barrier', 'wall'].includes(String(o.kind)) &&
      point(o) && finite(o.w) && finite(o.h) && o.w > 0 && o.h > 0) &&
    list(x.events, e => object(e) && finite(e.id) && finite(e.time) && text(e.kind) && text(e.title) && text(e.detail) &&
      (e.robotId === undefined || text(e.robotId))) &&
    list(x.robots, r => {
      if (!object(r) || !text(r.id) || !statuses.includes(String(r.status)) || !pose(r.pose) || !text(r.lastEvent) ||
          (r.job !== null && !job(r.job)) || !list(r.route, point) || !list(r.previousRoute, point) ||
          ![r.speed, r.angular, r.distance, r.progress].every(finite)) return false;
      const s = r.sensor;
      return s === null || (object(s) && text(s.frame) && finite(s.time) && pose(s.pose) &&
        s.kind === (x.source === 'isaac' ? 'rtx' : 'geometric') && finite(s.range) &&
        (s.rgbTime === undefined || finite(s.rgbTime)) && (s.height === undefined || finite(s.height)) &&
        (s.rgb === undefined || (text(s.rgb) && image.test(s.rgb))) &&
        (s.worldPoints === undefined || list(s.worldPoints, p => Array.isArray(p) && p.length === 3 && p.every(finite))) &&
        list(s.rays, ray => object(ray) && finite(ray.angle) && finite(ray.distance) &&
          (ray.obstacleId === undefined || text(ray.obstacleId))));
    });
}

export function decodeRecording(raw: unknown): Recording {
  if (!object(raw) || raw.version !== 1 || (raw.source !== 'local' && raw.source !== 'isaac')
      || typeof raw.createdAt !== 'string' || !Number.isFinite(Date.parse(raw.createdAt))
      || !Array.isArray(raw.frames) || !raw.frames.length || raw.frames.length > 100_000) {
    throw new Error('Expected a version 1 AMR Forge recording.');
  }
  let last = -1;
  const frames: Frame[] = [];
  for (const frame of raw.frames) {
    if (!isFrame(frame) || frame.source !== raw.source || frame.scenario !== raw.frames[0].scenario || frame.time < last) {
      throw new Error('Inconsistent source, coordinates, timestamps, or frame data.');
    }
    last = frame.time;
    frames.push(frame);
  }
  if (raw.source === 'isaac' && !frames.some(f => f.robots.some(r => r.sensor?.worldPoints?.length && r.sensor.rgb))) {
    throw new Error('Isaac replay requires recorded RGB and nonempty RTX LiDAR data.');
  }
  return { version: 1, source: raw.source, createdAt: raw.createdAt, frames };
}

export function frameAt(recording: Recording, time: number) {
  const frames = recording.frames;
  let low = 0;
  let high = frames.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (frames[mid].time <= time) low = mid + 1;
    else high = mid;
  }
  return frames[Math.max(0, low - 1)];
}
