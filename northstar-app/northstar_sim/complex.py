"""Source-inspired, simulation-only multi-unit complex session."""
from __future__ import annotations
import copy, math, secrets
from types import SimpleNamespace
from .engine import Session, SimError, TICK_MS
from .model import content_hash
from .complex_electrical import solve_complex, clip

MODEL_ID='SIM-TWIN-IROQUOIS'
def approach(value,target,step):return value+clip(target-value,-step,step)
def angle(target,actual):return (target-actual+180)%360-180

class ComplexSession(Session):
    def __init__(self,model,scenario,owner,seed,rules=None,unit_sequence=None,local_instructor=False):
        self.model=copy.deepcopy(model);self.model_hash=content_hash(model)
        self.scenario=copy.deepcopy(scenario);self.scenario_hash=content_hash(scenario)
        self.rule_data={'schemaVersion':'complex-controls.v1','assumptions':model['assumptions']};self.rule_hash=content_hash(self.rule_data)
        self.unit_sequence={'sequenceId':'complex-sequences-v1','generatorBreakerId':None,'assumptions':{'minReactiveMvar':-3,'maxReactiveMvar':3}}
        self.unit_hash=content_hash({'sequences':self.unit_sequence,'equipment':model['equipment']})
        self.rule_runtime=SimpleNamespace(since={},clear_since={},latched=set())
        self.owner=owner;self.seed=int(seed);self.instructor_enabled=bool(local_instructor)
        self.session_id=secrets.token_urlsafe(18);self.run_id=secrets.token_urlsafe(12)
        self.sim_time_ms=0;self.state_revision=0;self.control_revision=1;self.sequence=0;self.speed=1;self.status='paused'
        self.events=[];self.commands={};self.selections={};self.pending=[];self.idempotency={};self.observations={};self.truth={}
        self.faults={};self.active_faults={};self.scenario_injections=[];self.alarm_occurrences=[];self.alarm_active=False
        self.low_voltage_since=None;self.low_voltage_clear_since=None;self.debriefs=[]
        self._initial_state();self._emit('session_created',{'modelId':model['modelId'],'readiness':model['readiness']});self._settle()

    def _initial_state(self):
        self.states={d['equipmentId']:copy.deepcopy(d['initialState']) for d in self.model['equipment']}
        for o in self.scenario.get('initialOverrides',[]):self.states[o['equipmentId']][o['field']]=copy.deepcopy(o['value'])
        for d in self.model['equipment']:
            s=self.states[d['equipmentId']]
            if 'position' in s:s['reportedPosition']=s['position']
        self.unit={'busMemory':{},'milestones':{},'previousGrid':None}

    def _generators(self):return [d for d in self.model['equipment'] if d['type']=='generator']
    def _node(self,n):return self.truth.get('electrical',{}).get('nodes',{}).get(n,{'voltagePu':0,'frequencyHz':0,'phaseDegrees':0,'energization':'deenergized'})
    def _has_aux(self,station,bootstrap=False):
        dc=self.states[station+'-DC']['available']
        lube=any(self.states[station+'-'+x]['running'] for x in ['LUBE1','LUBE2'])
        ss=any(self._node(station+'-SS'+str(i))['voltagePu']>.8 for i in [1,2])
        if bootstrap:return dc and self.states[station+'-DC-LUBE']['running']
        return dc and ss and lube and self.states[station+'-WATER']['running']

    def actions(self,d):
        kind=d['type']
        if kind=='generator':
            a=['start','stop','emergency_stop','cancel_start','setpoint','set_gate','mode_power','mode_position','mode_condense',
               'avr_raise','avr_lower','set_mvar','excitation_avr','excitation_var','sync_auto','sync_manual','speed_raise','speed_lower','reset_86','reset_94']
            if d['parameters']['blackStartCapable']:a+=['black_start','blackstart_auto','blackstart_manual','frequency_support_on','frequency_support_off']
            if d['parameters']['station']=='IR':a.remove('mode_condense')
            if d['parameters']['station']=='IR' and d['parameters']['unitNumber']>=11:
                a=[x for x in a if x not in {'set_gate','mode_position','mode_power','set_mvar','excitation_var','sync_manual','speed_raise','speed_lower'}]
            return a
        if kind in {'breaker','isolator','earth_switch'}:return ['open','close','close_dead','synchronize','cancel_sync','reset_lockout'] if kind=='breaker' else ['open','close']
        if kind=='transformer_2w' and d['parameters'].get('tapCapable'):return ['tap_raise','tap_lower','mode_auto','mode_manual','parallel_enable','parallel_disable']
        if kind=='spill_gate':return ['set_spill','stop','enable','disable']
        if kind=='auxiliary':return ['start','stop','mode_auto','mode_manual']
        if kind=='transfer_controller':return ['mode_auto','mode_manual','prefer_1','prefer_2','retransfer_enable','retransfer_disable']
        return []

    def sync_detail(self,d):
        if len(d['terminals'])!=2:return {}
        a,b=[self._node(t['nodeId']) for t in d['terminals']]
        live_a=a['voltagePu']>.1;live_b=b['voltagePu']>.1
        return dict(lineLive=live_a,busLive=live_b,frequencyDifferenceHz=abs(a['frequencyHz']-b['frequencyHz']),
            phaseDifferenceDegrees=abs(angle(a['phaseDegrees'],b['phaseDegrees'])),voltageDifferencePu=abs(a['voltagePu']-b['voltagePu']),
            lineFrequencyHz=a['frequencyHz'],busFrequencyHz=b['frequencyHz'],lineVoltageKV=a.get('voltageKVLL',0),busVoltageKV=b.get('voltageKVLL',0),
            sameIsland=a.get('islandId')==b.get('islandId'),synchronizing=self.states[d['equipmentId']].get('synchronizing',False))

    def _permissives(self,d,action,completing=False):
        s=self.states[d['equipmentId']];p=d['parameters'];kind=d['type'];id=d['equipmentId'];fail=[]
        def no(code,msg):fail.append(dict(code=code,message=msg))
        if action not in self.actions(d):return [dict(code='UNSUPPORTED_ACTION',message='No such control on this equipment')]
        if self.status!='running':no('SESSION_NOT_RUNNING','Run the exercise before issuing controls')
        if not s.get('remote',True):no('LOCAL_CONTROL','Local control selected')
        station=p.get('station') or ('TF' if id.startswith('TF-') else 'IR')
        if not s.get('dc',True) or not self.states[station+'-DC']['available']:no('DC_UNAVAILABLE','Control DC unavailable')
        if not completing and action!='emergency_stop' and any(x['equipmentId']==id for x in self.pending):no('DEVICE_BUSY','Previous command still in progress')
        if kind=='generator':
            seq=s['sequenceState'];gb=self.states[p['breaker']]
            if action in {'start','black_start'}:
                if seq!='STOPPED':no('UNIT_NOT_STOPPED','Unit must be stopped')
                if s['lockout86'] or s['lockout94'] or gb['lockout']:no('LOCKOUT_ACTIVE','Unit or breaker lockout active')
                if gb['position']!='open':no('BREAKER_NOT_OPEN','Generator breaker must be open')
                if not self._has_aux(station,action=='black_start'):no('AUX_UNAVAILABLE','Required service, DC, lube or cooling supply unavailable')
                if action=='black_start':
                    if any(self.states[x]['position']!='open' for x in ['TF-52L1','TF-52L2']):no('PLANT_NOT_ISOLATED','Both Twin line breakers must be open for this modeled black-start sequence')
                    if self._node(p['bus'])['voltagePu']>.1:no('BUS_LIVE','Use normal start/synchronize onto an energized bus')
            if action in {'stop','cancel_start'} and seq not in {'STARTING','READY','ONLINE','STOPPING'}:no('UNIT_NOT_RUNNING','Unit is not in a running sequence')
            if action=='cancel_start' and seq not in {'STARTING','READY'}:no('START_NOT_ACTIVE','No starting sequence to cancel')
            if action in {'setpoint','set_gate','set_mvar','mode_power','mode_position','mode_condense'} and seq!='ONLINE':no('UNIT_NOT_ONLINE','Unit must be online for this control')
            if action in {'speed_raise','speed_lower'} and (seq!='READY' or s['syncMode']!='manual'):no('MANUAL_SYNC_REQUIRED','Speed trim requires READY and manual synchronizing mode')
            if action in {'reset_86','reset_94'}:
                if gb['position']!='open':no('BREAKER_NOT_OPEN','Reset requires open generator breaker')
                if not self._has_aux(station):no('CAUSE_ACTIVE','Restore auxiliary supplies before reset')
                if not s['lockout'+action[-2:]]:no('NO_LOCKOUT','This lockout is clear')
        if kind in {'breaker','isolator','earth_switch'}:
            closing=action in {'close','close_dead'}
            if action=='open' and s['position']=='open':no('ALREADY_OPEN','Already open')
            if closing and s['position']=='closed':no('ALREADY_CLOSED','Already closed')
            if closing and s['lockout']:no('LOCKOUT_ACTIVE','Breaker lockout active')
            if closing and s.get('quality')!='good':no('INDICATION_UNAVAILABLE','Good switch indication is required before closure')
            details=self.sync_detail(d)
            if kind=='earth_switch' and closing and (details['lineLive'] or details['busLive']):no('BUS_LIVE','Grounding requires both sides de-energized')
            if kind=='isolator' and action in {'open','close'}:
                associated=id.replace('-89-','-52-')
                if associated in self.states and self.states[associated]['position']=='closed':no('LOAD_BREAK_NOT_PERMITTED','Open the associated breaker before operating this isolator')
                if id in {'IR-89-T5','IR-89-T6'} and self.states['IR-52-7' if id.endswith('T5') else 'IR-52-8']['position']=='closed':no('LOAD_BREAK_NOT_PERMITTED','Open the associated LV breaker first')
            if closing and kind!='earth_switch':
                # Evaluate the proposed connected component, not only immediate ground symbols.
                test=copy.deepcopy(self.states);test[id]['position']='closed'
                candidate=solve_complex(self.model,test,self.unit['busMemory'])
                islands={candidate['nodes'][t['nodeId']]['islandId'] for t in d['terminals']}
                if any(g['type']=='earth_switch' and test[g['equipmentId']]['position']=='closed' and candidate['nodes'][g['terminals'][0]['nodeId']]['islandId'] in islands for g in self.model['equipment']):no('GROUND_PRESENT','A connected grounding switch is closed')
            if kind=='breaker' and closing:
                if action=='close_dead':
                    if details['lineLive']==details['busLive']:no('DEAD_BUS_SELECTION','Energize requires exactly one live side and one dead side')
                elif not (details['lineLive'] and details['busLive']):no('LIVE_LIVE_REQUIRED','Select energize dead bus for a live/dead connection')
                elif details['frequencyDifferenceHz']>.15 or details['phaseDifferenceDegrees']>10 or details['voltageDifferencePu']>.05:no('SYNC_CHECK_FAILED','Voltage, frequency or phase outside the modeled sync window')
                if p.get('generatorRef'):
                    g=self.states[p['generatorRef']]
                    if g['sequenceState']!='READY':no('UNIT_NOT_READY','Generator must be ready to synchronize')
                    if action=='close_dead' and not g['blackStart']:no('BLACK_START_REQUIRED','Dead-bus generator closure requires the black-start sequence')
                if id.endswith('52SSBT') and all(self.states[station+'-52SS'+str(i)]['position']=='closed' for i in [1,2]):no('TRANSFER_INTERLOCK','Open one incoming station-service breaker before closing the tie')
                if id.endswith(('52SS1','52SS2')):
                    other=station+'-52SS'+('2' if id.endswith('1') else '1')
                    if self.states[station+'-52SSBT']['position']=='closed' and self.states[other]['position']=='closed':no('TRANSFER_INTERLOCK','Open station-service tie before restoring two sources')
                if '52-89-T' in id and '-LV' in id:
                    other='IR-T7' if 'T4' in id else 'IR-T4'
                    othercb='IR-52-89-'+other[3:]+'-LV'
                    own='IR-T4' if 'T4' in id else 'IR-T7'
                    if self.states[othercb]['position']=='closed' and self.states[other]['tap']!=self.states[own]['tap']:no('TAP_MISMATCH','Parallel transformer taps must match in this training model')
            if action=='synchronize':
                if s['position']!='open' or not(details['lineLive'] and details['busLive']):no('SYNC_SIDES_NOT_LIVE','Synchronizer requires an open breaker with two energized sides')
                if details['sameIsland']:no('ALREADY_SAME_ISLAND','Both sides already share the same electrical island')
            if action=='reset_lockout':
                if not s['lockout']:no('NO_LOCKOUT','Lockout already clear')
                if s['position']!='open':no('BREAKER_NOT_OPEN','Open breaker required')
                if not s.get('mechanismHealthy',True):no('CAUSE_ACTIVE','Mechanism fault remains active')
        if kind=='transformer_2w':
            other='IR-T7' if id=='IR-T4' else 'IR-T4'
            if action=='parallel_enable' and self.states[other]['tap']!=s['tap']:no('TAP_MISMATCH','Match the two tap positions before enabling parallel control')
            if action.startswith('tap_'):
                if s['mode']!='manual':no('MANUAL_REQUIRED','Set OLTC to manual for a raise/lower pulse')
                new=s['tap']+(1 if action=='tap_raise' else -1)
                if not p['tapMin']<=new<=p['tapMax']:no('TAP_LIMIT','Tap travel limit reached')
                if s.get('parallel') and any(x['equipmentId']==other for x in self.pending):no('DEVICE_BUSY','Other parallel tap changer is operating')
        if kind=='spill_gate' and action=='set_spill':
            if not s['enabled'] or s['fault']:no('SPILL_INHIBITED','SCADA disabled or gate fault active')
            if not self._has_aux(station):no('AUX_UNAVAILABLE','Gate power/HPU supply unavailable')
        if kind=='auxiliary' and action=='start' and s['fault']:no('AUX_FAULT','Auxiliary fault remains active')
        return fail

    def select(self,actor,payload):
        d=self._device(str(payload.get('equipmentId','')));action=payload.get('action');value=payload.get('requestedValue')
        specs={'set_gate':('%',0,100),'set_spill':('m',0,d['parameters'].get('maxM',0))}
        if action in specs:
            unit,lo,hi=specs[action]
            if type(value) not in {int,float} or not math.isfinite(value) or not lo<=value<=hi or payload.get('unit')!=unit:
                raise SimError('SETPOINT_OUT_OF_RANGE',f'Enter {lo}..{hi} {unit}')
        if action not in {'set_gate','set_spill','setpoint','set_mvar'} and ('requestedValue' in payload or 'unit' in payload):raise SimError('UNKNOWN_FIELDS','This action takes no setpoint',400)
        return super().select(actor,payload)

    def execute(self,actor,payload):
        if self.status!='running':raise SimError('SESSION_NOT_RUNNING','Run the exercise before executing',409)
        result=super().execute(actor,payload)
        item=next((x for x in self.pending if x['commandId']==result['commandId']),None)
        if item and not item.get('delayAdjusted') and item['action'] in {'close_dead','tap_raise','tap_lower'}:
            delay=800 if item['action']=='close_dead' else 1500
            item['due']=self.sim_time_ms+delay;item['delayAdjusted']=True;self.commands[result['commandId']]['expectedCompletionSimTimeMs']=item['due']
            result['expectedCompletionSimTimeMs']=item['due']
            # Persist the exact response used for idempotent retries.
            key='command:'+payload['idempotencyKey'];fp,_=self.idempotency[key];self.idempotency[key]=(fp,copy.deepcopy(result))
        return result

    def _trip(self,d,cause,emergency=False):
        s=self.states[d['equipmentId']];gb=self.states[d['parameters']['breaker']]
        if s['sequenceState']=='LOCKED_OUT':return
        gb.update(position='open',mechanismState='idle',lockout=True);s.update(sequenceState='LOCKED_OUT',forming=False,lockout86=True,lockout94=emergency,tripCause=cause,mechanicalMW=0,activeMW=0,gate=0)
        self._emit('protection_operated',{'equipmentId':d['equipmentId'],'reason':cause});self._alarm(d['equipmentId']+'-TRIP',True,cause)
        self.control_revision+=1

    def _alarm(self,id,active,message):
        old=next((x for x in reversed(self.alarm_occurrences) if x['alarmId']==id and x['state'].startswith('active')),None)
        if active and not old:
            row=dict(occurrenceId=secrets.token_urlsafe(10),alarmId=id,message=message,severity='warning',state='active_unacknowledged',acknowledged=False,pickedUpAtSimTimeMs=self.sim_time_ms)
            self.alarm_occurrences.append(row);self._emit('alarm_picked_up',{'alarmId':id,'reason':message})
        elif not active and old:
            old['state']='returned_acknowledged' if old['acknowledged'] else 'returned_unacknowledged';old['returnedAtSimTimeMs']=self.sim_time_ms

    def _apply(self,d,action,value=None):
        s=self.states[d['equipmentId']];p=d['parameters'];kind=d['type'];id=d['equipmentId']
        if kind in {'breaker','isolator','earth_switch'}:
            if action in {'open','close','close_dead'}:
                s.update(position='open' if action=='open' else 'closed',mechanismState='idle',synchronizing=False)
                if p.get('generatorRef'):
                    g=self.states[p['generatorRef']]
                    if action!='open':g.update(sequenceState='ONLINE',forming=True,phaseDegrees=self._node(p.get('bus',d['terminals'][-1]['nodeId']))['phaseDegrees']);self.unit['milestones']['unit_online']=True
                    elif g['sequenceState']=='ONLINE':g.update(sequenceState='READY',forming=False,mechanicalMW=0,activeMW=0)
            elif action=='reset_lockout':s['lockout']=False
            else:s['synchronizing']=action=='synchronize'
        elif kind=='generator':
            if action in {'start','black_start'}:
                s.update(sequenceState='STARTING',elapsed=0,blackStart=action=='black_start',tripCause=None,brakesApplied=False)
            elif action in {'stop','cancel_start'}:s.update(sequenceState='STOPPING',elapsed=0,requestedMW=0)
            elif action=='emergency_stop':self._trip(d,'EMERGENCY_STOP',True)
            elif action=='setpoint':s.update(requestedMW=value,governorMode='power')
            elif action=='set_gate':s.update(gateDemand=value/100,governorMode='position')
            elif action=='set_mvar':s.update(requestedMvar=value,excitationMode='var')
            elif action.startswith('mode_'):s['governorMode']=action[5:]
            elif action.startswith('excitation_'):s['excitationMode']=action[11:]
            elif action.startswith('sync_'):s['syncMode']=action[5:]
            elif action.startswith('blackstart_'):s['blackStartMode']=action[11:]
            elif action.startswith('frequency_support_'):s['frequencySupport']=action.endswith('_on')
            elif action.startswith('speed_'):s['speedTrimHz']=clip(s['speedTrimHz']+(.02 if action=='speed_raise' else -.02),-2,2)
            elif action.startswith('avr_'):s['voltageTargetPu']=clip(s['voltageTargetPu']+(.005 if action=='avr_raise' else -.005),.9,1.1)
            elif action.startswith('reset_'):
                s['lockout'+action[-2:]]=False
                if not s['lockout86'] and not s['lockout94']:s.update(sequenceState='STOPPED',tripCause=None,blackStart=False,forming=False);self._alarm(id+'-TRIP',False,'')
        elif kind=='transformer_2w':
            other=self.states['IR-T7' if id=='IR-T4' else 'IR-T4']
            if action.startswith('parallel_'):
                s['parallel']=other['parallel']=action=='parallel_enable'
                if s['parallel']:other['mode']=s['mode']
            elif action.startswith('mode_'):
                s['mode']=action[5:]
                if s.get('parallel'):other['mode']=s['mode']
            else:
                s['tap']+=1 if action=='tap_raise' else -1
                if s.get('parallel'):other['tap']=s['tap']
        elif kind=='spill_gate':
            if action=='set_spill':s.update(targetM=value,stopped=False)
            elif action=='stop':s.update(targetM=s['positionM'],stopped=True)
            else:s['enabled']=action=='enable'
        elif kind=='auxiliary':
            if action.startswith('mode_'):s['mode']=action[5:]
            else:s['requested']=action=='start'
        elif kind=='transfer_controller':
            if action.startswith('mode_'):s['mode']=action[5:]
            elif action.startswith('prefer_'):s['preferred']=int(action[-1])
            else:s['retransfer']=action=='retransfer_enable'

    def _assist_sync(self,dt):
        for d in self._generators():self.states[d['equipmentId']]['syncBiasHz']=0
        for d in self.model['equipment']:
            s=self.states[d['equipmentId']]
            if not s.get('synchronizing'):continue
            a,b=[self._node(t['nodeId']) for t in d['terminals']]
            if a['voltagePu']<.1 or b['voltagePu']<.1:s['synchronizing']=False;continue
            moving,target=(b,a) if a.get('gridConnected') else (a,b)
            if moving.get('gridConnected'):continue
            bias=target['frequencyHz']-60+clip(angle(target['phaseDegrees'],moving['phaseDegrees'])*.012,-.12,.12)
            for g in self._generators():
                gs=self.states[g['equipmentId']]
                if self._node(g['terminals'][0]['nodeId']).get('islandId')==moving.get('islandId'):
                    # Offset the governor's droop error at the present island load.
                    gp=g['parameters']
                    gs['syncBiasHz']=bias+(gs['activeMW']-gs['requestedMW'])*gp['droop']*60/gp['ratedMW']
                    gs['voltageTargetPu']=approach(gs['voltageTargetPu'],target['voltagePu'],.01*dt)

    def _advance_units(self,dt):
        self._assist_sync(dt)
        for d in self._generators():
            id=d['equipmentId'];s=self.states[id];p=d['parameters'];gb=self.states[p['breaker']];station=p['station'];seq=s['sequenceState'];s['elapsed']+=dt
            if seq=='STOPPING' and gb['position']=='open' and s['gate']<.001:
                s['speedRpm']=approach(s['speedRpm'],0,80*dt);s['voltagePu']=approach(s['voltagePu'],0,.5*dt)
                s['mechanicalMW']=0;s['activeMW']=0;s['flowM3S']=0;s['frequencyHz']=s['speedRpm']/5
                if s['speedRpm']==0:
                    s.update(sequenceState='STOPPED',blackStart=False,brakesApplied=True,forming=False)
                    self.unit['milestones']['normal_stop']=True;self.control_revision+=1
                continue
            if seq in {'STARTING','READY','ONLINE','STOPPING'}:
                aux=self._has_aux(station,s['blackStart'] and seq in {'STARTING','READY'})
                s['auxLossSeconds']=0 if aux else s['auxLossSeconds']+dt
                if s['auxLossSeconds']>=3:self._trip(d,'AUXILIARY_SUPPLY_LOST');continue
            if seq=='STARTING':
                s['speedRpm']=approach(s['speedRpm'],300,60*dt);s['voltagePu']=approach(s['voltagePu'],s['voltageTargetPu'],.3*dt)
                s['frequencyHz']=s['speedRpm']/5
                if s['elapsed']>=p['startSeconds']:
                    s.update(sequenceState='READY',elapsed=0,frequencyHz=60);self.control_revision+=1;self._emit('unit_ready',{'equipmentId':id})
            elif seq=='READY':
                bus=self._node(p['bus']);freq=60+s['speedTrimHz']
                if s['syncMode']=='auto' and bus['voltagePu']>.1:
                    freq=bus['frequencyHz']+clip(angle(bus['phaseDegrees'],s['phaseDegrees'])*.012,-.15,.15)
                    s['voltageTargetPu']=approach(s['voltageTargetPu'],bus['voltagePu'],.02*dt)
                s['frequencyHz']=approach(s['frequencyHz'],freq,.15*dt);s['phaseDegrees']=(s['phaseDegrees']+(s['frequencyHz']-60)*360*dt)%360
                s['voltagePu']=approach(s['voltagePu'],s['voltageTargetPu'],.05*dt);s['speedRpm']=s['frequencyHz']*5
                if s['blackStart'] and s['blackStartMode']=='auto' and bus['voltagePu']<.1:
                    breaker=self._device(p['breaker'])
                    if not self._permissives(breaker,'close_dead'):
                        self._queue_automatic(breaker,'close_dead','black_start')
            elif seq in {'ONLINE','STOPPING'}:
                bus=self._node(p['bus']);f=bus['frequencyHz'] or 60
                head=max(.1,self.states[station+'-POND']['headwaterM']-100)
                support=(60+s.get('syncBiasHz',0)-f)*p['ratedMW']/(p['droop']*60) if s.get('frequencySupport',True) else 0
                target=s['requestedMW']+support
                if s['governorMode']=='position':target=s['gateDemand']*p['ratedMW']*(head/20)**1.5
                if s['governorMode']=='condense':target=-.05
                if seq=='STOPPING':target=0
                gate_target=clip(target/p['ratedMW']/(head/20)**1.5,0,1)
                s['gate']=approach(s['gate'],gate_target,.1*dt)
                s['flowM3S']=s['gate']*p['ratedMW']*1e6/(1000*9.81*20*.9)*math.sqrt(head/20)
                s['mechanicalMW']=1000*9.81*s['flowM3S']*head*.9/1e6
                if s['governorMode']=='condense' and seq!='STOPPING':s['mechanicalMW']=-.05
                s['frequencyHz']=f;s['speedRpm']=f*5;s['phaseDegrees']=bus['phaseDegrees']
                s['voltagePu']=bus['voltagePu'] or s['voltageTargetPu']
                bad=f<57.5 or f>62.5
                s['frequencyFaultSeconds']=s['frequencyFaultSeconds']+dt if bad else 0
                if s['frequencyFaultSeconds']>=2:self._trip(d,'ISLAND_FREQUENCY_LIMIT');continue
                s['energyMWh']+=max(0,s['activeMW'])*dt/3600
                if seq=='STOPPING' and s['gate']<.001 and gb['position']=='closed':
                    breaker=self._device(p['breaker'])
                    if not self._permissives(breaker,'open'):self._queue_automatic(breaker,'open','normal_stop')
            else:
                s['speedRpm']=approach(s['speedRpm'],0,80*dt);s['voltagePu']=approach(s['voltagePu'],0,.5*dt)
                s['frequencyHz']=s['speedRpm']/5;s['flowM3S']=0
                if s['speedRpm']==0:s['brakesApplied']=True

    def _advance_water(self,dt):
        for d in self.model['equipment']:
            if d['type']!='spill_gate':continue
            s=self.states[d['equipmentId']];p=d['parameters'];station=p['station']
            if s['enabled'] and not s['fault'] and self._has_aux(station):s['positionM']=approach(s['positionM'],s['targetM'],p['slewMPerS']*dt)
            head=max(0,self.states[station+'-POND']['headwaterM']-100)
            s['flowM3S']=p['flowCoefficient']*s['positionM']*math.sqrt(head)
        for station in ['TF','IR']:
            s=self.states[station+'-POND'];p=self._device(station+'-POND')['parameters']
            turbine=sum(self.states[d['equipmentId']]['flowM3S'] for d in self._generators() if d['parameters']['station']==station)
            spill=sum(self.states[d['equipmentId']]['flowM3S'] for d in self.model['equipment'] if d['type']=='spill_gate' and d['parameters']['station']==station)
            s['storageM3']=max(0,s['storageM3']+(p['inflowM3S']-turbine-spill)*dt)
            s.update(headwaterM=100+s['storageM3']/p['areaM2'],turbineFlowM3S=turbine,spillFlowM3S=spill,totalFlowM3S=turbine+spill)

    def _advance_transfer(self,dt):
        for station in ['TF','IR']:
            t=self.states[station+'-TRANSFER']
            if t['mode']!='auto':continue
            src={i:self._node(f'{station}-SS{i}-SOURCE')['voltagePu']>.8 for i in [1,2]}
            b={i:self.states[f'{station}-52SS{i}'] for i in [1,2]};tie=self.states[station+'-52SSBT']
            target=None;action=None
            for i in [1,2]:
                other=3-i
                if not src[i] and src[other]:
                    if b[i]['position']=='closed':target=f'{station}-52SS{i}';action='open'
                    elif b[other]['position']!='closed':target=f'{station}-52SS{other}';action='close_dead'
                    elif tie['position']=='open':target=station+'-52SSBT';action='close_dead'
            if all(src.values()) and t['retransfer']:
                if tie['position']=='closed':target=station+'-52SSBT';action='open'
                else:
                    for i in [t['preferred'],3-t['preferred']]:
                        if b[i]['position']=='open':target=f'{station}-52SS{i}';action='close_dead';break
            t['timer']=t.get('timer',0)+dt if target else 0
            t['phase']='transferring' if target else 'normal'
            if target and t['timer']>=1 and not self._permissives(self._device(target),action):
                self._queue_automatic(self._device(target),action,'station_service_transfer');t['timer']=0

    def _queue_automatic(self,d,action,purpose):
        delay=d['parameters'].get('openDelayMs' if action=='open' else 'closeDelayMs',800)
        id=secrets.token_urlsafe(14)
        self.commands[id]=dict(commandId=id,equipmentId=d['equipmentId'],action=action,lifecycle='executing',
            source='simulation',purpose=purpose,acceptedAtSimTimeMs=self.sim_time_ms,
            expectedCompletionSimTimeMs=self.sim_time_ms+delay,indicationConfirmed=False)
        self.pending.append(dict(commandId=id,equipmentId=d['equipmentId'],action=action,due=self.sim_time_ms+delay,purpose=purpose))
        self.states[d['equipmentId']]['mechanismState']='opening' if action=='open' else 'closing'
        self.control_revision+=1;self._emit('automatic_command_accepted',{'equipmentId':d['equipmentId'],'action':action,'reason':purpose})

    def _settle(self,dt=0):
        result=solve_complex(self.model,self.states,self.unit['busMemory'],dt)
        self.truth={'electrical':result,'tags':[]}
        # Store island reference phase, not each node's power-flow angle, for integration.
        reference={i['id']:i.get('phaseDegrees',0) for i in result['islands']}
        self.unit['busMemory']={n:{**v,'phaseDegrees':reference[v['islandId']]} for n,v in result['nodes'].items()}
        for id,output in result['generation'].items():self.states[id].update(output)
        for d in self.model['equipment']:
            s=self.states[d['equipmentId']]
            if d['type']=='auxiliary':
                p=d['parameters'];power=self.states[p['station']+'-DC']['available'] if p['battery'] else self._node(p['bus'])['voltagePu']>.8
                s['running']=bool(s['requested'] and not s['fault'] and power)
            if 'position' in s:
                if self.sim_time_ms>=s.get('nextScanMs',0):
                    s['reportedPosition']=s['position'] if s.get('quality')=='good' else None;s['observedSimTimeMs']=self.sim_time_ms;s['nextScanMs']=self.sim_time_ms+500
            if d['type']=='generator':
                kv=next(n['nominalKVLL'] for n in self.model['nodes'] if n['nodeId']==d['terminals'][0]['nodeId'])
                s['currentA']=math.hypot(s['activeMW'],s['reactiveMvar'])*1000/(math.sqrt(3)*max(.1,s['voltagePu']*kv)) if s['sequenceState']=='ONLINE' else 0
        # An open-breaker READY unit is not a station island. Track the units
        # actually supplying buses, so another grid-connected unit cannot satisfy reconnection.
        tracked=self.unit.setdefault('islandedUnits',[])
        for d in self._generators():
            id=d['equipmentId'];s=self.states[id]
            if s['sequenceState']!='ONLINE':continue
            node=result['nodes'][d['parameters']['bus']]
            if node['voltagePu']>.1 and not node['gridConnected']:
                if id not in tracked:tracked.append(id)
                if not self.unit['milestones'].get('island_formed'):self._emit('island_formed',{'equipmentId':id})
                self.unit['milestones']['island_formed']=True
            elif node['gridConnected'] and id in tracked:
                if not self.unit['milestones'].get('reconnected'):self._emit('grid_reconnected',{'equipmentId':id})
                self.unit['milestones']['reconnected']=True
        self.state_revision+=1

    def tick(self):
        self.sim_time_ms+=TICK_MS;dt=TICK_MS/1000
        for item in list(self.pending):
            if item['due']>self.sim_time_ms:continue
            self.pending.remove(item);d=self._device(item['equipmentId']);cmd=self.commands[item['commandId']]
            failures=self._permissives(d,item['action'],True)
            if not self.states[d['equipmentId']].get('mechanismHealthy',True):failures.append(dict(code='MECHANISM_FAILED',message='Mechanism failed to move'))
            if failures:
                cmd.update(lifecycle='failed',failureReason=failures[0]['code']);self.states[d['equipmentId']]['mechanismState']='idle'
                self._emit('command_refused',{'equipmentId':d['equipmentId'],'reason':failures[0]['message']})
            else:
                self._apply(d,item['action'],item.get('requestedValue'));cmd.update(lifecycle='completed',completedAtSimTimeMs=self.sim_time_ms)
                self._emit('command_completed',{'equipmentId':d['equipmentId'],'action':item['action']})
            self.control_revision+=1
            self._settle()
        self._advance_units(dt);self._advance_water(dt);self._settle(dt);self._advance_transfer(dt)
        # Automatic OLTC operations use the same discrete limits and a 3 s dwell.
        for id in ['IR-T4','IR-T7']:
            s=self.states[id];d=self._device(id)
            if id=='IR-T7' and s.get('parallel'):continue
            if s['mode']!='auto':continue
            s['dwell']=s.get('dwell',0)+dt
            if s['dwell']<3:continue
            s['dwell']=0;pu=self._node(d['terminals'][1]['nodeId'])['voltagePu']
            if pu<.1:continue
            step=1 if pu<s['targetPu']-.01 else -1 if pu>s['targetPu']+.01 else 0
            s['tap']=int(clip(s['tap']+step,-8,8))
            if s.get('parallel'):self.states['IR-T7']['tap']=s['tap']
        for id,s in self.states.items():
            if 'reportedPosition' in s:
                for cmd in self.commands.values():
                    if cmd['equipmentId']==id and cmd['lifecycle']=='completed' and cmd['action'] in {'open','close','close_dead'}:
                        expected='open' if cmd['action']=='open' else 'closed'
                        cmd['indicationConfirmed']=s['reportedPosition']==expected and s['quality']=='good' and s.get('observedSimTimeMs',0)>=cmd['completedAtSimTimeMs']

    def snapshot(self):
        devices=[]
        for d in self.model['equipment']:
            s=copy.deepcopy(self.states[d['equipmentId']]);devices.append({**copy.deepcopy(d),**s,'actions':self.actions(d),
                'sync':self.sync_detail(d) if d['type'] in {'breaker','isolator','earth_switch'} else {},
                'indicationQuality':s.get('quality','good'),'indicationObservedSimTimeMs':s.get('observedSimTimeMs',self.sim_time_ms)})
        return dict(source='simulation',complex=True,sessionId=self.session_id,runId=self.run_id,modelId=self.model['modelId'],modelRevision=self.model['revision'],
            modelHash=self.model_hash,scenarioId=self.scenario['scenarioId'],scenarioHash=self.scenario_hash,rulesHash=self.rule_hash,
            unitSequenceHash=self.unit_hash,readiness=self.model['readiness'],stateRevision=self.state_revision,controlRevision=self.control_revision,
            status=self.status,speed=self.speed,simTimeMs=self.sim_time_ms,sessionMode='SOLO LOCAL — LEARNER + INSTRUCTOR' if self.instructor_enabled else 'LEARNER',
            equipment=devices,tags=[],commands=list(copy.deepcopy(self.commands).values()),alarms=copy.deepcopy(self.alarm_occurrences),
            debriefs=copy.deepcopy(self.debriefs),milestones=copy.deepcopy(self.unit['milestones']),assumptions=copy.deepcopy(self.model['assumptions']),
            limitations=self.model['fidelity']['limitations'],electrical=copy.deepcopy(self.truth['electrical']),
            diagram=dict(nodes=copy.deepcopy(self.model['nodes']),nodeObservations=copy.deepcopy(self.truth['electrical']['nodes']),equipment=devices))

    def finish(self):
        result=super().finish()
        m=self.unit['milestones'];achieved=(m.get('unit_online') and m.get('normal_stop')) if self.scenario['scenarioId']=='COMPLEX-NORMAL' else (m.get('island_formed') and m.get('reconnected'))
        result['objectiveAchieved']=bool(achieved);result['milestones']=copy.deepcopy(m)
        for event in [self.events[-1],result['events'][-1]]:
            if event['kind']=='session_completed':event['detail']['objectiveAchieved']=bool(achieved)
        self.debriefs[-1]=copy.deepcopy(result)
        return result

    def reset(self):
        if self.status!='completed':raise SimError('SESSION_NOT_COMPLETED','Finish the current run before reset',409)
        self._initial_state();self.sim_time_ms=0;self.run_id=secrets.token_urlsafe(12);self.status='paused';self.control_revision+=1
        self.pending=[];self.selections={};self.commands={};self.idempotency={};self.alarm_occurrences=[]
        self._emit('run_reset',{});self._settle();return self.snapshot()

    def _inject_local_overload(self,duration_ms):
        raise SimError('FAULT_NOT_SUPPORTED','The single-unit overload scenario is not part of the complex model')
