"""Build a separate source-qualified r013 training draft; never infer missing wiring."""
import copy
import hashlib
import json
import xml.etree.ElementTree as ET
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
FIX = ROOT / 'northstar_sim' / 'fixtures'


def build():
    old = json.loads((FIX / 'twin-iroquois.model.json').read_text())
    templates = {d['equipmentId']: d for d in old['equipment']}
    details = json.loads((ROOT / 'trainer-assets/r013/device-details.json').read_text())
    nodes, equipment, bindings = [], [], {}

    def node(id, kv):
        nodes.append(dict(nodeId=id, nominalKVLL=kv))
        return id

    def dev(id, kind, terms=(), params=None, state=None, drawing=None, note=None, blocked=False):
        d = dict(equipmentId=id, type=kind, label=id, area='r013',
                 terminals=[dict(id=str(i+1), nodeId=n) for i, n in enumerate(terms)],
                 parameters=params or {}, initialState=state or {}, sourceRefs=['r013', 'assumptions'],
                 verification=dict(status='unresolved' if blocked else 'source-qualified-draft',
                     note=note or 'r013 topology; not checked against as-built drawing. Electrical/dynamic parameters and initial positions are training assumptions.'),
                 controlBlocked=blocked)
        equipment.append(d)
        if drawing:
            bindings[drawing] = id
            d['sourceDetails'] = details[drawing]
        return d

    def sw(id, a, b, drawing=None, closed=True, kind='breaker', **kw):
        return dev(id, kind, [a,b], dict(openDelayMs=400,closeDelayMs=800,**kw),
            dict(position='closed' if closed else 'open',remote=True,dc=True,lockout=False,
                 mechanismHealthy=True,quality='good'), drawing)

    def tx(id,a,b,drawing, mva=40, blocked=False):
        return dev(id,'transformer_2w',[a,b],dict(xPu=.08,ratedMVA=mva,tapCapable=False),
                   dict(tap=0,mode='manual',healthy=True),drawing,blocked=blocked)

    def line(id,a,b):
        return dev(id,'line',[a,b],dict(xPu=.025),dict(healthy=True))

    node('GRID230',230);node('CTS-A1',230)
    dev('GRID','grid_source',['GRID230'],dict(nominalKVLL=230,frequencyHz=60),dict(enabled=True))
    sw('IR-A1L93','GRID230','CTS-A1','A1L93')
    node('CTS-M1',115);node('CTS-T8LV',12.5);node('CTS-T9LV',12.5)
    for t in ['T4','T7','T8','T9']:
        a=node(t+'-ISO',230);b=node(t+'-HV',230)
        c=node(t+'-LV',115 if t in ['T4','T7'] else 12.5)
        sw('CTS-89-'+t,'CTS-A1',a,t+'-DS',kind='isolator',associatedBreaker='CTS-52-'+t)
        sw('CTS-52-'+t,a,b,t+'-HV')
        d=tx('IR-'+t,b,c,t)
        d['verification']['note'] += ' T8/T9 nameplate 245 kV retained in popup; shared A1 operating base is assumed 230 kV.'
        lv=sw('CTS-'+t+'-LV',c,'CTS-M1' if t in ['T4','T7'] else 'CTS-'+t+'LV',t+'-LV',
              kind='circuit_switcher' if t in ['T4','T7'] else 'breaker')
        if t in ['T4','T7']:
            lv['controlBlocked']=True
            lv['verification']=dict(status='unresolved',note='Circuit switcher, not a breaker. Operating duty/interlocks unverified; fixed closed training boundary, controls disabled.')
    sw('CTS-TIE','CTS-T8LV','CTS-T9LV','CTS-TIE',closed=False)

    # Island: two independent 115/12.5 kV routes, with separate HV/LV L2 IDs.
    for i in [1,2]:
        near=node(f'IS-L{i}-CTS',115);far=node(f'IS-L{i}-HV',115)
        primary=node(f'IS-T{i}-PRIMARY',115);secondary=node(f'IS-T{i}-SECONDARY',12.5)
        bus=node(f'IS-B{i}',12.5)
        cs=sw(f'CTS-ISL{i}','CTS-M1',near,f'CS{i}',kind='circuit_switcher')
        cs['controlBlocked']=True
        cs['verification']=dict(status='unresolved',note='Circuit-switcher duty and interlocks unverified; fixed closed training boundary, controls disabled.')
        line(f'IS-LINE{i}',near,far)
        sw(f'IS-L{i}-HV',far,primary,f'IS-L{i}-HV',station='IS')
        tx(f'IS-T{i}',primary,secondary,f'IS-T{i}')
        if i==2:sw('IS-L2-LV',secondary,bus,'IS-L2-LV',station='IS')
        else:line('IS-T1-B1',secondary,bus)
        dev(bus,'bus',[bus],drawing=bus)

    for st in ['TF','IR']:
        for i in [1,2]:node(f'{st}-B{i}',12.5)
        sw(st+'-52BT',st+'-B1',st+'-B2','TW-TIE' if st=='TF' else 'IR-TIE',closed=False,station=st)
        for i in [1,2]:
            # r013: TW L1 <- T9, TW L2 <- T8; IR L1 <- T8, IR L2 <- T9.
            source='CTS-T'+str((9 if i==1 else 8) if st=='TF' else (8 if i==1 else 9))+'LV'
            near=node(f'{st}-L{i}-CTS',12.5)
            sw(f'CTS-{st}L{i}',source,near,('TW' if st=='TF' else 'IR')+'L'+str(i),station=st)
            if st=='TF':
                far=node(f'TF-L{i}-GS',12.5);line(f'TF-LINE{i}',near,far)
                sw(f'TF-52L{i}',far,f'TF-B{i}',f'TW-52L{i}',station=st)
            else:line(f'IR-LINE{i}',near,f'IR-B{i}')  # No invented GS-end breaker.

    for st in ['IS','TF','IR']:
        dev(st+'-DC','control_supply',params={'station':st},state={'available':True},
            note='ASSUMPTION: independent available control DC. No actual DC circuit modeled.')
        pond=copy.deepcopy(templates['TF-POND']);pond['equipmentId']=st+'-POND';pond['sourceRefs']=['assumptions']
        pond['verification']=dict(status='assumed',note='Illustrative independent pond; no calibrated hydraulic routing.')
        equipment.append(pond)
    for st,nums in [('IS',range(1,5)),('TF',range(1,6)),('IR',[*range(1,10),11,12,13])]:
        for i in nums:
            id=f'{st}-G{i}';unresolved=st=='IR' and i>=11
            bus=(f'IS-B{1 if i<=2 else 2}' if st=='IS' else f'TF-B{1 if i<=3 else 2}' if st=='TF' else f'IR-B{1 if i<=5 else 2}')
            if unresolved:bus=node(id+'-UNRESOLVED-600V',.6)
            terminal=node(id+'-TERMINAL',.6 if unresolved else 12.5)
            drawing=id.replace('TF-','TW-');cb=id.replace('-G','-52G')
            breaker=sw(cb,terminal,bus,drawing+'-52',closed=False,station=st,generatorRef=id)
            g=copy.deepcopy(templates['TF-G1'])
            mw=(10 if i<=2 else 11) if st=='IS' else 4 if st=='TF' else 2 if i<=9 else 1
            mva=(12.5 if i<=2 else 15.2) if st=='IS' else 5.5 if st=='TF' else 3.1 if i<=9 else 1.6
            g.update(equipmentId=id,label=id,terminals=[dict(id='1',nodeId=terminal)],sourceRefs=['r013','assumptions'],
                     controlBlocked=unresolved,sourceDetails=details[drawing])
            g['parameters'].update(station=st,unitNumber=i,bus=bus,breaker=cb,ratedMW=mw,ratedMVA=mva,
                blackStartCapable=False,sourcePage='r013 recovered drawing; no native display binding',maxMvar=min(3,mva/2))
            g['verification']=dict(status='unresolved' if unresolved else 'source-qualified-draft',
                note=('Unresolved 600 V step-up: electrically isolated; unit and breaker controls blocked.' if unresolved else
                      ('Island MW user supplied; ' if st=='IS' else f'ASSUMED {mw} MW operating limit, not nameplate MW; ')+
                      'MVA from r013. Dynamics, permissives and available auxiliaries assumed. Common 12.5 kV operating base; source 12/13 kV labels retained.'))
            breaker['controlBlocked']=unresolved;breaker['verification']=copy.deepcopy(g['verification'])
            equipment.append(g);bindings[drawing]=id

    # Remaining source targets are explicit inventory-only records: no implicit electrical paths.
    for key,detail in details.items():
        if key not in bindings:
            dev('UNRESOLVED-'+key,'control_supply',drawing=key,blocked=True,
                note='UNRESOLVED: wiring or device identity not established. Inventory only; no modeled connection or control.')
    model=dict(schemaVersion='northstar.switching-model.v1',modelId='SIM-IS-TW-IR-R013',revision=1,
        label='Island / Twin / Iroquois — r013 draft',synthetic=True,siteId=None,readiness='draft_site_model',
        nodes=nodes,equipment=equipment,tags=[],drawingBindings=bindings,
        sourceRefs=[dict(sourceId='r013',description='Recovered IR-Visual-Demo-r013; conceptual SOP grouping, not as-built verified.'),
                    dict(sourceId='assumptions',description='All dynamics, impedances, initial positions, loads and available auxiliaries are training assumptions.')],
        assumptions=dict(baseMVA=100,frequencyHz=60,auxiliariesAvailable=True,
            topology='r013 source-qualified topology; unresolved paths omitted',
            voltageLabels='230 / 115 / 12.5 kV operating bases assumed; retain source nameplate discrepancies.',
            water='Independent illustrative ponds; no calibrated routing.',
            auxiliaries='ASSUMED available for start/stop exercises; station-service wiring remains unconnected.',
            initialPositions='Exercise state, not r013 demo colors or plant feedback. Units initially stopped/open; ties open.'),
        fidelity=dict(limitations=['DRAFT — NOT AS-BUILT VERIFIED; simulation only, not a switching procedure.',
            'r013 conceptual feeder grouping requires confirmation against 085-4-2101r13.',
            'All impedances, dynamics, protection, sync windows and auxiliary availability are assumptions.',
            'IR G11–13 step-up and service wiring unresolved: no inferred connections; associated controls blocked.',
            'T4/T7 circuit-switcher operation unverified: fixed closed training boundaries; no controls.',
            '12/12.5/13 kV and 230/245 kV source differences retained; operating voltage bases assumed.']))
    scenarios=[]
    for id,title,overrides in [
        ('R013-NORMAL','r013 — connected start / synchronize / stop',[]),
        ('R013-T8-LOSS','r013 — T8 supply lost (ties open)',[dict(equipmentId='CTS-52-T8',field='position',value='open')]),
        ('R013-T9-LOSS','r013 — T9 supply lost (ties open)',[dict(equipmentId='CTS-52-T9',field='position',value='open')]),
        ('R013-IS-L1-LOSS','r013 — Island line 1 lost',[dict(equipmentId='IS-L1-HV',field='position',value='open')])]:
        scenarios.append(dict(scenarioId=id,revision=1,title=title,modelId=model['modelId'],seed=1,
            synthetic=True,notAProcedure=True,objective='Explore the draft topology; start, synchronize and stop a modeled unit. Unresolved routes remain isolated.',initialOverrides=overrides))
    return model,dict(scenarios=scenarios)


if __name__=='__main__':
    model,scenarios=build()
    for name,obj in [('is-tw-ir-r013.model.json',model),('is-tw-ir-r013-scenarios.json',scenarios)]:
        (FIX/name).write_text(json.dumps(obj,indent=2)+'\n',encoding='utf-8')
    assets=ROOT/'trainer-assets/r013'
    hashes={n:hashlib.sha256((assets/n).read_bytes()).hexdigest() for n in ['original.svg','device-details.json']}
    (assets/'source-manifest.json').write_text(json.dumps(dict(revision='r013',sha256=hashes),indent=2)+'\n')
    # Derived runtime artwork retains geometry. Original stays byte-for-byte unchanged.
    ET.register_namespace('', 'http://www.w3.org/2000/svg')
    svg=ET.fromstring((assets/'original.svg').read_text(encoding='utf-8'))
    for element in svg.iter():
        if element.tag.endswith('text'):
            text=element.text or ''
            if 'DEMO CONFIGURATION' in text:element.text='SIMULATION · UNVERIFIED DRAFT'
            elif 'No live data' in text:element.text='Select a device for simulated state and source notes'
            elif 'CLOSED demo state' in text:element.text='Unit positions from simulator; no plant feedback'
            elif text.startswith('Breakers:'):element.text='C / O = simulated position · ? = unresolved'
        if 'data-device' in element.attrib:
            key=element.get('data-device');id=model['drawingBindings'][key]
            element.set('aria-label',id+' simulator details')
        if 'data-breaker-state' in element.attrib:
            element.set('data-breaker-state','unknown')
            element.set('stroke','#9db0c0')
    (assets/'runtime.svg').write_text(ET.tostring(svg,encoding='unicode'),encoding='utf-8')
    print(f"r013: {len(model['equipment'])} equipment, {len(model['drawingBindings'])} drawing bindings")
