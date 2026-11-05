"""Fictional opponents with small, stable deviations from a shared baseline."""
from dataclasses import dataclass, asdict

@dataclass(frozen=True)
class Traits:
    flat_bias: float = 0
    oop_width: float = 0
    fold_bias: float = 0
    bet_bias: float = 0
    bluff_bias: float = 0
    thin_value: float = 0
    slowplay: float = 0
    draw_aggression: float = 0
    river_caution: float = 0
    sizing_bias: float = 0
    barrel_bias: float = 0
    range_width: float = 0

@dataclass(frozen=True)
class Opponent:
    id: str
    name: str
    style: str
    description: str
    tendencies: tuple[str, ...]
    traits: Traits

NEUTRAL = Traits()
ROSTER = (
    Opponent('maya','Maya Chen','Patient collector',
        'Calls a little more often with hands that could three-bet. Still builds big pots with strong value.',
        ('More flats, fewer three-bets','A few extra slowplays','Slightly wider suited-hand defense'),
        Traits(flat_bias=.08,slowplay=.035,range_width=.015,draw_aggression=-.02,river_caution=.015)),
    Opponent('owen','Owen Reed','Position challenger',
        'Raises a slightly wider range from early position and the blinds, with a little extra pressure from draws.',
        ('Slightly wider out of position','More aggressive draws','A touch larger sizing'),
        Traits(oop_width=.018,draw_aggression=.035,sizing_bias=.025,bluff_bias=.015,flat_bias=-.015)),
    Opponent('elise','Elise Park','Careful defender',
        'Lets go of a few more marginal bluff-catchers, especially on the river. Strong hands still get paid.',
        ('Slightly more marginal folds','More cautious river calls','Occasional strong-hand traps'),
        Traits(fold_bias=.055,river_caution=.025,slowplay=.02,thin_value=-.015,range_width=-.012)),
    Opponent('leo','Leo Silva','Pressure player',
        'Takes a few extra betting opportunities and continues pressure slightly more often across streets.',
        ('A little more betting','A few extra second barrels','Slightly thinner value bets'),
        Traits(bet_bias=.06,barrel_bias=.035,thin_value=.02,bluff_bias=.02,flat_bias=-.015)),
    Opponent('nora','Nora Vale','Value first',
        'Bluffs a little less often, while still mixing in credible bluffs and betting strong hands.',
        ('Slightly fewer bluffs','A touch more thin value','Some extra checks with draws'),
        Traits(bluff_bias=-.055,thin_value=.025,draw_aggression=-.02,sizing_bias=-.015,river_caution=.015)),
)

def seats(hero):
    result=[]; roster=iter(ROSTER)
    for seat in range(6): result.append(None if seat==hero else next(roster))
    return result

def public_roster(hero):
    return [None if p is None else {'id':p.id,'name':p.name,'style':p.style,
            'description':p.description,'tendencies':list(p.tendencies),
            'avatar':classic_avatar(p.id)} for p in seats(hero)]

VISITORS=(
    Opponent('jules','Jules Hart','Patient pressure','Patient preflop, with a little extra pressure from good draws.',('A few more flats','More active draws','Occasional thin value'),Traits(flat_bias=.035,draw_aggression=.025,thin_value=.015)),
    Opponent('sam','Sam Rivera','Measured defender','Defends a touch wider but is cautious when river bets get large.',('Wider defense','Cautious river calls','Small sizing preference'),Traits(range_width=.015,river_caution=.025,sizing_bias=-.015)),
    Opponent('alex','Alex Morgan','Selective aggressor','A little more early aggression, followed by selective river bluffs.',('Slightly wider early raises','Fewer river bluffs','Occasional traps'),Traits(oop_width=.012,bluff_bias=-.025,slowplay=.015)),
)

def table_roster(hero, lineup=None):
    if not lineup:return seats(hero)
    by_id={p.id:p for p in POOL}
    return [by_id.get(id) for id in lineup]

def table_public(hero,lineup=None):
    return [None if p is None else {'id':p.id,'name':p.name,'style':p.style,
        'description':p.description,'tendencies':list(p.tendencies),'avatar':classic_avatar(p.id)}
        for p in table_roster(hero,lineup)]

MORE_VISITORS=(
    Opponent('daria','Daria King','Value caller','Calls more often preflop, then values made hands carefully.',('Extra flats','Careful river sizing','Thin value sometimes'),Traits(flat_bias=.05,thin_value=.015,river_caution=.02)),
    Opponent('ethan','Ethan Cole','Wide opener','Opens a little wider, including from the blinds, without overplaying weak hands.',('A few extra opens','More checks when out of position','Low bluff boost'),Traits(range_width=.025,oop_width=.015,bluff_bias=.01)),
    Opponent('priya','Priya Shah','Draw pressure','Adds pressure on useful draws and slows down on dry runouts.',('More draw raises','Fewer dry-board barrels','Pot control'),Traits(draw_aggression=.045,barrel_bias=-.015,bet_bias=.015)),
    Opponent('miles','Miles Bennett','Quiet trapper','Checks strong hands slightly more and makes fewer speculative bluffs.',('Occasional traps','Fewer bluffs','Extra calls'),Traits(slowplay=.04,bluff_bias=-.03,flat_bias=.02)),
    Opponent('ava','Ava Brooks','Small-ball regular','Prefers smaller pots and avoids a few marginal river calls.',('Smaller sizes','River caution','Selective defense'),Traits(sizing_bias=-.025,river_caution=.025,fold_bias=.015)),
    Opponent('rafael','Rafael Ortiz','Active three-bettor','Three-bets slightly more in position, while keeping early-position ranges sound.',('More position-aware raises','Active with draws','Occasional thin value'),Traits(flat_bias=-.025,draw_aggression=.025,thin_value=.015)),
    Opponent('zoe','Zoe Kim','Balanced caller','Mixes calls and raises with a slight preference for defending suited hands.',('More suited continues','Some extra bluff-catches','Measured sizing'),Traits(range_width=.015,flat_bias=.025,bluff_bias=.01)),
)
POOL=ROSTER+VISITORS+MORE_VISITORS


def classic_avatar(bot_id):
    ids = [p.id for p in POOL]
    index = ids.index(bot_id.removesuffix('-2'))
    return f'/assets/avatars/classic/classic-{index:02d}.png'
