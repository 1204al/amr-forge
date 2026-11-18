import { strict as assert } from 'node:assert';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { createInterface } from 'node:readline';
import { setTimeout as delay } from 'node:timers/promises';
import { test } from 'node:test';
import { FLEET } from '../autonomy/world.ts';

test('loopback protocol with a mock driver and no synthetic sensor samples', { timeout: 12_000 }, async () => {
  const token = randomBytes(32).toString('hex');
  const child = spawn(process.execPath, ['sim/isaac/bridge.ts'], {
    env: { ...process.env, AMR_BRIDGE_PORT: '0', AMR_DRIVER_TOKEN: token },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const lines = createInterface({ input: child.stdout });
  try {
    const [startup] = await Promise.race([
      once(lines, 'line'),
      once(child, 'exit').then(([code]) => { throw new Error(`Bridge exited before listening (${code}).`); }),
    ]);
    const port = startup.match(/127\.0\.0\.1:(\d+)/)?.[1];
    assert.ok(port, 'bridge printed its bound loopback port');
    const request = (path: string, init?: RequestInit) =>
      fetch(`http://127.0.0.1:${port}${path}`, { ...init, signal: AbortSignal.timeout(7000) });
    const driverHeaders = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
    const robots = FLEET.map(({ id, pose }) => ({ id, pose, speed: 0, angular: 0, sensor: null }));
    const tick = (revision: number, serial: number, moved = false) =>
      request('/driver', { method: 'POST', headers: driverHeaders, body: JSON.stringify({ revision, serial, moved, robots }) });
    const command = (type: string) =>
      request('/commands', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type }) });
    assert.equal((await request('/driver/state')).status, 401);
    assert.equal((await request('/health', { headers: { Origin: 'https://example.com' } })).status, 403);
    assert.deepEqual(await (await request('/health')).json(), { connected: false, time: null });
    assert.equal((await tick(999, 0)).status, 409);
    assert.equal((await tick(0, 0)).status, 200);
    assert.deepEqual(await (await request('/health')).json(), { connected: true, time: 0 });
    assert.equal((await request('/recording')).status, 409);

    const startAck = command('start');
    let state = await (await tick(0, 0)).json();
    for (let i = 0; state.serial === 0 && i < 30; i++) {
      await delay(10);
      state = await (await tick(0, 0)).json();
    }
    assert.equal(state.running, true);
    assert.equal(state.serial, 1);
    const moved = await (await tick(0, 1, true)).json();
    assert.ok(moved.commands.every((c: { speed: number }) => c.speed > 0));
    assert.equal((await (await startAck).json()).ok, true);
    assert.equal((await request('/recording')).status, 409);
  } finally {
    lines.close();
    if (child.exitCode === null && child.signalCode === null) {
      const stopped = once(child, 'exit');
      child.kill();
      await stopped;
    }
  }
});
