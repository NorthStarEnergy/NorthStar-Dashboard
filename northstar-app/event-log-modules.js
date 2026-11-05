(() => {

  'use strict';

  function init() {

    const host=document.querySelector('#logbook');

    const history=document.querySelector('#eventRegister');

    const composer=document.querySelector('#logbook .logbook-card');

    if(!host||!history||!composer||document.querySelector('#eventLogs'))return;

    const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));

    const stamp=value=>value?new Date(value).toLocaleString('en-CA',{timeZone:'America/Toronto',year:'numeric',month:'short',day:'2-digit',hour:'2-digit',minute:'2-digit'}):'Time unavailable';

    const logs=document.createElement('div');logs.id='eventLogs';

    const categories=['ALL','ALARMS','CRITICAL','SCADA','DISPATCH','COMS','WATER','MARKET'];

    const children={SCADA:['S+','WONDERWARE'],COMS:['OUTLOOK','PHONE','TEAMS']};

    logs.innerHTML=`<nav class="el-categories" aria-label="Log categories"><button type="button" id="elNew">NEW LOG</button>${categories.map(name=>`<button type="button" data-el-category="${name}" aria-pressed="${name==='ALL'}">${name}</button>`).join('')}</nav>

      <nav id="elSubcategories" class="el-subcategories" aria-label="Log subcategories" hidden></nav>



      <div class="el-table-wrap"><div class="el-table-head" role="row"><span role="columnheader">TIME<button type="button" class="el-column-grip" data-resize-column="time" aria-label="Resize time column"></button></span><span role="columnheader">SEVERITY<button type="button" class="el-column-grip" data-resize-column="severity" aria-label="Resize severity column"></button></span><span role="columnheader" class="el-event-heading"><span>EVENT</span><span id="elFreshness" role="status">Loading records…</span><button type="button" class="el-column-grip" data-resize-column="event" aria-label="Resize event column"></button></span><span role="columnheader">SOURCE / SITE<button type="button" class="el-column-grip" data-resize-column="source" aria-label="Resize source column"></button></span><span role="columnheader">ACTIONS</span></div><div id="elRows" class="el-rows" role="rowgroup"></div></div><footer class="el-footer"><span id="elRowStatus" role="status"></span><button type="button" id="elMore" hidden>Show more</button><button type="button" id="elRefresh">Refresh</button></footer>

      <dialog class="el-input" aria-label="New operator log"><div class="el-input-heading"><h3>New log</h3><div class="el-window-controls"><button type="button" id="elClose" class="el-window-close" aria-label="Close new log" title="Close"></button><button type="button" id="elMinimize" class="el-window-minimize" aria-label="Minimize new log" title="Minimize"></button><button type="button" id="elMaximize" class="el-window-maximize" aria-label="Maximize new log" title="Maximize"></button></div></div></dialog>`;

    host.prepend(logs);

    composer.hidden=false;composer.querySelector('#logList')?.setAttribute('hidden','');

    logs.querySelector('.el-input').append(composer);

    composer.querySelector('.events-head')?.remove();

    const fields=composer.querySelector('.logbook-fields');

    fields?.insertAdjacentHTML('beforeend','<label>SITE<input id="logSite" placeholder="Station or location"></label><label>EQUIPMENT / NODE<input id="logEquipment" placeholder="Unit, breaker, node, or tag"></label><label>SOURCE REFERENCE<input id="logReference" placeholder="Event ID, directive, or call reference"></label>');

    const report=host.querySelector('.logbook-report');

    report?.remove();

    history.insertAdjacentHTML('afterbegin','<div class="el-history-title"><h2>Historical</h2><p>Search the audit history, inspect event reports, and build retrieval drafts.</p></div>');

    const builder=document.createElement('section');builder.className='el-report';

    builder.innerHTML=`<h3>Historical analysis and report draft</h3><p>Uses the filters above. Retrieve a bounded snapshot, inspect counts and trends, then download a draft or CSV. No report is published automatically.</p>

      <div class="el-report-actions"><button type="button" id="elAnalyze">Analyze matching records</button><button type="button" id="elCsv" disabled>Download CSV</button><button type="button" id="elDraft" disabled>Download report draft</button></div>

      <p id="elReportStatus" role="status">Set filters above, then analyze.</p><div id="elReportSummary"></div><div id="elReportChart" class="el-chart" aria-label="Events by day"></div>`;

    history.append(builder);

    history.querySelector('#erWrite')?.addEventListener('click',event=>{event.stopImmediatePropagation();window.NorthstarModules?.open('logbook:eventLogs');openComposer();},true);


    const columnDefaults={time:180,severity:96,event:420,source:180};
    try{const saved=JSON.parse(localStorage.getItem('northstar.eventLog.columnWidths')||'{}');for(const [key,value] of Object.entries(saved))if(key in columnDefaults&&Number.isFinite(value))logs.style.setProperty(`--el-${key}-width`,`${Math.max(64,Math.min(900,value))}px`);}catch{}
    logs.querySelectorAll('[data-resize-column]').forEach(grip=>{
      const key=grip.dataset.resizeColumn,min={time:120,severity:72,event:160,source:100}[key];
      const width=()=>parseFloat(getComputedStyle(logs).getPropertyValue(`--el-${key}-width`))||columnDefaults[key];
      grip.addEventListener('pointerdown',event=>{event.preventDefault();grip.setPointerCapture(event.pointerId);grip.dataset.startX=event.clientX;grip.dataset.startWidth=width();grip.classList.add('is-dragging');});
      grip.addEventListener('pointermove',event=>{if(!grip.hasPointerCapture(event.pointerId))return;const next=Math.max(min,Math.min(900,Number(grip.dataset.startWidth)+event.clientX-Number(grip.dataset.startX)));logs.style.setProperty(`--el-${key}-width`,`${next}px`);});
      const finish=event=>{if(!grip.hasPointerCapture(event.pointerId))return;grip.releasePointerCapture(event.pointerId);grip.classList.remove('is-dragging');const saved={};for(const name of Object.keys(columnDefaults))saved[name]=parseFloat(getComputedStyle(logs).getPropertyValue(`--el-${name}-width`))||columnDefaults[name];try{localStorage.setItem('northstar.eventLog.columnWidths',JSON.stringify(saved));}catch{}};
      grip.addEventListener('pointerup',finish);grip.addEventListener('pointercancel',finish);
      grip.addEventListener('keydown',event=>{if(!['ArrowLeft','ArrowRight'].includes(event.key))return;event.preventDefault();const next=Math.max(min,Math.min(900,width()+(event.key==='ArrowRight'?16:-16)));logs.style.setProperty(`--el-${key}-width`,`${next}px`);grip.dispatchEvent(new Event('change'));const saved={};for(const name of Object.keys(columnDefaults))saved[name]=parseFloat(getComputedStyle(logs).getPropertyValue(`--el-${name}-width`))||columnDefaults[name];try{localStorage.setItem('northstar.eventLog.columnWidths',JSON.stringify(saved));}catch{}});
    });

    let category='ALL',child='ALL',rows=[],request=0,displayLimit=100,reportRows=[],reportTotal=0,reportQuery='';

    async function get(path){const response=await fetch(path,{cache:'no-store'});const body=await response.json();if(!response.ok)throw Error(body.error||`Request failed (${response.status})`);return body;}

    function href(item){return 'event-detail.html?id='+encodeURIComponent(item.eventId);}

    const normalize=value=>String(value||'').trim().toLowerCase();

    function matches(item){

      const payload=item.payload||{},source=normalize(item.source),provider=normalize(payload.provider||payload.system||payload.scadaSystem||payload.sourceSystem);

      const declared=normalize(payload.logCategory||payload.category),sub=normalize(payload.logSubcategory||payload.subcategory||payload.subtype);

      const kind=normalize(item.eventType),channel=normalize(item.display?.channel);

      if(category==='ALL')return true;

      if(category==='ALARMS')return window.NorthstarAlarmInteractions?.isAlarm?.(item) || item.category==='alarm' || normalize(item.eventType).includes('alarm') || normalize(item.eventType).includes('help');

      if(category==='CRITICAL')return normalize(item.severity)==='critical';

      if(category==='SCADA'){

        const scada=['scada','s+','splus','s-plus','wonderware'].includes(source)||declared==='scada';

        return scada&&(child==='ALL'||(child==='S+'?['s+','splus','s-plus'].some(v=>[source,provider,sub].includes(v)):[source,provider,sub].includes('wonderware')));

      }

      if(category==='COMS'){

        const medium=['outlook','teams','phone','voice'].includes(source)?source:provider||channel;

        const comms=item.category==='communication'||['outlook','teams','phone','voice'].includes(medium)||['comms','c-o-m-s','communications'].includes(declared);

        return comms&&(child==='ALL'||(child==='PHONE'?['phone','voice'].includes(medium):medium===child.toLowerCase()));

      }

      if(category==='DISPATCH')return source==='dispatch'||declared==='dispatch'||kind.startsWith('dispatch.')||channel==='dispatch';

      if(category==='WATER')return ['water','water_management','water-management'].includes(source)||declared==='water'||kind.startsWith('water.')||channel==='water';

      if(category==='MARKET')return ['market','markets'].includes(source)||declared==='market'||kind.startsWith('market.')||channel==='market';

      return false;

    }

    function paint(){

      const selected=rows.filter(matches);
      const ordered=category==='ALL'?[...selected].sort((left,right)=>{const a=window.NorthstarAlarmInteractions?.pinRank?.(left.eventId)??Number.MAX_SAFE_INTEGER,b=window.NorthstarAlarmInteractions?.pinRank?.(right.eventId)??Number.MAX_SAFE_INTEGER;return a===b?0:a-b;}):selected;
      const visible=ordered.slice(0,displayLimit);

      logs.querySelector('#elRows').innerHTML=visible.map(item=>{const alarm=window.NorthstarAlarmInteractions?.isAlarm?.(item) || item.category==='alarm' || normalize(item.eventType).includes('alarm') || normalize(item.eventType).includes('help'),state=alarm?window.NorthstarAlarmInteractions?.state?.(item.eventId):null;return `<article class="el-row${alarm?' el-alarm-row':''}${state?.acknowledged?' ns-alarm-acknowledged':''}${state?.cleared?' ns-alarm-cleared':''}${state?.pinned?' ns-alarm-pinned':''}" role="row"${alarm?` data-ns-alarm-id="${esc(item.eventId)}"`:''}><time role="cell" title="${esc(stamp(item.occurredAt))} ET">${esc(stamp(item.occurredAt))} ET</time><span role="cell" class="el-severity el-${esc(item.severity)}">${esc(item.severity||'info')}</span><a role="cell" href="${href(item)}" title="${esc(alarm?'Click to open alarm window and acknowledge; double-click to clear.':item.summary||item.eventType||'Event')}">${esc(item.summary||item.eventType||'Event')}${state?.pinned?'<small class="el-pinned">PINNED</small>':''}${state?.cleared?'<small class="el-pinned">CLEARED</small>':''}</a><span role="cell" class="el-row-source" title="${esc([item.site,item.source].filter(Boolean).join(' · '))}">${esc([item.site,item.source].filter(Boolean).join(' · ')||'—')}</span><details class="el-row-actions" role="cell"><summary aria-label="Record actions">Actions</summary><button type="button" data-prepare-event="${esc(item.eventId)}">Prepare log</button></details></article>`;}).join('')||'<p class="el-empty">No matching records in the retrieved history.</p>';

      logs.querySelector('#elRowStatus').textContent=`${category}${child==='ALL'?'':' / '+child} · ${visible.length.toLocaleString()} shown · ${selected.length.toLocaleString()} matching retrieved records`;

      logs.querySelector('#elMore').hidden=selected.length<=displayLimit;
      window.NorthstarAlarmInteractions?.observe?.(rows);

    }

    function paintChildren(){

      const bar=logs.querySelector('#elSubcategories');bar.hidden=!children[category];

      bar.innerHTML=children[category]?`<span>${category}</span>`+['ALL',...children[category]].map(value=>`<button type="button" data-el-child="${value}" aria-pressed="${value===child}">${value==='ALL'?'ALL '+category:value}</button>`).join(''):'';

    }

    async function load(){

      const id=++request;logs.querySelector('#elFreshness').textContent='Loading complete history…';

      let next=null,loaded=[],total=0;

      try{

        do{

          const params=new URLSearchParams({limit:'100'});if(next)params.set('cursor',next);

          const result=await get('/api/events/register?'+params);if(id!==request)return;

          loaded.push(...result.items);next=result.nextCursor;total=result.total;

          rows=loaded;paint();

          logs.querySelector('#elFreshness').textContent=next?`Loading history · ${loaded.length.toLocaleString()} / ${total.toLocaleString()}`:'Updated '+stamp(result.fetchedAt)+' ET';

        }while(next);

      }catch(error){if(id===request)logs.querySelector('#elFreshness').textContent='Incomplete / stale history: '+error.message+' · retrieved records retained';}

    }

    const composerDialog=logs.querySelector('.el-input');
    function openComposer(){composerDialog.classList.remove('is-minimized','is-maximized');composerDialog.style.position='';composerDialog.style.margin='';composerDialog.style.left='';composerDialog.style.top='';if(!composerDialog.open)composerDialog.showModal();document.querySelector('#logSubject')?.focus();}

    logs.querySelector('#elNew').onclick=openComposer;

    logs.querySelector('#elClose').onclick=()=>composerDialog.close();
    logs.querySelector('#elMinimize').onclick=()=>{composerDialog.classList.remove('is-maximized');composerDialog.classList.toggle('is-minimized');};
    logs.querySelector('#elMaximize').onclick=()=>{composerDialog.classList.remove('is-minimized');composerDialog.classList.toggle('is-maximized');};
    composerDialog.addEventListener('close',()=>{composerDialog.classList.remove('is-minimized','is-maximized');composerDialog.style.position='';composerDialog.style.margin='';composerDialog.style.left='';composerDialog.style.top='';});
    const titlebar=composerDialog.querySelector('.el-input-heading');
    titlebar.addEventListener('pointerdown',event=>{
      if(event.button!==0||event.target.closest('button'))return;
      const rect=composerDialog.getBoundingClientRect(),startX=event.clientX,startY=event.clientY;
      composerDialog.style.position='fixed';composerDialog.style.margin='0';composerDialog.style.left=rect.left+'px';composerDialog.style.top=rect.top+'px';
      titlebar.setPointerCapture(event.pointerId);
      const move=point=>{composerDialog.style.left=Math.max(0,Math.min(innerWidth-64,rect.left+point.clientX-startX))+'px';composerDialog.style.top=Math.max(0,Math.min(innerHeight-32,rect.top+point.clientY-startY))+'px';};
      const stop=()=>{titlebar.removeEventListener('pointermove',move);titlebar.removeEventListener('pointerup',stop);titlebar.removeEventListener('pointercancel',stop);};
      titlebar.addEventListener('pointermove',move);titlebar.addEventListener('pointerup',stop);titlebar.addEventListener('pointercancel',stop);
    });

    logs.querySelector('.el-categories').addEventListener('click',event=>{const button=event.target.closest('[data-el-category]');if(!button)return;category=button.dataset.elCategory;child='ALL';displayLimit=100;logs.querySelectorAll('[data-el-category]').forEach(item=>item.setAttribute('aria-pressed',String(item===button)));paintChildren();paint();});

    logs.querySelector('#elSubcategories').addEventListener('click',event=>{const button=event.target.closest('[data-el-child]');if(!button)return;child=button.dataset.elChild;displayLimit=100;paintChildren();paint();});

    logs.querySelector('#elMore').onclick=()=>{displayLimit+=100;paint();};

    logs.querySelector('#elRefresh').addEventListener('click',load);

    window.addEventListener('northstar:open-alarm-log',event=>{
      category='ALARMS';child='ALL';displayLimit=100;
      logs.querySelectorAll('[data-el-category]').forEach(item=>item.setAttribute('aria-pressed',String(item.dataset.elCategory===category)));
      paintChildren();paint();
      const row=event.detail?.eventId&&logs.querySelector(`[data-ns-alarm-id="${CSS.escape(event.detail.eventId)}"]`);
      row?.scrollIntoView({block:'center'});
    });
    window.addEventListener('northstar:alarm-state-change',paint);

    logs.querySelector('#elRows').addEventListener('click',event=>{const button=event.target.closest('[data-prepare-event]');if(!button)return;const item=rows.find(row=>row.eventId===button.dataset.prepareEvent);if(!item)return;

      document.querySelector('#logSubject').value=item.summary||item.eventType||'';

      document.querySelector('#logSite').value=item.site||'';

      document.querySelector('#logEquipment').value=item.payload?.equipment||item.payload?.node||'';

      document.querySelector('#logReference').value=item.eventId;openComposer();});

    function filters(){const params=new URLSearchParams();for(const [key,raw] of new FormData(document.querySelector('#erFilters'))){if(!raw)continue;let value=String(raw).trim();if((key==='from'||key==='to')&&value)value=new Date(value).toISOString();if(value)params.append(key,value);}return params;}

    const group=(items,key)=>items.reduce((counts,item)=>{const value=String(key(item)||'Unspecified');counts[value]=(counts[value]||0)+1;return counts;},{});

    function download(name,type,body){const link=document.createElement('a');link.href=URL.createObjectURL(new Blob([body],{type}));link.download=name;document.body.append(link);link.click();setTimeout(()=>{URL.revokeObjectURL(link.href);link.remove();},1000);}

    function csvCell(value){let text=String(value??'');if(/^[=+@-]/.test(text))text="'"+text;return '"'+text.replaceAll('"','""')+'"';}

    builder.querySelector('#elAnalyze').addEventListener('click',async()=>{const status=builder.querySelector('#elReportStatus');const button=builder.querySelector('#elAnalyze');button.disabled=true;reportRows=[];reportTotal=0;reportQuery='';builder.querySelector('#elCsv').disabled=true;builder.querySelector('#elDraft').disabled=true;

      try{const params=filters();if(params.has('from')&&params.has('to')&&params.get('from')>params.get('to'))throw Error('From must precede To.');reportQuery=params.toString();let cursor=null;do{const page=new URLSearchParams(params);page.set('limit','100');if(cursor)page.set('cursor',cursor);const result=await get('/api/events/register?'+page);reportTotal=result.total;reportRows.push(...result.items);cursor=result.nextCursor;status.textContent=`Retrieved ${reportRows.length.toLocaleString()} of ${reportTotal.toLocaleString()} matching records…`;}while(cursor&&reportRows.length<5000);

        const counts=group(reportRows,item=>item.severity||'info');const days=group(reportRows,item=>(item.occurredAt||'').slice(0,10));const sorted=Object.entries(days).sort(([a],[b])=>a.localeCompare(b));const max=Math.max(1,...Object.values(days));

        builder.querySelector('#elReportSummary').innerHTML=`<strong>${reportRows.length.toLocaleString()} retrieved / ${reportTotal.toLocaleString()} matching</strong><span>${Object.entries(counts).map(([key,count])=>`${esc(key)}: ${count.toLocaleString()}`).join(' · ')}</span>`;

        builder.querySelector('#elReportChart').innerHTML=sorted.map(([day,count])=>`<div><time>${esc(day)}</time><span class="el-bar" style="--bar:${Math.max(2,Math.round(count/max*100))}%"></span><b>${count.toLocaleString()}</b></div>`).join('')||'<p>No matching records.</p>';

        status.textContent=reportRows.length<reportTotal?`Partial snapshot: first ${reportRows.length.toLocaleString()} of ${reportTotal.toLocaleString()} records. Narrow the filters for complete analysis.`:`Complete filtered snapshot: ${reportRows.length.toLocaleString()} records.`;

        builder.querySelector('#elCsv').disabled=!reportRows.length;builder.querySelector('#elDraft').disabled=!reportRows.length;

      }catch(error){status.textContent='Analysis failed: '+error.message+' · no report generated';}finally{button.disabled=false;}});

    builder.querySelector('#elCsv').addEventListener('click',()=>{const columns=['occurredAt','severity','category','eventType','summary','source','actorId','site','status','eventId'];const data=[columns.join(','),...reportRows.map(row=>columns.map(column=>csvCell(row[column])).join(','))].join('\r\n');download('northstar-events.csv','text/csv;charset=utf-8','\uFEFF'+data);});

    builder.querySelector('#elDraft').addEventListener('click',()=>{const severity=group(reportRows,item=>item.severity||'info');const kinds=group(reportRows,item=>item.eventType);const lines=['NORTHSTAR EVENT HISTORY · REVIEW DRAFT','Generated: '+new Date().toISOString(),'Filters: '+(reportQuery||'none'),`Retrieved: ${reportRows.length} of ${reportTotal} matching records`,reportRows.length<reportTotal?'PARTIAL SNAPSHOT — narrow filters before relying on totals.':'Complete filtered snapshot.','', 'Severity',...Object.entries(severity).map(([key,count])=>`${key}: ${count}`),'','Event types',...Object.entries(kinds).sort((a,b)=>b[1]-a[1]).map(([key,count])=>`${key}: ${count}`),'','Selected event references',...reportRows.slice(0,50).map(item=>`${item.occurredAt||''} | ${item.eventId} | ${item.summary||item.eventType}`),'','Draft only. Qualified operator review is required before publication.'];download('northstar-event-report-draft.txt','text/plain;charset=utf-8',lines.join('\r\n'));});

    window.addEventListener('northstar:logbook-saved',load);
    setInterval(()=>{if(!document.hidden && logs.getClientRects().length && !logs.querySelector(".el-input").open && !logs.querySelector("#elFreshness").textContent.startsWith("Loading"))load();},60000);
    load();

  }

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();

})();
