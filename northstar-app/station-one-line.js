/* Read-only topology. Labels are exact SCADA semantic bindings, never inferred states. */
(() => {
  'use strict';
  const esc = v => String(v ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const num = (v,d=1) => typeof v === 'number' && Number.isFinite(v) ? v.toFixed(d) : '—';
  const stationCodes={'site:calm-lake':'CL','site:sturgeon-falls':'SF','site:fort-frances':'FF','site:kenora':'KE','site:norman':'NO','site:twin-falls':'TW','site:island-falls':'IR','site:iroquois-falls':'IS','site:old-woman-falls':'OW','site:white-otter-rapids':'WO','site:camp-three-rapids':'CT','site:big-beaver-falls':'BB','site:mcdougal':'MC','site:okikendawt-gs':'OK','site:aiyers-1':'A1','site:aiyers-2':'A2','site:bird-gs':'B1','site:cogent':'B2'};
  const layouts = {
    'site:island-falls': {
      note:'Island Falls generator layout: G1-G6 on Generator Bus 1 and G7-G12 on Generator Bus 2. Equipment designations and remaining topology need confirmation against station drawings.',
      width:1700,height:850,
      wires:['M850 47V38','M850 102V98','M850 162V153','M850 217V245','M170 245H1530','M850 245V590','M170 590H1530'],
      equipment:[
        {type:'grid',label:'230 kV line',designation:'230 kV',x:850,y:15},
        {type:'switch',label:'Line switch',designation:'IR-LS1-1',point:'Line switch',x:850,y:70},
        {type:'breaker',label:'Main breaker',designation:'IR-52T1',point:'Main breaker',x:850,y:130},
        {type:'transformer',label:'Main transformer · HV/LV',designation:'IR-T1',x:850,y:185}
      ],
      buses:[
        {label:'Generator Bus 1 · 12.5 kV',x:170,y:245},
        {label:'Generator Bus 2 · 12.5 kV',x:170,y:590}
      ],
      generators:Array.from({length:12},(_,i)=>({n:i+1,x:170+(i%6)*272,y:i<6?245:590})),
      gates:[]
    },
    'site:iroquois-falls': {
      note:'Illustrative single-line layout. Equipment designations and topology need confirmation against station drawings. High-side voltage options: 115/230 kV; generator bus options: 6.9/12.5 kV.',
      width:1200,height:490,
      wires:['M600 47V38','M600 102V98','M600 162V153','M600 217V245H120','M120 245H1080','M800 245V217','M800 153V143'],
      equipment:[
        {type:'grid',label:'230 kV line · I93S',designation:'230 kV · I93S',x:600,y:15},
        {type:'switch',label:'Line switch',designation:'IS-LS1-1',point:'Line switch',x:600,y:70},
        {type:'breaker',label:'Main breaker',designation:'IS-52T1',point:'Main breaker',x:600,y:130},
        {type:'transformer',label:'Main transformer · HV/LV',designation:'IS-T1',x:600,y:185},
        {type:'transformer',label:'Station service',designation:'IS-T2',x:800,y:185}
      ],
      bus:{label:'Generator Bus · 12.5 kV',x:120,y:245},
      generators:[1,2,3,4].map((n,i)=>({n,x:120+i*320,y:245})),
      gates:[1,2,3,4].map(n=>({label:`SG${n}`,state:`Sluice gate ${n} state`,position:`Sluice gate ${n} position`,positionUnit:'m',flow:`Sluice gate ${n} discharge`}))
    }
  };
  function demoLayout(count,code) {
    const unitSpacing=260, width=Math.max(1040,count*unitSpacing+160);
    const first=(width-(count-1)*unitSpacing)/2;
    const last=first+(count-1)*unitSpacing, center=width/2;
    const letters=code.match(/[A-Z]/g)||['S'], lineVoltage=count>4?230:115;
    const circuit=`${letters[0]}${lineVoltage===230?'93':'1'}${letters[letters.length-1]}`;
    return {
      note:'Illustrative single-line layout based on station unit count. Designations use the station code and equipment tag; topology needs station drawing review. High-side options: 115/230 kV; generator bus options: 6.9/12.5 kV.',
      width,height:490,
      wires:[`M${center} 47V38`,`M${center} 102V98`,`M${center} 162V153`,`M${center} 217V245`,`M${first} 245H${last}`],
      equipment:[
        {type:'grid',label:`${lineVoltage} kV line · ${circuit}`,designation:`${lineVoltage} kV · ${circuit}`,x:center,y:15},
        {type:'switch',label:'Line switch',designation:`${code}-LS1-1`,point:'Line switch',x:center,y:70},
        {type:'breaker',label:'Main breaker',designation:`${code}-52T1`,point:'Main breaker',x:center,y:130},
        {type:'transformer',label:'Main transformer · HV/LV',designation:`${code}-T1`,x:center,y:185}
      ],
      bus:{label:`Generator Bus · ${lineVoltage===230?'12.5':'6.9'} kV`,x:first,y:245},
      generators:Array.from({length:count},(_,i)=>({n:i+1,x:first+i*unitSpacing,y:245})),
      gates:[]
    };
  }
  function device(type,state,x,y,label='',designation='') {
    const s=['open','closed'].includes(state)?state:'unknown';
    let shape='';
    if(type==='breaker') shape=`<path d="M0 -20V-13M0 13V20"/><rect x="-13" y="-13" width="26" height="26"/>${s==='closed'?'<path d="M0 -8V8"/>':s==='open'?'<path d="M-8 0H8"/>':'<text y="5" text-anchor="middle">?</text>'}`;
    if(type==='switch') shape=`<path d="M0 -20V-12M0 12V20"/><circle cx="0" cy="-12" r="2"/><circle cx="0" cy="12" r="2"/>${s==='closed'?'<path d="M0 -12V12"/>':s==='open'?'<path d="M0 12L-17 -9"/>':'<text x="-12" y="5">?</text>'}`;
    if(type==='transformer') shape='<g transform="rotate(90)"><path d="M-20 0h12M8 0h12M-8 -15c4 0 6 3 6 5s-2 5-6 5c4 0 6 3 6 5s-2 5-6 5c4 0 6 3 6 5s-2 5-6 5M8 -15C4 -15 2 -12 2 -10s2 5 6 5C4 -5 2 -2 2 0s2 5 6 5C4 5 2 8 2 10s2 5 6 5"/></g>';
    if(type==='grid') shape='<path class="gs-sld-grid-feed" d="M0 -24V20"/><path class="gs-sld-grid-line" d="M-38 -24H38"/>';
    const caption=designation||label;
    return `<g class="gs-sld-device" data-state="${s}" transform="translate(${x} ${y})"><title>${esc(label)}${['breaker','switch'].includes(type)?`: ${s}`:''}</title><g transform="scale(1.6)">${shape}</g>${caption?`<text class="gs-sld-equipment" x="40" y="5">${esc(caption)}</text>`:''}${['breaker','switch'].includes(type)?`<text class="gs-sld-state" x="40" y="24">${s}</text>`:''}</g>`;
  }
  function render(m,demoModel=null) {
    const config=layouts[m.site.id] || (Number.isInteger(m.total) && m.total>0 && m.total<=50 ? demoLayout(m.total,stationCodes[m.site.id]||'ST') : null), read=m.reading || (()=>null);
    const demo=!m.current && demoModel?.baseline ? demoModel : null;
    const noWater=demoModel?.baseline?.noWater;
    const value=(label,unit)=>read(label,unit)?.numericValue;
    const state=label=>String(read(label)?.textValue||'unknown').toLowerCase();
    const metric=(label,key,unit,d=1)=>`<div><dt>${label}</dt><dd>${noWater && key!=='output' ? 'N/A' : num(demo ? demo.value(key) : m.value(key),d)} <small>${noWater && key!=='output' ? '' : unit}</small></dd></div>`;
    const unitMarkup=(n,x,y,connected)=>{
      const demoUnit=demo?.units.find(unit=>unit.n===n);
      const reportedUnit=m.units.find(unit=>unit.n===n);
      const output=demoUnit ? demoUnit.output : value(`Unit ${n} output`,'MW');
      const reportedState=(demoUnit || reportedUnit)?.state;
      const generatorState=reportedState && reportedState!=='unknown' ? reportedState : Number.isFinite(output) ? output>0 ? 'generating' : 'offline' : 'unknown';
      const flow=noWater ? null : demoUnit && Number.isFinite(demo.value('outflow')) && demo.running>0 ? demoUnit.state==='generating' ? demo.value('outflow')/demo.running : 0 : value(`Unit ${n} flow`,'m3/s');
      const capacity=demoUnit ? demo.baseline.capacity/demo.baseline.units : value(`Unit ${n} capacity`,'MW');
      const reported=value(`Unit ${n} operating percentage`,'%');
      const percent=Number.isFinite(reported)?reported:Number.isFinite(output)&&capacity>0?output/capacity*100:null;
      const displayState=generatorState==='offline'?'offline':'generating';
      return `<g class="gs-sld-generator" data-state="${displayState}" transform="translate(${x} ${y}) scale(1.2)">${connected?'<path d="M0 0V16M0 56V69"/>':''}${device('breaker',displayState==='offline'?'open':'closed',0,36,'',`${stationCodes[m.site.id]||'ST'}-52G${n}`)}<circle class="gs-sld-generator-symbol" cy="91" r="22"/><path class="gs-sld-generator-symbol" d="M-13 91C-9 74 -4 74 0 91S9 108 13 91"/><text class="gs-sld-unit" y="131" text-anchor="middle">G${n}</text><text y="151" text-anchor="middle">${num(output,2)} MW</text><text y="169" text-anchor="middle">${noWater?'N/A':num(flow)+' m³/s'}</text><text y="187" text-anchor="middle">${num(percent)}%</text></g>`;
    };
    const units=config?.generators || m.units.map((u,i)=>({n:u.n,x:65+i*130,y:0}));
    const buses=config ? (config.buses || [config.bus]) : [];
    const svg=`<svg class="gs-sld" viewBox="0 0 ${config?.width||Math.max(440,units.length*130)} ${config?.height||235}" role="img" aria-label="${esc(m.site.name)} single-line diagram">${config?config.wires.map(d=>`<path d="${d}"/>`).join('')+config.equipment.map(e=>device(e.type,'closed',e.x,e.y,e.type==='grid'?'':e.label,e.designation||'')).join('')+buses.map(bus=>`<text class="gs-sld-bus-label" x="${bus.x}" y="${bus.y-12}">${esc(bus.label)}</text>`).join(''):''}${units.map(u=>unitMarkup(u.n,u.x,u.y,!!config)).join('')}</svg>`;
    const gates=config?.gates || [];
    const gateRows=gates.map(g=>`<tr><th>${esc(g.label)}</th><td>${esc(state(g.state))}</td><td>${num(value(g.position,g.positionUnit))} ${esc(g.positionUnit)}</td><td>${num(value(g.flow,'m3/s'))} m³/s</td></tr>`).join('');
    const notes=Array.isArray(m.operationalNotes)?m.operationalNotes:[];
    const notesMarkup=notes.length?notes.map(note=>`<p><b>${esc(note.type||'Note')}</b><span>${esc(note.text)}</span>${note.timestamp?`<small>${esc(note.timestamp)}</small>`:''}</p>`).join(''):'<p class="gs-source">No new operational instructions, notes, or conditions.</p>';
    const heading=m.popupHeading?`<header class="gs-station-heading"><h2 id="gs-detail-title">${esc(m.site.name)}</h2><button type="button" class="gs-jump" data-site-jump="${esc(m.site.id)}" aria-label="Jump to the ${esc(m.site.name)} site page">JUMP <span aria-hidden="true">↗</span></button></header>`:'';
    return `<div class="gs-station-mimic"><section class="gs-sld-panel">${heading}<div class="gs-sld-scroll">${svg}</div></section><aside class="gs-station-totals"><h3>Station Data</h3><dl>${metric('MW output','output','MW',2)}${metric('Headwater','headwater','m',3)}${metric('Tailwater','tailwater','m',3)}${metric('Generation flow','flow','m³/s')}${metric('Spill','spill','m³/s')}${metric('Total flow','outflow','m³/s')}</dl><section class="gs-station-notes" aria-label="Station notes"><h3>Station Notes</h3>${notesMarkup}</section>${noWater?'':`<h3>Sluice gates</h3>${gates.length?`<table><thead><tr><th>Gate</th><th>State</th><th>Position</th><th>Discharge</th></tr></thead><tbody>${gateRows}</tbody></table>`:'<p class="gs-source">Gate inventory and bindings not configured.</p>'}`}</aside></div><details class="gs-layout-note"><summary>Layout details</summary><p class="gs-source">${esc(config?.note||'Electrical layout not configured · units shown without inferred connections')}</p></details>`;
  }
  window.NorthStarStationOneLine={layouts,render};
})();
