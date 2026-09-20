# Nemotron inside a playable pickleball system

## The role

Phone sensors produce swing intent and paddle orientation. The Node relay simulates
the ball and enforces singles side-out scoring to 11, win by 2. At the end of a rally,
`server/index.js` calls `coachRally` → `nemotron/bridge.py` → `nemotron/coach.py`.
Nemotron selects one training cue and the event supporting it. The cue drives a
visible coaching card; applicable cues route the Practice button to a specific feed
profile in `Simulation.practiceFeed`.

The output is structured decision data, not generated conversation. All displayed
cue wording is curated. The model chooses among eligible actions using the actual
sequence of contacts, trajectories, bounces, and confirmed fault. An `out` flag alone
cannot distinguish a sideline miss from a baseline miss: the model can use x/z to
choose between squaring the face and softening power. More nuanced model selection
is the intended benefit, **not a demonstrated improvement yet**. A simple geometric
heuristic could handle this small fixture set; live evaluation is needed to justify
using a model as the scenario coverage grows.

## Demo (about 90 seconds)

1. Start the HTTPS server with `.env` configured for NVIDIA. Open a laptop and its
   paired phone. If no key is available, explicitly demonstrate offline fallback.
2. Tap Serve, then swing. Show the correct service side and diagonal target. After
   the bot's return, let it bounce twice: the server immediately calls the fault
   and switches serve without awarding a point to the receiver.
3. Show the coaching card: `Nemotron live` means a validated model decision.
   `Offline / fallback` is not evidence of a successful model call.
4. Open Match menu → Referee evidence to inspect the timestamped rally.
   For movement/loft/power cues, select Practice this cue and show the altered feed.
5. Show `coach-eval-offline.json` and optionally your separately generated live
   report. Compare the baseline's deep-miss failure with the live decision and its
   actual latency. Do not claim a live comparison unless its path is `model`.

## Evidence collected in this branch

- Eight reproducible synthetic cases generated from the Simulation's rally log.
- Offline cue baseline: **7/8** expected selections. Deep baseline miss incorrectly
  selects `reduce_angle`; expected `soften_power`. Zero cases human-reviewed.
- Python tests validate the decision boundary using mocked valid/invalid outputs,
  out-of-range/boolean evidence indices, invented score fields, and network failure.
- JavaScript tests exercise scoring/deuce/game over, server ownership/parity, both
  seats' serve trajectories, volley restrictions, second bounce outside, steering,
  spin, interpolation, practice routing, and two-player relay ownership.
- Browser checks during initial implementation covered court rendering, solo side-out/scoring,
  coaching cards, and browser console errors.
- `scripts/benchmark-gameplay.js` measures contact calculation and simulation CPU
  cost. It does not measure GPU FPS. Static seating went from 382 meshes to three
  instanced meshes by material; rendering uses no new external art downloads.

## Failure handling and constraints

No API key was present during implementation. A real NVIDIA call and physical phone
playtest remain unverified. The checked-in report is deliberately labeled offline.

The coaching adapter allows 8 seconds for NVIDIA and the Node process bridge kills
a stalled process at 9 seconds. Only one coaching request can be active. Decisions
for an older completed rally are discarded; scoring never waits for them. The older
shot classifier still has a tight 300 ms deadline and may frequently fall back on a
hosted connection. Its labels honestly identify that path.

The previous standalone referee adapter still requires reviewed rulebook data. We
do not remove or forge that review requirement: the current deterministic gameplay
and coaching selector operate independently of that adapter.

Scores are server-authoritative but in memory: restarting the server resets a game.
Virtual underhand serving and estimated foot positions are game abstractions, not
proof that a real player's motion complies with every tournament rule. Sidespin is
a bounded gameplay approximation. Real phone calibration, comfortable hit timing,
and GPU performance should be checked on the actual demo machines.
