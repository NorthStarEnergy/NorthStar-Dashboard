"""Generate our own range-versus-range river strategy data offline."""
import argparse
from itertools import combinations
import json
from pathlib import Path

from .cards import DECK


def demo(full_range=False):
    board = ['Qs', 'Jh', '7d', '4c', '2s']
    if full_range:
        hands = {''.join(h): 1. for h in combinations([c for c in DECK if c not in board], 2)}
        ranges = [hands, dict(hands)]
    else:
        ranges = [{'QcQd': 1, 'JcJd': 1, 'AsKs': 1, 'AhKh': 1, 'AcKc': 1, 'AdKd': 1},
                  {'AcQd': 1, 'AhQc': 1, 'KdQh': 1, 'KhQd': 1, 'TcTd': 1, '9c9d': 1}]
    return {'board': board, 'ranges': ranges, 'pot': 100, 'stack': 100,
            'min_bet': 2, 'bet_sizes': [.5, 1.], 'max_raises': 2,
            'range_source': 'Uniform synthetic demonstration ranges; not solved preflop data.'}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument('--input', type=Path)
    group.add_argument('--demo', action='store_true')
    group.add_argument('--full-range-demo', action='store_true')
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--iterations', type=int, default=1000)
    parser.add_argument('--seconds', type=float, default=30.)
    parser.add_argument('--target', type=float, default=.005,
                        help='Maximum measured exploitability as a fraction of the root pot.')
    args = parser.parse_args(argv)
    try:
        from .river_solver import solve_river
        request = json.loads(args.input.read_text(encoding='utf-8')) if args.input else demo(args.full_range_demo)
        source = request.get('range_source')
        if not isinstance(source, str) or not source.strip():
            raise ValueError('Provide a nonempty range_source describing input range provenance.')
        allowed = ('board', 'ranges', 'pot', 'stack', 'min_bet', 'bet_sizes', 'max_raises')
        solution = solve_river(**{k: request[k] for k in allowed if k in request},
                               iterations=args.iterations, time_limit=args.seconds,
                               target_exploitability=args.target)
        solution['range_source'] = source
        solution['source'] = 'NorthStar independent CFR+ river solver; generated locally.'
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps(solution, separators=(',', ':'), allow_nan=False), encoding='utf-8')
        print(json.dumps({'output': str(args.output.resolve()), 'metrics': solution['metrics']}, indent=2))
    except (ValueError, TypeError, KeyError, OSError, ImportError) as error:
        parser.exit(2, f'Error: {error}\n')


if __name__ == '__main__':
    main()
