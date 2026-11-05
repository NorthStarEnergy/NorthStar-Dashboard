/* Shared server-owned Console state. No local task database or upstream impersonation. */
(() => {
  'use strict';
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const state = {filter:'all', status:'open', items:[], cursor:null, feed:{tasks:[],alarms:[],recent:[]}, info:null, error:'', loading:false, last:null};
  const roots = [];
  let timer, failures=0, generation=0, dialogReturn, refreshPending=false, historyMode=false;
  const channel = typeof BroadcastChannel === 'function' ? new BroadcastChannel('northstar-operations-console') : null;
  const time = value => value ? new Date(value).toLocaleString('en-CA', {timeZone:'America/Toronto', month:'short',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}) : 'No due date';
  const isTask = item => Boolean(item.title && item.status);
  const key = item => item.id || item.eventId;
  const closed = task => ['completed','cancelled','superseded'].includes(task.status);
  const stationName=id=>(state.info?.stations||[]).find(s=>s.id===id)?.name||id||'All sites';
  let feedHidden=false;
  async function api(path, body) {
    const response=await fetch('/api/console/'+path, {credentials:'same-origin', cache:'no-store', ...(body===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})});
    let result; try {result=await response.json();} catch {throw new Error('Console service unavailable');}
    if(!response.ok)throw new Error(result.error || 'Console request failed');
    return result;
  }
  function row(item, compact=false) {
    const task=isTask(item), status=task?item.status:item.sourceStatus || item.kind;
    const overdue=task&&!closed(item)&&item.dueAt&&Date.parse(item.dueAt)<Date.now();
    return `<button type="button" class="oc-row ${compact?'oc-compact':''} ${overdue?'oc-overdue':''}" data-oc-id="${esc(key(item))}" data-oc-task="${task}">
      <time>${esc(time(task?item.dueAt:item.occurredAt))}</time><span class="oc-priority">${esc(item.priority||item.severity||'info')}</span><span>${esc(stationName(item.stationId))}</span><span>${esc(task?item.sourceType:item.source)}</span><strong>${esc(item.title||item.summary)}</strong><span>${esc(overdue?'OVERDUE · '+status:status)}</span></button>`;
  }
  function feedItems(){const soon=Date.now()+86400000;const urgent=state.feed.tasks.filter(t=>t.dueAt&&Date.parse(t.dueAt)<=soon);return [...urgent,...state.feed.alarms,...state.feed.tasks.filter(t=>!urgent.includes(t)),...state.feed.recent];}
  function render(){
    for(const root of roots){
      const list=state.filter==='feed'?feedItems():state.items;
      root.classList.toggle('oc-feed-hidden',feedHidden);
      root.querySelector('[data-oc-list]').innerHTML=list.length?list.map(item=>row(item)).join(''):`<p class="oc-empty">${state.loading?'Loading console…':state.error?'Unable to load records. Retry below.':'No records match this view.'}</p>`;
      root.querySelector('[data-oc-feed]').innerHTML=feedItems().length?feedItems().map(item=>row(item,true)).join(''):'<p class="oc-empty">No outstanding feed items.</p>';
      root.querySelectorAll('[data-oc-filter]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.ocFilter===state.filter)));
      root.querySelector('[data-oc-status]').hidden=state.filter!=='tasks';
      root.querySelector('[data-oc-status]').value=state.status;
      root.querySelector('[data-oc-more]').hidden=!state.cursor||state.filter==='feed';
      root.querySelector('[data-oc-more]').disabled=state.loading;
      root.querySelector('[data-oc-toggle]').setAttribute('aria-expanded',String(!feedHidden));
      root.querySelector('[data-oc-toggle]').textContent=feedHidden?'Show feed':'Hide feed';
      root.querySelector('[data-oc-create]').disabled=!state.info?.canWrite;
      root.querySelector('[data-oc-health]').textContent=state.error?`Disconnected · ${state.error} · retrying`:state.last?`Updated ${time(state.last)} · America/Toronto · refreshes every 10s`:'Connecting… · America/Toronto';
      root.querySelector('[data-oc-health]').classList.toggle('oc-error',Boolean(state.error));
    }
  }
  async function refresh(more=false){
    if(state.loading){refreshPending=true;return;}
    const token=++generation;state.loading=true;render();
    try{
      if(!state.info){state.info=await api('status');try{feedHidden=localStorage.getItem('northstarConsoleFeed:'+state.info.actor)==='hidden';}catch{}}
      const query=new URLSearchParams({limit:'50',...(state.filter==='tasks'?{status:state.status}:{kind:state.filter==='alarms'?'alarm':state.filter==='events'?'events':'all'})});
      if(more&&state.cursor)query.set('cursor',state.cursor);
      const [result,feed]=await Promise.all([api((state.filter==='tasks'?'tasks':'records')+'?'+query),api('feed')]);
      if(token!==generation)return;
      state.items=more?[...state.items,...result.items.filter(item=>!state.items.some(old=>key(old)===key(item)))]:result.items;
      state.cursor=result.nextCursor;state.feed=feed;state.error='';state.last=new Date().toISOString();failures=0;
    }catch(error){state.error=error.message;failures++;}
    finally{state.loading=false;render();clearTimeout(timer);if(refreshPending){refreshPending=false;refresh();}else timer=setTimeout(()=>{if(!historyMode)refresh();},Math.min(60000,10000*2**Math.min(3,failures)));}
  }
  function modal(title,content){
    document.querySelector('#operationsConsoleDialog')?.close();document.querySelector('#operationsConsoleDialog')?.remove();
    dialogReturn=document.activeElement;
    const dialog=document.createElement('dialog');dialog.id='operationsConsoleDialog';dialog.className='oc-dialog';
    dialog.innerHTML=`<form method="dialog" class="oc-dialog-close"><h2>${esc(title)}</h2><button aria-label="Close console dialog">×</button></form>${content}<p class="oc-error" data-oc-error role="alert"></p>`;
    document.body.append(dialog);dialog.addEventListener('close',()=>{dialog.remove();dialogReturn?.focus();});dialog.showModal();return dialog;
  }
  const field=(label,name,value='',type='text',required=false)=>`<label>${label}<input name="${name}" type="${type}" value="${esc(value)}" ${required?'required':''} ${type==='text'?'maxlength="240"':''}></label>`;
  const select=(label,name,values,value)=>`<label>${label}<select name="${name}">${values.map(v=>`<option value="${v}" ${v===value?'selected':''}>${v.replace(/_/g,' ')}</option>`).join('')}</select></label>`;
  function stationField(value=''){
    const options=[...(state.info?.sites===null?[{id:'',name:'All sites'}]:[]),...(state.info?.stations||[])];
    if(value&&!options.some(s=>s.id===value))options.push({id:value,name:value});
    return `<label>Station<select name="stationId" aria-label="Station">${options.map(s=>`<option value="${esc(s.id)}" ${s.id===value?'selected':''}>${esc(s.name)}</option>`).join('')}</select></label>`;
  }
  function taskFields(task={}){
    return field('Title','title',task.title||'','text',true)+`<label>Description<textarea name="description" maxlength="8000">${esc(task.description||'')}</textarea></label>`+
      stationField(task.stationId||'')+select('Priority','priority',['info','low','medium','high','critical'],task.priority||'medium')+
      field('Due (your browser local timezone)','dueLocal',task.dueAt?new Date(Date.parse(task.dueAt)-new Date(task.dueAt).getTimezoneOffset()*60000).toISOString().slice(0,16):'','datetime-local')+
      field('Category','category',task.category||'')+field('Assigned user (optional)','assigneeUserId',task.assigneeUserId||'')+
      select('Assigned role','assigneeRoleId',['','operator'],task.assigneeRoleId||'')+
      select('Completion','completionMode',['manual','automatic','verified'],task.completionMode||'manual')+
      `<p class="oc-help">Automatic/verified completion needs a configured trusted adapter. Until connected these tasks remain open.</p>`+
      field('Exact evidence source (automatic/verified)','ruleSource',task.completionRule?.source||'')+field('Exact evidence event type','ruleType',task.completionRule?.eventType||'');
  }
  function formData(form){const data=Object.fromEntries(new FormData(form));data.dueAt=data.dueLocal?new Date(data.dueLocal).toISOString():null;delete data.dueLocal;data.completionRule=data.completionMode==='manual'?null:{source:data.ruleSource,eventType:data.ruleType};delete data.ruleSource;delete data.ruleType;return data;}
  async function save(dialog,path,data){
    const buttons=[...dialog.querySelectorAll('button')];buttons.forEach(b=>b.disabled=true);
    try{await api(path,data);dialog.close();channel?.postMessage('changed');await refresh();}
    catch(error){dialog.querySelector('[data-oc-error]').textContent=error.message;}
    finally{buttons.forEach(b=>b.disabled=false);}
  }
  function create(source){
    const dialog=modal(source?'Create task from record':'Create console entry',`<form data-oc-form class="oc-form">${select('Type','kind',source?['task']:['task','event','log','daily_schedule'],'task')}<div data-oc-fields>${taskFields({title:source?.summary,stationId:source?.stationId})}</div><button type="submit">Save</button></form><button type="button" data-oc-schedules>Manage daily schedules</button>`);
    const form=dialog.querySelector('[data-oc-form]'),requestId=crypto.randomUUID();
    form.elements.kind.addEventListener('change',()=>{
      const kind=form.elements.kind.value;
      dialog.querySelector('[data-oc-fields]').innerHTML=['task','daily_schedule'].includes(kind)?taskFields()+(kind==='daily_schedule'?field('Daily local time','localTime','09:00','time',true)+field('Timezone','timezone','America/Toronto','text',true)+field('Starts on','startsOn',new Date().toLocaleDateString('en-CA'),'date',true)+field('Ends on (optional)','endsOn','','date'):''):field('Summary','summary','','text',true)+stationField()+'<label>Details<textarea name="details" maxlength="8000"></textarea></label>';
    });
    form.addEventListener('submit',event=>{event.preventDefault();const data=formData(form);data.requestId=requestId;if(source)data.sourceEventId=source.eventId||source.id;save(dialog,data.kind==='daily_schedule'?'task-templates':data.kind==='task'?'tasks':'records',data);});
    dialog.querySelector('[data-oc-schedules]').onclick=()=>schedules();
  }
  async function schedules(){
    const dialog=modal('Daily schedules','<p>Loading…</p>');
    try{const result=await api('task-templates');dialog.querySelector('p').outerHTML=`<div class="oc-schedules">${result.items.length?result.items.map(t=>`<button data-schedule="${esc(t.id)}">${esc(t.title)} · ${esc(t.localTime)} ${esc(t.timezone)} · ${t.enabled?'Enabled':'Disabled'}</button>`).join(''):'No daily schedules.'}</div>`;
      dialog.querySelectorAll('[data-schedule]').forEach(button=>button.onclick=()=>{const t=result.items.find(t=>t.id===button.dataset.schedule);const edit=modal('Edit daily schedule',`<form class="oc-form">${taskFields(t)}${field('Daily local time','localTime',t.localTime,'time',true)}${field('Timezone','timezone',t.timezone,'text',true)}${field('Starts on','startsOn',t.startsOn,'date',true)}${field('Ends on','endsOn',t.endsOn||'','date')}<label><input name="enabled" type="checkbox" ${t.enabled?'checked':''}>Enabled</label><p>Existing occurrences retain their original due times. Changes affect ungenerated days.</p><button>Save schedule</button></form>`);edit.querySelector('.oc-form').onsubmit=e=>{e.preventDefault();save(edit,'task-templates/'+t.id,{...formData(e.target),enabled:e.target.elements.enabled.checked,version:t.version});};});
    }catch(error){dialog.querySelector('[data-oc-error]').textContent=error.message;}
  }
  async function detail(id,task){
    const dialog=modal(task?'Task details':'Record details','<div data-detail>Loading…</div>');
    try{
      const result=await api((task?'tasks/':'records/')+encodeURIComponent(id));
      if(!dialog.isConnected)return;
      const item=task?result.task:result.record;
      dialog.querySelector('[data-detail]').innerHTML=`<h3>${esc(item.title||item.summary)}</h3><dl>${Object.entries(task?{Status:item.status,Station:item.stationId,Priority:item.priority,Source:item.sourceType,'Source ID':item.sourceId,Due:time(item.dueAt),Created:time(item.createdAt),Updated:time(item.updatedAt),Assignment:item.assigneeUserId||item.assigneeRoleId||'Unassigned',Completion:item.completionMode,'Occurrence ID':item.occurrenceKey||'—'}:{Kind:item.kind,Status:item.sourceStatus,Station:item.stationId,Source:item.source,'Occurred (America/Toronto)':time(item.occurredAt),'Received (America/Toronto)':time(item.recordedAt),Actor:item.actorId}).map(([k,v])=>`<dt>${esc(k)}</dt><dd>${esc(v||'—')}</dd>`).join('')}</dl><p>${esc(item.description||item.payload?.details||'')}</p>${item.evidenceRef?`<p>Evidence: ${esc(item.evidenceRef.eventId)}</p>`:''}<div class="oc-actions"></div><h3>Audit / related history</h3><div class="oc-history">${(result.audit||[]).map(a=>`<p>${esc(time(a.occurredAt))} · ${esc(a.actorId)} · ${esc(a.summary)}<br>${esc(a.payload?.notes||'')}</p>`).join('')||'No related history.'}</div>`;
      const actions=dialog.querySelector('.oc-actions');
      if(!task&&item.kind==='alarm'){
        const p=document.createElement('p');p.textContent='Current source state: '+(item.currentSourceStatus||item.sourceStatus||'See source history')+'. Acknowledgement does not clear the underlying condition.';actions.before(p);
        if(item.canAcknowledge){const b=document.createElement('button');b.textContent='Acknowledge source alarm';b.onclick=()=>save(dialog,'records/'+encodeURIComponent(id)+'/acknowledge',{});actions.append(b);}
      }
      if(state.info?.canWrite){
        if(!task){const b=document.createElement('button');b.textContent='Create task from record';b.onclick=()=>create(item);actions.append(b);}
        else if(!closed(item)){
          const actionNames=[...(item.status==='open'?['start']:[]),...(item.completionMode==='manual'?['complete']:[]),...(item.status==='pending_verification'?['accept','reject']:[]),'edit','cancel','supersede'];
          for(const action of actionNames){const b=document.createElement('button');b.textContent=action[0].toUpperCase()+action.slice(1);actions.append(b);b.onclick=()=>{
            if(action==='edit'){const edit=modal('Edit task',`<form class="oc-form">${taskFields(item)}<button>Save changes</button></form>`);['stationId','completionMode','ruleSource','ruleType'].forEach(name=>edit.querySelector(`[name="${name}"]`).disabled=true);edit.querySelector('form.oc-form').onsubmit=e=>{e.preventDefault();save(edit,'tasks/'+id+'/edit',{...formData(e.target),version:item.version});};return;}
            const confirm=modal(action[0].toUpperCase()+action.slice(1)+' task',`<form class="oc-form"><p>${esc(item.title)}</p><label>Notes / reason<textarea name="notes" maxlength="8000" ${['cancel','supersede','accept','reject'].includes(action)?'required':''}></textarea></label><button type="submit">Confirm ${esc(action)}</button></form>`);
            confirm.querySelector('.oc-form').onsubmit=e=>{e.preventDefault();save(confirm,'tasks/'+id+'/'+(['accept','reject'].includes(action)?'verify':action),{version:item.version,notes:e.target.elements.notes.value,accept:action==='accept'});};
          };}
        }
      }
    }catch(error){dialog.querySelector('[data-oc-error]').textContent=error.message;}
  }
  function mount(root){
    roots.push(root);root.classList.add('operations-console');root.setAttribute('aria-label','Operations Console');
    root.innerHTML=`<header class="oc-toolbar"><strong class="oc-title">Console</strong><button data-oc-create aria-label="Create console entry">+</button>${['alarms','all','events','feed','tasks'].map(f=>`<button data-oc-filter="${f}" aria-pressed="${f==='all'}">${f.toUpperCase()}</button>`).join('')}<select data-oc-status aria-label="Task status filter" hidden><option value="open">Open / upcoming / overdue</option><option value="history">Completed / cancelled / superseded</option><option value="all">All task history</option></select><span class="oc-spacer"></span><button data-oc-toggle aria-label="Toggle right feed sidebar" aria-expanded="true">Hide feed</button><button data-oc-expand aria-label="Open Events Console full page">↗</button></header><div class="oc-body"><main class="oc-main"><div class="oc-columns" aria-hidden="true"><span>Time · Toronto</span><span>Priority</span><span>Station</span><span>Source</span><span>Summary</span><span>Status</span></div><div data-oc-list></div><button data-oc-more hidden>Load older records</button></main><aside aria-label="Important activity and open tasks"><h3>FEED</h3><div data-oc-feed></div></aside></div><footer><span data-oc-health role="status"></span><button data-oc-refresh>Refresh</button></footer>`;
    root.addEventListener('click',event=>{
      const button=event.target.closest('button');if(!button)return;
      if(button.dataset.ocFilter){if(state.loading)return;historyMode=false;state.filter=button.dataset.ocFilter;state.cursor=null;state.items=[];refresh();}
      else if(button.hasAttribute('data-oc-create'))create();
      else if(button.hasAttribute('data-oc-toggle')){feedHidden=!feedHidden;try{localStorage.setItem('northstarConsoleFeed:'+state.info?.actor,feedHidden?'hidden':'visible');}catch{}render();}
      else if(button.hasAttribute('data-oc-expand'))window.NorthstarModules?.open('logbook:operationsConsole');
      else if(button.hasAttribute('data-oc-more')){historyMode=true;refresh(true);}
      else if(button.hasAttribute('data-oc-refresh')){historyMode=false;refresh();}
      else if(button.hasAttribute('data-oc-sources')){
        const sources=state.info?.sources;
        modal('Console sources',`<p>${esc(sources?.note||'Source status unavailable')}</p><ul>${(sources?.sources||[]).map(s=>`<li>${esc(s.label)} — ${esc(s.state)} · ${s.lastRecordedAt?'last recorded '+esc(time(s.lastRecordedAt)):'no records'}</li>`).join('')}</ul><p>Automatic task evidence: ${esc(state.info?.evidenceAdapter||'unavailable')}</p>`);
      }
      else if(button.dataset.ocId)detail(button.dataset.ocId,button.dataset.ocTask==='true');
    });
    root.querySelector('[data-oc-status]').onchange=event=>{state.status=event.target.value;state.cursor=null;refresh();};
    const sources=document.createElement('button');sources.type='button';sources.dataset.ocSources='';sources.textContent='Sources';root.querySelector('footer').append(sources);
  }
  function boot(){
    const section=document.getElementById('logbook'),tracker=document.getElementById('overviewStaff');if(!section||!tracker)return;
    const full=document.createElement('article');full.id='operationsConsole';full.className='panel';full.dataset.moduleId='operationsConsole';section.append(full);mount(full);
    const tasksHost=document.getElementById('operations-sites')||document.getElementById('operations');
    if(tasksHost){const tasks=document.createElement('article');tasks.id='operationsTasks';tasks.className='panel';tasks.setAttribute('aria-label','Tasks');tasksHost.append(tasks);mount(tasks);tasks.querySelector('.oc-title').textContent='Tasks';}
    const compact=document.createElement('article');compact.id='overviewOperationsConsole';compact.className='panel';compact.hidden=true;tracker.before(compact);mount(compact);
    channel?.addEventListener('message',()=>refresh());
    addEventListener('focus',()=>refresh());refresh();
    const away=new Map();let restoreTimer;
    function replaceTracker(target,popup){
      if(!target||!popup||away.has(target))return;
      const rect=target.getBoundingClientRect(),css=getComputedStyle(target),scroll={x:window.scrollX,y:window.scrollY};
      away.set(target,{popup,style:target.getAttribute('style'),hidden:target.hidden});
      if(away.size===1){
        target.before(compact);compact.hidden=false;
        compact.style.position=css.position==='fixed'?'fixed':'absolute';
        compact.style.transform='none';compact.style.translate='none';compact.style.margin='0';
        compact.style.setProperty('width',rect.width+'px','important');compact.style.setProperty('max-width','none','important');compact.style.setProperty('height',Math.max(240,rect.height)+'px','important');
        const bar=document.getElementById('nsStatusBar');
        const floor=bar&&getComputedStyle(bar).display!=='none'?bar.getBoundingClientRect().bottom+8:0;
        const parent=compact.offsetParent,origin=compact.style.position==='fixed'?{left:0,top:0}:parent?.getBoundingClientRect()||{left:0,top:0};
        compact.style.left=(rect.left-origin.left)+'px';compact.style.top=(Math.max(rect.top,floor)-origin.top)+'px';
        // Hiding the source triggers the existing canvas layout pass. Align
        // after that pass, using rendered coordinates (including its scroll).
        requestAnimationFrame(()=>requestAnimationFrame(()=>{
          if(compact.hidden)return;
          window.scrollTo(scroll.x,scroll.y);
          const anchor=compact.offsetParent?.getBoundingClientRect()||{left:0,top:0};
          compact.style.setProperty('left',(rect.left-anchor.left)+'px','important');
          compact.style.setProperty('top',(Math.max(rect.top,floor)-anchor.top)+'px','important');
        }));
      }
      target.style.setProperty('display','none','important');target.classList.add('ns-console-tracker-away');
      clearInterval(restoreTimer);restoreTimer=setInterval(()=>{
        for(const [node,prior] of away){if(prior.popup.closed){if(prior.style===null)node.removeAttribute('style');else node.setAttribute('style',prior.style);node.hidden=prior.hidden;node.classList.remove('ns-console-tracker-away');away.delete(node);}}
        if(!away.size){compact.hidden=true;compact.removeAttribute('style');clearInterval(restoreTimer);}
      },300);
    }
    function showTasks(){
      historyMode=false;state.filter='tasks';state.status='open';state.cursor=null;state.items=[];
      if(state.loading)generation++;
      refresh();
    }
    window.NorthstarOperationsConsole={refresh,replaceTracker,showTasks};
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});else boot();
})();
