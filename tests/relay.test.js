import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import WebSocket from 'ws';
import { createRelay } from '../server/index.js';
import { CONFIG } from '../shared/config.js';
import { validMessage } from '../shared/protocol.js';

test('relay accepts keyboard and phone schemas, broadcasts authoritative state, protects private files', async () => {
  const relay = await createRelay({ insecure: true, port: 0 });
  const port = relay.server.address().port;
  try {
    assert.equal((await fetch(`http://127.0.0.1:${port}/health`)).status, 200);
    for (const file of ['.env', '.certs/key.pem', 'server/index.js', 'shared/%2e%2e/%2e%2e/.env']) assert.equal((await fetch(`http://127.0.0.1:${port}/${file}`)).status, 404);
    const laptop = new WebSocket(`ws://127.0.0.1:${port}/ws?role=laptop`);
    const first = once(laptop, 'message'); await once(laptop, 'open');
    assert.ok(validMessage(JSON.parse(String((await first)[0]))));
    laptop.send(JSON.stringify({ t: Date.now(), type: 'swing', ...CONFIG.swing.synthetic }));
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('no launched state')), 2000);
      laptop.on('message', data => { const state = JSON.parse(String(data)); if (state.phase === 'rally' && state.ball.vz < 0) { clearTimeout(timer); resolve(); } });
    });
    relay.sim.reset();
    const phone = new WebSocket(`ws://127.0.0.1:${port}/ws?role=phone`); await once(phone, 'open');
    phone.send(JSON.stringify({ t: Date.now(), type: 'swing', ...CONFIG.swing.synthetic }));
    await new Promise(resolve => setTimeout(resolve, 80));
    assert.equal(relay.sim.phase, 'rally'); assert.ok(relay.sim.ball.vz < 0);
    phone.close(); laptop.close();
  } finally { await relay.close(); }
});
