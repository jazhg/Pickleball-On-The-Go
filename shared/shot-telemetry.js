import { CONFIG } from './config.js';
import { SWING_TYPES } from './dtw.js';
import { validMessage } from './protocol.js';

// Supplemental telemetry messages. The original swing/state/pose/ruling payloads
// remain unchanged. A report is matched to a swing by t on the SAME WebSocket.
const finiteRange = (n, low, high) => typeof n === 'number' && Number.isFinite(n) && n >= low && n <= high;
const keys = ['shot', 'method', 'distance', 'margin', 'template_count', 'sample_count', 'motion_duration_ms', 'sample_hz', 'raw_peak_g', 'peak_rotation_dps'];
export function validAnalysis(a) {
  return a && typeof a === 'object' && Object.keys(a).length === keys.length && keys.every(k => Object.hasOwn(a, k))
    && [...SWING_TYPES, 'unknown'].includes(a.shot)
    && ['dtw', 'untrained', 'synthetic', 'incomplete'].includes(a.method)
    && (a.distance === null || finiteRange(a.distance, 0, 100))
    && (a.margin === null || finiteRange(a.margin, 0, 1))
    && Number.isInteger(a.template_count) && finiteRange(a.template_count, 0, SWING_TYPES.length)
    && Number.isInteger(a.sample_count) && finiteRange(a.sample_count, 0, CONFIG.dtw.maxSamples)
    && finiteRange(a.motion_duration_ms, 0, 5000) && finiteRange(a.sample_hz, 0, 2000)
    && finiteRange(a.raw_peak_g, 0, 100)
    && finiteRange(a.peak_rotation_dps, 0, 18000)
    && (a.shot === 'unknown' || (a.method === 'dtw' && a.template_count === 3 && a.distance !== null && a.margin !== null));
}
export function parseAnalysis(data) {
  try {
    const msg = JSON.parse(String(data));
    return msg && Object.keys(msg).length === 3 && msg.type === 'swing_analysis' && finiteRange(msg.t, 0, Number.MAX_SAFE_INTEGER) && validAnalysis(msg.analysis) ? msg : null;
  } catch { return null; }
}
export function emptyAnalysis(method, rawPeak = 0) {
  return { shot: 'unknown', method, distance: null, margin: null, template_count: 0, sample_count: 0, motion_duration_ms: 0, sample_hz: 0, raw_peak_g: rawPeak, peak_rotation_dps: 0 };
}

export function validShot(msg) {
  return msg?.type === 'shot' && Number.isSafeInteger(msg.id) && msg.id > 0
    && finiteRange(msg.t, 0, Number.MAX_SAFE_INTEGER) && ['phone', 'laptop'].includes(msg.source)
    && typeof msg.accepted === 'boolean' && ['contact', 'no_ball', 'missed', 'busy'].includes(msg.reason)
    && validMessage(msg.swing) && msg.swing.type === 'swing' && msg.swing.t === msg.t
    && (msg.accepted ? finiteRange(msg.launch_speed_mps, 0, 100) && finiteRange(msg.launch_angle_deg, -90, 90)
      : msg.launch_speed_mps === null && msg.launch_angle_deg === null)
    && (msg.analysis === null || validAnalysis(msg.analysis));
}
