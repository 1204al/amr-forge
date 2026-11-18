import type { Obstacle, Point } from '../telemetry/contract.ts';

export const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
export const angleWrap = (angle: number) => Math.atan2(Math.sin(angle), Math.cos(angle));
export const lerp = (a: Point, b: Point, t: number): Point => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
export const rangeToBox = (p: Point, o: Obstacle) =>
  Math.hypot(Math.max(0, Math.abs(p.x - o.x) - o.w / 2), Math.max(0, Math.abs(p.y - o.y) - o.h / 2));

export function rayBox(origin: Point, dx: number, dy: number, box: Obstacle, padding = 0): number {
  let near = 0;
  let far = Infinity;
  for (const [relative, direction, half] of [
    [box.x - origin.x, dx, box.w / 2 + padding],
    [box.y - origin.y, dy, box.h / 2 + padding],
  ]) {
    if (Math.abs(direction) < 1e-9) {
      if (Math.abs(relative) > half) return Infinity;
      continue;
    }
    const a = (relative - half) / direction;
    const b = (relative + half) / direction;
    near = Math.max(near, Math.min(a, b));
    far = Math.min(far, Math.max(a, b));
    if (near > far) return Infinity;
  }
  return near;
}

export const segmentHits = (a: Point, b: Point, obstacle: Obstacle, clearance: number) =>
  rayBox(a, b.x - a.x, b.y - a.y, obstacle, clearance) <= 1;

export function sweptDistance(a: Point, b: Point, c: Point, d: Point) {
  const x = a.x - c.x;
  const y = a.y - c.y;
  const dx = b.x - a.x - d.x + c.x;
  const dy = b.y - a.y - d.y + c.y;
  const t = Math.min(1, Math.max(0, -(x * dx + y * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(x + dx * t, y + dy * t);
}

export function routeLength(from: Point, route: Point[]) {
  let total = 0;
  for (const point of route) {
    total += distance(from, point);
    from = point;
  }
  return total;
}
