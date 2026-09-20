# Arm Motion / Paddle Handle Handoff

## Goal

Implement a convincing first-person pickleball arm and paddle motion system.

The user should be able to wind up, swing through contact, and follow through. The paddle handle must visibly move around the POV while remaining smooth, stable, and anatomically reachable. Phone orientation rotates the paddle around the handle. It must behave identically for Players A and B from their own first-person views.

Do not solve this with more axis sign flips or by further tuning two competing position systems.

## Current user-visible problem

Several iterations have alternated between two failure modes:

1. Phone acceleration is strong enough to move the handle, but integration noise makes it fly or wander.
2. Filtering and damping are increased until the handle appears fixed again.

The current build is in the second state: stable, but the phone contribution is too subtle and the result does not convincingly follow the player's arm.

## Important workspace state

The working tree contains uncommitted movement work. Preserve it and inspect the diff before editing. Do not reset or discard it.

Current modified files include:

- `client-laptop/app.js`
- `client-phone/app.js`
- `server/physics.js`
- `shared/config.js`
- `shared/controller-orientation.js`
- `shared/paddle-motion.js`
- `shared/position-tracker.js`
- `shared/protocol.js`
- Relevant tests under `tests/`

At handoff time, `npm test` passes 69 tests.

## What is already correct and must not regress

### Phone orientation

`shared/controller-orientation.js` now:

- Uses the W3C DeviceOrientation quaternion conversion without platform Euler sign multipliers.
- Defines phone, camera, and paddle frames explicitly.
- Captures a complete right/up/normal basis at recenter.
- Rejects flat and upside-down calibration.
- Produces identity at neutral.
- Produces correct left/right and forward/back tilt from the documented normal grip.

Do not replace this with heading-only calibration. Do not add iOS/Android sign constants.

### Paddle pivot

In `client-laptop/app.js`, the paddle group origin is the grip/handle. The paddle face and rim are offset upward from that origin. Phone orientation rotates this group around the handle.

Do not move the pivot back to the face center.

### Camera wrist filtering

`shared/position-tracker.js` already provides:

- Shoulder-relative wrist normalization.
- Visibility gating.
- Median and adaptive low-pass filtering.
- Velocity and acceleration limits.
- Dominant-wrist switching with hysteresis.
- Raw wrist-Z rejection.
- Lost-tracking hold and smooth neutral recovery.
- A constrained reach envelope.

These pieces can be reused as observations and safety constraints, but the current file also synthesizes an arc. That arc should be moved into the single arm controller proposed below.

### Multiplayer frame convention

Controller orientation is first-person local data. Player-seat transforms are applied only when converting local right/forward into court coordinates in `server/physics.js`.

Do not put Player B mirroring into the local paddle quaternion or camera-local arm animation.

## Why the current approach cannot be tuned into a good result

There are currently two independent handle-position generators:

1. `PositionTracker` converts camera wrist motion into x/y plus a synthetic z arc.
2. `PaddleMotion` double-integrates phone acceleration into x/y/z offsets.

`client-laptop/app.js` adds these positions and then projects the sum into an arm sphere.

This is structurally unstable:

- The two generators do not share a swing phase.
- They can reinforce or cancel one another.
- Projection onto the sphere turns excessive summed motion into visible sliding along the boundary.
- Accelerometer integration cannot provide a stable absolute handset position. Bias becomes velocity and position drift.
- Strong damping removes drift but also removes the desired handle travel.
- More interpolation adds latency and makes the handle look detached from the player.

The next solution should have exactly one authoritative arm/handle state.

## Wii-style lesson

Do not interpret “Wii-like” as reconstructing absolute 3D controller position from an accelerometer.

Nintendo's own Wii MotionPlus material explains that the original Wii Remote measured linear acceleration, while MotionPlus added gyro rotation; it also describes the difficulty of determining when the controller is truly at rest. The useful design lesson is to classify motion and orientation, then drive a controlled game response—not to trust indefinite acceleration integration as absolute position.

References:

- Nintendo, “The Gyro Sensor: A New Sense Of Control”: https://www.nintendo.com/en-gb/Iwata-Asks/Iwata-Asks-Wii-MotionPlus/Read-more/1-The-Gyro-Sensor-A-New-Sense-Of-Control/1-The-Gyro-Sensor-A-New-Sense-Of-Control-225595.html
- Nintendo, Wii MotionPlus interview on rest detection and sensor limits: https://iwataasks.nintendo.com/interviews/wii/wiimotionplus/0/1/

This project has an advantage the Wii Remote did not: a camera observes shoulders and wrists. Use the camera for absolute pose and the phone for orientation plus swing intent/timing.

## Recommended architecture

Create one shared `ArmController` state machine, ideally in `shared/arm-controller.js`.

Inputs per update:

- Timestamp.
- Active shoulder anchor from camera tracking.
- Filtered 2D wrist observation and confidence.
- Phone orientation quaternion.
- Gravity-free phone acceleration and angular velocity features.
- Tracking-present/lost state.

Outputs:

- One camera-local handle position.
- One handle velocity.
- One phone-derived paddle quaternion.
- Elbow position or enough state for a two-bone IK solve.
- Swing phase and normalized progress.
- Confidence/debug information.

### Source responsibilities

- Camera shoulder/wrist: stable absolute lateral and vertical hand target.
- Phone quaternion: paddle rotation around the handle.
- Phone acceleration/gyro: detect preparation, direction, contact timing, and swing intensity.
- Procedural arm model: generate stable depth and fill short camera dropouts.
- Reach constraint: final authority over the handle endpoint.

Phone acceleration must not be added as an independent free-running position offset.

## Suggested swing state machine

Use explicit states with hysteresis:

1. `IDLE`
   - Handle follows the filtered camera wrist slowly.
   - Phone translation state is zero.

2. `PREPARE`
   - Enter after sustained lateral camera motion or phone acceleration in the wind-up direction.
   - Capture the active shoulder, swing direction, and start handle position.
   - Move toward a bounded wind-up control point.

3. `FORWARD`
   - Enter on velocity reversal or forward acceleration.
   - Progress must be monotonic.
   - Phone acceleration changes progress rate/intensity, not endpoint position directly.

4. `CONTACT`
   - A short event around progress 0.45–0.6.
   - Handle is at maximum outward depth.
   - Emit at most one swing event.

5. `FOLLOW_THROUGH`
   - Continue across the body while depth returns closer.
   - Do not chase new raw wrist samples frame by frame.

6. `RECOVER`
   - Critically damp back to the live camera wrist target or neutral.
   - Return to `IDLE` only after velocity is low for multiple frames.

## Suggested camera-local trajectory

Use a cubic Bézier or Catmull–Rom curve defined relative to the active shoulder. Camera-local forward is negative Z.

Example forehand control points for a right-handed swing:

- Start/wind-up: `(shoulder.x + 0.28, shoulder.y - 0.20, shoulder.z + 0.08)`
- Early forward: `(shoulder.x + 0.18, shoulder.y - 0.12, shoulder.z - 0.30)`
- Contact: `(shoulder.x - 0.04, shoulder.y - 0.02, shoulder.z - 0.62)`
- Follow-through: `(shoulder.x - 0.30, shoulder.y + 0.10, shoulder.z - 0.22)`

Mirror X for the opposite active arm. Treat these as initial playtest values, not final constants.

Important properties:

- Outward depth must dominate horizontal displacement around contact.
- Start and follow-through are closer than contact.
- Progress is monotonic during a swing.
- The curve is C1-continuous so velocity does not jump at phase boundaries.
- Blend into and out of the curve using smoothstep/quintic easing.

## Camera observation blending

Do not add the camera target and procedural target.

Blend them into one endpoint:

```text
observed = filtered camera wrist target
procedural = swing curve at phase progress
weight = phase/confidence-dependent swing weight
handleTarget = lerp(observed, procedural, weight)
handleTarget = projectIntoReachEnvelope(handleTarget)
```

Recommended behavior:

- High-confidence idle camera tracking: mostly observed.
- Active swing: progressively favor procedural depth while preserving observed lateral/vertical intent.
- Brief camera loss: continue the current procedural phase.
- Long camera loss: recover to neutral.
- Phone-only mode: use a conservative gesture-triggered canned arc, never accelerometer position integration.

## Arm reach and IK

Animating an arm is recommended because it makes the reach constraint visually understandable.

Use a two-bone arm:

- Shoulder anchor.
- Upper-arm length.
- Forearm length.
- Hand/handle endpoint.
- Stable elbow pole vector pointing slightly down and outward.

Solve analytically or with a small two-bone IK helper each render/update. Clamp endpoint distance to:

```text
abs(upperArmLength - forearmLength) + epsilon
<= shoulderToHand
<= upperArmLength + forearmLength - epsilon
```

Render simple tapered capsules/cylinders first. The arm is a debugging aid as much as a visual feature: if the elbow pops, the endpoint/filter/state machine is wrong.

Avoid solving IK separately for the paddle. The paddle group should be attached to the hand/handle transform and continue using the phone quaternion locally.

## Filtering recommendation

Use one filter per observation stage, not several unrelated smoothing layers.

A good starting point:

- Short median window for landmark outliers.
- One Euro filter or confidence-adaptive exponential filter for camera wrist x/y.
- Monotonic filtered phase for procedural depth.
- Critically damped spring for final handle position.
- Explicit vector velocity and acceleration limits.

Avoid an additional large render `lerp` if the shared controller already outputs a smooth endpoint. It hides problems and adds latency.

## Implementation plan

1. Add `shared/arm-controller.js` with no Three.js dependency.
2. Change `PositionTracker` to expose filtered shoulder/wrist observations rather than owning the final synthetic swing depth.
3. Change `PaddleMotion` into a swing-feature extractor:
   - filtered acceleration magnitude/direction;
   - angular velocity;
   - reversal/contact signal;
   - no free-running position integration.
4. Feed camera and phone observations into `ArmController` in the laptop client.
5. Make `ArmController` the only writer of `paddleTargetPosition`.
6. Add a two-bone arm rig under the camera and attach the paddle to the hand endpoint.
7. Keep phone quaternion rotation local to the handle.
8. Decide separately whether authoritative server contact needs the handle endpoint. If so, add a new protocol message type rather than mutating the frozen body `pose` schema.
9. Keep multiplayer seat conversion at the court/world boundary only.

## Debug UI strongly recommended

Add a temporary opt-in overlay showing:

- Active wrist: 15 or 16.
- Wrist confidence.
- Swing phase and progress.
- Observed camera target.
- Procedural target.
- Final constrained handle target.
- Shoulder-to-handle distance versus maximum reach.
- Phone acceleration magnitude and detected direction.

Without this overlay, physical playtesting becomes blind constant tuning.

## Required automated tests

Add deterministic tests for `ArmController`:

- Idle landmark noise moves the handle less than a small tolerance.
- A single landmark spike is rejected.
- A single acceleration spike does not move the endpoint substantially.
- A synthetic forehand yields close → far → close depth.
- Depth excursion dominates horizontal excursion at contact.
- Position, velocity, and acceleration stay bounded.
- Endpoint never exceeds arm length.
- Phase progress never reverses during `FORWARD` or `FOLLOW_THROUGH`.
- One swing produces one contact event.
- Brief camera loss continues smoothly.
- Long camera loss returns smoothly to neutral.
- Switching active wrists does not teleport the handle.
- Players A and B receive identical camera-local motion.
- Phone rotation changes paddle orientation but never changes the handle endpoint.

Add IK tests:

- Shoulder, elbow, and hand segment lengths remain constant.
- Elbow remains on the intended side of the pole vector.
- Singular full-extension poses do not produce NaN or flips.

Run the complete suite with `npm test`.

## Manual acceptance checklist

Test with the camera and phone together:

1. Stand still: handle is calm.
2. Move the phone slightly: paddle rotates without position jitter.
3. Move the arm slowly: handle visibly follows the wrist.
4. Wind up: handle moves to a bounded preparation position.
5. Swing: handle travels outward toward contact, not merely sideways.
6. Follow through: handle crosses and comes closer smoothly.
7. Hold the arm extended: camera keeps the handle there without inertial drift.
8. Reach beyond full extension: arm straightens, but the handle does not leave the envelope.
9. Briefly hide the wrist: no snap.
10. Repeat for both arms and both player seats.

## Non-goals / traps

- Do not infer absolute phone position by double-integrating acceleration.
- Do not sum camera position and an unrelated phone position.
- Do not directly map MediaPipe wrist Z.
- Do not use arbitrary axis sign flips.
- Do not rotate around the paddle face center.
- Do not mirror the local controller for Player B.
- Do not hide instability behind a very low render interpolation constant.
