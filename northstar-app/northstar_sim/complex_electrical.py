"""Linearized per-unit P/angle and Q/voltage flow, including meshed islands.

Switches collapse equal-voltage nodes. Transformer branches retain both voltage
bases and tap offsets. Frequency is a reduced-order island swing equation; it is
not an electromagnetic transient or protection coordination calculation.
"""
import math

def clip(x, low, high): return max(low, min(high, x))

def linear_solve(matrix, rhs):
    n=len(rhs)
    a=[list(row)+[rhs[i]] for i,row in enumerate(matrix)]
    for k in range(n):
        pivot=max(range(k,n),key=lambda i:abs(a[i][k]))
        if abs(a[pivot][k])<1e-10: raise ValueError('Singular electrical island')
        a[k],a[pivot]=a[pivot],a[k]
        scale=a[k][k]
        for j in range(k,n+1):a[k][j]/=scale
        for i in range(n):
            if i==k:continue
            factor=a[i][k]
            for j in range(k,n+1):a[i][j]-=factor*a[k][j]
    return [row[-1] for row in a]

def solve_complex(model, states, memory, dt=0):
    nodes={x['nodeId']:x for x in model['nodes']};parent={x:x for x in nodes}
    devices=model['equipment'];base=model['assumptions']['baseMVA']
    def find(n):
        while n!=parent[n]:parent[n]=parent[parent[n]];n=parent[n]
        return n
    def union(a,b):
        if not math.isclose(nodes[a]['nominalKVLL'],nodes[b]['nominalKVLL']):
            raise ValueError('Switch cannot connect unlike voltage bases')
        parent[find(b)]=find(a)
    for d in devices:
        if d['type'] in {'breaker','isolator','earth_switch','circuit_switcher'} and states[d['equipmentId']]['position']=='closed':
            union(*(t['nodeId'] for t in d['terminals']))
    groups={}
    for n in nodes:groups.setdefault(find(n),[]).append(n)
    edges=[];adj={r:set() for r in groups}
    for d in devices:
        if d['type'] not in {'line','transformer_2w'}:continue
        if not states[d['equipmentId']].get('healthy',True):continue
        a,b=[find(t['nodeId']) for t in d['terminals']]
        if a==b:continue
        x=float(d['parameters']['xPu'])
        if x<=0:raise ValueError('Positive branch reactance required')
        delta=-states[d['equipmentId']].get('tap',0)*d['parameters'].get('tapStep',0)
        edges.append((a,b,1/x,delta,d));adj[a].add(b);adj[b].add(a)
    seen=set();result={};flows={};islands=[];source_outputs={}
    for root in groups:
        if root in seen:continue
        todo=[root];component=set()
        while todo:
            r=todo.pop()
            if r in component:continue
            component.add(r);todo.extend(adj[r]-component)
        seen|=component;members=sorted(n for r in component for n in groups[r])
        sources=[];gens=[];loads=[]
        for d in devices:
            if len(d['terminals'])!=1 or find(d['terminals'][0]['nodeId']) not in component:continue
            s=states[d['equipmentId']]
            if d['type']=='grid_source' and s.get('enabled'):sources.append(d)
            if d['type']=='generator' and s['sequenceState'] in {'READY','ONLINE','STOPPING'} and s['voltagePu']>.5:
                gens.append(d)
            if d['type']=='load' and s.get('enabled',True):loads.append(d)
        grid=bool(sources);online=[d for d in gens if states[d['parameters']['breaker']]['position']=='closed']
        forming=[d for d in gens if states[d['equipmentId']].get('forming') or states[d['parameters']['breaker']]['position']=='open']
        ref=(sources or forming or [None])[0]
        id=min(members);p_load=sum(states[d['equipmentId']].get('demandMW',d['parameters']['activeMW']) for d in loads)
        q_load=sum(d['parameters']['reactiveMvar'] for d in loads)
        if ref is None:
            for n in members:result[n]=dict(energization='deenergized',voltageKVLL=0,voltagePu=0,frequencyHz=0,phaseDegrees=0,islandId=id,gridConnected=False,quality='good')
            islands.append(dict(id=id,nodes=members,energized=False,gridConnected=False,generators=[],loadMW=p_load,servedMW=0,frequencyHz=0))
            continue
        refstate=states[ref['equipmentId']];refnode=ref['terminals'][0]['nodeId'];slack=find(refnode)
        previous=memory.get(refnode,{})
        f=60.0 if grid else previous.get('frequencyHz') or refstate.get('frequencyHz') or 60.0
        phase=0.0 if grid else previous.get('phaseDegrees',refstate.get('phaseDegrees',0))
        capacity=sum(d['parameters']['ratedMW'] for d in online)
        mechanical=sum(states[d['equipmentId']]['mechanicalMW'] for d in online)
        if not grid and online and dt:
            inertia=sum(d['parameters']['inertiaSeconds']*d['parameters']['ratedMW'] for d in online)
            f+=dt*(60*(mechanical-p_load)/(2*max(inertia,1))-.25*(f-60))
            f=clip(f,40,75)
        elif not grid and not online:
            f=refstate.get('frequencyHz',60)
        phase=(phase+(f-60)*360*dt)%360 if online or grid else refstate.get('phaseDegrees',0)
        p={r:0.0 for r in component};q={r:0.0 for r in component}
        for d in loads:
            r=find(d['terminals'][0]['nodeId']);p[r]-=states[d['equipmentId']].get('demandMW',d['parameters']['activeMW'])/base;q[r]-=d['parameters']['reactiveMvar']/base
        for d in online:
            s=states[d['equipmentId']];rated=d['parameters']['ratedMW'];r=find(d['terminals'][0]['nodeId'])
            electrical=s['mechanicalMW'] if grid else s['mechanicalMW']+(p_load-mechanical)*rated/max(capacity,1)
            qgen=s['requestedMvar']
            if s['excitationMode']=='avr':qgen+=clip((s['voltageTargetPu']-previous.get('voltagePu',1))*rated/.05,-3,3)
            qgen=clip(qgen,-d['parameters']['maxMvar'],d['parameters']['maxMvar'])
            p[r]+=electrical/base;q[r]+=qgen/base
            source_outputs[d['equipmentId']]=dict(activeMW=electrical,reactiveMvar=qgen)
        branches=[e for e in edges if e[0] in component]
        unknown=sorted(component-{slack});ix={r:i for i,r in enumerate(unknown)}
        matrix=[[0.0]*len(ix) for _ in ix];rp=[p[r] for r in unknown];rq=[q[r] for r in unknown]
        vref=1.0 if grid else refstate.get('voltageTargetPu',1)
        for a,b,admittance,delta,d in branches:
            for r,other,offset in [(a,b,delta),(b,a,-delta)]:
                if r==slack:continue
                i=ix[r];matrix[i][i]+=admittance;rq[i]+=admittance*offset
                if other!=slack:matrix[i][ix[other]]-=admittance
                else:rq[i]+=admittance*vref
        theta={slack:0.0};voltage={slack:vref}
        theta.update(zip(unknown,linear_solve(matrix,rp)));voltage.update(zip(unknown,linear_solve(matrix,rq)))
        source_q=0
        for a,b,admittance,delta,d in branches:
            pmw=admittance*(theta[a]-theta[b])*base;qmvar=admittance*(voltage[a]-voltage[b]-delta)*base
            na,nb=[t['nodeId'] for t in d['terminals']];s_mva=math.hypot(pmw,qmvar)
            flows[d['equipmentId']]=dict(activeMW=pmw,reactiveMvar=qmvar,
                currentA=s_mva*1000/(math.sqrt(3)*max(.01,nodes[na]['nominalKVLL']*voltage[a])),
                secondaryCurrentA=s_mva*1000/(math.sqrt(3)*max(.01,nodes[nb]['nominalKVLL']*voltage[b])))
            if a==slack:source_q+=qmvar
            if b==slack:source_q-=qmvar
        if ref['type']=='generator' and ref in online:
            # Slack balances reactive demand at its node plus outgoing branch flow.
            source_outputs[ref['equipmentId']]['reactiveMvar']+=source_q-q[slack]*base
        for n in members:
            r=find(n);pu=voltage[r]
            result[n]=dict(energization='energized',voltageKVLL=pu*nodes[n]['nominalKVLL'],voltagePu=pu,frequencyHz=f,
                phaseDegrees=(phase+math.degrees(theta[r]))%360,islandId=id,gridConnected=grid,quality='good')
        islands.append(dict(id=id,nodes=members,energized=True,gridConnected=grid,generators=[d['equipmentId'] for d in online],
            loadMW=p_load,servedMW=p_load,mechanicalMW=mechanical,imbalanceMW=mechanical-p_load,frequencyHz=f,
            gridImportMW=p_load-mechanical if grid else 0,phaseDegrees=phase))
    return dict(nodes=result,branches=flows,islands=islands,generation=source_outputs,quality='good',solver='linearized_multivoltage_islands_v1')
