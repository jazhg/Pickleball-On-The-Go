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
    maxFlightSeconds: 8, // 5–12: recover from a ball that never settles.
  },
  physics: {
    gravity: 9.81,
    drag: 0.025, // 0.01–0.08 m^-1: quadratic acceleration = -drag * |v| * v.
    restitution: 0.75, // 0.55–0.85: vertical bounce speed retained.
    surfaceRetention: 0.86, // 0.7–0.98: horizontal speed retained at bounce.
    netRetention: 0.18, // 0.05–0.3: speed retained on net contact.
    ballRadius: 0.037,
    minSpeed: 2.2352, maxSpeed: 15.6464, // 5–35 mph, design clamp.
    aimAssist: 0.35, // 0–0.6: steers DIRECTION only, never power; keyboard/synthetic swings only.
    paddleAimAssist: 0, // 0–0.2: a real paddle pose is already the player's aim; do not correct it.
    hitWindowRadius: 0.9, // 0.6–1.3 m: generous estimated-paddle contact sphere.
    elevationBaseDeg: 18, // 12–22: loft of a level paddle face.
    pitchGain: 0.18, // 0.1–0.3: reduce sensitivity to phone tilt.
    maxPitchInputDeg: 30, // 15–40: limit raw pitch before applying gain.
    maxUpwardSpeed: 3.8, // 3–5 m/s: cap loft AFTER aim assist.
    minElevationDeg: 6, maxElevationDeg: 38, // 4–10 and 30–45: room to drive flat or dink up.
    headingGain: 0.6, // 0.45–0.8: wrist angle to court angle, so a full turn reaches the corner and no further.
    faceTiltGain: 0.6, // 0.3–0.9: how much an open paddle face lofts the ball.
    rollGain: 0.25, torsoGain: 0.5, // 0–1: azimuth weights for the no-pose fallback.
    maxAzimuthDeg: 17, // 14–20: widest angle a full-power shot still lands in from the baseline.
    targetX: 1.2, targetZ: -3.8, // x 0–2, z -2.5 to -5.5: far-side target.
    minimumTargetFlightSeconds: 0.4, // 0.3–0.7: stability for short contacts.
  },
  // Solo opponent on seat B. It only reacts to what the ball actually does: it has
  // to physically reach the bounce, it obeys the two-bounce rule, and it misses
  // often enough that points are winnable. A human taking seat B switches it off.
  bot: {
    reactionSeconds: 0.34, // 0.2–0.6: pause after the bounce before it swings back.
    reach: 1.7, // 1.2–2.4 m either side of where it stands; beyond this it cannot get there.
    moveSpeed: 3.4, // 2–5 m/s chasing the ball across its own court.
    recoverSpeed: 1.7, // 1–3 m/s drifting back to the middle between shots.
    speed: 10.2, // 9–12 m/s return pace, in the same range as a human medium swing.
    targetDepth: 3.4, // 2.5–4.5 m: where it aims on the player's side.
    spread: 0.75, // 0–1.2 m: how far either side of the player it places the ball.
    // Keep this under physics.hitWindowRadius or returns land where nobody can reach.
    missChance: 0.09, // 0–0.35: outright errors per shot, so the player can win points without the bot gifting them.
    netMissShare: 0.5, // 0–1: how many of those errors go into the net rather than wide.
    wideMissMetres: 0.7, // 0.3–1.5 m past the sideline when it sprays one wide.
    netMargin: 0.22, // 0.1–0.4 m of clearance over the net; drag eats part of it.
    maxFlightSeconds: 1.7, // 1.2–2.2: never loft a return into a slow moonball.
    maxLoft: 6.5, // 5–8 m/s: enough to lift a ball taken low near the net, no higher.
  },
  player: { x: 0, homeDepth: 5.25, feedDepth: 4.8, paddleHeight: 0.95 },
  seats: { A: { sign: 1 }, B: { sign: -1 } },
  calibration: {
    softG: 2.5, mediumG: 4, hardG: 8, // 2–3 / 3–5 / 6–10: practice swings.
    softSpeed: 9, mediumSpeed: 11, hardSpeed: 13, // 8–10 / 10–12 / 12–14 m/s.
    // Power alone decides net clearance now, so a soft swing must be genuinely
    // short of carrying and a hard one must reach the far baseline, not beyond.
    powerCap: 13.5, // 12–15 m/s: ignore excess force beyond a deliberate hard swing.
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
    paddleRotationAlpha: 0.32, // 0.2–0.5: quaternion slerp fraction per rendered frame when nearly still.
    paddleRotationGain: 0.55, // 0.3–0.9 per radian of lag: a fast swing tracks 1:1, a resting hand stays calm.
    paddleRotationMaxAlpha: 0.92, // 0.8–0.98: never snap completely; keeps sensor jitter off the screen.
    // The phone is held flat in one hand, so the paddle rests flat too: a quarter
    // turn about the face normal puts the grip under the hand on the right and the
    // blade across the view. Flip the sign for a left-handed grip. This turns about
    // the launch axis itself, so it changes only the look, never the aim.
    gripRollDeg: 90, // -90 mirrors it; 0 stands the paddle upright like a bat.
    aimLineLength: 0.85, // 0.5–1.2 m: the pointer showing where this face sends the ball.
    swingMs: 260, // 180–360: contact animation length.
    swingReach: 0.2, // 0.1–0.35 m: how far the paddle drives forward through contact.
    swingRise: 0.05, // 0–0.12 m: slight lift through the arc.
    swingTwistDeg: 16, // 8–28: follow-through rotation on top of the live phone pose.
    // Resting spot as a fraction of the VISIBLE frame, not absolute metres, so the
    // paddle stays on screen at any window shape. limit is the hard edge it can
    // never cross, however far the tracked hand moves.
    paddleFrame: { x: 0.45, y: 0.55, limit: 0.88 },
    neutralPaddleOffset: { x: 0.42, y: -0.34, z: -0.62 }, // Camera-local metres; z sets apparent size and the tracker's neutral.
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
    coachTimeoutMs: 10000, // technique tip: fire-and-forget, independent of the 300 ms classifier deadline.
    liveEnv: 'NEMOTRON_LIVE', // live model calls only when '1' AND NVIDIA_API_KEY is set.
  },
});
