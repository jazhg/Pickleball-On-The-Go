"""Small, explicit denominators; missing ground truth never becomes a success."""
import math


def ratio(correct, total):
    return f"{correct}/{total} ({100 * correct / total:.1f}%)" if total else "N/A (0 eligible)"


def percentile(values, q):
    if not values:
        return None
    ordered = sorted(values)
    index = (len(ordered) - 1) * q
    low, high = math.floor(index), math.ceil(index)
    return ordered[low] + (ordered[high] - ordered[low]) * (index - low)


def reviewed(fixture):
    review = fixture.get("review", {})
    people = review.get("reviewers", [])
    return (review.get("status") == "reviewed" and len(set(people)) >= 2
            and all(isinstance(p, str) and p.strip() for p in people))


def referee_metrics(records):
    counts = {key: [0, 0] for key in ("verdict", "citation", "score", "reviewed_verdict", "reviewed_score")}
    failures = []
    for fixture, result in records:
        expected, actual = fixture["expected_ruling"], result["ruling"]
        verdict = (actual["fault"], actual["player"]) == (expected["fault"], expected["player"])
        score = (actual["score"], actual["side_out"]) == (expected["score"], expected["side_out"])
        for key, success in (("verdict", verdict), ("score", score)):
            counts[key][0] += success
            counts[key][1] += 1
            if reviewed(fixture):
                counts["reviewed_" + key][0] += success
                counts["reviewed_" + key][1] += 1
        citation = expected.get("rule")
        citation_eligible = reviewed(fixture) and isinstance(citation, str) and not citation.startswith("TODO")
        citation_ok = actual["rule"] == citation
        if citation_eligible:
            counts["citation"][0] += citation_ok
            counts["citation"][1] += 1
        mismatch = []
        if not verdict:
            mismatch.append("verdict/player")
        if not score:
            mismatch.append("score/side_out")
        if citation_eligible and not citation_ok:
            mismatch.append("rule citation")
        if mismatch or result.get("path") == "fallback":
            failures.append((fixture, result, mismatch))
    return {k: ratio(*v) for k, v in counts.items()}, failures
