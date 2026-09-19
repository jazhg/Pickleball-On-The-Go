"""Disk-first evaluation; offline is the default and never pretends models ran."""
import argparse
from collections import Counter
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import time

if __package__:
    from .baseline import adjudicate
    from .metrics import percentile, ratio, referee_metrics, reviewed
else:
    from baseline import adjudicate
    from metrics import percentile, ratio, referee_metrics, reviewed

ROOT = Path(__file__).resolve().parent
SHOTS = ("dink", "drive", "drop", "lob", "smash", "serve", "mishit")


def table(headers, rows):
    return ["| " + " | ".join(headers) + " |", "| " + " | ".join("---" for _ in headers) + " |"] + ["| " + " | ".join(map(str, row)) + " |" for row in rows]


def evaluate(args):
    fixtures = [json.loads(p.read_text()) for p in sorted(args.fixtures.glob("*.json"))]
    if not fixtures:
        raise ValueError("No JSON fixtures found")
    if args.limit:
        fixtures = fixtures[:args.limit]
    categories = Counter(f["category"] for f in fixtures)
    records = [(f, {**adjudicate(f["events"], f["game_state"]), "path": "baseline"}) for f in fixtures]
    metrics, failures = referee_metrics(records)
    rows = [["State machine", "n/a", len(records), metrics["verdict"], metrics["citation"], metrics["score"], "0"]]
    reviewed_rows = [["State machine", metrics["reviewed_verdict"], metrics["reviewed_score"]]]
    all_failures = [("State machine", *failure) for failure in failures]
    raw_dir = args.output.parent / "logs" / datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S_%fZ")
    if __package__:
        from .classifier import classify_with_metadata, heuristic_classify
        from .referee import referee_with_metadata, load_rules
    else:
        from classifier import classify_with_metadata, heuristic_classify
        from referee import referee_with_metadata, load_rules
    if args.live:
        if not os.environ.get("NVIDIA_API_KEY"):
            raise ValueError("Live evaluation needs NVIDIA_API_KEY in the environment; run without --live for offline results.")
        try:
            _passages, _ids, supplied_rules = load_rules(args.rules)
        except (ValueError, TypeError, KeyError, OSError) as exc:
            raise ValueError("Live referee evaluation needs completed rules.json with verbatim passages, exact IDs and two reviewers; see RULES_REVIEW.md.") from None
        for _, result in records:
            if result["rule_key"] != "none":
                citation = supplied_rules.get("branch_rule_ids", {}).get(result["rule_key"])
                if citation in _ids:
                    result["ruling"]["rule"] = citation
        metrics, failures = referee_metrics(records)
        rows[0] = ["State machine", "n/a", len(records), metrics["verdict"], metrics["citation"], metrics["score"], "0"]
        all_failures = [("State machine", *failure) for failure in failures]
    for label, model in (("Nemotron 3.5 Lightning", "lightning"),):
        for reasoning in (False, True):
            if args.live and referee_with_metadata:
                model_records = [(f, referee_with_metadata(f["events"], f["game_state"], model=model,
                                 reasoning=reasoning, rules_path=args.rules, log_dir=raw_dir,
                                 request_id=f["id"])) for f in fixtures]
                m, fs = referee_metrics(model_records)
                fallback = sum(r["path"] == "fallback" for _, r in model_records)
                rows.append([label, "on" if reasoning else "off", len(model_records), m["verdict"], m["citation"], m["score"], ratio(fallback, len(model_records))])
                reviewed_rows.append([label + (" on" if reasoning else " off"), m["reviewed_verdict"], m["reviewed_score"]])
                all_failures.extend((label + (" on" if reasoning else " off"), *failure) for failure in fs)
            else:
                rows.append([label, "on" if reasoning else "off", "NOT RUN", "N/A", "N/A", "N/A", "N/A"])
    # Exercise real referee safe-replay handling offline, without calling an endpoint.
    if referee_with_metadata and not args.live:
        fallback_records = [(f, referee_with_metadata(f["events"], f["game_state"], offline=True,
                            log_dir=raw_dir, request_id=f["id"])) for f in fixtures]
        m, fs = referee_metrics(fallback_records)
        rows.append(["Safe-replay offline path", "n/a", len(fixtures), m["verdict"], m["citation"], m["score"], ratio(len(fixtures), len(fixtures))])
        all_failures.extend(("Safe replay", *failure) for failure in fs)
    lines = ["# Nemotron evaluation results", "", "Generated: " + datetime.now(timezone.utc).isoformat(), "",
        f"Mode: {'LIVE API' if args.live else 'OFFLINE — no model requests'}. Fixtures evaluated: {len(fixtures)}. Independently reviewed: {sum(reviewed(f) for f in fixtures)}.", "",
        "All bundled rally scenarios and swing examples are authored synthetic smoke cases. Verdict and score columns below measure agreement with provisional assertions, not validated pickleball accuracy. Citation accuracy only counts citations from fixtures reviewed by two different people. No rule numbers or official rule text have been supplied.", "",
        "## Referee — provisional scenario agreement", ""]
    lines += table(["Method", "Reasoning", "Evaluated", "Verdict + player", "Reviewed citation", "Score + side out", "Fallback rate"], rows)
    lines += ["", "## Referee — reviewed ground truth only", ""] + table(["Method", "Verdict", "Score + side out"], reviewed_rows)
    lines += ["", "Coverage: " + ", ".join(f"{k}={v}" for k, v in sorted(categories.items())) + ".",
              f"Dedicated NVZ momentum cases: {sum(f['category'] == 'nvz' and f['momentum_case'] for f in fixtures)}."]
    rotation = [(f, r) for f, r in records if f.get("expected_next_server")]
    correct = sum([r["next_state"]["serving_team"], r["next_state"]["server_number"]] == f["expected_next_server"] for f, r in rotation)
    lines += ["", f"State-machine next-server diagnostic: {ratio(correct, len(rotation))}. The fixed ruling wire schema only carries score and side_out, so model server-number accuracy cannot be inferred or claimed."]
    examples = [f["classifier_example"] | {"id": f["id"]} for f in fixtures]
    if args.swings:
        examples = json.loads(args.swings.read_text())
        if not isinstance(examples, list) or any(e.get("provenance") != "human_captured" for e in examples):
            raise ValueError("--swings requires a JSON list with provenance=human_captured on every record")
    lines += ["", "## Classifier", "", f"Dataset: {'human-captured labels' if args.swings else 'synthetic smoke examples, NOT human captures'}; n={len(examples)}. Required 100 prompted human swings: {'provided ' + str(len(examples)) if args.swings else '0/100 supplied'}. Latencies below are measured wall time for the named path; offline latencies are not model/network latencies.", ""]
    classifier_rows, classifier_failures, matrices = [], [], []
    if heuristic_classify:
        for method in ("Heuristic", "Lightning live" if args.live else "Nano offline fallback"):
            outcomes, latencies, fallback = [], [], 0
            for example in examples:
                if example["expected_shot"] not in SHOTS:
                    raise ValueError("Unknown classifier expected_shot")
                start = time.perf_counter()
                if method == "Heuristic":
                    value = heuristic_classify(example["swing"], example.get("pose", {}))
                    path, reason = "heuristic", "threshold baseline"
                else:
                    result = classify_with_metadata(example["swing"], example.get("pose", {}), offline=not args.live, log_dir=raw_dir, request_id=example["id"], model="lightning")
                    value, path, reason = result["classification"], result["path"], result.get("reason", "")
                    fallback += path == "fallback"
                latencies.append((time.perf_counter() - start) * 1000)
                outcomes.append((example["expected_shot"], value["shot"]))
                if example["expected_shot"] != value["shot"]:
                    classifier_failures.append((method, example["id"], example["expected_shot"], value["shot"], reason))
            accuracy = sum(a == b for a, b in outcomes)
            classifier_rows.append([method, len(outcomes), ratio(accuracy, len(outcomes)), f"{percentile(latencies, .5):.3f}", f"{percentile(latencies, .95):.3f}", ratio(fallback, len(outcomes)) if method != "Heuristic" else "n/a"])
            matrix = Counter(outcomes)
            matrices.append((method, matrix))
    lines += table(["Method", "n", "Accuracy", "p50 ms", "p95 ms", "Fallback"], classifier_rows)
    for method, matrix in matrices:
        lines += ["", f"### {method}: confusion matrix (rows=prompted label; columns=prediction)", ""]
        lines += table(["Label", *SHOTS, "Recall"], [[shot, *[matrix[(shot, predicted)] for predicted in SHOTS], ratio(matrix[(shot, shot)], sum(matrix[(shot, p)] for p in SHOTS))] for shot in SHOTS])
    lines += ["", "## Every observed referee failure / fallback", ""]
    if not all_failures:
        lines.append("No mismatches against provisional assertions. This does not establish official rules accuracy.")
    for method, fixture, result, mismatch in all_failures:
        expected, actual = fixture["expected_ruling"], result["ruling"]
        lines.append(f"- **{method} / {fixture['id']} — {fixture['name']}**: {'Mismatch in ' + ', '.join(mismatch) if mismatch else 'Expected no-fault outcome preserved'}. Expected fault/player/score/side_out={expected['fault']}/{expected['player']}/{expected['score']}/{expected['side_out']}; observed={actual['fault']}/{actual['player']}/{actual['score']}/{actual['side_out']}. Path={result['path']}; reason={result.get('reason', 'state-machine branch divergence')}. " + ("Offline safe replay deliberately leaves score unchanged; this is a guardrail result, not a model mistake." if result.get("reason") == "offline" else "Review the logged raw response and human ground truth before attributing the cause."))
    lines += ["", "## Every observed classifier mismatch", ""]
    for method, identifier, expected, actual, reason in classifier_failures:
        lines.append(f"- **{method} / {identifier}**: prompted synthetic label={expected}, prediction={actual}. " + ("Low acceleration and low wrist height overlap for drop and dink; the baseline has no reliable trajectory/distance observation to separate them." if {expected, actual} == {"drop", "dink"} else "The threshold prior disagrees with the provided label; inspect features and capture provenance.") + f" Path reason: {reason}.")
    if not classifier_failures:
        lines.append("No mismatches on supplied examples; dataset provenance and size still limit this result.")
    lines += ["", "## Interpretation and remaining evidence", "",
        "- State-machine assertions and implementation were authored together. Agreement is a regression check, not independent evaluation. All rulebook citations, simultaneous-fault precedence, waist boundary assumptions, and drop-serve conditions need two human reviews.",
        "- The simplified two-bounce baseline tracks the first bounce on each side; it does not resolve every terminal event or official edge case. A marker after a volley is not sufficient evidence of who won the rally.",
        "- In doubles fixtures, A/B denote teams, with server_number 1 or 2 supplied explicitly. The two-player game uses singles. No server rotation is silently added to the fixed section-3 message schema.",
        "- Offline fallback preserves scores by design. Live model metrics need NVIDIA_API_KEY and completed rules.json; model rows remain unmeasured until actual calls are made.",
        "- Capture 100 prompted, consented human swings; use --swings to evaluate their labels. No human capture was simulated or claimed.",
        "- The deadline includes classifier request, parsing, and validation; late responses are discarded and logged. Latency scheduling has normal operating-system jitter.",
        f"- Raw responses and per-call path records: `{raw_dir}`. API credentials and request authorization headers are never logged.", ""]
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text("\n".join(lines))
    print("\n".join(lines))
    return args.output


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--live", action="store_true", help="Make real NVIDIA requests (4 referee configurations + Nano classifier)")
    parser.add_argument("--fixtures", type=Path, default=ROOT / "fixtures")
    parser.add_argument("--rules", type=Path, default=ROOT / "rules.json")
    parser.add_argument("--swings", type=Path, help="Optional actual human-captured JSON examples")
    parser.add_argument("--output", type=Path, default=ROOT / "results.md")
    parser.add_argument("--limit", type=int, help="Limit fixtures for an initial live smoke run")
    args = parser.parse_args()
    if args.limit is not None and args.limit <= 0:
        parser.error("--limit must be positive")
    try:
        evaluate(args)
    except (ValueError, OSError) as exc:
        parser.error(str(exc))


if __name__ == "__main__":
    main()
