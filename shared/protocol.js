// Wire fields are exactly section 3. Routing lives in the WS URL, never in messages.
// The original four schemas (swing, pose, state, ruling) are frozen; additions are
// new message types only.
const fields = {
  swing: ['t', 'type', 'peak_g', 'pitch', 'roll', 'yaw_rate', 'duration_ms'],
  pose: ['t', 'type', 'court_x', 'court_y', 'torso_deg', 'wrist_h'],
  state: ['t', 'type', 'ball', 'score', 'server', 'phase'],
  ruling: ['type', 'fault', 'player', 'rule', 'explanation', 'score', 'side_out'],
  classification: ['t', 'type', 'shot', 'target_zone', 'confidence', 'path'],
  ruling_evidence: ['t', 'type', 'rule', 'provisional', 'path', 'trigger_events', 'preceding_shot'],
};
const SHOTS = new Set(['dink', 'drive', 'drop', 'lob', 'smash', 'serve', 'mishit']);
const ZONES = new Set(['near_left', 'near_right', 'deep_left', 'deep_right', 'kitchen']);
const exactKeys = (obj, keys) => obj && typeof obj === 'object' && !Array.isArray(obj)
  && Object.keys(obj).length === keys.length && keys.every(k => Object.hasOwn(obj, k));
const finite = n => typeof n === 'number' && Number.isFinite(n);
const score = value => Array.isArray(value) && value.length === 2 && value.every(n => Number.isInteger(n) && n >= 0);
export function validMessage(msg) {
  if (!exactKeys(msg, fields[msg?.type] || [])) return false;
  switch (msg.type) {
    case 'swing': return ['t', 'peak_g', 'pitch', 'roll', 'yaw_rate', 'duration_ms'].every(k => finite(msg[k]))
      && msg.t >= 0 && msg.peak_g >= 0 && msg.peak_g <= 100
      && Math.abs(msg.pitch) <= 180 && Math.abs(msg.roll) <= 180
      && Math.abs(msg.yaw_rate) <= 10000 && msg.duration_ms > 0 && msg.duration_ms <= 5000;
    case 'pose': return ['t', 'court_x', 'court_y', 'torso_deg', 'wrist_h'].every(k => finite(msg[k]))
      && msg.t >= 0 && Math.abs(msg.court_x) <= 20 && Math.abs(msg.court_y) <= 30
      && Math.abs(msg.torso_deg) <= 360 && msg.wrist_h >= 0 && msg.wrist_h <= 4;
    case 'state': return finite(msg.t) && exactKeys(msg.ball, ['x', 'y', 'z', 'vx', 'vy', 'vz'])
      && Object.values(msg.ball).every(finite) && score(msg.score)
      && [1, 2].includes(msg.server) && typeof msg.phase === 'string';
    case 'ruling': return typeof msg.fault === 'boolean' && [null, 'A', 'B'].includes(msg.player)
      && typeof msg.rule === 'string' && typeof msg.explanation === 'string'
      && score(msg.score) && typeof msg.side_out === 'boolean';
    case 'classification': return finite(msg.t) && msg.t >= 0
      && SHOTS.has(msg.shot) && ZONES.has(msg.target_zone)
      && finite(msg.confidence) && msg.confidence >= 0 && msg.confidence <= 1
      && typeof msg.path === 'string';
    case 'ruling_evidence': return finite(msg.t) && msg.t >= 0
      && typeof msg.rule === 'string' && typeof msg.provisional === 'boolean'
      && typeof msg.path === 'string' && Array.isArray(msg.trigger_events)
      && msg.trigger_events.every(e => e && typeof e.label === 'string' && finite(e.t))
      && (msg.preceding_shot === null || (msg.preceding_shot
        && SHOTS.has(msg.preceding_shot.shot) && ZONES.has(msg.preceding_shot.target_zone)
        && finite(msg.preceding_shot.confidence)));
    default: return false;
  }
}
export function parseMessage(data) {
  try { const msg = JSON.parse(String(data)); return validMessage(msg) ? msg : null; }
  catch { return null; }
}
