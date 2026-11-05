(() => {
  'use strict';
  const root=document.querySelector('.switching-sim'); if(!root)return;
  const $=s=>root.querySelector(s), esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const shell=document.createElement('section');shell.className='r013';shell.hidden=true;
  shell.innerHTML='<header><div><small>SIMULATION ONLY · SOURCE-QUALIFIED DRAFT</small><h2>Island / Twin / Iroquois · r013</h2></div><div class="r013-summary"></div></header><p class="r013-warning">Unverified: no as-built acceptance. Auxiliary availability, impedances, dynamics and initial positions are assumptions. Amber ? devices have unresolved wiring or operating duty; their controls are disabled. Wires show source geometry, not energization.</p><div class="r013-toolbar"><button data-zoom="out">Zoom out</button><button data-zoom="fit">Fit drawing</button><button data-zoom="in">Zoom in</button><output class="r013-zoom" aria-live="polite">100%</output><button data-fullscreen>Full screen</button><button data-details aria-expanded="false">Device details</button><span class="r013-pan-help">Scroll to zoom &middot; drag to pan &middot; Esc to exit</span><label>Device <select class="r013-picker" aria-label="r013 device"></select></label></div><div class="r013-layout"><div class="r013-scroll" tabindex="0" aria-label="Schematic viewport: scroll to zoom, drag or arrow keys to pan"><div class="r013-drawing">Loading r013 drawing…</div></div><aside class="r013-face"></aside></div><details><summary>Assumptions and unresolved connections</summary><ul class="r013-limitations"></ul><p>600 V IR G11–13 step-up routes, station-service supply routes, T12/T14 sluice wiring and remaining unidentified targets have no inferred connection. Circuit switchers remain fixed training boundaries. Original demo colors are not used as feedback.</p></details>';
  $('.sim-unit-panel').before(shell);
  const buses=document.createElement('div');buses.className='r013-buses';buses.setAttribute('aria-label','Simulated bus voltages');
  shell.querySelector('.r013-toolbar').after(buses);
  let snap,api,loaded=false,loading=false,zoom=100,faceId='',sessionKey='';
  const face=$('.sim-faceplate');
  const viewport=shell.querySelector('.r013-scroll'), drawing=shell.querySelector('.r013-drawing');
  let drag=null,suppressClick=false;
  function setZoom(next,x=viewport.clientWidth/2,y=viewport.clientHeight/2){
    const old=drawing.getBoundingClientRect().width;
    const px=viewport.scrollLeft+x,py=viewport.scrollTop+y;
    zoom=Math.max(10,Math.min(600,next));
    drawing.style.width=zoom+'%';
    const ratio=drawing.getBoundingClientRect().width/old;
    viewport.scrollLeft=px*ratio-x;viewport.scrollTop=py*ratio-y;
    shell.querySelector('.r013-zoom').textContent=Math.round(zoom)+'%';
  }
  function fitDrawing(){const svg=drawing.querySelector('svg');const box=svg?.viewBox.baseVal;if(!box?.width)return;setZoom(Math.min(100,100*viewport.clientHeight*box.width/(viewport.clientWidth*box.height)));viewport.scrollLeft=0;viewport.scrollTop=0;}
  function details(show){shell.classList.toggle('r013-show-details',show);shell.querySelector('[data-details]').setAttribute('aria-expanded',String(show));}
  function leaveFullscreen(){shell.classList.remove('r013-expanded');shell.querySelector('[data-fullscreen]').textContent='Full screen';document.body.style.overflow=previousOverflow;}
  let previousOverflow='';
  async function fullscreen(){
    if(shell.classList.contains('r013-expanded')){if(document.fullscreenElement===shell)await document.exitFullscreen();leaveFullscreen();return;}
    previousOverflow=document.body.style.overflow;document.body.style.overflow='hidden';shell.classList.add('r013-expanded');shell.querySelector('[data-fullscreen]').textContent='Exit full screen';
    try{if(shell.requestFullscreen)await shell.requestFullscreen();}catch(_){/* The viewport overlay remains available when native fullscreen is denied. */}
  }
  document.addEventListener('fullscreenchange',()=>{if(!document.fullscreenElement&&shell.classList.contains('r013-expanded'))leaveFullscreen();});
  document.addEventListener('keydown',e=>{if(e.key==='Escape'&&shell.classList.contains('r013-expanded')){if(document.fullscreenElement===shell)document.exitFullscreen();leaveFullscreen();}});
  viewport.addEventListener('wheel',e=>{e.preventDefault();const r=viewport.getBoundingClientRect();setZoom(zoom*Math.exp(-e.deltaY*.002),e.clientX-r.left,e.clientY-r.top);},{passive:false});
  viewport.addEventListener('pointerdown',e=>{if(e.button!==0)return;drag={id:e.pointerId,x:e.clientX,y:e.clientY,left:viewport.scrollLeft,top:viewport.scrollTop,moved:false};suppressClick=false;});
  viewport.addEventListener('pointermove',e=>{if(!drag||drag.id!==e.pointerId)return;const dx=e.clientX-drag.x,dy=e.clientY-drag.y;if(!drag.moved&&Math.hypot(dx,dy)>5){drag.moved=true;viewport.setPointerCapture(e.pointerId);viewport.classList.add('is-panning');}if(drag.moved){viewport.scrollLeft=drag.left-dx;viewport.scrollTop=drag.top-dy;}});
  function endPan(){if(drag?.moved)suppressClick=true;drag=null;viewport.classList.remove('is-panning');}
  viewport.addEventListener('pointerup',endPan);viewport.addEventListener('pointercancel',endPan);
  viewport.addEventListener('keydown',e=>{if(e.target!==viewport)return;const moves={ArrowLeft:[-80,0],ArrowRight:[80,0],ArrowUp:[0,-80],ArrowDown:[0,80]};if(moves[e.key]){e.preventDefault();viewport.scrollBy(...moves[e.key]);}if(['+','=','-','0'].includes(e.key)){e.preventDefault();if(e.key==='0')fitDrawing();else setZoom(zoom*(e.key==='-'?.8:1.25));}});

  const find=id=>snap.equipment.find(d=>d.equipmentId===id);
  const number=v=>Number.isFinite(v)?v.toFixed(2):'—';

  async function loadDrawing(){
    if(loaded||loading)return;loading=true;
    try {
      const response=await fetch('trainer-assets/r013/runtime.svg');if(!response.ok)throw new Error('Drawing unavailable');
      const doc=new DOMParser().parseFromString(await response.text(),'image/svg+xml');
      if(doc.querySelector('parsererror,script,foreignObject')||doc.documentElement.localName!=='svg')throw new Error('Invalid drawing');
      for(const el of doc.querySelectorAll('*'))for(const a of [...el.attributes])if(a.name.startsWith('on')||['href','xlink:href'].includes(a.name))el.removeAttribute(a.name);
      shell.querySelector('.r013-drawing').replaceChildren(document.importNode(doc.documentElement,true));
      loaded=true;update();
    }catch(e){shell.querySelector('.r013-drawing').textContent=e.message+' — device list remains available.';}
    finally{loading=false;}
  }
  function update(){
    if(!snap?.r013)return;
    const devices=snap.equipment;
    shell.querySelector('.r013-summary').textContent=`21 units · ${devices.filter(d=>d.type==='generator'&&d.sequenceState==='ONLINE').length} online · ${snap.status.toUpperCase()}`;
    buses.innerHTML=['CTS-M1','CTS-T8LV','CTS-T9LV','IS-B1','IS-B2','TF-B1','TF-B2','IR-B1','IR-B2'].map(id=>{
      const n=snap.electrical.nodes[id];return `<span><b>${id}</b> ${number(n.voltageKVLL)} kV · ${n.energization==='deenergized'?'DEAD':n.gridConnected?'GRID':'ISLAND'}</span>`;
    }).join('');
    shell.querySelectorAll('g[data-device]').forEach(g=>{
      const d=find(snap.drawingBindings[g.dataset.device]);if(!d)return;
      const unresolved=d.controlBlocked,position=d.indicationQuality==='good'?d.reportedPosition:null;
      const status=unresolved?'?':position==='closed'?'C':position==='open'?'O':({STOPPED:'OFF',ONLINE:'ON',STARTING:'START',STOPPING:'STOP'}[d.sequenceState]||d.sequenceState||'');
      g.classList.toggle('r013-unresolved',!!unresolved);
      g.setAttribute('aria-label',`${d.equipmentId} · ${unresolved?'UNRESOLVED':status||'draft'} · simulator details`);
      const symbol=g.querySelector('[data-northstar-symbol]');
      if(symbol){
        const color=unresolved?'#f2bc61':position==='closed'?'#43d17d':position==='open'?'#f06464':'#9db0c0';
        symbol.querySelectorAll('path,rect,circle').forEach(el=>el.setAttribute('stroke',color));symbol.setAttribute('stroke',color);
        if(!unresolved)g.querySelectorAll('text').forEach(t=>{if(t.textContent==='?')t.remove();});
        let bar=symbol.querySelector('[data-position-bar]');
        if(!bar&&symbol.dataset.northstarSymbol==='breaker'){
          bar=document.createElementNS('http://www.w3.org/2000/svg','path');bar.setAttribute('data-position-bar','simulation');symbol.append(bar);
        }
        if(bar){bar.setAttribute('d',position==='closed'?'M-22 0 H22':'M0 -17 V17');bar.setAttribute('visibility',unresolved?'hidden':'visible');}
      }
      let label=g.querySelector('.r013-status');
      if(!label){
        const box=g.getBBox();label=document.createElementNS('http://www.w3.org/2000/svg','text');label.setAttribute('class','r013-status');
        label.setAttribute('x',box.x);label.setAttribute('y',box.y-7);g.append(label);
      }
      label.textContent=status;label.setAttribute('fill',unresolved?'#f2bc61':'#e4edf5');
    });
    shell.querySelectorAll('[data-r013-action]').forEach(b=>b.disabled=snap.status!=='running');
  }
  function render(s,callbacks){
    snap=s;api=callbacks;shell.hidden=!s.r013;if(!s.r013){faceId='';return;}
    $('.sim-unit-panel').hidden=true;$('.sim-diagram').closest('.sim-card').hidden=true;$('.sim-measurements').hidden=true;
    $('.sim-workspace').classList.add('complex-active');
    $('.sim-actions').querySelectorAll('[data-action]').forEach(b=>b.hidden=true);
    shell.querySelector('.r013-face').append(face);
    const key=s.sessionId+':'+s.runId;
    if(sessionKey!==key){
      sessionKey=key;faceId='';
      $('.sim-device').textContent='Select a device in r013 or the device list to inspect simulated state and source notes.';
      shell.querySelector('.r013-picker').innerHTML='<option value="">Choose device…</option>'+Object.entries(s.drawingBindings).map(([source,id])=>`<option value="${esc(id)}">${esc(source)} → ${esc(id)}${find(id).controlBlocked?' · UNRESOLVED':''}</option>`).join('');
      shell.querySelector('.r013-limitations').innerHTML=s.limitations.map(x=>`<li>${esc(x)}</li>`).join('');
    }
    $('.sim-limitations').textContent=s.limitations.join(' ');loadDrawing();update();
  }
  function faceplate(s,id){
    snap=s;const d=find(id);if(!d)return;
    $('.sim-actions').querySelectorAll('[data-action]').forEach(b=>b.hidden=true);
    if(faceId!==id){
      details(true);faceId=id;
      const actions=d.actions.filter(a=>['start','stop','emergency_stop','open','close','close_dead','synchronize','cancel_sync','reset_lockout','reset_86','reset_94'].includes(a));
      $('.sim-device').innerHTML=`<h3>${esc(d.sourceDetails?.title||d.sourceDetails?.Equipment||d.label)}</h3><p>${esc(id)} · ${esc(d.type)}</p><p class="r013-warning">${esc(d.verification?.note)}</p><div class="r013-values"></div><div class="r013-controls">${actions.map(a=>`<button data-r013-action="${a}">${esc({close:'Close · sync check',close_dead:'Energize dead bus'}[a]||a.replaceAll('_',' '))}</button>`).join('')}</div>${d.actions.includes('setpoint')?`<label>Simulated MW demand <input class="r013-mw" type="number" min="0" max="${d.parameters.ratedMW}" step="0.1" value="${d.requestedMW}" aria-label="Simulated MW demand"></label><button data-r013-action="setpoint">Select MW demand</button>`:''}<details><summary>Original r013 source notes (historical demo)</summary><dl>${Object.entries(d.sourceDetails||{}).map(([k,v])=>`<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl></details>`;
    }
    const terminals=d.terminals.map(t=>{const n=s.electrical.nodes[t.nodeId];return `<p>${esc(t.nodeId)}: ${number(n?.voltageKVLL)} kV · ${number(n?.frequencyHz)} Hz · ${n?.gridConnected?'GRID':'NO GRID'}</p>`;}).join('');
    const latest=[...s.commands].reverse().find(c=>c.equipmentId===id);
    $('.r013-values').innerHTML=`<p><strong>${d.controlBlocked?'UNRESOLVED · CONTROLS BLOCKED':esc(d.reportedPosition||d.sequenceState||'SIMULATED')}</strong></p>${terminals}${d.type==='generator'?`<p>${number(d.activeMW)} MW · ${number(d.reactiveMvar)} Mvar · ${number(d.currentA)} A</p><p>Training limit ${d.parameters.ratedMW} MW; source nameplate ${d.parameters.ratedMVA} MVA</p><p>Auxiliaries: assumed available; supply wiring unresolved.</p>`:''}${d.sync?.phaseDifferenceDegrees!==undefined?`<p>Sync difference: ${number(d.sync.phaseDifferenceDegrees)}° / ${number(d.sync.frequencyDifferenceHz)} Hz / ${number(d.sync.voltageDifferencePu)} pu</p>`:''}${latest?`<p>Last command: ${esc(latest.action)} · ${esc(latest.lifecycle)}${latest.failureReason?' · '+esc(latest.failureReason):''}</p>`:''}`;
    update();
  }
  shell.addEventListener('click',e=>{
    if(e.target.closest('[data-fullscreen]')){fullscreen();return;}
    if(e.target.closest('[data-details]')){details(!shell.classList.contains('r013-show-details'));return;}
    const z=e.target.closest('[data-zoom]');if(z){if(z.dataset.zoom==='fit')fitDrawing();else setZoom(zoom*(z.dataset.zoom==='in'?1.25:.8));return;}
    if(suppressClick){suppressClick=false;return;}
    const g=e.target.closest('[data-device]');if(g){api.chooseDevice(snap.drawingBindings[g.dataset.device]);return;}
    const b=e.target.closest('[data-r013-action]');if(!b)return;
    let extra={};if(b.dataset.r013Action==='setpoint'){const input=$('.r013-mw');if(!input.value.trim()||!input.checkValidity()){input.reportValidity();return;}extra={requestedValue:Number(input.value),unit:'MW'};}
    api.selectAction(b.dataset.r013Action,extra);
  });
  shell.addEventListener('keydown',e=>{const g=e.target.closest('g[data-device]');if(g&&['Enter',' '].includes(e.key)){e.preventDefault();api.chooseDevice(snap.drawingBindings[g.dataset.device]);}});
  shell.querySelector('.r013-picker').addEventListener('change',e=>{if(e.target.value)api.chooseDevice(e.target.value);});
  window.R013Trainer={render,faceplate};
})();
