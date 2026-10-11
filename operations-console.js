/* Shared full/compact projections of server-owned console records and tasks. */
(() => {
  'use strict';
  const categories = {alarms:['SCADA','App alarms'], communications:['Outlook','Telephone','Teams'], tasks:['Recurring','Created on demand','Triggered'], events:['Outages','Planned','Operator log'], feed:['IESO','Market','Weather','News']};
  const esc = value => String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const date = value => value ? new Date(value).toLocaleString('en-CA',{timeZone:'America/Toronto',month:'short',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false})+' ET' : 'No due time';
  const title = value => value.charAt(0).toUpperCase()+value.slice(1);
  const uid = () => crypto.randomUUID();
  const roots = []; let feed = null, lastSuccess = null, feedError = '', busy = false;
  const channel = typeof BroadcastChannel==='function' ? new BroadcastChannel('northstar-console') : null;
  async function api(path, payload) {
    const response = await fetch('/api/console/'+path,{cache:'no-store', ...(payload ? {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)} : {})});
    let result;try { result=await response.json(); } catch { throw Error('Unreadable service response'); }
    if(!response.ok)throw Error(result.error || `Service returned ${response.status}`);
    return result;
  }
  const announce = () => {channel?.postMessage('refresh');refreshAll();window.dispatchEvent(new CustomEvent('northstar:console-updated'));};
  channel?.addEventListener('message',()=>refreshAll());
  function error(host,message) {const node=host.querySelector('[data-error]');node.hidden=!message;node.textContent=message;}
  function shell(host,compact=false) {
    host.classList.add('oc');host.innerHTML=`<header class="oc-title"><div><h2>${compact?'Operations Console':'Console'}</h2><small>EVENT LOG · AMERICA/TORONTO</small></div><span data-fresh role="status">Loading…</span></header>
      <nav class="oc-nav" aria-label="Event log categories"><button data-add type="button" aria-label="Create record or task">＋</button>${['all',...Object.keys(categories)].map(c=>`<button type="button" data-category="${c}" aria-pressed="${c==='all'}">${title(c)}</button>`).join('')}<button type="button" data-feed-toggle aria-expanded="true">Hide priority feed</button>${compact?'<button type="button" data-expand aria-label="Open Events Console">↗</button>':''}</nav>
      <div class="oc-filters"><label>Search<input data-query type="search" maxlength="500" placeholder="Title, details or actor"></label><label>Type<select data-subtype><option value="">All types</option></select></label><label>Station<input data-site maxlength="200" placeholder="Any station"></label><label data-status-label hidden>Task state<select data-status><option value="open">Open work</option><option value="all">All tasks</option><option value="completed">Completed</option><option value="cancelled">Cancelled</option></select></label><button type="button" data-refresh>Refresh</button></div>
      <p class="oc-error" data-error role="alert" hidden></p><div class="oc-layout"><div class="oc-main"><div data-count class="oc-count"></div><div data-rows>Loading records…</div><button type="button" data-more hidden>Load older</button></div><aside class="oc-feed"><h3>Priority feed</h3><p>Open work stays until completed or cancelled.</p><div data-feed></div></aside></div>
      ${compact?'':'<details class="oc-integrations"><summary>Sources &amp; task templates</summary><div data-sources>Loading source status…</div><div class="oc-template-actions"><button type="button" data-template>＋ Task template</button><button type="button" data-template-refresh>Refresh templates</button></div><div data-templates></div></details>'}`;
    const state={host,category:'all',items:[],cursor:null,offset:null,total:0,loading:false,seq:0,paged:false};roots.push(state);
    const $ = sel => host.querySelector(sel);
    host.querySelector('.oc-nav').addEventListener('click',event=>{
      const c=event.target.closest('[data-category]');if(c){state.category=c.dataset.category;host.querySelectorAll('[data-category]').forEach(b=>b.setAttribute('aria-pressed',String(b===c)));$('[data-subtype]').innerHTML='<option value="">All types</option>'+(categories[state.category]||[]).map(s=>`<option>${esc(s)}</option>`).join('');$('[data-status-label]').hidden=state.category!=='tasks';load(state);}
    });
    $('[data-add]').onclick=()=>createDialog(state);
    $('[data-refresh]').onclick=()=>{load(state);loadFeed();};
    $('[data-more]').onclick=()=>load(state,true);
    $('[data-feed-toggle]').onclick=event=>{const collapsed=host.classList.toggle('oc-feed-hidden');event.target.textContent=collapsed?'Show priority feed':'Hide priority feed';event.target.setAttribute('aria-expanded',String(!collapsed));};
    if(compact)$('[data-expand]').onclick=()=>window.NorthstarModules?.open('logbook:operations-console');
    let timer;for(const sel of ['[data-query]','[data-site]'])$(sel).oninput=()=>{clearTimeout(timer);timer=setTimeout(()=>load(state),350);};
    for(const sel of ['[data-subtype]','[data-status]'])$(sel).onchange=()=>load(state);
    host.addEventListener('click',event=>{
      const task=event.target.closest('[data-task]');if(task){const item=state.items.find(t=>t.id===task.dataset.task)||feed?.tasks.find(t=>t.id===task.dataset.task);if(item)taskDialog(item);return;}
      const record=event.target.closest('[data-record]');if(record){const item=state.items.find(t=>t.eventId===record.dataset.record)||feed?.recent.find(t=>t.eventId===record.dataset.record);if(item)recordDialog(item);}
    });
    if(!compact){$('[data-template]').onclick=()=>templateDialog();$('[data-template-refresh]').onclick=()=>loadTemplates(host);loadCatalog(host);loadTemplates(host);}
    load(state);return state;
  }
  function row(record) {
    return `<button class="oc-row oc-${esc(record.consoleCategory)}" type="button" data-record="${esc(record.eventId)}"><time>${esc(date(record.occurredAt))}</time><span class="oc-kind">${esc(record.consoleCategory||record.category)}</span><span><strong>${esc(record.summary)}</strong><small>${esc(record.subtype||record.source)} · ${esc(record.site||'All stations')}${record.payload?.manual?' · MANUAL RECORD':''}</small></span><span>${esc(record.status||record.severity||'info')}</span></button>`;
  }
  function taskRow(task) {
    return `<button class="oc-row ${task.overdue?'oc-overdue':''}" type="button" data-task="${esc(task.id)}"><time>${esc(date(task.due_at))}</time><span class="oc-kind">${esc(task.priority)}</span><span><strong>${esc(task.title)}</strong><small>${esc(task.subtype)} · ${esc(task.site||'All stations')} · ${esc(task.assignee||'Unassigned')}</small></span><span>${task.overdue?'OVERDUE':esc(task.status.replaceAll('_',' '))}</span></button>`;
  }
  async function load(state,older=false) {
    if(older&&state.loading)return;
    const host=state.host, seq=++state.seq;state.loading=true;
    const params=new URLSearchParams({limit:'50',q:host.querySelector('[data-query]').value,site:host.querySelector('[data-site]').value,subtype:host.querySelector('[data-subtype]').value});
    const isTask=state.category==='tasks';
    if(isTask){params.set('status',host.querySelector('[data-status]').value);if(older)params.set('offset',state.offset||'0');}
    else {params.set('category',state.category);if(older&&state.cursor)params.set('cursor',state.cursor);}
    host.querySelector('[data-fresh]').textContent='Refreshing…';host.querySelector('[data-more]').disabled=true;
    try {
      const data=await api((isTask?'tasks':'records')+'?'+params);if(seq!==state.seq)return;
      state.paged=older;state.items=older?[...state.items,...data.items]:data.items;state.cursor=data.nextCursor;state.offset=data.nextOffset;state.total=data.total;
      host.querySelector('[data-rows]').innerHTML=state.items.length?state.items.map(isTask?taskRow:row).join(''):'<div class="oc-empty">No matching '+(isTask?'tasks':'records')+'. Create a manual entry or connect an approved source.</div>';
      host.querySelector('[data-count]').textContent=state.items.length+' shown · '+state.total+' total';
      host.querySelector('[data-more]').hidden=isTask?state.offset==null:!state.cursor;
      host.querySelector('[data-fresh]').textContent='Updated '+date(new Date().toISOString());error(host,'');
    }catch(e){if(seq===state.seq){error(host,'Unable to load requested view: '+e.message+'. Previous results are retained. New endpoints require a backend restart.');host.querySelector('[data-fresh]').textContent='Service unavailable / stale';}}
    finally {if(seq===state.seq){state.loading=false;host.querySelector('[data-more]').disabled=false;}}
  }
  function renderFeed() {
    for(const {host} of roots){const node=host.querySelector('[data-feed]');if(!feed){node.textContent=feedError||'Loading…';continue;}node.innerHTML=(feedError?`<p class="oc-error">${esc(feedError)}</p>`:'')+`<small>${feed.openTotal} open tasks · ${esc(date(lastSuccess))}</small>`+feed.tasks.slice(0,12).map(t=>`<button type="button" data-task="${esc(t.id)}" class="oc-feed-item ${t.overdue?'oc-overdue':''}"><strong>${esc(t.title)}</strong><small>${t.overdue?'OVERDUE · ':''}${esc(t.priority)} · ${esc(date(t.due_at))}</small></button>`).join('')+(feed.openTotal>12?'<p>Open Tasks to see all outstanding work.</p>':'')+'<h4>Unresolved app alarms</h4>'+(feed.alarms||[]).slice(0,8).map(a=>`<a class="oc-feed-item" href="${esc(a.href)}">${esc(a.node)} · ${esc(a.state)}</a>`).join('')+'<h4>Recent activity</h4>'+feed.recent.slice(0,8).map(r=>`<button type="button" data-record="${esc(r.eventId)}" class="oc-feed-item"><strong>${esc(r.summary)}</strong><small>${esc(r.consoleCategory)} · ${esc(date(r.occurredAt))}</small></button>`).join('');}
  }
  async function loadFeed(){if(busy)return;busy=true;try{feed=await api('feed');lastSuccess=feed.fetchedAt;feedError='';}catch(e){feedError='Priority feed stale: '+e.message;}finally{busy=false;renderFeed();}}
  function refreshAll(){for(const state of roots)load(state);loadFeed();}
  function dialog(heading,content,onSubmit) {
    const node=document.createElement('dialog');node.className='oc-dialog';node.requestId=uid();let submitted='';
    node.innerHTML=`<form><header><h2>${esc(heading)}</h2><button type="button" data-close aria-label="Close">×</button></header>${content}<p data-dialog-error role="alert" hidden></p><footer><button type="button" data-close>Close</button>${onSubmit?'<button type="submit">Save</button>':''}</footer></form>`;
    document.body.append(node);node.querySelectorAll('[data-close]').forEach(b=>b.onclick=()=>node.close());node.addEventListener('close',()=>node.remove());
    if(onSubmit)node.querySelector('form').onsubmit=async event=>{event.preventDefault();const data=new FormData(event.target), body=JSON.stringify([...data]);if(submitted&&submitted!==body)node.requestId=uid();submitted=body;const b=node.querySelector('[type=submit]');b.disabled=true;try{await onSubmit(data,node);node.close();announce();}catch(e){const out=node.querySelector('[data-dialog-error]');out.hidden=false;out.textContent=e.message;}finally{b.disabled=false;}};
    else node.querySelector('form').onsubmit=event=>event.preventDefault();
    node.showModal();return node;
  }
  const input=(name,label,type='text',extra='')=>`<label>${label}<input name="${name}" type="${type}" ${extra}></label>`;
  const taskFields=()=>input('title','Title','text','required maxlength="300"')+'<label>Details<textarea name="details" maxlength="8000"></textarea></label>'+input('site','Station','text','maxlength="200"')+input('assignee','Assigned person / role','text','maxlength="200"')+input('due','Due time (your device timezone)','datetime-local')+'<label>Priority<select name="priority"><option value="normal">Normal</option><option value="high">High</option><option value="critical">Critical</option></select></label><label>Completion<select name="mode"><option value="manual">Manual completion</option><option value="verified">Evidence + operator verification</option></select></label>';
  function taskPayload(data){return {title:data.get('title'),details:data.get('details'),site:data.get('site'),assignee:data.get('assignee'),due_at:data.get('due')?new Date(data.get('due')).toISOString():null,priority:data.get('priority'),mode:data.get('mode')};}
  function createDialog(state,parent=null) {
    let requestId=uid(),lastBody=null;
    const node=dialog(parent?'Create linked task':'New event log entry',`<label>Category<select name="category">${['tasks','events','communications','feed'].map(c=>`<option value="${c}">${title(c)}</option>`).join('')}</select></label><label>Type<select name="subtype"></select></label>${taskFields()}<p>Communications and feed entries are manual records, not imported source messages.</p>`,async data=>{
      const category=data.get('category');const payload={...taskPayload(data),category,subtype:data.get('subtype'),requestId,source_event_id:parent?.eventId||null};
      // New key when form changes; unchanged retries reuse their key.
      const body=JSON.stringify({...payload,requestId:null});if(lastBody&&lastBody!==body)requestId=uid();payload.requestId=requestId;lastBody=body;
      await api(category==='tasks'?'tasks':'records',payload);
    });
    const category=node.querySelector('[name=category]'),subtype=node.querySelector('[name=subtype]');
    const update=()=>{subtype.innerHTML=(category.value==='tasks'?['Created on demand']:categories[category.value]).map(s=>`<option>${esc(s)}</option>`).join('');for(const name of ['assignee','due','priority','mode'])node.querySelector(`[name=${name}]`).parentElement.hidden=category.value!=='tasks' && !(name==='due'&&category.value==='events');};
    category.onchange=update;update();if(parent){category.disabled=true;category.value='tasks';update();node.querySelector('[name=title]').value='Follow up: '+parent.summary;node.querySelector('[name=site]').value=parent.site||'';}
    // Disabled fields are not included in FormData.
    if(parent){category.disabled=true;const hidden=document.createElement('input');hidden.type='hidden';hidden.name='category';hidden.value='tasks';category.after(hidden);}
  }
  function taskDialog(task) {
    const requestId=uid();const allowed={open:['in_progress','completed','cancelled'],in_progress:['open','completed','cancelled'],pending_verification:['completed','open','cancelled']};
    let actions=allowed[task.status]||[];if(task.mode==='verified'&&['open','in_progress'].includes(task.status))actions=actions.filter(s=>s!=='completed').concat('pending_verification');
    dialog(task.title,`<p>${esc(task.details)}</p><dl><dt>State</dt><dd>${esc(task.status)}</dd><dt>Origin</dt><dd>${esc(task.subtype)}</dd><dt>Due</dt><dd>${esc(date(task.due_at))}</dd><dt>Assignment</dt><dd>${esc(task.assignee||'Unassigned')}</dd><dt>Evidence</dt><dd>${esc(task.evidence||'None submitted')}</dd></dl><a href="event-detail.html?id=${encodeURIComponent(task.event_id)}">Open audit history</a>${task.source_event_id?`<a href="event-detail.html?id=${encodeURIComponent(task.source_event_id)}">Open source record</a>`:''}${actions.length?`<label>Next state<select name="status">${actions.map(s=>`<option value="${s}">${esc(s.replaceAll('_',' '))}</option>`).join('')}</select></label><label>Decision / cancellation notes<textarea name="notes" maxlength="8000"></textarea></label><label>Evidence reference<textarea name="evidence" maxlength="8000"></textarea></label>`:''}`,actions.length?async (data,node)=>api('transition',{id:task.id,version:task.version,status:data.get('status'),notes:data.get('notes'),evidence:data.get('evidence'),requestId:node.requestId}):null);
  }
  function recordDialog(record) {
    const node=dialog(record.summary,`<p>${esc(date(record.occurredAt))} · ${esc(record.consoleCategory)} · ${esc(record.subtype||record.source)}</p><p>${esc(record.payload?.details||'')}</p>${record.payload?.plannedAt?`<p>Planned time: ${esc(date(record.payload.plannedAt))}</p>`:''}<p>Actor: ${esc(record.actorId)} · Station: ${esc(record.site||'—')}</p><a href="${esc(record.href)}">Open full report &amp; audit</a><button type="button" data-convert>Create linked task</button><h3>Linked records</h3><div data-links>Loading…</div><label>Link existing event ID<input name="related" maxlength="200" required></label>`,async data=>api('links',{left:record.eventId,right:data.get('related')}));
    node.querySelector('[data-convert]').onclick=()=>{node.close();createDialog(null,record);};
    api('links?id='+encodeURIComponent(record.eventId)).then(data=>{if(node.isConnected)node.querySelector('[data-links]').innerHTML=data.items.map(r=>`<a href="${esc(r.href)}">${esc(r.summary)}</a>`).join('')+data.tasks.map(t=>`<p>${esc(t.title)} · ${esc(t.status)}</p>`).join('')||'No explicit links.';}).catch(e=>{if(node.isConnected)node.querySelector('[data-links]').textContent=e.message;});
  }
  function templateDialog() {
    const requestId=uid();const node=dialog('Task template',`<label>Origin<select name="kind"><option value="daily">Daily recurring</option><option value="triggered">Triggered by recorded source event</option></select></label>${taskFields()}<div data-daily>${input('localTime','Local scheduled time','time','required')}${input('startsOn','Start date','date','required')}${input('timezone','Schedule timezone','text','value="America/Toronto" required')}</div><div data-trigger hidden>${input('eventSource','Exact recorded source')}${input('eventType','Exact event type')}<p>Only future recorded matches generate tasks. A disconnected source cannot trigger a task.</p></div>`,async (data,node)=>api('templates',{...taskPayload(data),kind:data.get('kind'),localTime:data.get('localTime'),startsOn:data.get('startsOn'),timezone:data.get('timezone'),eventSource:data.get('eventSource'),eventType:data.get('eventType'),requestId:node.requestId}).then(()=>roots.filter(r=>r.host.id==='operationsConsole').forEach(r=>loadTemplates(r.host))));
    node.querySelector('[name=due]').parentElement.hidden=true;
    node.querySelector('[name=kind]').onchange=event=>{const daily=event.target.value==='daily';node.querySelector('[data-daily]').hidden=!daily;node.querySelector('[data-trigger]').hidden=daily;node.querySelectorAll('[data-daily] input').forEach(i=>i.required=daily);node.querySelectorAll('[data-trigger] input').forEach(i=>i.required=!daily);};
  }
  async function loadTemplates(host){try{const data=await api('templates');const node=host.querySelector('[data-templates]');node.innerHTML=data.items.map(t=>`<div class="oc-template"><strong>${esc(t.title)}</strong><span>${esc(t.kind==='daily'?t.localTime+' '+t.timezone:t.eventSource+' / '+t.eventType)} · ${t.enabled?'Enabled':'Paused'}</span><button type="button" data-id="${esc(t.id)}">${t.enabled?'Pause':'Enable'}</button></div>`).join('')||'<p>No task templates configured.</p>';node.querySelectorAll('button').forEach(b=>b.onclick=async()=>{b.disabled=true;try{const t=data.items.find(t=>t.id===b.dataset.id);await api('template-state',{id:t.id,enabled:!t.enabled});await loadTemplates(host);}catch(e){error(host,e.message);}finally{b.disabled=false;}});}catch(e){host.querySelector('[data-templates]').textContent=e.message;}}
  async function loadCatalog(host){try{const data=await api('catalog');host.querySelector('[data-sources]').innerHTML=`<p>${esc(data.note)}</p>`+data.sources.sources.map(s=>`<div class="oc-source"><strong>${esc(s.label)}</strong><span>${esc(s.state)} · ${s.count} recorded</span></div>`).join('');}catch(e){host.querySelector('[data-sources]').textContent=e.message;}}
  function init() {
    const section=document.querySelector('#logbook');if(!section)return;
    const host=document.createElement('article');host.id='operationsConsole';host.dataset.moduleId='operations-console';host.className='panel';section.prepend(host);shell(host);
    // Existing event register keeps its identity/history and gains server category filters.
    window.NorthstarModules?.refresh();loadFeed();
    const onPopout=event=>{
      const {id,popup}=event.detail;if((id!=='fixed-dashboard'&&!id.startsWith('mobile:'))||new URLSearchParams(location.search).has('nsModuleWindow')||new URLSearchParams(location.search).has('nsStatusWindow'))return;
      const tracker=document.querySelector('#overviewFieldTracker');if(!tracker||!popup)return;
      let compact=document.getElementById('overviewOperationsConsole');
      if(!compact){compact=document.createElement('article');compact.id='overviewOperationsConsole';compact.className='panel';compact.dataset.moduleId='overview-operations-console';compact.dataset.canvasSlot='overviewFieldTracker';compact.setAttribute('data-overview-module','');tracker.after(compact);compact.style.cssText=tracker.style.cssText;shell(compact,true);}
      compact.hidden=false;document.body.classList.add('oc-tracker-popped');
      const timer=setInterval(()=>{if(popup.closed){clearInterval(timer);document.body.classList.remove('oc-tracker-popped');compact.hidden=true;}},1000);
    };
    window.addEventListener('northstar:module-popout',onPopout);window.addEventListener('northstar:status-popout',onPopout);
    setInterval(()=>{if(!document.hidden){for(const state of roots)if(!state.host.hidden&&!state.loading&&!state.paged)load(state);loadFeed();}},30000);
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();
