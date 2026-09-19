import { CONFIG } from './config.js';

export const SWING_TYPES = Object.freeze(['forehand', 'backhand', 'smash']);
const channels = ['ax', 'ay', 'az', 'gx', 'gy', 'gz'];

export function validTrace(samples, config = CONFIG.dtw) {
  return Array.isArray(samples) && samples.length >= config.minSamples && samples.length <= config.maxSamples
    && samples.every((s, i) => s && Number.isFinite(s.t) && channels.every(k => Number.isFinite(s[k]))
      && channels.slice(0, 3).every(k => Math.abs(s[k]) <= 100)
      && channels.slice(3).every(k => Math.abs(s[k]) <= 10000)
      && (i === 0 || s.t > samples[i - 1].t))
    && samples.at(-1).t - samples[0].t >= config.minDurationMs
    && samples.at(-1).t - samples[0].t <= config.maxDurationMs;
}

// Resample by elapsed time, not frame index: dropped sensor samples must not
// silently change the motion's timing. Group RMS removes force/speed amplitude
// while retaining axis signs and relative shape (forehand vs backhand).
export function prepareTrace(samples, config = CONFIG.dtw) {
  if (!validTrace(samples, config)) return null;
  const duration = samples.at(-1).t - samples[0].t;
  const vectors = []; let j = 0;
  for (let i = 0; i < config.points; i++) {
    const t = samples[0].t + duration * i / (config.points - 1);
    while (j < samples.length - 2 && samples[j + 1].t < t) j++;
    const a = samples[j], b = samples[j + 1];
    const alpha = Math.max(0, Math.min(1, (t - a.t) / (b.t - a.t)));
    vectors.push(channels.map(k => a[k] + alpha * (b[k] - a[k])));
  }
  const rms = start => Math.sqrt(vectors.reduce((sum, v) => sum + v.slice(start, start + 3).reduce((s, x) => s + x * x, 0), 0) / vectors.length);
  const accelerationScale = rms(0), gyroScale = rms(3);
  if (accelerationScale < config.minAccelerationRms) return null;
  return vectors.map(v => v.map((x, i) => x / (i < 3 ? accelerationScale : Math.max(gyroScale, 1))));
}

// Banded multivariate DTW. Normalize accumulated distance by the actual path
// length so slower recordings do not acquire an automatic larger penalty.
export function dtwDistance(a, b, config = CONFIG.dtw) {
  if (!a?.length || !b?.length) return Infinity;
  const band = Math.max(Math.abs(a.length - b.length), Math.ceil(Math.max(a.length, b.length) * config.bandRatio));
  let previous = new Float64Array(b.length + 1).fill(Infinity);
  let lengths = new Uint16Array(b.length + 1); previous[0] = 0;
  for (let i = 1; i <= a.length; i++) {
    const current = new Float64Array(b.length + 1).fill(Infinity), nextLengths = new Uint16Array(b.length + 1);
    for (let j = Math.max(1, i - band); j <= Math.min(b.length, i + band); j++) {
      let cost = previous[j - 1], length = lengths[j - 1];
      if (previous[j] < cost) { cost = previous[j]; length = lengths[j]; }
      if (current[j - 1] < cost) { cost = current[j - 1]; length = nextLengths[j - 1]; }
      const distance = Math.sqrt(a[i - 1].reduce((sum, x, k) => sum + (x - b[j - 1][k]) ** 2, 0) / channels.length);
      current[j] = cost + distance; nextLengths[j] = length + 1;
    }
    previous = current; lengths = nextLengths;
  }
  return previous[b.length] / lengths[b.length];
}

export function classifyTrace(samples, templates, config = CONFIG.dtw) {
  const prepared = prepareTrace(samples, config);
  const candidates = SWING_TYPES.flatMap(shot => {
    const reference = prepareTrace(templates?.[shot], config);
    return reference ? [{ shot, reference }] : [];
  });
  const base = { shot: 'unknown', method: 'dtw', distance: null, margin: null, template_count: candidates.length };
  if (candidates.length !== SWING_TYPES.length) return { ...base, method: 'untrained' };
  if (!prepared) return { ...base, method: 'incomplete' };
  const scores = candidates.map(({ shot, reference }) => ({ shot, distance: dtwDistance(prepared, reference, config) })).sort((a, b) => a.distance - b.distance);
  const best = scores[0], second = scores[1];
  const margin = Math.max(0, Math.min(1, (second.distance - best.distance) / Math.max(second.distance, Number.EPSILON)));
  return { ...base, distance: best.distance, margin,
    shot: best.distance <= config.maxDistance && margin >= config.minMargin ? best.shot : 'unknown' };
}

export function traceTelemetry(samples) {
  const duration = samples.length > 1 ? samples.at(-1).t - samples[0].t : 0;
  return { sample_count: samples.length, motion_duration_ms: duration, sample_hz: duration > 0 ? (samples.length - 1) * 1000 / duration : 0,
    peak_rotation_dps: samples.reduce((peak, s) => Math.max(peak, Math.hypot(s.gx, s.gy, s.gz)), 0) };
}
