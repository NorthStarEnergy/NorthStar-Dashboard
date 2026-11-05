"""Mixed practice strategies with small personality deviations; not solved GTO.
Only actor cards and public information inform decisions and sampled ranges.
"""
import hashlib
import random
from bisect import bisect_left
from collections import Counter
from functools import lru_cache
from itertools import combinations
from .cards import DECK, rank
from .personalities import NEUTRAL

OPEN_CUTOFF={'UTG':.55,'HJ':.51,'CO':.44,'BTN':.31,'SB':.37,'BB':.50}

def clamp(x,lo=0.,hi=1.): return max(lo,min(hi,x))

def strength(hole):
    hi,lo=sorted(('23456789TJQKA'.index(c[0])+2 for c in hole),reverse=True)
    if hi==lo:return .48+(hi-2)*.043
    return min(.96,(hi+lo-10)/24+.07*(hole[0][1]==hole[1][1])+.04*(hi-lo==1)+.04*(hi==14))

def raise_label(game,target):
    legal=game.legal()
    if legal['raise_min'] is None:return None
    return 'raise:'+str(max(legal['raise_min'],min(round(target),legal['raise_max'])))

def distribution(game,passive,aggression=0.,target=0,fold=0.,second_size=None):
    legal=game.legal();row={};label=raise_label(game,target)
    aggression=clamp(aggression) if label else 0
    fold=clamp(fold,0,1-aggression) if legal['call'] else 0
    if fold:row['fold']=fold
    remainder=1-aggression-fold
    if remainder>1e-9:row[passive]=row.get(passive,0)+remainder
    if aggression:
        other=raise_label(game,second_size) if second_size is not None else None
        row[label]=row.get(label,0)+aggression*(.75 if other and other!=label else 1)
        if other and other!=label:row[other]=row.get(other,0)+aggression*.25
    total=sum(row.values())
    return {a:p/total for a,p in row.items() if p>1e-9}

def in_position(game):
    order=lambda j:(j-game.config.button-1)%game.seat_count
    return order(game.actor)==max(order(j) for j in game.live())

def preflop(game,traits=NEUTRAL):
    legal=game.legal();hole=game.holes[game.actor];pos=game.position(game.actor)
    score,blind=strength(hole),game.config.big_blind
    raises=[e for e in game.history if e['action']=='raise']
    limps=sum(e['action']=='call' for e in game.history) if not raises else 0
    hi,lo=sorted(('23456789TJQKA'.index(c[0])+2 for c in hole),reverse=True)
    pair,suited=hi==lo,hole[0][1]==hole[1][1]
    oop=pos in ('UTG','HJ','SB','BB')
    widening=traits.range_width+(traits.oop_width if oop else 0)
    passive='check' if legal['check'] else 'call'
    if not raises:
        cutoff=OPEN_CUTOFF[pos]+min(.08,.025*limps)-widening
        pair_open=pair and hi>=(5 if pos in ('UTG','HJ') else 2)
        frequency=clamp(.50+(score-cutoff)*5,0,.94)
        if pair_open:frequency=max(frequency,.86)
        if suited and hi==14 and lo<=5:frequency=max(frequency,.18 if pos in ('UTG','HJ') else .40)
        if score<cutoff-.10 and not pair_open and not(suited and hi==14):frequency=0
        target=blind*(2.5+limps+(.3 if pos=='SB' else 0))
        if legal['check']:return distribution(game,'check',frequency,target),'Position-aware opening/isolation mix.'
        call=min(.18 if limps and suited and score>.43 and legal['call']<=blind else 0,1-frequency)
        return distribution(game,'call',frequency,target,1-frequency-call),'Mixed opening range and selective small-price overlimps.'
    cost=legal['call']/blind;fraction=legal['call']/max(1,game.stacks[game.actor])
    cutoff=.53+.085*(len(raises)-1)+min(.30,max(0,cost-3)*.020)-widening
    opener=game.position(raises[0]['seat'])
    cutoff+=.035 if opener in ('UTG','HJ') else -.035 if opener in ('BTN','SB') else 0
    cutoff-=.07 if pos=='BB' else .025 if pos in ('BTN','CO') else 0
    cutoff+=traits.fold_bias*.45
    premium=(pair and hi>=12) or (hi==14 and lo==13)
    if fraction>.65 and cost>=25 and not(pair and hi>=13):
        return distribution(game,'call',fold=.80 if premium else 1),'Deep all-in defense: a tight premium range.'
    if fraction>.25 and cost>=12:cutoff=max(cutoff,.90)
    target=game.current*(3.5 if oop else 3)
    target+=sum(e['action']=='call' for e in game.history[game.history.index(raises[-1])+1:])*game.current
    if premium:
        frequency=clamp((.82 if len(raises)<3 else .48)-traits.flat_bias,.30,.92)
        return distribution(game,'call',frequency,target),'Premium value: mixed reraises and flats.'
    bluff_candidate=suited and hi==14 and lo<=5 and len(raises)==1 and cost<=4 and fraction<.12
    bluff=clamp(.12+traits.bluff_bias-traits.flat_bias*.4,.03,.22) if bluff_candidate else 0
    defend=clamp(.50+(score-cutoff)*5)
    if score<cutoff-.10:defend=0
    if fraction>.25 and cost>=12 and score<.9:defend=0;bluff=0
    value=clamp((score-.74)*1.1,0,.32) if len(raises)==1 and score>=cutoff else 0
    reraise=clamp(value+bluff-traits.flat_bias*(1 if value else 0),0,.40)
    call=clamp(defend-reraise,0,1-reraise)
    return distribution(game,passive,reraise,target,1-reraise-call),'Size-sensitive defense; selected value and suited-ace bluff reraises.'

def features(hole,board):
    ranks={'23456789TJQKA'.index(c[0])+2 for c in hole+board}
    if 14 in ranks:ranks.add(1)
    br={'23456789TJQKA'.index(c[0])+2 for c in board}
    if 14 in br:br.add(1)
    suits=Counter(c[1] for c in hole+board);bs=Counter(c[1] for c in board)
    flush=len(board)<5 and any(n==4 and any(c[1]==s for c in hole) and bs[s]<4 for s,n in suits.items())
    windows=[set(range(low,low+5)) for low in range(1,11)]
    straight=len(board)<5 and any(len(w&ranks)==4 and len(w&br)<4 for w in windows)
    made=rank(list(hole)+list(board));board_only=rank(list(board)) if len(board)==5 else None
    personal=made[0] if board_only is None or made>board_only else 0
    hole_ranks={'23456789TJQKA'.index(c[0])+2 for c in hole}
    if made[0] in (1,3,7) and made[1] not in hole_ranks:personal=0
    if made[0]==2 and not hole_ranks.intersection(made[1:3]):personal=0
    if made[0] in (4,8):straight=False
    if made[0] in (5,8):flush=False
    high=max('23456789TJQKA'.index(c[0])+2 for c in board)
    top_pair=any(c[0] in {b[0] for b in board if '23456789TJQKA'.index(b[0])+2==high} for c in hole)
    blocker=any(c[0]=='A' and bs[c[1]]>=3 for c in hole)
    wet=max(bs.values())>=2 or max(len(w&br) for w in windows)>=3
    return {'draw':float(flush)+.65*straight,'made':personal,'top_pair':top_pair,'blocker':blocker,'wet':wet}

@lru_cache(maxsize=256)
def weighted_range(hole,board,profile):
    cutoff,events,width=profile
    pool=[c for c in DECK if c not in hole+board];hands=[];cumulative=[];total=0.
    for candidate in combinations(pool,2):
        weight=clamp(.50+(strength(candidate)-cutoff+width)*4,.015,1)
        for street,action,size in events:
            visible=board[:{'flop':3,'turn':4,'river':5}[street]]
            f=features(candidate,visible);made=f['made'];draw=f['draw']
            if action=='raise':
                likelihood=.92 if made>=2 else .58 if f['top_pair'] else .24 if made==1 else .07
                likelihood+=min(.30,draw*.20)
                if size>.8 and made<2:likelihood*=.65
            elif action=='call':likelihood=.82 if made>=1 else .16+min(.55,draw*.3)
            else:likelihood=.65 if made>=2 else .88
            weight*=max(.01,likelihood)
        total+=max(weight,.00001);hands.append(candidate);cumulative.append(total)
    return tuple(hands),tuple(cumulative)

def equity_batch(hole,board,profiles,samples=256,offset=0):
    """Independent joint-range draws; inputs contain no opponent private cards."""
    from .sampled_solver import seven_rank
    rng=random.Random(int.from_bytes(hashlib.sha256(repr((hole,board,profiles,offset)).encode()).digest()[:16],'big'))
    ranges=[weighted_range(hole,board,p) for p in profiles]
    unseen=[c for c in DECK if c not in hole+board]
    total=squares=0.
    for _ in range(samples):
        # Reject the entire tuple. Sequential collision rejection biases ranges.
        for attempt in range(10000):
            opponents=[hands[bisect_left(cumulative,rng.random()*cumulative[-1])] for hands,cumulative in ranges]
            used=[c for hand in opponents for c in hand]
            if len(set(used))==len(used):break
        else:raise ValueError('Unable to sample compatible opponent ranges.')
        runout=list(board)+rng.sample([c for c in unseen if c not in used],5-len(board))
        scores=[seven_rank(list(hole)+runout)]+[seven_rank(list(h)+runout) for h in opponents]
        value=1/scores.count(max(scores)) if scores[0]==max(scores) else 0.
        total+=value;squares+=value*value
    return samples,total,squares

@lru_cache(maxsize=1024)
def sampled_equity(hole,board,profiles):
    n,total,_=equity_batch(hole,board,profiles)
    return total/n


def public_action_context(game):
    """Reconstruct prices when actions occurred, using only public chip movement."""
    stacks=game.config.stacks.copy();bets=[0]*game.seat_count;pot=0;current=game.config.big_blind
    for seat,size in [((game.config.button+1)%game.seat_count,game.config.small_blind),((game.config.button+2)%game.seat_count,game.config.big_blind)]:
        paid=min(stacks[seat],size);stacks[seat]-=paid;bets[seat]+=paid;pot+=paid
    street='preflop';context=[]
    for event in game.history:
        if event['street']!=street:street=event['street'];bets=[0]*game.seat_count;current=0
        seat=event['seat'];call=min(stacks[seat],max(0,current-bets[seat]));ratio=0
        if event['action']=='raise':
            ratio=(event['amount']-current)/max(1,pot+call)
            paid=event['amount']-bets[seat];current=event['amount']
        else:paid=call if event['action']=='call' else 0
        context.append((event,round(ratio,2)))
        stacks[seat]-=paid;bets[seat]+=paid;pot+=paid
    return context

def range_profiles(game,opponent_traits=None):
    profiles=[]
    context=public_action_context(game)
    for j in game.live():
        if j==game.actor:continue
        events=[e for e in game.history if e['seat']==j]
        pre=[e for e in events if e['street']=='preflop']
        raises=sum(e['action']=='raise' for e in pre)
        cutoff=OPEN_CUTOFF[game.position(j)]+.09*max(0,raises-1) if raises else .40 if any(e['action']=='call' for e in pre) else .0
        public=tuple((e['street'],e['action'],size) for e,size in context if e['seat']==j and e['street']!='preflop')
        t=opponent_traits[j] if opponent_traits else NEUTRAL
        profiles.append((cutoff,public,t.range_width+t.oop_width*.35))
    return tuple(profiles)

def river_pressure(game,features):
    """Return a conservative one-pair adjustment for strongly polarized rivers."""
    if game.street!='river' or features['made']>1:return 0.
    raises=[e for e in game.history if e['street']=='river' and e['action']=='raise']
    if not raises:return 0.
    bettor=raises[-1]['seat'];pressure=0.
    if game.legal()['call']/max(1,game.pot)>=.45:pressure+=.08
    prior=sum(e['seat']==bettor and e['action']=='raise' and e['street'] in ('flop','turn') for e in game.history)
    if prior>=2:pressure+=.10
    if any(e['seat']==game.actor and e['action']=='raise' for e in raises[:-1]):pressure+=.14
    board_suits=Counter(c[1] for c in game.board)
    if max(board_suits.values())>=4 and not features['blocker']:pressure+=.18
    board_ranks={'23456789TJQKA'.index(c[0])+2 for c in game.board}
    if 14 in board_ranks:board_ranks.add(1)
    if any(len(set(range(low,low+5))&board_ranks)>=4 for low in range(1,11)):pressure+=.08
    return min(.40,pressure)

def postflop(game,traits=NEUTRAL,opponent_traits=None,equity_learner=None):
    i,legal=game.actor,game.legal();hole=tuple(sorted(game.holes[i]));board=tuple(game.board)
    opponents=[j for j in game.live() if j!=i];multi=len(opponents)>1;ip=in_position(game)
    estimate=equity_learner.estimate if equity_learner else sampled_equity
    equity=estimate(hole,board,range_profiles(game,opponent_traits));f=features(hole,board)
    cap=game.total[i]+legal['call'];contestable=sum(min(t,cap) for t in game.total)+legal['call']
    odds=legal['call']/max(1,contestable)
    prior_barrel=any(e['seat']==i and e['action']=='raise' and e['street'] not in ('preflop',game.street) for e in game.history)
    initiative=next((e['seat'] for e in reversed(game.history) if e['action']=='raise'),None)==i
    polarized=game.street=='river' and (equity>.82 or equity<.30)
    fraction=(.90 if polarized else .72 if f['wet'] or multi else .40)+traits.sizing_bias
    effective=min(game.stacks[i],max(game.stacks[j] for j in opponents))
    if game.street!='river' and effective/max(1,game.pot)<1.4:fraction=max(fraction,.70)
    target=game.current+max(game.config.big_blind,(game.pot+legal['call'])*fraction)
    second=game.current+max(game.config.big_blind,(game.pot+legal['call'])*max(.33,fraction-.20))
    reason=f'Range equity ~{equity:.0%}, call price {odds:.0%}, '+('in position' if ip else 'out of position')+'. '
    draw=f['draw']>0 and game.street!='river'
    if legal['call']:
        realization=(.97 if ip else .91) if game.street!='river' else 1.
        margin=.025+(.025 if multi else 0)+traits.fold_bias*.35+(traits.river_caution if game.street=='river' else 0)
        edge=equity*realization-odds-margin
        call=clamp(.50+edge*7)
        if edge<-.08:call=0
        value=clamp((equity-.66)*2.6,0,.78) if equity>=.73 else 0
        value=clamp(value-traits.slowplay,0,.82)
        bluff=clamp(.13+traits.draw_aggression+traits.bluff_bias*.5,.03,.24) if draw and equity>.23 and not multi and legal['call']/max(1,game.pot)<.6 else 0
        if equity>.94:call=1
        aggression=max(value,bluff) if legal['raise_min'] is not None else 0
        pressure=river_pressure(game,f)
        if pressure:
            call=min(call,max(.12,.72-pressure*1.5));aggression=0
        fold=clamp(1-call-aggression+traits.fold_bias*.45,0,1-aggression) if equity<.80 or pressure else 0
        detail=' River pressure adjustment.' if pressure else ''
        return distribution(game,'call',aggression,target,fold,second),reason+('Value raise / call mix.' if value else 'Draw pressure mixed with calls/folds.' if bluff else 'Price-sensitive bluff-catching and folds.')+detail
    cutoff=(.56 if multi else .64)-traits.thin_value
    if equity>cutoff:
        aggression=clamp(.55+(equity-cutoff)*1.2+traits.bet_bias-traits.slowplay,.40,.92)
        return distribution(game,'check',aggression,target,second_size=second),reason+'Mixed value betting and protected checks.'
    low_showdown=equity<.38 and not f['top_pair']
    if draw:aggression=.22+traits.draw_aggression+traits.bluff_bias*.5
    elif low_showdown:aggression=.14+.09*f['blocker']+.04*ip+.04*initiative+traits.bluff_bias
    else:aggression=.05
    aggression+=traits.bet_bias+(traits.barrel_bias if prior_barrel else 0)
    if multi:aggression*=.30
    aggression=clamp(aggression,.015,.42)
    return distribution(game,'check',aggression,target,second_size=second),reason+('Semi-bluff/check mix with a draw.' if draw else 'Selected blocker/low-showdown bluffs.' if low_showdown else 'Mostly check medium showdown value.')

def bound_deviation(base,styled,limit=.10):
    """Cap personality action-category total variation at ten percentage points."""
    categories=('fold','call','check','raise')
    mass=lambda row,category:sum(p for a,p in row.items() if a.split(':')[0]==category)
    distance=sum(abs(mass(base,c)-mass(styled,c)) for c in categories)/2
    if distance<=limit:return styled
    weight=limit/distance
    return {a:p for a in sorted(base.keys()|styled.keys()) if (p:=(1-weight)*base.get(a,0)+weight*styled.get(a,0))>1e-9}

def advise(game,traits=NEUTRAL,opponent_traits=None,equity_learner=None):
    decide=lambda t:preflop(game,t) if game.street=='preflop' else postflop(game,t,opponent_traits,equity_learner)
    row,reason=decide(traits)
    if traits!=NEUTRAL:
        baseline,_=decide(NEUTRAL)
        row=bound_deviation(baseline,row)
    return row,'Mixed practice strategy (heuristic, not solved GTO): '+reason
