Virtual pickleball — system design
Two-player pickleball played in physical space with no ball and no court. Each player has a laptop and a phone. The phone is the paddle. The laptop watches the player and renders the court in first person. Nemotron classifies shots and referees the rules.
Built for the SteelHacks "Best Use of NVIDIA Nemotron" track.

1. Component map
Component
Runs on
Job
Phone client
Phone browser
Read IMU, detect swings, stream to server
Laptop client
Laptop browser
Webcam pose, Three.js render, HUD
Relay server
One laptop or a spare machine
Authoritative sim, WebSocket hub, Nemotron calls
Nemotron layer
build.nvidia.com
Shot classification, rules adjudication
Key architectural decision: the server is authoritative. Ball state lives in exactly one place. The laptops are sensor sources and renderers, nothing more. This kills the "two clients disagree about whether the ball was in" problem before it exists, and it means the referee only ever reads one event log.

2. Sensing
Phone — swing dynamics
DeviceMotionEvent gives accelerationIncludingGravity and rotationRate at roughly 60Hz.
Derived signals:
    •    Swing speed. Peak acceleration magnitude over the swing window, mapped to ball speed through a per-player calibration.
    •    Paddle face. Gravity vector when the phone is near-static gives pitch and roll. Integrate the gyro through the swing itself; drift over a 300ms window is tolerable.
    •    Contact instant. Acceleration magnitude peak followed by a sign reversal on the dominant axis.
Swing detection state machine:
IDLE → BACKSWING   (|a| rises above 1.5g)
     → CONTACT     (|a| peaks, then reverses)
     → FOLLOW      (|a| decays below 1.2g)
     → IDLE        (200ms refractory, prevents double-fire)
iOS needs HTTPS and DeviceMotionEvent.requestPermission() called from inside a tap handler. Budget an hour for this and do it first. Android is more forgiving if you get stuck.
Webcam — body state
MediaPipe Pose Landmarker, lite model, ~30fps. Used only for things that change slowly:
    •    Lateral court position from hip midpoint x
    •    Depth proxy from shoulder width in pixels, calibrated at setup
    •    Body rotation from shoulder line angle
    •    Contact height from wrist y relative to hip y, which is what the serve legality check needs
Do not use the webcam for swing velocity. At 30fps with motion blur you get two usable frames through a fast swing. That is what the phone is for.
Calibration — 30 seconds at setup
    1    Stand still, arms down. Captures shoulder-width baseline and hip height.
    2    Hold the phone flat and still. Captures the gravity reference for paddle face.
    3    Three practice swings: soft, medium, hard. Maps peak acceleration onto a ball speed range.

3. Message schemas
Phone → server, on swing:
{ "t": 1234567, "type": "swing", "peak_g": 3.8, "pitch": 14.2,
  "roll": -6.1, "yaw_rate": 220, "duration_ms": 310 }
Laptop → server, 15Hz:
{ "t": 1234567, "type": "pose", "court_x": -1.2, "court_y": 2.9,
  "torso_deg": 18, "wrist_h": 0.94 }
Server → laptop, 60Hz:
{ "t": 1234567, "type": "state",
  "ball": { "x": 0.4, "y": 1.1, "z": 6.2, "vx": 0.2, "vy": 3.1, "vz": -8.4 },
  "score": [6, 4], "server": 2, "phase": "rally" }
Server → laptop, on ruling:
{ "type": "ruling", "fault": true, "player": "A", "rule": "9.B",
  "explanation": "Momentum carried player A into the non-volley zone.",
  "score": [6, 5], "side_out": true }

4. Physics
Court is 20ft by 44ft, net 34in at center, non-volley zone 7ft either side. Work in meters internally.
    •    Semi-implicit Euler at 120Hz on the server
    •    Gravity 9.81, quadratic drag with a coefficient tuned by feel, restitution around 0.75 on bounce
    •    Launch vector at contact:
    ◦    speed from peak acceleration via calibration, clamped to 5–35 mph
    ◦    elevation from paddle pitch, filtered through the shot-type prior
    ◦    azimuth from torso rotation plus paddle roll
Aim assist is what makes this playable. Pull the ball 30–40% toward the classified target zone. Raw IMU-derived trajectories feel random, not skillful. Tune this by playtest and do not be precious about realism.
Hit window is generous on purpose. The ball must pass within a 0.9m sphere of the estimated paddle position. A tight window reads as "broken," not "hard."

5. Rendering
Three.js, PerspectiveCamera at estimated eye height, positioned at the player's court position.
    •    Camera position follows the pose estimate through a one-pole filter at alpha ≈ 0.15, or the view shakes with pose jitter
    •    Opponent is a capsule plus a paddle, driven by the other station's pose stream
    •    The ball gets a short motion trail. This is not decoration — it is the only depth cue on a 2D screen, and without it players cannot judge when to swing.
    •    HUD: score, server number, last shot classification, last ruling

6. Nemotron layer
Role 1 — Shot classifier (Nemotron 3 Nano)
Fires on every swing, in parallel with the physics launch.
Input is the swing feature JSON plus pose context, as text. Output is strict JSON:
{ "shot": "dink|drive|drop|lob|smash|serve|mishit",
  "target_zone": "near_left|near_right|deep_left|deep_right|kitchen",
  "confidence": 0.91 }
Reasoning off, temperature 0, small max_tokens.
Latency handling. Physics launches immediately using heuristic priors. Flight time is 0.8–1.5s, so when the classification returns at ~200–300ms the server applies the spin and arc correction while the ball is still airborne. If nothing returns inside 300ms, the heuristic stands and the fallback is logged.
Why a model instead of a classifier. No labeled dataset of pickleball swings exists and you cannot collect one in 36 hours. This is the honest answer and it is a good one. Say it exactly this way to the judges.
The heuristic fallback — thresholds on peak acceleration and wrist height — doubles as your eval baseline.
Role 2 — Rules referee (Nemotron 3 Super)
Fires at rally end, or immediately on any candidate fault event.
Input is the full rally event log plus current score and server state. Output is strict JSON matching the ruling message above. Reasoning on — this is where the tokens are worth spending. One to three seconds is fine because it runs between rallies.
The system prompt carries the relevant rule text verbatim: the two-bounce rule, the non-volley zone including momentum faults, serve legality, and scoring with server rotation.
Guardrail. Schema-validate every response. On invalid JSON or an unrecognized rule ID, fall back to "no fault, replay the point" and log it. Never let a malformed model response change the score.
Prompt sketch — referee
You are a pickleball referee. You receive a structured event log for one
rally and the game state before it. Decide whether a fault occurred.

Rules in force:
[paste the four rule sections verbatim]

Respond with JSON only, no prose, no markdown fences:
{"fault": bool, "player": "A"|"B"|null, "rule": string,
 "explanation": string, "score": [int, int], "side_out": bool}

If no rule clearly applies, set fault to false and rule to "none".
Cite exactly one rule. Keep the explanation under 30 words.
Model access
Hosted endpoints on build.nvidia.com, OpenAI-compatible, free tier with development rate limits, no local GPU needed. Get API keys before the hackathon starts. Do not spend Saturday night fighting a vLLM install.

7. Eval plan
This is the graded part of the track. Build it against replay logs, not live gameplay, so it survives the vision pipeline breaking at 4am.
Referee eval
50 hand-written rally logs as JSON fixtures, derived from rulebook examples.
Coverage:
Category
Fixtures
Serve legality
10
Non-volley zone (6 of them momentum)
12
Two-bounce rule
10
Scoring and server rotation
10
Multi-condition
8
Ground truth is a rulebook citation per fixture, reviewed by two people independently.
Metrics: verdict accuracy, rule-citation accuracy, score-update accuracy.
Comparisons: Nano vs Super, reasoning on vs off, and both against your own hardcoded state machine.
Report the failures. Momentum faults and cases where two conditions fire at once are where it will break, and a slide showing 43/50 with an analysis of the 7 beats a slide claiming 50/50.
Classifier eval
100 swings captured with prompted labels — you tell the player "hit a dink now" and record the label at capture time.
Metrics: overall accuracy, per-class recall, confusion matrix, p50 and p95 latency, fallback rate.
Baseline: the threshold heuristic. Show where it collapses, which will be distinguishing a drop from a dink since both are low-speed.
Both harnesses are about 60 lines of Python. Write them Saturday morning while someone else fights the webcam.

8. Stack
    •    Server: Node with ws, or Python with FastAPI. Use whichever the team already knows.
    •    Laptop client: vanilla JS, Three.js, MediaPipe Tasks Vision, all from CDN
    •    Phone client: one HTML page — DeviceMotion plus a WebSocket
    •    Eval: Python, JSON fixtures, results printed as a markdown table
    •    Transport: same LAN, same room. HTTPS via mkcert or a tunnel, required for the iOS permission flow.

9. Build order
Hours
Work
0–2
Repo, server skeleton, phone page logging IMU. Solve the iOS permission now.
2–6
Swing detection on raw IMU. Print SWING 3.8g 14° to a terminal. Riskiest primitive.
6–10
Three.js court and ball physics, swings triggered by keyboard. Playable against a wall.
10–14
Wire phone swings to ball launch. One player, one direction. This is the demo floor.
14–18
MediaPipe pose to camera position. Second station, server-authoritative sync.
18–24
Referee. Rule prompt, JSON schema, fixtures.
24–28
Eval harness for both roles, run the comparisons.
28–32
Classifier in the loop, aim assist tuning, HUD.
32–36
Demo script, slides, freeze.
Freeze rule: after hour 32 nothing merges except crash fixes.

10. Risks and pre-decided cuts
Decide these now, while you are calm, so nobody has to argue at 3am.
If this breaks
Cut to
iOS permission flow
Android phone, or keyboard-triggered swings with the IMU as a stretch goal
MediaPipe too jittery
Drop pose entirely, fix the camera at center court. Game and referee both still work.
Swing detection unreliable
Widen the hit window, lower the g threshold, accept false positives
Two-station networking eats the night
Single player against a bot. The Nemotron story is unaffected.
Nemotron latency spikes
Heuristic fallback is already there — report the fallback rate as a finding
Notice that the Nemotron submission depends on the eval harness and the fixtures, and neither depends on the game working. Protect that ordering above everything else.

11. Demo script, 90 seconds
    1    Two teammates side by side, laptops facing them, phones in hand. Twenty seconds of live rally.
    2    Freeze on a non-volley-zone fault. Show the HUD ruling with the cited rule.
    3    Cut to the eval table: 50 fixtures, Super vs Nano vs the hardcoded state machine.
    4    Show one failure case and say what you learned from it.
    5    One closing line on why an LLM: no labeled swing data, and the rules interact combinatorially.

12. Open questions
    •    Aim assist strength. Playtest it, do not theorize about it.
    •    Whether the mid-flight classifier correction is visible. If the ball appears to jump, apply the prior only at launch and eat the latency instead.
    •    The serve height check needs a waist estimate. The MediaPipe hip landmark is the proxy — verify it is stable enough before you build the rule around it.
    •    Rule numbering in this document was written from memory. Check every citation against the current USA Pickleball rulebook before it reaches a slide.