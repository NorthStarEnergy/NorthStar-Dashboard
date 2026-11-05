"""Local TexasSolver bot bridge. No AI API. Never solves with hidden table cards."""
from collections import OrderedDict, defaultdict
from itertools import combinations
import hashlib
import json
import math
from pathlib import Path
import threading
import time

from .cards import DECK, hand_class
from .bot_policy import strength, weighted_range
from .personalities import NEUTRAL
from .solver_bot import postflop_request, handicap_policy
from .texas_solver import normalize, solve, executable, NATIVE_SLOT

class SolverPending(Exception):
    """A supported bot decision is awaiting a bounded background solve."""


def inferred_request(root):
    """Finite heuristic preflop support, weighted by prior public actions.

    Never prune to a native memory cap; oversized ranges use the old policy.
    Suit-dependent postflop weights are averaged within each class because the
    installed adapter accepts classes. This approximation is not solved GTO.
    """
    ranges=[]
    for profile in root['profiles']:
        cutoff,events,width=profile
        hands,cumulative=weighted_range((),tuple(root['board']),profile)
        weights=defaultdict(list);previous=0.
        for hand,total in zip(hands,cumulative):
            weight=total-previous;previous=total
            # A public range model, independent of the hand being advised.
            if cutoff and strength(hand)<max(0,cutoff-.10):continue
            weights[hand_class(hand)].append(weight)
        ranges.append(','.join(f'{label}:{sum(values)/len(values):.6f}' for label,values in sorted(weights.items())))
    blind=root['min_bet']
    return normalize(dict(board=root['board'],pot=root['pot']/blind,stack=root['stack']/blind,
                          oop_range=ranges[0],ip_range=ranges[1]))


def native_label(action,seat,bets,blind):
    if action in ('CHECK','CALL','FOLD'):return action.lower()
    parts=action.split()
    if len(parts)!=2 or parts[0] not in ('BET','RAISE'):raise ValueError('Unknown native action')
    value=float(parts[1])*blind+bets[seat]
    if not math.isfinite(value) or abs(value-round(value))>1e-4:raise ValueError('Nonintegral native wager')
    # Native amounts are chips added by this player, not raise-to amounts.
    return 'raise:'+str(round(value))


def range_weights(text,board):
    classes={label:float(weight) for label,weight in (item.split(':') for item in text.split(','))}
    return {tuple(sorted(c)):classes[hand_class(c)] for c in combinations([c for c in DECK if c not in board],2)
            if classes.get(hand_class(c),0)>0}


def joint_mass(first,second):
    total=sum(second.values());cards=defaultdict(float)
    for (a,b),weight in second.items():cards[a]+=weight;cards[b]+=weight
    return sum(w*max(0,total-cards[a]-cards[b]+second.get((a,b),0)) for (a,b),w in first.items())


def node_rows(node):
    payload=node.get('strategy',{})
    if payload.get('actions')!=node.get('actions'):raise ValueError('Mismatched action ordering')
    rows={}
    for hand,probs in payload.get('strategy',{}).items():
        if len(hand)!=4 or len(probs)!=len(node['actions']):raise ValueError('Bad native row')
        if any(type(p) not in (int,float) or not math.isfinite(p) or p<0 for p in probs):raise ValueError('Bad probability')
        total=sum(probs)
        if not math.isclose(total,1,abs_tol=1e-5):raise ValueError('Unnormalized native policy')
        rows[tuple(sorted((hand[:2],hand[2:])))]=[p/total for p in probs]
    return rows


def policy_at(game,root,result,traits=NEUTRAL):
    metric=result.get('reported_exploitability_percent')
    if not result.get('target_met') or type(metric) not in (int,float) or not math.isfinite(metric) or not 0<=metric<=.5:
        raise ValueError('accuracy_target_not_met')
    request=result['request'];node=result['tree'];blind=root['min_bet']
    # TexasSolver uses 1=out of position, 0=in position.
    seats={1:root['seats'][0],0:root['seats'][1]};bets={seat:0 for seat in seats.values()}
    weights={1:range_weights(request['oop_range'],root['board']),0:range_weights(request['ip_range'],root['board'])}
    initial=joint_mass(weights[1],weights[0])
    if initial<=0:raise ValueError('empty_joint_range')
    own=tuple(sorted(game.holes[game.actor]));own_reach=1.
    for event in root['street_history']:
        if node.get('node_type')!='action_node' or seats.get(node.get('player'))!=event['seat']:
            raise ValueError('off_tree_actor')
        player=node['player'];seat=seats[player];rows=node_rows(node)
        labels=[native_label(a,seat,bets,blind) for a in node['actions']]
        label='raise:'+str(event['amount']) if event['action']=='raise' else event['action']
        if label not in labels:raise ValueError('off_tree_size')
        index=labels.index(label);native=node['actions'][index]
        if seat==game.actor:own_reach*=rows.get(own,[0]*len(labels))[index]
        weights[player]={h:w*rows.get(h,[0]*len(labels))[index] for h,w in weights[player].items()}
        if event['action']=='raise':bets[seat]=event['amount']
        elif event['action']=='call':bets[seat]=max(bets.values())
        node=node.get('childrens',{}).get(native,{})
    if own_reach<1e-6 or joint_mass(weights[1],weights[0])/initial<1e-6:
        raise ValueError('low_reach_branch')
    if node.get('node_type')!='action_node' or seats.get(node.get('player'))!=game.actor:
        raise ValueError('off_tree_node')
    rows=node_rows(node);probs=rows.get(own)
    if probs is None:raise ValueError('hand_outside_inferred_range')
    other=0 if node['player']==1 else 1
    if not any(w>0 and not set(h).intersection(own) for h,w in weights[other].items()):
        raise ValueError('hand_has_no_compatible_opponent')
    labels=[native_label(a,game.actor,bets,blind) for a in node['actions']]
    if len(set(labels))!=len(labels):raise ValueError('duplicate_mapped_action')
    legal=game.legal()
    for label in labels:
        if label.startswith('raise:'):
            if legal['raise_min'] is None or not legal['raise_min']<=int(label[6:])<=legal['raise_max']:
                raise ValueError('illegal_native_raise')
        elif label=='check' and not legal['check']:raise ValueError('illegal_native_check')
        elif label=='call' and not legal['call']:raise ValueError('illegal_native_call')
    row=handicap_policy(dict(zip(labels,probs)),labels,game.holes[game.actor],game.board,traits or NEUTRAL)
    return {a:p for a,p in row.items() if p>0}, f'TexasSolver heads-up {game.street}; inferred ranges, restricted tree; reported baseline exploitability {metric:.3f}%. Personality/opponent adjustments are outside that metric.'


class TexasSolverBot:
    def __init__(self,path,*,runner=solve,range_builder=inferred_request,installed=None):
        self.path=Path(path);self.path.mkdir(parents=True,exist_ok=True)
        self.runner=runner;self.range_builder=range_builder
        self.installed=installed if installed is not None else executable().is_file()
        self.lock=threading.RLock();self.cache=OrderedDict();self.pending=set();self.failures={}
        self.local=threading.local();self.used=0;self.started=0;self.last_error=''

    @property
    def last_status(self):return getattr(self.local,'status',{'source':'not_used'})
    def fallback(self,reason):
        self.local.status={'source':'fallback','reason':reason};return None

    def _worker(self,key,request):
        try:
            result=self.runner(request)
            if result.get('request')!=request:raise ValueError('mismatched_native_request')
            metric=result.get('reported_exploitability_percent')
            if not result.get('target_met') or type(metric) not in (int,float) or not math.isfinite(metric) or not 0<=metric<=.5:
                raise ValueError('accuracy_target_not_met')
            target=self.path/(key+'.json');temporary=target.with_suffix('.tmp')
            temporary.write_text(json.dumps(result),encoding='utf-8');temporary.replace(target)
            with self.lock:
                self.cache[key]=result
                while len(self.cache)>8:self.cache.popitem(last=False)
                files=sorted(self.path.glob('*.json'),key=lambda p:p.stat().st_mtime,reverse=True)
                for old in files[8:]:old.unlink()
                self.last_error=''
        except Exception as error:
            with self.lock:
                self.failures[key]=time.monotonic();self.last_error=type(error).__name__
                if len(self.failures)>128:self.failures.pop(next(iter(self.failures)))
        finally:
            with self.lock:self.pending.discard(key)
            NATIVE_SLOT.release()

    def advise(self,game,traits=NEUTRAL,*,wait=False):
        if not self.installed:return self.fallback('texassolver_not_installed')
        root=postflop_request(game)
        if root is None:return self.fallback('unsupported_heads_up_root')
        try:request=self.range_builder(root)
        except ValueError:return self.fallback('range_or_tree_resource_limit')
        key=hashlib.sha256(json.dumps(['native-bot-v1',request],sort_keys=True).encode()).hexdigest()
        with self.lock:
            result=self.cache.get(key)
            if result is None:
                file=self.path/(key+'.json')
                if file.is_file() and file.stat().st_size<=20_000_000:
                    try:
                        loaded=json.loads(file.read_text(encoding='utf-8'))
                        if loaded.get('request')==request:result=loaded;self.cache[key]=result
                        while len(self.cache)>8:self.cache.popitem(last=False)
                    except (OSError,ValueError):pass
            if result is None:
                if time.monotonic()-self.failures.get(key,-1e10)<300:return self.fallback('recent_native_failure')
                if key not in self.pending:
                    if not NATIVE_SLOT.acquire(blocking=False):return self.fallback('native_solver_busy')
                    self.pending.add(key);self.started+=1
                    threading.Thread(target=self._worker,args=(key,request),name='texas-solver-bot',daemon=True).start()
                self.local.status={'source':'pending','reason':'texassolver_thinking'}
                if wait:raise SolverPending()
                return None
        try:answer=policy_at(game,root,result,traits)
        except (ValueError,KeyError,TypeError,IndexError):return self.fallback('off_tree_or_unusable_policy')
        with self.lock:self.used+=1
        self.local.status={'source':'texassolver','reported_exploitability_percent':result['reported_exploitability_percent']}
        return answer

    def status(self):
        with self.lock:return {'installed':self.installed,'pending':len(self.pending),'cached':len(self.cache),
            'solves_started':self.started,'decisions_used':self.used,'last_error':self.last_error,
            'scope':'heads_up_postflop_restricted_tree','gto_certified':False}
