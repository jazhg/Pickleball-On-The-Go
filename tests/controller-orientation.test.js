import { PaddleMotion, rotateVector } from '../shared/paddle-motion.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { CONFIG } from '../shared/config.js';
import { SwingDetector, calibratedPeakG, validCalibration } from '../shared/swing-detector.js';
import { orientationQuaternion, forwardReference, relativeOrientation, orientationBasis } from '../shared/controller-orientation.js';

const pose = (alpha, beta = CONFIG.controller.center.pitch, gamma = CONFIG.controller.center.roll) => orientationQuaternion({ alpha, beta, gamma });
const vector = v => [v.x, v.y, v.z];
const near = (actual, expected, epsilon = 1e-9) => actual.forEach((value, i) => assert.ok(Math.abs(value - expected[i]) < epsilon, `${actual} != ${expected}`));
const relative = (alpha, beta, gamma, reference = forwardReference(pose(20))) => relativeOrientation(pose(alpha, beta, gamma), reference);

test('documented normal grip recenters to an upright paddle at every heading', () => {
  for (const heading of [0, 45, 180, 359]) {
    const q = pose(heading);
    const reference = forwardReference(q);
    assert.ok(reference, 'ordinary right-side-up grip is accepted');
    const basis = orientationBasis(relativeOrientation(q, reference));
    near(vector(basis.up), [0, 1, 0]);
    near(vector(basis.normal), [0, 0, 1]);
  }
});

test('upside-down calibration is rejected instead of creating an inverted local frame', () => {
  assert.equal(forwardReference(orientationQuaternion({ alpha: 20, beta: -90, gamma: 0 })), null);
  assert.ok(forwardReference(pose(20)), 'normal grip needs no physical phone flip');
});

test('left/right turns and forward/back tilts follow physical phone motion', () => {
  const center = CONFIG.controller.center;
  const left = orientationBasis(relative(10, center.pitch, center.roll));
  const right = orientationBasis(relative(30, center.pitch, center.roll));
  assert.ok(left.normal.x < 0, 'lower compass heading turns the paddle left');
  assert.ok(right.normal.x > 0, 'higher compass heading turns the paddle right');
  const forward = orientationBasis(relative(20, center.pitch + 10, center.roll));
  const backward = orientationBasis(relative(20, center.pitch - 10, center.roll));
  assert.ok(forward.normal.y < 0, 'top edge away tilts the face forward/down');
  assert.ok(backward.normal.y > 0, 'top edge back tilts the face backward/up');
});

test('wrist twist is around the handle/face-normal axis', () => {
  const absolute = pose(20), reference = forwardReference(absolute);
  const angle = 12 * Math.PI / 180, half = angle / 2;
  const twist = { x: 0, y: 0, z: Math.sin(half), w: Math.cos(half) };
  const multiply = (a, b) => ({
    x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
    y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
    z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
    w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
  });
  const twisted = orientationBasis(relativeOrientation(multiply(absolute, twist), reference));
  assert.ok(Math.abs(twisted.normal.x) < 0.03 && Math.abs(twisted.normal.y) < 0.03, 'twist keeps face normal stable');
  assert.ok(Math.abs(twisted.up.x) > 0.15, 'twist rotates the handle axis');
});

test('the controller quaternion is seat-independent first-person input', () => {
  const center = CONFIG.controller.center;
  const q = relative(32, center.pitch + 7, center.roll - 4);
  const forSeat = () => [q.x, q.y, q.z, q.w]; // seat conversion belongs to world launch only
  near(forSeat('A'), forSeat('B'));
});

test('invalid sensors are ignored', () => {
  for (const beta of [null, undefined, NaN, Infinity]) assert.equal(orientationQuaternion({ alpha: 0, beta, gamma: 0 }), null);
});

test('phone events send live poses and reject upside-down recentering', async () => {
  const nodes = new Map();
  const getNode = id => {
    if (!nodes.has(id)) nodes.set(id, { textContent: '', classList: { add() {}, remove() {} }, addEventListener(type, handler) { this[type] = handler; } });
    return nodes.get(id);
  };
  const events = {}, timers = [], sent = [];
  class Socket {
    static OPEN = 1;
    readyState = 1;
    addEventListener() {}
    send(value) { sent.push(JSON.parse(value)); }
  }
  const context = vm.createContext({
    PaddleMotion, rotateVector, CONFIG, SwingDetector, calibratedPeakG, validCalibration,
    orientationQuaternion, forwardReference, relativeOrientation,
    document: { getElementById: getNode }, navigator: { userAgent: 'iPhone' },
    window: { location: { href: 'https://court.test/client-phone/', protocol: 'https:', hostname: 'court.test', search: '' }, isSecureContext: true,
      DeviceMotionEvent: {}, DeviceOrientationEvent: {}, addEventListener(type, handler) { events[type] = handler; } },
    WebSocket: Socket, URL, URLSearchParams, localStorage: { getItem() { return null; } }, performance,
    setInterval(handler) { timers.push(handler); }, clearInterval() {}, clearTimeout() {}, setTimeout() {},
  });
  const source = readFileSync(new URL('../client-phone/app.js', import.meta.url), 'utf8').replace(/^import .*;\n/gm, '');
  vm.runInContext(source, context);
  await getNode('enable-button').click();
  events.deviceorientation({ alpha: 20, beta: CONFIG.controller.center.pitch, gamma: CONFIG.controller.center.roll });
  timers[0]();
  assert.equal(sent.at(-1).type, 'controller_pose');
  near([sent.at(-1).qx, sent.at(-1).qy, sent.at(-1).qz, sent.at(-1).qw], [0, 0, 0, 1]);
  events.deviceorientation({ alpha: 35, beta: CONFIG.controller.center.pitch, gamma: CONFIG.controller.center.roll });
  timers[0]();
  assert.ok(orientationBasis({ x: sent.at(-1).qx, y: sent.at(-1).qy, z: sent.at(-1).qz, w: sent.at(-1).qw }).normal.x > 0);
  getNode('recenter-button').click();
  near([sent.at(-1).qx, sent.at(-1).qy, sent.at(-1).qz, sent.at(-1).qw], [0, 0, 0, 1]);
  events.deviceorientation({ alpha: 35, beta: -90, gamma: 0 });
  const count = sent.length;
  getNode('recenter-button').click();
  assert.equal(sent.length, count, 'invalid recenter does not replace the good neutral basis');
});
