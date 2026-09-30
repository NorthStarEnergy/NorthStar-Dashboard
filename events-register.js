(() => {
  'use strict';
  const init = () => {
    const host=document.querySelector('#logbook');
    if(!host || document.querySelector('#eventRegister'))return;
    const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    const date=value=>{
      if(!(value&&!Number.isNaN(new Date(value).valueOf())))return'Time not supplied';
      if(window.NorthstarIesoTime)return`${NorthstarIesoTime.dateTime(value,true)} ET`;
      return new Date(value).toLocaleString([], {year:'numeric',month:'short',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23',timeZone:'America/Toronto',timeZoneName:'short'});
    };
    const original=host.querySelector('.logbook-layout');if(original){original.hidden=true;const composer=original.querySelector('.logbook-card');if(composer){composer.dataset.moduleId='event-composer';composer.setAttribute('aria-label','Write log entry');}}
    const root=document.createElement('div');root.id='eventRegister';
    root.innerHTML=`<header class="er-heading"><div><h1>Event Log</h1><p>Operations history · ${esc(Intl.DateTimeFormat().resolvedOptions().timeZone)} · Dashboard-only alarm controls</p></div><div class="er-actions"><button type="button" id="erWrite">＋ Log input</button><button type="button" id="erRefresh">Refresh</button></div></header>
      <nav class="er-views" role="toolbar" aria-label="Event log views"><button type="button" data-view="all" class="is-active">All events</button><button type="button" data-view="alarms">Alarms <span id="erAlarmCount">0</span></button><button type="button" data-view="shelved">Shelved</button><button type="button" data-view="disabled">Disabled</button></nav>
      <p class="er-control-note">Shelving temporarily hides an alarm in this dashboard. Disabling hides it until re-enabled. Neither action changes the alarm source or event history.</p>
      <details class="er-sources"><summary>Input sources and recording status</summary><div id="erSources">Loading source information…</div></details>
      <form id="erFilters" class="er-filters"><label class="er-search">Search events<input name="q" type="search" maxlength="500" placeholder="Message, equipment, person or event ID"></label>
      <details class="er-picker"><summary>Event types</summary><div id="erTypeOptions"></div></details><details class="er-picker"><summary>Sources</summary><div id="erSourceOptions"></div></details>
      <details class="er-picker"><summary>Severity</summary><div>${['info','warning','critical'].map(s=>`<label><input type="checkbox" name="severity" value="${s}">${s}</label>`).join('')}</div></details>
      <label>Status<select name="status" id="erStatusOptions"><option value="">All states</option></select></label><label>From<input type="datetime-local" name="from"></label><label>To<input type="datetime-local" name="to"></label>
      <label>Site<input name="site" placeholder="Any site"></label><label>Equipment<input name="equipment" placeholder="Equipment / node"></label><label>Actor / sender<input name="actor" placeholder="Any person"></label>
      <div class="er-actions"><button type="submit">Apply filters</button><button type="button" id="erClear">Clear filters</button></div></form>
      <div id="erChips" class="er-chips" aria-label="Active filters"></div><div class="er-statusbar"><span id="erCount">Loading events…</span><span id="erFreshness" role="status" aria-live="polite"></span></div>
      <button id="erNew" type="button" hidden>New events available — refresh list</button><div id="erError" role="alert" hidden></div>
      <div class="er-table-scroll"><table class="er-table"><thead><tr><th scope="col">Occurred</th><th scope="col">Severity</th><th scope="col">Event</th><th scope="col">Source / actor</th><th scope="col">Site</th><th scope="col">State at event</th><th scope="col">Dashboard alarm controls</th></tr></thead><tbody id="erRows"></tbody></table><p id="erEmpty" hidden>No matching events. Change or clear your filters.</p></div>
      <footer class="er-footer"><button type="button" id="erMore" hidden>Load older events</button><span>History is append-only. Notes do not acknowledge or clear alarms.</span></footer>`;
    host.prepend(root);
    const $=id=>document.getElementById(id);
    const form=$('erFilters');
    let rows=[],cursor=null,filters=new URLSearchParams(),snapshot=0,total=0,loading=false,listRequest=0,view='all';
    const controlKey='northstarEventAlarmControlsV1';let controls={};
    try{controls=JSON.parse(localStorage.getItem(controlKey)||'{}')||{};}catch{}
    const isAlarm=e=>e.category==='alarm'||['critical','warning'].includes(String(e.severity||'').toLowerCase());
    const alarmId=e=>e.aggregateId?`${e.aggregateType||'alarm'}:${e.aggregateId}`:e.eventId;
    const stateOf=e=>{const id=alarmId(e),s=controls[id];if(!s)return'';if(s.disabled)return'disabled';if(s.shelvedUntil&&s.shelvedUntil>Date.now())return'shelved';if(s.shelvedUntil){delete controls[id];try{localStorage.setItem(controlKey,JSON.stringify(controls));}catch{}}return'';};
    const saveControls=()=>{try{localStorage.setItem(controlKey,JSON.stringify(controls));}catch{}}
    try{filters=new URLSearchParams(sessionStorage.getItem('northstarEventFilters')||'');}catch{}
    let lastSuccess=null;
    async function json(url,options={}) {
      const response=await fetch(url,{cache:'no-store',...options});
      let body;try{body=await response.json();}catch{throw Error('The service returned an unreadable response.');}
      if(!response.ok){const error=Error(body.error||`Request failed (${response.status}).`);error.status=response.status;throw error;}
      return body;
    }
    const url=(path,params)=>path+'?'+params.toString();
    function currentFilters(){const p=new URLSearchParams();for(const [key,raw] of new FormData(form)){if(!raw)continue;let value=String(raw).trim();if(key==='from'||key==='to'){const parsed=new Date(value);if(Number.isNaN(parsed.valueOf()))throw Error('Choose a valid date range.');value=parsed.toISOString();}if(value)p.append(key,value);}if(p.has('from')&&p.has('to')&&p.get('from')>p.get('to'))throw Error('From must be before To.');return p;}
    function chips(){ $('erChips').innerHTML=[...filters].map(([k,v],i)=>`<button type="button" data-chip="${i}" title="Remove this filter">${esc(k)}: ${esc(k==='from'||k==='to'?date(v):v)} ×</button>`).join(''); }
    function render(){
      const focus=document.activeElement?.dataset.eventId;
      const alarms=rows.filter(isAlarm);$('erAlarmCount').textContent=alarms.filter(e=>!stateOf(e)).length;
      const shown=rows.filter(e=>{const s=stateOf(e);return view==='all'||(view==='alarms'&&isAlarm(e)&&!s)||(view==='shelved'&&s==='shelved')||(view==='disabled'&&s==='disabled');});
      $('erRows').innerHTML=shown.map(e=>{const href=String(e.href||'').startsWith('event-detail.html?id=')?e.href:`event-detail.html?id=${encodeURIComponent(e.eventId)}`;const alarm=isAlarm(e),state=stateOf(e),id=alarmId(e);const control=alarm?(state?`<span class="er-control-state">${state==='shelved'?'Shelved':'Disabled'}</span> <button type="button" data-alarm-action="enable" data-alarm-id="${esc(id)}">Re-enable</button>`:`<button type="button" data-alarm-action="shelve" data-alarm-id="${esc(id)}" aria-label="Shelve ${esc(e.summary||'alarm')} for one hour">Shelve 1h</button> <button type="button" data-alarm-action="disable" data-alarm-id="${esc(id)}" aria-label="Disable ${esc(e.summary||'alarm')} on this dashboard">Disable</button>`):'';return `<tr class="er-severity-${['critical','warning'].includes(e.severity)?e.severity:'info'}"><td>${esc(date(e.occurredAt))}</td><td><span class="er-severity">${esc(e.severity)}</span></td><td><a class="er-open" href="${esc(href)}" data-event-id="${esc(e.eventId)}">${esc(e.summary||e.eventType)}</a><small>${esc(e.category)} · ${esc(e.eventType)}</small></td><td>${esc(e.source)}<small>${esc(e.actorId)}</small></td><td>${esc(e.site||'—')}</td><td>${esc(e.status||'—')}</td><td class="er-controls">${control}</td></tr>`}).join('');
      if(focus)[...$('erRows').querySelectorAll('[data-event-id]')].find(b=>b.dataset.eventId===focus)?.focus();
      $('erCount').textContent=`${shown.length.toLocaleString()} shown · ${total.toLocaleString()} matching events`;
      $('erMore').hidden=!cursor;$('erMore').disabled=loading;$('erEmpty').hidden=shown.length>0;$('erEmpty').textContent=view==='alarms'?'No active alarms in the loaded events.':'No matching events. Change or clear your filters.';
    }
    async function load(older=false){
      if(older&&(!cursor||loading))return;
      try{sessionStorage.setItem('northstarEventFilters',filters.toString());}catch{}
      const request=++listRequest, p=new URLSearchParams(filters);p.set('limit','50');if(older)p.set('cursor',cursor);
      loading=true;$('erMore').disabled=true;$('erRefresh').disabled=true;$('erFreshness').textContent='Refreshing…';
      try {
        const result=await json(url('/api/events/register',p));if(request!==listRequest)return;
        rows=older?[...rows,...result.items.filter(e=>!rows.some(old=>old.eventId===e.eventId))]:result.items;
        cursor=result.nextCursor;total=result.total;snapshot=result.snapshot;lastSuccess=result.fetchedAt;
        $('erError').hidden=true;$('erNew').hidden=true;$('erFreshness').textContent='Updated '+date(lastSuccess);render();
      } catch(error){if(request!==listRequest)return;$('erError').hidden=false;$('erError').textContent=error.status===404?'The Events update needs a backend service restart. The existing logbook is available below.':`Unable to refresh: ${error.message} Previous results are retained; the requested filters have not been applied.`;if(error.status===404&&original)original.hidden=false;$('erFreshness').textContent=lastSuccess?'Stale · last successful update '+date(lastSuccess):'Event service unavailable';}
      finally{if(request===listRequest){loading=false;$('erRefresh').disabled=false;$('erMore').disabled=false;}}
    }
    form.onsubmit=e=>{e.preventDefault();try{filters=currentFilters();chips();form.querySelectorAll('details').forEach(d=>d.open=false);load();}catch(error){$('erError').hidden=false;$('erError').textContent=error.message;}};
    $('erClear').onclick=()=>{form.reset();filters=new URLSearchParams();chips();load();};
    $('erChips').onclick=e=>{const b=e.target.closest('[data-chip]');if(!b)return;const [key,value]=[...filters][Number(b.dataset.chip)];for(const input of form.elements){if(input.name!==key)continue;if(input.type==='checkbox'){if(input.value===value)input.checked=false;}else input.value='';}form.requestSubmit();};
    $('erRefresh').onclick=()=>load();$('erNew').onclick=()=>load();$('erMore').onclick=()=>load(true);
    root.querySelector('.er-views').onclick=e=>{const b=e.target.closest('[data-view]');if(!b)return;view=b.dataset.view;root.querySelectorAll('[data-view]').forEach(x=>x.classList.toggle('is-active',x===b));render();};
    $('erRows').onclick=e=>{const b=e.target.closest('[data-alarm-action]');if(!b)return;const id=b.dataset.alarmId;if(b.dataset.alarmAction==='shelve')controls[id]={shelvedUntil:Date.now()+3600000};else if(b.dataset.alarmAction==='disable')controls[id]={disabled:true};else delete controls[id];saveControls();render();};
    $('erWrite').onclick=()=>{if(original){if(window.NorthstarModules){window.NorthstarModules.open('logbook:event-composer');document.querySelector('#logSubject')?.focus();return;}original.hidden=!original.hidden;if(!original.hidden){original.scrollIntoView({behavior:'smooth'});document.querySelector('#logSubject')?.focus();}}};
    async function sourceInfo(){try{const data=await json('/api/events/sources');$('erSources').innerHTML=data.sources.map(s=>`<div><strong>${esc(s.label)}</strong><span>${esc(s.state)}</span><small>${s.count.toLocaleString()} recorded${s.lastRecordedAt?' · last '+esc(date(s.lastRecordedAt)):''}</small></div>`).join('')+`<p>${esc(data.note)}</p>`;
      for(const [target,name,items] of [['erTypeOptions','type',data.types],['erSourceOptions','source',data.sources]])$(target).innerHTML=items.map(s=>`<label><input type="checkbox" name="${name}" value="${esc(s.id)}">${esc(s.label)}</label>`).join('');
      $('erStatusOptions').innerHTML='<option value="">All states</option>'+data.statuses.map(s=>`<option value="${esc(s)}">${esc(s)}</option>`).join('');
    }catch(error){$('erSources').textContent='Source information unavailable: '+error.message;}}
    window.NorthStarEvents={open(id){if(id)window.location.assign('event-detail.html?id='+encodeURIComponent(id));}};
    const stream=document.querySelector('#eventsStream');
    if(stream){stream.addEventListener('click',e=>{if(e.target.closest('a[href]'))return;const row=e.target.closest('[data-event-id]');if(row)window.NorthStarEvents.open(row.dataset.eventId);});stream.addEventListener('keydown',e=>{if(['Enter',' '].includes(e.key)&&e.target.matches('[data-event-id]')){e.preventDefault();window.NorthStarEvents.open(e.target.dataset.eventId);}});}
    sourceInfo().then(()=>{for(const input of form.elements){if(!input.name)continue;const values=filters.getAll(input.name);if(input.type==='checkbox')input.checked=values.includes(input.value);else if(values.length){let value=values[0];if(input.type==='datetime-local'){const d=new Date(value);if(!Number.isNaN(d.valueOf()))value=new Date(d.valueOf()-d.getTimezoneOffset()*60000).toISOString().slice(0,16);}input.value=value;}}chips();});load();
    // The module workspace restores the section after its navigation is ready.
    setInterval(async()=>{if(document.hidden||!host.classList.contains('active')||loading)return;
      try{const p=new URLSearchParams(filters);p.set('limit','1');const result=await json(url('/api/events/register',p));if(result.snapshot>snapshot)$('erNew').hidden=false;}
      catch{if(lastSuccess)$('erFreshness').textContent='Refresh check failed · last loaded '+date(lastSuccess);}
    },30000);
  };
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();
