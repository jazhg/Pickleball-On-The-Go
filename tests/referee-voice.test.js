import test from 'node:test';
import assert from 'node:assert/strict';
import { access } from 'node:fs/promises';
import { REFEREE_CLIPS, RefereeVoiceGate } from '../shared/referee-clips.js';

test('every approved referee recording exists', async () => {
  for (const file of Object.values(REFEREE_CLIPS)) await access(new URL(`../client-laptop/audio/referee/${file}`, import.meta.url));
});

test('commentary is sparse, rejects unapproved clips, and lets a ruling interrupt praise', () => {
  const gate = new RefereeVoiceGate();
  assert.equal(gate.allow('drive', 'praise', 0), true);
  assert.equal(gate.allow('angle', 'praise', 5000), false);
  assert.equal(gate.allow('fault_red', 'official', 1000), true);
  assert.equal(gate.allow('side_out', 'official', 2000), false);
  assert.equal(gate.allow('drive', 'praise', 16000), false);
  assert.equal(gate.allow('rally', 'praise', 17000), true);
  assert.equal(gate.allow('drive', 'praise', 61000), true);
  assert.equal(gate.allow('../evil', 'praise', 90000), false);
});
