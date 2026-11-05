/* Mock spill inventory and browser-local movement records. No equipment commands. */
(() => {
  'use strict';
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const stamp = value => new Date(value).toLocaleString('en-CA', {dateStyle:'medium',timeStyle:'short'});
  const number = value => typeof value === 'number' && Number.isFinite(value);
  const lakes = [{id:'raft-lake',name:'Raft Lake'}, {id:'namakan-lake',name:'Namakan Lake'}];
  let devices = [], records = [], storageKey = '', roots = {}, selectedStation = '';
  function initialRecords(device) {
    const at = new Date(); at.setHours(8,0,0,0);
    return [{id:'initial:'+device.id,deviceId:device.id,at:at.toISOString(),operator:'Sample record',notes:'Opening position',before:null,after:device.kind==='logs'?{logs:12}:{position:device.index===1?25:0,flow:device.index===1?8.5:0,status:device.index===1?'Part open':'Closed'}}];
  }
  function validSnapshot(device, value) {
    if (!value || typeof value !== 'object') return false;
    return device.kind==='logs' ? Number.isInteger(value.logs) && value.logs>=0 && value.logs<=12 :
      number(value.position) && value.position>=0 && value.position<=100 && number(value.flow) && value.flow>=0 && ['Closed','Part open','Open','Unavailable'].includes(value.status) &&
      (value.status==='Unavailable' || (value.position===0?value.status==='Closed' && value.flow===0:value.position===100?value.status==='Open':value.status==='Part open'));
  }
  const current = device => records.filter(row=>row.deviceId===device.id).at(-1)?.after;
  function describe(device, value) {
    if (!value) return '—';
    return device.kind==='logs'?`${value.logs}/12 logs`:`${value.status} · ${value.position}% · ${value.flow.toFixed(1)} m³/s`;
  }
  function history(list, title) {
    const rows = records.filter(row=>list.some(d=>d.id===row.deviceId)).slice().reverse();
    return `<section class="spill-history"><h3>${esc(title)}</h3><div class="spill-table-wrap"><table><thead><tr><th>Time</th><th>Device</th><th>Movement</th><th>Recorded by</th><th>Notes</th></tr></thead><tbody>${rows.map(row=>{
      const device=devices.find(d=>d.id===row.deviceId);
      return `<tr><td><time datetime="${esc(row.at)}">${esc(stamp(row.at))}</time></td><td>${esc(device.label)}</td><td>${esc(describe(device,row.before))} → ${esc(describe(device,row.after))}</td><td>${esc(row.operator)}</td><td>${esc(row.notes)}</td></tr>`;
    }).join('')}</tbody></table></div></section>`;
  }
  const header = (name, description) => `<header class="spill-head"><div><p class="spill-eyebrow">OPERATIONS / SPILL</p><h2>${esc(name)}</h2><p>${esc(description)}</p></div><span class="spill-badge">Mock data</span></header>`;
  function card(device) {
    const value=current(device);
    const graphic=device.kind==='logs'?`<div class="spill-log-stack" role="img" aria-label="${esc(device.label)}: ${value.logs} of 12 logs installed">${Array.from({length:12},(_,i)=>`<span class="spill-log ${i<value.logs?'installed':''}"></span>`).join('')}</div>`:
      `<div class="spill-gate" role="img" aria-label="${esc(device.label)}: ${value.position}% open"><span style="height:${100-value.position}%"></span><i>${value.position}%</i></div>`;
    return `<article class="spill-device" data-spill-device="${esc(device.id)}"><div class="spill-device-head"><h3>${esc(device.label)}</h3><button type="button" data-record-spill="${esc(device.id)}">Record movement</button></div>${graphic}<dl class="spill-readings">${device.kind==='logs'?`<div><dt>Installed logs</dt><dd>${value.logs} / 12</dd></div><div><dt>Logs removed</dt><dd>${12-value.logs}</dd></div>`:`<div><dt>Status</dt><dd>${esc(value.status)}</dd></div><div><dt>Position</dt><dd>${value.position}% open</dd></div><div><dt>Flow</dt><dd>${value.flow.toFixed(1)} m³/s</dd></div>`}</dl>${history([device],'Movement log')}</article>`;
  }
  function renderLake(lake) {
    const list=devices.filter(d=>d.locationId===lake.id);
    roots[lake.id].innerHTML=header(lake.name,'Control dam · 4 illustrative bays · 12 logs per bay')+`<div class="spill-summary"><strong>${list.reduce((sum,d)=>sum+current(d).logs,0)} / 48 logs installed</strong><span>Movement records stay in this browser.</span></div><div class="spill-bays">${list.map(card).join('')}</div>`+history(list,`${lake.name} movement log`);
  }
  function renderGates() {
    const stations=[...new Map(devices.filter(d=>d.kind==='gate').map(d=>[d.locationId,{id:d.locationId,name:d.locationName}])).values()];
    if (!stations.some(s=>s.id===selectedStation)) selectedStation=stations[0]?.id || '';
    const list=devices.filter(d=>d.kind==='gate' && d.locationId===selectedStation);
    const name=stations.find(s=>s.id===selectedStation)?.name || '';
    roots.gates.innerHTML=header('Sluice Gates','Station gate register · status, position, flow and movement history')+`<label class="spill-station-select">Station<select id="spillStation">${stations.map(s=>`<option value="${esc(s.id)}" ${s.id===selectedStation?'selected':''}>${esc(s.name)}</option>`).join('')}</select></label><div class="spill-summary"><strong>${esc(name)} · ${list.length} gates</strong><span>Illustrative inventory and values · position is percent open</span></div><div class="spill-bays spill-gates">${list.map(card).join('')}</div>`+history(list,`${name} movement log`);
  }
  function renderHome() {
    roots.home.innerHTML=header('Spill','Control dams, station sluice gates and recorded movements')+`<div class="spill-links">${[...lakes,{id:'sluice-gates',name:'Sluice Gates'}].map(item=>`<button type="button" data-spill-open="operations:spill:${item.id}"><strong>${item.name}</strong><span>${item.id==='sluice-gates'?'Station gate status, position, flow and history':'12 logs per bay · bay and location movement logs'}</span></button>`).join('')}</div><p class="spill-note">Mock inventory. Records are saved locally in this browser; no equipment is operated.</p>`;
  }
  function openForm(device) {
    const value=current(device),dialog=document.getElementById('spillMovementDialog');
    dialog.innerHTML=`<form><div class="spill-device-head"><h2>Record movement · ${esc(device.locationName)} · ${esc(device.label)}</h2><button type="button" data-spill-close aria-label="Close movement form">×</button></div><p>Current: ${esc(describe(device,value))}</p>${device.kind==='logs'?'<label>Logs installed after movement<input name="logs" type="number" min="0" max="12" step="1" required value="'+value.logs+'"></label>':`<label>Status after movement<select name="status">${['Closed','Part open','Open','Unavailable'].map(s=>`<option ${s===value.status?'selected':''}>${s}</option>`).join('')}</select></label><label>Position after movement (% open)<input name="position" type="number" min="0" max="100" step="0.1" value="${value.position}" required></label><label>Flow after movement (m³/s)<input name="flow" type="number" min="0" step="0.1" value="${value.flow}" required></label>`}<label>Recorded by<input name="operator" maxlength="80" required autocomplete="name"></label><label>Movement notes<textarea name="notes" maxlength="500" required></textarea></label><p class="spill-form-error" role="alert"></p><button type="submit">Save movement record</button><p class="spill-note">Saved in this browser only.</p></form>`;
    dialog.querySelector('[name="operator"]').value=window.NORTHSTAR_OPERATOR_USERNAME || '';
    dialog.querySelector('[data-spill-close]').onclick=()=>dialog.close();
    dialog.querySelector('form').onsubmit=event=>{
      event.preventDefault();const form=event.target,fields=new FormData(form);
      const after=device.kind==='logs'?{logs:Number(fields.get('logs'))}:{position:Number(fields.get('position')),flow:Number(fields.get('flow')),status:fields.get('status')};
      const operator=String(fields.get('operator')).trim(),notes=String(fields.get('notes')).trim();
      const error=dialog.querySelector('[role="alert"]');
      if (!validSnapshot(device,after) || !operator || !notes) {error.textContent='Check the values. Closed gates require 0% and zero flow; open gates require 100%; part-open gates require a position between 0% and 100%.';return;}
      const next=[...records,{id:crypto.randomUUID(),deviceId:device.id,at:new Date().toISOString(),operator,notes,before:current(device),after}];
      try {localStorage.setItem(storageKey,JSON.stringify(next));} catch {error.textContent='The movement could not be saved. This browser’s storage is unavailable or full.';return;}
      records=next;dialog.close();if(device.kind==='logs')renderLake(lakes.find(l=>l.id===device.locationId));else renderGates();
    };
    dialog.showModal();
  }
  async function init() {
    await Promise.all([window.northstarLayoutReady,window.northstarOperatorSession,window.NorthStarSites?.ready]);
    const host=document.getElementById('operationsSites')?.closest('.section');
    if (!host || document.getElementById('spillHome')) return;
    let account;try{account=await window.northstarOperatorSession;}catch{}
    storageKey='northstarMockSpillV1:'+String(account?.username || 'local').toLowerCase();
    devices=lakes.flatMap(lake=>Array.from({length:4},(_,i)=>({id:`${lake.id}:bay:${i+1}`,kind:'logs',label:`Bay ${i+1}`,locationId:lake.id,locationName:lake.name,index:i+1})));
    const stations=(window.NorthStarSites?.stations() || []).filter(s=>!/(?:\bTS\b|\bkV\b)/i.test(s.name));
    devices.push(...stations.flatMap(station=>Array.from({length:2},(_,i)=>({id:`${station.id}:gate:${i+1}`,kind:'gate',label:`Gate ${i+1}`,locationId:station.id,locationName:station.name,index:i+1}))));
    records=devices.flatMap(initialRecords);
    try {
      const saved=JSON.parse(localStorage.getItem(storageKey) || 'null');
      if(Array.isArray(saved) && saved.length && saved.every(row=>{const device=devices.find(d=>d.id===row.deviceId);return device && typeof row.id==='string' && Number.isFinite(Date.parse(row.at)) && typeof row.operator==='string' && typeof row.notes==='string' && validSnapshot(device,row.after) && (row.before===null || validSnapshot(device,row.before));}) && devices.every(d=>saved.some(row=>row.deviceId===d.id))) records=saved;
    }catch{}
    for(const [key,id] of [['home','spillHome'],['raft-lake','spillRaftLake'],['namakan-lake','spillNamakanLake'],['gates','spillSluiceGates']]) {
      const el=document.createElement('article');el.id=id;el.className='panel spill-workspace';el.hidden=true;roots[key]=el;host.append(el);
    }
    const dialog=document.createElement('dialog');dialog.id='spillMovementDialog';dialog.className='spill-dialog';document.body.append(dialog);
    renderHome();lakes.forEach(renderLake);renderGates();
    host.addEventListener('click',event=>{
      const open=event.target.closest('[data-spill-open]');if(open)window.NorthstarModules?.open(open.dataset.spillOpen);
      const record=event.target.closest('[data-record-spill]');if(record)openForm(devices.find(d=>d.id===record.dataset.recordSpill));
    });
    host.addEventListener('change',event=>{if(event.target.id==='spillStation'){selectedStation=event.target.value;renderGates();}});
    window.addEventListener('storage',event=>{if(event.key===storageKey)location.reload();});
    window.NorthstarModules?.refresh();
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>init().catch(console.error),{once:true});else init().catch(console.error);
})();
