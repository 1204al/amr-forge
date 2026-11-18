import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { Warehouse } from '../../autonomy/engine.ts';
import type { Observations } from '../../autonomy/engine.ts';
import { FLEET } from '../../autonomy/world.ts';
import type { Ack, Command, Frame, Recording } from '../../telemetry/contract.ts';
import { decodeRecording, isFrame } from '../../telemetry/recordings.ts';

const token = process.env.AMR_DRIVER_TOKEN;
if (!token || token.length < 24) throw new Error('Set AMR_DRIVER_TOKEN to a shared random value of at least 24 characters.');
const port = Number(process.env.AMR_BRIDGE_PORT ?? 8765);
const warehouse = new Warehouse(undefined, 'isaac');
let frame: Frame | null = null;
let frames: Frame[] = [];
let recordedBytes = 0;
let createdAt = new Date().toISOString();
let driverSeen = 0;
let revision = 0;
let serial = 0;
let firstFrame = true;
let commands: { id: string; speed: number; angular: number }[] = [];
const listeners = new Set<ServerResponse>();
type Pending = { action: Command; response: ServerResponse; deadline: NodeJS.Timeout; applied?: { serial: number; ack: Ack } };
let pending: Pending | null = null;

function reply(res: ServerResponse, status: number, data: unknown) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(JSON.stringify(data));
}

function record(sample: Frame) {
  const bytes = JSON.stringify(sample).length;
  frames.push(sample);
  recordedBytes += bytes;
  while (recordedBytes > 115 * 1024 * 1024 && frames.length > 1) {
    recordedBytes -= JSON.stringify(frames.shift()).length;
  }
}

function publish(sample: Frame) {
  frame = sample;
  const data = `data: ${JSON.stringify(sample)}\n\n`;
  for (const res of listeners) {
    if (res.writableLength < 1024 * 1024) res.write(data);
  }
}

function finish(status: number, ack: Ack) {
  if (!pending) return;
  clearTimeout(pending.deadline);
  reply(pending.response, status, ack);
  pending = null;
}

async function json(req: IncomingMessage, limit: number) {
  if (req.headers['content-type']?.split(';')[0] !== 'application/json') throw new Error('Expected application/json.');
  let content = '';
  for await (const chunk of req) {
    content += chunk;
    if (content.length > limit) throw new Error('Request exceeds size limit.');
  }
  return JSON.parse(content) as unknown;
}

const object = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;
function isCommand(value: unknown): value is Command {
  if (!object(value)) return false;
  switch (value.type) {
    case 'start': case 'pause': case 'reset': case 'incident': case 'scenario': return true;
    case 'obstacle': return object(value.point) && Number.isFinite(value.point.x) && Number.isFinite(value.point.y);
    case 'delivery': case 'destination':
      return typeof value.destination === 'string' && [1, 2, 3].includes(value.priority as number)
        && (value.type === 'delivery' || typeof value.robotId === 'string');
    default: return false;
  }
}

const state = () => {
  const current = warehouse.snapshot();
  return { revision, serial, running: current.running, time: current.time, obstacles: current.obstacles, commands };
};

const server = createServer(async (req, res) => {
  try {
    const origin = req.headers.origin;
    if (origin && new URL(origin).host !== req.headers.host) {
      reply(res, 403, { ok: false, message: 'Cross-origin requests are disabled.' });
      return;
    }
    const path = req.url;
    if (path === '/driver' || path === '/driver/state') {
      if (req.headers.authorization !== `Bearer ${token}`) {
        reply(res, 401, { ok: false, message: 'Invalid driver credentials.' });
        return;
      }
      if (path === '/driver/state' && req.method === 'GET') {
        reply(res, 200, state());
        return;
      }
      if (req.method !== 'POST') {
        reply(res, 405, { ok: false, message: 'Method not allowed.' });
        return;
      }
      const packet = await json(req, 1024 * 1024);
      const samples = object(packet) ? packet.robots : null;
      if (!object(packet) || typeof packet.moved !== 'boolean' || !Array.isArray(samples) ||
          packet.revision !== revision || packet.serial !== serial ||
          samples.length !== FLEET.length || !FLEET.every(r => samples.some((o: unknown) => object(o) && o.id === r.id))) {
        reply(res, 409, { ok: false, message: 'Driver packet does not match the current scenario.' });
        return;
      }
      const observations: Observations = samples.map(({ id, pose, speed, angular, sensor }) =>
        ({ id, pose, speed, angular, sensor }));
      const current = warehouse.snapshot();
      const candidate = { ...current, robots: current.robots.map(robot => ({
        ...robot, ...observations.find(o => o.id === robot.id),
      })) };
      if (!isFrame(candidate)) {
        reply(res, 400, { ok: false, message: 'Driver returned invalid observations.' });
        return;
      }
      driverSeen = Date.now();
      if (packet.moved && current.running) commands = warehouse.step(observations);
      else warehouse.observe(observations, false);

      if (pending?.applied && pending.applied.serial === serial) {
        finish(200, pending.applied.ack);
        firstFrame = true;
      }
      const sample = warehouse.snapshot();
      if (firstFrame || sample.time - (frame?.time ?? -1) >= .099) {
        publish(sample);
        if (firstFrame || sample.time - (frames.at(-1)?.time ?? -1) >= .199) record(sample);
        firstFrame = false;
      }
      if (pending && !pending.applied) {
        const ack = warehouse.command(pending.action);
        if (!ack.ok) finish(200, ack);
        else {
          serial++;
          pending.applied = { ack, serial };
          if (pending.action.type === 'reset' || pending.action.type === 'scenario') {
            revision++;
            frame = null;
            frames = [];
            recordedBytes = 0;
            createdAt = new Date().toISOString();
            commands = [];
            firstFrame = true;
          } else if (pending.action.type === 'pause') {
            commands = [];
          }
        }
      }
      reply(res, 200, state());
      return;
    }
    if (req.method === 'GET' && path === '/events') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
      res.write(': awaiting driver\n\n');
      listeners.add(res);
      if (frame && Date.now() - driverSeen < 5000) res.write(`data: ${JSON.stringify(frame)}\n\n`);
      res.on('close', () => { listeners.delete(res); });
      return;
    }
    if (req.method === 'GET' && path === '/health') {
      reply(res, 200, { connected: !!frame && Date.now() - driverSeen < 5000, time: frame?.time ?? null });
      return;
    }
    if (req.method === 'GET' && path === '/recording') {
      try {
        const latest = warehouse.snapshot();
        const finalSample = frames.at(-1);
        const replayFrames = finalSample && latest.time > finalSample.time ? [...frames, latest] : frames;
        const data: Recording = decodeRecording({ version: 1, source: 'isaac', createdAt, frames: replayFrames });
        res.setHeader('Content-Disposition', 'attachment; filename="amr-forge-isaac-recording.json"');
        reply(res, 200, data);
      } catch {
        reply(res, 409, { ok: false, message: 'No recording with captured RGB and RTX LiDAR samples is available.' });
      }
      return;
    }
    if (req.method === 'POST' && path === '/commands') {
      if (!frame || Date.now() - driverSeen >= 5000 || pending) {
        reply(res, 200, { ok: false, message: pending ? 'A command is awaiting the driver.' : 'Isaac Sim driver is disconnected.' });
        return;
      }
      const action = await json(req, 4096);
      if (!isCommand(action)) { reply(res, 200, { ok: false, message: 'Invalid simulation command.' }); return; }
      if (pending) { reply(res, 200, { ok: false, message: 'A command is awaiting the driver.' }); return; }
      pending = { action, response: res, deadline: setTimeout(() => finish(200, { ok: false, message: 'Isaac Sim driver did not acknowledge in time.' }), 5500) };
      return;
    }
    reply(res, 404, { ok: false, message: 'Unknown endpoint.' });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Invalid request.';
    if (!res.headersSent && !res.destroyed) reply(res, 400, { ok: false, message });
  }
});

const watchdog = setInterval(() => {
  if (Date.now() - driverSeen > 5000) {
    for (const res of listeners) res.end();
    listeners.clear();
  }
}, 2000);
watchdog.unref();
server.listen(port, '127.0.0.1', () => {
  const address = server.address();
  if (address && typeof address !== 'string') console.log(`Isaac Sim bridge on 127.0.0.1:${address.port}`);
});
