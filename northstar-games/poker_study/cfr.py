"""Full-tree vanilla CFR on two-player Kuhn poker, with exact best responses.

This is an executable solver reference, NOT a six-player hold'em solver.
"""
from itertools import permutations, product

DEALS = list(permutations(range(3), 2))

def terminal(cards, history):
    if history == 'pp': return 1 if cards[0] > cards[1] else -1
    if history == 'bp': return 1
    if history == 'pbp': return -1
    if history in ('bb', 'pbb'): return 2 if cards[0] > cards[1] else -2
    return None

def evaluate(policy):
    def walk(cards, history):
        value = terminal(cards, history)
        if value is not None: return value
        player = len(history) % 2
        probs = policy.get(str(cards[player]) + history, [0.5, 0.5])
        return sum(probs[a] * walk(cards, history + move) for a, move in enumerate('pb'))
    return sum(walk(c, '') for c in DEALS) / 6

def metrics(policy):
    base = evaluate(policy)
    best = []
    for player, histories in [(0, ['', 'pb']), (1, ['p', 'b'])]:
        keys = [str(card) + h for card in range(3) for h in histories]
        values = []
        for moves in product(range(2), repeat=6):
            candidate = dict(policy)
            candidate.update({key: [1.0 if a == move else 0.0 for a in range(2)] for key, move in zip(keys, moves)})
            values.append(evaluate(candidate) * (1 if player == 0 else -1))
        best.append(max(values))
    return {'player0_ev': base, 'nash_conv': sum(best), 'exploitability': sum(best) / 2,
            'units': 'Kuhn ante chips', 'scope': 'Exact Kuhn best responses; not holdem exploitability.'}

def train(iterations=10000):
    if iterations < 1: raise ValueError('Positive iteration count required.')
    keys = [str(c) + h for c in range(3) for h in ['', 'p', 'b', 'pb']]
    regrets = {k: [0.0, 0.0] for k in keys}
    sums = {k: [0.0, 0.0] for k in keys}
    for _ in range(iterations):
        strategy = {}
        for k, r in regrets.items():
            positive = [max(0, x) for x in r]
            strategy[k] = [x / sum(positive) for x in positive] if sum(positive) else [0.5, 0.5]
        delta = {k: [0.0, 0.0] for k in keys}
        def walk(cards, history, reach):
            value = terminal(cards, history)
            if value is not None: return value
            player = len(history) % 2
            k = str(cards[player]) + history
            probs = strategy[k]
            utilities = []
            for a, move in enumerate('pb'):
                next_reach = reach.copy()
                next_reach[player] *= probs[a]
                utilities.append(walk(cards, history + move, next_reach))
            value = sum(probs[a] * utilities[a] for a in range(2))
            for a in range(2):
                delta[k][a] += reach[1-player] * (utilities[a] - value) * (1 if player == 0 else -1) / 6
                sums[k][a] += reach[player] * probs[a] / 6
            return value
        for cards in DEALS: walk(cards, '', [1.0, 1.0])
        for k in keys:
            for a in range(2): regrets[k][a] += delta[k][a]
    policy = {k: [v / sum(s) for v in s] if sum(s) else [0.5, 0.5] for k, s in sums.items()}
    return {'game': 'kuhn', 'iterations': iterations, 'actions': ['pass/fold', 'bet/call'], 'policy': policy, 'metrics': metrics(policy)}
