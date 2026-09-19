# Project handoff: what is done vs. what is still missing

This repo is not a blank slate. The previous agent already built a working single-direction prototype for the game spine and a mostly complete offline Nemotron evaluation package. The remaining work is mostly integration, real-world validation, and a few design-specific gaps that were intentionally left as placeholders.

## 0) Full repository inventory

This is the complete file-level map of the project as it exists today. An external agent should read this before making changes so it knows which parts are intentionally working scaffolding vs. unfinished integration.

### Root-level project files

- [README.md](README.md): user-facing setup guide for running the local game loop, HTTPS phone flow, and the current milestone status.
- [package.json](package.json): Node project metadata, dependencies, and script targets (`npm start`, `npm run dev`, `npm run certs`, `npm test`).
- [package-lock.json](package-lock.json): lockfile for the Node dependency tree.
- [implementation-handoff.md](implementation-handoff.md): the original handoff brief from the project prompt. It describes the game-spine prompt and the Nemotron prompt that were meant to run in parallel.
- [virtual-pickleball-design.md](virtual-pickleball-design.md): the canonical architecture/design document. This is the source of truth for message schemas, gameplay assumptions, attack plan, and evaluation criteria.
- [HANDOFF.md](HANDOFF.md): this file; the working summary for the next agent.

### HTTPS setup helpers

- [scripts/setup-https.js](scripts/setup-https.js): generates local mkcert certificates for the LAN IPs, installs the CA if possible, and keeps the certificate path and permissions sane for phone testing.

### Server and physics

- [server/index.js](server/index.js): relay server entrypoint. Establishes WebSocket hub, authoritative simulation, HTTP spawn handling, same-origin protection, HTTPS setup, and state broadcasting.
- [server/physics.js](server/physics.js): authoritative ball simulation, spawn logic, hit-window validation, aim assist, bounce/net logic, score lifecycle, and state snapshot generation.

### Shared game logic

- [shared/config.js](shared/config.js): all tunable constants for court geometry, simulation rates, swing thresholds, calibration ranges, render settings, tracking settings, and network behavior.
- [shared/protocol.js](shared/protocol.js): schema validation for the fixed wire payloads: `swing`, `pose`, `state`, and `ruling`.
- [shared/swing-detector.js](shared/swing-detector.js): IMU-based swing detector with the IDLE → BACKSWING → CONTACT → FOLLOW state machine and calibration mapping.
- [shared/position-tracker.js](shared/position-tracker.js): converts detected body/keypoint geometry into a court-space pose estimate for camera position tracking.

### Laptop client

- [client-laptop/app.js](client-laptop/app.js): main laptop browser logic. Connects to the relay, handles keyboard swings, spawn control, HUD updates, state display, and Three.js renderer bootstrap.
- [client-laptop/tracking.js](client-laptop/tracking.js): MediaPipe camera loading and pose pipeline. Enables/disables camera, loads the CDN model, and emits pose updates back to the server.
- [client-laptop/index.html](client-laptop/index.html): HTML shell for the laptop court, control buttons, HUD, and the camera/tracking area.
- [client-laptop/styles.css](client-laptop/styles.css): laptop-side UI styling.

### Phone client

- [client-phone/app.js](client-phone/app.js): phone browser logic. Handles HTTPS detection, motion permission, DeviceMotion handling, calibration, swing detection output, and WebSocket send path.
- [client-phone/index.html](client-phone/index.html): phone UI with motion permission controls, calibration controls, connection status, and debug readout.
- [client-phone/styles.css](client-phone/styles.css): phone-side styling.

### Automated tests

- [tests/physics.test.js](tests/physics.test.js): physics-level tests for launch, bounce validity, hit-window logic, bounds checks, restitution, and schema contract validation.
- [tests/relay.test.js](tests/relay.test.js): end-to-end relay tests covering WebSocket relays, HTTP spawn checks, laptop/phone message paths, and authoritative broadcast behavior.

### Nemotron package

- [nemotron/__init__.py](nemotron/__init__.py): package marker and documentation for the standalone Nemotron package.
- [nemotron/baseline.py](nemotron/baseline.py): intentionally small provisional state-machine referee used for offline evaluation and fixture regression checks. It is not official rulebook logic.
- [nemotron/classifier.py](nemotron/classifier.py): Nano classifier wrapper; includes heuristic fallback, deadline enforcement, and logging of the chosen path.
- [nemotron/eval.py](nemotron/eval.py): main offline/live evaluation runner for fixtures and metrics generation. Writes markdown results and tracks fallback behavior.
- [nemotron/generate_fixtures.py](nemotron/generate_fixtures.py): script that builds the 50 synthetic fixture files. It refuses to overwrite existing fixtures, intentionally leaving human-reviewed citations as TODO.
- [nemotron/metrics.py](nemotron/metrics.py): scoring functions for verdict accuracy, score agreement, citation accuracy, and p50/p95 latency calculations.
- [nemotron/README.md](nemotron/README.md): setup instructions for running the package offline, environment-variable setup for live calls, and the intended evaluation workflow.
- [nemotron/referee.py](nemotron/referee.py): wrapper that validates rally events and game state, then either calls the NVIDIA Super model or falls back to replay/no-fault. Includes the explicit placeholder rule block and safe-replay behavior.
- [nemotron/results.md](nemotron/results.md): generated report of the current provisional results and failure analysis. This is intentionally not a validated rulebook result.
- [nemotron/RULES_REVIEW.md](nemotron/RULES_REVIEW.md): explicit warning that no official rule numbers or text are included and that all citations require human review.
- [nemotron/rules.json](nemotron/rules.json): expected place to store official rule passages and reviewed IDs. Right now it is a placeholder structure that blocks live model runs until populated.
- [nemotron/schema.py](nemotron/schema.py): strict JSON parsing and validation for classifications, rallies, state, and rulings.
- [nemotron/transport.py](nemotron/transport.py): raw HTTP client to the NVIDIA OpenAI-compatible endpoint, including retry logic, quick rate-limit handling, log capture, and API-key redaction.
- [nemotron/tests/test_guardrails.py](nemotron/tests/test_guardrails.py): propagation tests for malformed JSON rejection, timeout logic, no-fault replay behavior, missing-key blocks, and rate-limit handling.

### Nemotron fixtures

- [nemotron/fixtures](nemotron/fixtures): directory of 50 synthetic JSON rally fixtures, grouped by category: serve, NVZ, two_bounce, scoring, and multi-condition. Each fixture includes an expected ruling, a category label, and TODO status for citation review.

Examples:

- [nemotron/fixtures/01_serve.json](nemotron/fixtures/01_serve.json)
- [nemotron/fixtures/11_nvz.json](nemotron/fixtures/11_nvz.json)
- [nemotron/fixtures/23_two_bounce.json](nemotron/fixtures/23_two_bounce.json)
- [nemotron/fixtures/33_scoring.json](nemotron/fixtures/33_scoring.json)
- [nemotron/fixtures/43_multi.json](nemotron/fixtures/43_multi.json)

These are smoke-test scenarios, not human-reviewed pickleball rulebook examples.

---

## 1) What is already implemented

### Game spine (working prototype)

The following files already show a functioning single-player, server-authoritative game loop:

- [server/index.js](server/index.js): WebSocket relay, authoritative simulation, `/api/spawn`, HTTPS/HTTP handling, per-client role checks.
- [server/physics.js](server/physics.js): 120Hz simulation, ball physics, aim assist, hit-window logic, rebounds, reset flow.
- [shared/config.js](shared/config.js): centralized tuning for court, physics, swing thresholds, tracking, network, and rendering.
- [shared/protocol.js](shared/protocol.js): schema validation for the fixed wire messages from the design doc.
- [shared/swing-detector.js](shared/swing-detector.js): swing detection state machine and calibration logic for phone IMU data.
- [client-phone/app.js](client-phone/app.js): phone UI, iOS motion permission flow, calibration flow, synthetic swings, WebSocket connection, and debug readout.
- [client-laptop/app.js](client-laptop/app.js): laptop UI, socket handling, spawn flow, keyboard trigger, court renderer bootstrap, and simple HUD logic.
- [shared/position-tracker.js](shared/position-tracker.js): basic body-position tracking from MediaPipe-style landmarks.
- [client-laptop/tracking.js](client-laptop/tracking.js): camera enable flow, MediaPipe loading, and pose updates.

The project already passes the existing JS and Python tests:

- [tests/physics.test.js](tests/physics.test.js)
- [tests/relay.test.js](tests/relay.test.js)
- [nemotron/tests/test_guardrails.py](nemotron/tests/test_guardrails.py)

The Node test output showed 13/13 JS tests passing and 14/14 Nemotron guardrail tests passing.

### Nemotron / eval package

The Python package is also substantially implemented and passes its offline guardrails:

- [nemotron/referee.py](nemotron/referee.py): offline fallback logic, prompt placeholders, validation, and structured ruling output.
- [nemotron/classifier.py](nemotron/classifier.py): classification API, heuristic baseline, and timeout logic.
- [nemotron/schema.py](nemotron/schema.py): strict JSON parsing and schema validation.
- [nemotron/generate_fixtures.py](nemotron/generate_fixtures.py): generates synthetic provisional fixtures.
- [nemotron/eval.py](nemotron/eval.py): evaluation harness for reporting metrics.
- [nemotron/results.md](nemotron/results.md): generated output and failure analysis placeholder.
- [nemotron/rules.json](nemotron/rules.json): empty/placeholder rule bundle structure.
- [nemotron/RULES_REVIEW.md](nemotron/RULES_REVIEW.md): explicit instructions that real rule citations must be reviewed by humans.

This is not a live model integration yet; it is an offline, guardrailed scaffold for it.

---

## 2) What is still left to do

### A. The project is still a single-player prototype, not a full two-player game

What exists now:

- One laptop can spawn a ball and render it.
- One phone can send swing events.
- The server owns the authoritative ball state.
- The phone can trigger a synthetic or motion-based swing.

What is still missing for the original design:

- A second station and a real opponent model from the other laptop.
- A proper two-player rally flow with both players on different court sides.
- Opponent pose streaming beyond the single laptop camera position.
- A complete UI for “player A / player B” court state and proper server rotation logic.
- Rule enforcement tied to a real rally event log, not just ball physics and a fallback harness.

The current code is intentionally single-direction and tests the core loop, but it does not yet implement the full design of “two players, two laptops, one server.”

### B. The Nemotron layer is still intentionally offline and human-review-gated

The code contains the right safety structure, but the real model-powered part is unfinished:

- [nemotron/rules.json](nemotron/rules.json) is not populated with official USA Pickleball text and exact rule IDs.
- [nemotron/referee.py](nemotron/referee.py) explicitly refuses to submit placeholder rule text.
- [nemotron/fixtures/](nemotron/fixtures) are synthetic smoke cases and not validated against the real rulebook.
- The live NVIDIA API path is present but not completed with a real provider setup and human-reviewed citations.

So the repo is ready for a future live run, but it is not yet “production-grade” as a judged Nemotron result.

### C. The full game-to-Nemotron integration has not been wired up

The design requires the server to:

1. receive swing and pose events,
2. build a rally event log,
3. call the referee/classifier at the right times,
4. return a validated ruling message.

This repo has the message schema, the server simulation, and the offline Python layer, but it does not yet connect them end-to-end in a real live rally.

### D. The real phone + Wi‑Fi + HTTPS setup still needs to be validated on-device

The project documentation explains the flow, but the actual iPhone path still needs a real-world check:

- install CA certs from mkcert,
- trust the cert on iPhone,
- open the LAN HTTPS URL,
- enable motion permission,
- confirm the phone sees motion and the laptop sees the swing launch.

This is not optional; without real device testing, the iOS flow is unproven.

### E. The MediaPipe pose path is present but not the full second-station milestone

The code includes camera capture and pose updates in [client-laptop/tracking.js](client-laptop/tracking.js) and [shared/position-tracker.js](shared/position-tracker.js), but the design’s Milestone 2 requires more than a basic camera position estimate:

- second station sync,
- opponent rendering,
- court pose estimation for live gameplay,
- serve-height / rule checks,
- better stability and calibration review.

The current implementation is a viable foundation, not a finished per-design pose system.

---

## 3) What a follow-up agent should do first

The next agent should not rewrite the project. The repo is already mostly in the correct shape. The next task is to complete the missing pieces in this order:

1. Validate the working single-player loop on real devices.
2. Finish the multiplayer / second-station integration.
3. Hook the server into a real rally event log and ruling path.
4. Populate the rulebook data and complete the human-reviewed fixtures.
5. Run the live and offline eval with honest reporting.

This order matters because the game can be validated without a true model call, and the Nemotron eval can run offline even when the API is unavailable.

---

## 4) Setup instructions for the next agent

### Local dev setup

From the repo root:

```bash
npm install
npm test
```

For the keyboard-only local loop:

```bash
npm run dev
```

Then open:

- http://localhost:8443/client-laptop/

Press Space to trigger a synthetic swing and confirm the ball launches and bounces correctly.

### HTTPS / phone setup

This is required for the actual iPhone motion flow.

1. Install mkcert if needed:

```bash
brew install mkcert
mkcert -install
```

2. Generate a cert for the current LAN address:

```bash
npm run certs
```

3. Start the secure server:

```bash
npm start
```

4. Read the URL printed in the terminal. It will look like:

```text
https://10.x.x.x:8443/client-phone/
```

5. On the phone, open that exact URL over the same LAN/Wi‑Fi.

6. Install the CA cert on iPhone:

- Move the root certificate from the laptop to the iPhone.
- Open it and install it in Settings > General > VPN & Device Management.
- Trust it under Settings > General > About > Certificate Trust Settings.

7. Open the LAN HTTPS phone URL in Safari.

8. Tap “Enable motion access”, wait for the device to settle, then swing.

9. On the laptop, open the matching court URL and confirm the ball launches.

### Important phone-side validation checks

The next agent should verify all of these:

- the phone loads over HTTPS, not HTTP,
- device permission request resolves correctly,
- the IMU signal appears in the debug UI,
- `peak_g` and `pitch` update in real time,
- the laptop receives the swing and launches the ball,
- repeated swings do not double-fire because of the state machine.

### Nemotron setup

For the eval package, use Python from the repo root or within the [nemotron](nemotron) folder:

```bash
cd nemotron
python3 -m unittest discover -s tests -v
python3 eval.py
```

For live model calls, set the API key before running:

```bash
export NVIDIA_API_KEY="..."
python3 eval.py --live --limit 1 --output results-live-smoke.md
```

Important: the current code is still designed around placeholder rule text and synthetic fixtures. A live run is not the same as a validated game rule result.

---

## 5) Concrete remaining tasks for the next agent

### Task 1 — validate and stabilize the existing loop

- Run the local keyboard loop.
- Confirm the server emits `state` snapshots as expected.
- Confirm the laptop page is connected and the ball launches correctly.
- Confirm the phone path works over HTTPS with motion permission.
- Verify the `swing` message schema remains unchanged and the server rejects invalid data.

### Task 2 — finish the second station / opponent path

- Add a second laptop client or a clear station abstraction.
- Decide how opponent pose and state are represented.
- Render the opponent on the court without breaking the server-authoritative model.
- Keep all ball state ownership on the relay server.

### Task 3 — make the referee path real

- Build a proper rally event log from ball and player events.
- Hook it to the existing `ruling` message format.
- Add a call path from the server to the Nemotron layer when a rally ends or a fault candidate appears.
- Preserve the fallback logic: if the model returns malformed or unrecognized rule info, do not mutate score.

### Task 4 — complete the rules package before model evaluation

- Obtain the exact USA Pickleball rulebook passages.
- Fill [nemotron/rules.json](nemotron/rules.json) with real rule IDs and verbatim text.
- Have two humans review each fixture’s ground-truth citation.
- Do not invent rule numbers or citations.

### Task 5 — run the analytic evaluation honestly

- Run the offline eval and record the provisional metrics.
- Compare the heuristic baseline to the model paths.
- Log every raw model response and failure case.
- Document each mismatch in [nemotron/results.md](nemotron/results.md).

---

## 6) What not to do

- Do not rewrite the existing server simulation core.
- Do not remove the schema validation.
- Do not invent pickleball rule numbers.
- Do not assume the local laptop port or LAN URL is the same on every device.
- Do not treat the current Python package as a fully validated referee engine; it is an honest offline scaffold.

---

## 7) Recommended next immediate milestone

If the next agent needs a clear first target, this is the right one:

> Finish the real device validation and then integrate the second station while preserving the already-working single-player server-authoritative loop.

That is the minimum step that converts the repo from “fun prototype + scaffolding” into a realistic working hackathon build.

---

## 8) Verified status

The project has already been validated with the existing automated tests:

- JS tests: pass
- Nemotron guardrail tests: pass

The remaining gap is not basic syntax or structure; it is behavior fidelity to the original design, especially the second-stage multiplayer, live rule adjudication, and human-reviewed rule data.
