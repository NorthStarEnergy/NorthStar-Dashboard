/* H2O-derived page families. All actions use the isolated training command API. */
(() => {
  'use strict';
  const root = document.querySelector('.switching-sim');
  if (!root) return;
  const $ = s => root.querySelector(s);
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const number = (v, digits=2) => Number.isFinite(v) ? v.toFixed(digits) : '—';
  const pages = [['overview','Complex overview'],['twin','Twin electrical'],['tf-unit','Twin units 1–5'],['main','MAIN Sub'],['hv','230 / 120 kV'],['ir-unit','Iroquois units'],['aux','Aux / station service'],['water','Water / spill gates'],['source','H2O sources']];
  let snap, api, page='overview', unit='TF-G1', signature='', faceId='';
  const shell = document.createElement('section'); shell.className='cx'; shell.hidden=true;
  shell.innerHTML='<header class="cx-header"><div><small>H2O • OPERATOR TRAINER</small><h2>Twin Falls / Iroquois Falls</h2></div><strong class="cx-network-state"></strong></header><nav class="cx-nav" aria-label="Complex pages"></nav><div class="cx-layout"><main class="cx-main"></main><aside class="cx-command-host"></aside></div>';
  $('.sim-unit-panel').before(shell);
  const main=shell.querySelector('.cx-main');
  const originalGrid=$('.sim-grid'), face=$('.sim-faceplate');
  shell.querySelector('.cx-nav').innerHTML=pages.map(([id,label])=>`<button type="button" data-page="${id}">${label}</button>`).join('');
  const eq = id => snap.equipment.find(d=>d.equipmentId===id);
  const node = id => snap.electrical.nodes[id] || {};
  const button = (id,label) => `<button type="button" class="cx-device" data-device="${esc(id)}">${esc(label||id)} <span data-position="${esc(id)}"></span></button>`;
  const action = (d,a,label=a.replaceAll('_',' ')) => d.actions.includes(a) ? `<button type="button" data-control="${a}" data-id="${d.equipmentId}" ${a==='emergency_stop'?'class="cx-danger"':''}>${esc(label)}</button>` : '';
  const value = (id,key,label,unit='',digits=2) => `<div class="cx-reading"><span>${esc(label)}</span><strong data-read="${id}" data-key="${key}" data-digits="${digits}" data-suffix="${esc(unit)}">—</strong></div>`;
  const section = (label,html) => `<section class="cx-panel"><h3>${label}</h3>${html}</section>`;
  function setpoint(d,a,label,u,max,min=0,current=0) {
    if (!d.actions.includes(a)) return '';
    current=Number(Number(current).toFixed(1));
    return `<div class="cx-setpoint"><label>${label}<input aria-label="${label} ${d.equipmentId}" type="number" min="${min}" max="${max}" step="0.1" value="${current}" data-input="${d.equipmentId}:${a}"></label><button type="button" data-control="${a}" data-id="${d.equipmentId}" data-unit="${u}">Select ${u}</button></div>`;
  }
  function unitPage(station) {
    if (!unit.startsWith(station+'-')) unit=station+'-G1';
    const d=eq(unit),p=d.parameters;
    const units=snap.equipment.filter(x=>x.type==='generator' && x.parameters.station===station);
    return `<div class="cx-unit-tabs">${units.map(g=>`<button type="button" data-unit-page="${g.equipmentId}" aria-pressed="${g.equipmentId===unit}">Unit ${g.parameters.unitNumber}<small data-read="${g.equipmentId}" data-key="sequenceState"></small></button>`).join('')}</div><h2>${station==='TF'?'Twin Falls':'Iroquois Falls'} · Unit ${p.unitNumber}</h2><p class="cx-source">Base: ${esc(p.sourcePage)}</p><div class="cx-panels">`+
      section('UNIT CONTROL',value(unit,'sequenceState','Sequence')+value(unit,'brakesApplied','Brakes applied')+'<div class="cx-buttons">'+['start','stop','cancel_start','emergency_stop'].map(a=>action(d,a)).join('')+'</div>'+button(p.breaker,'52G · Trip / synchronize'))+
      section('GENERATOR / ELECTRICAL',value(unit,'activeMW','Active power',' MW')+value(unit,'reactiveMvar','Reactive power',' Mvar')+value(unit,'voltagePu','Voltage',' pu',3)+value(unit,'frequencyHz','Frequency',' Hz',3)+value(unit,'currentA','Current',' A',1)+value(unit,'energyMWh','Generated energy',' MWh',4))+
      section('POWER / GOVERNOR',value(unit,'governorMode','Control mode')+value(unit,'requestedMW','Power demand',' MW')+value(unit,'gate','Gate fraction','',3)+value(unit,'mechanicalMW','Turbine power',' MW')+setpoint(d,'setpoint','MW demand','MW',p.ratedMW,0,d.requestedMW)+setpoint(d,'set_gate','Gate demand','%',100,0,d.gate*100)+'<div class="cx-buttons">'+['mode_power','mode_position','mode_condense'].map(a=>action(d,a)).join('')+'</div>')+
      section('EXCITATION',value(unit,'excitationMode','Mode')+value(unit,'voltageTargetPu','Voltage target',' pu',3)+'<div class="cx-buttons">'+['avr_raise','avr_lower','excitation_avr','excitation_var'].map(a=>action(d,a)).join('')+'</div>'+setpoint(d,'set_mvar','Reactive demand','Mvar',3,-3,d.requestedMvar))+
      section('SPEED / SYNCHRONIZING',value(unit,'speedRpm','Speed',' rpm',1)+value(unit,'syncMode','Synchronizing mode')+value(unit,'speedTrimHz','Manual speed trim',' Hz',2)+value(unit,'frequencySupport','Frequency support')+'<div class="cx-buttons">'+['sync_auto','sync_manual','speed_raise','speed_lower','frequency_support_on','frequency_support_off'].map(a=>action(d,a)).join('')+'</div><p>Open the 52G faceplate to compare unit and bus voltage, frequency and phase.</p>')+
      section('PERMISSIVES / LOCKOUTS',value(unit,'lockout86','86 lockout')+value(unit,'lockout94','94 lockout')+value(unit,'tripCause','Trip cause')+value(unit,'remote','Remote selected')+'<div class="cx-buttons">'+['reset_86','reset_94'].map(a=>action(d,a)).join('')+'</div><p data-permissives="'+unit+'"></p>')+
      (p.blackStartCapable?section('BLACK START',value(unit,'blackStartMode','Mode')+value(unit,'blackStart','Black-start sequence')+'<div class="cx-buttons">'+['blackstart_auto','blackstart_manual','black_start'].map(a=>action(d,a)).join('')+'</div><p>DC lube supports startup. Energizing the station bus restores AC auxiliaries. Line isolation and dead-bus permissives are checked.</p>'):'')+
      section('WATER / TURBINE',value(unit,'flowM3S','Turbine flow',' m³/s')+value(station+'-POND','headwaterM','Headwater',' m')+value(station+'-POND','totalFlowM3S','Station discharge',' m³/s'))+'</div>';
  }
  function waterPage() {
    return '<h2>Water management / spill gates</h2><div class="cx-panels">'+['TF','IR'].map(st=>section(st==='TF'?'TWIN FALLS WATER':'IROQUOIS FALLS WATER',value(st+'-POND','headwaterM','Headwater',' m',3)+value(st+'-POND','storageM3','Storage',' m³',0)+value(st+'-POND','turbineFlowM3S','Turbine flow',' m³/s')+value(st+'-POND','spillFlowM3S','Spill flow',' m³/s')+value(st+'-POND','totalFlowM3S','Total discharge',' m³/s'))).join('')+snap.equipment.filter(d=>d.type==='spill_gate').map(d=>section(d.equipmentId,value(d.equipmentId,'positionM','Gate opening',' m')+value(d.equipmentId,'targetM','Target',' m')+value(d.equipmentId,'flowM3S','Discharge',' m³/s')+value(d.equipmentId,'enabled','SCADA enabled')+setpoint(d,'set_spill','Opening target','m',d.parameters.maxM,0,d.targetM)+['stop','enable','disable'].map(a=>action(d,a)).join(''))).join('')+'</div>';
  }
  function auxPage() {
    return '<h2>Auxiliaries / station service</h2>'+['TF','IR'].map(st=>`<h3>${st==='TF'?'Twin Falls':'Iroquois Falls'} · 600 V station service</h3><div class="cx-ss"><div>${button(st+'-52SS1')}<p data-bus="${st}-SS1"></p></div><div>${button(st+'-52SSBT')}<p>Bus tie · break before make</p></div><div>${button(st+'-52SS2')}<p data-bus="${st}-SS2"></p></div></div><div class="cx-panels">`+section('TRANSFER CONTROL',value(st+'-TRANSFER','mode','Mode')+value(st+'-TRANSFER','preferred','Preferred source','',0)+value(st+'-TRANSFER','retransfer','Auto retransfer')+value(st+'-TRANSFER','phase','Sequence')+eq(st+'-TRANSFER').actions.map(a=>action(eq(st+'-TRANSFER'),a)).join(''))+snap.equipment.filter(d=>d.type==='auxiliary'&&d.parameters.station===st).map(d=>section(d.equipmentId,value(d.equipmentId,'running','Running')+value(d.equipmentId,'mode','Mode')+['start','stop','mode_auto','mode_manual'].map(a=>action(d,a)).join(''))).join('')+'</div>').join('');
  }
  // Explicit page geometry; connection lines still come from the model terminals.
  function layout(which) {
    const p={}; const put=(id,x,y)=>{p[id]=[x,y];};
    let ids=[];
    if (which==='hv') {
      put('GRID230',470,35);put('IR-HV',470,125);
      ['T4','T7'].forEach((t,i)=>{const x=220+i*500;put('IR-'+t+'-ISO',x,200);put('IR-'+t+'-HV',x,280);put('IR-'+t+'-LV',x,390);put('IR-120'+(i?'B':'A'),x,490);put('IR-'+t+'-GROUND',x+(i?120:-120),280);});
      ids=snap.equipment.filter(d=>d.area==='hv'&&d.terminals.length===2).map(d=>d.equipmentId).filter(id=>id!=='IR-52-T4M');
    } else if (which==='twin') {
      put('TF-A',245,260);put('TF-B',745,260);
      for(let i=1;i<=2;i++){put('TF-L'+i+'-NEAR',i===1?245:745,65);put('TF-SS'+i+'-SOURCE',i===1?245:745,550);put('TF-SS'+i,i===1?245:745,650);}
      for(let i=1;i<=5;i++)put('TF-G'+i+'-TERMINAL',65+(i-1)*210,415);
      ids=snap.equipment.filter(d=>d.equipmentId.startsWith('TF-') && d.terminals.length===2 && d.terminals.every(t=>p[t.nodeId])).map(d=>d.equipmentId);
    } else {
      put('IR-120A',130,40);put('IR-120B',780,40);
      ['T5','T6'].forEach((t,i)=>{put('IR-'+t+'-IN',130+i*650,110);put('IR-'+t+'-OUT',130+i*650,210);});
      put('IR-12A',240,310);put('IR-12C',710,310);
      for(let i=1;i<=3;i++)put('IR-B'+i,80+(i-1)*180,510);
      put('TF-L1-FAR',630,500);put('TF-L2-FAR',900,500);
      ['IR-52-1','IR-52-33','IR-52-14'].forEach((id,i)=>put(id+'-LOAD',560+i*170,660));
      ids=snap.equipment.filter(d=>d.area==='main'&&d.terminals.length===2&&d.terminals.every(t=>p[t.nodeId])).map(d=>d.equipmentId);
    }
    return {p,ids};
  }
  function diagram(which) {
    const {p,ids}=layout(which);
    const lines=ids.map(id=>{const d=eq(id),[a,b]=d.terminals.map(t=>p[t.nodeId]),x=(a[0]+b[0])/2,y=(a[1]+b[1])/2;
      return `<g data-edge="${id}"><path d="M${a[0]},${a[1]} L${b[0]},${b[1]}"/><g data-device="${id}" tabindex="0" role="button" aria-label="${id} faceplate" class="cx-symbol"><rect x="${x-12}" y="${y-12}" width="24" height="24"/><text x="${x}" y="${y+5}" class="cx-symbol-mark">${d.type==='transformer_2w'?'T':'○'}</text><text x="${x+18}" y="${y-15}">${id}</text></g></g>`;}).join('');
    const buses=Object.entries(p).map(([id,[x,y]])=>`<g><circle cx="${x}" cy="${y}" r="5"/><text x="${x}" y="${y+19}" text-anchor="middle">${id.replace('-TERMINAL','')}</text><text class="cx-bus-value" data-bus-svg="${id}" x="${x}" y="${y+34}" text-anchor="middle"></text></g>`).join('');
    return `<div class="cx-diagram"><svg viewBox="0 0 1000 ${which==='hv'?560:730}" aria-label="${which} modeled electrical connections">${lines}${buses}</svg></div><p class="cx-source">Solid green = both terminals energized; dashed gray = de-energized. Filled switch = closed, hollow = open. Select a symbol for controls.</p>`;
  }
  function overview() {
    return '<h2>Connected complex</h2><p>230 kV → 120 kV → 12 kV → station service. Each open switch can change the connected islands.</p><div class="cx-overview">'+[
      ['hv','Grid / 230 kV switchyard','IR-HV','IR-A1L93'],['hv','T4 / T7 · 120 kV A/B','IR-120A','IR-52-89-T4-LV'],['main','MAIN Sub · 12 kV A/C','IR-12C','IR-52-27'],['twin','Twin Falls · five units','TF-A','TF-52L1'],['ir-unit','Iroquois Falls · twelve units','IR-B1','IR-52-5']
    ].map(([p,label,n,cb])=>`<section class="cx-panel"><h3>${label}</h3><p data-bus="${n}"></p>${button(cb)}<button type="button" data-page="${p}">Open page →</button></section>`).join('')+'</div><h3>Islands / power balance</h3><div class="cx-islands"></div><h3>Exercise progress</h3><p class="cx-progress"></p><details class="cx-guide"><summary>Exercise guidance</summary><p>Connected operation: start a unit, wait for READY and the synchronization window, close its 52G, apply a power demand, then normal stop.</p><p>Black start: on a Twin unit select black-start mode and command. Manual mode waits for a 52G dead-bus close; auto mode closes after the ready sequence. Restore the grid-side breaker, start synchronizing at a Twin line breaker, then close inside the window.</p><p>Island and reconnect: open A1L93, observe the supplied islands and frequency response, select synchronize at A1L93, then close when voltage, frequency and phase match.</p><p>These are exercises in this illustrative model, not station switching instructions.</p></details>';
  }
  function build() {
    const titles={twin:'Twin Falls · electrical overview',main:'Iroquois · MAIN Sub / 12 kV buses',hv:'Iroquois · 230 kV switchyard / 120 kV A/B'};
    main.innerHTML=page==='overview'?overview():page==='tf-unit'?unitPage('TF'):page==='ir-unit'?unitPage('IR'):page==='water'?waterPage():page==='aux'?auxPage():page==='source'?'<h2>Recovered H2O source bases</h2><p>The original Twin and Iroquois native pages and companions are preserved in the source archive. Twin’s 388 files match the February 2019 backup.</p><p>The browser pages reproduce the control families using simulation bindings. Native ABB graphics are retained as source material; this is not a DisplayBuilder runtime rendering.</p><p><a href="/trainer-assets/h2o-native-bases.zip">Download recovered native page bases</a> · <a href="/trainer-assets/h2o-controls-reference.json" target="_blank" rel="noopener">Inspect control and topology provenance</a></p><h3>Explicit modeling assumptions</h3><ul>'+snap.limitations.map(x=>'<li>'+esc(x)+'</li>').join('')+'</ul><p>'+esc(snap.assumptions.voltageLabels)+'</p><p>'+esc(snap.assumptions.water)+'</p><p>Illustrative 5 MW units, 600 V station service, 60 Hz, ±8 taps; sync window 0.15 Hz / 10° / 0.05 pu. Untraced terminal mappings, settings, delays and water coefficients require engineering review.</p>':`<h2>${titles[page]}</h2>${diagram(page)}<div class="cx-device-strip">${snap.equipment.filter(d=>d.area===page&&d.actions.length).map(d=>button(d.equipmentId)).join('')}</div>`;
    shell.querySelectorAll('[data-page]').forEach(b=>b.setAttribute('aria-current',String(b.dataset.page===page)));
  }
  function readings(host) {
    host.querySelectorAll('[data-read]').forEach(el=>{const v=eq(el.dataset.read)?.[el.dataset.key];el.textContent=(typeof v==='number'?number(v,Number(el.dataset.digits||2)):typeof v==='boolean'?(v?'YES':'NO'):v||'—')+(el.dataset.suffix||'');});
    host.querySelectorAll('[data-position]').forEach(el=>{const d=eq(el.dataset.position);el.textContent=d?.reportedPosition?.toUpperCase()||d?.sequenceState||'';});
    host.querySelectorAll('[data-bus],[data-bus-svg]').forEach(el=>{const n=node(el.dataset.bus||el.dataset.busSvg);el.textContent=`${number(n.voltageKVLL,2)} kV · ${number(n.frequencyHz,2)} Hz${el.dataset.bus?' · '+(n.voltagePu<.1?'DEAD':n.gridConnected?'GRID':'ISLAND'):''}`;});
    host.querySelectorAll('[data-control]').forEach(el=>{el.disabled=snap.status!=='running';});
    host.querySelectorAll('[data-edge]').forEach(el=>{const d=eq(el.dataset.edge),energized=d.terminals.every(t=>node(t.nodeId).voltagePu>.1);el.classList.toggle('cx-energized',energized);el.classList.toggle('cx-closed',d.reportedPosition==='closed');const mark=el.querySelector('.cx-symbol-mark');if(d.type!=='transformer_2w')mark.textContent=d.indicationQuality!=='good'?'?':d.reportedPosition==='closed'?'●':'○';});
    host.querySelectorAll('[data-permissives]').forEach(el=>{const d=eq(el.dataset.permissives);el.textContent=`Control DC: ${d.dc?'available':'unavailable'} · Lube: ${eq(d.parameters.station+'-LUBE1').running||eq(d.parameters.station+'-LUBE2').running?'running':'stopped'} · Cooling: ${eq(d.parameters.station+'-WATER').running?'running':'stopped'}. Action-specific permissives appear when selected.`;});
    const islands=host.querySelector('.cx-islands');
    if(islands)islands.innerHTML='<table><thead><tr><th>Island</th><th>Supply</th><th>Hz</th><th>Load MW</th><th>Turbine MW</th><th>Units</th></tr></thead><tbody>'+snap.electrical.islands.filter(i=>i.loadMW>0||i.generators.length).map(i=>`<tr><td>${esc(i.id)}</td><td>${i.energized?(i.gridConnected?'GRID':'GENERATING ISLAND'):'DEAD'}</td><td>${number(i.frequencyHz,3)}</td><td>${number(i.loadMW)}</td><td>${number(i.mechanicalMW)}</td><td>${esc(i.generators.join(', '))||'—'}</td></tr>`).join('')+'</tbody></table>';
    const progress=host.querySelector('.cx-progress');if(progress)progress.textContent=['unit_online','normal_stop','island_formed','reconnected'].map(k=>`${snap.milestones[k]?'✓':'○'} ${k.replaceAll('_',' ')}`).join('   ·   ');
  }
  function render(s, callbacks) {
    snap=s;api=callbacks;shell.hidden=!s.complex;
    $('.sim-unit-panel').hidden=!!s.complex;
    $('.sim-diagram').closest('.sim-card').hidden=!!s.complex;
    $('.sim-measurements').hidden=!!s.complex;
    $('.sim-workspace').classList.toggle('complex-active',!!s.complex);
    if(!s.complex){if(face.parentElement!==originalGrid)originalGrid.prepend(face);$('.sim-actions').querySelectorAll('[data-action]').forEach(b=>b.hidden=false);signature='';faceId='';return;}
    if(face.parentElement!==shell.querySelector('.cx-command-host'))shell.querySelector('.cx-command-host').append(face);
    const sig=s.sessionId+':'+s.runId+':'+page+':'+unit;
    if(sig!==signature){build();signature=sig;faceId='';}
    const active=s.electrical.islands.filter(i=>i.energized&&i.generators.length);
    shell.querySelector('.cx-network-state').textContent=active.some(i=>!i.gridConnected)?'ISLAND ENERGIZED':'GRID / STANDBY';
    readings(main);
    $('.sim-limitations').textContent=s.limitations.join(' ');
  }
  function faceplate(s,id) {
    snap=s;const d=eq(id);if(!d)return;
    if(faceId!==id){
      faceId=id;
      const controls=d.type==='generator'?['start','stop','emergency_stop']:d.actions.filter(a=>!['setpoint','set_gate','set_mvar','set_spill'].includes(a));
      $('.sim-device').innerHTML=`<h3>${esc(id)}</h3><p>${esc(d.type.replaceAll('_',' '))}</p><div class="cx-face-values"></div><div class="cx-face-controls">${controls.map(a=>action(d,a,({close_dead:'Energize dead bus',close:'Close · sync check',synchronize:'Start synchronizing'})[a]||a.replaceAll('_',' '))).join('')}</div>`;
    }
    $('.sim-actions').querySelectorAll('[data-action]').forEach(b=>b.hidden=true);
    const sync=d.sync;
    $('.cx-face-values').innerHTML=(d.reportedPosition?`<p><strong>${esc(d.reportedPosition.toUpperCase())}</strong> · ${esc(d.indicationQuality)} · scan ${(d.indicationObservedSimTimeMs/1000).toFixed(1)} s</p>`:'')+(sync?.lineFrequencyHz!==undefined?`<dl><dt>Side 1</dt><dd>${number(sync.lineVoltageKV)} kV / ${number(sync.lineFrequencyHz,3)} Hz</dd><dt>Side 2</dt><dd>${number(sync.busVoltageKV)} kV / ${number(sync.busFrequencyHz,3)} Hz</dd><dt>Δ phase</dt><dd>${number(sync.phaseDifferenceDegrees,1)}°</dd><dt>Δ frequency</dt><dd>${number(sync.frequencyDifferenceHz,3)} Hz</dd><dt>Δ voltage</dt><dd>${number(sync.voltageDifferencePu,3)} pu</dd></dl><p>${sync.sameIsland?'Same connected island':sync.synchronizing?'Synchronizing active':'Separate islands'} · window 10° / 0.15 Hz / 0.05 pu</p>`:'')+(d.type==='transformer_2w'?`<p>Tap <strong>${d.tap}</strong> · ${esc(d.mode)}</p>`:'')+`<p>Remote ${d.remote===false?'NO':'YES'} · DC ${d.dc===false?'NO':'YES'}${d.lockout?' · LOCKOUT':''}</p>`;
    const latest=[...s.commands].reverse().find(c=>c.equipmentId===id);
    if(latest)$('.cx-face-values').insertAdjacentHTML('beforeend',`<p>Last command: ${esc(latest.action)} · ${esc(latest.lifecycle)}${latest.failureReason?' · '+esc(latest.failureReason):''}</p>`);
    readings(face);
  }
  root.addEventListener('click',e=>{
    if(!snap?.complex)return;
    const b=e.target.closest('[data-page],[data-unit-page],[data-device],[data-control]');if(!b)return;
    if(b.dataset.page){page=b.dataset.page;signature='';render(snap,api);return;}
    if(b.dataset.unitPage){unit=b.dataset.unitPage;signature='';render(snap,api);return;}
    if(b.dataset.device){api.chooseDevice(b.dataset.device);return;}
    if(b.dataset.control){
      const input=main.querySelector(`[data-input="${b.dataset.id}:${b.dataset.control}"]`);
      if(input&&(!input.value.trim()||!input.checkValidity())){input.reportValidity();return;}
      api.chooseDevice(b.dataset.id);api.selectAction(b.dataset.control,input?{requestedValue:Number(input.value),unit:b.dataset.unit}:{});
    }
  });
  shell.addEventListener('keydown',e=>{if((e.key==='Enter'||e.key===' ')&&e.target.matches('g[data-device]')){e.preventDefault();api.chooseDevice(e.target.dataset.device);}});
  window.ComplexTrainer={render,faceplate};
})();
