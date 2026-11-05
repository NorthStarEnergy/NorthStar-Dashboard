(() => {
  'use strict';
  const $=id=>document.getElementById(id);
  const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const label=word=>String(word??'').replaceAll('_',' ');
  const stamp=value=>value?new Date(value).toLocaleString():'Not yet';
  const state={sources:[],dirty:new Set(),tab:'sources',timer:null,rows:[],pages:[null],page:0,next:null,filters:{},ticket:0,connected:false};
  function notice(message,error=false){$('notice').textContent=message;$('notice').hidden=!message;$('notice').classList.toggle('error',error);}
  async function api(action,body){
    const response=await fetch('/api/water-collection/'+action,{method:body===undefined?'GET':'POST',headers:{Accept:'application/json',...(body===undefined?{}:{'Content-Type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)})});
    let data;try{data=await response.json();}catch{throw new Error('Water collection API is unavailable. Check that NorthStar has been restarted after the update.');}
    if(!response.ok)throw new Error(data.error||'Collection request failed ('+response.status+')');
    return data;
  }
  const handle=fn=>async event=>{try{await fn(event);}catch(error){notice(error.message,true);}};
  function sourceName(id){return state.sources.find(s=>s.id===id)?.name||id;}
  function stationName(source,id){return state.sources.find(s=>s.id===source)?.stations.find(g=>g.id===id)?.name||id;}
  function card(source){
    const recentlyFinished=source.last_finished_at&&Date.now()-new Date(source.last_finished_at).getTime()<60000;
    const active=!!source.active_run_id, cooldown=source.backoff_until&&new Date(source.backoff_until)>new Date();
    const selected=source.stations.filter(g=>source.station_ids.includes(g.id)).length;
    return `<article class="source-card" id="source-${source.id}"><header><h2>${esc(source.name)}</h2><span class="state ${esc(source.last_state)}">${esc(label(active?source.active_run_status:source.last_state))}</span></header>
      <a class="provider-link" href="${esc(source.reference)}" target="_blank" rel="noreferrer">Official provider ↗</a>
      <dl><dt>Stored readings</dt><dd>${source.total_observations.toLocaleString()}</dd><dt>Latest observed</dt><dd>${esc(stamp(source.last_observation_at))}</dd><dt>Last successful run</dt><dd>${esc(stamp(source.last_success_at))}</dd><dt>Next scheduled</dt><dd>${source.enabled?esc(stamp(source.next_run_at)):'Paused'}</dd></dl>
      <form data-source="${source.id}" data-version="${source.version}"><label class="schedule-toggle"><input name="enabled" type="checkbox" ${source.enabled?'checked':''}>Automatic collection enabled</label>
      <div class="schedule-fields"><label>Interval (minutes)<input name="interval" type="number" min="5" max="10080" step="1" required value="${source.interval_minutes}"></label><label>Recent window (hours)<input name="lookback" type="number" min="1" max="168" step="1" required value="${source.lookback_hours}"></label></div>
      <details><summary>Gauges · ${selected} selected</summary><div class="station-choices">${source.stations.map(g=>`<label><input name="station" type="checkbox" value="${esc(g.id)}" ${source.station_ids.includes(g.id)?'checked':''} ${g.active?'':'disabled'}><span>${esc(g.id)} · ${esc(g.name)}${g.active?'':' · Historical only'}</span></label>`).join('')}</div></details>
      ${source.note?`<p class="muted">${esc(source.note)}</p>`:''}
      <div class="card-actions"><button type="submit">Save schedule</button><button type="button" class="primary" data-collect="${source.id}" ${active||cooldown||recentlyFinished?'disabled':''}>${active?'Collecting…':cooldown?'Provider cooldown':recentlyFinished?'Just collected':'Collect now'}</button></div><div class="unsaved" hidden>Unsaved changes</div></form>
      ${source.last_error?`<p class="source-error">${esc(source.last_error)}</p>`:''}</article>`;
  }
  function bindCard(id){
    const form=$('source-'+id).querySelector('form');
    form.oninput=()=>{state.dirty.add(id);form.querySelector('.unsaved').hidden=false;};
    form.onsubmit=handle(async e=>{e.preventDefault();const button=form.querySelector('[type=submit]');button.disabled=true;try{
      await api('sources/'+id,{version:Number(form.dataset.version),enabled:form.elements.enabled.checked,intervalMinutes:Number(form.elements.interval.value),lookbackHours:Number(form.elements.lookback.value),stationIds:[...form.querySelectorAll('[name=station]:checked')].map(x=>x.value)});
      state.dirty.delete(id);notice('Schedule saved. Changes apply to future runs.');await loadStatus();
    }finally{button.disabled=false;}});
    form.querySelector('[data-collect]').onclick=handle(async e=>{if(state.dirty.has(id))throw new Error('Save this provider’s schedule changes before collecting.');const button=e.currentTarget;button.disabled=true;try{const run=await api('collect',{source:id});notice(run.alreadyRunning?'This provider already has an active run.':'Collection queued. Follow its progress in Run history.');await loadStatus();if(state.tab==='runs')await loadRuns();}finally{if(button.isConnected)button.disabled=false;}});
  }
  function stationOptions(){
    const selected=$('stationFilter').value,provider=$('sourceFilter').value;
    $('stationFilter').innerHTML='<option value="">All gauges</option>'+state.sources.filter(s=>!provider||s.id===provider).flatMap(s=>s.stations.map(g=>`<option value="${esc(g.id)}">${esc(s.id.toUpperCase()+' · '+g.id+' · '+g.name)}</option>`)).join('');
    if([...$('stationFilter').options].some(o=>o.value===selected))$('stationFilter').value=selected;
  }
  async function loadStatus(){
    clearTimeout(state.timer);
    try{
      const data=await api('status');state.sources=data.sources;state.connected=true;
      $('sourceCards').classList.remove('unavailable');$('connection').textContent='● PostgreSQL connected';$('connection').className='connection ready';
      $('providerCount').textContent=data.sources.length;$('observationCount').textContent=data.sources.reduce((n,s)=>n+s.total_observations,0).toLocaleString();$('scheduleCount').textContent=data.sources.filter(s=>s.enabled).length;
      for(const s of data.sources){if(state.dirty.has(s.id))continue;const old=$('source-'+s.id);if(old)old.outerHTML=card(s);else $('sourceCards').insertAdjacentHTML('beforeend',card(s));bindCard(s.id);}
      const selected=$('sourceFilter').value;$('sourceFilter').innerHTML='<option value="">All providers</option>'+data.sources.map(s=>`<option value="${s.id}">${esc(s.name)}</option>`).join('');$('sourceFilter').value=selected;stationOptions();
      $('unconfigured').innerHTML='<ul>'+data.unconfigured.map(s=>`<li><strong>${esc(s.name)}</strong> — ${esc(s.reason)}</li>`).join('')+'</ul>';
    }catch(error){state.connected=false;$('sourceCards').classList.add('unavailable');$('connection').textContent='Connection unavailable';$('connection').className='connection failed';throw error;}
    finally{if(!document.hidden)state.timer=setTimeout(()=>loadStatus().then(()=>state.tab==='runs'?loadRuns():null).catch(e=>notice(e.message,true)),state.sources.some(s=>s.active_run_id)?5000:30000);}
  }
  function filters(){
    const result={source:$('sourceFilter').value,station:$('stationFilter').value,metric:$('metricFilter').value};
    for(const k of ['start','end'])if($(k+'Filter').value)result[k]=new Date($(k+'Filter').value).toISOString();
    return result;
  }
  function reset(){state.pages=[null];state.page=0;state.next=null;}
  async function loadObservations(){
    const ticket=++state.ticket;$('pageStatus').textContent='Loading observations…';
    const query=new URLSearchParams({...state.filters,limit:100,...(state.pages[state.page]?{cursor:state.pages[state.page]}:{})});
    try{const data=await api('observations?'+query);if(ticket!==state.ticket)return;state.rows=data.rows;state.next=data.nextCursor;
      $('observations').querySelector('tbody').innerHTML=data.rows.map(r=>`<tr data-id="${r.id}" tabindex="0" aria-label="View observation revisions"><td>${esc(r.source_id.toUpperCase())}</td><td title="${esc(stationName(r.source_id,r.station_id))}">${esc(r.station_id)}</td><td>${esc(label(r.metric))}</td><td>${r.value==null?'—':esc(r.value.toLocaleString(undefined,{maximumFractionDigits:5}))}</td><td>${esc(r.unit)}</td><td>${esc(r.datum||'—')}</td><td>${esc(r.observed_at)}</td><td>${r.revision}</td></tr>`).join('');
      $('observations').querySelectorAll('[data-id]').forEach(row=>{row.onclick=handle(()=>history(row.dataset.id));row.onkeydown=e=>{if(e.key==='Enter')row.click();};});
      $('emptyObservations').hidden=!!data.rows.length;$('pageStatus').textContent=data.rows.length+' observations on this page';$('pageNumber').textContent='Page '+(state.page+1);$('previous').disabled=state.page===0;$('next').disabled=!state.next;
    }catch(error){if(ticket===state.ticket){state.rows=[];state.next=null;$('observations').querySelector('tbody').innerHTML='';$('emptyObservations').hidden=true;$('next').disabled=true;$('pageStatus').textContent='Observations unavailable';notice(error.message,true);}}
  }
  async function history(id){
    $('observationHistory').textContent='Loading revisions…';$('historyDialog').showModal();
    try{const data=await api('history?id='+encodeURIComponent(id));
      $('observationHistory').innerHTML=data.items.length?data.items.map(r=>`<div class="revision-block"><strong>Revision ${r.revision}</strong> · collected ${esc(stamp(r.at))}<p>${esc(r.record.value??'Missing')} ${esc(r.record.unit)} · ${esc(r.record.datum||'Discharge')}</p><details><summary>Original value, quality and source</summary><pre>${esc(JSON.stringify({rawValue:r.record.raw_value,rawUnit:r.record.raw_unit,quality:r.record.quality,source:r.record.source_url,run:r.run_id},null,2))}</pre></details></div>`).join(''):'No revision history found.';
    }catch(error){$('observationHistory').textContent=error.message;}
  }
  async function loadRuns(){
    const data=await api('runs');
    $('runHistory').innerHTML=data.items.length?data.items.map(r=>`<article class="collection-run"><header><span class="state ${esc(r.status)}">${esc(label(r.status))}</span><strong>${esc(sourceName(r.source_id))}</strong><span>${esc(r.mode)} · ${esc(r.actor)}</span><small>${esc(stamp(r.created_at))}</small></header><p>${r.inserted.toLocaleString()} new · ${r.revised.toLocaleString()} revised · ${r.unchanged.toLocaleString()} unchanged · ${r.stations_done} gauges checked</p>${r.error?`<p class="source-error">${esc(r.error)}</p>`:''}<details><summary>Gauge details · ${esc(r.id.slice(0,8))}</summary>${r.details.map(d=>`<div class="run-detail">${esc(d.station)} · ${esc(label(d.state))} ${d.message?'· '+esc(d.message):'· '+(d.inserted||0)+' new / '+(d.revised||0)+' revised'}</div>`).join('')}</details></article>`).join(''):'<div class="empty-state"><h2>No collection runs yet</h2><p>Run a provider now or wait for its next scheduled collection.</p></div>';
  }
  function showTab(tab){state.tab=tab;document.querySelectorAll('[data-tab]').forEach(b=>b.setAttribute('aria-selected',String(b.dataset.tab===tab)));for(const key of ['sources','observations','runs'])$('panel-'+key).hidden=key!==tab;if(tab==='observations')loadObservations();if(tab==='runs')loadRuns().catch(e=>notice(e.message,true));}
  document.querySelectorAll('[data-tab]').forEach(b=>b.onclick=()=>showTab(b.dataset.tab));
  $('refresh').onclick=handle(async()=>{if(state.dirty.size&&!window.confirm('Discard unsaved schedule changes and reload?'))return;state.dirty.clear();notice('');await loadStatus();if(state.tab==='observations')await loadObservations();if(state.tab==='runs')await loadRuns();});
  $('refreshRuns').onclick=handle(loadRuns);$('sourceFilter').onchange=stationOptions;
  $('applyFilters').onclick=()=>{state.filters=filters();reset();loadObservations();};
  $('clearFilters').onclick=()=>{for(const id of ['sourceFilter','stationFilter','metricFilter','startFilter','endFilter'])$(id).value='';stationOptions();state.filters={};reset();loadObservations();};
  $('next').onclick=()=>{if(state.next){state.pages.push(state.next);state.page++;loadObservations();}};$('previous').onclick=()=>{if(state.page){state.pages.pop();state.page--;loadObservations();}};
  $('closeHistory').onclick=()=>$('historyDialog').close();
  $('exportPage').onclick=()=>{const keys=['source_id','station_id','series','metric','observed_at','value','unit','datum','raw_value','raw_unit','revision'];const cell=v=>{let t=v==null?'':String(v);if(typeof v==='string'&&/^\s*[=+\-@]/.test(t))t="'"+t;return '"'+t.replaceAll('"','""')+'"';};const csv=[keys.join(','),...state.rows.map(r=>keys.map(k=>cell(r[k])).join(','))].join('\r\n');const url=URL.createObjectURL(new Blob(['\ufeff'+csv],{type:'text/csv'}));const link=document.createElement('a');link.href=url;link.download='northstar-public-water-page-'+(state.page+1)+'.csv';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
  window.addEventListener('beforeunload',e=>{if(state.dirty.size){e.preventDefault();e.returnValue='';}});
  window.addEventListener('pagehide',()=>clearTimeout(state.timer));
  document.addEventListener('visibilitychange',()=>{if(document.hidden)clearTimeout(state.timer);else loadStatus().catch(e=>notice(e.message,true));});
  loadStatus().catch(e=>notice(e.message,true));
})();
