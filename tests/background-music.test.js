import test from 'node:test';
import assert from 'node:assert/strict';
import { createRelay } from '../server/index.js';

test('both music tracks are served with audio MIME type and seekable byte ranges', async () => {
  const relay = await createRelay({ insecure: true, port: 0 });
  try {
    const base = `http://127.0.0.1:${relay.server.address().port}/client-laptop/audio/`;
    for (const track of ['state-of-focus.mp3', 'championship-concentricity.mp3', 'ground-bounce.mp3', 'racket-hit.mp3']) {
      const head = await fetch(base + track, { method: 'HEAD' });
      assert.equal(head.status, 200);
      assert.equal(head.headers.get('content-type'), 'audio/mpeg');
      assert.ok(Number(head.headers.get('content-length')) > 1000);
      const response = await fetch(base + track, { headers: { Range: 'bytes=0-255' } });
      assert.equal(response.status, 206);
      assert.match(response.headers.get('content-range'), /^bytes 0-255\//);
      assert.equal((await response.arrayBuffer()).byteLength, 256);
      const invalid = await fetch(base + track, { headers: { Range: 'bytes=999999999-' } });
      assert.equal(invalid.status, 416);
    }
  } finally { await relay.close(); }
});
