/* Shared navigation and editing controls; existing handlers remain attached. */
(() => {
  const items={
    overview:['Overview','M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z'],
    assistant:['Agent','M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z'],
    logbook:['Events','M7 3h10v3H7zM5 5H3v16h18V5h-2M7 11h10M7 16h7'],
    crew:['Check-ins','M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M16 3a4 4 0 0 1 0 8M22 21v-2a4 4 0 0 0-3-4M13 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0'],
    markets:['Markets','M3 3v18h18M6 15l4-5 4 3 6-8M16 5h4v4'],
    weather:['Weather','M7 18a5 5 0 1 1 1-10 6 6 0 0 1 11 3 4 4 0 0 1-1 7H7Z'],
    tools:['Tools','M14 6l4 4 3-3a7 7 0 0 1-9 9l-6 6-4-4 6-6a7 7 0 0 1 9-9Z'],
    flows:['Flows','M3 7c3-4 6 4 9 0s6 4 9 0M3 12c3-4 6 4 9 0s6 4 9 0M3 17c3-4 6 4 9 0s6 4 9 0'],
    switching:['Engineering','M3 3h6v6H3zM15 15h6v6h-6zM15 3h6v6h-6zM6 9v9h9M9 6h6'],
    outages:['Outages','M13 2 4 14h7l-1 8 10-12h-7Z'],
    scada:['SCADA','M3 4h18v13H3zM8 21h8M12 17v4M6 12l3-4 4 5 4-5 2 2'],
    training:['Training','M2 8l10-5 10 5-10 5ZM6 10v7l6 3 6-3v-7M22 8v8'],
    'live-status':['Live status','M2 12h5l3-8 4 16 3-8h5'],
    modules:['Modules','M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM17 14v7M14 17h7'],
    'field-operations':['Field operations','M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 1 1 16 0M15 10a3 3 0 1 1-6 0 3 3 0 0 1 6 0'],
    account:['Account settings','M12 2l1.1 2.5 2.7.5 1.9-2 2.2 2.2-2 1.9.5 2.7L21 11v3l-2.6 1.2-.5 2.7 2 1.9-2.2 2.2-1.9-2-2.7.5L12 23l-1.1-2.5-2.7-.5-1.9 2-2.2-2.2 2-1.9-.5-2.7L3 14v-3l2.6-1.2.5-2.7-2-1.9 2.2-2.2 1.9 2 2.7-.5L12 2ZM12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6Z']
  };
  function statusBar(){
    if(document.getElementById('nsStatusBar'))return;
    const statusWindow=new URLSearchParams(location.search).get('nsStatusWindow')==='1' && !new URLSearchParams(location.search).has('nsModuleWindow');
    const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    const num=(v,d=1)=>v!=null&&Number.isFinite(Number(v))?Number(v).toFixed(d):'—';
    const money=v=>v!=null&&Number.isFinite(Number(v))?'$'+Number(v).toFixed(2):'—';
    const finite=v=>v!=null&&v!==''&&Number.isFinite(Number(v));
    const orStatus=(product,key,d)=>{
      const active=String(d?.orActivation||'').toUpperCase()===product;
      const standby=d?.reserveStandby?.[key];
      const activated=d?.orActivationMw ?? standby;
      if(active)return {state:'active',text:num(activated)};
      if(!finite(standby))return {state:'unknown',text:'—'};
      return {state:Number(standby)>0?'standby':'zero',text:num(standby)};
    };
    const siteCode=site=>({'Kenora':'KE','Norman':'NO','Fort Frances':'FF','Calm Lake':'CL','Sturgeon Falls':'SF','Iroquois Falls':'IS','Island Falls':'IR','Twin Falls':'IRT','Big Beaver Falls':'BB','White Otter Rapids':'WO','Old Woman Falls':'OW','Camp Three Rapids':'CT','Okikendawt GS':'OK','McDougal':'MC','Bird GS':'B1','Cogent':'B2','Aiyers 1':'A1','Aiyers 2':'A2','Cameron':'CG','Falls':'FFT'}[String(site||'').trim()]||String(site||'Unknown').trim().split(/\s+/).filter(Boolean).slice(0,2).map(word=>word[0]).join('').toUpperCase()||'—');
    // Fixed crew strip: geographic slots stay stable unless a lone site is promoted.
    const crewLayout=[['TW','IR','IRHV','IS'],['OW','WO','CT','BB'],['CL','SF','FF','FFTS'],['KE','NO','OK'],['A1','A2','B1','B2','CG']];
    const crewNames={'TW':'Twin Falls','IR':'Iroquois Falls','IRHV':'Iroquois Falls 230 kV','IS':'Island Falls','OW':'Old Woman Falls','WO':'White Otter Rapids','CT':'Camp Three Rapids','BB':'Big Beaver Falls','FF':'Fort Frances','FFTS':'Fort Frances TS','SF':'Sturgeon Falls','CL':'Calm Lake','KE':'Kenora','NO':'Norman','OK':'Okikendawt GS','CG':'McDougal','B1':'Bird GS','B2':'Cogent','A1':'Aiyers 1','A2':'Aiyers 2'};
    window.NorthStarWorkerSiteGroups=crewLayout.map(group=>group.map(code=>crewNames[code]));
    window.dispatchEvent(new Event('northstar:worker-site-groups'));
    let crewPositions={},crewSaveState='Loading profile';
    const crewEditing=()=>document.body.classList.contains('layout-edit');
    if(typeof document!=='undefined')document.addEventListener('northstar:crew-edit-refresh',render);
    if(typeof window!=='undefined')window.addEventListener('northstar:layout-snap-change',event=>{window.northstarLayoutSnapToGrid=event.detail?.enabled!==false;});
    const crewDefaultPositions=()=>Object.fromEntries(crewLayout.flatMap((row,r)=>row.map((code,c)=>[code,{x:c*20,y:r*32}])));
    crewPositions=crewDefaultPositions();crewSaveState='';
    const crewCode=row=>{
      const station=window.NorthStarSites?.resolve(row.siteId)||window.NorthStarSites?.resolve(row.site);
      if(!station || !window.NorthStarSites.stations().some(site=>site.id===station.id))return null;
      return Object.keys(crewNames).find(code=>crewNames[code]===station.name)||station.name;
    };
    const crewWorkerState=(row,now=Date.now())=>{
      if(row.needsHelp||['requested','acknowledged'].includes(row.helpState))return 'missed';
      const last=Date.parse(row.lastHeard);
      if(Number.isFinite(last)){
        const late=now-last-3600000;
        if(late>300000)return 'missed';
        if(late>=0)return 'due';
        if(row.overdue||row.status==='overdue')return 'pending';
        return row.status==='on-site'?'current':'pending';
      }
      return row.overdue||row.status==='overdue'?'missed':'pending';
    };
    const crewSummary=(active,now=Date.now())=>{
      if(active===null)return {state:'unknown',count:'—',signature:''};
      const states=active.map(row=>crewWorkerState(row,now));
      const state=states.includes('missed')?'missed':states.includes('due')?'due':states.includes('pending')?'unknown':'current';
      const signature=active.filter((row,i)=>states[i]==='missed').map(row=>`${row.id||row.name}:${row.lastHeard||''}:${row.helpRequestedAt||''}`).sort().join('|');
      return {state,count:String(active.length),signature};
    };
    const crewMarkup=active=>{
      if(active===null)return '<span class="ns-status-site ns-status-site-pending">CHECK-IN STATUS UNAVAILABLE</span>';
      const groups=new Map(crewLayout.flat().filter(Boolean).map(code=>[code,[]]));
      active.forEach(row=>{const code=crewCode(row);if(!code)return;if(!groups.has(code))groups.set(code,[]);groups.get(code).push(row);});
      const lone=[...groups.entries()].filter(([,people])=>people.length>0);
      const promoted=new Set(lone.filter(([,people])=>people.some(row=>row.alone)).map(([code])=>code));
      const button=(code,people,position)=>{
        const states=people.map(person=>crewWorkerState(person));
        const state=!people.length?'empty':['missed','due','pending'].find(value=>states.includes(value))||'current';
        const status={empty:'No active workers',current:'All check-ins current',due:'Check-in due: 0–5 minutes late',missed:'Manual intervention required: contact on-site worker',pending:'Check-in conditions unverified'}[state];
        const site=crewNames[code]||code,label=`${site}: ${people.length} workers. ${status}${promoted.has(code)?'. Lone worker site':''}`;
        return `<button type="button" class="ns-status-site ns-status-site-${state}${promoted.has(code)?' ns-status-site-lone':''}" style="left:${position.x}%;top:${position.y}%;--ns-crew-row-height:${position.height}%" data-crew-code="${esc(code)}" data-crew-site="${esc(site)}" aria-label="${esc(label)}" title="${esc(label)}"><strong><span class="ns-crew-code">${esc(code)}</span> · ${people.length}</strong></button>`;
      };
      const occupiedRows=crewLayout.map(row=>row.filter(code=>groups.get(code)?.length));
      const extra=[...groups.keys()].filter(code=>!crewLayout.flat().includes(code));
      // Additional stations fill the shortest column instead of compressing every row.
      extra.forEach(code=>occupiedRows.reduce((shortest,column)=>column.length<shortest.length?column:shortest).push(code));
      const rowCount=Math.max(4,...occupiedRows.map(column=>column.length));
      const rowHeight=100/rowCount;
      let visibleColumn=0;
      const positions=new Map();
      occupiedRows.forEach(column=>{if(!column.length)return;column.forEach((code,rowIndex)=>positions.set(code,{x:visibleColumn*20,y:rowIndex*rowHeight,height:rowHeight}));visibleColumn++;});
      let html=lone.map(([code,people])=>button(code,people,positions.get(code))).join('');
      // Fit every occupied station into the available tracker height.
      return `<div class="ns-crew-sites-grid" style="--ns-crew-rows:${rowCount}">${html}</div>`;
    };
    const marketNode=(code,node,market)=>{
      const demand=code==='IESO'?`<span class="ns-status-price ns-status-price-demand"><span>Demand</span> <strong>${finite(market?.ontario?.demand)?Math.round(Number(market.ontario.demand)).toLocaleString()+' MW':'—'}</strong></span><span class="ns-status-price ns-status-price-forecast"><span>Forecast</span> <strong>${finite(market?.ontario?.forecastDemand)?Math.round(Number(market.ontario.forecastDemand)).toLocaleString()+' MW':'—'}</strong></span>`:'';
      const reserve=code==='APIROQ'&&node?.reserve?`<div class="ns-status-demand-box ns-status-reserve-box">${[['10S',node.reserve.tenS],['10N',node.reserve.tenN],['30R',node.reserve.thirtyR]].map(([label,value])=>`<span class="ns-status-price ns-status-price-demand"><span>${label}</span><strong>${label==='10S'?money(value):money(value).replace('$','')}</strong></span>`).join('')}</div>`:'';
      return `<article class="ns-status-node" data-node="${esc(code)}" data-asset-id="market-${code.toLowerCase()}" data-asset-children="independent"><b>${esc(code)}</b><div class="ns-status-price-box"><span class="ns-status-price ns-status-price-rt"><span>RT</span> <strong>${money(node?.rt)}</strong></span><span class="ns-status-price ns-status-price-da"><span>DA</span> <strong>${money(node?.da)}</strong></span></div>${demand?`<div class="ns-status-demand-box">${demand}</div>`:''}${reserve}</article>`;
    };
    const ieso=()=>window.NorthstarIesoTime;
    const time=value=>{const helper=ieso();if(helper)return helper.clock(value);const d=value?new Date(value):null;return d&&!Number.isNaN(d.valueOf())?d.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit',hourCycle:'h23'}):'—';};
    const stamp=value=>{const helper=ieso();if(helper)return helper.dateTime(value,true);const d=value?new Date(value):null;return d&&!Number.isNaN(d.valueOf())?d.toLocaleString([],{year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}):'—';};
    const heLabel=()=>{const helper=ieso();return helper?helper.heStamp():'';};
    const unacked=e=>{
      const status=String(e?.status||'').toLowerCase();
      if(['resolved','cleared','acknowledged','acked','closed'].includes(status))return false;
      if(e?.category==='alarm')return true;
      if(['active','open','requested'].includes(status))return true;
      return ['critical','warning'].includes(String(e?.severity||'').toLowerCase()) && !status;
    };
    const bar=document.createElement('div');bar.id='nsStatusBar';bar.setAttribute('aria-label','Operations status');
    bar.innerHTML=['events','dispatch','markets','weather','crew'].map(key=>`<section class="ns-status-module${key==='events'?' ns-status-events':''}" data-status="${key}"><div class="ns-status-content"></div></section>`).join('');
    document.body.append(bar);document.body.classList.add('ns-has-status');document.querySelector('main').classList.add('ns-persistent-status');
    // Keep the legacy full panel out of the Overview header; Dispatch is
    // rendered in the compact persistent status module above.
    const legacyDispatch=document.getElementById('dispatchClient');
    if(legacyDispatch)legacyDispatch.hidden=true;
    if(statusWindow){
      document.body.classList.add('ns-station-popout','overview-canvas');document.title='Stations · NorthStar';
      const style=document.createElement('link');style.rel='stylesheet';style.href='station-popout.css?v=20261022-readable-popout';document.head.append(style);
      const shell=document.createElement('section');shell.id='nsStationWindow';shell.setAttribute('aria-label','Station dashboard');
      const divider=document.createElement('div');divider.id='nsStationDivider';
      divider.innerHTML='<button type="button" data-toggle-fixed aria-controls="nsStatusBar" aria-expanded="true" aria-label="Hide fixed dashboard" title="Hide fixed dashboard"><span></span></button>';
      const workers=document.createElement('section');workers.id='nsStatusWorkers';workers.setAttribute('aria-label','Workers on-site tracking');
      ['overviewStaff'].forEach(id=>{const module=document.getElementById(id);if(module)workers.append(module);});
      const activity=document.createElement('section');activity.id='nsFieldActivity';activity.className='panel';activity.dataset.moduleId='status-field-activity';
      activity.innerHTML='<h2>Field activity · Today</h2><p role="status">Loading today’s activity…</p><div class="ns-field-activity-rows"></div>';
      workers.append(activity);
      workers.dataset.stationGroups=JSON.stringify(crewLayout.map(group=>group.map(code=>crewNames[code])));
      shell.append(bar,divider,workers);document.body.append(shell);
    }
    function openStatusWindow(){
      const url=new URL('/northstar-clean.html',location.origin);url.searchParams.set('nsStatusWindow','1');url.hash='overview';
      const width=screen.availWidth||innerWidth,height=screen.availHeight||innerHeight;
      const popup=window.open(url.href,'northstar-fixed-dashboard',`popup=yes,location=no,toolbar=no,menubar=no,status=no,left=0,top=0,width=${width},height=${height}`);
      if(!popup)window.alert('Allow pop-up windows for NorthStar, then try again.');else {popup.focus();window.NorthstarOperationsConsole?.replaceTracker(document.getElementById('overviewStaff'),popup);}
    }
    const popup=document.createElement('section');popup.id='nsStatusEvents';popup.hidden=true;popup.setAttribute('aria-label','Detailed event log');
    popup.innerHTML='<div class="ns-status-log" tabindex="0"></div><footer><span role="status"></span><button type="button" data-more hidden>Load older events</button></footer>';document.body.append(popup);
    const quickLog=document.createElement('dialog');quickLog.id='nsQuickEventLog';quickLog.setAttribute('aria-label','Quick event log');
    const logCategories=['ALL','SCADA','DISPATCH','C-O-M-S','WATER','MARKET','CRITICAL'];
    const logChildren={SCADA:['S+','WONDERWARE'],'C-O-M-S':['OUTLOOK','PHONE','TEAMS']};
    quickLog.innerHTML=`<header><strong>Event Log</strong><button type="button" data-quick-close aria-label="Close quick event log">×</button></header><nav class="ns-quick-categories" aria-label="Log categories">${logCategories.map(name=>`<button type="button" data-quick-category="${name}" aria-pressed="${name==='ALL'}">${name}</button>`).join('')}</nav><nav class="ns-quick-children" aria-label="Log subcategories" hidden></nav><div class="ns-quick-events" tabindex="0" aria-label="Recent event entries"></div><div class="ns-quick-count" role="status"></div><form class="ns-quick-form"><label for="nsQuickEntry">Quick log entry</label><div class="ns-quick-form-row"><select aria-label="Entry type" name="type"><option>Operator action</option><option>SCADA</option><option>Dispatch</option><option>Communication</option><option>Safety</option><option>Water</option><option>Market</option><option>Critical</option></select><input name="subject" aria-label="Subject" maxlength="160" placeholder="Subject" required></div><textarea id="nsQuickEntry" name="details" rows="3" maxlength="4000" placeholder="Enter event, decision, condition, or follow-up" required></textarea><div class="ns-quick-actions"><span role="status" aria-live="polite"></span><button type="submit">Add log</button></div></form>`;
    document.body.append(quickLog);
    const marketPreview=document.createElement('section');marketPreview.id='nsMarketPreview';marketPreview.className='ns-market-preview';marketPreview.hidden=true;marketPreview.setAttribute('aria-label','Detailed market preview');
    marketPreview.innerHTML='<header class="ns-market-preview-head"><div><strong>Market detail</strong><span>Hover preview · live prices, forecasts and schedules</span></div><button type="button" data-close-market aria-label="Close market preview">×</button></header><div class="ns-market-preview-summary"></div><section class="ns-market-preview-schedules"><h3>Accepted day-ahead schedules <small>MW by resource</small></h3><div class="ns-market-preview-schedule-list"></div></section><section class="ns-market-preview-chart"><h3>Market price and forward DA overlays <small>Select nodes, series and time scale</small></h3><div class="market-trend-host" data-market-node="IESO"></div></section>';document.body.append(marketPreview);
    const marketModule=bar.querySelector('[data-status=markets]');let marketCloseTimer,marketHoverTimer;
    const marketWindow=window.NorthStarHoverWindow(marketPreview,'Market detail',closeMarketPreview);
    marketPreview.addEventListener('pointerdown',()=>clearTimeout(marketCloseTimer));
    function previewMarketData(){
      const market=window.NorthstarMarketModules?.data()||window.NorthstarOverview?.feeds?.market?.data||{},nodes=market.nodes||{},ieso=nodes.IESO||{},accepted=Array.isArray(market.acceptedSchedules)?market.acceptedSchedules:[];
      const value=(v,unit='')=>v!=null&&v!==''&&Number.isFinite(Number(v))?`${Number(v).toLocaleString(undefined,{maximumFractionDigits:1})}${unit}`:'—';
      const quebec=market.quebec||market.quebecMarket||{};
      marketPreview.querySelector('.ns-market-preview-summary').innerHTML=`<div><small>IESO RT price</small><strong>${money(ieso.rt)}</strong><em>${esc(time(ieso.rtTimestamp))}</em></div><div><small>IESO DA price</small><strong>${money(ieso.da)}</strong><em>${esc(time(ieso.daTimestamp))}</em></div><div><small>Ontario real-time demand</small><strong>${value(market.ontario?.demand,' MW')}</strong><em>IESO demand report</em></div><div><small>Ontario demand forecast</small><strong>${value(market.ontario?.forecastDemand,' MW')}</strong><em>${market.ontario?.forecastHour?`HE ${esc(market.ontario.forecastHour)}`:'IESO forecast'}</em></div><div><small>Québec RT market price</small><strong>${quebec.rtPrice==null?'Unavailable':money(quebec.rtPrice)}</strong><em>${esc(quebec.source||'No RT price feed connected')}</em></div>`;
      const list=marketPreview.querySelector('.ns-market-preview-schedule-list');
      list.innerHTML=accepted.length?`<table><thead><tr><th>Resource</th><th>Accepted DA MW</th><th>Delivery hour</th><th>Status</th></tr></thead><tbody>${accepted.map(row=>`<tr><td>${esc(row.resource||row.name||'Unknown')}</td><td>${value(row.scheduledMw??row.acceptedMw??row.mw,' MW')}</td><td>${esc(row.deliveryHour||row.hour||row.intervalStart||'—')}</td><td>${esc(row.status||'Accepted')}</td></tr>`).join('')}</tbody></table>`:'<p class="ns-market-preview-empty">Accepted DA schedules are not connected to a resource schedule feed. No schedule MW is being inferred from dispatch telemetry.</p>';
    }
    function positionMarketPreview(){
      if(marketPreview.hidden||marketWindow.pinned)return;
      const rect=marketModule.getBoundingClientRect(),width=Math.min(1120,innerWidth-24),top=Math.min(bar.getBoundingClientRect().bottom+8,innerHeight-220);
      marketPreview.style.left=Math.max(12,Math.min(rect.left,innerWidth-width-12))+'px';marketPreview.style.top=Math.max(12,top)+'px';marketPreview.style.width=width+'px';marketPreview.style.maxHeight=Math.max(200,innerHeight-Math.max(12,top)-12)+'px';
    }
    function showMarketPreview(){
      if(!window.NorthstarHoverPreviewsEnabled?.())return;
      clearTimeout(marketCloseTimer);if(marketPreview.hidden){marketPreview.hidden=false;previewMarketData();positionMarketPreview();requestAnimationFrame(()=>window.NorthstarMarketModules?.mountPreview?.(marketPreview.querySelector('.market-trend-host')));}
    }
    function closeMarketPreview(){clearTimeout(marketHoverTimer);clearTimeout(marketCloseTimer);marketPreview.hidden=true;marketWindow.reset();window.NorthstarMarketTrends?.unmount(marketPreview.querySelector('.market-trend-host'));}
    function scheduleMarketPreviewClose(){clearTimeout(marketHoverTimer);if(marketWindow.pinned)return;clearTimeout(marketCloseTimer);marketCloseTimer=setTimeout(()=>{if(!marketWindow.pinned)closeMarketPreview();},240);}
    function openFullMarket(code='IESO'){
      closeMarketPreview();
      if(window.NorthstarModules?.open)window.NorthstarModules.open('markets:'+code);else document.querySelector('#sideNav [data-tab="markets"]')?.click();
    }
    marketModule.addEventListener('pointerenter',()=>{clearTimeout(marketCloseTimer);clearTimeout(marketHoverTimer);if(!document.body.classList.contains('layout-edit'))marketHoverTimer=setTimeout(showMarketPreview,window.NORTHSTAR_MODULE_HOVER_DELAY);});marketModule.addEventListener('pointerleave',scheduleMarketPreviewClose);
    marketModule.addEventListener('focusin',showMarketPreview);marketModule.addEventListener('focusout',event=>{if(!marketModule.contains(event.relatedTarget))scheduleMarketPreviewClose();});
    marketPreview.addEventListener('pointerenter',()=>clearTimeout(marketCloseTimer));marketPreview.addEventListener('pointerleave',scheduleMarketPreviewClose);marketPreview.addEventListener('focusin',()=>clearTimeout(marketCloseTimer));marketPreview.addEventListener('focusout',event=>{if(!marketPreview.contains(event.relatedTarget)&&!marketModule.contains(event.relatedTarget))scheduleMarketPreviewClose();});
    marketPreview.addEventListener('click',event=>{if(event.target.closest('[data-close-market]'))closeMarketPreview();});
    marketModule.addEventListener('click',event=>{if(document.body.classList.contains('layout-edit'))return;openFullMarket(event.target.closest('[data-node]')?.dataset.node||'IESO');});
    marketModule.addEventListener('keydown',event=>{if((event.key==='Enter'||event.key===' ')&&event.target===marketModule){event.preventDefault();openFullMarket();}});
    marketModule.tabIndex=0;marketModule.setAttribute('aria-label','Market prices and demand. Hover to preview; click to open the full Markets section.');
    marketPreview.querySelector('[data-close-market]').onclick=closeMarketPreview;
    document.addEventListener('keydown',event=>{if(event.key==='Escape'&&!marketPreview.hidden)closeMarketPreview();});
    window.addEventListener('resize',positionMarketPreview);window.addEventListener('northstar:feed-update',()=>{if(!marketPreview.hidden)previewMarketData();});
    const events=bar.querySelector('[data-status=events]');let hoverTimer,closeTimer,loading=false,cursor=null,rows=[],alarmRows=[],alarmFilter='all',alarmLoading=false,lastLoaded=0,lastAlarmLoad=0;
    const isAlarm=item=>window.NorthstarAlarmInteractions?.isAlarm?.(item) || item?.category==='alarm' || String(item?.eventType||'').includes('alarm') || String(item?.eventType||'').includes('help');
    const alarmState=eventId=>window.NorthstarAlarmInteractions?.state?.(eventId) || {acknowledged:false,cleared:false,pinned:false};
    const alarmPreview=document.createElement('section');alarmPreview.id='nsAlarmPreview';alarmPreview.hidden=true;alarmPreview.setAttribute('role','tooltip');document.body.append(alarmPreview);
    let alarmPreviewTimer,alarmPreviewTarget;
    const hideAlarmPreview=()=>{clearTimeout(alarmPreviewTimer);alarmPreview.hidden=true;alarmPreviewTarget=null;alarmWindow.reset();};
    const alarmWindow=window.NorthStarHoverWindow(alarmPreview,'Alarm details',hideAlarmPreview);
    document.addEventListener('keydown',event=>{if(event.key==='Escape')hideAlarmPreview();});
    const showAlarmPreview=(eventId,target)=>{
      if(!window.NorthstarHoverPreviewsEnabled?.())return;
      if(alarmWindow.pinned)return;
      const item=[...alarmRows,...rows].find(row=>String(row.eventId)===String(eventId));
      if(!item||!(item.category==='alarm'||['critical','warning'].includes(String(item.severity||'').toLowerCase())))return;
      clearTimeout(alarmPreviewTimer);alarmPreviewTarget=target;
      const detail=item.payload?.details||item.payload?.detail||item.payload?.text||item.description||item.message||'No additional details supplied.';
      alarmPreview.innerHTML=`<strong>${esc(item.summary||item.eventType||'Alarm')}</strong><p>${esc(detail)}</p><small>${esc([stamp(item.occurredAt),item.site,item.payload?.equipment||item.payload?.node,item.category,item.severity,item.status,item.source,item.actorId].filter(Boolean).join(' · '))}</small><a href="event-detail.html?id=${encodeURIComponent(item.eventId)}">Open alarm details ↗</a>`;
      alarmWindow.restoreBar();alarmPreview.hidden=false;
      const rect=target.getBoundingClientRect(),width=Math.min(360,innerWidth-24),left=rect.right+width+16<=innerWidth?rect.right+8:Math.max(12,rect.left-width-8);
      alarmPreview.style.left=left+'px';alarmPreview.style.top=Math.max(12,Math.min(rect.top,innerHeight-alarmPreview.offsetHeight-12))+'px';alarmPreview.style.width=width+'px';
    };
    const scheduleAlarmPreview=()=>{clearTimeout(alarmPreviewTimer);if(!alarmWindow.pinned)alarmPreviewTimer=setTimeout(()=>{if(!alarmWindow.pinned)hideAlarmPreview();},180);};
    [events,popup].forEach(root=>{
      root.addEventListener('pointerover',event=>{
        const target=event.target.closest('.ns-status-alarm[data-event-id],#nsStatusEvents article[data-event-id]');
        if(!target||target.contains(event.relatedTarget))return;
        clearTimeout(alarmPreviewTimer);alarmPreviewTimer=setTimeout(()=>showAlarmPreview(target.dataset.eventId,target),window.NORTHSTAR_MODULE_HOVER_DELAY);
      });
      root.addEventListener('pointerout',event=>{const target=event.target.closest('.ns-status-alarm[data-event-id],#nsStatusEvents article[data-event-id]');if(target&&!target.contains(event.relatedTarget))scheduleAlarmPreview();});
    });
    alarmPreview.addEventListener('pointerenter',()=>clearTimeout(alarmPreviewTimer));alarmPreview.addEventListener('pointerleave',scheduleAlarmPreview);
    const filters=[['all','All'],['alarm','Alarms'],['critical','Critical'],['warning','Warning'],['unacked','Unacked']];
    let quickCategory='ALL',quickChild='ALL',quickRows=[];
    const norm=value=>String(value||'').trim().toLowerCase();
    function quickMatch(item){
      const payload=item.payload||{},source=norm(item.source),provider=norm(payload.provider||payload.system||payload.scadaSystem||payload.sourceSystem),declared=norm(payload.logCategory||payload.category),sub=norm(payload.logSubcategory||payload.subcategory||payload.subtype),kind=norm(item.eventType),channel=norm(item.display?.channel);
      if(quickCategory==='ALL')return true;
      if(quickCategory==='CRITICAL')return norm(item.severity)==='critical';
      if(quickCategory==='SCADA')return (['scada','s+','splus','s-plus','wonderware'].includes(source)||declared==='scada')&&(quickChild==='ALL'||(quickChild==='S+'?['s+','splus','s-plus'].some(value=>[source,provider,sub].includes(value)):[source,provider,sub].includes('wonderware')));
      if(quickCategory==='C-O-M-S'){const medium=['outlook','teams','phone','voice'].includes(source)?source:provider||channel;return (item.category==='communication'||['outlook','teams','phone','voice'].includes(medium)||['comms','c-o-m-s','communications'].includes(declared))&&(quickChild==='ALL'||(quickChild==='PHONE'?['phone','voice'].includes(medium):medium===norm(quickChild)));}
      if(quickCategory==='DISPATCH')return source==='dispatch'||declared==='dispatch'||kind.startsWith('dispatch.')||channel==='dispatch';
      if(quickCategory==='WATER')return ['water','water_management','water-management'].includes(source)||declared==='water'||kind.startsWith('water.')||channel==='water';
      if(quickCategory==='MARKET')return ['market','markets'].includes(source)||declared==='market'||kind.startsWith('market.')||channel==='market';
      return false;
    }
    function paintQuickRows(){
      const shown=quickRows.filter(quickMatch);
      quickLog.querySelector('.ns-quick-events').innerHTML=shown.map(item=>`<a href="event-detail.html?id=${encodeURIComponent(item.eventId)}"><time>${esc(stamp(item.occurredAt))}</time><strong>${esc(item.summary||item.eventType||'Event')}</strong><small>${esc([item.severity,item.source,item.site].filter(Boolean).join(' · '))}</small></a>`).join('')||'<p>No matching events in the recent entries.</p>';
      quickLog.querySelector('.ns-quick-count').textContent=`${shown.length} matching recent events`;
    }
    function paintQuickChildren(){
      const nav=quickLog.querySelector('.ns-quick-children'),items=logChildren[quickCategory];nav.hidden=!items;
      nav.innerHTML=items?['ALL',...items].map(name=>`<button type="button" data-quick-child="${name}" aria-pressed="${name===quickChild}">${name==='ALL'?'ALL '+quickCategory:name}</button>`).join(''):'';
    }
    async function loadQuickRows(){
      quickLog.querySelector('.ns-quick-count').textContent='Loading recent events…';
      try{const response=await fetch('/api/events/register?limit=100',{cache:'no-store'});if(!response.ok)throw Error('Event log unavailable');const data=await response.json();quickRows=Array.isArray(data.items)?data.items:[];paintQuickRows();}
      catch{quickLog.querySelector('.ns-quick-count').textContent='Unable to load recent events';}
    }
    quickLog.querySelector('[data-quick-close]').onclick=()=>quickLog.close();
    quickLog.querySelector('.ns-quick-categories').onclick=event=>{const button=event.target.closest('[data-quick-category]');if(!button)return;quickCategory=button.dataset.quickCategory;quickChild='ALL';quickLog.querySelectorAll('[data-quick-category]').forEach(node=>node.setAttribute('aria-pressed',String(node===button)));paintQuickChildren();paintQuickRows();};
    quickLog.querySelector('.ns-quick-children').onclick=event=>{const button=event.target.closest('[data-quick-child]');if(!button)return;quickChild=button.dataset.quickChild;quickLog.querySelectorAll('[data-quick-child]').forEach(node=>node.setAttribute('aria-pressed',String(node===button)));paintQuickRows();};
    quickLog.querySelector('.ns-quick-form').onsubmit=async event=>{
      event.preventDefault();const form=event.currentTarget,button=form.querySelector('[type=submit]'),status=form.querySelector('[role=status]'),values=new FormData(form);button.disabled=true;status.textContent='Saving…';
      try{const response=await fetch('/api/logbook',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({type:values.get('type'),subject:String(values.get('subject')||'').trim(),details:String(values.get('details')||'').trim()})});if(!response.ok)throw Error('Save failed');form.reset();status.textContent='Log entry saved';window.loadOps?.();window.dispatchEvent(new Event('northstar:logbook-saved'));loadQuickRows();loadAlarms(true);}
      catch{status.textContent='Log entry could not be saved';}finally{button.disabled=false;}
    };
    let eventLogOpener=null;
    const close=()=>{clearTimeout(hoverTimer);clearTimeout(closeTimer);popup.hidden=true;eventWindow.reset();if(eventLogOpener){eventLogOpener.focus();eventLogOpener=null;}};
    const eventWindow=window.NorthStarHoverWindow(popup,'Event Log',close);
    const eventToolbarClock=document.createElement('span');eventToolbarClock.className='ns-status-event-toolbar-clock';eventToolbarClock.setAttribute('aria-label','Hour ending and time');popup.querySelector('.ns-hover-window-bar span').after(eventToolbarClock);
    popup.addEventListener('pointerdown',()=>clearTimeout(closeTimer));
    function position(){
      const aside=document.querySelector('.app>aside'),left=aside?Math.max(0,aside.getBoundingClientRect().right):0;
      bar.style.left=left+'px';document.body.style.setProperty('--ns-status-height',bar.offsetHeight+'px');
      if(!eventWindow.pinned){popup.style.left=Math.max(8,left+8)+'px';popup.style.top=bar.getBoundingClientRect().bottom+'px';popup.style.maxWidth=Math.max(180,innerWidth-left-16)+'px';}
    }
    function paintRows(){popup.querySelector('.ns-status-log').innerHTML=rows.map(e=>{const alarm=isAlarm(e),state=alarmState(e.eventId);return `<article data-event-id="${esc(e.eventId)}"${alarm?` data-ns-alarm-id="${esc(e.eventId)}" class="${state.acknowledged?'ns-alarm-acknowledged ':''}${state.cleared?'ns-alarm-cleared ':''}${state.pinned?'ns-alarm-pinned':''}"`:''}><time>${esc(stamp(e.occurredAt))}</time><strong>${esc(e.summary||e.eventType||'Event')}</strong><p>${esc(e.description||e.message||e.payload?.details||e.payload?.description||'')}</p><small>${esc([e.site,e.source,e.actorId,e.severity,e.status,state.cleared?'cleared':'' ].filter(Boolean).join(' · '))}</small><a href="event-detail.html?id=${encodeURIComponent(e.eventId)}">Open event report ↗</a></article>`;}).join('')||'<p>No recorded events.</p>';popup.querySelector('[data-more]').hidden=!cursor;}
    async function load(older=false){
      if(loading)return;loading=true;const message=popup.querySelector('footer span'),more=popup.querySelector('[data-more]');more.disabled=true;message.textContent='Loading…';
      try{const params=new URLSearchParams({limit:'50'});if(older&&cursor)params.set('cursor',cursor);
        const response=await fetch('/api/events/register?'+params,{cache:'no-store'});if(!response.ok)throw Error('Event service unavailable');
        const data=await response.json();if(!Array.isArray(data.items))throw Error('Invalid event response');
        rows=older?[...rows,...data.items.filter(e=>!rows.some(old=>old.eventId===e.eventId))]:data.items;cursor=data.nextCursor||null;lastLoaded=Date.now();paintRows();message.textContent=rows.length+' events shown';
      }catch{message.textContent=rows.length?'Refresh failed · previous events retained':'Event log unavailable · reopen to retry';}finally{loading=false;more.disabled=false;}
    }
    function open(explicit=false){if(!explicit&&!window.NorthstarHoverPreviewsEnabled?.())return;clearTimeout(hoverTimer);clearTimeout(closeTimer);position();popup.hidden=false;if(Date.now()-lastLoaded>30000)load();}
    function matchesFilter(e){
      if(alarmFilter==='all')return true;
      if(alarmFilter==='alarm')return e.category==='alarm' || String(e.eventType||'').includes('alarm') || String(e.eventType||'').includes('help');
      if(alarmFilter==='critical')return e.severity==='critical';
      if(alarmFilter==='warning')return e.severity==='warning';
      if(alarmFilter==='unacked')return unacked(e)&&!alarmState(e.eventId).acknowledged&&!alarmState(e.eventId).cleared;
      return true;
    }
    function paintAlarms(){
      const list=events.querySelector('.ns-status-alarms');if(!list)return;
      const visible=alarmRows.filter(e=>!alarmState(e.eventId).cleared&&matchesFilter(e)).slice(0,window.NORTHSTAR_DEMO_HOME?3:12);
      list.innerHTML=visible.map(e=>{
        const state=alarmState(e.eventId),open=unacked(e)&&!state.acknowledged;
        const href=`event-detail.html?id=${encodeURIComponent(e.eventId)}`;
        const severity=['critical','warning'].includes(e.severity)?e.severity:'info';
        const hint=state.acknowledged?'Acknowledged for this browser session. Double-click to clear; right-click for history.':'Click to acknowledge; double-click to clear; right-click for history.';
        return `<div class="ns-status-alarm-row" role="listitem"><a class="ns-status-alarm ns-status-alarm-${severity}${open?' is-unacked':''}${state.acknowledged?' ns-alarm-acknowledged':''}${state.pinned?' ns-alarm-pinned':''}" href="${esc(href)}" data-event-id="${esc(e.eventId)}" data-ns-alarm-id="${esc(e.eventId)}" title="${esc(hint)}" aria-label="${esc(e.summary||e.eventType||'Alarm')}. ${esc(hint)}"><time>${esc(time(e.occurredAt))}</time><span class="ns-status-alarm-text">${esc(e.summary||e.eventType||'Event')}</span><span class="ns-status-alarm-site">${esc(e.site||e.source||'')}</span></a></div>`;
      }).join('')||`<p class="ns-status-alarms-empty">${alarmLoading?'Loading alarms…':(events.dataset.alarmError||'No matching alarms.')}</p>`;
      events.querySelectorAll('[data-filter]').forEach(btn=>btn.classList.toggle('is-active',btn.dataset.filter===alarmFilter));
      window.NorthstarAlarmInteractions?.observe?.(alarmRows);
    }
    async function loadAlarms(force=false){
      if(alarmLoading || (!force && Date.now()-lastAlarmLoad<15000 && alarmRows.length)){paintAlarms();return;}
      alarmLoading=true;paintAlarms();
      try{
        // Retrieve all severities so a display filter cannot suppress critical sound.
        const params=new URLSearchParams({limit:'100'});
        const response=await fetch('/api/events/register?'+params,{cache:'no-store'});
        if(!response.ok)throw Error('unavailable');
        const data=await response.json();
        if(!Array.isArray(data.items))throw Error('invalid');
        alarmRows=data.items;lastAlarmLoad=Date.now();delete events.dataset.alarmError;
      }catch{
        if(!alarmRows.length)events.dataset.alarmError='Event log unavailable';
      }finally{alarmLoading=false;paintAlarms();}
    }
    function paintEventShell(){
      const content=events.querySelector('.ns-status-content');
      const shell=`<div class="ns-status-events-head"><b class="ns-status-title">Event Log <span class="ns-status-he" data-he-clock></span></b><div class="ns-status-filters" role="toolbar" aria-label="Alarm filters">${filters.map(([id,label])=>`<button type="button" data-filter="${id}"${id===alarmFilter?' class="is-active"':''}>${label}</button>`).join('')}<button type="button" data-quick-log aria-label="Add quick log" title="Add quick log">+</button></div><button type="button" class="ns-status-popout ns-events-popout" data-open-event-log title="Open events and event logs" aria-label="Open events and event logs"><svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"><path d="M12 5v15M12 5C9 3 5 3 2 4v15c3-1 7-1 10 1 3-2 7-2 10-1V4c-3-1-7-1-10 1Z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg></button></div><div class="ns-status-alarms" role="list" aria-live="polite"></div>`;
      if(content.dataset.shell!==shell){content.innerHTML=shell;content.dataset.shell=shell;}
      tickHeClock();
      paintAlarms();
    }
    function tickHeClock(){
      const label=heLabel();
      const clock=events.querySelector('[data-he-clock]');
      if(clock)clock.textContent=label;
      eventToolbarClock.textContent=label;
    }
    events.addEventListener('click',event=>{
      const book=event.target.closest('[data-open-event-log]');
      if(book){event.preventDefault();event.stopPropagation();eventLogOpener=book;open(true);eventWindow.pin();popup.style.height='auto';popup.querySelector('.ns-status-log').focus();return;}
      if(event.target.closest('[data-quick-log]')){event.preventDefault();event.stopPropagation();close();hideAlarmPreview();quickLog.showModal();quickLog.querySelector('[name=subject]').focus();loadQuickRows();return;}
      if(event.target.closest('[data-open-status-window]')){event.preventDefault();event.stopPropagation();openStatusWindow();return;}
      const filter=event.target.closest('[data-filter]');
      if(filter){event.preventDefault();alarmFilter=filter.dataset.filter;paintEventShell();loadAlarms(true);return;}
    });
    bar.addEventListener('click',event=>{
      if(event.target.closest('[data-open-status-window]')){event.preventDefault();event.stopPropagation();openStatusWindow();}
    });
    events.addEventListener('pointerenter',()=>{clearTimeout(closeTimer);clearTimeout(hoverTimer);if(!document.body.classList.contains('layout-edit'))hoverTimer=setTimeout(()=>{if(!events.querySelector('.ns-status-alarm:hover'))open();},window.NORTHSTAR_MODULE_HOVER_DELAY);});
    const deferEventClose=()=>{clearTimeout(hoverTimer);clearTimeout(closeTimer);if(!eventWindow.pinned)closeTimer=setTimeout(()=>{if(!eventWindow.pinned)close();},240);};
    events.addEventListener('pointerleave',deferEventClose);
    popup.addEventListener('pointerenter',()=>clearTimeout(closeTimer));
    popup.addEventListener('pointerleave',deferEventClose);
    popup.querySelector('[data-more]').onclick=()=>load(true);
    document.addEventListener('keydown',event=>{if(event.key==='Escape')close();});
    document.addEventListener('pointerdown',event=>{if(!eventWindow.pinned&&!popup.contains(event.target)&&!events.contains(event.target))close();});
    window.addEventListener('northstar:alarm-state-change',()=>{paintAlarms();if(!popup.hidden)paintRows();});
    let crewDrag=null;
    bar.addEventListener('pointerdown',event=>{
      const button=event.target.closest('[data-crew-code]');if(!crewEditing()||!button||event.button!==0)return;
      event.preventDefault();event.stopPropagation();
      const grid=button.parentElement,rect=grid.getBoundingClientRect();
      crewDrag={button,code:button.dataset.crewCode,rect,dx:event.clientX-button.getBoundingClientRect().left,dy:event.clientY-button.getBoundingClientRect().top};
      button.setPointerCapture(event.pointerId);
    });
    bar.addEventListener('pointermove',event=>{
      if(!crewDrag)return;const d=crewDrag;
      const snap=window.northstarLayoutSnapToGrid!==false,grid=Math.max(1,Number(window.northstarLayoutGridStep)||5);
      let x=Math.max(0,Math.min(d.rect.width*0.75,event.clientX-d.rect.left-d.dx));
      let y=Math.max(0,Math.min(d.rect.height-d.button.offsetHeight,event.clientY-d.rect.top-d.dy));
      if(snap){x=Math.round(x/grid)*grid;y=Math.round(y/grid)*grid;}
      crewPositions[d.code]={x:x/d.rect.width*100,y};d.button.style.left=crewPositions[d.code].x+'%';d.button.style.top=y+'px';
    });
    bar.addEventListener('pointerup',()=>{crewDrag=null;});
    bar.addEventListener('pointercancel',()=>{crewDrag=null;});
    bar.addEventListener('click',async event=>{
      if(crewEditing())return;
      if(event.target.closest('[data-status="crew"]')){
        const summary=crewSummary(Array.isArray(window.NorthstarOverview?.feeds?.staff?.data)?window.NorthstarOverview.feeds.staff.data.filter(row=>row.status!=='checked-out'):null);
        if(summary.signature){localStorage.setItem('northstarCrewStripAcknowledged',summary.signature);render();}
      }
      const site=event.target.closest('[data-crew-site]');
      if(site){
        event.preventDefault();event.stopPropagation();if(!eventWindow.pinned)close();
        window.NorthstarOpenStation?.(site.dataset.crewSite);
        return;
      }
      const status=event.target.closest('.ns-status-module');if(!status||event.target.closest('button,a,input,select,textarea')||status.dataset.status==='markets')return;if(!eventWindow.pinned)close();
      const key=status.dataset.status,registry=window.NorthstarModules?.registry;
      const id=key==='dispatch'?'markets:dispatch':key==='markets'?'markets:IESO':[...(registry?.values()||[])].find(m=>key==='events'?m.el.id==='eventRegister':m.sourceSection==='crew')?.id;
      if(id)window.NorthstarModules.open(id);
    });
    for (const key of ['dispatch']) {
      const element=bar.querySelector(`[data-status="${key}"]`);
      window.NorthstarModulePreview?.bind(element, {
        title:()=>key==='dispatch'?'APIROQ dispatch':'Crew check-ins',
        source:()=>key==='dispatch'?document.getElementById('dispatchDetail'):document.getElementById('overviewStaff'),
        open:()=>{} // The status bar click handler owns navigation.
      });
    }
    for (const element of bar.querySelectorAll('.ns-status-module')) {
      element.tabIndex=0;
      if(element.dataset.status!=='markets')element.addEventListener('keydown',event=>{
        if(event.target===element&&['Enter',' '].includes(event.key)){event.preventDefault();element.click();}
      });
    }
    const dispatchFlashTimers=new Map();
    let previousDispatchValues=null;
    const acceptedDispatches=new Set();
    let currentInstructionKey=null;
    function flashGreen(key){
      const tile=bar.querySelector(`[data-status=dispatch] [data-flash-key="${key}"]`);
      if(!tile)return;
      tile.classList.remove('ns-dispatch-flash-green');
      void tile.offsetWidth;
      tile.classList.add('ns-dispatch-flash-green');
      clearTimeout(dispatchFlashTimers.get(key));
      dispatchFlashTimers.set(key,setTimeout(()=>tile.classList.remove('ns-dispatch-flash-green'),1300));
    }
    function render(){
      const f=window.NorthstarOverview?.feeds||{},d=f.dispatch?.data||{},market=window.NorthstarMarketModules?.data()||f.market?.data||{},active=Array.isArray(f.staff?.data)&&f.staff.checked&&!f.staff.error&&Date.now()-f.staff.checked<90000?f.staff.data.filter(r=>r.status!=='checked-out'&&crewCode(r)):null;
      const dispatchEl=bar.querySelector('[data-status=dispatch]');
      const orItems=[['10N','tenN'],['10S','tenS'],['30R','thirtyR']].map(([product,key])=>({product,...orStatus(product,key,d)}));
      const reserveKeys=['tenN','tenS','thirtyR'];
      const totalOr=reserveKeys.every(key=>finite(d?.reserveStandby?.[key]))?reserveKeys.reduce((total,key)=>total+Number(d.reserveStandby[key]),0):null;
      const activationTotal=reserveKeys.every(key=>finite(d?.reserveStandby?.[key]))?totalOr:finite(d?.orActivationMw)?Number(d.orActivationMw):null;
      orItems.push({product:'Total',state:totalOr===null?'unknown':'standby',text:num(totalOr)});
      const activeOr=orItems.find(item=>item.state==='active');
      const dispatchValues={instruction:finite(d.dispatchMw)?Number(d.dispatchMw):null,standby:Object.fromEntries(reserveKeys.map(key=>[key,finite(d?.reserveStandby?.[key])?Number(d.reserveStandby[key]):null]))};
      if(previousDispatchValues){
        if(dispatchValues.instruction!==null&&dispatchValues.instruction!==previousDispatchValues.instruction)flashGreen('instruction');
        for(const key of reserveKeys)if(dispatchValues.standby[key]!==null&&dispatchValues.standby[key]!==previousDispatchValues.standby[key])flashGreen(key);
      }
      previousDispatchValues=dispatchValues;
      const instructionKey=dispatchValues.instruction===null?null:String(dispatchValues.instruction);
      if(instructionKey!==currentInstructionKey){currentInstructionKey=instructionKey;if(instructionKey!==null)acceptedDispatches.delete(instructionKey);}
      const dispatchAccepted=instructionKey!==null&&acceptedDispatches.has(instructionKey);
      const intervalStart=d?.dispatchInterval?.start,intervalEnd=d?.dispatchInterval?.end;
      const dispatchConnected=d?.healthy!==false&&!d?.stale&&finite(d?.outputMw)&&finite(d?.dispatchMw)&&!['simulated','unavailable'].includes(String(d?.source||'').toLowerCase());
      const dispatchConnectionTitle=`IESO dispatch service · ${dispatchConnected?'Connected':String(d?.source||'').toLowerCase()==='simulated'?'Connection unavailable':'Connection unavailable'} · Source ${String(d?.source||'').toLowerCase()==='simulated'?'unavailable':d?.source||'unavailable'} · Last update ${d?.updated?stamp(d.updated):'unavailable'} · Interval ${intervalStart?stamp(intervalStart):'unavailable'} to ${intervalEnd?stamp(intervalEnd):'unavailable'}`;
      const orState=activeOr?'active':orItems.some(item=>item.state==='standby')?'standby':'unknown';
      const orStatusText=activeOr?'OR ACTIVATED':orState==='standby'?'OR STANDBY':'OR STATUS UNKNOWN';
      const staff=crewSummary(active);
      paintEventShell();
      if(Array.isArray(f.events?.data?.items) && f.events.data.items.length && !alarmRows.length){
        alarmRows=f.events.data.items;paintAlarms();
      }
      loadAlarms();
      const content={
        dispatch:`<div class="ns-status-title-row"><b class="ns-status-title" data-asset-id="dispatch-title">Dispatch · APIROQ</b><strong class="ns-dispatch-alert is-${orState}" data-asset-id="operating-reserve-status" aria-label="Operating reserve status" aria-live="polite">${orStatusText}</strong></div><div class="ns-dispatch-service-row"><span class="ns-dispatch-interval" tabindex="0" title="${esc(dispatchConnectionTitle)}"><b>${intervalStart?time(intervalStart):'—'}</b></span><span class="ns-dispatch-connection${dispatchConnected?' is-connected':String(d?.source||'').toLowerCase()==='simulated'?' is-simulated':' is-disconnected'}" tabindex="0" title="${esc(dispatchConnectionTitle)}" aria-label="${dispatchConnected?'IESO dispatch connected':String(d?.source||'').toLowerCase()==='simulated'?'IESO dispatch offline':'IESO dispatch offline'}"><i aria-hidden="true"></i></span><span class="ns-dispatch-service-popover" role="tooltip">${esc(dispatchConnectionTitle)}</span></div><div class="ns-status-metrics ns-status-metrics-three ns-dispatch-metrics"><span data-asset-id="dispatch-value" data-flash-key="instruction" class="ns-dispatch-value${instructionKey&&!dispatchAccepted?' ns-dispatch-pending':''}"><small>Dispatch</small><strong>${num(d.dispatchMw)}</strong></span><button type="button" class="ns-dispatch-accept${dispatchAccepted?' is-accepted':''}" data-accept-dispatch${instructionKey?` data-instruction-key="${instructionKey}"`:''} ${instructionKey?'':'disabled'}>${dispatchAccepted?'Accepted':'Accept'}</button><span data-asset-id="output-value"><small>Output</small><strong>${num(d.outputMw)}</strong></span></div><div class="ns-or-grid" data-asset-id="operating-reserve-values" aria-label="Operating reserve values">${orItems.map(item=>`<span data-flash-key="${item.product==='Total'?'total':item.product==='10N'?'tenN':item.product==='10S'?'tenS':'thirtyR'}" class="ns-or-item ns-or-${item.state}${activeOr&&(item.product===activeOr.product)?' ns-or-activated':''}"><small>${item.product}</small><strong>${item.product==='Total'?num(activationTotal):item.text}</strong></span>`).join('')}</div>`,
        markets:`<div class="ns-market-grid">${['IESO','APIROQ'].map(code=>marketNode(code,market.nodes?.[code],market)).join('')}</div>`,
        crew:`<div class="ns-crew-tracker"><div class="ns-crew-summary ns-crew-summary-${staff.state}${staff.state==='missed'&&staff.signature!==localStorage.getItem('northstarCrewStripAcknowledged')?' is-flashing':''}" role="status" aria-label="WORKERS ON-SITE ${staff.count}${staff.state==='missed'?', check-in missed':staff.state==='due'?', check-in due':''}"><span>WORKERS ON-SITE -</span><strong>${staff.count}</strong></div>${statusWindow?'':`<button type="button" class="ns-status-popout ns-crew-popout" data-asset-id="fixed-dashboard-launcher-v2" data-open-status-window title="Open fixed dashboard in a full-screen window" aria-label="Open fixed dashboard in a full-screen window">↗</button>`}<div class="ns-crew-sites" aria-label="Checked-in workers by station">${crewMarkup(active)}</div></div>`
      };
      let contentChanged=false;
      for(const [key,value] of Object.entries(content)){const el=bar.querySelector(`[data-status=${key}] .ns-status-content`);if(el.dataset.markup!==value){el.innerHTML=value;el.dataset.markup=value;contentChanged=true;}}
      dispatchEl?.querySelectorAll('.ns-or-grid > .ns-or-item').forEach(item=>{
        const label=item.querySelector('small')?.textContent?.trim().toLowerCase();
        if(label)item.dataset.assetId='operating-reserve-'+label;
      });
      // Live status markup replaces the reserve badge node. Reapply the saved
      // asset geometry in this same render so it never flashes at its CSS default.
      if(contentChanged)window.NorthstarAssetEditor?.refreshNow?.();
      bar.querySelectorAll('[data-accept-dispatch]').forEach(button=>button.addEventListener('click',()=>{const key=button.dataset.instructionKey;if(!key)return;acceptedDispatches.add(key);render();}));
      dispatchEl.classList.toggle('ns-or-active',Boolean(activeOr));
      dispatchEl.classList.toggle('ns-or-activation-on',Boolean(activeOr));
      position();
    }
    window.addEventListener('northstar:feed-update',render);window.addEventListener('northstar:market-extra-update',render);window.addEventListener('resize',position);window.addEventListener('northstar:status-layout-change',position);new ResizeObserver(position).observe(document.querySelector('.app>aside'));
    setInterval(()=>{if(!document.hidden)render();},30000);
    setInterval(()=>{if(!document.hidden)tickHeClock();},1000);
    render();
    tickHeClock();
  }
  function init(){
    const nav=document.getElementById('sideNav');if(!nav)return;
    document.addEventListener('click',event=>{if(event.target.closest('.layout-edit-toggle'))setTimeout(()=>document.dispatchEvent(new Event('northstar:crew-edit-refresh')),0);});
    statusBar();
    window.dispatchEvent(new Event('northstar:status-ready'));
    const enhance=()=>{
      nav.querySelectorAll('button[data-tab]:not([data-chrome-skip])').forEach(button=>{
      if(button.dataset.chromeReady)return;
      button.dataset.chromeReady='true';
      const [label,path]=items[button.dataset.tab] || [button.textContent.trim(),items.modules[1]];
      [...button.childNodes].filter(node=>node.nodeType===3).forEach(node=>node.remove());
      let icon;
      if(button.dataset.tab==='assistant'){
        icon=document.createElement('img');icon.src='northstar-agent-favicon-light.png?v=20261007-1';icon.alt='';icon.width=17;icon.height=17;icon.setAttribute('aria-hidden','true');icon.className='nav-icon northstar-nav-icon';
      }else{
        icon=document.createElementNS('http://www.w3.org/2000/svg','svg');icon.setAttribute('viewBox','0 0 24 24');icon.setAttribute('width','17');icon.setAttribute('height','17');icon.setAttribute('fill','none');icon.setAttribute('stroke','currentColor');icon.setAttribute('aria-hidden','true');icon.classList.add('nav-icon');
        const line=document.createElementNS('http://www.w3.org/2000/svg','path');line.setAttribute('d',path);icon.append(line);
      }
      const text=document.createElement('span');text.className='nav-label';text.textContent=label;
      button.prepend(icon);button.append(text);button.title=label;button.setAttribute('aria-label',label);
      });
      nav.querySelectorAll('button[data-nav-section-toggle]').forEach(button=>{
        if(button.dataset.chromeReady)return;
        button.dataset.chromeReady='true';
        const [label,path]=items[button.dataset.navSectionToggle] || [button.dataset.navSectionLabel || button.textContent.trim(),items.modules[1]];
        const icon=document.createElementNS('http://www.w3.org/2000/svg','svg');icon.setAttribute('viewBox','0 0 24 24');icon.setAttribute('width','17');icon.setAttribute('height','17');icon.setAttribute('fill','none');icon.setAttribute('stroke','currentColor');icon.setAttribute('aria-hidden','true');icon.classList.add('nav-icon');
        const line=document.createElementNS('http://www.w3.org/2000/svg','path');line.setAttribute('d',path);icon.append(line);
        const text=document.createElement('span');text.className='nav-label ns-section-nav-label';text.textContent=label;
        button.replaceChildren(icon,text);
      });
    };
    enhance();new MutationObserver(enhance).observe(nav,{childList:true});
    const toolbar=document.querySelector('.layout-toolbar');
    if(toolbar&&new URLSearchParams(location.search).get('nsStatusWindow')==='1' && !new URLSearchParams(location.search).has('nsModuleWindow')){
      const editorToggle=toolbar.querySelector('.layout-edit-toggle');
      if(editorToggle){editorToggle.textContent='EDIT LAYOUT';editorToggle.setAttribute('aria-label','Open layout editor');}
    }
    const orderToolbar=()=>{
      const add=document.querySelector('.overview-add-module');
      if(toolbar&&add){toolbar.append(add);add.textContent='Add Module';add.title='Open the module builder';}
      if(toolbar){
        const order=['.layout-edit-toggle','.overview-edit-modules','.layout-reset','.layout-snap-toggle','.layout-save','.ns-market-border-open','.layout-style-wrap','.overview-add-module'];
        order.forEach(selector=>{const control=toolbar.querySelector(selector);if(control)toolbar.append(control)});
      }
    };
    orderToolbar();
    if(toolbar&&!document.querySelector('.overview-add-module')){
      const addObserver=new MutationObserver(()=>{if(document.querySelector('.overview-add-module')){orderToolbar();addObserver.disconnect()}});
      addObserver.observe(document.body,{childList:true,subtree:true});
    }
    if(toolbar&&!toolbar.querySelector('.overview-edit-modules')){
      const edit=document.createElement('button');edit.type='button';edit.className='overview-edit-modules';edit.textContent='Edit Modules';edit.title='Open the module editor';
      edit.addEventListener('click',()=>{document.querySelector('#sideNav [data-tab="modules"]')?.click();document.querySelector('#openModuleEdit')?.click();});
      toolbar.append(edit);
    }
    if(toolbar&&!toolbar.querySelector('.ns-market-border-open')){
      const defaults={card:'#29404c',title:'#243642',price:'#29404c',width:1};
      const key='northstarRestoredV1_northstarFixedMarketBorderStyleV1';
      const read=()=>{try{const value=JSON.parse(localStorage.getItem(key)||'{}');return{card:/^#[\da-f]{6}$/i.test(value.card)?value.card:defaults.card,title:/^#[\da-f]{6}$/i.test(value.title)?value.title:defaults.title,price:/^#[\da-f]{6}$/i.test(value.price)?value.price:defaults.price,width:Number.isFinite(Number(value.width))?Math.max(0,Math.min(3,Number(value.width))):defaults.width}}catch{return{...defaults}}};
      const apply=value=>{const root=document.getElementById('nsStatusBar');if(!root)return;root.style.setProperty('--ns-market-card-border',value.card);root.style.setProperty('--ns-market-title-border',value.title);root.style.setProperty('--ns-market-price-border',value.price);root.style.setProperty('--ns-market-border-width',`${value.width}px`)};
      let saved=read();apply(saved);
      const open=document.createElement('button');open.type='button';open.className='ns-market-border-open';open.textContent='Market borders';open.title='Edit thin borders inside the fixed dashboard market cards';
      const dialog=document.createElement('dialog');dialog.className='ns-market-border-dialog';dialog.setAttribute('aria-labelledby','nsMarketBorderTitle');
      dialog.innerHTML='<header><h2 id="nsMarketBorderTitle">Fixed dashboard · Market borders</h2></header><div class="ns-market-border-fields"><label class="ns-market-border-field"><span>Card outline</span><input type="color" data-market-border="card"><output></output></label><label class="ns-market-border-field"><span>Title underline</span><input type="color" data-market-border="title"><output></output></label><label class="ns-market-border-field"><span>RT / DA price box</span><input type="color" data-market-border="price"><output></output></label><label class="ns-market-border-field"><span>Line thickness</span><input type="range" data-market-border="width" min="0" max="3" step="0.5"><output></output></label></div><footer><button type="button" data-action="reset">Reset</button><button type="button" data-action="cancel">Cancel</button><button type="button" data-action="apply">Apply</button></footer>';
      document.body.append(dialog);toolbar.append(open);
      const inputs=[...dialog.querySelectorAll('[data-market-border]')];
      const current=()=>Object.fromEntries(inputs.map(input=>[input.dataset.marketBorder,input.type==='range'?Number(input.value):input.value]));
      const setForm=value=>{inputs.forEach(input=>{input.value=String(value[input.dataset.marketBorder]);const output=input.parentElement.querySelector('output');if(output)output.value=input.type==='range'?`${input.value}px`:input.value});apply(value)};
      open.addEventListener('click',()=>{saved=read();setForm(saved);dialog.showModal()});
      inputs.forEach(input=>input.addEventListener('input',()=>{const output=input.parentElement.querySelector('output');if(output)output.value=input.type==='range'?`${input.value}px`:input.value;apply(current())}));
      dialog.querySelector('[data-action=reset]').addEventListener('click',()=>setForm({...defaults}));
      dialog.querySelector('[data-action=cancel]').addEventListener('click',()=>dialog.close('cancel'));
      dialog.querySelector('[data-action=apply]').addEventListener('click',()=>{saved=current();try{localStorage.setItem(key,JSON.stringify(saved))}catch{}apply(saved);dialog.close('apply')});
      dialog.addEventListener('close',()=>{if(dialog.returnValue!=='apply')apply(read())});
    }
    const reset=toolbar?.querySelector('.layout-reset'),save=toolbar?.querySelector('.layout-save'),theme=toolbar?.querySelector('.layout-style-toggle');
    reset?.replaceChildren('Reset');if(reset)reset.title='Restore the most recently saved layout';
    save?.replaceChildren('Save');if(save)save.title='Save the current layout';
    theme?.replaceChildren('Theme');if(theme)theme.title='Choose dashboard theme';
    if(toolbar&&!toolbar.querySelector('.layout-snap-toggle')){
      const snapLabel=document.createElement('label');snapLabel.className='layout-snap-toggle';
      snapLabel.innerHTML='<input type="checkbox" data-layout-snap> Snap to grid';snapLabel.title='Align moved and resized layout parts to the grid';
      const snapInput=snapLabel.querySelector('input');
      try{snapInput.checked=localStorage.getItem('northstarLayoutSnapToGrid')!=='false'}catch{snapInput.checked=true}
      window.northstarLayoutSnapToGrid=snapInput.checked;
      window.dispatchEvent(new CustomEvent('northstar:layout-snap-change',{detail:{enabled:snapInput.checked}}));
      snapInput.addEventListener('change',()=>{
        window.northstarLayoutSnapToGrid=snapInput.checked;
        try{localStorage.setItem('northstarLayoutSnapToGrid',String(snapInput.checked))}catch{}
        window.dispatchEvent(new CustomEvent('northstar:layout-snap-change',{detail:{enabled:snapInput.checked}}));
      });
      toolbar.append(snapLabel);
    }
    const snapLabel=toolbar?.querySelector('.layout-snap-toggle');
    if(snapLabel&&!snapLabel.querySelector('[data-layout-grid-step]')){
      const step=document.createElement('input');step.type='number';step.min='1';step.max='100';step.step='1';step.value=String(Number(localStorage.getItem('northstarLayoutGridStep'))||5);step.dataset.layoutGridStep='';step.title='Grid spacing in pixels';step.setAttribute('aria-label','Grid spacing in pixels');snapLabel.append(' Grid px ',step);
      const applyStep=()=>{const value=Math.max(1,Math.min(100,Math.round(Number(step.value)||5)));step.value=String(value);window.northstarLayoutGridStep=value;document.documentElement.style.setProperty('--ns-edit-grid-step',value+'px');try{localStorage.setItem('northstarLayoutGridStep',String(value))}catch{}window.dispatchEvent(new CustomEvent('northstar:layout-grid-step-change',{detail:{step:value}}));};
      window.northstarLayoutGridStep=Number(step.value);applyStep();step.addEventListener('change',applyStep);
      if(!document.querySelector('.ns-edit-grid-overlay')){const grid=document.createElement('div');grid.className='ns-edit-grid-overlay';grid.setAttribute('aria-hidden','true');document.body.append(grid)}
    }
    if(snapLabel&&!snapLabel.querySelector('[data-layout-grid-mode]')){
      const mode=document.createElement('select');mode.dataset.layoutGridMode='';mode.setAttribute('aria-label','Edit-mode guide style');mode.title='Choose even grid or previous outline guides';
      mode.innerHTML='<option value="even">Even grid</option><option value="outline">Previous outlines</option>';
      try{mode.value=localStorage.getItem('northstarLayoutGridMode')==='outline'?'outline':'even'}catch{mode.value='even'}
      const applyMode=()=>{document.body.classList.toggle('ns-edit-grid-outline-mode',mode.value==='outline');document.body.classList.toggle('ns-edit-grid-even-mode',mode.value==='even');try{localStorage.setItem('northstarLayoutGridMode',mode.value)}catch{}};
      mode.addEventListener('change',applyMode);snapLabel.append(' Guides ',mode);applyMode();
    }
    orderToolbar();
    if(toolbar)new ResizeObserver(()=>document.body.style.setProperty('--ns-dock-height',Math.ceil(toolbar.getBoundingClientRect().height)+'px')).observe(toolbar);
  }
  const start=()=>Promise.resolve(window.northstarLayoutReady).then(()=>{if(window.northstarStylesReady)window.northstarStylesReady.then(()=>setTimeout(init,0));else setTimeout(init,0);});
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start);else start();
})();

