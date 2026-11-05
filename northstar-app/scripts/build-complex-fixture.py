"""Reproducible source-inspired TRAINING model; ratings are explicit assumptions."""
import json
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]
nodes, equipment = [], []
def node(id, kv, x, y, area):
    nodes.append(dict(nodeId=id, nominalKVLL=kv, x=x, y=y, area=area))
def device(id, kind, terms=(), params=None, state=None, area='complex', label=None):
    equipment.append(dict(equipmentId=id, type=kind, label=label or id, area=area,
        terminals=[dict(id=str(i+1), nodeId=n) for i,n in enumerate(terms)],
        parameters=params or {}, initialState=state or {}, sourceRefs=['h2o','assumptions']))
def switch(id, a,b, closed=True, area='complex', kind='breaker', **params):
    device(id,kind,[a,b],dict(openDelayMs=400,closeDelayMs=800,**params),
        dict(position='closed' if closed else 'open',reportedPosition='closed' if closed else 'open',
             remote=True,dc=True,lockout=False,mechanismHealthy=True,quality='good'),area)
def transformer(id,a,b,area,tap=False):
    device(id,'transformer_2w',[a,b],dict(xPu=.08,ratedMVA=40,tapStep=.00625,tapMin=-8,tapMax=8,tapCapable=tap),
           dict(tap=0,mode='manual',remote=True,dc=True,healthy=True,targetPu=1.0),area)
def load(id,n,p,q,area):device(id,'load',[n],dict(activeMW=p,reactiveMvar=q),dict(enabled=True),area)
node('GRID230',230,75,70,'hv');node('IR-HV',230,360,70,'hv')
device('GRID','grid_source',['GRID230'],dict(nominalKVLL=230,frequencyHz=60),dict(enabled=True),'hv')
switch('IR-A1L93','GRID230','IR-HV',area='hv')
for i,(t,x) in enumerate([('T4',240),('T7',560)]):
    a=f'IR-{t}-ISO';b=f'IR-{t}-HV';c=f'IR-{t}-LV';bus=f'IR-120{chr(65+i)}'
    node(a,230,x,135,'hv');node(b,230,x,200,'hv');node(c,120,x,280,'hv');node(bus,120,x,355,'hv')
    switch(f'IR-89-{t}-HV','IR-HV',a,area='hv',kind='isolator')
    switch(f'IR-52-{t}-HV',a,b,area='hv')
    transformer(f'IR-{t}',b,c,'hv',True)
    switch(f'IR-52-89-{t}-LV',c,bus,area='hv')
    node(f'IR-{t}-GROUND',230,x+100,200,'hv')
    switch(f'IR-{t}-HV-G',b,f'IR-{t}-GROUND',False,'hv',kind='earth_switch')
switch('IR-120-TIE','IR-120A','IR-120B',False,'hv',trainingAssumption=True)
node('IR-12A',12,280,140,'main');node('IR-12C',12,720,140,'main')
for t,src,bus,x,cb in [('T5','IR-120A','IR-12A',280,'IR-52-7'),('T6','IR-120B','IR-12C',720,'IR-52-8')]:
    node(f'IR-{t}-IN',120,x,45,'main');node(f'IR-{t}-OUT',12,x,90,'main')
    switch(f'IR-89-{t}',src,f'IR-{t}-IN',True,'main',kind='isolator')
    transformer(f'IR-{t}',f'IR-{t}-IN',f'IR-{t}-OUT','main')
    switch(cb,f'IR-{t}-OUT',bus,True,'main',trainingAssumption=True)
switch('IR-52-27','IR-12A','IR-12C',True,'main')
switch('IR-52-T4M','IR-120A','IR-120B',False,'hv',trainingAssumption=True)
for bus,x in [('TF-A',170),('TF-B',690)]:node(bus,12,x,160,'twin')
switch('TF-52BT','TF-A','TF-B',True,'twin')
for i,(bus,cb,x) in enumerate([('TF-A','IR-52-31',170),('TF-B','IR-52-30',690)],1):
    node(f'TF-L{i}-NEAR',12,x,70,'twin');node(f'TF-L{i}-FAR',12,x+40,70,'main')
    switch(f'TF-52L{i}',bus,f'TF-L{i}-NEAR',True,'twin')
    device(f'TF-LINE{i}','line',[f'TF-L{i}-NEAR',f'TF-L{i}-FAR'],dict(xPu=.025,resistanceOhmPerPhase=.1,reactanceOhmPerPhase=.5),{},'main')
    switch(cb,f'TF-L{i}-FAR','IR-12C',True,'main')
for k,(bus,x,cb) in enumerate([('IR-B1',180,'IR-52-5'),('IR-B2',510,'IR-INCOMER2'),('IR-B3',840,'IR-52-17')],1):
    node(bus,12,x,300,'iroquois');switch(cb,bus,'IR-12A',True,'main',trainingAssumption=True)
switch('IR-52BT','IR-B1','IR-B2',False,'iroquois')
# External feeders are passive boundary loads, never implicit voltage sources.
for id,area,p in [('IR-52-1','main',.15),('IR-52-33','main',.15),('IR-52-14','main',.2)]:
    n=id+'-LOAD';node(n,12,920,400,'main');switch(id,'IR-12C',n,False,area,trainingAssumption=True);load(id+'-DEMAND',n,p,.05,area)
for id,n,p in [('IR-A-LOAD','IR-12A',1.0),('IR-C-LOAD','IR-12C',1.0),('TF-A-LOAD','TF-A',.2),('TF-B-LOAD','TF-B',.2)]:load(id,n,p,p*.2,'main' if id.startswith('IR') else 'twin')
for station,area,buses in [('TF','twin',['TF-A','TF-B']),('IR','iroquois',['IR-B1','IR-B2'])]:
    for i,bus in enumerate(buses,1):
        sn=f'{station}-SS{i}';secondary=sn+'-SOURCE';node(secondary,.6,200+i*230,440,area);node(sn,.6,200+i*230,520,area)
        transformer(f'{station}-TSS{i}',bus,secondary,'aux')
        switch(f'{station}-52SS{i}',secondary,sn,True,'aux')
        load(sn+'-LOAD',sn,.08,.025,'aux')
    switch(f'{station}-52SSBT',f'{station}-SS1',f'{station}-SS2',False,'aux')
    device(station+'-TRANSFER','transfer_controller',[],dict(station=station),dict(mode='auto',preferred=1,retransfer=True,remote=True,dc=True,timer=0,phase='normal'),'aux')
    device(station+'-DC','control_supply',[],{},dict(available=True),'aux')
    for name in ['LUBE1','LUBE2','DC-LUBE','COMPRESSOR1','COMPRESSOR2','WATER','FAN1','FAN2','FAN3','FAN4','FAN5','FAN6']:
        device(station+'-'+name,'auxiliary',[],dict(station=station,bus=f'{station}-SS1',battery=name=='DC-LUBE'),dict(requested=True,running=True,mode='auto',fault=False,remote=True,dc=True),'aux')
    device(station+'-POND','reservoir',[],dict(areaM2=100000,inflowM3S=10,tailwaterM=100,initialHeadM=20),dict(headwaterM=120,storageM3=2000000),'water')
    for i in range(1,3 if station=='TF' else 5):
        device(f'{station}-SPILL{i}','spill_gate',[],dict(station=station,maxM=6 if station=='TF' or i==1 else 3.5,slewMPerS=.15,flowCoefficient=3),
               dict(positionM=0,targetM=0,flowM3S=0,remote=True,dc=True,enabled=True,fault=False,stopped=True),'water')
for station,nums,area in [('TF',range(1,6),'twin'),('IR',[*range(1,10),11,12,13],'iroquois')]:
    for i in nums:
        id=f'{station}-G{i}';bus=('TF-A' if i<=3 else 'TF-B') if station=='TF' else ('IR-B1' if i<=5 else 'IR-B2' if i<=9 else 'IR-B3')
        n=id+'-TERMINAL';node(n,12,80+((i-1)%5)*185,310 if station=='TF' else 410,area)
        switch(f'{station}-52G{i}',n,bus,False,area,generatorRef=id)
        device(id,'generator',[n],dict(station=station,unitNumber=i,bus=bus,breaker=f'{station}-52G{i}',ratedMW=5,ratedMVA=6,
            inertiaSeconds=4,droop=.04,rampMWPerS=.5,maxMvar=3,blackStartCapable=station=='TF',startSeconds=6,stopSeconds=5,
            sourcePage=(f'Twin Falls/TF_UNIT_{i:02d}/TF_Unit{i:02d}_Control.UCBG' if station=='TF' else f'Iroquois Falls/IF_GS/IF_Unit{i:02d}/IF_Unit{i:02d}_Control.UCBG')),
            dict(sequenceState='STOPPED',elapsed=0,speedRpm=0,voltagePu=0,frequencyHz=0,phaseDegrees=20,activeMW=0,mechanicalMW=0,
                requestedMW=1,requestedMvar=0,reactiveMvar=0,gate=0,gateDemand=.2,flowM3S=0,energyMWh=0,governorMode='power',
                excitationMode='avr',syncMode='auto',voltageTargetPu=1,speedTrimHz=0,blackStart=False,blackStartMode='manual',forming=False,frequencySupport=True,
                remote=True,dc=True,lockout86=False,lockout94=False,tripCause=None,brakesApplied=True,auxLossSeconds=0,frequencyFaultSeconds=0),area)
model=dict(schemaVersion='northstar.switching-model.v1',modelId='SIM-TWIN-IROQUOIS',revision=1,label='Twin Falls + Iroquois complex',
    synthetic=True,siteId=None,readiness='draft_synthetic',nodes=nodes,equipment=equipment,tags=[],sourceRefs=[
        dict(sourceId='h2o',description='Recovered native controls, 388 Twin files equal February 2019 backup; refer to h2o-controls-reference.json'),
        dict(sourceId='assumptions',description='Illustrative terminal assignments except verified Twin line links; 5MW units, 0.6kV SS, 120kV nominal, dynamic and electrical settings are training assumptions.')],
    assumptions=dict(baseMVA=100,frequencyHz=60,syncHz=.15,syncDegrees=10,syncVoltagePu=.05,deadPu=.1,
        topology='Source-linked illustrative complex; not a verified as-built netlist',
        voltageLabels='Source has 115/120 and 230/240 labels; this model uses 120 and 230 kV nominal.',
        water='Separate 100000 m2 ponds, constant tailwater, no calibrated river routing.'),
    fidelity=dict(solver='linearized_multivoltage_islands_v1',limitations=['Source-inspired training network, not a validated as-built plant model.',
        'Linearized P-angle / Q-voltage flow with reduced-order governor, excitation and frequency dynamics; no relay/transient certification.',
        'Ratings, secondary voltages, loads, limits, delays and untraced terminals are explicit illustrative assumptions.']))
out=ROOT/'northstar_sim'/'fixtures'/'twin-iroquois.model.json';out.write_text(json.dumps(model,indent=2),encoding='utf8')
scenarios=[]
for id,title,objective in [('COMPLEX-NORMAL','Connected operation','Start, synchronize, load and stop a unit.'),
                         ('COMPLEX-BLACKSTART','Black start and restoration','Build an energized Twin island and reconnect it to the grid.'),
                         ('COMPLEX-ISLAND','Island and reconnect','Separate the running complex from the grid, hold an island and reconnect.')]:
    overrides=[]
    if id=='COMPLEX-BLACKSTART':
        overrides=[dict(equipmentId=x,field='position',value='open') for x in ['IR-A1L93','TF-52L1','TF-52L2']]
    if id=='COMPLEX-ISLAND':
        for g in ['TF-G1','IR-G1']:
            for key,val in dict(sequenceState='ONLINE',speedRpm=300,voltagePu=1,frequencyHz=60,phaseDegrees=0,forming=True,mechanicalMW=1.4,activeMW=1.4,requestedMW=1.4,gate=.28,brakesApplied=False).items():
                overrides.append(dict(equipmentId=g,field=key,value=val))
            overrides.append(dict(equipmentId=g.replace('-G','-52G'),field='position',value='closed'))
    scenarios.append(dict(scenarioId=id,revision=1,title=title,modelId=model['modelId'],seed=1,synthetic=True,notAProcedure=True,objective=objective,initialOverrides=overrides))
(out.parent/'twin-iroquois-scenarios.json').write_text(json.dumps(dict(scenarios=scenarios),indent=2),encoding='utf8')
print(len(nodes),'nodes',len(equipment),'equipment')
