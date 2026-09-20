"""Evaluate coaching decisions. --live makes real NVIDIA calls; never implies them."""
import argparse
import json
import os
from pathlib import Path
from collections import Counter
try:
    from .coach import select_cue
except ImportError:
    from coach import select_cue


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--live', action='store_true')
    parser.add_argument('--output', type=Path)
    args = parser.parse_args()
    if args.live and not os.environ.get('NVIDIA_API_KEY'):
        parser.error('--live requires NVIDIA_API_KEY; no live evidence was collected')
    fixtures = json.loads(Path(__file__).with_name('coach-fixtures.json').read_text())
    rows = []
    for fixture in fixtures:
        result = select_cue(fixture['events'], fixture['ruling'], live=args.live)
        rows.append({'name': fixture['name'], 'expected': fixture['expected'], **result, 'correct': result['cue'] == fixture['expected']})
    report = {'mode': 'live_requested' if args.live else 'offline', 'synthetic_cases': len(rows), 'human_reviewed': 0,
              'correct': sum(row['correct'] for row in rows), 'paths': dict(Counter(row['path'] for row in rows)),
              'mean_latency_ms': round(sum(row['latency_ms'] for row in rows) / len(rows), 1), 'cases': rows}
    text = json.dumps(report, indent=2)
    if args.output: args.output.write_text(text + '\n')
    print(text)

if __name__ == '__main__': main()
