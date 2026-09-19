# Nemotron integration notes

## What is wired in

Two Nemotron models do non-chatbot work inside the live game loop:

1. **Per-swing classifier (Nemotron 3 Nano).** Every accepted swing launches physics
   immediately and *asynchronously* invokes the classifier on `{swing, pose}`.
   Result: `{shot, target_zone, confidence}` broadcast to the laptop HUD.
2. **Rally referee (Nemotron 3, reasoning on).** When a rally completes, the server
   builds a referee envelope (fixture-style events + game state) from the
   authoritative sim log and adjudicates asynchronously. The ruling is validated
   by `validateRulingForApply` (score shape, `side_out` boolean, fault/no-fault
   consistency) **before** any state mutation; malformed output is dropped and the
   score is never corrupted.

The laptop HUD shows live classifications, referee rulings, a judges' evidence
panel (rule cited, provisional flag, triggering rally events, preceding shot),
a rally replay timeline, a shot-analytics strip, and spoken rulings via the Web
Speech API (mutable).

## Architecture

```
phone/laptop --ws--> server/index.js --spawn--> python3 nemotron/bridge.py --calls--> classifier.py / referee.py
   ^                       |  (one-shot child per request; killed on timeout)            |
   |                       +-- broadcasts: state / classification / ruling / ruling_evidence
```

- `nemotron/bridge.py`: line-delimited JSON CLI (`ping` / `classify` / `referee`).
  Survives malformed stdin; never logs or echoes `NVIDIA_API_KEY`.
- `server/nemotron-bridge.js`: spawn/kill/timeout wrapper. Never throws into the
  sim loop; every failure resolves to a labeled fallback (`path: 'fallback'`).
- `server/index.js`: `buildRallyEnvelope` translates sim events (`contact`,
  `bounce`, `rally_end`) into fixture-style events (`serve`, `bounce`, `hit`,
  `fault`); `applyRuling` applies score/side-out only after validation.
- New wire messages (existing four schemas untouched): `classification`
  `{t, type, shot, target_zone, confidence, path}` and `ruling_evidence`
  `{t, type, rule, provisional, path, trigger_events, preceding_shot}`.

## Environment variables

| Var | Effect |
| --- | --- |
| `NEMOTRON_LIVE=1` + `NVIDIA_API_KEY` | Live model calls. Without **both**, the bridge stays offline. |
| (neither) | Offline-safe default: heuristic classifier + provisional state-machine referee. |

The key is read only by `nemotron/transport.py` for the Authorization header and
is redacted from all on-disk logs. Never commit it, never echo it.

## Timeouts and guardrails

- Classifier deadline: 300 ms (`CONFIG.nemotron.classifierTimeoutMs`). Late or
  failed results fall back; the HUD clears a stuck "Classifying…" on the next
  swing or after 2 s.
- Referee timeout: 25 s (`CONFIG.nemotron.refereeTimeoutMs`); adjudication never
  blocks the 120 Hz loop. On timeout/failure: no ruling broadcast, score untouched.
- `applyRuling` rejects: non-boolean fault, bad score arrays (length, negativity,
  non-integers), non-boolean `side_out`, fault without player/rule, no-fault that
  moves the score or sets side-out.
- `referee.py::load_rules` refuses placeholder text, missing edition, or fewer
  than two human reviewers (`rules_need_two_reviewers`). In-game rulings are
  therefore labeled **provisional** until `rules.json` is human-reviewed.
- Offline referee uses the provisional `baseline.py` state machine — authored
  alongside the fixtures, so it is a regression check, not independent rules
  accuracy. Its internal `rule_key` labels a branch, never a rulebook citation.

## Wall bot ("B")

Solo-play stand-in: after the first in-bounds far-side bounce, the ball is
returned after ~350 ms as a high lob to the player side. Not sensed input, not a
second player. Typical rally: serve → far bounce → bot return → two bounces on
your side → fault on A → side-out (score stays [0,0], serve flips to B).

## Honest caveats and cuts

- Serve-motion predicates in the rally envelope (foot position, waist height,
  upward motion, paddle-below-wrist) are **assumed compliant, not sensed**.
- Serve-target adjudication (correct diagonal service court) is approximated;
  the envelope records bounce positions and leaves the call to the model.
- Singles only. No doubles UI despite doubles fixtures in eval.
- Mid-flight classifier trajectory correction was cut: visible ball jumps were a
  demo risk.
- MediaPipe gameplay input, second station, and ElevenLabs were cut under time
  pressure; voice uses the free Web Speech API.
- Eval numbers in `nemotron/results.md` are OFFLINE until a live run replaces them.
- `nemotron/REVIEW_NOTES.md` is a non-authoritative AI pre-review; fixtures need
  two human reviewers (reconcile 28, 16, 44, 48, 46, 35, 09 first).

## Verification

```sh
npm test                                   # 21 tests, incl. full relay E2E
echo '{"op":"ping"}' | python3 nemotron/bridge.py
cd nemotron && python3 eval.py --live --limit 3   # needs NVIDIA_API_KEY + reviewed rules.json
```
