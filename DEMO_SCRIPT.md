# SteelHacks demo script (90 seconds)

## Setup (before judging)

- `npm start` on the laptop (HTTPS certs installed). Laptop page open, phone page
  open on the same Wi-Fi, motion enabled, camera tracking optional.
- Sound on for voice rulings. Evidence panel collapsed but visible.

## The 90 seconds

**0:00–0:25 — Live rally.** "My phone is the paddle." Click Spawn ball, swing the
phone (or press Space). The ball launches, the bot returns it, the rally plays out
on the laptop in first person. Point at the HUD: every swing is classified live —
"drive → deep left, 50% confidence."

**0:25–0:45 — The referee.** The rally ends; the Nemotron referee adjudicates from
the rally log and the ruling lands in the HUD: "Fault · Player A · rally_outcome.
The event log records a terminal rally fault." The voice speaks it. Open the
evidence panel: rule cited, provisional flag, the exact bounce/bounce sequence
that produced the call, and the shot that preceded it. Score stays [0,0] — this
was a side-out, and the serve flips to B.

**0:45–1:05 — The evidence.** Flip to the eval table: 50 fixtures, offline numbers
labeled offline. "The state machine agrees with its own fixtures 50/50 — that's a
regression check, not proof. Here's our honest failure: the heuristic confuses
drop and dink — low acceleration and low wrist look identical without trajectory
data. That's exactly the gap the live model is meant to close."

**1:05–1:30 — Why Nemotron.** "We didn't bolt a chatbot onto a game. The LLM does
two jobs a rules engine can't: it reads noisy IMU swings and calls them like a
coach would, and it reads a rally log against the actual rulebook and cites the
rule. Every output is schema-validated before it can touch the score — a bad model
response can never corrupt the game."

## Fallbacks if something dies on stage

- Phone motion dead → keyboard demo: Spawn ball + Space. Classification still runs.
- Wi-Fi isolation → everything is same-LAN; tether both devices to one phone hotspot.
- API failure → offline fallbacks are labeled in the HUD; the demo still works.
- Renderer failure → the HUD, rulings, and evidence panel all work without the 3D view.

## Freeze rule

After two successful end-to-end rehearsals, merge crash fixes only.
