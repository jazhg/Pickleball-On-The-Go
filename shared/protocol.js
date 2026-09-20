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
  spawn: ['t', 'type'],
  controller_pose: ['t', 'type', 'qx', 'qy', 'qz', 'qw'],
  hello: ['type', 'player', 'role'],
};
const SHOTS = new Set(['dink', 'drive', 'drop', 'lob', 'smash', 'serve', 'mishit']);
const ZONES = new Set(['near_left', 'near_right', 'deep_left', 'deep_right', 'kitchen']);
const exactKeys = (obj, keys) => obj && typeof obj === 'object' && !Array.isArray(obj)
  && Object.keys(obj).length === keys.length && keys.every(k => Object.hasOwn(obj, k));
const finite = n => typeof n === 'number' && Number.isFinite(n);
const score = value => Array.isArray(value) && value.length === 2 && value.every(n => Number.isInteger(n) && n >= 0);
export function validMessage(msg) {
  if (!msg || typeof msg !== 'object' || Array.isArray(msg)) return false;
  const required = fields[msg?.type] || [];
  if (!required.length) return false;
  if (!required.every(key => Object.hasOwn(msg, key))) return false;
  const allowed = {
    swing: [],
    pose: ['player'],
    state: ['player', 'players', 'ready_for', 'last_hitter'],
    ruling: [],
    classification: [],
    ruling_evidence: [],
    spawn: [],
    controller_pose: [],
    hello: [],
  };
  const extras = Object.keys(msg).filter(key => !required.includes(key));
  if (extras.some(key => !(allowed[msg.type] || []).includes(key))) return false;
  switch (msg.type) {
    case 'swing': return ['t', 'peak_g', 'pitch', 'roll', 'yaw_rate', 'duration_ms'].every(k => finite(msg[k]))
      && msg.t >= 0 && msg.peak_g >= 0 && msg.peak_g <= 100
      && Math.abs(msg.pitch) <= 180 && Math.abs(msg.roll) <= 180
      && Math.abs(msg.yaw_rate) <= 10000 && msg.duration_ms > 0 && msg.duration_ms <= 5000;
    case 'pose': return ['t', 'court_x', 'court_y', 'torso_deg', 'wrist_h'].every(k => finite(msg[k]))
      && (msg.player === undefined || ['A', 'B'].includes(msg.player))
      && msg.t >= 0 && Math.abs(msg.court_x) <= 20 && Math.abs(msg.court_y) <= 30
      && Math.abs(msg.torso_deg) <= 360 && msg.wrist_h >= 0 && msg.wrist_h <= 4;
    case 'state': return finite(msg.t) && exactKeys(msg.ball, ['x', 'y', 'z', 'vx', 'vy', 'vz'])
      && Object.values(msg.ball).every(finite) && score(msg.score)
      && [1, 2].includes(msg.server) && typeof msg.phase === 'string'
      && (msg.player === undefined || ['A', 'B'].includes(msg.player))
      && [undefined, null, 'A', 'B'].includes(msg.ready_for)
      && [undefined, null, 'A', 'B'].includes(msg.last_hitter)
      && (!msg.players || (typeof msg.players === 'object' && !Array.isArray(msg.players) && Object.entries(msg.players).every(([key, value]) => {
        if (!['A', 'B'].includes(key)) return false;
        if (value === null) return true;
        return value && typeof value === 'object' && ['court_x', 'court_y', 'torso_deg', 'wrist_h'].every(k => finite(value[k]));
      })));
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
    case 'spawn': return finite(msg.t) && msg.t >= 0;
    case 'controller_pose': {
      if (!['t', 'qx', 'qy', 'qz', 'qw'].every(k => finite(msg[k])) || msg.t < 0) return false;
      const lengthSquared = msg.qx ** 2 + msg.qy ** 2 + msg.qz ** 2 + msg.qw ** 2;
      return lengthSquared >= 1e-8 && lengthSquared <= 1e8;
    }
    case 'hello': return ['A', 'B'].includes(msg.player) && typeof msg.role === 'string';
    default: return false;
  }
}
export function normalizeControllerPose(msg) {
  if (!validMessage(msg) || msg.type !== 'controller_pose') return null;
  const length = Math.hypot(msg.qx, msg.qy, msg.qz, msg.qw);
  if (!Number.isFinite(length) || length < 1e-4) return null;
  return { ...msg, qx: msg.qx / length, qy: msg.qy / length, qz: msg.qz / length, qw: msg.qw / length };
}
export function parseMessage(data) {
  try { const msg = JSON.parse(String(data)); return validMessage(msg) ? msg : null; }
  catch { return null; }
}
