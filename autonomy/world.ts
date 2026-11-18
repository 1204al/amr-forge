import scenario from '../scenarios/warehouse.json' with { type: 'json' };
import type { Obstacle } from '../telemetry/contract.ts';

export const { bounds, destinations } = scenario;
export const ROBOT_RADIUS = 0.45;
export const CLEARANCE = ROBOT_RADIUS + 0.19;
export const RACKS: Obstacle[] = scenario.racks.rows.flatMap((y, row) =>
  scenario.racks.columns.map((x, col) => ({
    id: `rack-${row}-${col}`, kind: 'rack', x, y, w: scenario.racks.width, h: scenario.racks.depth,
  })),
);
export const WALLS: Obstacle[] = [
  { id: 'north', kind: 'wall', x: 0, y: -8.1, w: 24.4, h: 0.2 },
  { id: 'south', kind: 'wall', x: 0, y: 8.1, w: 24.4, h: 0.2 },
  { id: 'west', kind: 'wall', x: -12.1, y: 0, w: 0.2, h: 16 },
  { id: 'east', kind: 'wall', x: 12.1, y: 0, w: 0.2, h: 16 },
];
export const FIXED = [...RACKS, ...WALLS];
export const FLEET = scenario.robots;
export const FORKLIFT: Obstacle = { ...scenario.forklift, kind: 'forklift' };
export const SCENARIO_ID = scenario.id;
