mplementation handoff prompts
Two prompts, not one. The game spine and the Nemotron layer are independent and should run in parallel. They only meet at the message schema in section 3 of the design doc.
Attach virtual-pickleball-design.md alongside whichever prompt you send.

Prompt A — game spine
Attached is virtual-pickleball-design.md, the design for a two-player virtual
pickleball game. Read it fully before writing code.

Implement MILESTONE 1 ONLY: the sensing spine and a playable single-direction
loop. Sections 1–5 of the design. Do not build the Nemotron layer — another
agent owns that.

Deliverables:
- Repo skeleton: /server, /client-laptop, /client-phone, /shared
- Relay server with the WebSocket message schemas in section 3, exactly as
  specified. Server holds authoritative ball state at 120Hz.
- Phone client: single HTML page, DeviceMotion permission flow that works on
  iOS Safari, swing-detection state machine from section 2, emits `swing`
  events. Include an on-screen readout of live peak_g and pitch for debugging.
- Laptop client: Three.js court to spec dimensions, ball with motion trail,
  PerspectiveCamera. Ball physics per section 4 including the generous hit
  window and aim assist as a tunable constant.
- A keyboard trigger (spacebar) that fires a synthetic swing event, so the
  game is testable with zero hardware.

Build order matters: get the keyboard-triggered loop playable BEFORE wiring
real IMU input. I want a working game I can test without a phone.

Constraints:
- Do not use the webcam for swing velocity. Pose comes in milestone 2.
- Vanilla JS, CDN imports, no build step. No frameworks.
- Every derived constant (drag, restitution, aim assist strength, g
  thresholds, hit window radius) goes in one exported config object with
  comments on the sane range. These get tuned by playtest, not by you.
- Same-LAN only. Serve over HTTPS via mkcert; the iOS permission flow
  requires it.

Definition of done: I can run the server, open the laptop client, press
spacebar, and watch a ball launch and bounce correctly on the far side. Then
separately, open the phone page, swing, and see the same thing happen.

If the iOS permission flow fights you for more than 30 minutes, stop and
report rather than working around it. Ask before adding any dependency not
named in the design.

Prompt B — Nemotron layer and eval
Attached is virtual-pickleball-design.md. Read sections 6 and 7 carefully.

Implement the Nemotron layer and its eval harness as a standalone Python
package that does NOT import from or depend on the game. It reads JSON rally
logs from disk and returns rulings. Another agent is building the game; you
two only meet at the message schema in section 3.

Deliverables:
- referee.py: takes a rally event log + game state, calls Nemotron 3 Super
  on build.nvidia.com (OpenAI-compatible endpoint), returns a validated
  ruling dict. Strict JSON output, schema validation, and the section 6
  fallback: on malformed response or unknown rule ID, return no-fault/replay
  and log it.
- classifier.py: same shape for Nemotron 3 Nano, plus heuristic_classify()
  implementing the threshold baseline. 300ms timeout, falls back to the
  heuristic, records which path was taken.
- fixtures/: 50 rally logs as JSON, distributed per the table in section 7.
  Each fixture carries an expected_ruling field.
- eval.py: runs both roles across the fixtures, prints a markdown table.
  Referee metrics: verdict accuracy, rule-citation accuracy, score-update
  accuracy. Compares Nano vs Super and reasoning on vs off against the
  hardcoded state machine. Classifier metrics include p50/p95 latency and
  fallback rate.
- results.md: the output, plus a written analysis of every failure case.

IMPORTANT: do not invent pickleball rule numbers or rule text. Write the rule
section of the prompt as a clearly marked placeholder block and tell me
exactly what to paste in from the USA Pickleball rulebook. Same for fixture
ground truth — generate the scenarios, mark the citations as TODO for human
review.

Constraints:
- API key from env, never hardcoded. Handle rate limits with backoff.
- Temperature 0 everywhere. Reasoning off for the classifier, on for the
  referee.
- Log every raw model response to disk. The failure analysis is the graded
  part of this project and I cannot reconstruct it later.

Definition of done: `python eval.py` runs against the fixtures and produces
results.md with real numbers.

Build the fixtures and the harness before the model calls, so the eval exists
even if the API is down.

Notes on why these are written this way
The placeholder instruction in Prompt B is the important one. An agent asked to write pickleball rules will confidently produce plausible-looking rule numbers. A judge who plays will catch it.
Both prompts specify a testable-without-hardware path. Spacebar-triggered swings in A, disk-based fixtures in B. Neither agent can hand you something you can only verify by having two phones and a working webcam at 3am.
Neither agent owns the schema. It's fixed in the design doc. If one of them wants to change it, that's a conversation with you, not a unilateral edit.
Milestone 2 — MediaPipe pose feeding camera position, and the second station — goes to whoever finishes first. Don't put it in either prompt up front.