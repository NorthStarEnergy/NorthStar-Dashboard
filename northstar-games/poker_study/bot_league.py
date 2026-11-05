"""Persistent, independent six-handed background bot league."""
import copy, json, random, secrets, sqlite3, threading, time
from contextlib import closing
from dataclasses import asdict
from .engine import Config, Game
from .personalities import NEUTRAL
from .league_roster import LEAGUE_POOL, LEAGUE_BY_ID, avatar_for
from .player_profiles import PlayerProfiles
from .strategy import Strategy, choose, apply_label
from .opponent_memory import OpponentMemory, hand_identity, decision_record

INITIAL=50000
class BotLeague:
    def __init__(self,path,strategy=None,start=True,memory=None,profiles=None,coach=None):
        from .bot_coach import BotCoach
        from pathlib import Path
        self.coach = coach if coach is not None else BotCoach(Path(path).with_name('bot-coach.sqlite3') if path else None)
        self.memory = memory if memory is not None else OpponentMemory(path)
        self.profiles = profiles if profiles is not None else PlayerProfiles(path)
        self.path=path;self.strategy=strategy or Strategy();self.lock=threading.RLock();self.rng=random.Random(secrets.randbits(64));self.state=self._load() or self._fresh()
        if start:
            threading.Thread(target=self._run,name='northstar-bot-league',daemon=True).start()
    def _load(self):
        if not self.path:return None
        with closing(sqlite3.connect(self.path)) as db:
            row=db.execute("SELECT payload FROM bot_league WHERE id=1").fetchone() if db.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='bot_league'").fetchone() else None
        if not row:return None
        data=json.loads(row[0])
        if not {'bots','tables','waiting','hands','rotations'} <= data.keys():return None
        for table in data['tables']:
            saved=table.pop('game')
            table['game']=None
            if saved:
                game=Game(Config(**saved['config']),saved['deck'])
                for event in saved['history']:game.act(event['action'],event.get('amount'))
                table['game']=game
        self._expand(data)
        return data
    def _bot(self,p):
        return {'name':p.name,'style':p.style,'avatar':avatar_for(p.id),'bankroll':INITIAL,
                'cash':INITIAL-10000,'stack':10000,'hands':0,'wins':0,'profit':0,
                'vpip':0,'pfr':0,'rating':1000,'table':None,'idle_hands':0,'rebuys':0}
    def _expand(self,data):
        bots=data['bots']
        for p in LEAGUE_POOL:
            if p.id not in bots:
                bots[p.id]=self._bot(p)
                data['waiting'].append(p.id)
        for bot_id,b in bots.items():
            b.setdefault('rebuys',0)
            b['avatar']=avatar_for(bot_id)
        while len(data['tables'])<3:
            number=len(data['tables'])+1
            lineup=data['waiting'][:6]
            if len(lineup)<6:raise ValueError('Bot league needs six available seats.')
            del data['waiting'][:6]
            for bot_id in lineup:bots[bot_id]['table']=number
            data['tables'].append({'id':number,'lineup':lineup,'button':self.rng.randrange(6),
                                   'hands':0,'rotation_at':0,'game':None,'settled':False})
            for t in data['tables'][:-1]:t['rotation_at']=t['hands']
        for t in data['tables']:
            t.setdefault('rotation_at',t['hands'])
        data['waiting']=[bot_id for bot_id in data['waiting'] if bots[bot_id]['table'] is None]
    def _fresh(self):
        bots={p.id:self._bot(p) for p in LEAGUE_POOL}
        ids=list(bots);self.rng.shuffle(ids)
        tables=[]
        for i in range(3):
            lineup=ids[i*6:(i+1)*6]
            for bot in lineup:bots[bot]['table']=i+1
            tables.append({'id':i+1,'lineup':lineup,'button':self.rng.randrange(6),'hands':0,'rotation_at':0,'game':None,'settled':False})
        waiting=ids[18:]
        for bot in waiting:bots[bot]['idle_hands']=0
        return {'bots':bots,'tables':tables,'waiting':waiting,'hands':0,'rotations':0,'saved_at':time.time(),'error':''}
    def _save(self):
        if not self.path:return
        self.path.parent.mkdir(parents=True,exist_ok=True)
        data=copy.deepcopy(self.state)
        for t in data['tables']:
            g=t.pop('game');t['game']={'config':asdict(g.config),'deck':g.initial_deck,'history':g.history} if g else None
        with closing(sqlite3.connect(self.path,timeout=10)) as db:
            db.execute('CREATE TABLE IF NOT EXISTS bot_league (id INTEGER PRIMARY KEY CHECK(id=1), payload TEXT NOT NULL)')
            db.execute('INSERT OR REPLACE INTO bot_league VALUES (1,?)',(json.dumps(data),));db.commit()
        self.state['saved_at']=time.time()
    def _rotate_all(self):
        tables=self.state['tables'];bots=self.state['bots']
        old=[t['lineup'][:] for t in tables]
        for index,t in enumerate(tables):
            t['lineup']=old[index-1]
            for bot_id in t['lineup']:bots[bot_id]['table']=t['id']
            t['rotation_at']=t['hands']
        # Reserve bots get a seat; the displaced bots enter the wait queue.
        for t in tables[:min(2,len(self.state['waiting']))]:
            incoming=self.state['waiting'].pop(0)
            outgoing=t['lineup'].pop(0)
            t['lineup'].insert(0,incoming)
            bots[incoming]['table']=t['id']
            bots[outgoing]['table']=None
            bots[outgoing]['idle_hands']=0
            self.state['waiting'].append(outgoing)
        for t in tables:
            t['game']=None
            t['settled']=False
        self.state['rotations']+=sum(len(t['lineup']) for t in tables)
    def _rebuy(self,b):
        if b['stack']>=100:return
        b['cash']-=10000-b['stack']
        b['stack']=10000
        b['rebuys']+=1
        b['bankroll']=b['cash']+b['stack']
    def _new_hand(self,t):
        n=len(t['lineup']);button=(t['button']+1)%n;stacks=[]
        for id in t['lineup']:
            b=self.state['bots'][id]
            self._rebuy(b)
            stacks.append(b['stack'])
        t['button']=button;t['game']=Game(Config(stacks=stacks,button=button,seed=self.rng.getrandbits(64)));t['settled']=False
    def _finish(self,t,g):
        if t['settled']:return
        identities=['bot:'+id for id in t['lineup']]
        self.memory.observe(hand_identity(g,identities),g,identities)
        initial=g.config.stacks
        pre=[e for e in g.history if e['street']=='preflop']
        records=[]
        for seat,id in enumerate(t['lineup']):
            b=self.state['bots'][id];net=g.stacks[seat]-initial[seat]
            records.append(('bot:'+id,b['hands']+1,{
                'table':t['id'],'pot':sum(g.total),'net':net,'board':g.board.copy(),
                'hole':list(g.holes[seat]),'actions':copy.deepcopy(g.history),
                'awards':copy.deepcopy(g.awards),
                'players':[self.state['bots'][player_id]['name'] for player_id in t['lineup']],
                'final_stack':g.stacks[seat],
            }))
        self.profiles.record_many(records)
        for seat,id in enumerate(t['lineup']):
            b=self.state['bots'][id];net=g.stacks[seat]-initial[seat]
            b['stack']=g.stacks[seat];b['hands']+=1;b['wins']+=int(net>0)
            b['vpip']+=int(any(e['seat']==seat and e['action'] in ('call','raise') for e in pre))
            b['pfr']+=int(any(e['seat']==seat and e['action']=='raise' for e in pre))
            b['rating']=max(600,min(2400,b['rating']+max(-12,min(12,round(net/1000)))))
            self._rebuy(b)
            b['bankroll']=b['cash']+b['stack']
            b['profit']=b['bankroll']-INITIAL
        t['settled']=True;t['hands']+=1;self.state['hands']+=1

    def tick(self):
        with self.lock:
            for id in self.state['waiting']:self.state['bots'][id]['idle_hands']+=1
            for table in self.state['tables']:
                if table['game'] is None or (table['game'].done and table['settled']):
                    if table['hands']>=table['rotation_at']+300:continue
                    self._new_hand(table)
                game=table['game']
                if not game.done:
                    profiles=[LEAGUE_BY_ID[id].traits for id in table['lineup']]
                    identities=['bot:'+id for id in table['lineup']]
                    from .texas_solver_bot import SolverPending
                    try:
                        row,_=self.strategy.advise(game,profiles[game.actor],[NEUTRAL]*game.seat_count)
                        reference,source=self.coach.reference(self.strategy,game)
                    except SolverPending:continue
                    adjusted,reads=self.memory.adjust(game,identities,row,profiles[game.actor])
                    adjusted,coaching=self.coach.prepare(game,identities,adjusted,reference,source)
                    chosen=choose(adjusted,self.rng)
                    record=decision_record(game,identities,row,adjusted,reads,chosen)
                    apply_label(game,chosen)
                    self.coach.record(coaching,chosen)
                    self.memory.record_decisions([record])
                    for seat,id in enumerate(table['lineup']):
                        b=self.state['bots'][id];b['stack']=game.stacks[seat]+game.total[seat];b['bankroll']=b['cash']+b['stack'];b['profit']=b['bankroll']-INITIAL
                if game.done:self._finish(table,game)
            if all(t['hands']>=t['rotation_at']+300 and t['game'].done and t['settled'] for t in self.state['tables']):
                self._rotate_all()
            self._save()
    def _run(self):
        while True:
            try:
                self.tick();self.state['error']=''
            except Exception as error:
                self.state['error']=type(error).__name__
                time.sleep(1)
            time.sleep(1.2)
    def snapshot(self):
        with self.lock:
            bots=self.state['bots'];tables=[]
            for t in self.state['tables']:
                g=t['game'];players=[]
                for i,id in enumerate(t['lineup']):
                    b=bots[id];players.append({'id':id,'hole':list(g.holes[i]) if g else [],'name':b['name'],'avatar':b['avatar'],'style':b['style'],'position':g.position(i) if g else '', 'folded':g.folded[i] if g else False,'bet':g.street_bets[i] if g and not g.done else 0,'stack':g.stacks[i] if g else b['stack'],'bankroll':b['bankroll'],'rating':b['rating'],'hands':b['hands'],'wins':b['wins'],'profit':b['profit'],'rebuys':b['rebuys']})
                # This league seats only bot roster IDs; human games use a separate API.
                tables.append({'bot_only':True,'id':t['id'],'hand':t['hands']+int(g is not None and not g.done),'street':g.street if g else 'starting','pot':g.pot if g else 0,'board':g.board if g else [],'players':players,'actor':g.actor if g else None,'button':t['button'],'done':g.done if g else False,'history':copy.deepcopy(g.history) if g else [],'awards':copy.deepcopy(g.awards) if g and g.done else []})
            leaderboard=sorted(({'id':b['id'],'name':b['name'],'style':b['style'],'avatar':b['avatar'],'bankroll':b['bankroll'],'rating':b['rating'],'hands':b['hands'],'wins':b['wins'],'profit':b['profit'],'rebuys':b['rebuys'],'vpip':round(100*b['vpip']/max(1,b['hands'])),'pfr':round(100*b['pfr']/max(1,b['hands']))} for b in ({**v,'id':k} for k,v in bots.items())),key=lambda b:(b['rating'],b['bankroll']),reverse=True)
            waiting=[{'id':id,'name':bots[id]['name'],'idle_hands':bots[id]['idle_hands']} for id in self.state['waiting']]
            return {'tables':tables,'leaderboard':leaderboard,'waiting':waiting,'hands_completed':self.state['hands'],'rotations':self.state['rotations'],'updated':self.state['saved_at'],'error':self.state.get('error','')}
