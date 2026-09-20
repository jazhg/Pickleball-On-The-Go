import { PaddleMotion } from '/shared/paddle-motion.js';
import { orientationQuaternion, forwardReference, relativeOrientation } from '/shared/controller-orientation.js';
import { CONFIG } from '/shared/config.js';
import { SwingDetector } from '/shared/swing-detector.js';

const $ = id => document.getElementById(id);
const ui = {
  connectionTitle: $('connection-title'), connectionDot: $('connection-dot'),
  permissionError: $('permission-error'), enable: $('enable-button'), sensorDetail: $('sensor-detail'),
  synthetic: $('synthetic-button'), recenter: $('recenter-button'),
};
const detector = new SwingDetector(CONFIG);
const paddleMotion = new PaddleMotion();
let lastMotionSwingAt = -Infinity;
let socket;
let reconnectTimer;
let reconnectAttempt = 0;
let closing = false;
let motionStarted = false;
let sensorTimer;
let ballPhase = null;
let localPlayer = null;
let readyFor = null;
let lastHitter = null;
let latestOrientation = null;
let latestOrientationAt = -Infinity;
let neutralOrientation = null;
let controllerTimer = null;
let pendingRecenter = null;
let enablingMotion = false;
const spawnButton = $('spawn-button');
function canSwingNow() {
  if (!localPlayer) return false;
  if (ballPhase === 'ready') return readyFor === localPlayer;
  if (ballPhase === 'rally') return Boolean(lastHitter) && lastHitter !== localPlayer;
  return false;
}
function updateBallControls() {
  const connected = socket?.readyState === WebSocket.OPEN;
  ui.synthetic.disabled = !connected || !canSwingNow() || Boolean(pendingRecenter);
  spawnButton.disabled = !connected || ballPhase !== 'idle';
  $('ball-status').textContent =
    !connected ? 'Connect to the court first.'
    : !localPlayer ? 'Waiting for your seat assignment…'
    : canSwingNow() ? (ballPhase === 'ready' ? 'Your serve. Swing when ready.' : 'Your return. Swing!')
    : ballPhase === 'idle' ? 'Tap New ball to play.'
    : ballPhase === 'ready' ? `${readyFor === 'A' ? 'Red' : 'Blue'} is serving. Wait for it to reach you.`
    : ballPhase === 'rally' ? 'Your shot is in flight. Wait for the other side.'
    : ballPhase === 'reset' ? 'Point finished. Get ready…'
    : 'Waiting for court state…';
}
spawnButton.addEventListener('click', () => {
  if (socket?.readyState !== WebSocket.OPEN) return;
  socket.send(JSON.stringify({ t: Date.now(), type: 'spawn' }));
  spawnButton.disabled = true;
  setTimeout(updateBallControls, 500);
});

function setConnection(title, detail, kind = '') {
  ui.connectionTitle.textContent = title;
  if (kind === 'error') ui.sensorDetail.textContent = detail;
  ui.connectionDot.className = `status-dot ${kind}`;
  updateBallControls();
}

function wireURL() {
  const url = new URL('/ws', window.location.href);
  url.protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  url.searchParams.set('role', 'phone');
  const seat = localPlayer || new URLSearchParams(window.location.search).get('seat');
  if (seat === 'A' || seat === 'B') url.searchParams.set('seat', seat);
  return url;
}

function connect() {
  if (closing) return;
  const url = wireURL();
  setConnection(reconnectAttempt ? 'Reconnecting…' : 'Connecting…', `Opening ${url.origin.replace(/^ws/, 'http')} …`);
  try { socket = new WebSocket(url); } catch (error) { scheduleReconnect(error.message); return; }
  socket.addEventListener('open', () => {
    ballPhase = null;
    reconnectAttempt = 0;
    setConnection('Connected to court', 'The phone paddle is on the same relay as the court.', 'connected');
  });
  socket.addEventListener('message', event => {
    let msg;
    try { msg = JSON.parse(event.data); } catch { return; }
    if (msg?.type === 'hello' && ['A', 'B'].includes(msg.player)) {
      localPlayer = msg.player;
      const assignedURL = new URL(window.location.href);
      assignedURL.searchParams.set('seat', localPlayer);
      window.history?.replaceState(null, '', assignedURL);
      const badge = $('seat-badge');
      badge.textContent = localPlayer === 'A' ? 'RED' : 'BLUE';
      badge.className = `seat ${localPlayer === 'A' ? 'team-red' : 'team-blue'}`;

      updateBallControls();
      return;
    }
    if (msg?.type === 'state') {
      if (Array.isArray(msg.score) && localPlayer) {
        $('your-score').textContent = msg.score[localPlayer === 'A' ? 0 : 1];
        $('their-score').textContent = msg.score[localPlayer === 'A' ? 1 : 0];
      }
      if (msg.phase === 'ready' && ballPhase !== 'ready') {
        // A new serve must begin with fresh motion, not the tail of a prior gesture.
        paddleMotion.reset();
        detector.reset();
      }
      ballPhase = msg.phase;
      readyFor = msg.ready_for ?? null;
      lastHitter = msg.last_hitter ?? null;
      updateBallControls();
    }
  });
  socket.addEventListener('close', () => scheduleReconnect('The relay closed the connection.'));
  socket.addEventListener('error', () => setConnection('Cannot reach the laptop', `Check Wi-Fi and use ${window.location.protocol === 'https:' ? 'the printed HTTPS LAN URL' : 'HTTPS, not HTTP, on your phone.'}.`, 'error'));
}

function scheduleReconnect(reason) {
  ui.synthetic.disabled = true;
  setConnection('Waiting for the laptop', reason, 'error');
  if (closing) return;
  clearTimeout(reconnectTimer);
  const delay = Math.min(CONFIG.network.reconnectMs * 2 ** reconnectAttempt++, CONFIG.network.reconnectMs * 8);
  reconnectTimer = setTimeout(connect, delay);
}

function setPermissionError(message) { ui.permissionError.hidden = !message; ui.permissionError.textContent = message || ''; }

async function enableMotion() {
  if (enablingMotion) return;
  setPermissionError('');
  if (window.location.protocol !== 'https:' && !['localhost', '127.0.0.1', '[::1]'].includes(window.location.hostname)) {
    setPermissionError('Open the HTTPS phone link from your laptop to enable motion.'); return;
  }
  if (!('DeviceMotionEvent' in window) || !('DeviceOrientationEvent' in window)) {
    setPermissionError('Motion is unavailable in this browser. You can still tap Swing.'); return;
  }
  enablingMotion = true;
  try {
    // Request both permissions in the tap's activation, before either await.
    const request = type => typeof type.requestPermission === 'function' ? type.requestPermission() : Promise.resolve('granted');
    const permissions = await Promise.all([request(window.DeviceMotionEvent), request(window.DeviceOrientationEvent)]);
    if (permissions.some(value => value !== 'granted')) {
      setPermissionError('Allow both motion and orientation, then tap Enable motion again.'); return;
    }
    if (!motionStarted) {
      window.addEventListener('devicemotion', onMotion, { passive: true });
      window.addEventListener('deviceorientation', onOrientation, { passive: true });
      motionStarted = true;
    }
    clearInterval(controllerTimer);
    controllerTimer = setInterval(sendControllerPose, 1000 / CONFIG.network.controllerHz);
    clearInterval(sensorTimer);
    sensorTimer = setInterval(updateMotionStatus, 100);
    ui.enable.textContent = 'Motion enabled ✓'; ui.enable.disabled = true;
    ui.sensorDetail.textContent = 'Waiting for the phone’s sensors…';
  } catch (error) { setPermissionError(`Motion access failed: ${error?.message || 'please retry'}.`); }
  finally { enablingMotion = false; }
}

function updateMotionStatus() {
  const now = performance.now();
  const fresh = now - latestOrientationAt <= CONFIG.controller.poseTimeoutMs;
  ui.recenter.disabled = !motionStarted || !fresh || Boolean(pendingRecenter);
  if (pendingRecenter) {
    if (now > pendingRecenter.expiresAt) {
      pendingRecenter = null;
      ui.recenter.textContent = 'Recenter paddle';
      ui.sensorDetail.textContent = 'No valid reading. Hold the phone upright and try Recenter again.';
      updateBallControls();
    } else {
      const remaining = Math.ceil((pendingRecenter.captureAfter - now) / 1000);
      ui.recenter.textContent = remaining > 0 ? `Set forward in ${remaining}…` : 'Hold upright…';
    }
  } else if (!fresh && motionStarted) {
    ui.sensorDetail.textContent = 'Waiting for orientation. Keep this page open on your phone.';
  }
}

function beginRecenter() {
  if (!motionStarted || pendingRecenter) return;
  const now = performance.now();
  if (now - latestOrientationAt > CONFIG.controller.poseTimeoutMs) {
    ui.sensorDetail.textContent = 'No fresh orientation reading. Keep this page open and try again.'; return;
  }
  pendingRecenter = { captureAfter: now + 2000, expiresAt: now + 7000 };
  paddleMotion.reset();
  detector.reset();
  lastMotionSwingAt = now;
  sendControllerPose();
  ui.sensorDetail.textContent = 'Turn the SCREEN toward the laptop, top edge up. Hold your normal grip until the countdown finishes. Only the paddle resets.';
  updateMotionStatus(); updateBallControls();
}

function onOrientation(event) {
  const q = orientationQuaternion(event);
  if (!q) return;
  latestOrientation = q;
  latestOrientationAt = performance.now();
  if (pendingRecenter && latestOrientationAt >= pendingRecenter.captureAfter && latestOrientationAt <= pendingRecenter.expiresAt) {
    const reference = forwardReference(q);
    if (reference) {
      neutralOrientation = reference;
      paddleMotion.reset(); detector.reset(); lastMotionSwingAt = latestOrientationAt;
      pendingRecenter = null;
      ui.recenter.textContent = 'Recenter paddle';
      ui.sensorDetail.textContent = 'Forward set ✓ Your grip is centered. Tilt and swing to play.';
      sendControllerPose(); updateBallControls();
    }
  } else if (!neutralOrientation) {
    neutralOrientation = forwardReference(q);
    if (neutralOrientation) ui.sensorDetail.textContent = 'Motion ready. Recenter to set your forward direction.';
  }
  updateMotionStatus();
}
function sendControllerPose() {
  if (pendingRecenter) {
    // Reset the model immediately and hold it at home during the countdown.
    // Repeat with the pose stream so relay throttling cannot lose the reset.
    if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({
      t: Date.now(), type: 'controller_pose', qx: 0, qy: 0, qz: 0, qw: 1,
      ...paddleMotion.pose(),
    }));
    return;
  }
  if (!latestOrientation || !neutralOrientation || socket?.readyState !== WebSocket.OPEN) return;
  if (performance.now() - latestOrientationAt > CONFIG.controller.poseTimeoutMs) return;
  const q = relativeOrientation(latestOrientation, neutralOrientation);
  if (!q) return;
  // Orientation rotates around the handle. Motion fields are transient gesture
  // features; the laptop never treats acceleration as an absolute position.
  socket.send(JSON.stringify({ t: Date.now(), type: 'controller_pose', qx: q.x, qy: q.y, qz: q.z, qw: q.w, ...paddleMotion.pose() }));
}

function onMotion(event) {
  const raw = event.accelerationIncludingGravity;
  if (!raw || !Number.isFinite(raw.x) || !Number.isFinite(raw.y) || !Number.isFinite(raw.z)) return;
  const now = performance.now();
  const swing = detector.update({ t: now, acceleration: { x: raw.x, y: raw.y, z: raw.z }, rotationRate: event.rotationRate || {} });
  if (pendingRecenter) return;
  let movementSwing = null;
  if (latestOrientation && neutralOrientation && now - latestOrientationAt <= CONFIG.controller.poseTimeoutMs) {
    const q = relativeOrientation(latestOrientation, neutralOrientation);
    const linear = event.acceleration;
    if (linear && ['x', 'y', 'z'].every(axis => Number.isFinite(linear[axis]))) {
      movementSwing = paddleMotion.update(now, linear, q, event.rotationRate || {}, { serving: ballPhase === 'ready' });
    }
  }
  const deliberateSwing = ballPhase === 'ready' && swing?.duration_ms < 100 ? null : swing;
  if ((movementSwing || deliberateSwing) && now - lastMotionSwingAt >= 350) {
    if (sendSwing(movementSwing || deliberateSwing, false)) lastMotionSwingAt = now;
  }
}

function sendSwing(swing, synthetic) {
  const rawPeak = Number(swing.peak_g);
  if (!canSwingNow() || pendingRecenter) return false;
  const peak = synthetic ? CONFIG.swing.synthetic.peak_g : rawPeak;
  const message = { t: Date.now(), type: 'swing', peak_g: peak, pitch: Number(swing.pitch) || 0, roll: Number(swing.roll) || 0, yaw_rate: Number(swing.yaw_rate) || 0, duration_ms: Number(swing.duration_ms) || 1 };
  if (socket?.readyState !== WebSocket.OPEN) return false;
  // WebSocket ordering gives the relay the contact orientation before the swing.
  sendControllerPose();
  socket.send(JSON.stringify(message));
  return true;
}

ui.enable.addEventListener('click', enableMotion);
ui.recenter.addEventListener('click', beginRecenter);
ui.synthetic.addEventListener('click', () => sendSwing({ ...CONFIG.swing.synthetic }, true));
window.addEventListener('pagehide', () => { closing = true; pendingRecenter = null; clearTimeout(reconnectTimer); clearInterval(sensorTimer); clearInterval(controllerTimer); socket?.close(); });
window.addEventListener('pageshow', event => {
  if (event.persisted) {
    closing = false;
    if (motionStarted) {
      clearInterval(controllerTimer);
      controllerTimer = setInterval(sendControllerPose, 1000 / CONFIG.network.controllerHz);
      clearInterval(sensorTimer); sensorTimer = setInterval(updateMotionStatus, 100);
    }
    connect();
  }
});

connect();
