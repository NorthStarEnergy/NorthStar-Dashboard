from collections import Counter
from itertools import combinations

DECK = [r + s for r in '23456789TJQKA' for s in 'cdhs']

def validate(cards):
    if len(set(cards)) != len(cards) or any(c not in DECK for c in cards):
        raise ValueError('Cards must be unique, e.g. As Kh Td.')

def five(cards):
    ranks = [ '23456789TJQKA'.index(c[0]) + 2 for c in cards ]
    counts = Counter(ranks)
    groups = sorted(((n, r) for r, n in counts.items()), reverse=True)
    unique = sorted(counts, reverse=True)
    straight = (5 if unique == [14, 5, 4, 3, 2] else
                unique[0] if len(unique) == 5 and unique[0] - unique[-1] == 4 else 0)
    flush = len({c[1] for c in cards}) == 1
    if flush and straight: return (8, straight)
    if groups[0][0] == 4: return (7, groups[0][1], groups[1][1])
    if [g[0] for g in groups] == [3, 2]: return (6, groups[0][1], groups[1][1])
    if flush: return (5, *sorted(ranks, reverse=True))
    if straight: return (4, straight)
    if groups[0][0] == 3: return (3, groups[0][1], *sorted((r for r in ranks if r != groups[0][1]), reverse=True))
    if [g[0] for g in groups[:2]] == [2, 2]: return (2, *sorted([groups[0][1], groups[1][1]], reverse=True), groups[2][1])
    if groups[0][0] == 2: return (1, groups[0][1], *sorted((r for r in ranks if r != groups[0][1]), reverse=True))
    return (0, *sorted(ranks, reverse=True))

def rank(cards):
    validate(cards)
    if not 5 <= len(cards) <= 7: raise ValueError('Evaluation requires 5–7 cards.')
    return max(five(c) for c in combinations(cards, 5))

def hand_class(hole):
    validate(hole)
    if len(hole) != 2: raise ValueError('Two hole cards required.')
    a, b = sorted(hole, key=lambda c: '23456789TJQKA'.index(c[0]), reverse=True)
    return a[0] + b[0] + ('' if a[0] == b[0] else 's' if a[1] == b[1] else 'o')
