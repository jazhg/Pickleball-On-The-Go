import test from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG } from '../shared/config.js';
import { SwingDetector, calibratedPeakG, validCalibration } from '../shared/swing-detector.js';

function motionSequence() {
  const detector = new SwingDetector(CONFIG);
  let t = 0;
  const events = [];
  const feed = (x, y = CONFIG.physics.gravity, z = 0) => {
    t += 20;
    const result = detector.update({ t, acceleration: { x, y, z }, rotationRate: { alpha: 0, beta: 0, gamma: 0 } });
    if (result) events.push(result);
  };
  for (let i = 0; i < 50; i += 1) feed(0);
  feed(30); feed(40); feed(15); feed(-15); feed(-20); feed(-10); feed(0);
  return { detector, events };
}

test('still samples establish a flat reference, then one reversal emits one swing', () => {
  const { detector, events } = motionSequence();
  assert.equal(detector.readings.pitch, 0);
  assert.equal(events.length, 1);
  assert.equal(events[0].type, 'swing');
  assert.ok(events[0].peak_g > CONFIG.swing.startG);
  assert.equal(detector.readings.state, 'FOLLOW');
});

test('calibration requires increasing soft, medium, hard peaks and maps to canonical anchors', () => {
  const peaks = { soft: 1.8, medium: 3.2, hard: 5.9 };
  assert.equal(validCalibration(peaks), true);
  assert.equal(validCalibration({ soft: 3.2, medium: 3.1, hard: 5.9 }), false);
  assert.ok(Math.abs(calibratedPeakG(peaks.medium, peaks) - CONFIG.calibration.mediumG) < 0.001);
});

test('a single static sample does not overwrite the captured orientation', () => {
  const detector = new SwingDetector(CONFIG);
  let t = 0;
  for (let i = 0; i < 50; i += 1) {
    t += 20;
    detector.update({ t, acceleration: { x: 0, y: CONFIG.physics.gravity, z: 0 }, rotationRate: { alpha: 0, beta: 0, gamma: 0 } });
  }
  const before = detector.readings.pitch;
  t += 20;
  detector.update({ t, acceleration: { x: 0, y: CONFIG.physics.gravity, z: 0 }, rotationRate: { alpha: 90, beta: 0, gamma: 0 } });
  assert.equal(detector.readings.pitch, before);
});
