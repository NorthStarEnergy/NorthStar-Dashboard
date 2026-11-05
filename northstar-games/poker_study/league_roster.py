"""Extra independent copies of existing opponents for the live bot league."""
from dataclasses import replace

from .personalities import POOL, classic_avatar


LEAGUE_POOL = POOL + tuple(
    replace(opponent, id=f'{opponent.id}-2', name=f'{opponent.name} II')
    for opponent in POOL[:5]
)
LEAGUE_BY_ID = {opponent.id: opponent for opponent in LEAGUE_POOL}


def avatar_for(bot_id):
    return classic_avatar(bot_id)
