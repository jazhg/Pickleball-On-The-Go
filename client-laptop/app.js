import { CONFIG } from '/shared/config.js';
import { setupTracking } from './tracking.js';

// The laptop renders server snapshots. There is deliberately no ball simulation here.
const THREE_URL = 'https://cdn.jsdelivr.net/npm/three@0.180.0/build/three.module.js';
const ui = Object.fromEntries([
  'court-canvas', 'render-status', 'connection-status', 'score-a', 'score-b',
  'server-number', 'serve-a', 'serve-b', 'phase-dot', 'phase-title',
  'phase-description', 'swing-button', 'swing-hint', 'last-shot',
  'last-shot-detail', 'last-ruling', 'shot-count', 'shot-flash', 'transport-note',
].map((id) => [id, document.getElementById(id)]));

let socket;
let latestState = null;
let court = null;
let reconnectTimer = null;
let reconnectAttempt = 0;
let closing = false;
let localSwingAt = 0;
let launches = 0;
let flashTimer;
let rendererReady = false;
let rendererFailed = false;
let playerPosition = { x: CONFIG.player.x, z: CONFIG.player.z };
const spawnButton = document.getElementById('spawn-button');
spawnButton.addEventListener('click', async () => {
  spawnButton.disabled = true;
  try {
    const response = await fetch('/api/spawn', { method: 'POST' });
    if (!response.ok) throw new Error('Wait until this shot finishes before spawning the next ball.');
  } catch (error) { ui['swing-hint'].textContent = error.message; }
  finally { updateControls(); }
});

function receivePose(pose) {
  playerPosition = { x: pose.court_x, z: pose.court_y };
  document.getElementById('player-dot').setAttribute('cx', 50 + pose.court_x / CONFIG.court.width * 94);
  document.getElementById('player-dot').setAttribute('cy', 110 + pose.court_y / CONFIG.court.length * 214);
}
setupTracking({ onPose(pose) {
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(pose));
} });

function setConnection(text, kind = '') {
  ui['connection-status'].className = `connection-status ${kind}`;
  ui['connection-status'].replaceChildren(Object.assign(document.createElement('i'), { ariaHidden: 'true' }), document.createTextNode(text));
}

function updateControls() {
  const connected = socket?.readyState === WebSocket.OPEN;
  const phase = latestState?.phase;
  const canSwing = connected && rendererReady && phase === 'ready';
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
    ui['phase-title'].textContent = 'Ready when you are';
    ui['phase-description'].textContent = 'The ball is at your paddle. Send it over the net.';
    ui['swing-hint'].textContent = 'Or press the spacebar on your keyboard.';
  } else if (phase === 'rally') {
    ui['phase-title'].textContent = 'Ball in play';
    ui['phase-description'].textContent = 'Follow the flight and watch the far-side bounce.';
    ui['swing-hint'].textContent = 'After this shot, click Spawn ball to play again.';
  } else if (phase === 'reset') {
    ui['phase-title'].textContent = 'Shot finished';
    ui['phase-description'].textContent = 'The ball will clear, then you can request another.';
    ui['swing-hint'].textContent = 'The next ball waits for your button press.';
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

function receiveState(state) {
  const previousPhase = latestState?.phase;
  if (state.phase === 'rally' && previousPhase === 'ready') {
    launches += 1;
    ui['last-shot'].textContent = 'Unclassified · milestone 1';
    ui['last-shot-detail'].textContent = Date.now() - localSwingAt < 1500
      ? `Synthetic swing · ${CONFIG.swing.synthetic.peak_g.toFixed(1)}g`
      : 'Remote swing received by the server.';
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
}

function connect() {
  if (closing) return;
  setConnection(reconnectAttempt ? 'Reconnecting' : 'Connecting');
  const url = new URL('/ws', window.location.href);
  url.protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  url.searchParams.set('role', 'laptop');
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
    if (isState(message)) receiveState(message);
    else if (message.type === 'pose' && Number.isFinite(message.court_x) && Number.isFinite(message.court_y)) receivePose(message);
    else if (message.type === 'ruling') receiveRuling(message);
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

const phoneURL = new URL('/client-phone/', location.href);
const phoneLink = document.createElement('a');
phoneLink.href = phoneURL.href;
phoneLink.textContent = phoneURL.href;
phoneLink.target = '_blank';
phoneLink.rel = 'noopener';
const isLocalhost = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
ui['transport-note'].append('Phone setup: ', phoneLink, document.createTextNode(isLocalhost
  ? ' · On your phone, replace localhost with this laptop’s LAN IP and use HTTPS. Install and fully trust the mkcert CA on iOS.'
  : location.protocol === 'https:'
    ? ' · Use this address on the same Wi-Fi. On iOS, install and fully trust the mkcert CA before enabling motion.'
    : ' · Phone motion needs HTTPS. Start the server with a trusted mkcert certificate, then open this address using https://.'));

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

  const camera = new THREE.PerspectiveCamera(90, 1, 0.05, 100);
  const cameraTarget = new THREE.Vector3(CONFIG.player.x, CONFIG.render.eyeHeight, CONFIG.player.z);
  camera.position.copy(cameraTarget);
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

  const resizeObserver = new ResizeObserver(() => {
    const { width: canvasWidth, height: canvasHeight } = container.getBoundingClientRect();
    if (!canvasWidth || !canvasHeight) return;
    renderer.setSize(canvasWidth, canvasHeight);
    camera.aspect = canvasWidth / canvasHeight;
    camera.updateProjectionMatrix();
  });
  resizeObserver.observe(container);
  renderer.setAnimationLoop(() => {
    cameraTarget.set(playerPosition.x, CONFIG.render.eyeHeight, playerPosition.z);
    playerRing.position.set(playerPosition.x, 0.012, playerPosition.z);
    camera.position.lerp(cameraTarget, CONFIG.render.cameraAlpha);
    camera.lookAt(camera.position.x * 0.3, 0.2, 0.3);
    renderer.render(scene, camera);
  });
  renderer.domElement.addEventListener('webglcontextlost', (event) => {
    event.preventDefault();
    rendererReady = false;
    showRenderError('The 3D graphics context was interrupted. Reload this page to reconnect the court.');
    updateControls();
  });
  return { applyState, clearTrail };
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
  const THREE = await import(THREE_URL);
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
