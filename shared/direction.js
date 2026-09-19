import { CONFIG } from './config.js';
import { prepareTrace, dtwDistance } from './dtw.js';
import { validMessage } from './protocol.js';

export const DIRECTIONS = ['left', 'center', 'right'];
export const DIRECTION_REPEATS = 3;
export function validDirectionTemplates(templates) {
  return DIRECTIONS.every(label => Array.isArray(templates?.[label])
    && templates[label].length === DIRECTION_REPEATS
    && templates[label].every(trace => prepareTrace(trace)));
}

// Learn the player's axis/sign convention from examples. Only the lead-in to
// contact is used, so ball launch never waits for a follow-through. This is an
// intentional-direction estimate, not integrated room position or velocity.
export function estimateDirection(samples, templates) {
  const neutral = { label: 'uncertain', angle: 0 };
  const input = prepareTrace(samples);
  if (!input || !validDirectionTemplates(templates)) return neutral;
  const scores = DIRECTIONS.map(label => {
    const distances = templates[label].map(trace => dtwDistance(input, prepareTrace(trace))).sort((a, b) => a - b);
    return { label, distance: (distances[0] + distances[1]) / 2 };
  }).sort((a, b) => a.distance - b.distance);
  const [best, next] = scores;
  const margin = (next.distance - best.distance) / Math.max(next.distance, Number.EPSILON);
  if (best.distance > CONFIG.dtw.maxDistance || margin < CONFIG.dtw.minMargin) return neutral;
  return { label: best.label, angle: { left: -20, center: 0, right: 20 }[best.label] };
}

// Atomic supplemental envelope retains the original swing fields, including
// physical roll. Direction cannot arrive late and affect a different swing.
export function parseDirectedSwing(data) {
  try {
    const msg = JSON.parse(String(data));
    return msg && Object.keys(msg).length === 3 && msg.type === 'directed_swing'
      && validMessage(msg.swing) && msg.swing.type === 'swing'
      && Number.isFinite(msg.angle) && Math.abs(msg.angle) <= CONFIG.physics.maxAzimuthDeg ? msg : null;
  } catch { return null; }
}
