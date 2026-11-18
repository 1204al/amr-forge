import type { Ack, Command, Entry, EventKind, Frame, Job, Metrics, Obstacle, Point, Robot, Sensors } from '../telemetry/contract.ts';
import { BRAKE, drive, DT, integrate, scan, SPEED } from './control.ts';
import { distance, lerp, rangeToBox, routeLength, segmentHits, sweptDistance } from './geometry.ts';
import { plan } from './planning.ts';
import { bounds, CLEARANCE, destinations, FIXED, FLEET, FORKLIFT, ROBOT_RADIUS, SCENARIO_ID } from './world.ts';

type Unit = Robot & { routeStart: number; stoppedAt?: number; waitTicks: number };
export type Observations = { id: string; pose: Robot['pose']; speed: number; angular: number; sensor: Sensors | null }[];
const destinationPoint = (id: string) => destinations.find(d => d.id === id)?.point;
const asObstacle = (r: Robot): Obstacle => ({ ...r.pose, id: r.id, kind: 'barrier', w: ROBOT_RADIUS * 2, h: ROBOT_RADIUS * 2 });
const success = (message: string): Ack => ({ ok: true, message });
const failure = (message: string): Ack => ({ ok: false, message });

function predicted(robot: Robot, meters: number): Point {
  let previous: Point = robot.pose;
  for (const next of robot.route) {
    const length = distance(previous, next);
    if (meters < length) return lerp(previous, next, meters / length);
    meters -= length;
    previous = next;
  }
  return previous;
}

export class Warehouse {
  private tick = 0;
  private running = false;
  private drill = false;
  private sequence = 1043;
  private obstacles: Obstacle[] = [];
  private observed = new Set<string>();
  private events: Entry[] = [];
  private queue: Job[] = [];
  private contacts = new Set<string>();
  private units: Unit[] = [];
  private metrics: Metrics = { distance: 0, delivered: 0, stops: 0, replans: 0, collisions: 0, trafficWaits: 0, minClearance: null, throughput: 0 };

  private readonly options: { replan: boolean; reservations: boolean };
  private readonly source: Frame['source'];

  constructor(options = { replan: true, reservations: true }, source: Frame['source'] = 'local') {
    this.options = options;
    this.source = source;
    this.reset();
  }

  private get time() { return this.tick * DT; }

  private event(kind: EventKind, title: string, detail: string, robot?: Unit) {
    this.events.push({ id: this.events.length + 1, time: this.time, kind, title, detail, robotId: robot?.id });
    if (robot) robot.lastEvent = title;
  }

  private reset() {
    this.tick = 0;
    this.running = this.drill = false;
    this.sequence = 1043;
    this.events = [];
    this.queue = [];
    this.contacts.clear();
    this.obstacles = [...FIXED];
    this.observed.clear();
    this.metrics = { distance: 0, delivered: 0, stops: 0, replans: 0, collisions: 0, trafficWaits: 0, minClearance: null, throughput: 0 };
    this.event('system', 'Warehouse ready', 'Occupancy map loaded. Fleet standing by.');
    this.units = FLEET.map(seed => {
      const unit: Unit = {
        id: seed.id, pose: { ...seed.pose }, speed: 0, angular: 0, status: 'idle', job: null,
        route: [], previousRoute: [], progress: 0, distance: 0, lastEvent: '', sensor: null, routeStart: 0, waitTicks: 0,
      };
      this.assign(unit, { id: seed.job, destination: seed.destination, priority: seed.priority });
      if (this.source === 'local') unit.sensor = scan(unit, FIXED, 0);
      return unit;
    });
  }

  private assign(unit: Unit, job: Job) {
    const goal = destinationPoint(job.destination);
    const route = goal && plan(unit.pose, goal, this.map());
    if (!route) return false;
    unit.job = job;
    unit.route = route;
    unit.previousRoute = [];
    unit.routeStart = routeLength(unit.pose, route);
    unit.progress = 0;
    unit.stoppedAt = undefined;
    unit.waitTicks = 0;
    unit.status = this.running ? 'driving' : 'ready';
    this.event('mission', 'Delivery assigned', `${job.id} → ${job.destination} · priority ${job.priority}`, unit);
    return true;
  }

  private map() {
    return this.obstacles.filter(o => o.kind === 'rack' || o.kind === 'wall' || this.observed.has(o.id));
  }

  private addObstacle(o: Obstacle): Ack {
    if (!Number.isFinite(o.x) || !Number.isFinite(o.y)
      || Math.abs(o.x) + o.w / 2 >= bounds.x || Math.abs(o.y) + o.h / 2 >= bounds.y
      || this.obstacles.some(other => Math.abs(o.x - other.x) < (o.w + other.w) / 2 &&
        Math.abs(o.y - other.y) < (o.h + other.h) / 2)
      || this.units.some(robot => rangeToBox(robot.pose, o) < CLEARANCE + robot.speed ** 2 / (2 * BRAKE))) {
      return failure('Choose a clear floor area away from the fleet.');
    }
    this.obstacles.push(o);
    this.event('incident', o.kind === 'forklift' ? 'Forklift entered Aisle 02' : 'Floor barrier placed',
      `Obstacle added at X ${o.x.toFixed(1)} m, Y ${o.y.toFixed(1)} m.`);
    return success('Obstacle placed.');
  }

  command(action: Command): Ack {
    switch (action.type) {
      case 'reset':
        this.reset();
        return success('Warehouse reset.');
      case 'scenario':
        this.reset();
        this.drill = true;
        return this.command({ type: 'start' });
      case 'start':
        if (!this.running) {
          this.running = true;
          for (const unit of this.units) if (unit.status === 'ready') unit.status = 'driving';
          this.event('system', this.tick === 0 ? 'Mission clock started' : 'Simulation resumed', 'Fixed-step autonomy active.');
        }
        return success('Simulation running.');
      case 'pause':
        if (this.running) {
          this.running = false;
          this.event('system', 'Simulation paused', 'Simulation clock held.');
        }
        return success('Simulation paused.');
      case 'incident':
        if (this.obstacles.some(o => o.id === FORKLIFT.id)) return failure('Forklift is already in Aisle 02.');
        return this.addObstacle({ ...FORKLIFT });
      case 'obstacle':
        return this.addObstacle({ ...action.point, w: 0.68, h: 0.68, kind: 'barrier', id: `barrier-${this.events.length}` });
      case 'destination':
      case 'delivery': {
        if (!destinationPoint(action.destination) || ![1, 2, 3].includes(action.priority)) return failure('Invalid delivery destination or priority.');
        const job = { id: `DLV-${this.sequence + 1}`, destination: action.destination, priority: action.priority };
        if (action.type === 'destination') {
          const unit = this.units.find(r => action.robotId === r.id);
          if (!unit || !this.assign(unit, job)) return failure('No valid route for the selected robot.');
        } else {
          this.queue.push(job);
          this.queue.sort((a, b) => b.priority - a.priority);
          this.event('mission', 'Delivery queued', `${job.id} → ${job.destination} · priority ${job.priority}`);
        }
        this.sequence++;
        return success(`${job.id} accepted.`);
      }
    }
  }

  private detect(unit: Unit) {
    if (!unit.sensor) return;
    for (const ray of unit.sensor.rays) {
      const id = ray.obstacleId;
      if (!id || this.observed.has(id)) continue;
      const obstacle = this.obstacles.find(o => o.id === id);
      if (obstacle?.kind === 'forklift' || obstacle?.kind === 'barrier') {
        this.observed.add(id);
        this.event('detection', 'New obstacle detected', `${obstacle.kind === 'forklift' ? 'Forklift' : 'Barrier'} return at ${ray.distance.toFixed(2)} m.`, unit);
      }
    }
  }

  private navigate(unit: Unit) {
    if (unit.status === 'delivered' || unit.status === 'idle') return;
    const next = unit.route[0];
    if (unit.status === 'braking') {
      if (Math.abs(unit.speed) <= 0.025) {
        this.metrics.stops++;
        unit.status = 'stopped';
        unit.stoppedAt = this.tick;
        this.event('stop', 'Safety stop', 'Robot stopped before reaching the occupied segment.', unit);
      }
      return;
    }
    if (unit.status === 'stopped') {
      if (this.tick - (unit.stoppedAt ?? this.tick) < 12) return;
      const goal = unit.job && destinationPoint(unit.job.destination);
      const route = this.options.replan && goal && plan(unit.pose, goal, this.map());
      if (!route) {
        unit.status = 'blocked';
        this.event('blocked', 'Delivery held', this.options.replan ? 'No clear route to the destination.' : 'Static planner policy holds at the obstruction.', unit);
        return;
      }
      unit.previousRoute = [unit.pose, ...unit.route];
      unit.route = route;
      unit.routeStart = routeLength(unit.pose, route);
      unit.progress = 0;
      unit.status = 'driving';
      this.metrics.replans++;
      this.event('replan', 'Alternate route found', `${route.length} waypoints · ${unit.routeStart.toFixed(1)} m remaining.`, unit);
      this.event('resume', 'Motion authorized', 'The alternate route clears the shared occupancy map.', unit);
      return;
    }
    if (unit.status === 'blocked') return;
    const obstacle = next && this.map().find(o => o.kind !== 'rack' && o.kind !== 'wall' && segmentHits(unit.pose, next, o, CLEARANCE));
    if (obstacle) {
      unit.status = 'braking';
      this.event('braking', 'Path obstructed', 'Active segment invalidated. Applying controlled braking.', unit);
      return;
    }
    if (next && distance(unit.pose, next) <= (unit.route.length === 1 ? 0.18 : 0.14) && Math.abs(unit.speed) < 0.38) {
      unit.route.shift();
      if (!unit.route.length) {
        unit.status = 'delivered';
        unit.progress = 1;
        this.metrics.delivered++;
        this.event('delivery', 'Delivery completed', `${unit.job?.id} at ${unit.job?.destination} · ${unit.distance.toFixed(1)} m lifetime travel.`, unit);
      }
    }
    if (unit.route.length && unit.routeStart > 0) {
      unit.progress = Math.max(unit.progress, 1 - routeLength(unit.pose, unit.route) / unit.routeStart);
    }
  }

  private coordinate(order: Unit[]) {
    for (const [index, unit] of order.entries()) {
      if (unit.status !== 'driving' && unit.status !== 'yielding') continue;
      const conflict = order.find((other, otherIndex) => {
        if (other === unit) return false;
        for (const horizon of [0.35, 0.7, 1.05, 1.4, 1.75]) {
          const candidate = predicted(unit, SPEED * horizon);
          const reserves = otherIndex < index && other.status === 'driving';
          const occupied = reserves ? predicted(other, SPEED * horizon) : other.pose;
          if (distance(candidate, occupied) < ROBOT_RADIUS * 2 + 0.36) return true;
        }
        return false;
      });
      if (conflict) {
        if (unit.status !== 'yielding') {
          unit.status = 'yielding';
          this.metrics.trafficWaits++;
          this.event('traffic', 'Traffic hold', `Yielding to ${conflict.id} at overlapping corridor reservations.`, unit);
        }
        unit.waitTicks++;
        if (unit.waitTicks > 75 && unit.waitTicks % 30 === 16 && Math.abs(unit.speed) < 0.03) {
          const goal = unit.job && destinationPoint(unit.job.destination);
          const detour = goal && plan(unit.pose, goal, [...this.map(), asObstacle(conflict)]);
          if (detour) {
            unit.previousRoute = [unit.pose, ...unit.route];
            unit.route = detour;
            unit.routeStart = routeLength(unit.pose, detour);
            unit.progress = 0;
            unit.waitTicks = 0;
            this.metrics.replans++;
            this.event('replan', 'Traffic detour planned', `Routing around occupancy held by ${conflict.id}.`, unit);
          }
        }
      } else if (unit.status === 'yielding') {
        unit.status = 'driving';
        unit.waitTicks = 0;
        this.event('resume', 'Reservation cleared', 'Corridor available. Delivery resumed.', unit);
      }
    }
  }

  observe(observations: Observations, trackDistance: boolean) {
    for (const unit of this.units) {
      const sample = observations.find(o => o.id === unit.id);
      if (!sample) continue;
      if (trackDistance) unit.distance += distance(sample.pose, unit.pose);
      Object.assign(unit, sample);
    }
  }

  step(observations?: Observations) {
    if (!this.running) return [];
    this.tick++;
    if (this.drill && this.tick === 150) this.command({ type: 'incident' });
    if (observations) this.observe(observations, true);
    for (const unit of this.units) {
      if (!observations && this.tick % 3 === 0) {
        unit.sensor = scan(unit, [...this.obstacles, ...this.units.filter(other => other !== unit).map(asObstacle)], this.time);
      }
      this.detect(unit);
    }
    for (const unit of this.units) {
      if (['idle', 'delivered'].includes(unit.status) && Math.abs(unit.speed) < 0.04) {
        const index = this.queue.findIndex(job => this.assign(unit, job));
        if (index >= 0) this.queue.splice(index, 1);
      }
      this.navigate(unit);
    }
    const order = [...this.units].sort((a, b) => (b.job?.priority ?? 0) - (a.job?.priority ?? 0) || a.id.localeCompare(b.id));
    if (this.options.reservations) this.coordinate(order);

    const candidates = order.map(unit => {
      const velocity = drive(unit, unit.status === 'driving' ? unit.route[0] : undefined);
      return { unit, velocity, next: observations ? unit.pose : integrate(unit.pose, velocity.speed, velocity.angular), contact: false };
    });

    const contacts = new Set<string>();
    const measure = (clearance: number, key: string) => {
      this.metrics.minClearance = Math.min(this.metrics.minClearance ?? Infinity, Math.max(0, clearance));
      if (clearance <= 0) contacts.add(key);
    };
    for (const candidate of candidates) {
      const { unit, next } = candidate;
      for (const o of this.obstacles) {
        measure(rangeToBox(next, o) - ROBOT_RADIUS, `${unit.id}/${o.id}`);
        if (segmentHits(unit.pose, next, o, ROBOT_RADIUS)) candidate.contact = true;
      }
    }
    const [a, b] = candidates;
    if (a && b) {
      const clearance = sweptDistance(a.unit.pose, a.contact ? a.unit.pose : a.next, b.unit.pose, b.contact ? b.unit.pose : b.next) - ROBOT_RADIUS * 2;
      measure(clearance, `${a.unit.id}/${b.unit.id}`);
      if (clearance <= 0) a.contact = b.contact = true;
    }
    for (const key of contacts) if (!this.contacts.has(key)) {
      this.metrics.collisions++;
      this.event('collision', 'Contact threshold reached', key);
    }
    this.contacts = contacts;
    if (!observations) for (const { unit, velocity, next, contact } of candidates) {
      if (!contact) {
        unit.distance += distance(unit.pose, next);
        unit.pose = next;
      }
      unit.speed = contact ? 0 : velocity.speed;
      unit.angular = velocity.angular;
    }
    this.metrics.distance = this.units.reduce((total, unit) => total + unit.distance, 0);
    this.metrics.throughput = this.metrics.delivered * 60 / this.time;
    return candidates.map(({ unit, velocity, contact }) => ({ id: unit.id, speed: contact ? 0 : velocity.speed, angular: velocity.angular }));
  }

  snapshot(): Frame {
    return {
      version: 1, source: this.source, scenario: SCENARIO_ID, coordinates: 'world-xy-m-rad',
      time: this.time, running: this.running,
      robots: this.units.map(({ routeStart: _routeStart, stoppedAt: _stoppedAt, waitTicks: _waitTicks, ...unit }) => ({ ...unit, route: [...unit.route] })),
      obstacles: [...this.obstacles], observed: [...this.observed], events: [...this.events], queue: [...this.queue], metrics: { ...this.metrics },
    };
  }
}
