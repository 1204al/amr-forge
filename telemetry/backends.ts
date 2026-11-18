import { DT } from '../autonomy/control.ts';
import { Warehouse } from '../autonomy/engine.ts';
import type { Ack, Command, Frame, Recording, SimulationBackend } from './contract.ts';
import { frameAt, isFrame } from './recordings.ts';

abstract class Backend implements SimulationBackend {
  private listeners = new Set<() => void>();
  abstract snapshot(): Frame | null;
  abstract command(action: Command): Promise<Ack>;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };
  protected publish() { this.listeners.forEach(listener => listener()); }
  dispose() { this.listeners.clear(); }
}

export class LocalBackend extends Backend {
  private engine = new Warehouse();
  private current = this.engine.snapshot();
  private frames = [this.current];
  private accumulator = 0;
  private previous = 0;
  private handle = 0;

  startClock() {
    if (this.handle) return;
    this.previous = performance.now();
    this.handle = requestAnimationFrame(this.update);
  }

  private update = (now: number) => {
    const elapsed = Math.min(0.2, (now - this.previous) / 1000);
    this.previous = now;
    if (this.current.running) {
      this.accumulator += elapsed;
      let advanced = false;
      while (this.accumulator + 1e-9 >= DT) {
        this.engine.step();
        this.accumulator -= DT;
        advanced = true;
      }
      if (advanced) this.sync();
    }
    this.handle = requestAnimationFrame(this.update);
  };

  private sync(force = false) {
    this.current = this.engine.snapshot();
    if (force || this.current.time - this.frames.at(-1)!.time >= 0.099) {
      this.frames.push(this.current);
      if (this.frames.length > 7200) this.frames.shift();
    }
    this.publish();
  }
  snapshot = () => this.current;
  async command(action: Command) {
    const ack = this.engine.command(action);
    if (ack.ok) {
      if (action.type === 'reset' || action.type === 'scenario') {
        this.accumulator = 0;
        this.frames = [this.engine.snapshot()];
      }
      this.sync(true);
    }
    return ack;
  }
  recording(): Recording {
    return { version: 1, source: 'local', createdAt: new Date().toISOString(), frames: [...this.frames, this.current] };
  }
  dispose() {
    cancelAnimationFrame(this.handle);
    this.handle = 0;
    super.dispose();
  }
}

export class ReplayBackend extends Backend {
  readonly recording: Recording;
  private current: Frame;
  constructor(recording: Recording) {
    super();
    this.recording = recording;
    this.current = recording.frames[0];
  }
  snapshot = () => this.current;
  seek(time: number) {
    this.current = frameAt(this.recording, time);
    this.publish();
  }
  async command(): Promise<Ack> { return { ok: false, message: 'Replay is read-only.' }; }
}

export class LiveBackend extends Backend {
  private current: Frame | null = null;
  private stream: EventSource | null = null;
  snapshot = () => this.current;
  connect() {
    if (this.stream) return;
    this.stream = new EventSource('/isaac-api/events');
    this.stream.onmessage = event => {
      try {
        const frame: unknown = JSON.parse(event.data);
        if (isFrame(frame) && frame.source === 'isaac') {
          this.current = frame;
          this.publish();
        }
      } catch { /* Keep the last validated sample while the stream is open. */ }
    };
    this.stream.onerror = () => { this.current = null; this.publish(); };
  }
  async command(action: Command): Promise<Ack> {
    try {
      const response = await fetch('/isaac-api/commands', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(action),
        signal: AbortSignal.timeout(6000),
      });
      if (!response.ok) throw new Error('Bridge unavailable');
      return await response.json() as Ack;
    } catch {
      return { ok: false, message: 'No response from the local Isaac Sim bridge.' };
    }
  }
  dispose() { this.stream?.close(); this.stream = null; this.current = null; super.dispose(); }
}
