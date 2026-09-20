import { CONFIG } from '/shared/config.js';
import { validMessage } from '/shared/protocol.js';
import { framePaddlePosition } from '/shared/paddle.js';
import { setupTracking } from './tracking.js';

// The laptop renders server snapshots. There is deliberately no ball simulation here.
const THREE_URL = 'https://cdn.jsdelivr.net/npm/three@0.180.0/build/three.module.js';
const ui = Object.fromEntries([
  'court-canvas', 'render-status', 'connection-status', 'score-a', 'score-b',
  'server-number', 'serve-a', 'serve-b', 'phase-dot', 'phase-title',
  'phase-description', 'swing-button', 'swing-hint', 'last-shot',
  'last-shot-detail', 'last-ruling', 'shot-count', 'shot-flash', 'transport-note',
  'voice-toggle', 'evidence-panel', 'evidence-rule', 'evidence-events',
  'evidence-shot', 'analytics-strip', 'coach-tip', 'coach-tip-text', 'coach-tip-dismiss',
].map((id) => [id, document.getElementById(id)]));

// --- Nemotron HUD: classification, voice rulings, evidence, analytics ---
let voiceMuted = false;
let classifyTimer = null;
const analytics = { shots: {}, confSum: 0, confN: 0, rallies: 0, errors: 0 };

const RULE_WORDS = {
  rally_outcome: 'rally over', serve_foot: 'serve foot fault', serve_height: 'serve too high',
  serve_motion: 'illegal serve motion', serve_paddle: 'paddle above the wrist',
  serve_target: 'serve off target', serve_kitchen: 'serve into the kitchen',
  two_bounce: 'two bounce rule', nvz_volley: 'kitchen volley', nvz_momentum: 'kitchen momentum',
};

function speakRuling(message) {
  if (voiceMuted || !('speechSynthesis' in window)) return;
  const words = RULE_WORDS[message.rule] || String(message.rule).replace(/_/g, ' ');
  const text = message.fault
    ? `Fault. Player ${message.player}. ${words}.`
    : 'No fault. Play on.';
  speechSynthesis.cancel();
  speechSynthesis.speak(new SpeechSynthesisUtterance(text));
}

ui['voice-toggle'].addEventListener('click', () => {
  voiceMuted = !voiceMuted;
  ui['voice-toggle'].textContent = voiceMuted ? '🔇 Voice off' : '🔊 Voice on';
  if (voiceMuted && 'speechSynthesis' in window) speechSynthesis.cancel();
});

function renderAnalytics() {
  const entries = Object.entries(analytics.shots);
  const avg = analytics.confN ? Math.round(analytics.confSum / analytics.confN * 100) : 0;
  ui['analytics-strip'].textContent = entries.length
    ? `${entries.map(([shot, n]) => `${shot} ${n}`).join(' · ')} — avg confidence ${avg}% · unforced errors ${analytics.errors}/${analytics.rallies} rallies`
    : 'No shots classified yet.';
}

function receiveClassification(message) {
  if (!validMessage(message)) return;
  clearTimeout(classifyTimer);
  const detail = message.path === 'heuristic' ? 'heuristic fallback · offline'
    : message.path === 'model' ? 'Nemotron live' : `${message.path} path`;
  ui['last-shot'].textContent = `${message.shot} → ${message.target_zone.replace(/_/g, ' ')}`;
  ui['last-shot-detail'].textContent = `Confidence ${(message.confidence * 100).toFixed(0)}% · ${detail}.`;
  analytics.shots[message.shot] = (analytics.shots[message.shot] || 0) + 1;
  analytics.confSum += message.confidence;
  analytics.confN += 1;
  renderAnalytics();
}

function receiveCoachTip(message) {
  if (!validMessage(message)) return;
  ui['coach-tip-text'].textContent = `Coach: ${message.tip}`;
  ui['coach-tip'].hidden = false;
}

ui['coach-tip-dismiss'].addEventListener('click', () => { ui['coach-tip'].hidden = true; });

function receiveRulingEvidence(message) {
  if (!validMessage(message)) return;
  ui['evidence-panel'].hidden = false;
  ui['evidence-rule'].textContent = `Rule cited: ${message.rule}${message.provisional ? ' (provisional — not a reviewed rulebook citation)' : ''} · path: ${message.path}`;
  ui['evidence-events'].replaceChildren(...message.trigger_events.map((e) => {
    const li = document.createElement('li');
    li.textContent = `${e.t}ms — ${e.label}`;
    return li;
  }));
  const shot = message.preceding_shot;
  ui['evidence-shot'].textContent = shot
    ? `Preceding shot: ${shot.shot} → ${shot.target_zone.replace(/_/g, ' ')} · ${(shot.confidence * 100).toFixed(0)}% confidence`
    : 'Preceding shot: none recorded.';
}

let socket;
let latestState = null;
let localPlayer = null;
let seatSign = 1;
let resolveHello;
const helloReady = new Promise((resolve) => { resolveHello = resolve; });
let court = null;
let reconnectTimer = null;
let reconnectAttempt = 0;
let closing = false;
let localSwingAt = 0;
let launches = 0;
let flashTimer;
let rendererReady = false;
let rendererFailed = false;
let playerPosition = { x: CONFIG.player.x, z: CONFIG.player.homeDepth };
let trackingRenderState = { wristOffset: { ...CONFIG.render.neutralPaddleOffset }, jumpHeight: 0 };
let controllerPose = { qx: 0, qy: 0, qz: 0, qw: 1 };
let phoneBaseURL = new URL('/client-phone/', location.href);
const spawnButton = document.getElementById('spawn-button');
spawnButton.addEventListener('click', () => {
  spawnButton.disabled = true;
  if (socket?.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({ t: Date.now(), type: 'spawn' }));
  }
  updateControls();
});

function receivePose(pose) {
  if (pose.player === localPlayer) return;
  court?.updateOpponent(pose);
}
function updateMinimap(pose) {
  const dot = document.getElementById('player-dot');
  dot.setAttribute('cx', 50 + seatSign * pose.court_x / CONFIG.court.width * 94);
  dot.setAttribute('cy', 110 + seatSign * pose.court_y / CONFIG.court.length * 214);
}
function updatePhoneLinks() {
  const url = new URL(phoneBaseURL);
  if (localPlayer) url.searchParams.set('seat', localPlayer);
  document.querySelectorAll('.phone-link').forEach((link) => {
    link.href = url.href;
    if (link.matches('#transport-note a')) link.textContent = url.href;
  });
}
async function discoverPhoneURL() {
  if (!['localhost', '127.0.0.1', '[::1]'].includes(location.hostname)) return;
  try {
    const response = await fetch('/health');
    const health = await response.json();
    if (Array.isArray(health.phone_urls) && health.phone_urls.length) {
      phoneBaseURL = new URL(health.phone_urls[0]);
      updatePhoneLinks();
    }
  } catch { /* Keep the current-origin fallback if LAN discovery is unavailable. */ }
}
setupTracking({ onPose(pose, trackingState) {
  if (trackingState) {
    trackingRenderState = trackingState;
    court?.updateTracking(trackingState);
  }
  if (!pose) return;
  const signed = {
    ...pose,
    court_x: seatSign * pose.court_x,
    court_y: seatSign * Math.abs(pose.court_y),
  };
  playerPosition = { x: signed.court_x, z: signed.court_y };
  updateMinimap(signed);
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(signed));
} });

function setConnection(text, kind = '') {
  ui['connection-status'].className = `connection-status ${kind}`;
  ui['connection-status'].replaceChildren(Object.assign(document.createElement('i'), { ariaHidden: 'true' }), document.createTextNode(text));
}

function updateControls() {
  const connected = socket?.readyState === WebSocket.OPEN;
  const phase = latestState?.phase;
  const canSwing = connected && rendererReady && localPlayer && (
    (phase === 'ready' && latestState?.ready_for === localPlayer) ||
    (phase === 'rally' && latestState?.last_hitter && latestState.last_hitter !== localPlayer)
  );
  ui['swing-button'].disabled = !canSwing;
  spawnButton.disabled = !(connected && rendererReady && phase === 'idle');
  ui['phase-dot'].className = `phase-dot ${connected ? phase || '' : ''}`;
  if (!connected) {
    ui['phase-title'].textContent = 'Connecting to court';
    ui['phase-description'].textContent = 'Keep the relay server running. This page reconnects automatically.';
    ui['swing-hint'].textContent = 'Connect to start playing.';
  } else if (rendererFailed) {
    ui['phase-title'].textContent = 'Court view unavailable';
    ui['phase-description'].textContent = 'Check the message in the court view, then reload this page.';
    ui['swing-hint'].textContent = 'Restore the court view to start playing.';
  } else if (!rendererReady) {
    ui['phase-title'].textContent = 'Preparing your view';
    ui['phase-description'].textContent = 'The server is connected. Waiting for the court renderer.';
    ui['swing-hint'].textContent = 'Your court will be ready shortly.';
  } else if (phase === 'idle') {
    ui['phase-title'].textContent = 'Spawn a ball to start';
    ui['phase-description'].textContent = 'No ball is in play. Request one when you’re ready.';
    ui['swing-hint'].textContent = 'Click Spawn ball here or on your phone.';
  } else if (phase === 'ready') {
    shortBallHint = false;
    ui['phase-title'].textContent = 'Ready when you are';
    ui['phase-description'].textContent = 'The ball is at your paddle. Send it over the net.';
    ui['swing-hint'].textContent = 'Or press the spacebar on your keyboard.';
  } else if (phase === 'rally') {
    ui['phase-title'].textContent = 'Ball in play';
    ui['phase-description'].textContent = 'Follow the flight and watch the far-side bounce.';
    ui['swing-hint'].textContent = 'After this shot, click Spawn ball to play again.';
  } else if (phase === 'reset') {
    ui['phase-title'].textContent = shortBallHint ? 'Never made it over' : 'Shot finished';
    ui['phase-description'].textContent = shortBallHint
      ? 'That swing did not carry the ball to the net.'
      : 'The ball will clear, then you can request another.';
    ui['swing-hint'].textContent = shortBallHint
      ? 'Swing faster, or tilt the paddle face up to lift it over.'
      : 'The next ball waits for your button press.';
  } else {
    ui['phase-title'].textContent = 'Waiting for the ball';
    ui['phase-description'].textContent = 'Connected to the relay. Waiting for its first snapshot.';
    ui['swing-hint'].textContent = 'The server controls the ball.';
  }
}

function isState(message) {
  return message.type === 'state' && Number.isFinite(message.t)
    && ['idle', 'ready', 'rally', 'reset'].includes(message.phase)
    && [1, 2].includes(message.server)
    && Array.isArray(message.score) && message.score.length === 2
    && message.score.every((n) => Number.isInteger(n) && n >= 0)
    && message.ball && ['x', 'y', 'z', 'vx', 'vy', 'vz'].every((key) => Number.isFinite(message.ball[key]));
}

// A rally that never reached the far side was hit too softly or too flat. Say so
// plainly: that is the whole feel of the game to learn.
let crossedNet = false;
let shortBallHint = false;

function receiveState(state) {
  const previousPhase = latestState?.phase;
  const myTurn = localPlayer && (
    (state.phase === 'ready' && state.ready_for === localPlayer)
    || (state.phase === 'rally' && state.last_hitter && state.last_hitter !== localPlayer));
  court?.showAim?.(myTurn);
  if (state.last_hitter === localPlayer && latestState?.last_hitter !== localPlayer) court?.playSwing?.();
  if (state.phase === 'rally') {
    if (state.ball.z * seatSign < 0) crossedNet = true;
  } else if (previousPhase === 'rally' && state.phase !== 'rally') {
    shortBallHint = !crossedNet && latestState?.last_hitter === localPlayer;
    crossedNet = false;
  }
  if (state.players && court && typeof court.updateOpponent === 'function') {
    const opponentKey = localPlayer ? Object.keys(state.players).find((key) => key !== localPlayer) : Object.keys(state.players)[0];
    if (opponentKey) court.updateOpponent(state.players[opponentKey]);
  }
  if (state.phase === 'rally' && previousPhase === 'ready') {
    launches += 1;
    ui['coach-tip'].hidden = true; // a tip belongs to the previous swing
    ui['last-shot'].textContent = 'Classifying…';
    ui['last-shot-detail'].textContent = Date.now() - localSwingAt < 1500
      ? `Synthetic swing · ${CONFIG.swing.synthetic.peak_g.toFixed(1)}g`
      : 'Remote swing received by the server.';
    // If the classifier child dies, never hang on "Classifying…": the next
    // swing resets it, and this timer clears it after a short wait.
    clearTimeout(classifyTimer);
    classifyTimer = setTimeout(() => {
      if (ui['last-shot'].textContent === 'Classifying…') {
        ui['last-shot'].textContent = 'Unclassified';
        ui['last-shot-detail'].textContent = 'Classifier unavailable for this swing.';
      }
    }, 2000);
    ui['shot-count'].textContent = `#${String(launches).padStart(2, '0')}`;
    ui['shot-flash'].classList.add('visible');
    clearTimeout(flashTimer);
    flashTimer = setTimeout(() => ui['shot-flash'].classList.remove('visible'), 900);
  }
  latestState = state;
  ui['score-a'].textContent = String(state.score[0]).padStart(2, '0');
  ui['score-b'].textContent = String(state.score[1]).padStart(2, '0');
  ui['server-number'].textContent = state.server;
  ui['serve-a'].hidden = state.server !== 1;
  ui['serve-b'].hidden = state.server !== 2;
  court?.applyState(state, previousPhase);
  // Only rewrite explanatory UI when the phase changes, not on every 60 Hz snapshot.
  if (state.phase !== previousPhase) updateControls();
}

function receiveRuling(message) {
  if (typeof message.fault !== 'boolean' || !['A', 'B', null].includes(message.player)
    || typeof message.rule !== 'string' || typeof message.explanation !== 'string'
    || typeof message.side_out !== 'boolean' || !Array.isArray(message.score)
    || message.score.length !== 2 || !message.score.every((n) => Number.isInteger(n) && n >= 0)) return;
  const reference = message.rule === 'none' ? '' : ` · ${message.rule}`;
  ui['last-ruling'].textContent = `${message.fault ? `Fault${message.player ? ` · Player ${message.player}` : ''}` : 'No fault'}${reference}. ${message.explanation}`;
  ui['score-a'].textContent = String(message.score[0]).padStart(2, '0');
  ui['score-b'].textContent = String(message.score[1]).padStart(2, '0');
  analytics.rallies += 1;
  if (message.fault && message.player === 'A') analytics.errors += 1;
  renderAnalytics();
  speakRuling(message);
}

function connect() {
  if (closing) return;
  setConnection(reconnectAttempt ? 'Reconnecting' : 'Connecting');
  const url = new URL('/ws', window.location.href);
  url.protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  url.searchParams.set('role', 'laptop');
  const seat = new URLSearchParams(window.location.search).get('seat');
  if (seat === 'A' || seat === 'B') url.searchParams.set('seat', seat);
  socket = new WebSocket(url);
  socket.addEventListener('open', () => {
    reconnectAttempt = 0;
    latestState = null;
    court?.clearTrail();
    setConnection('Live connection', 'connected');
    updateControls();
  });
  socket.addEventListener('message', (event) => {
    let message;
    try { message = JSON.parse(event.data); } catch { return; }
    if (!message || typeof message !== 'object') return;
    if (message.type === 'hello' && ['A', 'B'].includes(message.player)) {
      localPlayer = message.player;
      seatSign = localPlayer === 'A' ? 1 : -1;
      document.getElementById('seat-badge').textContent = `YOU ARE PLAYER ${localPlayer}`;
      updatePhoneLinks();
      document.querySelectorAll('.player-label').forEach((label, index) => {
        label.classList.toggle('is-local', localPlayer === (index === 0 ? 'A' : 'B'));
      });
      resolveHello();
      updateControls();
      return;
    }
    if (isState(message)) receiveState(message);
    else if (message.type === 'controller_pose' && validMessage(message)) {
      controllerPose = message;
      court?.updateController(message);
    }
    else if (message.type === 'pose' && Number.isFinite(message.court_x) && Number.isFinite(message.court_y)) receivePose(message);
    else if (message.type === 'ruling') receiveRuling(message);
    else if (message.type === 'classification') receiveClassification(message);
    else if (message.type === 'coach_tip') receiveCoachTip(message);
    else if (message.type === 'ruling_evidence') receiveRulingEvidence(message);
  });
  socket.addEventListener('close', () => {
    setConnection('Connection lost', 'disconnected');
    updateControls();
    if (!closing) {
      clearTimeout(reconnectTimer);
      reconnectTimer = setTimeout(connect, Math.min(CONFIG.network.reconnectMs * 2 ** reconnectAttempt++, CONFIG.network.reconnectMs * 8));
    }
  });
  // close schedules retries for both transport failures and unavailable servers.
  socket.addEventListener('error', () => setConnection('Relay unavailable', 'disconnected'));
}

function swing() {
  if (ui['swing-button'].disabled || socket?.readyState !== WebSocket.OPEN) return;
  localSwingAt = Date.now();
  socket.send(JSON.stringify({ t: localSwingAt, type: 'swing', ...CONFIG.swing.synthetic }));
  ui['swing-button'].disabled = true;
  ui['swing-hint'].textContent = 'Swing sent. Waiting for contact…';
  // A missed or rejected contact does not change the wire schema or strand the button.
  setTimeout(updateControls, 500);
}

ui['swing-button'].addEventListener('click', swing);
window.addEventListener('keydown', (event) => {
  if (event.code !== 'Space' || event.repeat || event.altKey || event.ctrlKey || event.metaKey) return;
  if (event.target instanceof HTMLElement && (event.target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(event.target.tagName))) return;
  event.preventDefault();
  swing();
});
window.addEventListener('pagehide', () => {
  closing = true;
  clearTimeout(reconnectTimer);
  socket?.close();
});
window.addEventListener('pageshow', (event) => {
  if (event.persisted) { closing = false; connect(); }
});

const phoneLink = document.createElement('a');
phoneLink.className = 'phone-link';
phoneLink.href = phoneBaseURL.href;
phoneLink.textContent = phoneBaseURL.href;
phoneLink.target = '_blank';
phoneLink.rel = 'noopener';
const isLocalhost = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
const seatAURL = new URL('/client-laptop/', location.href);
const seatBURL = new URL('/client-laptop/', location.href);
seatAURL.searchParams.set('seat', 'A');
seatBURL.searchParams.set('seat', 'B');
const seatALink = document.getElementById('seat-a-link');
const seatBLink = document.getElementById('seat-b-link');
seatALink.href = seatAURL.href;
seatALink.textContent = 'Player A laptop';
seatBLink.href = seatBURL.href;
seatBLink.textContent = 'Player B laptop';
ui['transport-note'].append('Phone setup: ', phoneLink, document.createTextNode(isLocalhost
  ? ' · On your phone, replace localhost with this laptop’s LAN IP and use HTTPS. Install and fully trust the mkcert CA on iOS.'
  : location.protocol === 'https:'
    ? ' · Use this address on the same Wi-Fi. On iOS, install and fully trust the mkcert CA before enabling motion.'
    : ' · Phone motion needs HTTPS. Start the server with a trusted mkcert certificate, then open this address using https://.'));
updatePhoneLinks();
discoverPhoneURL();

function createCourt(THREE) {
  const container = ui['court-canvas'];
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#c5d6c0');
  scene.fog = new THREE.Fog('#c5d6c0', 23, 65);
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.1;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  container.append(renderer.domElement);
  renderer.domElement.setAttribute('aria-label', 'First-person 3D view of the regulation pickleball court and authoritative ball');
  renderer.domElement.setAttribute('role', 'img');

  const attack = -seatSign;
  playerPosition = { x: CONFIG.player.x, z: seatSign * CONFIG.player.homeDepth };
  const camera = new THREE.PerspectiveCamera(90, 1, 0.05, 100);
  const cameraTarget = new THREE.Vector3(playerPosition.x, CONFIG.render.eyeHeight, playerPosition.z);
  camera.position.copy(cameraTarget);
  scene.add(camera);
  scene.add(new THREE.HemisphereLight('#f8fff0', '#526d4e', 2.3));
  const sun = new THREE.DirectionalLight('#fff1cd', 3);
  sun.position.set(-8, 15, -5);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -12, right: 12, top: 14, bottom: -14, near: 0.5, far: 45 });
  sun.shadow.bias = -0.0005;
  scene.add(sun);

  const { width, length, netHeight, netPostHeight, kitchenDepth, lineWidth } = CONFIG.court;
  function box(w, h, d, color, x = 0, y = 0, z = 0, options = {}) {
    const object = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshStandardMaterial({ color, roughness: 0.92, ...options }));
    object.position.set(x, y, z);
    object.receiveShadow = true;
    scene.add(object);
    return object;
  }
  box(150, 0.12, 150, '#97aa83', 0, -0.12, 0);
  box(width + 6, 0.08, length + 5.5, '#4b7964', 0, -0.046, 0);
  box(width, 0.015, length, '#397d76', 0, -0.0085, 0);
  box(width, 0.017, kitchenDepth * 2, '#88a881', 0, -0.0085, 0);
  const lineColor = '#eff0cf';
  const lineY = 0.002;
  // The outside of the painted lines is the 20 × 44 ft court boundary.
  for (const x of [-width / 2 + lineWidth / 2, width / 2 - lineWidth / 2]) box(lineWidth, 0.005, length, lineColor, x, lineY, 0);
  for (const z of [-length / 2 + lineWidth / 2, length / 2 - lineWidth / 2]) box(width, 0.005, lineWidth, lineColor, 0, lineY, z);
  for (const sign of [-1, 1]) {
    box(width, 0.005, lineWidth, lineColor, 0, lineY, sign * (kitchenDepth - lineWidth / 2));
    const serviceLength = length / 2 - kitchenDepth;
    box(lineWidth, 0.005, serviceLength, lineColor, 0, lineY, sign * (kitchenDepth + serviceLength / 2));
  }

  // A visible mesh net and its tape give the flight a fixed height reference.
  const net = new THREE.Mesh(new THREE.PlaneGeometry(width + 0.16, netHeight), new THREE.MeshBasicMaterial({ color: '#253b30', transparent: true, opacity: 0.12, side: THREE.DoubleSide, depthWrite: false }));
  net.position.set(0, netHeight / 2, 0);
  scene.add(net);
  const netPoints = [];
  for (let x = -width / 2; x <= width / 2; x += 0.12) netPoints.push(x, 0.06, 0, x, netHeight, 0);
  for (let y = 0.06; y <= netHeight; y += 0.105) netPoints.push(-width / 2, y, 0, width / 2, y, 0);
  const netGeometry = new THREE.BufferGeometry();
  netGeometry.setAttribute('position', new THREE.Float32BufferAttribute(netPoints, 3));
  scene.add(new THREE.LineSegments(netGeometry, new THREE.LineBasicMaterial({ color: '#233e30', transparent: true, opacity: 0.5 })));
  box(width + 0.25, 0.035, 0.035, '#f7f3d7', 0, netHeight - 0.0175, 0);
  for (const x of [-width / 2 - 0.12, width / 2 + 0.12]) {
    const post = box(0.065, netPostHeight, 0.065, '#243e2e', x, netPostHeight / 2, 0);
    post.castShadow = true;
    box(0.22, 0.05, 0.3, '#304a36', x, 0.025, 0);
  }
  box(0.034, netHeight, 0.025, '#e8e6c8', 0, netHeight / 2, 0.022);

  // Low back fences and planting keep the horizon legible without a second station.
  const backZ = -length / 2 - 2.2;
  for (const x of [-5.4, -2.7, 0, 2.7, 5.4]) box(0.055, 2.1, 0.055, '#4c6752', x, 1.05, backZ);
  box(10.8, 0.055, 0.055, '#4c6752', 0, 2.1, backZ);
  const fence = new THREE.Mesh(new THREE.PlaneGeometry(10.8, 2.1), new THREE.MeshBasicMaterial({ color: '#587d5d', transparent: true, opacity: 0.18, side: THREE.DoubleSide }));
  fence.position.set(0, 1.05, backZ);
  scene.add(fence);
  for (let i = 0; i < 14; i += 1) {
    const x = (i - 6.5) * 3.2;
    const z = -16 - (i % 3) * 2.2;
    const height = 3.2 + (i % 4) * 0.6;
    box(0.22, height * 0.6, 0.22, '#6a7952', x, height * 0.3, z);
    const crown = new THREE.Mesh(new THREE.IcosahedronGeometry(height * 0.42, 1), new THREE.MeshStandardMaterial({ color: i % 2 ? '#748f66' : '#829b6e', roughness: 1, flatShading: true }));
    crown.position.set(x, height * 0.85, z);
    crown.scale.set(0.8, 1.25, 0.8);
    crown.castShadow = true;
    scene.add(crown);
  }

  const ball = new THREE.Mesh(new THREE.SphereGeometry(CONFIG.physics.ballRadius, 24, 16), new THREE.MeshStandardMaterial({ color: '#e9ff50', roughness: 0.5, emissive: '#a9bd22', emissiveIntensity: 0.32 }));
  ball.castShadow = true;
  ball.visible = false;
  scene.add(ball);
  // Render-only halo improves readability at the far baseline; sphere size stays physical.
  const haloCanvas = document.createElement('canvas');
  haloCanvas.width = haloCanvas.height = 64;
  const context = haloCanvas.getContext('2d');
  const gradient = context.createRadialGradient(32, 32, 3, 32, 32, 32);
  gradient.addColorStop(0, 'rgba(223,255,100,.45)');
  gradient.addColorStop(0.25, 'rgba(223,255,100,.18)');
  gradient.addColorStop(1, 'rgba(223,255,100,0)');
  context.fillStyle = gradient;
  context.fillRect(0, 0, 64, 64);
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(haloCanvas), transparent: true, depthWrite: false, opacity: 0.55 }));
  glow.scale.set(0.24, 0.24, 1);
  ball.add(glow);

  const ballShadow = new THREE.Mesh(new THREE.CircleGeometry(0.09, 24), new THREE.MeshBasicMaterial({ color: '#173e2f', transparent: true, opacity: 0.3, depthWrite: false }));
  ballShadow.rotation.x = -Math.PI / 2;
  ballShadow.visible = false;
  scene.add(ballShadow);
  const readyRing = new THREE.Mesh(new THREE.RingGeometry(0.12, 0.13, 40), new THREE.MeshBasicMaterial({ color: '#d5ef72', transparent: true, opacity: 0.65, side: THREE.DoubleSide }));
  readyRing.rotation.x = -Math.PI / 2;
  readyRing.visible = false;
  scene.add(readyRing);
  const playerRing = new THREE.Mesh(new THREE.RingGeometry(CONFIG.tracking.markerRadius * 0.85, CONFIG.tracking.markerRadius, 48), new THREE.MeshBasicMaterial({ color: '#e7f59a', side: THREE.DoubleSide }));
  playerRing.rotation.x = -Math.PI / 2;
  scene.add(playerRing);

  // Camera-local first-person paddle. Geometry/materials are created once and the
  // whole assembly inherits court movement and jump height from the camera.
  const paddle = new THREE.Group();
  const grip = new THREE.Group();
  grip.rotation.z = CONFIG.render.gripRollDeg * Math.PI / 180;
  paddle.add(grip);
  const face = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.17, 0.035, 32), new THREE.MeshStandardMaterial({ color: '#dbe86b', roughness: 0.55, metalness: 0.03 }));
  face.rotation.x = Math.PI / 2;
  face.scale.set(0.92, 1, 1.22);
  face.castShadow = true;
  grip.add(face);
  const rim = new THREE.Mesh(new THREE.TorusGeometry(0.17, 0.012, 8, 32), new THREE.MeshStandardMaterial({ color: '#173f39', roughness: 0.7 }));
  rim.scale.y = 1.22;
  rim.castShadow = true;
  grip.add(rim);
  const handle = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.22, 0.055), new THREE.MeshStandardMaterial({ color: '#5d3f28', roughness: 0.9 }));
  handle.position.y = -0.28;
  handle.castShadow = true;
  grip.add(handle);
  // Aim pointer along paddle-local -Z: the exact direction the server launches
  // the ball from this face, so "it goes where I point" is visible before the hit.
  const aimLength = CONFIG.render.aimLineLength;
  const aimGeometry = new THREE.CylinderGeometry(0.0045, 0.0045, aimLength, 6);
  aimGeometry.translate(0, aimLength / 2, 0);
  const aimMaterial = new THREE.MeshBasicMaterial({ color: '#e7f59a', transparent: true, opacity: 0.42, depthWrite: false });
  const aimLine = new THREE.Mesh(aimGeometry, aimMaterial);
  aimLine.rotation.x = -Math.PI / 2;
  const aimTip = new THREE.Mesh(new THREE.ConeGeometry(0.022, 0.06, 10), aimMaterial);
  aimTip.position.y = aimLength;
  aimLine.add(aimTip);
  aimLine.visible = false;
  paddle.add(aimLine);

  const paddleTargetPosition = new THREE.Vector3(CONFIG.render.neutralPaddleOffset.x, CONFIG.render.neutralPaddleOffset.y, CONFIG.render.neutralPaddleOffset.z);
  const paddleTargetQuaternion = new THREE.Quaternion(0, 0, 0, 1);
  // Smoothed pose, kept apart from the rendered transform so the contact
  // animation can ride on top without feeding its own offset back in.
  const paddleBasePosition = paddleTargetPosition.clone();
  const paddleBaseQuaternion = new THREE.Quaternion(0, 0, 0, 1);
  const swingSpin = new THREE.Quaternion();
  const SWING_AXIS = new THREE.Vector3(1, 0.35, 0).normalize();
  let swingStartedAt = -Infinity;
  paddle.position.copy(paddleTargetPosition);
  camera.add(paddle);
  function playSwing() { swingStartedAt = performance.now(); }
  function showAim(visible) { aimLine.visible = Boolean(visible); }
  function updateTracking(state) {
    if (!state?.wristOffset || !Number.isFinite(state.jumpHeight)) return;
    paddleTargetPosition.set(state.wristOffset.x, state.wristOffset.y, Math.min(-0.22, state.wristOffset.z));
  }
  function updateController(pose) {
    if (!validMessage(pose)) return;
    paddleTargetQuaternion.set(pose.qx, pose.qy, pose.qz, pose.qw).normalize();
  }
  updateTracking(trackingRenderState);
  updateController(controllerPose);

  const opponentGroup = new THREE.Group();
  const opponentBody = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.28, 0.9, 20), new THREE.MeshStandardMaterial({ color: '#d5e3ff', roughness: 0.7 }));
  opponentBody.position.y = 0.45;
  opponentGroup.add(opponentBody);
  const opponentHead = new THREE.Mesh(new THREE.SphereGeometry(0.18, 18, 18), new THREE.MeshStandardMaterial({ color: '#f8d09b', roughness: 0.9 }));
  opponentHead.position.y = 1.0;
  opponentGroup.add(opponentHead);
  const opponentPaddle = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.03, 0.55), new THREE.MeshStandardMaterial({ color: '#f0d36a', roughness: 0.65 }));
  opponentPaddle.position.set(0, 0.85, 0.38);
  opponentGroup.add(opponentPaddle);
  opponentGroup.visible = false;
  scene.add(opponentGroup);

  const trailLength = Math.max(2, Math.floor(CONFIG.render.trailLength));
  const trailPositions = new Float32Array(trailLength * 3);
  const trailColors = new Float32Array(trailLength * 3);
  const trailGeometry = new THREE.BufferGeometry();
  trailGeometry.setAttribute('position', new THREE.BufferAttribute(trailPositions, 3));
  trailGeometry.setAttribute('color', new THREE.BufferAttribute(trailColors, 3));
  trailGeometry.setDrawRange(0, 0);
  const trail = new THREE.Line(trailGeometry, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.8, depthWrite: false }));
  trail.frustumCulled = false;
  scene.add(trail);
  const samples = [];
  function clearTrail() {
    samples.length = 0;
    trailGeometry.setDrawRange(0, 0);
  }
  function applyState(state, previousPhase) {
    if (state.phase !== 'rally' || previousPhase !== 'rally') clearTrail();
    ball.visible = ballShadow.visible = state.phase !== 'idle';
    ball.position.set(state.ball.x, state.ball.y, state.ball.z);
    ballShadow.position.set(state.ball.x, 0.006, state.ball.z);
    ballShadow.scale.setScalar(1 + Math.max(0, state.ball.y) * 0.25);
    ballShadow.material.opacity = 0.3 / (1 + Math.max(0, state.ball.y) * 0.45);
    readyRing.visible = state.phase === 'ready';
    readyRing.position.set(state.ball.x, 0.008, state.ball.z);
    if (state.phase === 'rally') {
      samples.push({ x: state.ball.x, y: state.ball.y, z: state.ball.z });
      if (samples.length > trailLength) samples.shift();
      samples.forEach((point, index) => {
        trailPositions.set([point.x, point.y, point.z], index * 3);
        const intensity = 0.18 + 0.82 * index / Math.max(samples.length - 1, 1);
        trailColors.set([0.84 * intensity, intensity, 0.3 * intensity], index * 3);
      });
      trailGeometry.attributes.position.needsUpdate = true;
      trailGeometry.attributes.color.needsUpdate = true;
      trailGeometry.setDrawRange(0, samples.length);
    }
  }
  function updateOpponent(pose) {
    if (!pose || !Number.isFinite(pose.court_x) || !Number.isFinite(pose.court_y)) {
      opponentGroup.visible = false;
      return;
    }
    opponentGroup.visible = true;
    opponentGroup.position.set(pose.court_x, 0, pose.court_y);
    opponentGroup.rotation.y = seatSign > 0 ? 0 : Math.PI;
    opponentPaddle.rotation.x = -0.6 + ((pose.torso_deg || 0) / 180) * 0.7;
    opponentPaddle.rotation.z = ((pose.torso_deg || 0) / 140) * 0.6;
  }

  const resizeObserver = new ResizeObserver(() => {
    const { width: canvasWidth, height: canvasHeight } = container.getBoundingClientRect();
    if (!canvasWidth || !canvasHeight) return;
    renderer.setSize(canvasWidth, canvasHeight);
    camera.aspect = canvasWidth / canvasHeight;
    camera.updateProjectionMatrix();
  });
  resizeObserver.observe(container);
  renderer.setAnimationLoop(() => {
    cameraTarget.set(playerPosition.x, CONFIG.render.eyeHeight + trackingRenderState.jumpHeight, playerPosition.z);
    playerRing.position.set(playerPosition.x, 0.012, playerPosition.z);
    camera.position.lerp(cameraTarget, CONFIG.render.cameraAlpha);
    camera.lookAt(playerPosition.x * 0.3, 1.0, playerPosition.z + attack * 6);
    paddleBasePosition.lerp(paddleTargetPosition, CONFIG.render.paddlePositionAlpha);
    // Track a fast swing one-to-one but stay calm in a resting hand: the further
    // the paddle has fallen behind the phone, the harder it catches up.
    const lag = paddleBaseQuaternion.angleTo(paddleTargetQuaternion);
    paddleBaseQuaternion.slerp(paddleTargetQuaternion, Math.min(
      CONFIG.render.paddleRotationMaxAlpha,
      CONFIG.render.paddleRotationAlpha + lag * CONFIG.render.paddleRotationGain,
    ));
    // Frame the paddle against the live frustum rather than trusting fixed metres
    // to land on screen; the tracked hand only nudges it from that resting spot.
    const frame = CONFIG.render.paddleFrame;
    const placed = framePaddlePosition({
      fovDeg: camera.fov, aspect: camera.aspect, depth: paddleBasePosition.z,
      dx: paddleBasePosition.x - CONFIG.render.neutralPaddleOffset.x,
      dy: paddleBasePosition.y - CONFIG.render.neutralPaddleOffset.y,
      rest: frame, limit: frame.limit,
    });
    paddle.position.set(placed.x, placed.y, paddleBasePosition.z);
    paddle.quaternion.copy(paddleBaseQuaternion);
    // Contact drives the paddle through the ball and back: a half sine, so it
    // leaves and returns to the live phone pose with no snap at either end.
    const sinceSwing = performance.now() - swingStartedAt;
    if (sinceSwing >= 0 && sinceSwing < CONFIG.render.swingMs) {
      const arc = Math.sin(Math.PI * sinceSwing / CONFIG.render.swingMs);
      paddle.position.z -= arc * CONFIG.render.swingReach;
      paddle.position.y += arc * CONFIG.render.swingRise;
      paddle.quaternion.multiply(swingSpin.setFromAxisAngle(SWING_AXIS, arc * CONFIG.render.swingTwistDeg * Math.PI / 180));
    }
    renderer.render(scene, camera);
  });
  renderer.domElement.addEventListener('webglcontextlost', (event) => {
    event.preventDefault();
    rendererReady = false;
    showRenderError('The 3D graphics context was interrupted. Reload this page to reconnect the court.');
    updateControls();
  });
  return { applyState, clearTrail, updateOpponent, updateTracking, updateController, playSwing, showAim };
}

function showRenderError(message) {
  rendererFailed = true;
  ui['render-status'].hidden = false;
  ui['render-status'].classList.add('failed');
  ui['render-status'].querySelector('strong').textContent = 'The court couldn’t load';
  ui['render-status'].querySelector('span:last-child').textContent = message;
}

connect();
const slowLoadTimer = setTimeout(() => {
  ui['render-status'].querySelector('span:last-child').textContent = 'Still loading Three.js from the CDN. An internet connection is needed on the first load.';
}, 8000);
try {
  const [THREE] = await Promise.all([import(THREE_URL), helloReady]);
  clearTimeout(slowLoadTimer);
  court = createCourt(THREE);
  rendererReady = true;
  ui['render-status'].hidden = true;
  if (latestState) court.applyState(latestState, null);
  updateControls();
} catch (error) {
  clearTimeout(slowLoadTimer);
  console.error('Court renderer failed:', error);
  showRenderError('Check your internet connection and WebGL support, then reload. Three.js is loaded from cdn.jsdelivr.net.');
  updateControls();
}
