"""Train/resume all-street sampled poker subgames, without a GTO strength claim."""
import argparse
import json
from pathlib import Path

from .cards import validate
from .engine import Config, Game
from .sampled_solver import HoldemSolver, public_state


def scenario(street='preflop', players=6, seed=1, stacks=None):
    if street not in ('preflop', 'flop', 'turn', 'river') or players not in range(2, 7):
        raise ValueError('Choose a valid street and 2--6 live players.')
    game = Game(Config(seed=seed, stacks=stacks or [1000]*6))
    while len(game.live()) > players:
        game.act('fold')
    while game.street != street:
        if game.done:
            raise ValueError('Stacks too small for requested scenario.')
        game.act('check' if game.legal()['check'] else 'call')
    return game


def from_public(root):
    """Validate a checkpoint root by replaying only its public betting history."""
    game = Game(Config(**root['config'], seed=0))
    for event in root['history']:
        if game.done or event['seat'] != game.actor or event['street'] != game.street:
            raise ValueError('Invalid public history in checkpoint.')
        game.act(event['action'], event['amount'])
    validate(root['board'])
    if len(root['board']) != len(game.board):
        raise ValueError('Public board length does not match street.')
    game.board = list(root['board'])
    if public_state(game) != root:
        raise ValueError('Public state is inconsistent with its betting history.')
    # No actual private hand is supplied in a checkpoint.
    game.holes = [[] for _ in game.stacks]
    return game


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--street', choices=['preflop','flop','turn','river'], default='preflop')
    parser.add_argument('--players', type=int, choices=range(2,7), default=6)
    parser.add_argument('--seed', type=int, default=1)
    parser.add_argument('--iterations', type=int, default=1000)
    parser.add_argument('--seconds', type=float, default=30.)
    parser.add_argument('--max-infosets', type=int, default=40000)
    parser.add_argument('--resume', type=Path)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args(argv)
    try:
        if args.resume:
            if args.resume.stat().st_size > 100_000_000:
                raise ValueError('Checkpoint exceeds 100 MB limit.')
            data = json.loads(args.resume.read_text(encoding='utf-8'))
            game = from_public(data['root'])
            options = {k: data['options'][k] for k in ('seed','bet_sizes','max_raises','max_infosets')}
            solver = HoldemSolver(game, **options)
            solver.resume(args.resume)
        else:
            game = scenario(args.street, args.players, args.seed)
            solver = HoldemSolver(game, seed=args.seed, max_infosets=args.max_infosets)
        metrics = solver.train(args.iterations, args.seconds)
        solver.save(args.output)
        report = {'output': str(args.output.resolve()), 'metrics': metrics}
        if not args.resume:
            row, visits = solver.advise(game)
            report.update(example_hand_updates=visits, example_policy=row)
        print(json.dumps(report, indent=2))
    except (ValueError, TypeError, KeyError, OSError, ArithmeticError) as error:
        parser.exit(2, f'Error: {error}\n')


if __name__ == '__main__':
    main()
