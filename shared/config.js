// SI units unless a name states otherwise. Tune here after physical playtests.
// One shared tuning surface; geometry follows the supplied design.
export const CONFIG = Object.freeze({
  court: {
    width: 6.096, length: 13.4112, netHeight: 0.8636,
    netPostHeight: 0.9144, kitchenDepth: 2.1336, lineWidth: 0.0508,
  },
  simulation: {
    hz: 120, broadcastHz: 60, poseHz: 30,
    maxCatchupSeconds: 0.1, // 0.05–0.25: cap work after event-loop stalls.
    resetDelaySeconds: 1.7, // 1–3: show the final bounce, then wait for a spawn request.
    stationaryTimeoutSeconds: 3, // 2–5: make respawn available after a grounded ball settles.
    stationarySpeed: 0.12, // 0.06–0.2 m/s: treat tiny physics jitter as motionless.
    stationaryGroundTolerance: 0.012, // 0.005–0.025 m: maximum height above the floor while settled.
  },
  practice: {
    feedIntervalMs: 3000,
    flightSeconds: 1.45,
    launchHeight: 1.15,
    lateralSpread: 1.15,
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
    eyeHeight: 1.52, cameraAlpha: 0.15, trailLength: 22, // Slightly shorter POV keeps court scale natural near the net.
    // Main's wider, downward-looking first-person framing.
    cameraFovDeg: 90, cameraLookDistance: 6, cameraLookHeight: 0.84,
    paddleRotationAlpha: 0.5, // Reaches a new phone orientation in roughly 80ms at 60fps.
    paddleMinRightX: 0.08, // Keep the right-handed grip visibly on the right side of the POV.
    paddle: { headWidth: 0.20, headHeight: 0.24, thickness: 0.035, handleLength: 0.15, handleWidth: 0.045 },
    // Face center relative to the player, shared by renderer and ball contacts.
    // Keep the authoritative contact height unchanged when camera eye height changes.
    neutralPaddleOffset: { x: 0.42, y: -0.44, z: -1.05 },
    maxWristOffset: { x: 0.36, y: 0.4, z: 0.55 }, // Favor visible reach depth over side-to-side screen travel.
  },
  tracking: {
    neutralWristOffset: { x: 0.28, y: -0.28, z: -0.62 }, // Stable right-side grip reference in camera-local space.
    neutralElbowOffset: { x: 0.36, y: -0.25, z: -0.52 },
    version: '0.10.21',
    visibility: 0.65, // 0.5–0.8: reject uncertain shoulder landmarks.
    calibrationFrames: 20, // 15–45: about 1.3 seconds at 15 Hz.
    calibrationTolerance: 0.035, // 0.02–0.06: stand still in normalized image units.
    minShoulderWidth: 0.06, // 0.04–0.10: reject distant/small detections.
    shoulderMeters: 0.42, // 0.35–0.55: approximate physical shoulder width.
    referenceDistance: 2.5, // Assumed camera distance at calibration; shoulder scale is the depth proxy.
    depthGain: 2.5, // Map roughly ten feet of forward travel from baseline to the kitchen line.
    lateralGain: 2.5, // Cover the court with smaller physical sidesteps.
    lateralResponseSeconds: 0.045, // Fast response while moving; quiet readings remain filtered.
    lateralRestResponseSeconds: 0.14,
    lateralDeadZone: 0.015, // Metres in court space.
    positionAlpha: 0.2, // 0.1–0.35: smooth camera position estimates.
    movementDeadZone: 0.035, // 0.015–0.08 m: ignore stationary court-position jitter.
    minDepth: 2.1336, maxDepth: 6.1, // Kitchen line to the rear playable area; never cross the net.
    edgeMargin: 0.35, // 0.2–0.6 m: avoid placing the player on the sideline.
    markerRadius: 0.35, // 0.2–0.5 m: ground-position circle size.
    wristVisibility: 0.65, // 0.55–0.8: low-confidence hands do not drive the paddle.
    paddleWrist: 16, // MediaPipe right arm, mapped to the first-person right side; never hand off.
    wristMedianSamples: 3, // Short window rejects spikes without hiding deliberate arm travel.
    wristFilterAlpha: 0.18, wristMovingAlpha: 0.68, // Slow at rest, responsive during deliberate arm travel.
    elbowFilterAlpha: 0.34, // Elbow drives the IK bend plane without copying landmark jitter.
    wristResponsiveSpeed: 0.8, // Shoulder-widths/s at which the moving filter is fully engaged.
    wristLateralGain: 0.82, wristVerticalGain: 0.9, // Restrained lateral travel keeps the path reading as an arc.
    wristSampleMaxJump: 0.85, // 0.5–1.2 shoulder widths: reject one-frame x/y teleportation.
    wristMaxVelocity: 1.35, // 0.7–1.8 m/s: handle translation speed limit.
    wristMaxAcceleration: 7, // 3–9 m/s²: handle translation acceleration limit.
    armReachRadius: 0.9, // 0.7–0.95 m camera-space envelope around the active shoulder.
    wristLossTimeoutMs: 450, // 250–1000 ms: hold the last reliable wrist before returning neutral.
    wristReturnAlpha: 0.1, // 0.05–0.25 per tracking tick: neutral return after a longer loss.
    jumpThreshold: 0.14, // 0.08–0.25 body lengths above baseline before confirming a jump.
    jumpConfirmationFrames: 3, // 2–5 frames: reject isolated raised-hip spikes.
    verticalDeadZone: 0.045, // 0.02–0.08 body lengths: suppress breathing/camera noise.
    verticalAlpha: 0.22, // 0.1–0.4 per tracking tick: smooth POV rise and landing.
    maxPovRise: 0.65, // 0.35–0.9 m: maximum render-only upward camera displacement.
  },
  arm: {
    upperArmLength: 0.43, forearmLength: 0.43, reachEpsilon: 0.015,
    nearPlane: -0.22,
    windupLateral: 0.28, windupDrop: 0.2, windupDepth: 0.08,
    earlyLateral: 0.18, earlyDrop: 0.12, earlyDepth: 0.3,
    contactLateral: 0.04, contactLift: 0.02, contactDepth: 0.8,
    followLateral: 0.3, followLift: 0.1, followDepth: 0.22,
    prepareFraction: 0.18, contactProgress: 0.56, contactReachDepth: 0.17,
    prepareDurationMs: 150, forwardDurationMs: 230, contactHoldMs: 70, followDurationMs: 280,
    recoverMinMs: 140, swingWeight: 0.88,
    cameraPrepareSpeed: 0.32, cameraForwardSpeed: 0.16,
    phonePrepareAcceleration: 0.75, phoneForwardAcceleration: 0.55, phoneFullIntensity: 5,
    intensitySpeedup: 0.28,
    cameraVelocityHoldMs: 120, phoneFeatureHoldMs: 160,
    cameraHoldMs: 480, cameraRecoverMs: 900,
    spring: 100, damping: 20, maxVelocity: 2.4, maxAcceleration: 22,
    restVelocity: 0.08, restDistance: 0.025,
  },
  network: {
    port: 8443, reconnectMs: 1500, // 500–5000: browser reconnect delay.
    maxPayloadBytes: 2048, minSwingIntervalMs: 180, // 100–250: relay flood protection.
    controllerHz: 25, // 20–30 Hz: low-latency orientation updates without raw-event flooding.
    controllerRateBurst: 3, // 2–5: short scheduling burst tolerated by the relay limiter.
    heartbeatMs: 15000, // 10000–30000: close abandoned sockets.
  },
  controller: {
    poseTimeoutMs: 500, // Ignore stale orientation when sensors stop delivering samples.
    center: { pitch: 55.5, roll: -1.7, yawRate: 0 }, // Measured upright phone pose.
    motionFeatures: {
      deadZone: 0.22, accelerationAlpha: 0.28, releaseAlpha: 0.12,
      activeAcceleration: 0.6, releaseAcceleration: 0.22,
      maxAcceleration: 24, maxAngularSpeed: 1800,
    },
    // Both platforms use the W3C frame. Calibration removes heading only; platform-specific Euler sign patches must not be added here.
    ios: { frame: 'w3c-deviceorientation' },
    android: { frame: 'w3c-deviceorientation' },
  },
  nemotron: {
    bridgeScript: 'nemotron/bridge.py', // spawned as: python3 <bridgeScript>
    classifierTimeoutMs: 300, // 200–500: model/heuristic deadline; late results fall back.
    refereeTimeoutMs: 25000, // 15000–30000: referee may reason; rally adjudication is async.
    liveEnv: 'NEMOTRON_LIVE', // live model calls only when '1' AND NVIDIA_API_KEY is set.
  },
});
