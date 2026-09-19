import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyTrace, prepareTrace, dtwDistance, traceTelemetry } from '../shared/dtw.js';
import { CONFIG } from '../shared/config.js';
import { validAnalysis, parseAnalysis, emptyAnalysis, validShot } from '../shared/shot-telemetry.js';
import { describeShot } from '../client-laptop/shot-view.js';

// Analytic sensor curves are regression fixtures, not captured human swings.
export function trace(type, duration = 500, count = 31, amplitude = 1, warp = 1) {
  return Array.from({ length: count }, (_, i) => {
    const t = i / (count - 1), u = t ** warp, wave = Math.sin(2 * Math.PI * u), arc = Math.sin(Math.PI * u);
    const sign = type === 'backhand' ? -1 : 1;
    return { t: duration * t,
      ax: amplitude * (type === 'smash' ? 0.1 * wave : sign * 3 * wave),
      ay: amplitude * (type === 'smash' ? 3 * wave : 0.2 * arc),
      az: amplitude * (type === 'smash' ? -arc : 0.3 * arc),
      gx: amplitude * (type === 'smash' ? 5 * wave : sign * 180 * arc),
      gy: amplitude * (type === 'smash' ? 220 * arc : 5 * wave),
      gz: amplitude * 10 * wave };
  });
}
const templates = Object.fromEntries(['forehand', 'backhand', 'smash'].map(type => [type, trace(type)]));

test('DTW recognizes shape across 0.3/0.7s swings, amplitude and local timing changes', () => {
  for (const shot of Object.keys(templates)) {
    for (const [duration, count, amplitude, warp] of [[300, 19, 1.8, 1], [700, 43, 0.5, 1.25]]) {
      const result = classifyTrace(trace(shot, duration, count, amplitude, warp), templates);
      assert.equal(result.shot, shot, JSON.stringify(result));
      assert.equal(result.method, 'dtw'); assert.ok(result.distance < CONFIG.dtw.maxDistance);
    }
  }
});
test('DTW distance is zero for equal sequences and preserves direction', () => {
  const a = prepareTrace(templates.forehand), b = prepareTrace(templates.backhand);
  assert.equal(dtwDistance(a, a), 0);
  assert.ok(dtwDistance(a, b) > 0.5);
});
test('missing, ambiguous, poor and invalid templates do not invent a type', () => {
  assert.equal(classifyTrace(templates.forehand, {}).method, 'untrained');
  assert.equal(classifyTrace(templates.forehand, { ...templates, backhand: templates.forehand }).shot, 'unknown');
  assert.equal(classifyTrace(trace('forehand', 700, 43, 1, 2), templates, { ...CONFIG.dtw, maxDistance: 0.001 }).shot, 'unknown');
  assert.equal(prepareTrace(trace('forehand', 30)), null);
  assert.equal(prepareTrace(trace('forehand', 500, 31, 0)), null);
  const invalid = trace('forehand'); invalid[3].t = invalid[2].t; assert.equal(prepareTrace(invalid), null);
  invalid[3].t = 50; invalid[4].gx = Infinity; assert.equal(prepareTrace(invalid), null);
});
test('telemetry validates finite bounded values and labels virtual launch speed accurately', () => {
  const samples = trace('forehand');
  const analysis = { ...classifyTrace(samples, templates), ...traceTelemetry(samples), raw_peak_g: 4 };
  assert.ok(validAnalysis(analysis));
  assert.ok(parseAnalysis(JSON.stringify({ t: 1, type: 'swing_analysis', analysis })));
  assert.equal(validAnalysis({ ...analysis, distance: NaN }), false);
  assert.equal(validAnalysis({ ...analysis, extra: true }), false);
  assert.equal(validAnalysis({ ...analysis, sample_count: 100000 }), false);
  const report = { type: 'shot', id: 1, t: 1, source: 'phone', accepted: true, reason: 'contact',
    swing: { t: 1, type: 'swing', ...CONFIG.swing.synthetic }, launch_speed_mps: 10, launch_angle_deg: 20, analysis };
  assert.ok(validShot(report));
  const display = describeShot(report);
  assert.equal(display.title, 'Forehand');
  assert.equal(display.detail, 'Ball speed: 22.4 mph');
  assert.equal(describeShot({ ...report, accepted: false, launch_speed_mps: null, launch_angle_deg: null, reason: 'no_ball' }).detail, 'Ball speed: — (no launch)');
  assert.equal(describeShot({ ...report, analysis: emptyAnalysis('synthetic', 3.8) }).title, 'Synthetic test swing');
});
