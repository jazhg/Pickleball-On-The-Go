import { CONFIG } from '/shared/config.js';
import { SwingDetector, calibratedPeakG, validCalibration } from '/shared/swing-detector.js';

const $ = id => document.getElementById(id);
const ui = {
  connectionTitle: $('connection-title'), connectionDetail: $('connection-detail'), connectionDot: $('connection-dot'),
  addressHint: $('address-hint'), secureBadge: $('secure-badge'), permissionDetail: $('permission-detail'),
  permissionError: $('permission-error'), enable: $('enable-button'), sensorAge: $('sensor-age'), sensorDetail: $('sensor-detail'),
  state: $('reading-state'), peak: $('reading-peak'), pitch: $('reading-pitch'), roll: $('reading-roll'), yaw: $('reading-yaw'), gravity: $('reading-gravity'),
  calibrationBadge: $('calibration-badge'), calibrationDetail: $('calibration-detail'), calibrate: $('calibrate-button'), skip: $('skip-button'),
  soft: $('practice-soft'), medium: $('practice-medium'), hard: $('practice-hard'), synthetic: $('synthetic-button'), sendBadge: $('send-badge'), sendDetail: $('send-detail'),
};
const detector = new SwingDetector(CONFIG);
let socket;
let reconnectTimer;
let reconnectAttempt = 0;
let closing = false;
let motionStarted = false;
let lastSensorAt = 0;
let sensorTimer;
let calibration = null;
let calibrationMode = false;
let practicePeaks = [];
let practiceIndex = 0;

function setConnection(title, detail, kind = '') {
  ui.connectionTitle.textContent = title;
  ui.connectionDetail.textContent = detail;
  ui.connectionDot.className = `status-dot ${kind}`;
  ui.synthetic.disabled = socket?.readyState !== WebSocket.OPEN;
}

function wireURL() {
  const url = new URL('/ws', window.location.href);
  url.protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  url.searchParams.set('role', 'phone');
  return url;
}

function connect() {
  if (closing) return;
  const url = wireURL();
  setConnection(reconnectAttempt ? 'Reconnecting to the laptop' : 'Connecting to the laptop', `Opening ${url.origin.replace(/^ws/, 'http')} …`);
  try { socket = new WebSocket(url); } catch (error) { scheduleReconnect(error.message); return; }
  socket.addEventListener('open', () => {
    reconnectAttempt = 0;
    setConnection('Connected to the laptop', 'The phone paddle is on the same relay as the court.', 'connected');
    ui.sendBadge.textContent = 'READY'; ui.sendBadge.className = 'small-badge good';
    ui.sendDetail.textContent = 'Send a test swing now, or enable motion and swing naturally.';
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

function setSecureStatus() {
  const secure = window.isSecureContext && window.location.protocol === 'https:';
  const localhostException = ['localhost', '127.0.0.1', '[::1]'].includes(window.location.hostname);
  if (secure) {
    ui.secureBadge.textContent = 'HTTPS READY'; ui.secureBadge.className = 'small-badge good';
    ui.permissionDetail.textContent = 'Safari can request DeviceMotion access here. Keep the phone still for a moment after enabling it.';
  } else if (localhostException) {
    ui.secureBadge.textContent = 'LOCAL ONLY'; ui.secureBadge.className = 'small-badge warn';
    ui.permissionDetail.textContent = 'This localhost page can test the relay, but an iPhone on Wi-Fi must use the laptop LAN IP over HTTPS.';
  } else {
    ui.secureBadge.textContent = 'HTTPS REQUIRED'; ui.secureBadge.className = 'small-badge bad';
    ui.permissionDetail.textContent = 'DeviceMotion is blocked on this address. Reopen the exact https:// LAN URL printed by npm start.';
  }
  if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
    ui.addressHint.textContent = 'Phone URL: replace localhost with the laptop LAN IP printed by npm start (for example https://10.5.60.135:8443/client-phone/).';
  }
}

function updateReadings() {
  const readings = detector.readings;
  ui.state.textContent = readings.state;
  ui.peak.textContent = readings.peakG ? `${readings.peakG.toFixed(2)}g` : '—';
  ui.pitch.textContent = readings.gravityKnown ? readings.pitch.toFixed(1) : '—';
  ui.roll.textContent = readings.gravityKnown ? readings.roll.toFixed(1) : '—';
  ui.yaw.textContent = readings.gravityKnown ? readings.yawRate.toFixed(0) : '—';
  ui.gravity.textContent = readings.gravityKnown ? (readings.isStatic ? 'STILL' : 'TRACKING') : 'WAITING';
  if (lastSensorAt) {
    const age = Math.max(0, performance.now() - lastSensorAt);
    ui.sensorAge.textContent = `${Math.round(age)}ms AGO`;
    ui.sensorAge.className = `small-badge ${age < CONFIG.swing.sensorTimeoutMs ? 'good' : 'bad'}`;
  }
}

function setPermissionError(message) { ui.permissionError.hidden = !message; ui.permissionError.textContent = message || ''; }

async function enableMotion() {
  setPermissionError('');
  if (window.location.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(window.location.hostname)) {
    setPermissionError('Safari will not grant motion access over plain HTTP. Open the https:// LAN URL from the server terminal.');
    return;
  }
  if (!('DeviceMotionEvent' in window)) {
    setPermissionError('This browser does not expose DeviceMotionEvent. Use Safari on iOS or Chrome on Android.');
    return;
  }
  try {
    if (typeof DeviceMotionEvent.requestPermission === 'function') {
      const permission = await DeviceMotionEvent.requestPermission();
      if (permission !== 'granted') { setPermissionError(`Motion permission was ${permission}. Tap Enable motion again after allowing it in Safari.`); return; }
    }
    if (!motionStarted) {
      window.addEventListener('devicemotion', onMotion, { passive: true });
      motionStarted = true;
      ui.enable.textContent = 'Motion access enabled ✓'; ui.enable.disabled = true;
      ui.sensorDetail.textContent = 'Hold the phone still for about one second, then swing with the phone as your paddle face.';
      clearInterval(sensorTimer); sensorTimer = setInterval(() => {
        if (motionStarted && lastSensorAt && performance.now() - lastSensorAt > CONFIG.swing.sensorTimeoutMs) {
          ui.sensorDetail.textContent = 'Permission is granted, but no recent motion samples arrived. Keep Safari open and check iOS Settings → Safari → Motion & Orientation Access.';
          ui.sensorAge.className = 'small-badge bad';
        }
      }, 1000);
    }
  } catch (error) { setPermissionError(`Safari did not grant motion access: ${error?.message || 'permission request failed'}.`); }
}

function onMotion(event) {
  const raw = event.accelerationIncludingGravity;
  if (!raw || !Number.isFinite(raw.x) || !Number.isFinite(raw.y) || !Number.isFinite(raw.z)) return;
  const now = performance.now();
  lastSensorAt = now;
  const swing = detector.update({ t: now, acceleration: { x: raw.x, y: raw.y, z: raw.z }, rotationRate: event.rotationRate || {} });
  updateReadings();
  if (swing) sendSwing(swing, false);
}

function loadCalibration() {
  try { const saved = JSON.parse(localStorage.getItem('pickleball-calibration') || 'null'); if (validCalibration(saved, CONFIG)) calibration = saved; } catch { calibration = null; }
  if (calibration) {
    ui.calibrationBadge.textContent = 'SAVED'; ui.calibrationBadge.className = 'small-badge good';
    ui.calibrationDetail.textContent = 'Saved peaks are mapping your acceleration onto the shared ball-speed range.';
    [ui.soft, ui.medium, ui.hard].forEach((node, i) => { node.classList.add('done'); node.querySelector('b').textContent = `${[calibration.soft, calibration.medium, calibration.hard][i].toFixed(2)}g`; });
  }
}

function beginCalibration() {
  if (!motionStarted) { setPermissionError('Enable motion first, then start the three-swing setup.'); return; }
  calibrationMode = true; practicePeaks = []; practiceIndex = 0;
  ui.calibrationBadge.textContent = 'IN PROGRESS'; ui.calibrationBadge.className = 'small-badge warn';
  ui.calibrationDetail.textContent = 'Make a soft swing now. Wait for the state to return to IDLE before the next prompt.';
  [ui.soft, ui.medium, ui.hard].forEach(node => { node.classList.remove('done'); node.querySelector('b').textContent = '—'; });
}

function recordPractice(rawPeak) {
  if (!calibrationMode || practiceIndex >= 3) return rawPeak;
  practicePeaks.push(rawPeak); const current = [ui.soft, ui.medium, ui.hard][practiceIndex];
  current.classList.add('done'); current.querySelector('b').textContent = `${rawPeak.toFixed(2)}g`; practiceIndex += 1;
  if (practiceIndex < 3) ui.calibrationDetail.textContent = `Good. Make a ${['medium', 'hard'][practiceIndex - 1]} swing now.`;
  else if (validCalibration({ soft: practicePeaks[0], medium: practicePeaks[1], hard: practicePeaks[2] }, CONFIG)) {
    calibration = { soft: practicePeaks[0], medium: practicePeaks[1], hard: practicePeaks[2] };
    localStorage.setItem('pickleball-calibration', JSON.stringify(calibration)); calibrationMode = false;
    ui.calibrationBadge.textContent = 'SAVED'; ui.calibrationBadge.className = 'small-badge good'; ui.calibrationDetail.textContent = 'Calibration saved on this phone.';
  } else { calibrationMode = false; ui.calibrationBadge.textContent = 'RETRY'; ui.calibrationBadge.className = 'small-badge warn'; ui.calibrationDetail.textContent = 'The peaks must rise soft < medium < hard. Use defaults or try again with clearer swing strengths.'; }
  return rawPeak;
}

function sendSwing(swing, synthetic) {
  const rawPeak = Number(swing.peak_g);
  if (!synthetic) recordPractice(rawPeak);
  const peak = synthetic ? CONFIG.swing.synthetic.peak_g : calibratedPeakG(rawPeak, calibration, CONFIG);
  const message = { t: Date.now(), type: 'swing', peak_g: peak, pitch: Number(swing.pitch) || 0, roll: Number(swing.roll) || 0, yaw_rate: Number(swing.yaw_rate) || 0, duration_ms: Number(swing.duration_ms) || 1 };
  if (socket?.readyState !== WebSocket.OPEN) { ui.sendBadge.textContent = 'OFFLINE'; ui.sendBadge.className = 'small-badge bad'; ui.sendDetail.textContent = 'Swing detected, but the relay is not connected. Reconnect to the laptop and try again.'; return false; }
  socket.send(JSON.stringify(message));
  ui.sendBadge.textContent = 'SENT'; ui.sendBadge.className = 'small-badge good';
  ui.sendDetail.textContent = `${synthetic ? 'Synthetic' : 'Motion'} swing sent · ${peak.toFixed(2)}g · pitch ${message.pitch.toFixed(1)}°. Watch the laptop court.`;
  return true;
}

ui.enable.addEventListener('click', enableMotion);
ui.calibrate.addEventListener('click', beginCalibration);
ui.skip.addEventListener('click', () => { calibrationMode = false; ui.calibrationBadge.textContent = 'DEFAULT'; ui.calibrationBadge.className = 'small-badge'; ui.calibrationDetail.textContent = 'Using the shared default soft / medium / hard mapping.'; });
ui.synthetic.addEventListener('click', () => sendSwing({ ...CONFIG.swing.synthetic }, true));
window.addEventListener('pagehide', () => { closing = true; clearTimeout(reconnectTimer); clearInterval(sensorTimer); socket?.close(); });
window.addEventListener('pageshow', event => { if (event.persisted) { closing = false; connect(); } });

setSecureStatus(); loadCalibration(); updateReadings(); connect();
