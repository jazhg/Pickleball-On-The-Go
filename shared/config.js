// SI units unless a name states otherwise. Tune here after physical playtests.
// One shared tuning surface; geometry follows the supplied design.
export const CONFIG = Object.freeze({
  court: {
    width: 6.096, length: 13.4112, netHeight: 0.8636,
    netPostHeight: 0.9144, kitchenDepth: 2.1336, lineWidth: 0.0508,
  },
  simulation: {
    hz: 120, broadcastHz: 60, poseHz: 15,
    maxCatchupSeconds: 0.1, // 0.05–0.25: cap work after event-loop stalls.
    resetDelaySeconds: 1.7, // 1–3: show the final bounce, then wait for a spawn request.
    stationaryTimeoutSeconds: 3, // 2–5: make respawn available after a grounded ball settles.
    stationarySpeed: 0.12, // 0.06–0.2 m/s: treat tiny physics jitter as motionless.
    stationaryGroundTolerance: 0.012, // 0.005–0.025 m: maximum height above the floor while settled.
  },
  physics: {
    gravity: 9.81,
    drag: 0.025, // 0.01–0.08 m^-1: quadratic acceleration = -drag * |v| * v.
    restitution: 0.75, // 0.55–0.85: vertical bounce speed retained.
    surfaceRetention: 0.86, // 0.7–0.98: horizontal speed retained at bounce.
    netRetention: 0.18, // 0.05–0.3: speed retained on net contact.
    ballRadius: 0.037,
    minSpeed: 2.2352, maxSpeed: 15.6464, // 5–35 mph, design clamp.
    aimAssist: 0.35, // 0–0.6; start at design's 0.30–0.40.
    hitWindowRadius: 0.9, // 0.6–1.3 m: generous estimated-paddle contact sphere.
    elevationBaseDeg: 18, // 12–22: flatter default trajectory.
    pitchGain: 0.18, // 0.1–0.3: reduce sensitivity to phone tilt.
    maxPitchInputDeg: 30, // 15–40: limit raw pitch before applying gain.
    maxUpwardSpeed: 3.8, // 3–5 m/s: cap loft AFTER aim assist.
    minElevationDeg: 12, maxElevationDeg: 24, // 8–15 and 20–30.
    rollGain: 0.25, torsoGain: 0.5, // 0–1: azimuth weights.
    maxAzimuthDeg: 38, // 20–60: keep the first demo facing the far court.
    targetX: 1.2, targetZ: -3.8, // x 0–2, z -2.5 to -5.5: far-side target.
    minimumTargetFlightSeconds: 0.4, // 0.3–0.7: stability for short contacts.
  },
  player: { x: 0, homeDepth: 5.25, feedDepth: 4.8, paddleHeight: 0.95 },
  seats: { A: { sign: 1 }, B: { sign: -1 } },
  calibration: {
    softG: 2.5, mediumG: 4, hardG: 8, // 2–3 / 3–5 / 6–10: practice swings.
    softSpeed: 6.5, mediumSpeed: 8.5, hardSpeed: 11, // 5–7 / 7–9 / 10–13 m/s.
    powerCap: 11, // 9–13 m/s: ignore excess force beyond a deliberate hard swing.
    minGapG: 0.15, // 0.05–0.5: require distinct increasing practice peaks.
  },
  swing: {
    startG: 2.5, endG: 1.2, // 2–3 / 1.05–1.35: reject light movements.
    refractoryMs: 600, // 400–900: require a quiet recovery after each swing.
    maxWindowMs: 900, // 500–1200: abandon motion without a contact reversal.
    minWindowMs: 80, // 60–130: reject brief sensor spikes.
    reversalG: 0.3, // 0.2–0.5: minimum linear dominant-axis sign reversal.
    peakDecayG: 0.08, // 0.03–0.2: require a real fall from the acceleration peak.
    staticToleranceG: 0.14, // 0.08–0.25: near-1g updates gravity estimate.
    staticMaxRate: 12, // 5–25 deg/s: also require little rotation to be still.
    gravityAlpha: 0.15, // 0.05–0.3: low-pass gravity/paddle orientation at rest.
    gravityCaptureMs: 700, // 400–1500: uninterrupted still samples for a flat reference.
    maxGyroStepSeconds: 0.05, // 0.02–0.1: cap integration after dropped samples.
    sensorTimeoutMs: 4000, // 2000–8000: report granted permission but no events.
    synthetic: { peak_g: 3.8, pitch: 14.2, roll: -6.1, yaw_rate: 220, duration_ms: 310 },
  },
  dtw: {
    minSamples: 8, maxSamples: 180, // 8–18 / 120–240: valid motion trace bounds.
    minDurationMs: 80, maxDurationMs: 1400, // 60–150 / 900–1800: deliberate swing window.
    points: 32, bandRatio: 0.25, // 24–48 points; 0.15–0.35 local time-warp allowance.
    minAccelerationRms: 0.08, // 0.04–0.2g: reject empty/noise-only traces.
    maxDistance: 0.72, minMargin: 0.12, // Physical playtest classification thresholds.
  },
  render: {
    eyeHeight: 1.68, cameraAlpha: 0.15, trailLength: 22, // eye 1.4–1.9; alpha .05–.3; trail 10–40.
    paddlePositionAlpha: 0.24, // 0.12–0.4: higher follows the wrist faster but admits more jitter.
    paddleRotationAlpha: 0.32, // 0.2–0.5: quaternion slerp fraction per rendered frame.
    neutralPaddleOffset: { x: 0.42, y: -0.34, z: -0.62 }, // Camera-local metres; z stays in front of the near plane.
    maxWristOffset: { x: 0.42, y: 0.38, z: 0.22 }, // 0.2–0.6 m per axis: clamp landmark noise to the visible view.
  },
  tracking: {
    version: '0.10.21',
    visibility: 0.65, // 0.5–0.8: reject uncertain shoulders/hips.
    calibrationFrames: 20, // 15–45: about 1.3 seconds at 15 Hz.
    calibrationTolerance: 0.035, // 0.02–0.06: stand still in normalized image units.
    minShoulderWidth: 0.06, // 0.04–0.10: reject distant/small detections.
    shoulderMeters: 0.42, // 0.35–0.55: approximate physical shoulder width.
    referenceDistance: 2.5, // 1.5–4 m: assumed distance at calibration; depth is a proxy.
    positionAlpha: 0.2, // 0.1–0.35: smooth camera position estimates.
    movementDeadZone: 0.035, // 0.015–0.08 m: ignore stationary court-position jitter.
    minDepth: 2.6, maxDepth: 6.1, // Stay on your side of the court.
    edgeMargin: 0.35, // 0.2–0.6 m: avoid placing the player on the sideline.
    markerRadius: 0.35, // 0.2–0.5 m: ground-position circle size.
    wristVisibility: 0.55, // 0.4–0.75: minimum confidence for wrist-relative paddle input.
    wristLossTimeoutMs: 450, // 250–1000 ms: hold the last reliable wrist before returning neutral.
    wristReturnAlpha: 0.1, // 0.05–0.25 per tracking tick: neutral return after a longer loss.
    jumpThreshold: 0.14, // 0.08–0.25 body lengths above baseline before confirming a jump.
    jumpConfirmationFrames: 3, // 2–5 frames: reject isolated raised-hip spikes.
    verticalDeadZone: 0.045, // 0.02–0.08 body lengths: suppress breathing/camera noise.
    verticalAlpha: 0.22, // 0.1–0.4 per tracking tick: smooth POV rise and landing.
    maxPovRise: 0.65, // 0.35–0.9 m: maximum render-only upward camera displacement.
  },
  network: {
    port: 8443, reconnectMs: 1500, // 500–5000: browser reconnect delay.
    maxPayloadBytes: 2048, minSwingIntervalMs: 180, // 100–250: relay flood protection.
    controllerHz: 25, // 20–30 Hz: low-latency orientation updates without raw-event flooding.
    controllerRateBurst: 3, // 2–5: short scheduling burst tolerated by the relay limiter.
    heartbeatMs: 15000, // 10000–30000: close abandoned sockets.
  },
  controller: {
    // Euler sign hooks for device-specific playtesting; orientation uses Z-X-Y conversion.
    ios: { alpha: 1, beta: 1, gamma: 1 },
    android: { alpha: 1, beta: 1, gamma: 1 },
  },
  nemotron: {
    bridgeScript: 'nemotron/bridge.py', // spawned as: python3 <bridgeScript>
    classifierTimeoutMs: 300, // 200–500: model/heuristic deadline; late results fall back.
    refereeTimeoutMs: 25000, // 15000–30000: referee may reason; rally adjudication is async.
    liveEnv: 'NEMOTRON_LIVE', // live model calls only when '1' AND NVIDIA_API_KEY is set.
  },
});
