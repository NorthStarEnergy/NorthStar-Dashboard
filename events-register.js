(() => {
  'use strict';
  const init = () => {
    const host=document.querySelector('#logbook');
    if(!host || document.querySelector('#eventRegister'))return;
    const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    const date=value=>{const d=new Date(value);return value&&!Number.isNaN(d.valueOf())?d.toLocaleString([], {year:'numeric',month:'short',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',timeZoneName:'short'}):'Time not supplied';};
    const original=host.querySelector('.logbook-layout');if(original)original.hidden=true;
    const root=document.createElement('div');root.id='eventRegister';
    root.innerHTML=`<header class="er-heading"><div><h1>Events</h1><p>Operations history · ${esc(Intl.DateTimeFormat().resolvedOptions().timeZone)}</p></div><div class="er-actions"><button type="button" id="erWrite">Write log entry</button><button type="button" id="erRefresh">Refresh</button></div></header>
      <details class="er-sources"><summary>Input sources and recording status</summary><div id="erSources">Loading source information…</div></details>
      <form id="erFilters" class="er-filters"><label class="er-search">Search events<input name="q" type="search" maxlength="500" placeholder="Message, equipment, person or event ID"></label>
      <details class="er-picker"><summary>Event types</summary><div id="erTypeOptions"></div></details><details class="er-picker"><summary>Sources</summary><div id="erSourceOptions"></div></details>
      <details class="er-picker"><summary>Severity</summary><div>${['info','warning','critical'].map(s=>`<label><input type="checkbox" name="severity" value="${s}">${s}</label>`).join('')}</div></details>
      <label>Status<select name="status" id="erStatusOptions"><option value="">All states</option></select></label><label>From<input type="datetime-local" name="from"></label><label>To<input type="datetime-local" name="to"></label>
      <label>Site<input name="site" placeholder="Any site"></label><label>Equipment<input name="equipment" placeholder="Equipment / node"></label><label>Actor / sender<input name="actor" placeholder="Any person"></label>
      <div class="er-actions"><button type="submit">Apply filters</button><button type="button" id="erClear">Clear filters</button></div></form>
      <div id="erChips" class="er-chips" aria-label="Active filters"></div><div class="er-statusbar"><span id="erCount">Loading events…</span><span id="erFreshness" role="status" aria-live="polite"></span></div>
      <button id="erNew" type="button" hidden>New events available — refresh list</button><div id="erError" role="alert" hidden></div>
      <div class="er-table-scroll"><table class="er-table"><thead><tr><th scope="col">Occurred</th><th scope="col">Severity</th><th scope="col">Event</th><th scope="col">Source / actor</th><th scope="col">Site</th><th scope="col">State at event</th></tr></thead><tbody id="erRows"></tbody></table><p id="erEmpty" hidden>No matching events. Change or clear your filters.</p></div>
      <footer class="er-footer"><button type="button" id="erMore" hidden>Load older events</button><span>History is append-only. Notes do not acknowledge or clear alarms.</span></footer>`;
    host.prepend(root);
    const dialog=document.createElement('dialog');dialog.className='er-detail';dialog.setAttribute('aria-labelledby','erDetailTitle');
    dialog.innerHTML=`<header><h2 id="erDetailTitle">Event history</h2><button id="erClose" type="button">Close</button></header><div id="erDetailStatus" role="status"></div><div id="erSelected"></div><h3>Related history <small>Newest first</small></h3><ol id="erHistory"></ol><button type="button" id="erHistoryMore" hidden>Load older history</button><form id="erNoteForm"><label>Append an operator note<textarea id="erNote" maxlength="8000" required rows="3" placeholder="Record context or follow-up for this event"></textarea></label><button type="submit">Add note</button><span id="erNoteStatus" role="status"></span></form>`;
    document.body.append(dialog);
    const $=id=>document.getElementById(id);
    const form=$('erFilters');
    let rows=[],cursor=null,filters=new URLSearchParams(),snapshot=0,total=0,loading=false,listRequest=0;
    let selectedId=null,historyCursor=null,detailRequest=0,history=[],noteAttempt=null;
    let lastSuccess=null,lastSelectionTrigger=null;
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
      $('erRows').innerHTML=rows.map(e=>`<tr class="er-severity-${['critical','warning'].includes(e.severity)?e.severity:'info'}"><td>${esc(date(e.occurredAt))}</td><td><span class="er-severity">${esc(e.severity)}</span></td><td><button class="er-open" type="button" data-event-id="${esc(e.eventId)}">${esc(e.summary||e.eventType)}</button><small>${esc(e.category)} · ${esc(e.eventType)}</small></td><td>${esc(e.source)}<small>${esc(e.actorId)}</small></td><td>${esc(e.site||'—')}</td><td>${esc(e.status||'—')}</td></tr>`).join('');
      if(focus)[...$('erRows').querySelectorAll('[data-event-id]')].find(b=>b.dataset.eventId===focus)?.focus();
      $('erCount').textContent=`${rows.length.toLocaleString()} shown · ${total.toLocaleString()} matching events`;
      $('erMore').hidden=!cursor;$('erMore').disabled=loading;$('erEmpty').hidden=rows.length>0;
    }
    async function load(older=false){
      if(older&&(!cursor||loading))return;
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
    function safeLink(value){try{const u=new URL(value);return u.protocol==='https:'&&['outlook.office.com','outlook.office365.com','teams.microsoft.com','teams.cloud.microsoft'].includes(u.hostname)&&!u.username?u.href:null;}catch{return null;}}
    function detailsText(e){const p=e.payload||{};return p.details||p.detail||p.text||'';}
    function selectedHtml(e){const original=safeLink(e.payload?.originalUrl);return `<section class="er-selected"><h3>${esc(e.summary||e.eventType)}</h3><dl><dt>Occurred</dt><dd>${esc(date(e.occurredAt))}</dd><dt>Recorded</dt><dd>${esc(date(e.recordedAt))}</dd><dt>Source</dt><dd>${esc(e.source)}</dd><dt>Actor</dt><dd>${esc(e.actorId)}</dd><dt>Type / severity</dt><dd>${esc(e.category)} / ${esc(e.severity)}</dd><dt>State at event</dt><dd>${esc(e.status||'Not supplied')}</dd><dt>Event ID</dt><dd>${esc(e.eventId)}</dd><dt>Record</dt><dd>${esc(e.aggregateType)} · ${esc(e.aggregateId)}</dd></dl><p class="er-message">${esc(detailsText(e))}</p>${e.payload?.assistiveOnly?'<p class="er-caution">AI content is assistive and does not authorize an operational action.</p>':''}${original?`<a href="${esc(original)}" target="_blank" rel="noopener noreferrer">Open original in ${esc(e.source)}</a>`:''}<details><summary>Recorded fields</summary><pre>${esc(JSON.stringify(e.payload,null,2))}</pre></details></section>`;}
    function historyHtml(){ $('erHistory').innerHTML=history.map(e=>`<li class="${e.eventId===selectedId?'er-selected-history':''}"><time>${esc(date(e.occurredAt))}</time><strong>${esc(e.summary||e.eventType)}</strong><small>${esc(e.actorId)} · ${esc(e.source)}${e.status?' · '+esc(e.status):''}</small><p class="er-message">${esc(detailsText(e))}</p></li>`).join('');$('erHistoryMore').hidden=!historyCursor; }
    async function openEvent(id,older=false){
      if(!id)return;
      if(!older&&id!==selectedId){$('erNote').value='';noteAttempt=null;$('erNoteStatus').textContent='';}
      selectedId=id;const request=++detailRequest;
      if(!dialog.open){lastSelectionTrigger=document.activeElement;dialog.showModal();}
      $('erDetailStatus').textContent='Loading history…';$('erHistoryMore').disabled=true;
      if(!older){$('erSelected').innerHTML='';$('erHistory').innerHTML='';history=[];historyCursor=null;$('erHistoryMore').hidden=true;}
      const p=new URLSearchParams({id,limit:'50'});if(older&&historyCursor)p.set('cursor',historyCursor);
      try{const result=await json(url('/api/events/detail',p));if(request!==detailRequest||!dialog.open)return;
        $('erSelected').innerHTML=selectedHtml(result.event);history=older?[...history,...result.history.items]:result.history.items;
        historyCursor=result.history.nextCursor;historyHtml();$('erDetailStatus').textContent=`${history.length} of ${result.history.total} related records · newest first`;
      }catch(error){if(request===detailRequest)$('erDetailStatus').textContent='Unable to load history: '+error.message;}
      finally{if(request===detailRequest)$('erHistoryMore').disabled=false;}
    }
    $('erRows').addEventListener('click',e=>{const button=e.target.closest('[data-event-id]');if(button)openEvent(button.dataset.eventId);});
    $('erClose').onclick=()=>dialog.close();dialog.addEventListener('close',()=>{detailRequest++;lastSelectionTrigger?.isConnected&&lastSelectionTrigger.focus();});
    $('erHistoryMore').onclick=()=>openEvent(selectedId,true);
    $('erNote').addEventListener('input',()=>noteAttempt=null);
    $('erNoteForm').onsubmit=async event=>{event.preventDefault();const text=$('erNote').value.trim();if(!text||!selectedId)return;
      const button=event.submitter||$('erNoteForm').querySelector('button');button.disabled=true;
      const id=selectedId;noteAttempt=noteAttempt||crypto.randomUUID();$('erNoteStatus').textContent='Saving…';
      try{await json('/api/events/notes',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({eventId:id,text,requestId:noteAttempt})});if(id!==selectedId)return;$('erNote').value='';noteAttempt=null;$('erNoteStatus').textContent='Note recorded.';await openEvent(id);$('erNew').hidden=false;}
      catch(error){if(id===selectedId)$('erNoteStatus').textContent='Not confirmed: '+error.message+' Retry to check/save the same note.';}
      finally{button.disabled=false;}
    };
    form.onsubmit=e=>{e.preventDefault();try{filters=currentFilters();chips();form.querySelectorAll('details').forEach(d=>d.open=false);load();}catch(error){$('erError').hidden=false;$('erError').textContent=error.message;}};
    $('erClear').onclick=()=>{form.reset();filters=new URLSearchParams();chips();load();};
    $('erChips').onclick=e=>{const b=e.target.closest('[data-chip]');if(!b)return;const [key,value]=[...filters][Number(b.dataset.chip)];for(const input of form.elements){if(input.name!==key)continue;if(input.type==='checkbox'){if(input.value===value)input.checked=false;}else input.value='';}form.requestSubmit();};
    $('erRefresh').onclick=()=>load();$('erNew').onclick=()=>load();$('erMore').onclick=()=>load(true);
    $('erWrite').onclick=()=>{if(original){original.hidden=!original.hidden;if(!original.hidden){original.scrollIntoView({behavior:'smooth'});document.querySelector('#logSubject')?.focus();}}};
    async function sourceInfo(){try{const data=await json('/api/events/sources');$('erSources').innerHTML=data.sources.map(s=>`<div><strong>${esc(s.label)}</strong><span>${esc(s.state)}</span><small>${s.count.toLocaleString()} recorded${s.lastRecordedAt?' · last '+esc(date(s.lastRecordedAt)):''}</small></div>`).join('')+`<p>${esc(data.note)}</p>`;
      for(const [target,name,items] of [['erTypeOptions','type',data.types],['erSourceOptions','source',data.sources]])$(target).innerHTML=items.map(s=>`<label><input type="checkbox" name="${name}" value="${esc(s.id)}">${esc(s.label)}</label>`).join('');
      $('erStatusOptions').innerHTML='<option value="">All states</option>'+data.statuses.map(s=>`<option value="${esc(s)}">${esc(s)}</option>`).join('');
    }catch(error){$('erSources').textContent='Source information unavailable: '+error.message;}}
    window.NorthStarEvents={open(id){document.querySelector('[data-tab="logbook"]')?.click();return openEvent(id);}};
    const stream=document.querySelector('#eventsStream');
    if(stream){stream.addEventListener('click',e=>{const row=e.target.closest('[data-event-id]');if(row)window.NorthStarEvents.open(row.dataset.eventId);});stream.addEventListener('keydown',e=>{if(['Enter',' '].includes(e.key)&&e.target.matches('[data-event-id]')){e.preventDefault();window.NorthStarEvents.open(e.target.dataset.eventId);}});}
    sourceInfo();load();
    setInterval(async()=>{if(document.hidden||!host.classList.contains('active')||loading)return;
      try{const p=new URLSearchParams(filters);p.set('limit','1');const result=await json(url('/api/events/register',p));if(result.snapshot>snapshot)$('erNew').hidden=false;}
      catch{if(lastSuccess)$('erFreshness').textContent='Refresh check failed · last loaded '+date(lastSuccess);}
    },30000);
  };
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();
