"""Build a separate source-qualified r013 training draft; never infer missing wiring."""
import copy
import hashlib
import json
import re
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
            d['sourceDetails'] = details.get(drawing, {'title': id, 'Source': 'User topology clarification, 2026-11-05; not as-built verified.'})
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

    # User-confirmed route: common 600 V bus -> transformer -> IR 52-L3 -> IR Bus 2.
    node('IR-B600',.6);node('IR-L3-TX-HV',12.5)
    bus600=dev('IR-B600','bus',['IR-B600'],drawing='IR-B600')
    transformer=tx('IR-T-600V','IR-L3-TX-HV','IR-B600','IR-T-600V',mva=5)
    l3=sw('IR-52L3','IR-B2','IR-L3-TX-HV','IR-52L3',station='IR')
    for d in [bus600,transformer,l3]:
        d['sourceRefs']=['user-20261105-600v','assumptions']
        d['verification']=dict(status='user-confirmed-topology',note='User confirmed shared G11/G12/G13 600 V bus, 12.5/0.6 kV transformer, IR 52-L3 and IR Bus 2 route on 2026-11-05. Not as-built verified. Transformer tag unknown; 5 MVA rating and 0.08 pu reactance are training assumptions, not equipment data. Protection, dynamics and initial positions unverified.')
    transformer['label']='12.5 / 0.6 kV transformer (tag unverified)'
    bus600['label']='IR 600 V bus';l3['label']='IR 52-L3'

    for st in ['IS','TF','IR']:
        dev(st+'-DC','control_supply',params={'station':st},state={'available':True},
            note='ASSUMPTION: independent available control DC. No actual DC circuit modeled.')
        pond=copy.deepcopy(templates['TF-POND']);pond['equipmentId']=st+'-POND';pond['sourceRefs']=['assumptions']
        pond['verification']=dict(status='assumed',note='Illustrative independent pond; no calibrated hydraulic routing.')
        equipment.append(pond)
    for st,nums in [('IS',range(1,5)),('TF',range(1,6)),('IR',[*range(1,10),11,12,13])]:
        for i in nums:
            id=f'{st}-G{i}';low_voltage=st=='IR' and i>=11;unresolved=False
            bus=(f'IS-B{1 if i<=2 else 2}' if st=='IS' else f'TF-B{1 if i<=3 else 2}' if st=='TF' else f'IR-B{1 if i<=5 else 2}')
            if low_voltage:bus='IR-B600'
            terminal=node(id+'-TERMINAL',.6 if low_voltage else 12.5)
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
            if low_voltage:
                g['sourceRefs']=['r013','user-20261105-600v','assumptions']
                g['verification']=dict(status='user-confirmed-topology',note='User confirmed common 600 V bus through 12.5/0.6 kV transformer and IR 52-L3 to IR Bus 2. Not as-built verified. Unit MW limits, transformer rating/impedance, dynamics, protection and auxiliaries remain training assumptions.')
            breaker['controlBlocked']=unresolved;breaker['verification']=copy.deepcopy(g['verification'])
            if low_voltage:breaker['sourceRefs']=list(g['sourceRefs'])
            equipment.append(g);bindings[drawing]=id

    # Remaining source targets are explicit inventory-only records: no implicit electrical paths.
    for key,detail in details.items():
        if key not in bindings:
            dev('UNRESOLVED-'+key,'control_supply',drawing=key,blocked=True,
                note='UNRESOLVED: wiring or device identity not established. Inventory only; no modeled connection or control.')
    for d in equipment:
        id=d['equipmentId']
        if d['label']==id and d.get('sourceDetails'):
            source=d['sourceDetails'];d['label']=(source.get('title') or source.get('Equipment') or id).strip() or id
        if id.startswith('TF-52L'):d['label']='TW 52-L'+id[-1]
        elif id.startswith('CTS-TFL'):d['label']='CTS 52-TWL'+id[-1]
        elif id.startswith('CTS-IRL'):d['label']='CTS 52-IRL'+id[-1]
        elif id.startswith('IS-L') and id.endswith('-HV'):d['label']='IS 52-L'+id[4]+' HV'
        elif id=='IS-L2-LV':d['label']='IS 52-L2 LV'
        elif d['type']=='breaker' and '-52G' in id:d['label']=id.replace('TF-','TW ').replace('IS-','IS ').replace('IR-','IR ').replace('52G','52-G')
    model=dict(schemaVersion='northstar.switching-model.v1',modelId='SIM-IS-TW-IR-R013',revision=2,
        label='Island / Twin / Iroquois — r013 draft',synthetic=True,siteId=None,readiness='draft_site_model',
        nodes=nodes,equipment=equipment,tags=[],drawingBindings=bindings,
        sourceRefs=[dict(sourceId='user-20261105-600v',description='User confirmed G11/G12/G13 common 600 V bus through a 12.5/0.6 kV transformer and IR 52-L3 to IR Bus 2; transformer tag/rating/protection not supplied.'),dict(sourceId='r013',description='Recovered IR-Visual-Demo-r013; conceptual SOP grouping, not as-built verified.'),
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
            'G11/G12/G13 600 V route user-confirmed via transformer and IR 52-L3 to Bus 2; transformer tag/rating, impedance and protection unverified. Service wiring remains unresolved and blocked.',
            'T4/T7 circuit-switcher operation unverified: fixed closed training boundaries; no controls.',
            '12/12.5/13 kV and 230/245 kV source differences retained; operating voltage bases assumed.']))
    scenarios=[]
    for id,title,overrides in [
        ('R013-NORMAL','r013 — connected start / synchronize / stop',[]),
        ('R013-T8-LOSS','r013 — T8 supply lost (ties open)',[dict(equipmentId='CTS-52-T8',field='position',value='open')]),
        ('R013-T9-LOSS','r013 — T9 supply lost (ties open)',[dict(equipmentId='CTS-52-T9',field='position',value='open')]),
        ('R013-IS-L1-LOSS','r013 — Island line 1 lost',[dict(equipmentId='IS-L1-HV',field='position',value='open')])]:
        scenarios.append(dict(scenarioId=id,revision=2,title=title,modelId=model['modelId'],seed=1,
            synthetic=True,notAProcedure=True,objective='Explore the draft topology; start, synchronize and stop a modeled unit. Unresolved routes remain isolated.',initialOverrides=overrides))
    return model,dict(scenarios=scenarios)


def write_artifacts():
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
            elif text.startswith('Breakers:'):element.text='Green = closed · red = open · amber ? = unverified'
        if 'data-device' in element.attrib:
            key=element.get('data-device');id=model['drawingBindings'][key]
            element.set('aria-label',id+' simulator details')
        if 'data-breaker-state' in element.attrib:
            element.set('data-breaker-state','unknown')
            element.set('stroke','#9db0c0')
    enhance_drawing(svg,model)
    tidy_device_layout(svg,model)
    (assets/'runtime.svg').write_text(ET.tostring(svg,encoding='unicode'),encoding='utf-8')
    print(f"r013: {len(model['equipment'])} equipment, {len(model['drawingBindings'])} drawing bindings")


def enhance_drawing(svg, model):
    """Derived review geometry; recovered r013 source bytes remain untouched."""
    ns='{http://www.w3.org/2000/svg}'
    def add(parent,tag,**attrs):return ET.SubElement(parent,ns+tag,{k.replace('_','-'):str(v) for k,v in attrs.items()})
    def text(parent,x,y,value,**attrs):
        e=add(parent,'text',x=x,y=y,fill='#e4edf5',font_family='Helvetica,Arial,sans-serif',font_size=15,**attrs);e.text=value;return e
    # New visible route is right of the existing G6-G9 branches; no crossing implies a junction.
    route=ET.Element(ns+'g',{'data-user-confirmed-route':'IR-600V'})
    add(route,'path',d='M 2086.8595041322315 790 H 2130 V 985 H 1770.495867768595',stroke='#75c5d4',stroke_width=3,fill='none')
    for x in [1770.495867768595,1899.9173553719008,2029.3388429752067]:
        add(route,'circle',cx=x,cy=985,r=3,fill='#75c5d4')
    add(route,'circle',cx=2086.8595041322315,cy=790,r=3,fill='#75c5d4')
    svg.append(route)
    def device(key,x,y,kind):
        g=add(svg,'g',data_device=key,tabindex=0,role='button',aria_label=key+' simulator details')
        add(g,'title').text=key+' - click for details'
        add(g,'rect',x=x-20,y=y-20,width=40,height=40,fill='#101b26')
        sym=add(g,'g',data_northstar_symbol=kind,transform=f'translate({x} {y}) rotate(90) scale(0.45)',stroke='#9db0c0',stroke_width=5.5,fill='none')
        return g,sym
    g,sym=device('IR-52L3',2130,845,'breaker')
    add(sym,'path',d='M-31 0 H-22 M22 0 H31')
    add(sym,'rect',x=-22,y=-22,width=44,height=44)
    add(sym,'path',data_position_bar='simulation',d='M-13 0 H13')
    text(g,2100,840,'IR 52-L3',text_anchor='end')
    g,sym=device('IR-T-600V',2130,930,'transformer')
    sym.set('transform','translate(2130 930) scale(0.7)')
    add(sym,'path',d='M0 -32 V-18 M0 18 V32')
    add(sym,'circle',cx=0,cy=-8,r=13);add(sym,'circle',cx=0,cy=8,r=13)
    text(g,2100,925,'12.5 / 0.6 kV',text_anchor='end')
    note=add(g,'text',x=2100,y=945,fill='#f2bc61',font_size=12,text_anchor='end');note.text='Tag / rating unverified'
    g=add(svg,'g',data_device='IR-B600',tabindex=0,role='button',aria_label='IR 600 V bus simulator details')
    add(g,'path',d='M1770.495867768595 985 H2130',stroke='transparent',stroke_width=15,fill='none')
    for e in list(svg):
        if e.tag==ns+'text' and (e.text or '') in ['TW 52L1','TW 52L2','IS-52-L1','IS 52-L2','52-L2']:svg.remove(e)
    for e in svg.iter(ns+'text'):
        if '600 V' in (e.text or '') and 'step-up routing unresolved' in (e.text or ''):
            e.text='600 V bus - user-confirmed route';e.set('data-600v-route-label','true')
    by_id={d['equipmentId']:d for d in model['equipment']}
    for g in svg.iter(ns+'g'):
        key=g.get('data-device')
        if not key:continue
        d=by_id[model['drawingBindings'][key]]
        g.set('aria-label',d['label']+' simulator details')
        title=g.find(ns+'title')
        if title is not None:title.text=d['label']+' - click for details'
        sym=next((e for e in g if e.get('data-northstar-symbol')),None)
        if sym is None or sym.get('data-northstar-symbol') not in {'breaker','disconnect','circuit-switcher','earth-switch'}:continue
        transform=sym.get('transform','');xy=re.search(r'translate\(([-.0-9]+) ([-.0-9]+)\)',transform)
        if not xy:continue
        x,y=map(float,xy.groups())
        scale=.75 if sym.get('data-northstar-symbol')=='breaker' else .65
        sym.set('transform',re.sub(r'scale\([^)]+\)',f'scale({scale})',transform))
        for rect in g.findall(ns+'rect'):
            rect.set('x',str(x-20));rect.set('y',str(y-20));rect.set('width','40');rect.set('height','40')
        for bar in sym.iter(ns+'path'):
            if 'data-position-bar' in bar.attrib:bar.set('d','M-13 0 H13')
        for label in list(g.findall(ns+'text')):
            if label.text=='?':g.remove(label)
            elif float(label.get('x','0'))>x and float(label.get('x','0'))<x+28:label.set('x',str(x+28))
        if key in ['TW-52L1','TW-52L2','IS-L1-HV','IS-L2-HV','IS-L2-LV']:
            text(g,x+28,y+5,d['label'])





def tidy_device_layout(svg,model):
    """Uniform labels in device-local coordinates, with straight transformer leads."""
    ns='{http://www.w3.org/2000/svg}'
    def el(parent,tag,**attrs):return ET.SubElement(parent,ns+tag,{k.replace('_','-'):str(v) for k,v in attrs.items()})
    def label(g,x,y,value,anchor='start',secondary=False):
        t=el(g,'text',x=x,y=y,text_anchor=anchor,font_family='Helvetica,Arial,sans-serif',font_size=11 if secondary else 13,fill='#a9bdcc' if secondary else '#e4edf5',data_device_label='secondary' if secondary else 'primary')
        t.text=value
        return t
    devices={d['equipmentId']:d for d in model['equipment']}
    # These detached source labels are replaced by labels attached to their devices.
    for t in list(svg):
        if t.tag==ns+'text' and (t.text or '') in ['52-BT','L1','L2'] and float(t.get('y',0)) in [767,831]:svg.remove(t)
    for g in svg.findall('.//'+ns+'g'):
        key=g.get('data-device')
        if not key:continue
        d=devices[model['drawingBindings'][key]]
        texts=g.findall(ns+'text');old=[t.text or '' for t in texts]
        sym=next((e for e in g if e.get('data-northstar-symbol')),None)
        # Replace the old sideways winding/dogleg assembly, preserving both endpoints.
        winding=next((e for e in g.findall(ns+'path') if ' C' in e.get('d','')),None)
        if winding is not None and sym is None:
            lead=g.find(ns+'path');match=re.match(r'M([-.0-9]+) ([-.0-9]+)',lead.get('d',''))
            if match:
                x,top=map(float,match.groups());y=top+28
                for e in g.findall(ns+'path'):g.remove(e)
                sym=el(g,'g',data_northstar_symbol='transformer',transform=f'translate({x} {y})',fill='none',stroke='#75c5d4',stroke_width=2)
                el(sym,'path',d='M0 -28 V-19 M0 19 V28',data_straight_leads='true')
                el(sym,'circle',cx=0,cy=-8,r=11);el(sym,'circle',cx=0,cy=8,r=11)
        if sym is None:
            for i,t in enumerate(texts):
                t.set('font-family','Helvetica,Arial,sans-serif');t.set('font-size','13' if i==0 else '11');t.set('data-device-label','primary' if i==0 else 'secondary')
            if texts:g.set('data-marker-x',str(float(texts[0].get('x'))-14));g.set('data-marker-y',str(float(texts[0].get('y'))-3))
            continue
        trans=sym.get('transform','');match=re.search(r'translate\(([-.0-9]+) ([-.0-9]+)\)',trans)
        if not match:continue
        x,y=map(float,match.groups());kind=sym.get('data-northstar-symbol')
        g.set('data-marker-x',str(x-21));g.set('data-marker-y',str(y-17))
        if kind in {'breaker','disconnect','circuit-switcher','earth-switch','generator'}:
            scale=.68 if kind=='generator' else .62 if kind=='breaker' else .56
            sym.set('transform',re.sub(r'scale\([^)]+\)',f'scale({scale})',trans))
            for rect in g.findall(ns+'rect'):
                size=38 if kind=='generator' else 32
                rect.set('x',str(x-size/2));rect.set('y',str(y-size/2));rect.set('width',str(size));rect.set('height',str(size))
        for t in texts:g.remove(t)
        if kind=='generator':
            label(g,x,y+35,key.split('-')[-1],anchor='middle')
        elif re.search(r'-G\d+-52$',key):
            label(g,x+20,y+4,'52-'+key.split('-')[1])
        elif key in ['TW-TIE','IR-TIE','CTS-TIE','TW-SS-TIE']:
            label(g,x,y-24,{'TW-TIE':'TW 52-BT','IR-TIE':'IR 52-BT','CTS-TIE':'52-T8.9LV','TW-SS-TIE':'TW 52BT-SS'}[key],anchor='middle')
        elif kind=='transformer':
            if key=='IR-T-600V':
                # Align both new transformer terminals to the vertical L3 feeder.
                sym.set('transform',f'translate({x} {y})');sym.set('stroke-width','2')
                for child in list(sym):sym.remove(child)
                el(sym,'path',d='M0 -28 V-19 M0 19 V28',data_straight_leads='true')
                el(sym,'circle',cx=0,cy=-8,r=11);el(sym,'circle',cx=0,cy=8,r=11)
                label(g,x-28,y-5,'12.5 / 0.6 kV',anchor='end')
                note=label(g,x-28,y+14,'Tag / rating unverified',anchor='end',secondary=True);note.set('fill','#f2bc61')
            else:
                label(g,x+28,y-5,old[0] if old else d['label'])
                if len(old)>1:label(g,x+28,y+14,old[1],secondary=True)
        elif key=='IR-52L3':label(g,x-28,y+4,'IR 52-L3',anchor='end')
        else:label(g,x+26,y+4,d['label'])


if __name__=='__main__':write_artifacts()
