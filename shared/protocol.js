// Wire fields are exactly section 3. Routing lives in the WS URL, never in messages.
const fields = {
  swing: ['t', 'type', 'peak_g', 'pitch', 'roll', 'yaw_rate', 'duration_ms'],
  pose: ['t', 'type', 'court_x', 'court_y', 'torso_deg', 'wrist_h'],
  state: ['t', 'type', 'ball', 'score', 'server', 'phase'],
  ruling: ['type', 'fault', 'player', 'rule', 'explanation', 'score', 'side_out'],
};
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
    default: return false;
  }
}
export function parseMessage(data) {
  try { const msg = JSON.parse(String(data)); return validMessage(msg) ? msg : null; }
  catch { return null; }
}
