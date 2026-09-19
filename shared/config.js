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
    resetDelaySeconds: 1.7, // 1–3: time to see final bounce before another feed.
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
    elevationBaseDeg: 10, // 5–20: heuristic launch prior, no model dependency.
    pitchGain: 0.75, // 0.4–1.2: degrees of launch elevation / paddle pitch.
    minElevationDeg: 8, maxElevationDeg: 65, // 5–15 and 50–75.
    rollGain: 0.65, torsoGain: 0.5, // 0–1: azimuth weights.
    maxAzimuthDeg: 38, // 20–60: keep the first demo facing the far court.
    targetX: 1.2, targetZ: -3.8, // x 0–2, z -2.5 to -5.5: far-side target.
    minimumTargetFlightSeconds: 0.4, // 0.3–0.7: stability for short contacts.
  },
  player: { x: 0, z: 5.25, paddleHeight: 0.95, feedZ: 4.8 },
  calibration: {
    softG: 1.5, mediumG: 3, hardG: 6, // 1.3–2.5 / 2–4 / 4–8: practice swings.
    softSpeed: 4, mediumSpeed: 8.5, hardSpeed: 15, // 3–6 / 6–11 / 12–15.65 m/s.
    minGapG: 0.15, // 0.05–0.5: require distinct increasing practice peaks.
  },
  swing: {
    startG: 1.5, endG: 1.2, // 1.3–2 / 1.05–1.35: BACKSWING and FOLLOW thresholds.
    refractoryMs: 200, // 150–400: prevents a follow-through double firing.
    maxWindowMs: 900, // 500–1200: abandon motion without a contact reversal.
    minWindowMs: 50, // 30–100: reject a single sensor spike.
    reversalG: 0.12, // 0.05–0.3: minimum linear dominant-axis sign reversal.
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
  network: {
    port: 8443, reconnectMs: 1500, // 500–5000: browser reconnect delay.
    maxPayloadBytes: 2048, minSwingIntervalMs: 180, // 100–250: relay flood protection.
    heartbeatMs: 15000, // 10000–30000: close abandoned sockets.
  },
});
