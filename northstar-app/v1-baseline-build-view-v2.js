/* Alternate presentation only. V1 anchors, geometry and authentication remain authoritative. */
(() => {
  'use strict';
  const KEY='northstarBuildViewV2';
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const num=(v,n=1)=>typeof v==='number'&&Number.isFinite(v)?v.toFixed(n):'—';
  const chartTime=v=>new Date(v).toLocaleString('en-CA',{timeZone:'America/Toronto',month:'short',day:'numeric',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
  const time=v=>v && Number.isFinite(new Date(v).valueOf())?new Date(v).toLocaleTimeString('en-CA',{timeZone:'America/Toronto',hour:'2-digit',minute:'2-digit',hourCycle:'h23'})+' ET':'—';
  let prefs={view:'v1',drawings:{}},root,popup,frame,selected='',search='',drawing=null,documents=[],outages=[],outageError=false,request=0,busy=false,returnFocus=null,scheduled=false;
  try { const value=JSON.parse(localStorage.getItem(KEY)||'null'); if(value && typeof value==='object')prefs={...prefs,...value,drawings:value.drawings && typeof value.drawings==='object'?value.drawings:{}}; } catch {}
  prefs.view=prefs.view==='v2'?'v2':'v1';
  const persist=()=>{try{localStorage.setItem(KEY,JSON.stringify(prefs));}catch{status('View changed for this session; browser storage is unavailable.');}};
  const feed=key=>window.NorthstarOverview?.feeds?.[key];
  const plants=()=>window.NorthStarGeneratingStations?.list() || [];
  const plant=()=>plants().find(m=>m.site.id===selected);
  const flow=m=>m.baseline?.noWater?null:(m.value('outflow') ?? m.value('flow'));
  const source=m=>m.baseline?'Station profile':m.current?'SCADA':'Data unavailable';
  const status=text=>{const el=root?.querySelector('[data-bv-status]');if(el)el.textContent=text;};
  function put(selector,html,host=root) { const el=host?.querySelector(selector);if(el && el.innerHTML!==html)el.innerHTML=html; }
  function metrics(m) {
    return [['HW',num(m.value('headwater'),3),'m'],['Flow',num(flow(m),0),'m³/s'],['Output',num(m.value('output'),2),'MW']]
      .map(([label,value,unit])=>'<span class="bv2-metric-'+label.toLowerCase()+'"><small>'+label+'</small><b>'+value+'</b><em>'+unit+'</em></span>').join('');
  }
  function trend(points,label,unit) {
    const p=(points||[]).filter(p=>Number.isFinite(p.at)&&typeof p.value==='number'&&Number.isFinite(p.value)).sort((a,b)=>a.at-b.at).slice(-100);
    if(p.length<2)return '<div class="bv2-empty">Not enough history for '+esc(label.toLowerCase())+'. Current readings remain above.</div>';
    const low=Math.min(...p.map(p=>p.value)),high=Math.max(...p.map(p=>p.value)),span=high-low||1,t0=p[0].at,dt=p.at(-1).at-t0||1;
    const d=p.map((p,i)=>(i?'L':'M')+(46+(p.at-t0)/dt*590).toFixed(1)+' '+(136-(p.value-low)/span*120).toFixed(1)).join(' ');
    return '<figure class="bv2-trend"><figcaption>'+esc(label)+' <small>'+esc(unit)+'</small></figcaption><svg viewBox="0 0 660 170" role="img" aria-label="'+esc(label)+': '+esc(num(low)+' to '+num(high)+' '+unit)+'"><path class="bv2-chart-grid" d="M46 16H636M46 76H636M46 136H636M46 16V136M194 16V136M342 16V136M490 16V136M636 16V136"/><text x="1" y="20">'+num(high)+'</text><text x="1" y="80">'+num((low+high)/2)+'</text><text x="1" y="140">'+num(low)+'</text><path class="bv2-chart-area" d="'+d+' L636 136 L46 136Z"/><path class="bv2-chart-line" d="'+d+'"/><circle class="bv2-chart-point" cx="636" cy="'+(136-(p.at(-1).value-low)/span*120).toFixed(1)+'" r="3"/><text x="46" y="161">'+esc(chartTime(t0))+'</text><text x="636" y="161" text-anchor="end">'+esc(chartTime(p.at(-1).at))+'</text></svg><div class="bv2-chart-stats"><span>Latest <b>'+num(p.at(-1).value)+' <small>'+esc(unit)+'</small></b></span><span>Low <b>'+num(low)+'</b></span><span>High <b>'+num(high)+'</b></span></div></figure>';
  }
  function renderPlants() {
    const all=plants(),filtered=all.filter(m=>m.site.name.toLowerCase().includes(search.toLowerCase()));
    put('[data-bv-count]',String(all.length));
    put('[data-bv-tiles]',filtered.map(m=>'<button type="button" class="bv2-plant-tile" data-bv-plant="'+esc(m.site.id)+'"><span class="bv2-tile-title">'+esc(m.site.name)+'</span><span class="bv2-metrics">'+metrics(m)+'</span><span class="bv2-tile-footer"><span class="bv2-source" data-source="'+(m.baseline?'profile':m.current?'scada':'unavailable')+'">'+esc(source(m))+'</span><span class="bv2-unit-count">'+esc(num(m.running,0)+'/'+num(m.total,0)+' units')+'</span></span></button>').join('')||'<p class="bv2-empty">No plants match this search.</p>');
    put('[data-bv-list]',filtered.map(m=>'<button type="button" class="bv2-plant-row" data-bv-plant="'+esc(m.site.id)+'" aria-pressed="'+(m.site.id===selected)+'"><strong><i class="bv2-state-dot" data-state="'+esc(m.baseline?'profile':m.state||'unknown')+'" title="'+esc(source(m)+' · '+(m.baseline?'Configured profile':m.state||'unknown'))+'"></i>'+esc(m.site.name)+'</strong><span>'+num(m.value('headwater'),3)+'</span><span>'+num(flow(m),0)+'</span><span>'+num(m.value('output'),2)+'</span></button>').join('')||'<p>No plants match.</p>');
  }
  function eventRows(siteId='') {
    const data=feed('events'),rows=data?.data?.items || [];
    const relevant=siteId?rows.filter(e=>(window.NorthStarSites?.resolve(e.siteId||e.site)?.id || e.siteId)===siteId):rows;
    if(data?.error || !data?.checked)return '<p class="bv2-empty">Event feed unavailable. <button data-bv-retry>Retry feeds</button></p>';
    if(!relevant.length)return '<p class="bv2-empty">No recent events in this snapshot. <button data-bv-nav="logbook">Open Events</button></p>';
    return window.NorthStarBuildPanels.events(relevant);
  }
  function renderFeeds() {
    put('[data-bv-events]',eventRows());
    put('[data-bv-outages]',outageError?'<p>Outages unavailable. <button data-bv-retry>Retry</button></p>':outages.length?'<ul class="bv2-events">'+outages.slice(0,3).map(o=>'<li><span><b>'+esc(o.site||o.siteName||'Station')+'</b><span>'+esc(o.description||o.title||o.status||'Recorded outage')+'</span></span><button data-bv-nav="outages">View</button></li>').join('')+'</ul>':'<p class="bv2-empty">No outages in the current snapshot.</p>');
    const weather=feed('weather'),stations=weather?.data?.stations||[];
    put('[data-bv-weather]',!weather?.checked||weather.error?'<p class="bv2-empty">Weather unavailable. <button data-bv-retry>Retry feeds</button></p>':'<div class="bv2-weather-grid">'+stations.map(s=>{
      const h=s.hourly||{},i=Math.max(0,(h.time||[]).findIndex(t=>Date.parse(t)>=Date.now())),c=s.current||{};
      return '<article><b>'+esc(s.name)+'</b><strong>'+num(c.temperature_2m??h.temperature_2m?.[i],0)+'°C</strong><span>Precip '+num(c.precipitation_probability??h.precipitation_probability?.[i],0)+'%</span><span>Wind '+num(c.wind_speed_10m??h.wind_speed_10m?.[i],0)+' km/h</span><small>Received '+esc(time(weather.checked))+'</small></article>';
    }).join('')+'</div>');
    const market=feed('market'),marketData=window.NorthstarMarketModules?.data()||market?.data;
    put('[data-bv-market]',market?.error?'<p class="bv2-empty">Market feed unavailable. <button data-bv-retry>Retry</button></p>':window.NorthStarBuildPanels.market(marketData));
    const all=plants(),history=all[0]?.history||[];
    // Sum only snapshots with matching timestamps; never fill missing plant observations with zero.
    const series=history.map(p=>{const values=all.map(m=>m.history?.find(q=>Math.abs(q.at-p.at)<1000)?.value);return {at:p.at,value:values.every(v=>typeof v==='number'&&Number.isFinite(v))?values.reduce((a,b)=>a+b,0):null};});
    put('[data-bv-generation]',trend(series,'Fleet generation','MW'));
    put('[data-bv-source-note]',all.some(m=>m.baseline)?'Configured station profiles are shown where qualified SCADA is unavailable.':'Station values from qualified SCADA.');
  }
  function renderActive() {
    const m=plant(); if(!m)return;
    put('[data-bv-title]',esc(m.site.name));
    put('[data-bv-active-metrics]',metrics(m)+'<span><small>Units running</small><b>'+num(m.running,0)+' / '+num(m.total,0)+'</b><em>'+esc(source(m))+'</em></span>');
    put('[data-bv-active-chart]',window.NorthStarBuildPanels.station(m));
    put('[data-bv-active-events]',eventRows(m.site.id));
    const rows=feed('staff')?.data||[],people=Array.isArray(rows)?rows.filter(r=>(window.NorthStarSites?.resolve(r.siteId||r.site)?.id||r.siteId)===m.site.id&&r.status!=='checked-out'&&!r.checkedOutAt&&!r.checkoutAt):[];
    put('[data-bv-active-workers]',feed('staff')?.error?'<p>Worker feed unavailable.</p>':people.length?'<ul>'+people.map(r=>'<li>'+esc(r.worker||r.name||r.person||'Worker')+' <small>'+esc(r.company||'')+'</small></li>').join('')+'</ul>':'<p>No current workers in this feed snapshot.</p>');
    if(popup&&!popup.hidden){
      put('[data-bv-popout-metrics]',metrics(m)+'<span><small>Units running</small><b>'+num(m.running,0)+' / '+num(m.total,0)+'</b><em>'+esc(source(m))+'</em></span>',popup);
      put('[data-bv-popout-chart]',window.NorthStarBuildPanels.station(m),popup);
      put('[data-bv-popout-events]',eventRows(m.site.id),popup);
      const qualified=window.NorthStarGeneratingStations.telemetry(m.site.id),panels=window.NorthStarBuildPanels;
      put('[data-bv-popout-units]',panels.unitTable(qualified),popup);
      put('[data-bv-popout-water]',panels.waterTable(qualified),popup);
      put('[data-bv-popout-workers]',feed('staff')?.error?'<p>Worker feed unavailable.</p>':people.length?'<table class="bv2-data-table"><thead><tr><th>Person</th><th>Company</th><th>Time in</th></tr></thead><tbody>'+people.map(r=>'<tr><td>'+esc(r.name||r.worker||'Worker')+'</td><td>'+esc(r.company||'—')+'</td><td>'+esc(time(r.checkedIn))+'</td></tr>').join('')+'</tbody></table>':'<p class="bv2-empty">No current workers in this snapshot.</p>',popup);
    }
  }
  function render() {
    if(!root || prefs.view!=='v2')return;
    renderPlants();renderFeeds();renderActive();
    if(!popup.hidden && drawing && !popup.querySelector('form:focus-within'))renderDrawing(false);
  }
  function schedule() { if(scheduled)return;scheduled=true;requestAnimationFrame(()=>{scheduled=false;render();}); }
  function openPlant(id) {
    if(!plants().some(m=>m.site.id===id))return;
    closeMore(root);if(!popup.hidden)closePopup();selected=id;root.classList.add('bv2-working');renderActive();renderPlants();
    root.querySelector('[data-bv-title]').focus();
  }
  function navigate(id) { document.querySelector('#sideNav [data-tab="'+id+'"]')?.click(); }
  async function refreshFeeds() {
    const urls=['/api/events/register?limit=5','/api/weather','/api/market-prices','/api/scada','/api/checkins'];
    await Promise.allSettled(urls.map(url=>fetch(url,{cache:'no-store'})));
    try { const r=await fetch('/api/outages',{cache:'no-store'});if(!r.ok)throw Error();const d=await r.json();if(!Array.isArray(d))throw Error();outages=d;outageError=false; }catch{outageError=true;}
    schedule();
  }
  function closeMore(host=document) {
    host.querySelectorAll('.bv2-more-panel:popover-open').forEach(panel=>panel.hidePopover());
  }
  function bindMore(button,panel) {
    panel.setAttribute('popover','auto');button.setAttribute('aria-controls',panel.id);button.setAttribute('aria-expanded','false');
    button.onclick=()=>{
      if(panel.matches(':popover-open')){panel.hidePopover();return;}
      panel.showPopover();
      const box=button.getBoundingClientRect(),width=panel.getBoundingClientRect().width;
      panel.style.left=Math.max(8,Math.min(box.right-width,innerWidth-width-8))+'px';
      panel.style.top=Math.min(box.bottom+4,innerHeight-80)+'px';
      panel.style.maxHeight=Math.max(64,innerHeight-box.bottom-12)+'px';
    };
    panel.addEventListener('toggle',()=>button.setAttribute('aria-expanded',String(panel.matches(':popover-open'))));
  }
  function compactRoster() {
    const toolbar=root.querySelector('[data-bv-roster] .fr-toolbar');if(!toolbar||toolbar.querySelector('[data-bv-more]'))return;
    const panel=document.createElement('div');panel.id='bv2RosterMore';panel.className='bv2-more-panel';panel.setAttribute('aria-label','Worker filters and options');
    [...toolbar.children].filter(el=>!el.matches('h2,[role=status]')).forEach(el=>panel.append(el));
    const button=document.createElement('button');button.type='button';button.dataset.bvMore='';button.className='bv2-more-button';button.textContent='More ▾';button.setAttribute('aria-label','More worker options');
    toolbar.append(button,panel);bindMore(button,panel);
  }
  function set(view) {
    closeMore();
    prefs.view=view==='v2'?'v2':'v1';
    document.body.classList.toggle('ns-build-v2',prefs.view==='v2');
    if(root)root.hidden=prefs.view!=='v2';
    if(prefs.view==='v1')closePopup();
    persist();window.dispatchEvent(new CustomEvent('northstar:build-view-change',{detail:{view:prefs.view}}));
    if(prefs.view==='v2'){window.NorthstarFieldRoster?.mount(root.querySelector('[data-bv-roster]'),{mirrorAppearance:false,compact:true});compactRoster();navigate('overview');render();void refreshFeeds();}
  }
  async function requestJson(path,options={}) {
    const r=await fetch(path,{cache:'no-store',...options});let body;try{body=await r.json();}catch{}
    if(!r.ok)throw Error(body?.error || 'Request failed ('+r.status+').');
    return body;
  }
  const popupStatus=text=>{popup.querySelector('[data-bv-drawing-status]').textContent=text;};
  function telemetry() {
    const f=feed('scada');
    const available=!!f?.checked&&!f.error&&!f.data?.stale&&Date.now()-f.checked<120000;
    const readings=available?(f.data?.readings||[]).filter(r=>f.data?.feeds?.some(s=>s.feedCode===r.feedCode&&s.status==='Current')):[];
    return {readings,available};
  }
  function renderDrawing(names=true) {
    if(!drawing)return;
    const t=telemetry(),api=window.NorthStarBuildSchematic;
    put('[data-bv-drawing]',api.render(drawing.record,t.readings,t.available),popup);
    const svg=popup.querySelector('.bv2-schematic');
    if(svg){const bounds=svg.getBBox();if(bounds.width>0&&bounds.height>0)svg.setAttribute('viewBox',[bounds.x-24,bounds.y-24,bounds.width+48,bounds.height+48].join(' '));}
    if(names)put('[data-bv-names]','<table><thead><tr><th>Device</th><th>Name source</th><th>Manual name</th></tr></thead><tbody>'+(drawing.record?.symbols||[]).map(s=>{
      const n=api.deviceName(s,t.readings,t.available);
      return '<tr><td>'+esc(n.name)+'</td><td>'+esc(n.source)+'</td><td>'+(n.manual?'<input aria-label="Manual name for '+esc(s.id)+'" data-bv-device="'+esc(s.id)+'" maxlength="160" value="'+esc(s.assetTag||s.label||s.id)+'">':'<span>Linked to SCADA</span>')+'</td></tr>';
    }).join('')+'</tbody></table>',popup);
    popupStatus(drawing.name+' · Revision '+drawing.revision+' · Read-only equipment feedback');
  }
  async function loadDrawing(id) {
    const sequence=++request;drawing=null;
    put('[data-bv-drawing]','<p class="bv2-empty">Loading drawing…</p>',popup);put('[data-bv-names]','',popup);
    if(!id){put('[data-bv-drawing]','<p class="bv2-empty">Select a saved single-line drawing, or open the schematic builder to create one. Connections are never inferred from station unit counts.</p>',popup);popupStatus('No drawing selected.');return;}
    try { const next=await requestJson('/api/schematics/'+encodeURIComponent(id));if(sequence!==request)return;
      if(!next?.record || !Array.isArray(next.record.symbols))throw Error('Invalid saved drawing.');
      drawing=next;prefs.drawings[selected]=id;persist();renderDrawing();
    }catch(error){if(sequence!==request)return;put('[data-bv-drawing]','<p class="bv2-empty">Drawing unavailable. Select it again to retry.</p>',popup);popupStatus(error.message);}
  }
  async function openPopup() {
    const m=plant();if(!m)return;returnFocus=document.activeElement;
    popup.hidden=false;frame.reset();popup.classList.remove('bv2-minimized','bv2-maximized');
    renderActive();
    popup.style.left=Math.max(8,(innerWidth-popup.getBoundingClientRect().width)/2)+'px';
    popup.style.top=Math.max(130,(document.querySelector('#nsStatusBar')?.getBoundingClientRect().bottom||110)+12)+'px';
    popup.querySelector('.ns-hover-window-bar>span').textContent=m.site.name+' — Single-line details';
    popup.querySelector('.bv2-more-button').focus();
    const sequence=++request;
    try { documents=await requestJson('/api/schematics');if(sequence!==request)return;if(!Array.isArray(documents))throw Error('Invalid drawing library.');
      put('[data-bv-drawing-select]','<option value="">Select saved drawing</option>'+documents.map(d=>'<option value="'+esc(d.id)+'">'+esc(d.name)+' · rev '+esc(d.revision)+'</option>').join(''),popup);
      const id=prefs.drawings[selected]||'';popup.querySelector('[data-bv-drawing-select]').value=id;
      await loadDrawing(id);
    }catch(error){popupStatus('Drawing library unavailable: '+error.message);}
  }
  function closePopup() { if(!popup)return;closeMore(popup);++request;popup.hidden=true;drawing=null;returnFocus?.focus?.(); }
  async function saveNames(event) {
    event.preventDefault();if(!drawing || busy)return;busy=true;
    const submit=popup.querySelector('[data-bv-save-names]');submit.disabled=true;
    const current=drawing,record=structuredClone(current.record),t=telemetry();
    popup.querySelectorAll('[data-bv-device]').forEach(input=>{
      const s=record.symbols.find(s=>s.id===input.dataset.bvDevice);
      if(s && window.NorthStarBuildSchematic.deviceName(s,t.readings,t.available).manual)s.assetTag=input.value.trim().slice(0,160);
    });
    try {
      const saved=await requestJson('/api/schematics/'+encodeURIComponent(current.id),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:current.name,outageId:current.outageId||'',standardApprovalRef:current.standardApprovalRef||'',revision:current.revision,record})});
      if(drawing===current){drawing=saved;const option=popup.querySelector('[data-bv-drawing-select]').selectedOptions[0];if(option)option.textContent=saved.name+' · rev '+saved.revision;renderDrawing();popupStatus('Manual names saved · Revision '+saved.revision);}
      document.dispatchEvent(new CustomEvent('northstar:schematics-changed',{detail:{id:saved.id}}));
    } catch(error){popupStatus('Names not saved: '+error.message+' Reload the drawing before retrying a conflict.');}
    finally{busy=false;submit.disabled=false;}
  }
  function init() {
    const overview=document.getElementById('overview');if(!overview)return;
    root=document.createElement('div');root.id='nsBuildV2';root.hidden=true;
    root.innerHTML='<header class="bv2-header"><button class="bv2-active-only" data-bv-action="back" aria-label="Back to overview">←</button><h1 class="bv2-idle-only">Plants <span data-bv-count></span></h1><h1 class="bv2-active-only" tabindex="-1" data-bv-title></h1><span class="bv2-header-info bv2-idle-only">HW · Flow · Output</span><button class="bv2-idle-only" data-bv-action="tiles" aria-pressed="true">Tiles</button><button class="bv2-idle-only" data-bv-action="list" aria-pressed="false">List</button><button class="bv2-active-only bv2-primary" data-bv-action="popout" aria-label="Detailed popout">Single-line ↗</button><button class="bv2-more-button" data-bv-more aria-label="More view options">More ▾</button><div id="bv2ViewMore" class="bv2-more-panel" aria-label="View filters and options"><label class="bv2-search">Find plant<input type="search" placeholder="Search stations…" aria-label="Find plant"></label><button data-bv-retry>Refresh feeds</button><p class="bv2-source-note" data-bv-source-note></p><p role="status" data-bv-status></p></div></header>'+
      '<section class="bv2-idle"><div class="bv2-tiles" data-bv-tiles></div>'+
      '<div class="bv2-idle-list"><div class="bv2-list-head"><b>Plant</b><span>HW (m)</span><span>Flow (m³/s)</span><span>Output (MW)</span></div><div data-bv-idle-list></div></div>'+
      '<div class="bv2-overview-grid"><section class="bv2-panel bv2-roster" data-bv-roster></section><section class="bv2-panel"><header><h2>Markets &amp; demand</h2><button data-bv-nav="markets" aria-label="Open Markets">Open ↗</button></header><div data-bv-market></div></section><section class="bv2-panel bv2-event-outages"><header><h2>Events &amp; outages</h2><button data-bv-nav="logbook" aria-label="Open Events">Events ↗</button><button data-bv-nav="outages" aria-label="Open Outages">Outages ↗</button></header><div data-bv-events></div><div class="bv2-outage-caption">Current outages</div><div data-bv-outages></div></section><section class="bv2-panel"><div data-bv-generation></div></section><section class="bv2-panel bv2-weather"><header><h2>Weather outlook</h2><button data-bv-nav="weather" aria-label="Full forecast">Open ↗</button></header><div data-bv-weather></div></section></div></section>'+
      '<section class="bv2-active"><div class="bv2-active-grid"><aside class="bv2-plant-list"><div class="bv2-list-head"><b>Plant</b><span>HW (m)</span><span>Flow (m³/s)</span><span>Output (MW)</span></div><div data-bv-list></div></aside><div class="bv2-workspace"><div class="bv2-panel bv2-metrics" data-bv-active-metrics></div><section class="bv2-panel" data-bv-active-chart></section><div class="bv2-work-bottom"><section class="bv2-panel"><header><h2>Recent activity</h2><button data-bv-nav="logbook" aria-label="Open event register">Open ↗</button></header><div data-bv-active-events></div></section><section class="bv2-panel"><header><h2>Workers on site</h2><button data-bv-nav="crew" aria-label="Open Check-ins">Open ↗</button></header><div data-bv-active-workers></div></section></div></div></div></section>';
    overview.append(root);
    bindMore(root.querySelector('[data-bv-more]'),root.querySelector('#bv2ViewMore'));

    root.querySelector('input[type=search]').addEventListener('input',event=>{search=event.target.value;renderPlants();syncIdleList();});
    root.addEventListener('click',event=>{
      const button=event.target.closest('button');if(!button)return;
      if(button.dataset.bvPlant){openPlant(button.dataset.bvPlant);return;}
      if(button.hasAttribute('data-bv-retry')){void refreshFeeds();return;}
      if(button.dataset.bvNav){closeMore();navigate(button.dataset.bvNav);return;}
      const action=button.dataset.bvAction;
      if(action==='back'){closeMore(root);root.classList.remove('bv2-working');root.querySelector('[data-bv-action="tiles"]').focus();}
      if(action==='popout')void openPopup();
      if(action==='tiles'||action==='list'){root.classList.toggle('bv2-list-mode',action==='list');root.querySelector('[data-bv-action="tiles"]').setAttribute('aria-pressed',String(action==='tiles'));root.querySelector('[data-bv-action="list"]').setAttribute('aria-pressed',String(action==='list'));syncIdleList();}
    });
    popup=document.createElement('section');popup.id='nsBuildV2Popout';popup.hidden=true;popup.setAttribute('role','dialog');popup.setAttribute('aria-label','Station single-line details');
    popup.innerHTML='<div class="bv2-popout-content"><div class="bv2-metrics bv2-panel" data-bv-popout-metrics></div><div class="bv2-popout-grid"><div class="bv2-popout-side"><section class="bv2-panel bv2-schematic-panel"><header><h2>Station single-line</h2><small>Saved drawing · SCADA / manual names</small></header><div class="bv2-drawing-scroll" data-bv-drawing></div></section><section class="bv2-panel"><header><h2>Unit readings</h2><small>Qualified SCADA</small></header><div data-bv-popout-units></div></section><section class="bv2-panel"><header><h2>Water &amp; operating limits</h2><small>Qualified SCADA</small></header><div data-bv-popout-water></div></section></div><div class="bv2-popout-side"><section class="bv2-panel" data-bv-popout-chart></section><section class="bv2-panel"><header><h2>Recent activity</h2></header><div data-bv-popout-events></div></section><section class="bv2-panel"><header><h2>Workers on site</h2><button data-bv-nav="crew">Open ↗</button></header><div data-bv-popout-workers></div></section></div></div></div><div id="bv2DrawingMore" class="bv2-more-panel" aria-label="Drawing options and device names"><div class="bv2-drawing-toolbar"><label>Saved single-line<select data-bv-drawing-select aria-label="Saved single-line"><option value="">Select saved drawing</option></select></label><button data-bv-editor>Edit diagram</button><button data-bv-library>New drawing</button><button data-bv-reload-drawing>Reload drawing</button></div><p role="status" data-bv-drawing-status></p><details><summary>Device names & SCADA sources</summary><p>Exact SCADA tags supply linked device names. Untraced devices use editable manual names; saving creates a drawing revision.</p><form><div class="bv2-name-table" data-bv-names></div><button type="submit" data-bv-save-names>Save manual names</button></form></details></div>';
    document.body.append(popup);
    popup.addEventListener('click',event=>{
      const button=event.target.closest('button');if(!button)return;
      if(button.hasAttribute('data-bv-retry'))void refreshFeeds();
      if(button.dataset.bvNav){closePopup();navigate(button.dataset.bvNav);}
    });
    frame=window.NorthStarHoverWindow(popup,'Station single-line details',closePopup);
    const bar=popup.querySelector('.ns-hover-window-bar'),close=bar.querySelector('button');
    const more=document.createElement('button');more.type='button';more.className='bv2-more-button';more.textContent='More ▾';more.setAttribute('aria-label','More drawing options');bar.insertBefore(more,close);bindMore(more,popup.querySelector('#bv2DrawingMore'));
    for(const [label,cls,text] of [['Minimize','bv2-minimized','−'],['Maximize','bv2-maximized','□']]){const b=document.createElement('button');b.type='button';b.textContent=text;b.setAttribute('aria-label',label);b.onclick=()=>{closeMore(popup);popup.classList.toggle(cls);if(cls==='bv2-maximized')popup.classList.remove('bv2-minimized');};bar.insertBefore(b,close);}
    popup.querySelector('select').onchange=event=>void loadDrawing(event.target.value);
    popup.querySelector('form').onsubmit=saveNames;
    popup.querySelector('[data-bv-editor]').onclick=async()=>{if(!drawing){popupStatus('Choose a saved drawing first.');return;}try{const opened=await window.NorthStarOneLineEditor?.openDocument(drawing.id);if(opened)closePopup();}catch(error){popupStatus(error.message);}};
    popup.querySelector('[data-bv-library]').onclick=()=>{closePopup();window.NorthstarModules?.open('tools:schematic-builder');};
    popup.querySelector('[data-bv-reload-drawing]').onclick=()=>void loadDrawing(popup.querySelector('select').value);
    document.addEventListener('keydown',event=>{if(event.key!=='Escape')return;const open=document.querySelector('.bv2-more-panel:popover-open');if(open){event.preventDefault();open.hidePopover();document.querySelector('[aria-controls="'+open.id+'"]')?.focus();return;}if(!popup.hidden){event.preventDefault();closePopup();}});
    window.addEventListener('resize',()=>closeMore());
    window.addEventListener('northstar:feed-update',schedule);
    window.addEventListener('northstar:sites-display-change',schedule);
    window.addEventListener('storage',event=>{if(event.key===KEY){try{const p=JSON.parse(event.newValue);if(p){prefs.drawings=p.drawings&&typeof p.drawings==='object'?p.drawings:{};set(p.view);}}catch{}}});
    window.NorthStarBuildView={get:()=>prefs.view,set,openPlant};
    set(prefs.view);
    setInterval(()=>{if(prefs.view==='v2'&&!document.hidden){schedule();void refreshFeeds();}},30000);
  }
  function syncIdleList(){put('[data-bv-idle-list]',root.querySelector('[data-bv-list]')?.innerHTML||'');}
  const originalRenderPlants=renderPlants;
  renderPlants=()=>{originalRenderPlants();syncIdleList();};
  function ready(){Promise.resolve(window.northstarStylesReady).then(init);}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',ready);else ready();
})();
