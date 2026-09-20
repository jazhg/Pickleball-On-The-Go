import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { CONFIG } from '../shared/config.js';
import { SwingDetector, calibratedPeakG, validCalibration } from '../shared/swing-detector.js';
import { orientationQuaternion, forwardReference, relativeOrientation } from '../shared/controller-orientation.js';

const orientation = (alpha, beta = 90, gamma = 0) => orientationQuaternion({ alpha, beta, gamma });
const normal = q => [2 * (q.x * q.z + q.w * q.y), 2 * (q.y * q.z - q.w * q.x), 1 - 2 * (q.x * q.x + q.y * q.y)];
const near = (actual, expected) => actual.forEach((value, i) => assert.ok(Math.abs(value - expected[i]) < 1e-10, `${actual} != ${expected}`));

test('upright screen faces forward regardless of initial compass heading', () => {
  for (const heading of [0, 45, 180, 359]) {
    const q = orientation(heading);
    near(normal(relativeOrientation(q, forwardReference(q))), [0, 0, -1]);
  }
});

test('calibration preserves tilt and subsequent physical turns', () => {
  const tilted = orientation(37, 60);
  const reference = forwardReference(tilted);
  near(normal(relativeOrientation(tilted, reference)), [0, 0.5, -Math.sqrt(3) / 2]);
  near(normal(relativeOrientation(orientation(37), reference)), [0, 0, -1]);
  near(normal(relativeOrientation(orientation(127), reference)), [-1, 0, 0]);
  near(normal(relativeOrientation(orientation(217), reference)), [0, 0, 1]);
  near(normal(relativeOrientation(orientation(37, 0), reference)), [0, 1, 0]);
});

test('rolling phone preserves its face direction and rotates its top', () => {
  const q = relativeOrientation(orientation(270, 0, 90), forwardReference(orientation(0)));
  near(normal(q), [0, 0, -1]);
  near([2 * (q.x * q.y - q.w * q.z), 1 - 2 * (q.x * q.x + q.z * q.z), 2 * (q.y * q.z + q.w * q.x)], [-1, 0, 0]);
});

test('flat startup waits for a usable heading; invalid sensors are ignored', () => {
  assert.equal(forwardReference(orientation(0, 0)), null);
  assert.equal(forwardReference(orientation(120, 180)), null);
  for (const beta of [null, undefined, NaN, Infinity]) {
    assert.equal(orientationQuaternion({ alpha: 0, beta, gamma: 0 }), null);
  }
});

test('phone events send live poses and recenter without browser screen errors', async () => {
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
    CONFIG, SwingDetector, calibratedPeakG, validCalibration,
    orientationQuaternion, forwardReference, relativeOrientation,
    document: { getElementById: getNode }, navigator: { userAgent: 'iPhone' },
    window: { location: { href: 'https://court.test/client-phone/', protocol: 'https:', hostname: 'court.test', search: '' }, isSecureContext: true,
      DeviceMotionEvent: {}, DeviceOrientationEvent: {}, addEventListener(type, handler) { events[type] = handler; } },
    screen: { orientation: { angle: 0 } }, WebSocket: Socket, URL, URLSearchParams,
    localStorage: { getItem() { return null; } }, performance,
    setInterval(handler) { timers.push(handler); }, clearInterval() {}, clearTimeout() {}, setTimeout() {},
  });
  const source = readFileSync(new URL('../client-phone/app.js', import.meta.url), 'utf8').replace(/^import .*;\n/gm, '');
  vm.runInContext(source, context);
  await getNode('enable-button').click();
  events.deviceorientation({ alpha: 20, beta: 0, gamma: 0 });
  timers[0]();
  assert.equal(sent.length, 0);
  events.deviceorientation({ alpha: 20, beta: 90, gamma: 0 });
  timers[0]();
  const face = message => normal({ x: message.qx, y: message.qy, z: message.qz, w: message.qw });
  assert.equal(sent.at(-1).type, 'controller_pose');
  near(face(sent.at(-1)), [0, 0, -1]);
  events.deviceorientation({ alpha: 110, beta: 90, gamma: 0 });
  timers[0]();
  near(face(sent.at(-1)), [-1, 0, 0]);
  getNode('recenter-button').click();
  near(face(sent.at(-1)), [0, 0, -1]);
  context.screen.orientation.angle = 90;
  events.deviceorientation({ alpha: 110, beta: 90, gamma: 0 });
  timers[0]();
  near(face(sent.at(-1)), [0, 0, -1]);
});
