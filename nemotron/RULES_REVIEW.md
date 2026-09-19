# Human rulebook and ground-truth handoff

No official rule text or rule number is included in this package. Names such as
`nvz_momentum` are internal branch labels, **not citations**. The example citation
in the design document was explicitly written from memory and is not trusted here.
The 50 scenarios are authored synthetic cases, not verified rulebook examples.

Use the [official USA Pickleball rulebook page](https://usapickleball.org/what-is-pickleball/official-rules/)
to select the exact edition used at the event. Paste the passages yourself; do not
ask a model to reconstruct remembered wording. In `rules.json`, fill `edition`
and `source_url`, then replace each clearly marked placeholder with:

1. **Two-bounce rule**: the complete requirement for the serve bounce and the
   return bounce, plus the definitions and exceptions it references.
2. **Non-volley zone**: complete provisions for volleying while contacting the
   zone or its lines; body, equipment and clothing contact; momentum after a
   volley; regaining balance/control; and whether a dead ball ends that liability.
3. **Serve legality**: complete volley-serve motion, contact-height and paddle
   relationship requirements; drop-serve release/bounce requirements and relevant
   exceptions; feet/contact positions; service-court boundaries, lines and target.
4. **Scoring and service sequence**: side-out scoring, singles service changes,
   doubles server one/two transitions, the opening service exception, and fault
   provisions needed for the out/net rally-ending examples. Include definitions
   and linked exceptions that change any of these decisions.

For each section, `rule_ids` must list the exact printed identifiers present in
the pasted text. These are the model's entire citation allowlist. Add two distinct
human reviewer names to `reviewed_by` only after they verify text and identifiers.
The adapter refuses placeholder passages and empty/unreviewed rule configuration.

For each JSON fixture, have two people independently inspect the events and state,
decide the outcome, then reconcile any disagreement. Replace `expected_ruling.rule`
with one exact allowed rule ID for a fault (or `none` for no fault), correct the
provisional fault/player/score/side_out and next-server expectations, and fill:

```json
"review": {
  "status": "reviewed",
  "reviewers": ["actual first reviewer", "actual second reviewer"],
  "rulebook_edition": "actual edition",
  "source_page": "actual page / example",
  "notes": "How disagreements were resolved; any relevant exception"
}
```

Do not set these fields before review. Reviewed metrics require two distinct
reviewers. For baseline citation comparison, populate `branch_rule_ids` with each
internal branch key and the verified official ID that applies:
`serve_foot`, `serve_height`, `serve_motion`, `serve_paddle`, `serve_target`,
`serve_kitchen`, `two_bounce`, `nvz_volley`, `nvz_momentum`, `rally_outcome`.
Different underlying faults may need more specific branches once reviewers inspect
them; do not force multiple official rules into a fictitious shared identifier.

Pay particular attention to fixture 28 (the simplified initial-bounce diagnostic
can miss an earlier terminal double bounce), simultaneous conditions in 44/48/50,
drop-serve fixture 08 (incomplete release evidence), waist-boundary fixture 10,
and momentum after a dead-ball marker in 16. These are explicit review issues,
not assertions that the simplified baseline implements all official rules.

The fixed ruling schema has no `replay` or next-server-number field. A fallback
uses `fault: false`, `player: null`, `rule: "none"`, the unchanged score and
`side_out: false`, with a replay explanation. The caller must honor that replay.
Additional path/reason metadata goes in logs or `*_with_metadata()`, never into
the section-3 wire message. Doubles fixtures use A/B as teams; the physical
two-player game remains singles.
