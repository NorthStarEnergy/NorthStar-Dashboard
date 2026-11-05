import argparse
import json
import random
from pathlib import Path
from .engine import Config, Game, replay
from .strategy import Strategy, RANGES, actions, key, choose, apply_label, equity
from .cfr import train

def write(path, data):
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    Path(path).write_text(json.dumps(data, indent=2), encoding='utf-8')

def main():
    parser = argparse.ArgumentParser(description='Offline 6-max study trainer. Bundled strategies are NOT GTO solutions.')
    sub = parser.add_subparsers(dest='command', required=True)
    for name in ['play', 'simulate']:
        p = sub.add_parser(name)
        p.add_argument('--config')
        p.add_argument('--strategy')
        p.add_argument('--seed', type=int, default=1)
        p.add_argument('--output', default='session.json' if name == 'play' else 'simulation.json')
        if name == 'play': p.add_argument('--hero', type=int, choices=range(6), default=3)
        else: p.add_argument('--hands', type=int, default=100)
    p = sub.add_parser('replay'); p.add_argument('path'); p.add_argument('--step', action='store_true')
    p = sub.add_parser('train'); p.add_argument('--iterations', type=int, default=10000); p.add_argument('--output', default='kuhn-strategy.json')
    p = sub.add_parser('ranges'); p.add_argument('--output', default='preflop-ranges.json')
    p = sub.add_parser('equity'); p.add_argument('--hole', nargs=2, required=True); p.add_argument('--board', nargs='*', default=[])
    p.add_argument('--opponents', type=int, default=1); p.add_argument('--samples', type=int, default=1000); p.add_argument('--seed', type=int, default=1)
    p.add_argument('--pot', type=float); p.add_argument('--call', type=float)
    args = parser.parse_args()
    try:
        if args.command == 'train':
            result = train(args.iterations); write(args.output, result); print(json.dumps(result['metrics'], indent=2)); return
        if args.command == 'ranges':
            write(args.output, {'source': 'Illustrative deterministic RFI heuristics, not solver-derived. BB entries unused for unopened pots.', 'open_frequencies': RANGES}); print(args.output); return
        if args.command == 'equity':
            result = equity(args.hole, args.board, args.opponents, args.samples, args.seed)
            if args.pot is not None or args.call is not None:
                if args.pot is None or args.call is None or args.pot < 0 or args.call < 0: raise ValueError('Supply nonnegative --pot and --call together.')
                result['checkdown_call_ev'] = result['equity'] * (args.pot + args.call) - args.call
                result['ev_scope'] = 'Incremental EV vs folding, only if this call closes betting and pot is fully contestable; excludes rake and side pots.'
            print(json.dumps(result, indent=2)); return
        if args.command == 'replay':
            game, views = replay(args.path)
            for n, view in enumerate(views):
                print(json.dumps({'step': n, **view}))
                if args.step and n < len(views)-1: input('Enter for next action…')
            return
        config = Config(**json.loads(Path(args.config).read_text(encoding='utf-8'))) if args.config else Config()
        config.validate()
        strategy, rng = Strategy(args.strategy), random.Random(args.seed)
        count = args.hands if args.command == 'simulate' else 1
        if count < 1: raise ValueError('Positive hand count required.')
        net = [0] * 6
        print('LOCAL STUDY ONLY | heuristic opponents: selective preflop, value bets, folds and bluffs | no rake')
        for n in range(count):
            config.seed = args.seed + n
            game = Game(config)
            while not game.done:
                if args.command == 'play' and game.actor == args.hero:
                    print(json.dumps(game.view(), indent=2))
                    print('Actions:', ', '.join(actions(game)))
                    print('Commands: hint | equity | export PATH | fold/check/call/raise:CHIPS | quit')
                    command = input('> ').strip()
                    if command == 'quit':
                        game.save(args.output); print('Partial replay saved:', args.output); return
                    if command == 'hint':
                        row, source = strategy.advise(game); print(source, row); continue
                    if command == 'equity':
                        print(equity(game.holes[args.hero], game.board, len(game.live())-1, 500)); continue
                    if command.startswith('export '):
                        row, source = strategy.advise(game)
                        write(command[7:], {'version': 1, 'key_format': 'exact-local-v1', 'source': source,
                            'states': {key(game): row}}); continue
                    try: apply_label(game, command)
                    except ValueError as error: print(error)
                else:
                    row, _ = strategy.advise(game)
                    label = choose(row, rng)
                    if args.command == 'play': print(f'Seat {game.actor} ({game.position(game.actor)}): {label}')
                    apply_label(game, label)
            for i in range(6): net[i] += game.stacks[i] - config.stacks[i]
            if args.command == 'play':
                game.save(args.output); print(json.dumps(game.view(), indent=2)); print('Replay saved:', args.output)
            else:
                # Rotate button; reset all stacks each hand for independent cash study deals.
                config.button = (config.button + 1) % 6
        if args.command == 'simulate':
            game.save(str(Path(args.output).with_suffix('.last-hand.json')))
            result = {'hands': count, 'net_chips_by_seat': net, 'bb_per_100_by_seat': [x/config.big_blind/count*100 for x in net],
                      'scope': 'Empirical play-money results against fallback/imported policies; not exploitability or equilibrium EV.'}
            write(args.output, result); print(json.dumps(result, indent=2))
    except (ValueError, KeyError, TypeError, OSError) as error:
        parser.exit(2, f'Error: {error}\n')

if __name__ == '__main__': main()
