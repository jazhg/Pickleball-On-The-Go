import test from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG } from '../shared/config.js';
import { SwingDetector, calibratedPeakG, validCalibration } from '../shared/swing-detector.js';

const centerGravity = (() => {
  const pitch = CONFIG.controller.center.pitch * Math.PI / 180;
  const roll = CONFIG.controller.center.roll * Math.PI / 180;
  const plane = Math.cos(roll) * CONFIG.physics.gravity;
  return { x: -Math.sin(roll) * CONFIG.physics.gravity, y: Math.sin(pitch) * plane, z: Math.cos(pitch) * plane };
})();

test('small phone movements remain idle; a swing needs quiet recovery before rearming', () => {
  const d = new SwingDetector(); let t = 0;
  const feed = x => d.update({ t: t += 20, acceleration: { ...centerGravity, x: centerGravity.x + x }, rotationRate: {} });
  for (let i = 0; i < 50; i++) feed(0);
  for (let i = 0; i < 20; i++) { assert.equal(feed(i % 2 ? 15 : -15), null); assert.equal(d.state, 'IDLE'); }
  feed(30); feed(40); feed(15); feed(-15);
  assert.ok(feed(-20));
  feed(0);
  for (let i = 0; i < 40; i++) { assert.equal(feed(15), null); assert.equal(d.state, 'FOLLOW'); }
  for (let i = 0; i < 31; i++) feed(0);
  assert.equal(d.state, 'IDLE');
});

function motionSequence() {
  const detector = new SwingDetector(CONFIG);
  let t = 0;
  const events = [];
  const feed = (x, y = centerGravity.y, z = centerGravity.z) => {
    t += 20;
    const result = detector.update({ t, acceleration: { x: centerGravity.x + x, y, z }, rotationRate: { alpha: 0, beta: 0, gamma: 0 } });
    if (result) events.push(result);
  };
  for (let i = 0; i < 50; i += 1) feed(0);
  feed(30); feed(40); feed(15); feed(-15); feed(-20); feed(-10); feed(0);
  return { detector, events };
}

test('measured center is zeroed, then one reversal emits one swing', () => {
  const { detector, events } = motionSequence();
  assert.equal(detector.readings.pitch, 0);
  assert.equal(events.length, 1);
  assert.equal(events[0].type, 'swing');
  assert.ok(events[0].peak_g > CONFIG.swing.startG);
  assert.equal(detector.readings.state, 'FOLLOW');
});

test('pitch, roll, and gyro deltas use the inverted phone convention', () => {
  const detector = new SwingDetector(CONFIG);
  detector.gravity = { ...centerGravity };
  detector.isStatic = true;
  detector.update({ t: 20, acceleration: centerGravity, rotationRate: { alpha: 0, beta: 0, gamma: 0 } });
  detector.isStatic = false;
  detector.update({ t: 40, acceleration: { ...centerGravity, x: centerGravity.x + 20 }, rotationRate: { alpha: 0, beta: 10, gamma: 10 } });
  assert.ok(detector.readings.pitch < 0);
  assert.ok(detector.readings.roll < 0);
});

test('calibration requires increasing soft, medium, hard peaks and maps to canonical anchors', () => {
  const peaks = { soft: 2.8, medium: 4.2, hard: 8.9 };
  assert.equal(validCalibration(peaks), true);
  assert.equal(validCalibration({ soft: 3.2, medium: 3.1, hard: 5.9 }), false);
  assert.ok(Math.abs(calibratedPeakG(peaks.medium, peaks) - CONFIG.calibration.mediumG) < 0.001);
});

test('a single static sample does not overwrite the captured orientation', () => {
  const detector = new SwingDetector(CONFIG);
  let t = 0;
  for (let i = 0; i < 50; i += 1) {
    t += 20;
    detector.update({ t, acceleration: centerGravity, rotationRate: { alpha: 0, beta: 0, gamma: 0 } });
  }
  const before = detector.readings.pitch;
  t += 20;
  detector.update({ t, acceleration: centerGravity, rotationRate: { alpha: 90, beta: 0, gamma: 0 } });
  assert.equal(detector.readings.pitch, before);
});
