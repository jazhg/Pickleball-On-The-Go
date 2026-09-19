# Nemotron evaluation results

Generated: 2026-09-19T17:23:36.864384+00:00

Mode: OFFLINE — no model requests. Fixtures evaluated: 50. Independently reviewed: 0.

All bundled rally scenarios and swing examples are authored synthetic smoke cases. Verdict and score columns below measure agreement with provisional assertions, not validated pickleball accuracy. Citation accuracy only counts citations from fixtures reviewed by two different people. No rule numbers or official rule text have been supplied.

## Referee — provisional scenario agreement

| Method | Reasoning | Evaluated | Verdict + player | Reviewed citation | Score + side out | Fallback rate |
| --- | --- | --- | --- | --- | --- | --- |
| State machine | n/a | 50 | 50/50 (100.0%) | N/A (0 eligible) | 50/50 (100.0%) | 0 |
| Nemotron 3 Nano | off | NOT RUN | N/A | N/A | N/A | N/A |
| Nemotron 3 Nano | on | NOT RUN | N/A | N/A | N/A | N/A |
| Nemotron 3 Super | off | NOT RUN | N/A | N/A | N/A | N/A |
| Nemotron 3 Super | on | NOT RUN | N/A | N/A | N/A | N/A |
| Safe-replay offline path | n/a | 50 | 15/50 (30.0%) | N/A (0 eligible) | 16/50 (32.0%) | 50/50 (100.0%) |

## Referee — reviewed ground truth only

| Method | Verdict | Score + side out |
| --- | --- | --- |
| State machine | N/A (0 eligible) | N/A (0 eligible) |

Coverage: multi=8, nvz=12, scoring=10, serve=10, two_bounce=10.
Dedicated NVZ momentum cases: 6.

State-machine next-server diagnostic: 10/10 (100.0%). The fixed ruling wire schema only carries score and side_out, so model server-number accuracy cannot be inferred or claimed.

## Classifier

Dataset: synthetic smoke examples, NOT human captures; n=50. Required 100 prompted human swings: 0/100 supplied. Latencies below are measured wall time for the named path; offline latencies are not model/network latencies.

| Method | n | Accuracy | p50 ms | p95 ms | Fallback |
| --- | --- | --- | --- | --- | --- |
| Heuristic | 50 | 43/50 (86.0%) | 0.002 | 0.003 | n/a |
| Nano offline fallback | 50 | 43/50 (86.0%) | 0.105 | 0.132 | 50/50 (100.0%) |

### Heuristic: confusion matrix (rows=prompted label; columns=prediction)

| Label | dink | drive | drop | lob | smash | serve | mishit | Recall |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| dink | 8 | 0 | 0 | 0 | 0 | 0 | 0 | 8/8 (100.0%) |
| drive | 0 | 7 | 0 | 0 | 0 | 0 | 0 | 7/7 (100.0%) |
| drop | 7 | 0 | 0 | 0 | 0 | 0 | 0 | 0/7 (0.0%) |
| lob | 0 | 0 | 0 | 7 | 0 | 0 | 0 | 7/7 (100.0%) |
| smash | 0 | 0 | 0 | 0 | 7 | 0 | 0 | 7/7 (100.0%) |
| serve | 0 | 0 | 0 | 0 | 0 | 7 | 0 | 7/7 (100.0%) |
| mishit | 0 | 0 | 0 | 0 | 0 | 0 | 7 | 7/7 (100.0%) |

### Nano offline fallback: confusion matrix (rows=prompted label; columns=prediction)

| Label | dink | drive | drop | lob | smash | serve | mishit | Recall |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| dink | 8 | 0 | 0 | 0 | 0 | 0 | 0 | 8/8 (100.0%) |
| drive | 0 | 7 | 0 | 0 | 0 | 0 | 0 | 7/7 (100.0%) |
| drop | 7 | 0 | 0 | 0 | 0 | 0 | 0 | 0/7 (0.0%) |
| lob | 0 | 0 | 0 | 7 | 0 | 0 | 0 | 7/7 (100.0%) |
| smash | 0 | 0 | 0 | 0 | 7 | 0 | 0 | 7/7 (100.0%) |
| serve | 0 | 0 | 0 | 0 | 0 | 7 | 0 | 7/7 (100.0%) |
| mishit | 0 | 0 | 0 | 0 | 0 | 0 | 7 | 7/7 (100.0%) |

## Every observed referee failure / fallback

- **Safe replay / 01_serve — Legal volley serve**: Expected no-fault outcome preserved. Expected fault/player/score/side_out=False/None/[6, 4]/False; observed=False/None/[6, 4]/False. Path=fallback; reason=offline. Offline safe replay deliberately leaves score unchanged; this is a guardrail result, not a model mistake.
- **Safe replay / 02_serve — Contact above waist**: Mismatch in verdict/player, score/side_out. Expected fault/player/score/side_out=True/A/[6, 4]/True; observed=False/None/[6, 4]/False. Path=fallback; reason=offline. Offline safe replay deliberately leaves score unchanged; this is a guardrail result, not a model mistake.
- **Safe replay / 03_serve — No upward swing**: Mismatch in verdict/player, score/side_out. Expected fault/player/score/side_out=True/A/[6, 4]/True; observed=False/None/[6, 4]/False. Path=fallback; reason=offline. Offline safe replay deliberately leaves score unchanged; this is a guardrail result, not a model mistake.
- **Safe replay / 04_serve — Paddle above wrist**: Mismatch in verdict/player, score/side_out. Expected fault/player/score/side_out=True/A/[6, 4]/True; observed=False/None/[6, 4]/False. Path=fallback; reason=offline. Offline safe replay deliberately leaves score unchanged; this is a guardrail result, not a model mistake.
- **Safe replay / 05_serve — Foot position illegal**: Mismatch in verdict/player, score/side_out. Expected fault/player/score/side_out=True/A/[6, 4]/True; observed=False/None/[6, 4]/False. Path=fallback; reason=offline. Offline safe replay deliberately leaves score unchanged; this is a guardrail result, not a model mistake.
- **Safe replay / 06_serve — Wrong diagonal service court**: Mismatch in verdict/player, score/side_out. Expected fault/player/score/side_out=True/A/[6, 4]/True; observed=False/None/[6, 4]/False. Path=fallback; reason=offline. Offline safe replay deliberately leaves score unchanged; this is a guardrail result, not a model mistake.
- **Safe replay / 07_serve — Serve lands in kitchen**: Mismatch in verdict/player, score/side_out. Expected fault/player/score/side_out=True/A/[6, 4]/True; observed=False/None/[6, 4]/False. Path=fallback; reason=offline. Offline safe replay deliberately leaves score unchanged; this is a guardrail result, not a model mistake.
- **Safe replay / 08_serve — Legal drop serve ignores volley motion predicates**: Expected no-fault outcome preserved. Expected fault/player/score/side_out=False/None/[6, 4]/False; observed=False/None/[6, 4]/False. Path=fallback; reason=offline. Offline safe replay deliberately leaves score unchanged; this is a guardrail result, not a model mistake.
- **Safe replay / 09_serve — Drop serve still has illegal foot position**: Mismatch in verdict/player, score/side_out. Expected fault/player/score/side_out=True/A/[6, 4]/True; observed=False/None/[6, 4]/False. Path=fallback; reason=offline. Offline safe replay deliberately leaves score unchanged; this is a guardrail result, not a model mistake.
- **Safe replay / 10_serve — Volley serve exactly at supplied waist boundary**: Expected no-fault outcome preserved. Expected fault/player/score/side_out=False/None/[6, 4]/False; observed=False/None/[6, 4]/False. Path=fallback; reason=offline. Offline safe replay deliberately leaves score unchanged; this is a guardrail result, not a model mistake.
- **Safe replay / 11_nvz — Volley while standing in kitchen**: Mismatch in verdict/player, score/side_out. Expected fault/player/score/side_out=True/A/[6, 4]/True; observed=False/None/[6, 4]/False. Path=fallback; reason=offline. Offline safe replay deliberately leaves score unchanged; this is a guardrail result, not a model mistake.
- **Safe replay / 12_nvz — Volley while touching kitchen line**: Mismatch in verdict/player, score/side_out. Expected fault/player/score/side_out=True/A/[6, 4]/True; observed=False/None/[6, 4]/False. Path=fallback; reason=offline. Offline safe replay deliberately leaves score unchanged; this is a guardrail result, not a model mistake.
- **Safe replay / 13_nvz — Groundstroke in kitchen is allowed**: Expected no-fault outcome preserved. Expected fault/player/score/side_out=False/None/[6, 4]/False; observed=False/None/[6, 4]/False. Path=fallback; reason=offline. Offline safe replay deliberately leaves score unchanged; this is a guardrail result, not a model mistake.
- **Safe replay / 14_nvz — Volley outside kitchen**: Expected no-fault outcome preserved. Expected fault/player/score/side_out=False/None/[6, 4]/False; observed=False/None/[6, 4]/False. Path=fallback; reason=offline. Offline safe replay deliberately leaves score unchanged; this is a guardrail result, not a model mistake.
- **Safe replay / 15_nvz — Momentum enters kitchen immediately**: Mismatch in verdict/player, score/side_out. Expected fault/player/score/side_out=True/A/[6, 4]/True; observed=False/None/[6, 4]/False. Path=fallback; reason=offline. Offline safe replay deliberately leaves score unchanged; this is a guardrail result, not a model mistake.
- **Safe replay / 16_nvz — Momentum contact after rally-end marker**: Mismatch in verdict/player, score/side_out. Expected fault/player/score/side_out=True/A/[6, 4]/True; observed=False/None/[6, 4]/False. Path=fallback; reason=offline. Offline safe replay deliberately leaves score unchanged; this is a guardrail result, not a model mistake.
- **Safe replay / 17_nvz — Player regains balance before entry**: Expected no-fault outcome preserved. Expected fault/player/score/side_out=False/None/[6, 4]/False; observed=False/None/[6, 4]/False. Path=fallback; reason=offline. Offline safe replay deliberately leaves score unchanged; this is a guardrail result, not a model mistake.
- **Safe replay / 18_nvz — Momentum stops outside kitchen**: Expected no-fault outcome preserved. Expected fault/player/score/side_out=False/None/[6, 4]/False; observed=False/None/[6, 4]/False. Path=fallback; reason=offline. Offline safe replay deliberately leaves score unchanged; this is a guardrail result, not a model mistake.
- **Safe replay / 19_nvz — Other side's volley momentum fault**: Mismatch in verdict/player, score/side_out. Expected fault/player/score/side_out=True/B/[7, 4]/False; observed=False/None/[6, 4]/False. Path=fallback; reason=offline. Offline safe replay deliberately leaves score unchanged; this is a guardrail result, not a model mistake.
- **Safe replay / 20_nvz — Unlinked momentum requires no automatic penalty**: Expected no-fault outcome preserved. Expected fault/player/score/side_out=False/None/[6, 4]/False; observed=False/None/[6, 4]/False. Path=fallback; reason=offline. Offline safe replay deliberately leaves score unchanged; this is a guardrail result, not a model mistake.
- **Safe replay / 21_nvz — Receiver kitchen volley after initial bounces**: Mismatch in verdict/player, score/side_out. Expected fault/player/score/side_out=True/B/[7, 4]/False; observed=False/None/[6, 4]/False. Path=fallback; reason=offline. Offline safe replay deliberately leaves score unchanged; this is a guardrail result, not a model mistake.
- **Safe replay / 22_nvz — Walk through kitchen without a volley**: Expected no-fault outcome preserved. Expected fault/player/score/side_out=False/None/[6, 4]/False; observed=False/None/[6, 4]/False. Path=fallback; reason=offline. Offline safe replay deliberately leaves score unchanged; this is a guardrail result, not a model mistake.
- **Safe replay / 23_two_bounce — Receiver volleys the serve**: Mismatch in verdict/player, score/side_out. Expected fault/player/score/side_out=True/B/[7, 4]/False; observed=False/None/[6, 4]/False. Path=fallback; reason=offline. Offline safe replay deliberately leaves score unchanged; this is a guardrail result, not a model mistake.
- **Safe replay / 24_two_bounce — Server volleys the return**: Mismatch in verdict/player, score/side_out. Expected fault/player/score/side_out=True/A/[6, 4]/True; observed=False/None/[6, 4]/False. Path=fallback; reason=offline. Offline safe replay deliberately leaves score unchanged; this is a guardrail result, not a model mistake.
- **Safe replay / 25_two_bounce — Both initial bounces then server volley**: Expected no-fault outcome preserved. Expected fault/player/score/side_out=False/None/[6, 4]/False; observed=False/None/[6, 4]/False. Path=fallback; reason=offline. Offline safe replay deliberately leaves score unchanged; this is a guardrail result, not a model mistake.
- **Safe replay / 26_two_bounce — Both initial bounces then receiver volley**: Expected no-fault outcome preserved. Expected fault/player/score/side_out=False/None/[6, 4]/False; observed=False/None/[6, 4]/False. Path=fallback; reason=offline. Offline safe replay deliberately leaves score unchanged; this is a guardrail result, not a model mistake.
- **Safe replay / 27_two_bounce — Groundstroke return before server bounce**: Expected no-fault outcome preserved. Expected fault/player/score/side_out=False/None/[6, 4]/False; observed=False/None/[6, 4]/False. Path=fallback; reason=offline. Offline safe replay deliberately leaves score unchanged; this is a guardrail result, not a model mistake.
- **Safe replay / 28_two_bounce — Two receiving-side bounces cannot replace server bounce**: Mismatch in verdict/player, score/side_out. Expected fault/player/score/side_out=True/A/[6, 4]/True; observed=False/None/[6, 4]/False. Path=fallback; reason=offline. Offline safe replay deliberately leaves score unchanged; this is a guardrail result, not a model mistake.
- **Safe replay / 29_two_bounce — Groundstroke rally after both bounces**: Expected no-fault outcome preserved. Expected fault/player/score/side_out=False/None/[6, 4]/False; observed=False/None/[6, 4]/False. Path=fallback; reason=offline. Offline safe replay deliberately leaves score unchanged; this is a guardrail result, not a model mistake.
- **Safe replay / 30_two_bounce — New rally starts with fresh bounce counters**: Mismatch in verdict/player, score/side_out. Expected fault/player/score/side_out=True/B/[7, 4]/False; observed=False/None/[6, 4]/False. Path=fallback; reason=offline. Offline safe replay deliberately leaves score unchanged; this is a guardrail result, not a model mistake.
- **Safe replay / 31_two_bounce — Serving team B must also wait for its return bounce**: Mismatch in verdict/player, score/side_out. Expected fault/player/score/side_out=True/B/[6, 4]/True; observed=False/None/[6, 4]/False. Path=fallback; reason=offline. Offline safe replay deliberately leaves score unchanged; this is a guardrail result, not a model mistake.
- **Safe replay / 32_two_bounce — Serving team B after both bounces**: Expected no-fault outcome preserved. Expected fault/player/score/side_out=False/None/[6, 4]/False; observed=False/None/[6, 4]/False. Path=fallback; reason=offline. Offline safe replay deliberately leaves score unchanged; this is a guardrail result, not a model mistake.
- **Safe replay / 33_scoring — Singles serving A wins a point**: Mismatch in verdict/player, score/side_out. Expected fault/player/score/side_out=True/B/[7, 4]/False; observed=False/None/[6, 4]/False. Path=fallback; reason=offline. Offline safe replay deliberately leaves score unchanged; this is a guardrail result, not a model mistake.
- **Safe replay / 34_scoring — Singles serving A loses service**: Mismatch in verdict/player, score/side_out. Expected fault/player/score/side_out=True/A/[6, 4]/True; observed=False/None/[6, 4]/False. Path=fallback; reason=offline. Offline safe replay deliberately leaves score unchanged; this is a guardrail result, not a model mistake.
- **Safe replay / 35_scoring — Singles serving B wins a point**: Mismatch in verdict/player, score/side_out. Expected fault/player/score/side_out=True/A/[6, 5]/False; observed=False/None/[6, 4]/False. Path=fallback; reason=offline. Offline safe replay deliberately leaves score unchanged; this is a guardrail result, not a model mistake.
- **Safe replay / 36_scoring — Singles serving B loses service**: Mismatch in verdict/player, score/side_out. Expected fault/player/score/side_out=True/B/[6, 4]/True; observed=False/None/[6, 4]/False. Path=fallback; reason=offline. Offline safe replay deliberately leaves score unchanged; this is a guardrail result, not a model mistake.
- **Safe replay / 37_scoring — Doubles server one loses; server two serves**: Mismatch in verdict/player. Expected fault/player/score/side_out=True/A/[6, 4]/False; observed=False/None/[6, 4]/False. Path=fallback; reason=offline. Offline safe replay deliberately leaves score unchanged; this is a guardrail result, not a model mistake.
- **Safe replay / 38_scoring — Doubles server two loses; side out**: Mismatch in verdict/player, score/side_out. Expected fault/player/score/side_out=True/A/[6, 4]/True; observed=False/None/[6, 4]/False. Path=fallback; reason=offline. Offline safe replay deliberately leaves score unchanged; this is a guardrail result, not a model mistake.
- **Safe replay / 39_scoring — Doubles first server wins; same server**: Mismatch in verdict/player, score/side_out. Expected fault/player/score/side_out=True/B/[7, 4]/False; observed=False/None/[6, 4]/False. Path=fallback; reason=offline. Offline safe replay deliberately leaves score unchanged; this is a guardrail result, not a model mistake.
- **Safe replay / 40_scoring — Doubles second server wins; same server**: Mismatch in verdict/player, score/side_out. Expected fault/player/score/side_out=True/B/[7, 4]/False; observed=False/None/[6, 4]/False. Path=fallback; reason=offline. Offline safe replay deliberately leaves score unchanged; this is a guardrail result, not a model mistake.
- **Safe replay / 41_scoring — Doubles initial server encoded as server two**: Mismatch in verdict/player, score/side_out. Expected fault/player/score/side_out=True/A/[0, 0]/True; observed=False/None/[0, 0]/False. Path=fallback; reason=offline. Offline safe replay deliberately leaves score unchanged; this is a guardrail result, not a model mistake.
- **Safe replay / 42_scoring — No rally fault means no score mutation**: Expected no-fault outcome preserved. Expected fault/player/score/side_out=False/None/[6, 4]/False; observed=False/None/[6, 4]/False. Path=fallback; reason=offline. Offline safe replay deliberately leaves score unchanged; this is a guardrail result, not a model mistake.
- **Safe replay / 43_multi — Illegal serve occurs before receiver early volley**: Mismatch in verdict/player, score/side_out. Expected fault/player/score/side_out=True/A/[6, 4]/True; observed=False/None/[6, 4]/False. Path=fallback; reason=offline. Offline safe replay deliberately leaves score unchanged; this is a guardrail result, not a model mistake.
- **Safe replay / 44_multi — Early volley also touches kitchen**: Mismatch in verdict/player, score/side_out. Expected fault/player/score/side_out=True/B/[7, 4]/False; observed=False/None/[6, 4]/False. Path=fallback; reason=offline. Offline safe replay deliberately leaves score unchanged; this is a guardrail result, not a model mistake.
- **Safe replay / 45_multi — Kitchen volley occurs before later terminal out**: Mismatch in verdict/player, score/side_out. Expected fault/player/score/side_out=True/A/[6, 4]/True; observed=False/None/[6, 4]/False. Path=fallback; reason=offline. Offline safe replay deliberately leaves score unchanged; this is a guardrail result, not a model mistake.
- **Safe replay / 46_multi — Linked momentum occurs before opponent fault**: Mismatch in verdict/player, score/side_out. Expected fault/player/score/side_out=True/A/[6, 4]/True; observed=False/None/[6, 4]/False. Path=fallback; reason=offline. Offline safe replay deliberately leaves score unchanged; this is a guardrail result, not a model mistake.
- **Safe replay / 47_multi — Legal kitchen groundstroke followed by opponent out**: Mismatch in verdict/player, score/side_out. Expected fault/player/score/side_out=True/B/[7, 4]/False; observed=False/None/[6, 4]/False. Path=fallback; reason=offline. Offline safe replay deliberately leaves score unchanged; this is a guardrail result, not a model mistake.
- **Safe replay / 48_multi — Two simultaneous serve predicates need citation review**: Mismatch in verdict/player, score/side_out. Expected fault/player/score/side_out=True/A/[6, 4]/True; observed=False/None/[6, 4]/False. Path=fallback; reason=offline. Offline safe replay deliberately leaves score unchanged; this is a guardrail result, not a model mistake.
- **Safe replay / 49_multi — Regained balance clears momentum; subsequent fault remains**: Mismatch in verdict/player, score/side_out. Expected fault/player/score/side_out=True/B/[7, 4]/False; observed=False/None/[6, 4]/False. Path=fallback; reason=offline. Offline safe replay deliberately leaves score unchanged; this is a guardrail result, not a model mistake.
- **Safe replay / 50_multi — Server two commits initial bounce fault**: Mismatch in verdict/player, score/side_out. Expected fault/player/score/side_out=True/A/[6, 4]/True; observed=False/None/[6, 4]/False. Path=fallback; reason=offline. Offline safe replay deliberately leaves score unchanged; this is a guardrail result, not a model mistake.

## Every observed classifier mismatch

- **Heuristic / 03_serve**: prompted synthetic label=drop, prediction=dink. Low acceleration and low wrist height overlap for drop and dink; the baseline has no reliable trajectory/distance observation to separate them. Path reason: threshold baseline.
- **Heuristic / 10_serve**: prompted synthetic label=drop, prediction=dink. Low acceleration and low wrist height overlap for drop and dink; the baseline has no reliable trajectory/distance observation to separate them. Path reason: threshold baseline.
- **Heuristic / 17_nvz**: prompted synthetic label=drop, prediction=dink. Low acceleration and low wrist height overlap for drop and dink; the baseline has no reliable trajectory/distance observation to separate them. Path reason: threshold baseline.
- **Heuristic / 24_two_bounce**: prompted synthetic label=drop, prediction=dink. Low acceleration and low wrist height overlap for drop and dink; the baseline has no reliable trajectory/distance observation to separate them. Path reason: threshold baseline.
- **Heuristic / 31_two_bounce**: prompted synthetic label=drop, prediction=dink. Low acceleration and low wrist height overlap for drop and dink; the baseline has no reliable trajectory/distance observation to separate them. Path reason: threshold baseline.
- **Heuristic / 38_scoring**: prompted synthetic label=drop, prediction=dink. Low acceleration and low wrist height overlap for drop and dink; the baseline has no reliable trajectory/distance observation to separate them. Path reason: threshold baseline.
- **Heuristic / 45_multi**: prompted synthetic label=drop, prediction=dink. Low acceleration and low wrist height overlap for drop and dink; the baseline has no reliable trajectory/distance observation to separate them. Path reason: threshold baseline.
- **Nano offline fallback / 03_serve**: prompted synthetic label=drop, prediction=dink. Low acceleration and low wrist height overlap for drop and dink; the baseline has no reliable trajectory/distance observation to separate them. Path reason: offline.
- **Nano offline fallback / 10_serve**: prompted synthetic label=drop, prediction=dink. Low acceleration and low wrist height overlap for drop and dink; the baseline has no reliable trajectory/distance observation to separate them. Path reason: offline.
- **Nano offline fallback / 17_nvz**: prompted synthetic label=drop, prediction=dink. Low acceleration and low wrist height overlap for drop and dink; the baseline has no reliable trajectory/distance observation to separate them. Path reason: offline.
- **Nano offline fallback / 24_two_bounce**: prompted synthetic label=drop, prediction=dink. Low acceleration and low wrist height overlap for drop and dink; the baseline has no reliable trajectory/distance observation to separate them. Path reason: offline.
- **Nano offline fallback / 31_two_bounce**: prompted synthetic label=drop, prediction=dink. Low acceleration and low wrist height overlap for drop and dink; the baseline has no reliable trajectory/distance observation to separate them. Path reason: offline.
- **Nano offline fallback / 38_scoring**: prompted synthetic label=drop, prediction=dink. Low acceleration and low wrist height overlap for drop and dink; the baseline has no reliable trajectory/distance observation to separate them. Path reason: offline.
- **Nano offline fallback / 45_multi**: prompted synthetic label=drop, prediction=dink. Low acceleration and low wrist height overlap for drop and dink; the baseline has no reliable trajectory/distance observation to separate them. Path reason: offline.

## Interpretation and remaining evidence

- State-machine assertions and implementation were authored together. Agreement is a regression check, not independent evaluation. All rulebook citations, simultaneous-fault precedence, waist boundary assumptions, and drop-serve conditions need two human reviews.
- The simplified two-bounce baseline tracks the first bounce on each side; it does not resolve every terminal event or official edge case. A marker after a volley is not sufficient evidence of who won the rally.
- In doubles fixtures, A/B denote teams, with server_number 1 or 2 supplied explicitly. The two-player game uses singles. No server rotation is silently added to the fixed section-3 message schema.
- Offline fallback preserves scores by design. Live model metrics need NVIDIA_API_KEY and completed rules.json; model rows remain unmeasured until actual calls are made.
- Capture 100 prompted, consented human swings; use --swings to evaluate their labels. No human capture was simulated or claimed.
- The deadline includes classifier request, parsing, and validation; late responses are discarded and logged. Latency scheduling has normal operating-system jitter.
- Raw responses and per-call path records: `/Users/jzheng/Desktop/Pickleball-On-The-Go/nemotron/logs/20260919T172336_599224Z`. API credentials and request authorization headers are never logged.
