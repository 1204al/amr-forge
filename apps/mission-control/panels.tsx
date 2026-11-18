import {
  Activity, ArrowDownToLine, ArrowUpRight, Box, CheckCircle2, ChevronRight, CircleDot, Clock3, Crosshair, GitBranch,
  Navigation, Radar, Route, ShieldAlert, Timer, Truck, Warehouse as WarehouseIcon, Zap,
} from 'lucide-react';
import { FLEET, bounds, destinations } from '../../autonomy/world';
import type { Entry, Frame, Robot } from '../../telemetry/contract';
import { benchmark, csv } from '../../benchmarks/model';
import type { Result } from '../../benchmarks/model';
import { useState } from 'react';

export function clock(seconds: number, precise = false) {
  const hundredths = Math.floor(seconds * 100 + 1e-6);
  const minutes = String(Math.floor(hundredths / 6000)).padStart(2, '0');
  const secs = String(Math.floor(hundredths / 100) % 60).padStart(2, '0');
  return `${minutes}:${secs}${precise ? '.' + String(hundredths % 100).padStart(2, '0') : ''}`;
}

export function save(name: string, data: string, type = 'application/json') {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 3000);
}

const statuses: Record<Robot['status'], string> = {
  ready: 'Ready', driving: 'Navigating', braking: 'Braking', stopped: 'Safety stop',
  yielding: 'Yielding', blocked: 'Blocked', delivered: 'Delivered', idle: 'Idle',
};

export function FleetPanel({ frame, selected, select, showLidar, showPaths }: {
  frame: Frame; selected: string; select: (id: string) => void; showLidar: boolean; showPaths: boolean;
}) {
  const robot = frame.robots.find(r => r.id === selected);
  const lastEvent = frame.events.findLast(e => e.robotId === selected);
  return <aside className="side-panel panel">
    <div className="panel-header fleet-heading"><span className="panel-glyph"><Truck size={16} /></span><h2>Fleet status</h2><span className="tag">{frame.robots.length} UNITS</span></div>
    <div className="fleet-list">
      {frame.robots.map(r => {
        const unit = FLEET.find(seed => seed.id === r.id);
        return <button key={r.id} onClick={() => select(r.id)} className={`fleet-card ${selected === r.id ? 'selected' : ''}`} aria-pressed={selected === r.id}>
          <div className="robot-top">
            <span className="robot-icon" style={{ color: unit?.color }}><Box size={16} strokeWidth={1.8} /></span>
            <span className="robot-id">{r.id}<small>{unit?.name}</small></span>
            <span className={`status-pill ${r.status}`}><i />{statuses[r.status]}</span>
            <ChevronRight className="robot-chevron" size={14} />
          </div>
          <div className="robot-values"><span>{r.job?.id ?? 'Unassigned'} <ChevronRight size={11} /> <b>{r.job?.destination ?? '—'}</b></span><span><b>{r.speed.toFixed(2)}</b> m/s</span></div>
          <div className="progress" aria-label="Route progress" role="progressbar" aria-valuenow={Math.round(r.progress * 100)} style={{ color: unit?.color }}><i style={{ width: `${Math.min(100, Math.max(0, r.progress * 100))}%` }} /></div>
        </button>;
      })}
    </div>
    {robot && lastEvent && <div className="decision">
      <span><Navigation size={13} /> {destinations.find(d => d.id === robot.job?.destination)?.label ?? 'No destination'}</span>
      <strong>{lastEvent.title}</strong>
      <p>{lastEvent.detail}</p>
    </div>}
    <div className="perception">
      <div className="panel-header"><span className="panel-glyph"><Crosshair size={16} /></span><h2>Perception</h2><span className="tag">{robot?.id ?? '—'}</span></div>
      <div className="mini-map"><Occupancy frame={frame} selected={selected} showLidar={showLidar} showPaths={showPaths} /></div>
      <div className="sensor-label"><Radar size={13} /><span>{frame.source === 'local' ? 'Geometric LiDAR — Local Simulation' : 'RTX LiDAR — Isaac Sim'}</span></div>
      {robot && <div className="pose"><span>X <b>{robot.pose.x.toFixed(2)}</b></span><span>Y <b>{robot.pose.y.toFixed(2)}</b></span><span>HDG <b>{Math.round(robot.pose.heading * 180 / Math.PI)}°</b></span></div>}
    </div>
  </aside>;
}

function Occupancy({ frame, selected, showLidar, showPaths }: { frame: Frame; selected: string; showLidar: boolean; showPaths: boolean }) {
  const robot = frame.robots.find(r => r.id === selected);
  const sensor = robot?.sensor;
  const sensorColor = FLEET.find(r => r.id === selected)?.color ?? '#70e4ff';
  return <svg role="img" aria-label="Top-down occupancy map with robot paths and sensor observations" viewBox="-12.55 -8.5 25.1 17">
    <defs><pattern id="map-grid" width="1" height="1" patternUnits="userSpaceOnUse"><path d="M1 0H0V1" fill="none" stroke="#24303a" strokeWidth=".045" /></pattern></defs>
    <rect x={-bounds.x} y={-bounds.y} width={bounds.x * 2} height={bounds.y * 2} fill="url(#map-grid)" stroke="#34434d" strokeWidth=".07" />
    {frame.obstacles.filter(o => o.kind === 'rack' || frame.observed.includes(o.id)).map(o => <rect key={o.id}
      x={o.x - o.w / 2} y={o.y - o.h / 2} width={o.w} height={o.h} fill={o.kind === 'rack' ? '#34424e' : '#9d5a41'}
      stroke={o.kind === 'rack' ? '#526676' : '#fd9c75'} strokeWidth=".055" rx=".08" />)}
    {showLidar && sensor?.rays.filter((_, i) => i % 3 === 0).map((ray, i) => {
      const angle = sensor.pose.heading + ray.angle;
      const x = sensor.pose.x + Math.cos(angle) * ray.distance;
      const y = sensor.pose.y + Math.sin(angle) * ray.distance;
      return <g key={i}><path d={`M${sensor.pose.x},${sensor.pose.y} L${x},${y}`} stroke={sensorColor} opacity=".24" strokeWidth=".046" />
        {ray.obstacleId && <circle cx={x} cy={y} r=".075" fill={sensorColor} opacity=".64" />}</g>;
    })}
    {showLidar && sensor?.worldPoints?.filter((_, i) => i % 4 === 0).map(([x, y], i) =>
      <circle key={i} cx={x} cy={y} r=".055" fill={sensorColor} opacity=".6" />)}
    {frame.robots.map(r => {
      const color = FLEET.find(seed => seed.id === r.id)?.color ?? '#9ce9fc';
      return <g key={r.id}>
        {showPaths && <polyline points={[r.pose, ...r.route].map(p => `${p.x},${p.y}`).join(' ')} fill="none" stroke={color} strokeWidth=".09" opacity=".8" strokeDasharray=".22 .16" />}
        <circle cx={r.pose.x} cy={r.pose.y} r={r.id === selected ? '.34' : '.25'} fill={color} />
        <path d={`M${r.pose.x},${r.pose.y} l${Math.cos(r.pose.heading) * .65},${Math.sin(r.pose.heading) * .65}`} stroke={color} strokeWidth=".12" />
      </g>;
    })}
  </svg>;
}

const eventIcons = {
  system: WarehouseIcon, mission: Box, incident: ShieldAlert, detection: Radar, braking: ShieldAlert, stop: ShieldAlert,
  replan: GitBranch, resume: Navigation, traffic: CircleDot, delivery: CheckCircle2, blocked: ShieldAlert, collision: ShieldAlert,
};

export function Timeline({ events, all = false }: { events: Entry[]; all?: boolean }) {
  const shown = [...events].reverse().slice(0, all ? events.length : 4);
  return <section className="panel timeline">
    <div className="panel-header"><span className="panel-glyph"><Activity size={16} /></span><h2>Incident timeline</h2><span className="tag">{events.length} EVENTS</span></div>
    <div className={all ? 'event-list expanded-events' : 'event-list'}>{shown.map(e => {
      const Icon = eventIcons[e.kind] ?? Activity;
      return <div className="event-row" key={e.id}>
        <time>{clock(e.time, true)}</time><span className={`event-icon ${e.kind}`}><Icon size={13} /></span>
        <div><strong>{e.title}</strong><p>{e.robotId && <span className="event-id">{e.robotId} · </span>}{e.detail}</p></div>
      </div>;
    })}</div>
  </section>;
}

export function Operations({ frame }: { frame: Frame }) {
  const { metrics } = frame;
  const tiles = [
    { name: 'DELIVERIES', value: String(metrics.delivered), unit: 'complete', Icon: Box },
    { name: 'FLEET DISTANCE', value: metrics.distance.toFixed(1), unit: 'm', Icon: Route },
    { name: 'SAFETY STOPS', value: String(metrics.stops), unit: '', Icon: ShieldAlert },
    { name: 'REPLANS', value: String(metrics.replans), unit: '', Icon: GitBranch },
    { name: 'CONTACTS', value: String(metrics.collisions), unit: '', Icon: CircleDot },
    { name: 'THROUGHPUT', value: metrics.throughput.toFixed(1), unit: 'jobs/min', Icon: Timer },
  ];
  return <section className="panel operations">
    <div className="panel-header"><span className="panel-glyph"><Zap size={16} /></span><h2>Operations metrics</h2><span className="tag">SIM TIME</span></div>
    <div className="metric-grid">{tiles.map(({ name, value, unit, Icon }) => <div className="metric" key={name}>
      <div><Icon size={13} /><span>{name}</span></div><strong>{value}</strong>{unit && <small> {unit}</small>}
    </div>)}</div>
    <div className="clearance"><span><Crosshair size={13} /> Minimum measured clearance</span><b>{metrics.minClearance === null ? '—' : `${metrics.minClearance.toFixed(2)} m`}</b></div>
  </section>;
}

export function Benchmarks() {
  const [results, setResults] = useState<Result[]>([]);
  const [running, setRunning] = useState(false);
  const run = () => {
    setRunning(true);
    requestAnimationFrame(() => setTimeout(() => { setResults(benchmark()); setRunning(false); }, 20));
  };
  return <section className="panel benchmark-panel">
    <div className="panel-header"><span className="panel-glyph"><Activity size={17} /></span><h2>Incident benchmark</h2><span className="tag">LOCAL SIMULATION</span></div>
    <div className="benchmark-body">
      <p>Each policy runs the same two deliveries and forklift obstruction over 50 seconds of simulation time.</p>
      <div className="flex flex-wrap gap-2">
        <button className="button primary" onClick={run} disabled={running}><Zap size={15} />{running ? 'Running…' : 'Run benchmark'}</button>
        {results.length > 0 && <>
          <button className="button" onClick={() => save('amr-forge-benchmark.json', JSON.stringify({ source: 'local', results }, null, 2))}><ArrowDownToLine size={15} />JSON</button>
          <button className="button" onClick={() => save('amr-forge-benchmark.csv', csv(results), 'text/csv')}><ArrowDownToLine size={15} />CSV</button>
        </>}
      </div>
      {!!results.length && <>
        <div className="scorecards">{results.map(result => <div className="score" key={result.policy}>
          <span>{result.policy}</span><strong>{result.successRate * 100}<small>%</small></strong>
          <div className="progress"><i style={{ width: `${result.successRate * 100}%` }} /></div>
          <span>{result.delivered} / 2 deliveries</span>
        </div>)}</div>
        <div className="table-scroll"><table>
          <thead><tr>{['Policy', 'Time to finish', 'Distance', 'Contacts', 'Stops', 'Replans', 'Holds', 'Jobs/min', 'Min. clearance'].map(x => <th key={x}>{x}</th>)}</tr></thead>
          <tbody>{results.map(r => <tr key={r.policy}><th>{r.policy}</th><td>{r.completedAt?.toFixed(2) ?? '—'}{r.completedAt !== null && ' s'}</td>
            <td>{r.distance.toFixed(2)} m</td><td>{r.collisions}</td><td>{r.stops}</td><td>{r.replans}</td><td>{r.trafficWaits}</td><td>{r.throughput.toFixed(2)}</td><td>{r.minClearance?.toFixed(2) ?? '—'} m</td></tr>)}</tbody>
        </table></div>
      </>}
      <div className="benchmark-note"><Clock3 size={14} /> Fixed step · 30 Hz <ArrowUpRight size={13} /> Common starting poses and incident time</div>
    </div>
  </section>;
}
