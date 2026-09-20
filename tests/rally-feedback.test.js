import test from 'node:test';
import assert from 'node:assert/strict';
import { RallyFeedback } from '../client-laptop/rally-feedback.js';
import { validMessage } from '../shared/protocol.js';

test('rally intensity grows with alternating contacts, not repeated network snapshots', () => {
  const feel = new RallyFeedback();
  for (let hit = 0; hit < 9; hit++) {
    const state = { phase: 'rally', last_hitter: hit % 2 ? 'B' : 'A' };
    feel.state(state);
    for (let frame = 0; frame < 60; frame++) feel.state(state);
  }
  assert.equal(feel.hits, 9);
  assert.equal(feel.state({ phase: 'rally', last_hitter: 'A' }), 3);
  assert.equal(feel.state({ phase: 'reset' }), 0);
  assert.equal(feel.hits, 0);
});

test('only confirmed, unique hits trigger effects; delayed analysis cannot describe another shot', () => {
  const feel = new RallyFeedback();
  assert.equal(feel.contact({ id: 1, accepted: false, player: 'A' }, 0), false);
  assert.equal(feel.contact({ id: 2, accepted: true, player: 'A' }, 100), true);
  assert.equal(feel.contact({ id: 2, accepted: true, player: 'A' }, 110), false);
  const analysis = { t: 1, type: 'classification', shot_id: 2, player: 'A', shot: 'drive', target_zone: 'deep_left', confidence: 0.8, path: 'model' };
  assert.ok(validMessage(analysis));
  assert.match(feel.classify(analysis, 200), /DRIVE/);
  assert.equal(feel.classify({ ...analysis, player: 'B' }, 200), null);
  assert.equal(feel.classify({ ...analysis, confidence: 0 }, 200), null);
  assert.equal(feel.classify({ ...analysis, path: 'fallback' }, 200), null);
  assert.equal(feel.classify(analysis, 4000), null);
  feel.contact({ id: 3, accepted: true, player: 'B' }, 500);
  assert.equal(feel.classify(analysis, 600), null);
  feel.state({ phase: 'reset' });
  assert.equal(feel.classify({ ...analysis, shot_id: 3, player: 'B' }, 700), null);
});
