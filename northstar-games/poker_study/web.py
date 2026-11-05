"""Loopback WSGI app for an isolated Cloudflare Tunnel origin.

No file uploads are written to disk, no credentials or site automation, and
each visitor gets an independent, expiring play-money session.
"""
import argparse
import hashlib
import ipaddress
import json
import mimetypes
import random
import re
import secrets
import threading
import time
from dataclasses import asdict
from http.cookies import SimpleCookie
from pathlib import Path
from urllib.parse import urlsplit
from .engine import Config, Game, replay_data
from .strategy import Strategy, RANGES, actions, key, choose, apply_label, equity
from .personalities import seats, public_roster, NEUTRAL, ROSTER, POOL, table_roster, table_public

ROOT = Path(__file__).with_name('static')
HOSTS = {'games.northstarenergy.ca', 'localhost', '127.0.0.1'}
COOKIE = 'ns_games'
VERSION = '0.8.2'

from .career_store import CareerStore, restore
from .bot_league import BotLeague
from .opponent_memory import OpponentMemory, hand_identity, decision_record
from .player_profiles import PlayerProfiles

class App:
    def __init__(self, db_path=None, enable_league=False):
        self.store = CareerStore(db_path)
        from .invitations import Invitations
        self.invitations = Invitations(self.store.path)
        self.memory = OpponentMemory(db_path)
        from .bot_coach import BotCoach
        self.coach = BotCoach(Path(db_path).with_name('bot-coach.sqlite3') if db_path else None)
        self.profiles = PlayerProfiles(db_path)
        from .equity_learning import EquityLearner
        self.equity_learner = EquityLearner(Path(db_path).with_name("bot-learning.sqlite3")) if db_path else None
        from .texas_solver_bot import TexasSolverBot
        self.texas_bot = TexasSolverBot(Path(db_path).parent / "texas-bot-cache") if db_path else None
        self.league=BotLeague(db_path,strategy=Strategy(equity_learner=self.equity_learner,texas_solver=self.texas_bot,wait_for_solver=True),start=True,memory=self.memory,profiles=self.profiles,coach=self.coach) if enable_league else None
        self.sessions = {}
        self.lock = threading.Lock()
        self.equity_slot = threading.BoundedSemaphore(2)
        from .texas_solver import TexasSolverJobs
        self.texas_solver = TexasSolverJobs()
        self.auth_failures = {}
        self.registration_events = {}
        self.auth_lock=threading.Lock()

    def session_for_token(self, token=None):
        now=time.monotonic()
        with self.lock:
            self.sessions={k:v for k,v in self.sessions.items() if now-v['seen']<7200}
            if token in self.sessions:
                self.sessions[token]['seen']=now
                return token,self.sessions[token]
            if len(self.sessions)>=500:raise ValueError('Study room is busy. Please try again later.')
            token=token or secrets.token_urlsafe(32)
            session={'seen':now,'game':None,'hero':3,'strategy':Strategy(equity_learner=self.equity_learner,texas_solver=self.texas_bot,wait_for_solver=True),'lock':threading.RLock(),'number':0,'rng':random.Random(secrets.randbits(128))}
            saved=self.store.load(token)
            if saved:
                loaded=restore(saved)
                session['strategy'].rows=loaded.pop('strategy_rows',{})
                session.update(loaded)
                if session.get('career'):
                    session['career'].setdefault('profile_id',self.store.profile_id(token))
            if not session.get('opponent_id'):
                session['opponent_id'] = 'player:' + hashlib.sha256(token.encode()).hexdigest()
            account_id=self.store.account_for_token(token)
            if account_id:session['account_id']=account_id
            self.sessions[token]=session
            return token,session

    def session(self, environ):
        cookie = SimpleCookie()
        try: cookie.load(environ.get('HTTP_COOKIE', ''))
        except Exception: pass
        token = cookie[COOKIE].value if COOKIE in cookie else None
        return self.session_for_token(token)

    @staticmethod
    def validate_account(data):
        username=data.get('id','')
        password=data.get('password','')
        if not isinstance(username,str) or not re.fullmatch(r'[A-Za-z0-9_-]{3,24}',username):
            raise ValueError('ID must be 3–24 characters using letters, numbers, _ or -.')
        if not isinstance(password,str):
            raise ValueError('Password must be text.')
        return username,password

    @staticmethod
    def remote_ip(environ):
        value=environ.get('HTTP_CF_CONNECTING_IP') or environ.get('REMOTE_ADDR','')
        try:return str(ipaddress.ip_address(value.strip()))
        except ValueError:return 'unknown'

    def auth(self,path,data,environ):
        if path=='/api/auth/register':
            username,password=self.validate_account(data)
            source=self.remote_ip(environ);now=time.monotonic()
            events=[t for t in self.registration_events.get(source,[]) if now-t<3600]
            if len(events)>=5:raise ValueError('Too many new accounts from this connection. Try again later.')
            old_token,session=self.session(environ)
            with session['lock']:
                if session.get('account_id'):raise ValueError('Sign out before creating a different account.')
                display=data.get('name','Player')
                if not isinstance(display,str) or not 1<=len(display.strip())<=24:raise ValueError('Player name must be 1–24 characters.')
                if not session.get('career'):session['career']=self.new_career(display.strip())
                account_token=secrets.token_urlsafe(32)
                canonical=self.store.create_account(username,password,account_token,old_token,session)
                session['account_id']=canonical
                with self.lock:
                    self.sessions.pop(old_token,None);self.sessions[account_token]=session
                self.registration_events[source]=events+[now]
                return account_token,self.state(session)
        if path=='/api/auth/login':
            username,password=self.validate_account(data)
            source=self.remote_ip(environ);now=time.monotonic();key=(source,username.casefold())
            source_key=(source,'*')
            with self.auth_lock:
                attempts=[t for t in self.auth_failures.get(key,[]) if now-t<900]
                source_attempts=[t for t in self.auth_failures.get(source_key,[]) if now-t<900]
                if len(attempts)>=8 or len(source_attempts)>=40:raise ValueError('Too many sign-in attempts. Try again in 15 minutes.')
                self.auth_failures[key]=attempts+[now]
                self.auth_failures[source_key]=source_attempts+[now]
            authenticated=self.store.authenticate(username,password)
            if not authenticated:raise ValueError('ID or password is incorrect.')
            canonical,account_token=authenticated
            with self.auth_lock:self.auth_failures.pop(key,None)
            account_token,session=self.session_for_token(account_token)
            with session['lock']:
                session['account_id']=canonical
                return account_token,self.state(session)
        if path=='/api/auth/logout':
            cookie=SimpleCookie()
            try:cookie.load(environ.get('HTTP_COOKIE',''))
            except Exception:pass
            old_token=cookie[COOKIE].value if COOKIE in cookie else None
            if old_token:
                _,old=self.session_for_token(old_token)
                with old['lock']:old['seen']=0
            token,session=self.session_for_token()
            return token,self.state(session)
        raise ValueError('Unknown account action.')

    def autoplay(self, session, frames=None):
        game = session['game']
        roster=table_roster(session['hero'],session.get('lineup'))
        traits=[p.traits if p else NEUTRAL for p in roster]
        identities=self.identities(session)
        session['learning_decisions']=[]
        while not game.done and (session.get('mode')=='sim' or game.actor != session['hero']):
            from .texas_solver_bot import SolverPending
            try:
                row, _ = session['strategy'].advise(game,traits[game.actor],[NEUTRAL]*game.seat_count)
                reference, source = self.coach.reference(session['strategy'],game)
            except SolverPending:break
            adjusted, reads = self.memory.adjust(game,identities,row,traits[game.actor])
            adjusted, coaching = self.coach.prepare(game,identities,adjusted,reference,source)
            chosen = choose(adjusted, session['rng'])
            session['learning_decisions'].append(decision_record(game,identities,row,adjusted,reads,chosen))
            apply_label(game, chosen)
            self.coach.record(coaching,chosen)
            if frames is not None:
                import copy
                frames.append(copy.deepcopy(self.state(session)))

    @staticmethod
    def identities(session):
        return ['bot:' + p.id if p else session['opponent_id']
                for p in table_roster(session['hero'], session.get('lineup'))]

    def learn(self, session):
        game = session['game']
        identities = self.identities(session)
        self.memory.record_decisions(session.pop('learning_decisions', []))
        self.memory.observe(hand_identity(game, identities), game, identities)

    def state(self, session):
        game = session['game']
        extra={'mode':session.get('mode','study'),'career':self.profile(session),'notice':session.get('notice',''),'account':{'id':session['account_id']} if session.get('account_id') else None,'bet_limits':session.get('bet_limits',{'min':100,'max':10000})}
        if game is None: return {'game':None, 'version':VERSION,'players':table_public(session['hero'],session.get('lineup')),**extra}
        view = game.view(session['hero'])
        if session.get('mode')=='sim':view['hole']=[]
        limits=extra['bet_limits']
        if view['legal'].get('raise_min') is not None:
            view['legal']['raise_min']=max(view['legal']['raise_min'],limits['min'])
            view['legal']['raise_max']=min(view['legal']['raise_max'],limits['max'])
            if view['legal']['raise_min']>view['legal']['raise_max']:view['legal']['raise_min']=view['legal']['raise_max']=None
        view.update({'done':game.done, 'hero':session['hero'], 'hand_number':session['number'],
            'button':game.config.button, 'big_blind':game.config.big_blind,
            'positions':[game.position(i) for i in range(6)], 'total':game.total,
            'history':game.history, 'net':game.stacks[session['hero']]-game.config.stacks[session['hero']] if game.done else None,
            'showdown':{str(i):game.holes[i] for i in game.live()} if game.done and len(game.live())>1 else {},
            'actions':list(actions(game)) if not game.done else [],
            'bot_thinking':not game.done and (session.get('mode')=='sim' or game.actor!=session['hero']),
            'imported_states':len(session['strategy'].rows)})
        return {'game':view, 'version':VERSION,'players':table_public(session['hero'],session.get('lineup')),**extra}

    @staticmethod
    def new_career(name):
        return {'profile_id':'player-'+secrets.token_hex(10),'name':name,'stacks':[10000]*6,'button':5,'lineup':[p.id if p else None for p in seats(3)],'hands':0,'wins':0,'net':0,'buyins':1,'best':10000}

    @staticmethod
    def profile(session):
        c=session.get('career')
        if not c:return None
        return {k:c[k] for k in ('name','hands','wins','net','buyins','best')} | {'stack':c['stacks'][3],'reloads':max(0,c.get('buyins',1)-1)}

    def settle(self,session):
        game=session['game']
        if session.get('mode')!='grind' or not game.done or session.get('settled_number')==session['number']:return
        c=session['career'];net=game.stacks[3]-game.config.stacks[3]
        self.profiles.record(c['profile_id'],c['hands']+1,{
            'table':'practice','pot':sum(game.total),'net':net,'board':game.board.copy(),
            'hole':list(game.holes[3]),'actions':list(game.history),'awards':list(game.awards),
            'players':[p['name'] if p else c['name'] for p in table_public(3,session['lineup'])],
            'final_stack':game.stacks[3],
        })
        c['hands']+=1;c['wins']+=int(net>0);c['net']+=net
        c['stacks']=game.stacks.copy();c['button']=game.config.button;c['lineup']=session['lineup'].copy()
        c['best']=max(c['best'],game.stacks[3]);session['settled_number']=session['number']

    def api(self, path, data, session):
        if path == '/api/bot-coach':
            from .league_roster import LEAGUE_POOL
            return self.coach.report(LEAGUE_POOL)
        if path == '/api/texas-solver/status': return self.texas_solver.status(session)
        if path in ('/api/texas-solver/result', '/api/texas-solver/download'): return self.texas_solver.result(session)
        if path == '/api/texas-solver/solve':
            try: return self.texas_solver.start(session, data)
            except ValueError as error: return {'status': 'rejected', 'error': str(error)}
        if path == '/api/leaderboard':
            players=self.store.standings()
            if self.league:
                players.extend({key:player[key] for key in ('name','hands','wins','profit','rebuys')} | {'id':'bot:'+player['id'],'kind':'Bot'} for player in self.league.snapshot()['leaderboard'] if player['hands']>0)
            players.sort(key=lambda player:(-player['profit'],-player['wins'],player['name'].casefold()))
            return {'players':players,'ranking':'Total profit (BB)'}
        if path.startswith('/api/players/'):
            parts=path.split('/')
            if len(parts) not in (4,6) or len(parts)==6 and parts[4]!='hands':raise ValueError('Unknown player profile.')
            profile_id=parts[3]
            if not re.fullmatch(r'(?:bot:[a-z0-9-]+|player-[a-f0-9]{20})',profile_id):raise ValueError('Unknown player profile.')
            offset=int(parts[5]) if len(parts)==6 and parts[5].isdigit() else 0
            if profile_id.startswith('bot:'):
                if not self.league:raise ValueError('Unknown player profile.')
                with self.league.lock:
                    b=self.league.state['bots'].get(profile_id[4:])
                    if not b:raise ValueError('Unknown player profile.')
                    player={'id':profile_id,'name':b['name'],'kind':'Bot','hands':b['hands'],
                            'wins':b['wins'],'profit':b['profit'],'rebuys':b['rebuys'],
                            'style':b['style'],'avatar':b['avatar']}
            else:
                player=self.store.public_profile(profile_id)
                if not player:raise ValueError('Unknown player profile.')
            return {'player':player,**self.profiles.read(profile_id,offset)}
        if path == '/api/state': return self.state(session)
        if path == '/api/league':return self.league.snapshot() if self.league else {'tables':[],'leaderboard':[],'hands_completed':0,'rotations':0,'waiting':[]}
        if path == '/api/ranges': return {'ranges':RANGES, 'source':'Illustrative raise-first-in ranges. Not solver-derived.'}
        if path == '/api/profile':
            name=data.get('name','Player')
            if not isinstance(name,str) or not 1<=len(name.strip())<=24:raise ValueError('Name must be 1-24 characters.')
            if not session.get('career'):session['career']=self.new_career(name.strip())
            session['career']['name']=name.strip()
            return self.state(session)
        if path == '/api/rebuy':
            career=session.get('career')
            if not career or career['stacks'][3]>0 or (session['game'] and not session['game'].done):raise ValueError('Reload only after busting.')
            career['stacks'][3]=10000;career['buyins']+=1
            return self.state(session)
        if path == '/api/new':
            import copy
            mode=data.get('mode','study')
            if mode not in ('study','grind','sim'):raise ValueError('Unknown table mode.')
            if session['game'] and not session['game'].done and session.get('mode') in ('grind','sim'):raise ValueError('Finish your current hand first.')
            stack, hero = data.get('stack_bb',100), data.get('hero',3)
            previous_limits=session.get('bet_limits',{'min':100,'max':10000})
            min_bet,max_bet=data.get('min_bet',previous_limits['min']),data.get('max_bet',previous_limits['max'])
            if type(stack) is not int or not 20 <= stack <= 300: raise ValueError('Stack must be 20-300 BB.')
            if type(min_bet) is not int or type(max_bet) is not int or not 100<=min_bet<=max_bet<=30000:raise ValueError('Bet limits must be 100-30,000 chips, with minimum no greater than maximum.')
            if type(hero) is not int or not 0 <= hero < 6: raise ValueError('Choose a seat from 0 to 5.')
            button = data.get('button', 0)
            if type(button) is not int or not 0 <= button < 6: raise ValueError('Invalid button.')
            candidate=dict(session);candidate['career']=copy.deepcopy(session.get('career'))
            candidate['notice']='';candidate['bet_limits']={'min':min_bet,'max':max_bet}
            if mode=='grind':
                if not candidate['career']:candidate['career']=self.new_career('Player')
                career=candidate['career'];hero=3
                # Top up losses; never remove the player's accumulated winnings.
                if career['stacks'][hero]<10000:
                    career['buyins']+=1
                    career['stacks'][hero]=10000
                if career['stacks'][hero]<=0:raise ValueError('Reload 10,000 chips to continue.')
                stacks=career['stacks'].copy();button=(career['button']+1)%6
                candidate['lineup']=career['lineup'].copy()
            elif mode=='sim' and session.get('mode')=='sim':
                stacks=session['game'].stacks.copy();button=(session['game'].config.button+1)%6
                candidate['lineup']=session['lineup'].copy();hero=3
            else:
                stacks=[stack*100]*6
                candidate['lineup']=[p.id if p else None for p in seats(hero)]
                if mode=='sim':candidate['lineup'][hero]='jules'
            if mode!='study':
                eligible=[i for i in range(6) if mode=='sim' or i!=hero]
                leaving=[i for i in eligible if stacks[i]<=0]
                notices=[]
                for i in eligible:
                    if stacks[i]>=50000:
                        stacks[i]=10000
                        name=next(p.name for p in POOL if p.id==candidate['lineup'][i])
                        notices.append(name+' cashed out at 500 BB or more and returned with 100 BB.')
                for i in set(leaving):
                    incoming=session['rng'].choice([p for p in POOL if p.id not in candidate['lineup']])
                    old=next(p.name for p in POOL if p.id==candidate['lineup'][i])
                    candidate['lineup'][i]=incoming.id;stacks[i]=10000
                    notices.append(old+' left; '+incoming.name+' joined with 10,000 chips.')
                candidate['notice']=' '.join(notices)
            candidate['hero'],candidate['number'],candidate['mode']=hero,session['number']+1,mode
            candidate['game']=Game(Config(stacks=stacks,button=button,seed=secrets.randbits(64)))
            frames=[copy.deepcopy(self.state(candidate))]
            self.autoplay(candidate,frames);self.settle(candidate)
            session.update({k:candidate[k] for k in ('hero','number','mode','game','career','lineup','notice','bet_limits')})
            session['settled_number']=candidate.get('settled_number')
            self.learn(candidate)
            return {**self.state(session),'frames':frames}
        if path == '/api/strategy':
            policy = Strategy(data=data,equity_learner=self.equity_learner,texas_solver=self.texas_bot,wait_for_solver=True)
            if len(policy.rows)>2000: raise ValueError('Maximum 2,000 imported states in the basic web app.')
            # Validate the current matching row before replacing the active policy.
            if session['game'] and not session['game'].done: policy.advise(session['game'],wait_for_solver=False)
            session['strategy'] = policy
            return {'message':f'Loaded {len(policy.rows)} strategy states.', **self.state(session)}
        if path == '/api/replay':
            if not isinstance(data.get('actions'),list) or len(data['actions'])>200: raise ValueError('Replay must contain at most 200 actions.')
            game, frames = replay_data(data)
            return {'frames':frames, 'finished':game.done}
        game = session['game']
        if game is None: raise ValueError('Deal a hand first.')
        if path == '/api/history':
            return {'version':1,'config':asdict(game.config),'deck':game.initial_deck,'actions':game.history,'final_stacks':game.stacks,'players':table_public(session['hero'],session.get('lineup')),'policy_version':VERSION}
        if game.done: raise ValueError('This hand is over. Deal the next hand.')
        if path == '/api/bot-step':
            import copy
            frames=[]
            self.autoplay(session,frames)
            self.settle(session);self.learn(session)
            return {**self.state(session),'frames':frames}
        if path == '/api/action':
            if session.get('mode')=='sim' or game.actor!=session['hero']:
                raise ValueError('Wait for the bot to finish its turn.')
            label = data.get('action','')
            if not isinstance(label,str) or len(label)>40: raise ValueError('Invalid action.')
            if label.startswith('raise:'):
                try:amount=int(label.split(':',1)[1])
                except ValueError:raise ValueError('Invalid raise amount.')
                limits=session.get('bet_limits',{'min':100,'max':10000})
                if not limits['min']<=amount<=limits['max']:raise ValueError(f"Raise must be between {limits['min']:,} and {limits['max']:,} chips.")
            # Apply a request to a clone so an invalid imported bot row cannot leave
            # the real hand half-advanced after a failed request.
            import copy
            candidate = dict(session)
            candidate['game'] = copy.deepcopy(game)
            apply_label(candidate['game'], label)
            frames = [copy.deepcopy(self.state(candidate))]
            self.autoplay(candidate, frames)
            session['game'] = candidate['game']
            self.settle(session)
            self.learn(candidate)
            return {**self.state(session), 'frames':frames}
        if path in ('/api/hint','/api/spot','/api/equity') and (session.get('mode')=='sim' or game.actor!=session['hero']):
            raise ValueError('Study tools are available on your turn.')
        if path == '/api/hint':
            row, source = session['strategy'].advise(game,wait_for_solver=False)
            return {'probabilities':row, 'source':source}
        if path == '/api/spot':
            row, source = session['strategy'].advise(game,wait_for_solver=False)
            return {'version':1,'key_format':'exact-local-v1','source':source,'states':{key(game):row}}
        if path == '/api/equity':
            if not self.equity_slot.acquire(blocking=False): raise ValueError('Equity calculator is busy. Try again in a moment.')
            try: return equity(game.holes[session['hero']],game.board,len(game.live())-1,250,secrets.randbits(32))
            finally: self.equity_slot.release()
        raise ValueError('Unknown study command.')

    def __call__(self, environ, start_response):
        headers = [('X-Content-Type-Options','nosniff'),('Referrer-Policy','same-origin'),
            ('Content-Security-Policy',"default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-src https://ops.northstarenergy.ca; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"),
            ('Cache-Control','no-store')]
        def respond(status, payload, mime='application/json; charset=utf-8'):
            body = payload if isinstance(payload,bytes) else json.dumps(payload).encode()
            start_response(status,headers+[('Content-Type',mime),('Content-Length',str(len(body)))])
            return [body]
        try:
            host = environ.get('HTTP_HOST','').lower()
            if host.split(':')[0] not in HOSTS: return respond('403 Forbidden',{'error':'Unknown host.'})
            path, method = environ.get('PATH_INFO','/'), environ.get('REQUEST_METHOD','GET')
            if path == '/api/health' and method == 'GET': return respond('200 OK',{'app':'northstar-games','version':VERSION,'status':'ok','bot_learning':self.equity_learner.status() if self.equity_learner else None,'texas_bot':self.texas_bot.status() if self.texas_bot else None})
            if method == 'GET' and path in ('/texas-solver.js', '/texas-solver.css', '/bot-coach.js', '/bot-coach.css'):
                return respond('200 OK', (ROOT / path[1:]).read_bytes(), 'application/javascript' if path.endswith('.js') else 'text/css')
            if method == 'GET' and path in ('/invitations.js','/invitations.css','/vendor/stockfish/stockfish-18-lite-single.js','/vendor/stockfish/stockfish-18-lite-single.wasm','/vendor/stockfish/COPYING','/northstar-chat-launcher.js','/northstar-chat-launcher.css','/poker.html','/blackjack.html','/blackjack.css','/blackjack-engine.js','/blackjack-ui.js','/classics.html','/classics-shell.css','/classics-shell.js','/games-engine.js','/games-workspace.js','/games-workspace.css','/vendor/chess/chess.js','/vendor/chess/LICENSE.txt','/hub.css','/','/app.css','/app.js','/favicon.svg','/manifest.webmanifest','/sw.js','/offline.html','/icon-180.png','/icon-192.png','/icon-512.png'):
                file = ROOT / ('index.html' if path=='/' else path[1:])
                return respond('200 OK', file.read_bytes(), ('application/wasm' if path.endswith('.wasm') else 'text/plain' if path=='/vendor/stockfish/COPYING' else 'application/manifest+json' if path=='/manifest.webmanifest' else 'application/javascript' if path=='/sw.js' else mimetypes.guess_type(file)[0] or 'application/octet-stream'))
            if method == 'GET' and path in {f'/assets/avatars/classic/classic-{i:02d}.png' for i in range(45)}:
                return respond('200 OK', (ROOT / path[1:]).read_bytes(), 'image/png')
            if method=='GET' and path in {'/avatars/'+p.id+'.svg' for p in POOL}:
                return respond('200 OK',(ROOT/path[1:]).read_bytes(),'image/svg+xml')
            if not path.startswith('/api/'): return respond('404 Not Found',{'error':'Not found.'})
            reads = {'/api/bot-coach','/api/invites','/api/state','/api/ranges','/api/history','/api/league','/api/leaderboard'}
            reads.update({'/api/texas-solver/status', '/api/texas-solver/result', '/api/texas-solver/download'})
            if path.startswith('/api/players/'):reads.add(path)
            if method != ('GET' if path in reads else 'POST'): return respond('405 Method Not Allowed',{'error':'Method not allowed.'})
            data = {}
            if method == 'POST':
                origin = environ.get('HTTP_ORIGIN','')
                if origin and (urlsplit(origin).netloc.lower()!=host or urlsplit(origin).scheme not in ('http','https')):
                    return respond('403 Forbidden',{'error':'Cross-origin request refused.'})
                if environ.get('HTTP_SEC_FETCH_SITE') == 'cross-site': return respond('403 Forbidden',{'error':'Cross-site request refused.'})
                if environ.get('CONTENT_TYPE','').split(';')[0] != 'application/json': return respond('415 Unsupported Media Type',{'error':'JSON required.'})
                size = int(environ.get('CONTENT_LENGTH') or '0')
                if not 0 <= size <= 1048576: return respond('413 Payload Too Large',{'error':'Maximum upload is 1 MB.'})
                data = json.loads(environ['wsgi.input'].read(size) or b'{}')
                if not isinstance(data,dict): raise ValueError('Expected a JSON object.')
            if path in {'/api/auth/register','/api/auth/login','/api/auth/logout'}:
                if method!='POST':return respond('405 Method Not Allowed',{'error':'Method not allowed.'})
                try:token,result=self.auth(path,data,environ)
                except ValueError as error:return respond('400 Bad Request',{'error':str(error)})
                secure='; Secure' if host.split(':')[0]=='games.northstarenergy.ca' else ''
                headers.append(('Set-Cookie',f'{COOKIE}={token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=31536000{secure}'))
                return respond('200 OK',result)
            token, session = self.session(environ)
            secure = '; Secure' if host.split(':')[0] == 'games.northstarenergy.ca' else ''
            headers.append(('Set-Cookie',f'{COOKIE}={token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=31536000{secure}'))
            if path == '/api/invites' or path.startswith('/api/invites/'):
                try:
                    if path == '/api/invites': result = self.invitations.overview(token)
                    elif path == '/api/invites/create':
                        origin = 'https://games.northstarenergy.ca' if host.split(':')[0] == 'games.northstarenergy.ca' else 'http://' + host
                        result = self.invitations.create(token, origin)
                    elif path == '/api/invites/preview': result = self.invitations.preview(data.get('token'))
                    elif path == '/api/invites/accept':
                        with session['lock']: result = self.invitations.accept(token, data.get('token'))
                    elif path == '/api/invites/revoke': result = self.invitations.revoke(token, data.get('id'))
                    else: return respond('404 Not Found', {'error': 'Not found.'})
                except ValueError as error: return respond('400 Bad Request', {'error': str(error)})
                return respond('200 OK', result)
            with session['lock']:
                result = self.api(path,data,session)
                if method=='POST':self.store.save(token,session)
            if path == '/api/texas-solver/download':
                headers.append(('Content-Disposition','attachment; filename="northstar-texassolver-result.json"'))
            return respond('200 OK',result)
        except (ValueError,TypeError,KeyError,IndexError,AttributeError,OverflowError):
            return respond('400 Bad Request',{'error':'Invalid request or unavailable action. Check your input and try again.'})

app = App(ROOT.parent.parent/'data'/'careers.sqlite3',enable_league=True)

def main():
    parser=argparse.ArgumentParser(description='NorthStar Games loopback web origin')
    parser.add_argument('--port',type=int,default=4185)
    args=parser.parse_args()
    try: from waitress import serve
    except ImportError: parser.exit(2,'Install the web dependency: python -m pip install "waitress>=3,<4"\n')
    print(f'NorthStar Games: http://127.0.0.1:{args.port}',flush=True)
    serve(app,host='127.0.0.1',port=args.port,threads=8,max_request_body_size=1048576,channel_timeout=30)

if __name__ == '__main__': main()
