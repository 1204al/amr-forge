import { readFileSync } from 'node:fs';
import { decodeRecording } from '../../telemetry/recordings.ts';

const file = process.argv[2];
if (!file) throw new Error('Supply the Isaac bridge recording JSON.');
const data = decodeRecording(JSON.parse(readFileSync(file, 'utf-8')));
if (data.source !== 'isaac') throw new Error('Expected an Isaac Sim recording.');

const final = data.frames.at(-1)!;
const sensors = final.robots.map(({ id }) => {
  const samples = data.frames.flatMap(f => f.robots.filter(r => r.id === id).map(r => r.sensor));
  const lidarSamples = new Set(samples.filter(s => s?.worldPoints?.length).map(s => s!.time)).size;
  const rgbSamples = new Set(samples.filter(s => s?.rgb).map(s => s!.rgbTime ?? s!.time)).size;
  return { id, lidarSamples, rgbSamples };
});

const kinds = final.events.map(e => e.kind);
const order = ['incident', 'detection', 'braking', 'stop', 'replan', 'resume', 'delivery'];
let cursor = -1;
const recovery = order.every(kind => {
  cursor = kinds.indexOf(kind as typeof kinds[number], cursor + 1);
  return cursor >= 0;
});
const passed = final.metrics.delivered === final.robots.length && final.metrics.collisions === 0 &&
  recovery && sensors.every(s => s.lidarSamples >= 2 && s.rgbSamples >= 2);
console.log(JSON.stringify({ passed, seconds: final.time, frames: data.frames.length, recovery, sensors, metrics: final.metrics }, null, 2));
if (!passed) process.exitCode = 1;
