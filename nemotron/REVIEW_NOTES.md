# AI pre-review of 15 referee fixtures — NON-AUTHORITATIVE

> **This is a NON-AUTHORITATIVE AI pre-review.** It is a starting-point set of
> notes for the **two required human reviewers**, not a verdict, and it does
> **not** substitute for either human review. Every verdict below must be
> re-decided independently by two people against pasted rulebook passages.
>
> The `expected_rule_key` values in fixtures (`serve_foot`, `nvz_momentum`,
> `two_bounce`, …) are **internal branch labels of the provisional state
> machine**, not rulebook citations. Do not treat any of them as official rule
> numbers. Baseline branch output is cited here only so humans can see where
> the provisional machine agreed or diverged — agreement with the machine is
> **not** evidence of correctness.

Method: each fixture below was run through `nemotron/baseline.py::adjudicate`
(verified code read + executed, commit `nemotron-integration` branch, files
untouched) and compared against the fixture's provisional `expected_ruling`.
"Agreement" below means the machine's `fault`/`player`/`score`/`side_out`
matched the provisional expectation — nothing more.

**Agreement count: 15/15 agree, 0/15 disagree.** However, several agreements
are thin: the state machine can match an expectation for the wrong reason
(precedence ordering, missing evidence fields defaulting to fault-favoring
values, or event sequences that already describe an earlier terminal fault).
Those are called out per fixture below.

## Fixtures humans should reconcile first (priority order)

1. **28_two_bounce** — events describe an earlier terminal fault the baseline cannot see.
2. **16_nvz** — does a dead ball end momentum liability? `rally_end` marker is ignored by the baseline.
3. **44_multi** — two simultaneous faults on one event; internal branch precedence is not an official precedence rule.
4. **48_multi** — two simultaneous serve faults; internal ordering picks `serve_foot`, but the single official citation still needs human choice.
5. **46_multi** — momentum fault on A occurs before B's later fault; earliest-fault-wins is a provisional policy, not a verified rule.
6. **35_scoring** — event-authoring inconsistency: the `serve` event names player A while `game_state.serving_team` is "B".
7. **09_serve** — drop serve with illegal foot position; verify the foot rule applies identically and check drop-release evidence completeness.

---

## serve

### 01_serve — "Legal volley serve"
- **Verdict: AGREE** (no fault; machine branch `none`, expected `none`; score stays [6,4]).
- Notes: the fixture only contains the serve plus one `serve_landing` event — the rally never continues, so this tests serve-legality checks and nothing else. `serve_landing` omits `correct_service_court`/`in_kitchen` (defaults legal). If the scenario is meant to prove the serve landed legally, consider making those fields explicit rather than relying on defaults.

### 03_serve — "No upward swing"
- **Verdict: AGREE** (fault A, branch `serve_motion`, side-out; matches).
- Citation uncertainty: the fixture asserts `upward_motion: false` as a given fact. Humans must verify (a) that upward motion is required for a volley serve in the pasted passages, and (b) what evidence the system would actually have for this (the attached classifier pose shows `wrist_h: 0.7` — a single wrist height is weak evidence of swing direction). No disagreement with the provisional expectation, but the fact itself is evidence-light.

### 05_serve — "Foot position illegal" *(flagged tricky)*
- **Verdict: AGREE** (fault A, branch `serve_foot`, side-out; matches).
- Citation uncertainty: `foot_legal: false` is asserted without detail (which foot, which boundary). The exact foot-placement requirements (contact at serve, imaginary extensions of sideline/centerline, drop-serve applicability) need the pasted serve passages. Machine logic is just `not foot_legal` → fault, so agreement here says nothing about which official rule the violation falls under.

### 09_serve — "Drop serve still has illegal foot position" *(flagged tricky)*
- **Verdict: AGREE** (fault A, branch `serve_foot`, side-out; matches — baseline applies the foot check before the method branch, so the drop-serve method doesn't suppress it).
- Uncertainty: verify in the rulebook text that foot-position requirements apply identically to drop serves. Also an evidence gap: this fixture has no release/bounce fields on the drop serve at all (compare fixture 08's known incomplete release evidence); humans should decide whether a drop-serve fixture can be fully ruled without them. Same generic caution as 05 on which official rule ID foot violations map to.

## nvz

### 12_nvz — "Volley while touching kitchen line"
- **Verdict: AGREE** (fault A, branch `nvz_volley`, side-out; matches).
- Uncertainty: the baseline treats `touching_line: true` as NVZ contact. Humans must confirm from the pasted passages that contacting the NVZ lines counts as contacting the zone, and that a line-touch *during* the volley (not momentum) is a fault under the same provision the reviewers will cite. Event-order ambiguity: none — the two required initial bounces are both recorded (`serve_landing` → B, `bounce` → A) before the volley at t2200.

### 16_nvz — "Momentum contact after rally-end marker" *(reconcile early)*
- **Verdict: AGREE mechanically** (fault A, branch `nvz_momentum`, side-out; matches).
- **Do not treat this agreement as a decision.** The baseline has no branch for the `rally_end` event at t2500, so it ignores the dead-ball marker entirely, and the `momentum` event at t2800 carries no `regained_balance` field (defaults to "not regained," which is fault-favoring). The central human question — flagged in RULES_REVIEW.md — is whether momentum liability continues after the ball becomes dead, and whether this specific `rally_end` marker means the ball was dead. If the pasted passages say liability ends with a dead ball, the correct ruling may be no-fault/replay, contradicting the provisional expectation. Reconcile this one explicitly and document the reasoning in `review.notes`.

### 21_nvz — "Receiver kitchen volley after initial bounces"
- **Verdict: AGREE** (fault B, branch `nvz_volley`; score [7,4], no side-out; matches).
- Cleanest of the NVZ set: both initial bounces recorded, B's volley at t2200 is explicitly `in_kitchen: true`. Only the usual caution applies — map `nvz_volley` to the exact pasted rule ID(s) for volleying while contacting the zone.

## two_bounce

### 23_two_bounce — "Receiver volleys the serve"
- **Verdict: AGREE** (fault B, branch `two_bounce`; score [7,4]; matches).
- Straightforward; no ambiguity found. B's volley at t1300 occurs with neither initial bounce recorded.

### 28_two_bounce — "Two receiving-side bounces cannot replace server bounce" *(reconcile FIRST)*
- **Verdict: AGREE mechanically** (fault A, branch `two_bounce`, side-out; matches).
- **The agreement is misleading — read the event sequence, not the branch.** Order of events: B returns at t1600 (non-volley), then `bounce` on **B's own side** at t1900, then A volleys at t2200. B's return never reached A's side: a ball that bounces on the hitter's own side after the return means the rally was already dead before A's volley at t2200 ever happened. The provisional expectation (and the baseline's `two_bounce` fault on A) asks A's volley to be the fault, but there is an earlier terminal fault on B's failed return that the baseline's per-player "initial bounce" diagnostic cannot represent (it only tracks whether *any* bounce happened per side, never double-bounces or failed returns). Humans must decide: (a) is the authoritative fault on B for the earlier terminal event, (b) does the fixture need rewriting so A's impossible volley is removed or re-scenario'd, and (c) which rule ID the earlier fault maps to. This is the single most likely place the provisional expectation is wrong-in-spirit while matching-in-verdict.

### 31_two_bounce — "Serving team B must also wait for its return bounce"
- **Verdict: AGREE** (fault B, branch `two_bounce`, side-out, next server A/1; matches).
- Minor evidence note: the `serve` event (t1000) carries no serve-legality flags at all (defaults to legal), and A's non-volley return at t1600 has no preceding explicit `bounce` event — `bounced["A"]` is set only via the `serve_landing` at t1300. If humans want fixtures to be evidence-complete rather than default-complete, make the legality flags explicit on the serve. No verdict issue.

## scoring

### 35_scoring — "Singles serving B wins a point"
- **Verdict: AGREE** (fault A via terminal `fault` event, branch `rally_outcome`; score [6,5], no side-out, next server [B,1]; matches).
- **Event-authoring inconsistency:** the `serve` event at t1000 names `player: "A"`, but `game_state.serving_team` is `"B"`. The intended server is almost certainly B (B wins the point, stays server). The baseline was unaffected because no serve fault fired (a `serve_target` fault would have attributed to `state["serving_team"]`, i.e. B, not the event player — a separate quirk worth a human glance). Recommend correcting the serve player to B before this fixture is used as ground truth.
- Cause note: the terminal `fault` event cites `cause: "ball_out"`; humans must map this to the exact out/net fault passage and confirm score/side-out math independently (they match the provisional values here).

### 40_scoring — "Doubles second server wins; same server"
- **Verdict: AGREE** (fault B via terminal `fault` event; score [7,4], no side-out, next server [A,2]; matches).
- Doubles bookkeeping verified against `score_transition`: serving team A, server 2, loser B ≠ serving team → point to A, server stays [A,2]. Clean; no ambiguity. Humans still need the pasted doubles passages (server one/two transitions, side-out scoring) to certify the citation.

## multi

### 44_multi — "Early volley also touches kitchen" *(flagged tricky)*
- **Verdict: AGREE mechanically** (fault B, branch `two_bounce`; score [7,4]; matches).
- **Precedence is provisional, not official.** B's volley at t1300 simultaneously violates two conditions: the two-bounce rule (no bounces recorded) and the NVZ rule (`in_kitchen: true`). The baseline's `hit` branch checks `two_bounce` first, so `two_bounce` wins *by code order only*. The fixed ruling schema allows exactly one `rule` citation, so the two human reviewers must decide which official rule ID to cite (or whether the scenario should be split), and record the reasoning. Agreement with the machine here must not be read as the machine having chosen the right citation.

### 46_multi — "Linked momentum occurs before opponent fault" *(reconcile early)*
- **Verdict: AGREE mechanically** (fault A, branch `nvz_momentum`, side-out; matches).
- The baseline breaks at the *earliest detectable* fault: A's momentum contact at t2500 precedes B's terminal `fault` event at t2800, so A's fault wins and B's fault is never evaluated. Two human questions: (a) is "earliest fault wins" the correct official policy when a momentum fault on one player precedes a later rally-ending fault by the opponent — or does the NVZ momentum fault actually take precedence as a matter of rule regardless of order? (b) The `momentum` event again lacks `regained_balance` (defaults to not-regained, fault-favoring) and there is no dead-ball marker before it; confirm the contact is genuinely post-volley momentum rather than an independent later movement. The verdict match is real but the policy underneath it needs human certification.

### 48_multi — "Two simultaneous serve predicates need citation review" *(flagged tricky)*
- **Verdict: AGREE mechanically** (fault A, branch `serve_foot`, side-out; matches).
- Same structural issue as 44: the single `serve` event carries both `foot_legal: false` and `contact_above_waist: true`. The baseline's `if/elif` chain evaluates foot first, so `serve_foot` wins by code order. The verdict (fault A, side-out, score unchanged) would be identical under either citation — what differs is the official `rule` ID in the final fixture. Reviewers must pick one citation from the pasted serve passages and note the other violated predicate, per the fixture's own review note.

---

## Cross-fixture patterns for the human reviewers

- **Defaults are fault-favoring or fault-suppressing, not evidence.** Several fixtures rely on absent fields: missing `regained_balance` reads as "did not regain balance" (16, 46); missing legality flags read as "legal" (31). Recommend a pre-review pass that makes every assertion explicit, so no fixture's verdict hinges on a default.
- **Internal precedence is not official precedence.** 44, 46, and 48 all contain outcomes decided by branch/evaluation *order* in `baseline.py`. The machine agreeing with the provisional expectation in these cases is circular (the fixtures were authored against the same branch logic). These are exactly the cases where independent human re-decision matters most.
- **The fixed schema has no `replay`.** If humans conclude any fixture (e.g. 16, depending on the dead-ball answer) should be a replay rather than a fault, that outcome currently cannot be represented except via the no-fault fallback — worth an explicit conversation with whoever owns the schema, not a silent squeeze into `rule: "none"`.
- **28 is the highest-risk fixture.** It's the only reviewed case where the event log plausibly describes a *different, earlier* fault than the one both the provisional expectation and the baseline name.
