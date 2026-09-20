import { PaddleMotion } from '../shared/paddle-motion.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { CONFIG } from '../shared/config.js';
import { SwingDetector, calibratedPeakG, validCalibration } from '../shared/swing-detector.js';
import { orientationQuaternion, forwardReference, relativeOrientation, orientationBasis } from '../shared/controller-orientation.js';

const orientation = (alpha, beta = CONFIG.controller.center.pitch, gamma = CONFIG.controller.center.roll) => orientationQuaternion({ alpha, beta, gamma });
const normal = q => [2 * (q.x * q.z + q.w * q.y), 2 * (q.y * q.z - q.w * q.x), 1 - 2 * (q.x * q.x + q.y * q.y)];
const near = (actual, expected, epsilon = 1e-9) => actual.forEach((value, i) => assert.ok(Math.abs(value - expected[i]) < epsilon, `${actual} != ${expected}`));

test('documented normal grip recenters to an upright paddle at every heading', () => {
  for (const heading of [0, 45, 180, 359]) {
    const absolute = orientation(heading);
    const reference = forwardReference(absolute);
    assert.ok(reference);
    const relative = relativeOrientation(absolute, reference);
    near([relative.x, relative.y, relative.z, relative.w], [0, 0, 0, 1]);
    near(normal(relative), [0, 0, 1]);
  }
});

test('left/right turns and forward/back tilts follow the normal physical grip', () => {
  const center = CONFIG.controller.center;
  const reference = forwardReference(orientation(20));
  const basis = (alpha, beta) => orientationBasis(relativeOrientation(orientation(alpha, beta, center.roll), reference));
  assert.ok(basis(10, center.pitch).normal.x < 0, 'lower heading turns left');
  assert.ok(basis(30, center.pitch).normal.x > 0, 'higher heading turns right');
  assert.ok(basis(20, center.pitch + 10).normal.y < 0, 'top edge away tilts forward');
  assert.ok(basis(20, center.pitch - 10).normal.y > 0, 'top edge back tilts backward');
});

test('wrist twist rotates around the handle/face-normal axis', () => {
  const absolute = orientation(20), reference = forwardReference(absolute);
  const angle = 12 * Math.PI / 180, twist = { x: 0, y: 0, z: Math.sin(angle / 2), w: Math.cos(angle / 2) };
  const multiply = (a, b) => ({
    x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
    y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
    z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
    w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
  });
  const basis = orientationBasis(relativeOrientation(multiply(absolute, twist), reference));
  assert.ok(Math.abs(basis.normal.x) < 0.03 && Math.abs(basis.normal.y) < 0.03);
  assert.ok(Math.abs(basis.up.x) > 0.15);
});

test('upside-down and flat calibration are rejected; invalid sensors are ignored', () => {
  assert.equal(forwardReference(orientation(20, -90, 0)), null);
  assert.equal(forwardReference(orientation(20, 0, 0)), null);
  for (const beta of [null, undefined, NaN, Infinity]) assert.equal(orientationQuaternion({ alpha: 0, beta, gamma: 0 }), null);
});

test('the same controller motion stays seat-independent before world conversion', () => {
  const reference = forwardReference(orientation(20));
  const q = relativeOrientation(orientation(32, CONFIG.controller.center.pitch + 7, CONFIG.controller.center.roll - 4), reference);
  near([q.x, q.y, q.z, q.w], [q.x, q.y, q.z, q.w]);
});

function phoneHarness() {
  const html = readFileSync(new URL('../client-phone/index.html', import.meta.url), 'utf8');
  const ids = new Set([...html.matchAll(/id="([^"]+)"/g)].map(match => match[1]));
  const nodes = new Map();
  const getNode = id => {
    assert.ok(ids.has(id), `UI element ${id} must exist in the actual controller page`);
    if (!nodes.has(id)) nodes.set(id, { textContent: '', addEventListener(type, handler) { this[type] = handler; } });
    return nodes.get(id);
  };
  const events = {}, timers = [], sent = [], socketEvents = {};
  let now = 1000;
  class Socket {
    static OPEN = 1;
    readyState = 1;
    addEventListener(type, handler) { socketEvents[type] = handler; }
    send(value) { sent.push(JSON.parse(value)); }
  }
  const context = vm.createContext({
    PaddleMotion, CONFIG, SwingDetector, orientationQuaternion, forwardReference, relativeOrientation,
    document: { getElementById: getNode }, navigator: { userAgent: 'iPhone' },
    window: { location: { href: 'https://court.test/client-phone/', protocol: 'https:', hostname: 'court.test', search: '' },
      DeviceMotionEvent: {}, DeviceOrientationEvent: {}, addEventListener(type, handler) { events[type] = handler; } },
    WebSocket: Socket, URL, URLSearchParams, performance: { now: () => now },
    setInterval(handler) { timers.push(handler); }, clearInterval() {}, clearTimeout() {}, setTimeout() {},
  });
  vm.runInContext(readFileSync(new URL('../client-phone/app.js', import.meta.url), 'utf8').replace(/^import .*;\n/gm, ''), context);
  return { getNode, context, events, timers, sent, advance(ms) { now += ms; }, message(msg) { socketEvents.message({ data: JSON.stringify(msg) }); } };
}
const sentNormal = msg => normal({ x: msg.qx, y: msg.qy, z: msg.qz, w: msg.qw });

test('recenter countdown captures a fresh basis and resets bounded handle motion', async () => {
  const h = phoneHarness();
  await h.getNode('enable-button').click();
  h.events.deviceorientation({ alpha: 20, beta: 90, gamma: 0 });
  h.timers[0](); near(sentNormal(h.sent.at(-1)), [0, 0, 1]);
  h.events.deviceorientation({ alpha: 110, beta: 90, gamma: 0 });
  h.timers[0](); assert.ok(sentNormal(h.sent.at(-1))[0] > 0.99);
  h.getNode('recenter-button').click();
  assert.match(h.getNode('recenter-button').textContent, /2/);
  h.advance(2100); h.timers[1]();
  h.events.deviceorientation({ alpha: 110, beta: 0, gamma: 0 });
  assert.doesNotMatch(h.getNode('sensor-detail').textContent, /Forward set/);
  h.events.deviceorientation({ alpha: 110, beta: 90, gamma: 0 });
  near(sentNormal(h.sent.at(-1)), [0, 0, 1]);
  assert.deepEqual(
    [h.sent.at(-1).motion_x, h.sent.at(-1).motion_y, h.sent.at(-1).motion_z, h.sent.at(-1).motion_magnitude],
    [0, 0, 0, 0],
  );
  assert.match(h.getNode('sensor-detail').textContent, /Forward set/);
  assert.equal(h.getNode('recenter-button').disabled, false);
});

test('stale sensors cannot report calibration success and pending recenter expires', async () => {
  const h = phoneHarness(); await h.getNode('enable-button').click();
  h.events.deviceorientation({ alpha: 20, beta: 90, gamma: 0 });
  h.advance(600); h.getNode('recenter-button').click();
  assert.match(h.getNode('sensor-detail').textContent, /No fresh/);
  h.events.deviceorientation({ alpha: 20, beta: 90, gamma: 0 });
  h.getNode('recenter-button').click();
  h.advance(7100); h.timers[1]();
  assert.match(h.getNode('sensor-detail').textContent, /No valid reading/);
});

test('denied orientation permission remains retryable', async () => {
  const h = phoneHarness();
  h.context.window.DeviceOrientationEvent.requestPermission = async () => 'denied';
  await h.getNode('enable-button').click();
  assert.match(h.getNode('permission-error').textContent, /Allow both/);
  h.context.window.DeviceOrientationEvent.requestPermission = async () => 'granted';
  await h.getNode('enable-button').click();
  assert.equal(typeof h.events.deviceorientation, 'function');
});

test('compact remote keeps multiplayer score and legal manual swings', () => {
  const h = phoneHarness();
  h.message({ type: 'hello', player: 'B' });
  h.message({ type: 'state', phase: 'ready', ready_for: 'B', score: [2, 3] });
  assert.equal(h.getNode('your-score').textContent, 3);
  assert.equal(h.getNode('their-score').textContent, 2);
  h.getNode('synthetic-button').click();
  assert.equal(h.sent.at(-1).type, 'swing');
});

test('recenter captures the complete comfortable grip basis at any heading', () => {
  for (const heading of [0, 37, 180, 359]) {
    for (const [beta, gamma] of [[60, 20], [110, -25], [90, 0]]) {
      const grip = orientation(heading, beta, gamma);
      const reference = forwardReference(grip);
      assert.ok(reference);
      const neutral = relativeOrientation(grip, reference);
      near([neutral.x, neutral.y, neutral.z, neutral.w], [0, 0, 0, 1]);
      const turned = relativeOrientation(orientation(heading + 25, beta, gamma), reference);
      assert.ok(Math.abs(normal(turned)[0]) > 0.2, 'aim must still follow turns after centering');
    }
  }
});

test('gravity-only readings do not become handle motion features', async () => {
  const h = phoneHarness();
  await h.getNode('enable-button').click();
  h.events.deviceorientation({ alpha: 20, beta: 90, gamma: 0 });
  for (let i = 0; i < 10; i++) {
    h.advance(20);
    h.events.devicemotion({ accelerationIncludingGravity: { x: 0, y: CONFIG.physics.gravity, z: 0 }, acceleration: null, rotationRate: {} });
  }
  h.timers[0]();
  near([
    h.sent.at(-1).motion_x, h.sent.at(-1).motion_y,
    h.sent.at(-1).motion_z, h.sent.at(-1).motion_magnitude,
  ], [0, 0, 0, 0]);
});

test('recenter immediately returns the model home and holds it through the countdown', async () => {
  const h = phoneHarness();
  await h.getNode('enable-button').click();
  h.events.deviceorientation({ alpha: 0, beta: 90, gamma: 0 });
  for (let i = 0; i < 8; i++) {
    h.advance(20);
    h.events.devicemotion({ accelerationIncludingGravity: { x: 4, y: 9.81, z: 0 }, acceleration: { x: 4, y: 0, z: 0 }, rotationRate: {} });
  }
  h.events.deviceorientation({ alpha: 70, beta: 60, gamma: 10 });
  h.timers[0]();
  assert.ok(Math.abs(h.sent.at(-1).motion_x) > 0.01);
  h.getNode('recenter-button').click();
  for (let i = 0; i < 5; i++) {
    const pose = h.sent.at(-1);
    near([pose.qx, pose.qy, pose.qz, pose.qw], [0, 0, 0, 1]);
    near([pose.motion_x, pose.motion_y, pose.motion_z, pose.motion_magnitude], [0, 0, 0, 0]);
    h.advance(100);
    h.events.deviceorientation({ alpha: i * 10, beta: 70, gamma: 15 });
    h.timers[0]();
  }
});
