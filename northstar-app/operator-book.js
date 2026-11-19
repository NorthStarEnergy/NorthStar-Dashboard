/* Operator Log Book. The server owns entries, comments, equipment notes and schedules. */
(async () => {
  'use strict';
  const $ = id => document.getElementById(id);
  const session = await window.northstarOperatorSession;
  if (!session || (session.required && session.role !== 'operator')) {
    $('startupError').hidden=false;$('startupError').textContent='An operator session is required.';document.querySelector('main').hidden=true;return;
  }
  const esc = v => String(v ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const url = new URL(location.href), viewNames={entry:'Log Book',general:'General',notes:'Notes',historical:'Historical'};
  const time = v => v && Number.isFinite(new Date(v).getTime()) ? new Date(v).toLocaleString('en-CA',{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit',hourCycle:'h23',timeZone:'America/Toronto'}) : '—';
  const day = d => [d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-');
  async function api(path,body){
    const response=await fetch(path,body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{cache:'no-store'});
    let data;try{data=await response.json();}catch{throw Error('Service returned HTTP '+response.status);}
    if(!response.ok)throw Error(data.error||'Request failed ('+response.status+')');return data;
  }
  function run(status,fn){return async e=>{e?.preventDefault();try{await fn(e);}catch(err){$(status).textContent=err.message;}};}
  function form(id,status,fn){
    const node=$(id);let busy=false;
    node.onsubmit=run(status,async()=>{
      if(busy)return;busy=true;
      const controls=[...node.elements].filter(n=>!n.disabled);controls.forEach(n=>n.disabled=true);
      try{await fn();}finally{busy=false;controls.forEach(n=>n.disabled=false);}
    });
  }
  function attempt(){let signature='',id='';return data=>{const next=JSON.stringify(data);if(next!==signature){signature=next;id=crypto.randomUUID();}return id;};}
  function button(label,action,cls=''){const b=document.createElement('button');b.type='button';b.textContent=label;b.onclick=action;b.className=cls;return b;}
  let view='entry', liveToken=0, current=null, detailToken=0, scheduled=null, noteId='',noteToken=0,assetPage=1,searchToken=0,historyToken=0, historyParams=null,cursor='',visibleHistory=[], noteCounts={},stations=[], templates=[],tasks=[];
  let entryRequest=attempt(), commentRequest=attempt(), noteRequest=attempt();
  const savedKey='northstar.book.views.'+(session.username||session.role||'local');
  const layout = window.NorthstarBookLayout.mount(savedKey);
  // Each two-pane view remembers its divider on this operator's browser.
  for (const panel of document.querySelectorAll('.columns')) {
    const key=savedKey+'.divider.'+panel.closest('[data-page]').dataset.page;
    const grip=document.createElement('button');
    grip.type='button';grip.className='divider';grip.setAttribute('role','separator');
    grip.setAttribute('aria-orientation','vertical');grip.setAttribute('aria-label','Resize panels');
    grip.setAttribute('aria-valuemin','30');grip.setAttribute('aria-valuemax','70');
    grip.title='Drag to resize panels. Use the arrow keys for fine adjustments.';
    panel.append(grip);
    let value=52;
    function set(n) {
      value=Math.max(30,Math.min(70,n));panel.style.setProperty('--split',value+'%');
      grip.setAttribute('aria-valuenow',String(Math.round(value)));
    }
    function save(){try{localStorage.setItem(key,String(value));}catch{}}
    try{set(Number(localStorage.getItem(key))||value);}catch{set(value);}
    grip.onpointerdown=e=>{
      if(e.button!==0)return;
      e.preventDefault();grip.setPointerCapture(e.pointerId);
      const start=value, x=e.clientX, width=panel.getBoundingClientRect().width;
      grip.onpointermove=m=>set(start+(m.clientX-x)*100/width);
      grip.onpointercancel=()=>set(start);
      grip.onlostpointercapture=()=>{grip.onpointermove=null;save();};
    };
    grip.onkeydown=e=>{
      if(!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;
      e.preventDefault();set(e.key==='Home'?30:e.key==='End'?70:value+(e.key==='ArrowLeft'?-1:1)*(e.shiftKey?5:1));save();
    };
  }
  $('entryForm').addEventListener('keydown',e=>{
    if(e.key==='Enter' && (e.ctrlKey||e.metaKey)){e.preventDefault();$('entryForm').requestSubmit($('record'));}
  });
  function saved(){try{return JSON.parse(localStorage.getItem(savedKey)||'[]');}catch{return [];}}
  function show(name,item){
    view=Object.hasOwn(viewNames,name)?name:'entry';
    document.querySelectorAll('[data-page]').forEach(el=>el.hidden=el.dataset.page!==view);
    layout.show(view);
    $('pageTitle').textContent=viewNames[view];document.title=viewNames[view]+' · NorthStar';
    if(view==='entry'){refreshLive();refreshSchedules();}
    if(view==='notes'){findAssets();if(item)openTarget(item);}
    if(view==='historical')searchHistory();
    if(view==='general'){refreshGeneral();renderSaved();}
  }
  function records(host,rows,empty='No matching records.'){
    host.replaceChildren(...rows.map(item=>{
      const b=button('',()=>openEvent(item),'record'+(item.category==='alarm'?' alarm':''));
      const summary=item.summary||item.eventType||'Event', stamp=time(item.occurredAt);
      const meta=[item.site,item.source,item.severity].filter(Boolean).join(' · ');
      b.dataset.tone=['critical','warning'].includes(item.severity)?item.severity:item.category==='alarm'?'warning':item.category==='log'?'log':'info';
      b.title=[stamp+' ET',meta,summary].filter(Boolean).join(' · ');b.setAttribute('aria-label',b.title);
      b.innerHTML='<time>'+esc(stamp)+'</time><span class="event-summary">'+esc(summary)+'</span><small>'+esc([item.severity,item.site||item.source].filter(Boolean).join(' · '))+'</small>';return b;
    }));
    if(!rows.length)host.textContent=empty;
  }
  const presets={all:{},alarms:{type:'alarm'},critical:{severity:'critical'},logs:{type:'log'}};
  let preset='all', applied={};
  const filterForm=$('liveFilters'), more=$('moreFilters');
  function filterButtons(){
    document.querySelectorAll('[data-feed-preset]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.feedPreset===preset && (preset!=='all' || !Object.keys(applied).length))));
    const count=Object.values(applied).filter(Boolean).length;more.textContent=count?'Filters ('+count+')':'Filters';
  }
  document.querySelectorAll('[data-feed-preset]').forEach(b=>b.onclick=()=>{
    preset=b.dataset.feedPreset;
    if(preset==='all'){applied={};filterForm.reset();}
    else if(preset==='critical'){delete applied.severity;filterForm.elements.severity.value='';}
    filterButtons();refreshLive();
  });
  more.onclick=()=>{filterForm.hidden=!filterForm.hidden;more.setAttribute('aria-expanded',String(!filterForm.hidden));};
  filterForm.onsubmit=e=>{
    e.preventDefault();applied=Object.fromEntries([...new FormData(filterForm)].map(([k,v])=>[k,v.trim()]).filter(([,v])=>v));
    if(preset==='critical' && applied.severity && applied.severity!=='critical')preset='all';
    filterButtons();refreshLive();
  };
  $('clearFilters').onclick=()=>{preset='all';applied={};filterForm.reset();filterButtons();refreshLive();};
  async function refreshLive(){
    const token=++liveToken,p=new URLSearchParams({limit:'40',...presets[preset],...applied});
    try{const data=await api('/api/events/register?'+p);if(token!==liveToken)return;
      records($('live'),data.items);$('liveStatus').textContent='Updated '+time(new Date().toISOString())+' ET';
    }catch(e){if(token===liveToken)$('liveStatus').textContent='Update failed · '+e.message;}
  }
  $('refreshLive').onclick=refreshLive;
  async function refreshGeneral(){
    try{const d=await api('/api/events/register?limit=24&type=communication&type=log&type=field');records($('news'),d.items,'No operational updates recorded.');$('generalStatus').textContent='';}catch(e){$('generalStatus').textContent=e.message;}
  }
  $('refreshGeneral').onclick=refreshGeneral;
  async function openEvent(row){
    const token=++detailToken;current=row;commentRequest=attempt();$('comment').value='';$('comments').replaceChildren();$('commentStatus').textContent='';
    $('eventTitle').textContent=row.summary||row.eventType;$('eventMeta').textContent=[time(row.occurredAt)+' ET',row.site,row.actorId,row.severity].filter(Boolean).join(' · ');
    $('eventBody').textContent=row.payload?.details||row.payload?.description||'';$('fullRecord').href='event-detail.html?id='+encodeURIComponent(row.eventId);
    if(!$('eventDialog').open)$('eventDialog').showModal();
    try{const d=await api('/api/events/detail?id='+encodeURIComponent(row.eventId)+'&limit=100');
      if(token!==detailToken)return;
      const linked=d.history.items.filter(n=>n.payload?.parentEventId===row.eventId);
      $('comments').replaceChildren(...linked.map(n=>noteLine(n.payload.details,n.actorId,n.occurredAt)));
      if(!linked.length)$('comments').textContent=d.history.nextCursor?'Earlier history is available in the full record.':'No comments yet.';
    }catch(e){if(token===detailToken)$('commentStatus').textContent=e.message;}
  }
  function noteLine(text,actor,at){const el=document.createElement('div');el.className='note';el.innerHTML='<small>'+esc(time(at))+' ET · '+esc(actor)+'</small><p>'+esc(text)+'</p>';return el;}
  $('closeEvent').onclick=()=>$('eventDialog').close();
  form('commentForm','commentStatus',async()=>{
    const row=current,data={eventId:row.eventId,text:$('comment').value.trim()};await api('/api/events/notes',{...data,requestId:commentRequest(data)});
    if(current===row){await openEvent(row);$('commentStatus').textContent='Comment recorded.';}refreshLive();
  });
  $('ticket').onclick=run('commentStatus',async()=>{
    const row=current,control=$('ticket');control.disabled=true;
    try{const t=await api('/api/console/tasks',{sourceEventId:row.eventId,title:(row.summary||row.eventType).slice(0,240),stationId:row.payload?.siteId||row.payload?.stationId||row.site||row.payload?.siteCode||'',category:'Follow-up',description:row.payload?.details||'',completionMode:'manual'});
      if(current===row)$('commentStatus').textContent='Follow-up ticket '+t.id+' · '+t.status;
    }finally{control.disabled=false;}
  });
  function setTask(t){
    scheduled=t;$('unlinkTask').hidden=!t;$('entrySite').disabled=!!t;
    if(t){$('subject').value=t.title;$('entryText').value=t.description;$('entrySite').value=t.stationId||'';$('entryStatus').textContent='Scheduled draft · '+time(t.dueAt)+' ET';$('aiPreview').hidden=true;$('entryText').focus();}
  }
  $('unlinkTask').onclick=()=>{setTask(null);$('entryStatus').textContent='Draft detached from schedule.';};
  form('entryForm','entryStatus',async()=>{
    const data={subject:$('subject').value.trim(),details:$('entryText').value.trim(),type:$('entryType').value,stationId:scheduled?.stationId||$('entrySite').value};
    if(scheduled)Object.assign(data,{taskId:scheduled.id,version:scheduled.version});
    $('entryStatus').textContent='Recording…';const r=await api('/api/console/logbook',{...data,requestId:entryRequest(data)});
    entryRequest=attempt();setTask(null);$('subject').value='';$('entryText').value='';$('aiPreview').hidden=true;
    $('entryStatus').innerHTML='Entry recorded. <a target="_blank" rel="noopener" href="event-detail.html?id='+encodeURIComponent(r.eventId)+'">Open record</a>';refreshLive();refreshSchedules();
  });
  let aiInput='';
  $('assist').onclick=run('entryStatus',async()=>{
    const original=$('entryText').value.trim();if(!original){$('entryText').focus();$('entryStatus').textContent='Enter a draft first.';return;}
    $('assist').disabled=true;$('entryStatus').textContent='Requesting a wording suggestion…';
    try{const d=await api('/api/ai/query',{question:'Edit this operator log draft for clarity. Retain only the supplied facts, exact tags and times. Return only the edited draft.\n\n'+original,section:'Log Book',context_scope:'general',sourceMode:'auto'});
      if(!d.answer||d.answer.length>4000)throw Error('No usable suggestion was returned.');
      aiInput=original;$('aiText').textContent=d.answer;$('aiPreview').hidden=false;$('entryStatus').textContent='Review the suggestion before using it.';
    }finally{$('assist').disabled=false;}
  });
  $('useAi').onclick=()=>{if($('entryText').value.trim()!==aiInput){$('entryStatus').textContent='Draft changed. Request a fresh suggestion.';return;}$('entryText').value=$('aiText').textContent;$('aiPreview').hidden=true;};
  $('dismissAi').onclick=()=>$('aiPreview').hidden=true;
  let scheduleToken=0;
  async function refreshSchedules(){
    const token=++scheduleToken;
    try{const [a,b]=await Promise.all([api('/api/console/tasks?category=Log+Book&status=open&limit=100'),api('/api/console/task-templates')]);if(token!==scheduleToken)return;
      tasks=a.items.filter(t=>t.recurrenceTemplateId).sort((x,y)=>x.dueAt.localeCompare(y.dueAt));templates=b.items.filter(t=>t.category==='Log Book');
      $('dueCount').textContent=tasks.length?'('+tasks.length+')':'';
      $('drafts').replaceChildren(...tasks.map(t=>button(t.title+' · '+time(t.dueAt),()=>{
        if(($('subject').value||$('entryText').value)&&!confirm('Replace the current draft with this scheduled draft?'))return;setTask(t);
      },'target')));if(!tasks.length)$('drafts').textContent='No scheduled drafts waiting.';
      $('templates').replaceChildren(...templates.map(t=>{const el=document.createElement('div');el.className='scheduleRow';el.append(t.title+' · '+t.localTime+' ET',button(t.enabled?'Pause':'Resume',run('scheduleStatus',async e=>{e.currentTarget.disabled=true;try{await api('/api/console/task-templates/'+encodeURIComponent(t.id),{version:t.version,enabled:!t.enabled});await refreshSchedules();}finally{el.querySelector('button').disabled=false;}})));return el;}));
    }catch(e){if(token===scheduleToken)$('scheduleStatus').textContent=e.message;}
  }
  form('scheduleForm','scheduleStatus',async()=>{const f=$('scheduleForm').elements;
    await api('/api/console/task-templates',{title:f.title.value.trim(),description:f.description.value.trim(),localTime:f.time.value,stationId:$('scheduleSite').value,category:'Log Book',timezone:'America/Toronto',recurrenceRule:'daily'});
    $('scheduleForm').reset();$('scheduleStatus').textContent='Daily schedule saved. The scheduler generates reviewable drafts.';await refreshSchedules();
  });
  async function findAssets(){
    const token=++searchToken, equipment=$('targetKind').value==='equipment', query=$('assetQuery').value.trim(),site=$('assetSite').value;
    $('equipmentScope').hidden=!equipment;$('assetPrev').hidden=$('assetNext').hidden=true;
    try{let rows, pages=1,total;
      const counts=await api('/api/library/note-counts');if(token!==searchToken)return;noteCounts=counts.counts||{};
      if(equipment){const d=await api('/api/maximo/equipment?'+new URLSearchParams({q:query,site,page:assetPage,limit:30}));if(token!==searchToken)return;
        $('assetSite').replaceChildren(new Option('All sites',''),...d.sites.map(s=>new Option(s.code,s.code)));$('assetSite').value=site;
        rows=d.assets.map(a=>({id:a.noteItemId,name:a.assetNum,detail:[a.description,a.site,a.location].filter(Boolean).join(' · ')}));pages=d.pages;total=d.total;
        $('searchStatus').textContent=d.available?total+' matching tags':'No equipment inventory has been imported.';
      }else{rows=stations.filter(s=>s.kind!=='system' && s.name.toLowerCase().includes(query.toLowerCase())).map(s=>({id:s.id,name:s.name,detail:s.area||''}));$('searchStatus').textContent=rows.length+' stations';}
      $('assetResults').replaceChildren(...rows.map(r=>{const b=button('',()=>openTarget(r.id),'target');b.innerHTML='<strong>'+esc(r.name)+'</strong><small>'+esc(r.detail)+'</small>'+(noteCounts[r.id]?'<small class="flag">⚑ '+Number(noteCounts[r.id])+' active notes</small>':'');return b;}));
      $('assetPrev').hidden=assetPage<=1;$('assetNext').hidden=assetPage>=pages;
    }catch(e){if(token===searchToken)$('searchStatus').textContent=e.message;}
  }
  function searchTargets(){assetPage=1;findAssets();}
  $('targetKind').onchange=$('assetSite').onchange=searchTargets;$('assetSearch').onsubmit=e=>{e.preventDefault();searchTargets();};
  $('assetPrev').onclick=()=>{assetPage--;findAssets();};$('assetNext').onclick=()=>{assetPage++;findAssets();};
  async function openTarget(id){
    const token=++noteToken;noteId='';$('noteForm').hidden=true;$('objectTitle').textContent='Loading record…';$('objectNotes').replaceChildren();$('objectMeta').textContent='';$('noteStatus').textContent='';
    try{const d=await api('/api/library/item?id='+encodeURIComponent(id));if(token!==noteToken)return;
      noteId=d.id;noteRequest=attempt();$('objectTitle').textContent=d.name;$('objectMeta').textContent=[d.site,d.description,d.location].filter(Boolean).join(' · ');
      $('assetNote').value='';$('noteForm').hidden=false;$('objectNotes').replaceChildren(...d.notes.map(n=>noteLine(n.text,n.actorId+(n.expired?' · expired':''),n.createdAt)));
      if(!d.notes.length)$('objectNotes').textContent='No notes on this record.';
    }catch(e){if(token===noteToken){$('objectTitle').textContent='Record unavailable';$('noteStatus').textContent=e.message;}}
  }
  form('noteForm','noteStatus',async()=>{const data={itemId:noteId,text:$('assetNote').value.trim()};await api('/api/library/notes',{...data,requestId:noteRequest(data)});if(noteId===data.itemId){await openTarget(noteId);$('noteStatus').textContent='Note attached.';}findAssets();});
  function filters(){return {q:$('historyQuery').value.trim(),type:$('historyType').value,site:$('historySite').value,from:$('from').value,through:$('through').value};}
  function restore(f){for(const [id,key] of [['historyQuery','q'],['historyType','type'],['historySite','site'],['from','from'],['through','through']])$(id).value=f[key]||'';}
  function paramsFor(f){
    const p=new URLSearchParams({limit:'40'});for(const k of ['q','type','site'])if(f[k])p.set(k,f[k]);
    if(f.from)p.set('from',new Date(f.from+'T00:00:00').toISOString());
    if(f.through)p.set('to',new Date(f.through+'T23:59:59.999').toISOString());return p;
  }
  async function searchHistory(older=false){
    const token=++historyToken,f=filters();if(f.from&&f.through&&f.from>f.through){$('historyStatus').textContent='Choose an end date after the start.';return;}
    const p=older?new URLSearchParams(historyParams):paramsFor(f);
    if(older)p.set('cursor',cursor);else{$('trend').replaceChildren();$('historyRows').replaceChildren();visibleHistory=[];historyParams=p.toString();}
    $('older').hidden=true;$('historyStatus').textContent='Searching…';
    try{const d=await api('/api/events/register?'+p);if(token!==historyToken)return;
      visibleHistory=older?[...visibleHistory,...d.items]:d.items;cursor=d.nextCursor;records($('historyRows'),visibleHistory);$('older').hidden=!cursor;$('historyStatus').textContent=visibleHistory.length+' of '+d.total+' records';
      if(!older && f.from && f.through){
        const lo=new Date(f.from+'T00:00:00').getTime(), hi=new Date(f.through+'T23:59:59.999').getTime()+1;
        const count=Math.min(7,Math.max(1,Math.round((hi-lo)/86400000)));
        const bins=await Promise.all(Array.from({length:count},async(_,i)=>{const start=lo+Math.round((hi-lo)*i/count),end=lo+Math.round((hi-lo)*(i+1)/count)-1;
          const q=new URLSearchParams(p);q.set('limit','1');q.set('from',new Date(start).toISOString());q.set('to',new Date(end).toISOString());
          return {start,end,total:(await api('/api/events/register?'+q)).total};}));
        if(token!==historyToken)return;const max=Math.max(1,...bins.map(b=>b.total));
        $('trend').innerHTML=bins.map(b=>'<div title="'+esc(time(b.start)+' – '+time(b.end)+' ET')+'">'+Number(b.total)+'<b style="height:'+Math.round(b.total/max*32)+'px"></b><span>'+esc(day(new Date(b.start)).slice(5))+'</span></div>').join('');
      }
    }catch(e){if(token===historyToken){$('historyStatus').textContent=e.message;$('older').hidden=!older||!cursor;}}
  }
  $('historyForm').onsubmit=e=>{e.preventDefault();searchHistory();};$('older').onclick=()=>searchHistory(true);
  function renderSaved(){
    const all=saved();$('bookmarks').replaceChildren(...all.map((v,i)=>{const el=document.createElement('div');el.className='scheduleRow';
      el.append(button(v.name,()=>{if(parent!==window)parent.NorthstarBookNav?.open('historical');else show('historical');restore(v.filters);searchHistory();}),button('Remove',()=>{all.splice(i,1);localStorage.setItem(savedKey,JSON.stringify(all));renderSaved();}));return el;}));
    if(!all.length)$('bookmarks').textContent='Views saved in Historical appear here.';
  }
  $('saveView').onclick=run('historyStatus',()=>{const name=prompt('Name this historical view');if(!name?.trim())return;
    const all=saved().filter(v=>v.name!==name.trim());all.push({name:name.trim(),filters:filters()});localStorage.setItem(savedKey,JSON.stringify(all));$('historyStatus').textContent='View saved in General on this browser.';});
  $('standaloneHome').hidden=parent!==window;$('libraryLink').href='library.html?build='+(url.searchParams.get('build')==='v3'?'v3':'v1');
  const today=new Date(),week=new Date(today);week.setDate(today.getDate()-6);$('from').value=day(week);$('through').value=day(today);
  try{const d=await api('/api/console/status');stations=(d.stations||[]).filter(s=>s.id&&s.name);
    for(const source of d.sources||[]) if(source.id) $('feedSources').append(new Option(source.id));
    for(const s of stations) $('feedSite').add(new Option(s.name,s.name));
    for(const id of ['entrySite','scheduleSite','historySite'])for(const s of stations)$(id).add(new Option(s.name,id==='historySite'?s.name:s.id));
  }catch(e){$('startupError').hidden=false;$('startupError').textContent='Station list unavailable · '+e.message;}
  window.NorthstarOperatorBook={show,layout};const initial=parent!==window?parent.NorthstarBookNav?.current():null;
  show(initial?.view||url.searchParams.get('view')||'entry',initial?.item||url.searchParams.get('item'));
  setInterval(()=>{if(!document.hidden && (parent===window||parent.NorthstarBookNav?.current()) && view==='entry'){refreshLive();if($('schedules').open)refreshSchedules();}},30000);
})();