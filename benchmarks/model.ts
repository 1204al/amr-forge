import { DT } from '../autonomy/control.ts';
import { Warehouse } from '../autonomy/engine.ts';
import type { Metrics } from '../telemetry/contract.ts';

export const policies = [
  { name: 'Dynamic A* + reservations', replan: true, reservations: true },
  { name: 'Static A* + reservations', replan: false, reservations: true },
  { name: 'Dynamic A*', replan: true, reservations: false },
];

export type Result = Metrics & { policy: string; seconds: number; successRate: number; completedAt: number | null };

export function benchmark(): Result[] {
  return policies.map(({ name, ...options }) => {
    const engine = new Warehouse(options);
    engine.command({ type: 'scenario' });
    for (let i = 0; i < 50 / DT; i++) engine.step();
    const frame = engine.snapshot();
    return {
      policy: name, seconds: frame.time, successRate: frame.metrics.delivered / frame.robots.length, ...frame.metrics,
      completedAt: frame.metrics.delivered === frame.robots.length ? frame.events.filter(e => e.kind === 'delivery').at(-1)!.time : null,
    };
  });
}

export function csv(results: Result[]) {
  if (!results.length) return '';
  const keys = Object.keys(results[0]) as (keyof Result)[];
  return [keys.join(','), ...results.map(row => keys.map(key => JSON.stringify(row[key] ?? '')).join(','))].join('\n') + '\n';
}
