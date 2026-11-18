import * as Dialog from '@radix-ui/react-dialog';
import {
  Activity, ArrowDownToLine, ArrowUpRight, Aperture, Box, ChevronDown, CirclePlay, Clapperboard, Crosshair,
  Expand, Gauge, Layers3, Maximize2, Pause, Play, Plus, Radar, RotateCcw, ScanLine, ShieldAlert, X,
} from 'lucide-react';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { ChangeEvent, ReactNode } from 'react';
import { destinations } from '../../autonomy/world';
import { LiveBackend, LocalBackend, ReplayBackend } from '../../telemetry/backends';
import type { Command, Frame, Point, Recording } from '../../telemetry/contract';
import { decodeRecording } from '../../telemetry/recordings';
import { Benchmarks, clock, FleetPanel, Operations, save, Timeline } from './panels';
import { cameras, WarehouseScene } from './warehouse';
import type { Camera } from './warehouse';

type Tab = 'Operations' | 'Replay' | 'Benchmarks';
const modeLabels = { local: 'Local Simulation', isaac: 'Live Isaac Sim' } as const;
const nil = () => null;
const noSubscribe = () => () => {};

function Modal({ open, close, title, description, children }: {
  open: boolean; close: () => void; title: string; description: string; children: ReactNode;
}) {
  return <Dialog.Root open={open} onOpenChange={value => { if (!value) close(); }}>
    <Dialog.Portal>
      <Dialog.Overlay className="dialog-overlay" />
      <Dialog.Content className="dialog">
        <Dialog.Title>{title}</Dialog.Title><Dialog.Description>{description}</Dialog.Description>
        <Dialog.Close asChild><button className="icon-button dialog-close" aria-label="Close dialog"><X size={18} /></button></Dialog.Close>
        {children}
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>;
}

export function App() {
  const [local] = useState(() => new LocalBackend());
  const [live] = useState(() => new LiveBackend());
  const [mode, setMode] = useState<keyof typeof modeLabels>('local');
  const [tab, setTab] = useState<Tab>('Operations');
  const [replay, setReplay] = useState<ReplayBackend | null>(null);
  const [verifiedReplay, setVerifiedReplay] = useState<ReplayBackend | null>(null);
  const [playing, setPlaying] = useState(false);
  const [cursor, setCursor] = useState(0);
  const [rate, setRate] = useState(1);
  const [selected, setSelected] = useState('AMR-01');
  const [camera, setCamera] = useState<Camera>('Orbit');
  const [showLidar, setShowLidar] = useState(true);
  const [showPaths, setShowPaths] = useState(true);
  const [placing, setPlacing] = useState(false);
  const [message, setMessage] = useState<{ text: string; bad: boolean } | null>(null);
  const [modal, setModal] = useState<'job' | 'export' | null>(null);
  const [destination, setDestination] = useState('D04');
  const [priority, setPriority] = useState(2);
  const [immersive, setImmersive] = useState(false);
  const [busy, setBusy] = useState(false);
  const replaying = tab === 'Replay';
  const backend = replaying ? replay : mode === 'local' ? local : live;
  const frame = useSyncExternalStore(backend?.subscribe ?? noSubscribe, backend?.snapshot ?? nil);
  const input = useRef<HTMLInputElement>(null);
  const start = replay?.recording.frames[0].time ?? 0;
  const end = replay?.recording.frames.at(-1)?.time ?? 0;

  useEffect(() => { local.startClock(); return () => local.dispose(); }, [local]);
  useEffect(() => {
    if (mode !== 'isaac') return;
    live.connect();
    return () => live.dispose();
  }, [live, mode]);
  useEffect(() => {
    if (!message) return;
    const handle = setTimeout(() => setMessage(null), 4000);
    return () => clearTimeout(handle);
  }, [message]);
  useEffect(() => {
    if (!replay || !playing) return;
    let id = 0;
    let previous = performance.now();
    let position = replay.snapshot().time;
    const update = (now: number) => {
      position = Math.min(end, position + Math.min(.12, (now - previous) / 1000) * rate);
      previous = now;
      replay.seek(position);
      setCursor(position);
      if (position < end) id = requestAnimationFrame(update);
      else setPlaying(false);
    };
    id = requestAnimationFrame(update);
    return () => cancelAnimationFrame(id);
  }, [playing, rate, replay, end]);
  useEffect(() => {
    if (!immersive && !placing) return;
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { setImmersive(false); setPlacing(false); } };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [immersive, placing]);

  function chooseTab(next: Tab) {
    setTab(next);
    setPlaying(false);
    setPlacing(false);
    setImmersive(false);
  }
  async function send(action: Command) {
    if (!backend || replaying || busy) return false;
    setBusy(true);
    const ack = await backend.command(action);
    setBusy(false);
    if (!ack.ok || ['incident', 'destination', 'delivery', 'obstacle'].includes(action.type)) {
      setMessage({ text: ack.message, bad: !ack.ok });
    }
    return ack.ok;
  }

  function openReplay(recording: Recording) {
    const adapter = new ReplayBackend(recording);
    if (recording.source === 'isaac') setVerifiedReplay(adapter);
    setReplay(adapter);
    setCursor(adapter.snapshot().time);
    setModal(null);
    chooseTab('Replay');
  }

  async function importFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    try {
      if (file.size > 128 * 1024 * 1024) throw new Error('Recording exceeds the 128 MB import limit.');
      openReplay(decodeRecording(JSON.parse(await file.text())));
    } catch (error) {
      setMessage({ text: error instanceof Error ? error.message : 'Unable to open this recording.', bad: true });
    }
  }

  async function place(point: Point) {
    if (await send({ type: 'obstacle', point })) setPlacing(false);
  }

  function reset() {
    setPlacing(false);
    setCamera('Orbit');
    setSelected('AMR-01');
    void send({ type: 'reset' });
  }

  async function assign(type: 'destination' | 'delivery') {
    if (await send({ type, destination, robotId: selected, priority })) setModal(null);
  }

  function exportFrame(frame: Frame) {
    save(`amr-forge-${frame.source}-results.json`, JSON.stringify(frame, null, 2));
  }

  const shownMode = replaying && frame ? frame.source === 'local' ? 'Local Simulation Replay' : 'Recorded Isaac Sim' : modeLabels[mode];
  const title = tab === 'Replay' ? 'Experiment Replay' : tab === 'Benchmarks' ? 'Navigation Benchmarks' : 'Warehouse Under Pressure';
  const description = tab === 'Replay'
    ? 'Scrub synchronized poses, perception frames, and decisions.'
    : tab === 'Benchmarks' ? 'Compare navigation policies under the same recorded scenario inputs.'
    : 'Coordinate autonomous deliveries and test how the fleet responds to an aisle obstruction.';

  return <>
    <input className="hidden" type="file" ref={input} accept=".json,application/json" onChange={e => void importFile(e)} aria-label="Import recording file" />
    <header className="topbar">
      <div className="topbar-inner">
        <button className="brand" onClick={() => chooseTab('Operations')} aria-label="AMR Forge operations">
          <span className="brand-icon"><Aperture size={22} strokeWidth={2.15} /></span><span>AMR<span className="brand-accent">FORGE</span><small>MISSION CONTROL</small></span>
        </button>
        <nav aria-label="Main navigation">
          {([{ name: 'Operations', Icon: Layers3 }, { name: 'Replay', Icon: Clapperboard }, { name: 'Benchmarks', Icon: Gauge }] as const).map(({ name, Icon }) =>
            <button key={name} onClick={() => chooseTab(name)} className={tab === name ? 'active' : ''} aria-current={tab === name ? 'page' : undefined}>
              <Icon size={15} /><span>{name}</span>
            </button>)}
        </nav>
        <div className="mode-select">
          <i className={mode === 'isaac' && tab === 'Operations' && !frame ? 'offline' : ''} />
          <select aria-label="Execution mode" value={mode} onChange={e => { setMode(e.target.value as keyof typeof modeLabels); chooseTab('Operations'); }}>
            <option value="local">Local Simulation</option><option value="isaac">Live Isaac Sim</option>
          </select>
          <ChevronDown size={12} />
        </div>
      </div>
    </header>
    <main className="page">
      <div className="page-heading">
        <div>
          <p className="kicker"><span className="kicker-mark" />{tab === 'Operations' ? 'SCENARIO 01 / WAREHOUSE OPERATIONS' : tab === 'Replay' ? 'SESSION ANALYSIS' : 'POLICY EVALUATION'}</p>
          <h1>{title}</h1><p className="lede">{description}</p>
        </div>
        {tab === 'Operations' && <div className="heading-actions">
          <button className="button" onClick={() => setModal('export')} disabled={!frame}><ArrowDownToLine size={16} />Export</button>
          <button className="button incident-button" disabled={busy || !frame || frame.obstacles.some(o => o.kind === 'forklift')} onClick={() => void send({ type: 'incident' })}>
            <ShieldAlert size={17} />Inject incident
          </button>
        </div>}
        {tab === 'Replay' && <div className="heading-actions">
          <button className="button" onClick={() => openReplay(local.recording())}><CirclePlay size={16} />Replay local run</button>
          <button className="button primary" onClick={() => input.current?.click()}><Plus size={16} />Import recording</button>
        </div>}
      </div>

      {tab === 'Benchmarks' ? <Benchmarks /> : frame ? <>
        <div className={`workspace ${immersive ? 'immersive' : ''}`}>
          <section className="panel viewport">
            <div className="panel-header viewport-header">
              <span className="panel-glyph"><ScanLine size={17} /></span><h2>Warehouse twin</h2>
              <span className={`viewport-state ${frame.running && !replaying ? 'running' : ''}`}><i />{replaying ? 'REPLAY' : frame.running ? 'RUNNING' : frame.time > 0 ? 'PAUSED' : 'STANDBY'}</span>
              <div className="view-tools">
                <label className="camera-select"><Aperture size={14} /><select aria-label="Camera" value={camera} onChange={e => setCamera(e.target.value as Camera)}>
                  {cameras.map(view => <option key={view}>{view}</option>)}
                </select><ChevronDown size={12} /></label>
                <button className={`icon-button ${showPaths ? 'on' : ''}`} aria-label="Toggle paths" aria-pressed={showPaths} onClick={() => setShowPaths(v => !v)} title="Toggle paths"><Layers3 size={16} /></button>
                <button className={`icon-button ${showLidar ? 'on' : ''}`} aria-label="Toggle LiDAR" aria-pressed={showLidar} onClick={() => setShowLidar(v => !v)} title="Toggle LiDAR"><Radar size={16} /></button>
                <button className="icon-button" aria-label={immersive ? 'Exit presentation mode' : 'Presentation mode'} onClick={() => setImmersive(v => !v)} title="Presentation mode">{immersive ? <X size={16} /> : <Maximize2 size={15} />}</button>
              </div>
            </div>
            <div className={`canvas-area ${placing ? 'placing' : ''}`}>
              <WarehouseScene frame={frame} selected={selected} camera={camera} showPaths={showPaths} showLidar={showLidar} placing={placing && !replaying} select={setSelected} place={p => void place(p)} />
              {camera === 'Robot POV' && frame.source === 'isaac' && <div className="rgb-screen">
                {frame.robots.find(r => r.id === selected)?.sensor?.rgb
                  ? <img src={frame.robots.find(r => r.id === selected)?.sensor?.rgb} alt={`Recorded or live Isaac Sim RGB view from ${selected}`} />
                  : <span>No RGB sample for this frame</span>}
              </div>}
              <div className="canvas-label"><i />{camera === 'Robot POV' && frame.source === 'local' ? 'SIMULATED ROBOT POV' : 'WAREHOUSE A'}<span> / </span>{shownMode}</div>
              <div className="canvas-compass" aria-label="World axes"><div><b>Y</b><i /><b>X</b></div><span>WORLD XY</span></div>
              <div className="canvas-legend">
                {placing ? <span><Crosshair size={13} /> Click the floor to place a barrier</span> : <>
                  {showPaths && <span><i />Active path</span>}{showLidar && <span><i className="scan-dot" />LiDAR</span>}
                  {frame.obstacles.some(o => frame.observed.includes(o.id)) && <span><i className="alert-dot" />Obstruction</span>}
                </>}
              </div>
              {frame.obstacles.some(o => o.kind === 'forklift') && <div className="alert-banner"><ShieldAlert size={15} />Forklift obstruction <span>AISLE 02</span></div>}
            </div>
            {replaying ? <div className="controls replay-controls">
              <button className="button primary" disabled={end <= start} onClick={() => {
                if (!playing && cursor >= end) { replay?.seek(start); setCursor(start); }
                setPlaying(v => !v);
              }}>{playing ? <Pause size={14} /> : <Play size={14} />}{playing ? 'Pause' : 'Play'}</button>
              <button className="icon-button" aria-label="Rewind replay" onClick={() => { setPlaying(false); replay?.seek(start); setCursor(start); }}><RotateCcw size={15} /></button>
              <input aria-label="Replay position" type="range" min={start} max={end || 1} step=".033333" value={cursor} onChange={e => {
                setPlaying(false);
                replay?.seek(+e.target.value);
                setCursor(+e.target.value);
              }} />
              <label className="small-select"><select aria-label="Replay speed" value={rate} onChange={e => setRate(+e.target.value)}>
                {[.5, 1, 2, 4].map(speed => <option key={speed} value={speed}>{speed}×</option>)}
              </select></label>
              <span className="sim-clock"><b>{clock(cursor)}</b> / {clock(end)}</span>
            </div> : <div className="controls">
              <button className="button primary start-button" disabled={busy} onClick={() => void send({ type: frame.running ? 'pause' : 'start' })}>
                {frame.running ? <Pause size={15} fill="currentColor" /> : <Play size={15} fill="currentColor" />}
                {frame.running ? 'Pause' : frame.time ? 'Resume' : 'Start mission'}
              </button>
              <button className="icon-button reset" disabled={busy} aria-label="Reset simulation" title="Reset simulation" onClick={reset}><RotateCcw size={16} /></button>
              <span className="control-divider" />
              <button className="button toolbar-button" onClick={() => { setDestination(frame.robots.find(r => r.id === selected)?.job?.destination ?? 'D04'); setModal('job'); }}><Box size={15} />Delivery</button>
              <button className={`button toolbar-button ${placing ? 'on' : ''}`} aria-pressed={placing} onClick={() => setPlacing(v => !v)}><Plus size={16} />{placing ? 'Cancel placement' : 'Obstacle'}</button>
              <button className="button toolbar-button drill-button" disabled={busy} onClick={() => { setPlacing(false); void send({ type: 'scenario' }); }} title="Reset and run the timed forklift incident"><CirclePlay size={16} />Run scenario</button>
              <span className="sim-clock"><span>SIM CLOCK</span><b>{clock(frame.time, true)}</b></span>
            </div>}
          </section>
          <FleetPanel frame={frame} selected={selected} select={setSelected} showLidar={showLidar} showPaths={showPaths} />
        </div>

        <div className="analysis-grid"><Timeline events={frame.events} all /><Operations frame={frame} /></div>
        {replaying && <div className="replay-source flex flex-wrap gap-2">
          <button className="button" onClick={() => save(`amr-forge-${frame.source}-recording.json`, JSON.stringify(replay?.recording))}><ArrowDownToLine size={15} />Download recording</button>
          {verifiedReplay && verifiedReplay !== replay && <button className="button" onClick={() => openReplay(verifiedReplay.recording)}>Open imported Isaac recording</button>}
        </div>}
      </> : <section className="panel empty-state">
        <span className="empty-icon">{replaying ? <Clapperboard size={25} /> : <Activity size={25} />}</span>
        <h2>{replaying ? 'No verified Isaac Sim recordings available' : 'Waiting for Isaac Sim telemetry'}</h2>
        <p>{replaying ? 'Import a run recorded by the Isaac bridge or inspect your current local run.' : 'Start the Isaac Sim runner and connect the loopback bridge through SSH. Controls become available when a validated frame arrives.'}</p>
        <button className="button" onClick={replaying ? () => openReplay(local.recording()) : () => setMode('local')}>
          {replaying ? <CirclePlay size={15} /> : <ArrowUpRight size={15} />}{replaying ? 'Replay local run' : 'Open Local Simulation'}
        </button>
      </section>}
      <footer><span>AMR FORGE</span><span>TELEMETRY V1 · METERS / RADIANS</span></footer>
    </main>

    <Modal open={modal === 'job'} close={() => setModal(null)} title="Delivery control" description={`Selected robot · ${selected}`}>
      <label className="form-field">Destination<select aria-label="Destination" value={destination} onChange={e => setDestination(e.target.value)}>{destinations.map(d => <option key={d.id} value={d.id}>{d.id} · {d.label}</option>)}</select></label>
      <label className="form-field">Priority<select aria-label="Priority" value={priority} onChange={e => setPriority(+e.target.value)}><option value="1">1 · Normal</option><option value="2">2 · Elevated</option><option value="3">3 · Urgent</option></select></label>
      {frame && <p className="queue-info">{frame.queue.length ? `Queue · ${frame.queue.map(j => `${j.id} → ${j.destination}`).join(' · ')}` : 'Delivery queue is empty.'}</p>}
      <div className="dialog-actions"><button className="button" disabled={busy} onClick={() => void assign('delivery')}>Assign delivery</button><button className="button primary" disabled={busy} onClick={() => void assign('destination')}>Set destination</button></div>
    </Modal>
    <Modal open={modal === 'export'} close={() => setModal(null)} title="Export session" description="Download measured metrics, operational events, and telemetry.">
      <div className="dialog-actions">
        <button className="button" onClick={() => { if (frame) exportFrame(frame); }}><ArrowDownToLine size={15} />Results JSON</button>
        {mode === 'local' && <button className="button primary" onClick={() => save('amr-forge-local-recording.json', JSON.stringify(local.recording()))}><ArrowDownToLine size={15} />Replay JSON</button>}
        {mode === 'isaac' && <button className="button primary" onClick={() => {
          const link = document.createElement('a'); link.href = '/isaac-api/recording'; link.download = 'amr-forge-isaac-recording.json'; link.click();
        }}><ArrowDownToLine size={15} />Replay JSON</button>}
      </div>
    </Modal>
    {message && <div className={`toast ${message.bad ? 'error' : ''}`} role="status">{message.bad ? <ShieldAlert size={17} /> : <Expand size={16} />}{message.text}<button className="icon-button" aria-label="Dismiss message" onClick={() => setMessage(null)}><X size={16} /></button></div>}
  </>;
}
