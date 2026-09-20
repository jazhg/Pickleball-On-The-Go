# Gameplay and Nemotron integration

`Simulation.finish` decides the fault, score, side-out, and winner synchronously.
`server/index.js` immediately broadcasts `ruling` and `ruling_evidence`. Model
responses never mutate scores or serve ownership.

The active model jobs are:

- Swing classification via `classifySwing` → Python `classify`; a tight 300 ms
  deadline. The result carries shot/player identity and older shot results are
  discarded. Heuristic/fallback paths remain labeled.
- Rally coaching via `coachRally` → Python `coach`. Nemotron 3.5 Lightning chooses
  an eligible cue and supporting event index. The Python request timeout is 8 s;
  the Node bridge kills a stuck process after 9 s. One coaching process at a time.
  A newer completed rally, rematch, or practice mode invalidates older results.
- Sparse recorded praise via `chooseCommentary` → Python `commentary`; existing
  rate and voice gates still apply. Official calls come from confirmed game events.

`NEMOTRON_LIVE=1` and `NVIDIA_API_KEY` enable live calls. npm run scripts load an
optional, gitignored `.env`; static routes cannot expose it. Python eval commands
require the key in their environment. Missing/invalid/late model output leaves the
rules engine running and selects an honestly labeled fallback.

`buildRallyEnvelope` retains real contact/bounce timestamps and volley flags and
uses the **pre-rally** score/server snapshot. Its serve-motion predicates describe
an assisted virtual serve, not sensed human compliance. The legacy `referee` op is
retained for standalone fixture evaluation and still refuses unreviewed rulebook
configuration. It is no longer a dependency of match scoring.

New/extended wire data: `new_game` (only accepted from a laptop at game over), state
`winner/serve_side/bounce_required/rally_id`, optional classification `shot_id/player`,
`coach_status`, `coach_decision`, and optional practice `focus`. Only whitelisted
focus values are accepted. A chosen movement, loft, or power cue routes to a
corresponding practice feed profile; practice does not change match scores.

Solo Blue has bounded lateral/vertical reach, returns after 180 ms, and serves when
it owns the ball. Any human Blue station disables the bot for the rest of the relay
session. Human disconnects never silently activate a bot.

See [HACKATHON.md](../HACKATHON.md) for the demo and exact evidence limitations.
