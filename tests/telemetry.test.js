import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import WebSocket from 'ws';
import { createRelay } from '../server/index.js';
import { CONFIG } from '../shared/config.js';
import { emptyAnalysis, validShot } from '../shared/shot-telemetry.js';

test('shot reports launch immediately, correlate analysis per socket, and preserve latest shot', async () => {
  const relay = await createRelay({ insecure: true, port: 0 });
  const url = `ws://127.0.0.1:${relay.server.address().port}/ws`;
  const sockets = [];
  const connect = async role => {
    const ws = new WebSocket(`${url}?role=${role}`); sockets.push(ws);
    ws.reports = [];
    ws.on('message', data => { const msg = JSON.parse(String(data)); if (msg.type === 'shot') ws.reports.push(msg); });
    await once(ws, 'open'); return ws;
  };
  const until = async predicate => {
    const deadline = Date.now() + 2000;
    while (!predicate()) {
      if (Date.now() > deadline) throw new Error('Shot report timed out');
      await new Promise(resolve => setTimeout(resolve, 10));
    }
  };
  try {
    const laptop = await connect('laptop'), phone = await connect('phone'), other = await connect('phone');
    relay.sim.spawn();
    const t = Date.now();
    phone.send(JSON.stringify({ t, type: 'swing', ...CONFIG.swing.synthetic }));
    await until(() => laptop.reports.length === 1);
    const first = laptop.reports[0];
    assert.ok(validShot(first)); assert.equal(first.accepted, true);
    assert.ok(first.launch_speed_mps > 0); assert.equal(first.analysis, null);
    const analysis = emptyAnalysis('untrained', 4);
    other.send(JSON.stringify({ t, type: 'swing_analysis', analysis }));
    phone.send(JSON.stringify({ t, type: 'swing_analysis', analysis: { ...analysis, sample_count: -1 } }));
    phone.send(JSON.stringify({ t, type: 'swing_analysis', analysis }));
    await until(() => laptop.reports.length === 2);
    assert.equal(laptop.reports[1].id, first.id);
    assert.deepEqual(laptop.reports[1].analysis, analysis);
    relay.sim.reset();
    other.send(JSON.stringify({ t: t + 1, type: 'swing', ...CONFIG.swing.synthetic }));
    await until(() => laptop.reports.length === 3);
    const latest = laptop.reports.at(-1);
    assert.equal(latest.reason, 'no_ball'); assert.equal(latest.launch_speed_mps, null);
    phone.send(JSON.stringify({ t, type: 'swing_analysis', analysis }));
    const reconnected = await connect('laptop');
    await until(() => reconnected.reports.length > 0);
    assert.equal(reconnected.reports[0].id, latest.id);
    other.send(JSON.stringify({ t: t + 1, type: 'swing_analysis', analysis }));
    await until(() => laptop.reports.length >= 4);
    assert.equal(laptop.reports.length, 4);
    assert.equal(laptop.reports.at(-1).id, latest.id);
  } finally { sockets.forEach(ws => ws.terminate()); await relay.close(); }
});
