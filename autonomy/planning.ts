import { distance, segmentHits } from './geometry.ts';
import { bounds, CLEARANCE } from './world.ts';
import type { Obstacle, Point } from '../telemetry/contract.ts';

const STEP = 0.4;
const WIDTH = Math.round(bounds.x * 2 / STEP) + 1;
const HEIGHT = Math.round(bounds.y * 2 / STEP) + 1;
const MOVES = [-1, 0, 1].flatMap(dy => [-1, 0, 1].map(dx => [dx, dy])).filter(([dx, dy]) => dx || dy);
const cell = (i: number): Point => ({ x: i % WIDTH * STEP - bounds.x, y: Math.floor(i / WIDTH) * STEP - bounds.y });

export function clearSegment(a: Point, b: Point, obstacles: Obstacle[], padding = CLEARANCE) {
  return !obstacles.some(o => segmentHits(a, b, o, padding));
}

export function plan(start: Point, goal: Point, obstacles: Obstacle[], padding = CLEARANCE): Point[] | null {
  const free = (p: Point) => Number.isFinite(p.x) && Number.isFinite(p.y)
    && Math.abs(p.x) <= bounds.x - padding && Math.abs(p.y) <= bounds.y - padding
    && clearSegment(p, p, obstacles, padding);
  if (!free(start) || !free(goal)) return null;
  if (clearSegment(start, goal, obstacles, padding)) return [goal];

  const grid = Array.from({ length: WIDTH * HEIGHT }, (_, i) => free(cell(i)));
  const nearest = (p: Point) => {
    let best = -1;
    let cost = Infinity;
    grid.forEach((open, i) => {
      if (!open) return;
      const point = cell(i);
      const d = distance(p, point);
      if (d < cost && clearSegment(p, point, obstacles, padding)) {
        best = i;
        cost = d;
      }
    });
    return best;
  };
  const first = nearest(start);
  const last = nearest(goal);
  if (first < 0 || last < 0) return null;
  const open = new Set([first]);
  const costs = new Float64Array(grid.length).fill(Infinity);
  const parents = new Int32Array(grid.length).fill(-1);
  const target = cell(last);
  costs[first] = 0;
  while (open.size) {
    let index = first;
    let score = Infinity;
    for (const i of open) {
      const f = costs[i] + distance(cell(i), target);
      if (f < score) { index = i; score = f; }
    }
    if (index === last) {
      const raw: Point[] = [goal];
      for (let i = last; i >= 0; i = parents[i]) raw.push(cell(i));
      raw.reverse();
      const smoothed: Point[] = [];
      let from = start;
      for (let i = 0; i < raw.length;) {
        let j = raw.length - 1;
        while (j > i && !clearSegment(from, raw[j], obstacles, padding)) j--;
        from = raw[j];
        if (distance(smoothed.at(-1) ?? start, from) > 1e-7) smoothed.push(from);
        i = j + 1;
      }
      return smoothed;
    }
    open.delete(index);
    for (const [dx, dy] of MOVES) {
      const x = index % WIDTH + dx;
      const y = Math.floor(index / WIDTH) + dy;
      if (x < 0 || x >= WIDTH || y < 0 || y >= HEIGHT) continue;
      const next = y * WIDTH + x;
      const cost = costs[index] + STEP * Math.hypot(dx, dy);
      if (grid[next] && cost < costs[next] && clearSegment(cell(index), cell(next), obstacles, padding)) {
        parents[next] = index;
        costs[next] = cost;
        open.add(next);
      }
    }
  }
  return null;
}
