import tempfile
import unittest
from pathlib import Path

from poker_study.cards import DECK
from poker_study.career_store import CareerStore, restore
from poker_study.engine import Game
from poker_study.invitations import Invitations
from poker_study.sampled_solver import HoldemSolver
from poker_study.strategy import Strategy


class TrainingTests(unittest.TestCase):
    def test_paired_river_ev_in_big_blinds(self):
        # The big blind has a royal flush and faces a 99 BB shove into 2 BB.
        draws = '2s Ah 4d 5c 6s 7d 3s Kh 8d 9c Td Jc 4s Qh Jh Th 5s 2c 6c 3d'.split()
        game = Game(deck=[c for c in DECK if c not in draws] + draws[::-1])
        for _ in range(4):
            game.act('fold')
        game.act('call')
        while game.street != 'river':
            game.act('check')
        game.act('raise', 9900)
        review = HoldemSolver(game).decision_review(
            game, 'fold', {'fold': .25, 'call': .75}, {'min': 100, 'max': 10000}, samples=12)
        self.assertEqual(review['ev'], {'fold': 0, 'call': 101})
        self.assertEqual(review['reference_ev'], 75.75)
        self.assertEqual(review['delta'], -75.75)
        self.assertEqual(review['standard_error'], 0)
        self.assertEqual(game.legal()['call'], 9900)

    def test_private_history_survives_guest_upgrade_and_resumes_study(self):
        with tempfile.TemporaryDirectory() as directory:
            store = CareerStore(Path(directory) / 'careers.sqlite3')
            Invitations(store.path)
            session = {'game': Game(), 'hero': 3, 'mode': 'study', 'career': None,
                       'strategy': Strategy(), 'training_decisions': [{'action': 'call'}]}
            for number in range(1, 53):
                session['number'] = number
                store.save('guest', session, {'number': number})
            store.save('guest', session, {'number': 52, 'net_bb': -1})
            hands = store.training_history('guest', session)
            self.assertEqual([h['number'] for h in hands], list(range(52, 2, -1)))
            self.assertEqual(hands[0]['net_bb'], -1)
            self.assertEqual(restore(store.load('guest'))['training_decisions'], session['training_decisions'])
            store.create_account('Player', 'training-password', 'member', 'guest', session)
            self.assertEqual(store.training_history('guest', session), [])
            self.assertEqual(store.training_history('member', session), hands)
            self.assertEqual(store.training_history('another-player', session), [])


if __name__ == '__main__':
    unittest.main()
