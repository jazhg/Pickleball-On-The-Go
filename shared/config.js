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
  player: { x: 0, z: 5.25, paddleHeight: 0.95, feedZ: 4.8 },
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
  render: {
    eyeHeight: 1.68, cameraAlpha: 0.15, trailLength: 22, // eye 1.4–1.9; alpha .05–.3; trail 10–40.
  },
  dtw: {
    preRollMs: 100, // 50–150: retain the lead-in before the swing threshold.
    points: 48, // 32–64: uniform time samples before DTW alignment.
    bandRatio: 0.25, // 0.15–0.4: limit local timeline stretching.
    minSamples: 8, maxSamples: 256, // Bound recording quality and CPU/memory use.
    minDurationMs: 120, maxDurationMs: 1600, // Reject incomplete or stale recordings.
    minAccelerationRms: 0.15, // 0.1–0.4 g: refuse still-phone templates.
    maxDistance: 0.7, // 0.4–1.0: lower values demand closer shape matches.
    minMargin: 0.12, // 0.05–0.25: require a clear winner over the next template.
    recordingTimeoutMs: 10000, // 5000–15000: time to perform a prompted template.
    analysisTimeoutMs: 2000, // 1500–4000: show incomplete analysis after missing samples.
    templateVersion: 1,
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
    minZ: 2.6, maxZ: 6.1, // Stay on your side of the court.
    edgeMargin: 0.35, // 0.2–0.6 m: avoid placing the player on the sideline.
    markerRadius: 0.35, // 0.2–0.5 m: ground-position circle size.
  },
  network: {
    port: 8443, reconnectMs: 1500, // 500–5000: browser reconnect delay.
    maxPayloadBytes: 2048, minSwingIntervalMs: 180, // 100–250: relay flood protection.
    heartbeatMs: 15000, // 10000–30000: close abandoned sockets.
  },
});
