import { describe, expect, it } from 'vitest';
import { ACCEL, BRAKE, DT, SPEED, scan } from '../autonomy/control';
import { Warehouse } from '../autonomy/engine';
import { distance, rayBox } from '../autonomy/geometry';
import { clearSegment, plan } from '../autonomy/planning';
import { destinations, FIXED, FORKLIFT, FLEET } from '../autonomy/world';
import { benchmark } from '../benchmarks/model';
import type { Obstacle } from '../telemetry/contract';
import { decodeRecording, frameAt } from '../telemetry/recordings';

const ticks = (engine: Warehouse, seconds: number) => {
  for (let i = 0; i < Math.round(seconds / DT); i++) engine.step();
};

describe('occupancy and range measurements', () => {
  it('finds a clear detour when the direct segment is obstructed', () => {
    const start = FLEET[0].pose;
    const goal = destinations[0].point;
    expect(plan(start, goal, FIXED)).toEqual([goal]);
    const obstacles = [...FIXED, FORKLIFT];
    const route = plan(start, goal, obstacles)!;
    expect(route.length).toBeGreaterThan(1);
    expect(route.at(-1)).toEqual(goal);
    expect(route.every((point, i) => clearSegment(route[i - 1] ?? start, point, obstacles))).toBe(true);
  });

  it('inflates obstacles and rejects blocked, invalid, and disconnected goals', () => {
    const bank: Obstacle = { id: 'bank', kind: 'barrier', x: 0, y: 0, w: .8, h: 16 };
    expect(plan({ x: -1, y: 0 }, { x: 1, y: 0 }, [bank])).toBeNull();
    expect(plan({ x: -4, y: 0 }, { x: -.7, y: 0 }, [bank])).toBeNull();
    expect(plan({ x: -4, y: 0 }, { x: 30, y: 0 }, [])).toBeNull();
    expect(plan({ x: -4, y: 0 }, { x: NaN, y: 0 }, [])).toBeNull();
  });

  it('returns the nearest ray intersection and preserves misses', () => {
    const robot = new Warehouse().snapshot().robots[0];
    const nearer = { ...FORKLIFT, x: robot.pose.x + 2.5 };
    expect(rayBox(robot.pose, 1, 0, nearer)).toBeCloseTo(1.5);
    const data = scan(robot, [{ ...nearer, id: 'farther', x: nearer.x + 2 }, nearer], 2.5);
    expect(data.rays.find(r => r.angle === 0)).toEqual({ angle: 0, distance: 1.5, obstacleId: nearer.id });
    expect(data.rays.find(r => r.angle === -Math.PI)?.distance).toBe(data.range);
    expect(data.time).toBe(2.5);
  });
});

describe('warehouse state transitions', () => {
  it('observes the forklift, brakes, replans, coordinates, and completes both missions without contact', () => {
    const engine = new Warehouse();
    engine.command({ type: 'scenario' });
    for (let i = 0; i < 1500; i++) {
      const before = engine.snapshot().robots;
      engine.step();
      for (const [j, robot] of engine.snapshot().robots.entries()) {
        const previous = before[j];
        expect(robot.speed).toBeLessThanOrEqual(SPEED);
        expect(robot.speed - previous.speed).toBeLessThanOrEqual(ACCEL * DT + 1e-9);
        expect(previous.speed - robot.speed).toBeLessThanOrEqual(BRAKE * DT + 1e-9);
        expect(Math.abs(robot.angular - previous.angular)).toBeLessThanOrEqual(8 * DT + 1e-9);
        expect(distance(previous.pose, robot.pose)).toBeLessThanOrEqual(SPEED * DT + 1e-9);
      }
    }
    const frame = engine.snapshot();
    const relevant = frame.events.filter(e => e.robotId === 'AMR-01').map(e => e.kind);
    expect(relevant.slice(0, 6)).toEqual(['mission', 'detection', 'braking', 'stop', 'replan', 'resume']);
    expect(frame.observed).toContain('forklift');
    expect(frame.robots.every(r => r.status === 'delivered')).toBe(true);
    expect(frame.metrics).toMatchObject({ collisions: 0, delivered: 2, stops: 1 });
    expect(frame.metrics.trafficWaits).toBeGreaterThan(0);
    expect(frame.metrics.minClearance).toBeGreaterThan(.1);
    expect(frame.metrics.distance).toBeCloseTo(frame.robots.reduce((total, r) => total + r.distance, 0));
    expect(frame.metrics.throughput).toBeCloseTo(2.4);
  });

  it('queues jobs by priority and assigns the highest priority first when a unit becomes available', () => {
    const engine = new Warehouse();
    expect(engine.command({ type: 'delivery', destination: 'missing', priority: 1 }).ok).toBe(false);
    engine.command({ type: 'delivery', destination: 'P02', priority: 1 });
    engine.command({ type: 'delivery', destination: 'C01', priority: 3 });
    expect(engine.snapshot().queue.map(j => j.priority)).toEqual([3, 1]);
    engine.command({ type: 'start' });
    ticks(engine, 25);
    const assignments = engine.snapshot().events.filter(e => e.title === 'Delivery assigned');
    expect(assignments[2].detail).toContain('C01');
    expect(assignments[3].detail).toContain('P02');
  });

  it('acknowledges injection once and rejects placement in geometry or on a robot', () => {
    const engine = new Warehouse();
    expect(engine.command({ type: 'obstacle', point: FLEET[0].pose }).ok).toBe(false);
    expect(engine.command({ type: 'obstacle', point: { x: 0, y: -.9 } }).ok).toBe(false);
    expect(engine.command({ type: 'obstacle', point: { x: 3.6, y: 6.7 } }).ok).toBe(true);
    expect(engine.command({ type: 'incident' }).ok).toBe(true);
    expect(engine.command({ type: 'incident' }).ok).toBe(false);
    expect(engine.snapshot().observed).not.toContain('forklift');
  });

  it('halts the clock and clears the scenario on reset', () => {
    const engine = new Warehouse();
    engine.command({ type: 'start' });
    ticks(engine, 2);
    engine.command({ type: 'pause' });
    const paused = engine.snapshot();
    ticks(engine, 1);
    expect(engine.snapshot()).toEqual(paused);
    engine.command({ type: 'reset' });
    expect(engine.snapshot()).toEqual(new Warehouse().snapshot());
  });
});

describe('telemetry, replay, and benchmarks', () => {
  it('round-trips poses, scans, events and the measured frame, and selects the last frame before the cursor', () => {
    const engine = new Warehouse();
    const start = engine.snapshot();
    engine.command({ type: 'scenario' });
    ticks(engine, 4);
    const before = engine.snapshot();
    ticks(engine, 3);
    const after = engine.snapshot();
    const data = { version: 1, source: 'local', createdAt: new Date().toISOString(), frames: [start, before, after] };
    const recording = decodeRecording(JSON.parse(JSON.stringify(data)));
    expect(frameAt(recording, 6)).toEqual(JSON.parse(JSON.stringify(before)));
    expect(frameAt(recording, 8)).toEqual(JSON.parse(JSON.stringify(after)));
    expect(() => decodeRecording({ ...data, source: 'isaac' })).toThrow();
    expect(() => decodeRecording({ ...data, frames: [after, before] })).toThrow();
  });

  it('rejects Isaac data without actual RGB and point-cloud payloads', () => {
    const engine = new Warehouse(undefined, 'isaac');
    expect(() => decodeRecording({
      version: 1, source: 'isaac', createdAt: new Date().toISOString(), frames: [engine.snapshot()],
    })).toThrow('nonempty RTX LiDAR');
  });

  it('reports deterministic policy outcomes under a common time budget', () => {
    const all = benchmark();
    expect(benchmark()).toEqual(all);
    expect(all.map(r => r.seconds)).toEqual([50, 50, 50]);
    expect(all.map(r => r.delivered)).toEqual([2, 1, 0]);
    expect(all[2].collisions).toBeGreaterThan(0);
  });
});
