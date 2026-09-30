/* Shared navigation and editing controls; existing handlers remain attached. */
(() => {
  const items={
    overview:['Overview','M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z'],
    logbook:['Events','M7 3h10v3H7zM5 5H3v16h18V5h-2M7 11h10M7 16h7'],
    crew:['Crew check-ins','M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M16 3a4 4 0 0 1 0 8M22 21v-2a4 4 0 0 0-3-4M13 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0'],
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
    'field-operations':['Field operations','M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 1 1 16 0M15 10a3 3 0 1 1-6 0 3 3 0 0 1 6 0']
  };
  function statusBar(){
    if(document.getElementById('nsStatusBar'))return;
    const statusWindow=new URLSearchParams(location.search).get('nsStatusWindow')==='1';
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
    const crewLayout=[['TW','IR','IR TS','IS'],['OW','WO','CT','BB'],['CL','SF','FF','FF TS'],['KE','NO','OK'],['A1','A2','CG','MC'],['B1','B2']];
    const crewNames={'TW':'Twin Falls','IR':'Iroquois Falls','IR TS':'Iroquois Falls TS','IS':'Island Falls','OW':'Old Woman Falls','WO':'White Otter Rapids','CT':'Camp Three Rapids','BB':'Big Beaver Falls','FF':'Fort Frances','FF TS':'Fort Frances TS','SF':'Sturgeon Falls','CL':'Calm Lake','KE':'Kenora','NO':'Norman','OK':'Okikendawt GS','CG':'Cogent','B1':'Bird GS','B2':'B2','A1':'Aiyers 1','A2':'Aiyers 2','MC':'McDougal'};
    let crewPositions={},crewSaveState='Loading profile';
    const crewEditing=()=>document.body.classList.contains('layout-edit');
    if(typeof document!=='undefined')document.addEventListener('northstar:crew-edit-refresh',render);
    if(typeof window!=='undefined')window.addEventListener('northstar:layout-snap-change',event=>{window.northstarLayoutSnapToGrid=event.detail?.enabled!==false;});
    const crewDefaultPositions=()=>Object.fromEntries(crewLayout.flatMap((row,r)=>row.map((code,c)=>[code,{x:c*25,y:r*32}])));
    fetch('/api/profile/crew-layout').then(r=>{if(!r.ok)throw Error();return r.json();}).then(data=>{crewPositions=data.positions||{};crewSaveState='';render();}).catch(()=>{crewSaveState='Profile unavailable';render();});
    const crewCode=row=>{
      const norm=v=>String(v||'').toLowerCase().replace(/^site:/,'').replace(/[-_]/g,' ').replace(/\b(gs|230 kv|115 kv)\b/g,'').replace(/\s+/g,' ').trim();
      const raw=String(row.site||'');
      if(/iroquois.*(230|\bTS\b)/i.test(raw))return 'IR TS';
      if(/fort frances.*(115|\bTS\b)/i.test(raw))return 'FF TS';
      const value=norm(row.siteId||row.site);
      return Object.keys(crewNames).find(code=>norm(code)===value||norm(crewNames[code])===value)||String(row.site||'Unknown');
    };
    const crewWorkerState=(row,now=Date.now())=>{
      if(row.needsHelp||['requested','acknowledged'].includes(row.helpState))return 'missed';
      const last=Date.parse(row.lastHeard),limit=Number(row.overdueAfterMinutes);
      if(Number.isFinite(last)&&row.overdueAfterMinutes!=null&&Number.isFinite(limit)&&limit>0){
        const late=now-last-limit*60000;
        if(late>300000)return 'missed';
        if(late>=0)return 'due';
        if(row.overdue||row.status==='overdue')return 'pending';
        return row.status==='on-site'?'current':'pending';
      }
      return row.overdue||row.status==='overdue'?'missed':'pending';
    };
    const crewMarkup=active=>{
      if(active===null)return '<span class="ns-status-site ns-status-site-pending">CHECK-IN STATUS UNAVAILABLE</span>';
      const groups=new Map(crewLayout.flat().filter(Boolean).map(code=>[code,[]]));
      active.forEach(row=>{const code=crewCode(row);if(groups.has(code))groups.get(code).push(row);});
      const lone=[];
      const promoted=new Set(lone.map(([code])=>code)),offset=Math.ceil(lone.length/6);
      const button=(code,people,row,col)=>{
        const states=people.map(person=>crewWorkerState(person));
        const state=!people.length?'empty':['missed','due','pending'].find(value=>states.includes(value))||'current';
        const status={empty:'No active workers',current:'All check-ins current',due:'Check-in due: 0–5 minutes late',missed:'Manual intervention required: contact on-site worker',pending:'Check-in conditions unverified'}[state];
        const site=people[0]?.site||crewNames[code]||code,label=`${site}: ${people.length} workers. ${status}${promoted.has(code)?'. Lone worker site':''}`;
        return `<button type="button" class="ns-status-site ns-status-site-${state}" style="left:${(crewPositions[code]||crewDefaultPositions()[code]).x}%;top:${(crewPositions[code]||crewDefaultPositions()[code]).y}px" data-crew-code="${esc(code)}" data-crew-site="${esc(site)}" title="${esc(label)}" aria-label="${esc(label)}"><strong>${esc(code)} - ${people.length}</strong></button>`;
      };
      let html=lone.map(([code,people],i)=>button(code,people,Math.floor(i/6)+1,i%6+1)).join('');
      crewLayout.forEach((row,r)=>row.forEach((code,c)=>{if(code&&!promoted.has(code))html+=button(code,groups.get(code),r+offset+1,c+1);}));
      return html;
    };
    const marketNode=(code,node,market)=>{
      const demand=code==='IESO'?`<span class="ns-status-price ns-status-price-demand">Demand <strong>${finite(market?.ontario?.demand)?Math.round(Number(market.ontario.demand)).toLocaleString()+' MW':'—'}</strong></span><span class="ns-status-price ns-status-price-forecast">Forecast <strong>${finite(market?.ontario?.forecastDemand)?Math.round(Number(market.ontario.forecastDemand)).toLocaleString()+' MW':'—'}</strong></span>`:'';
      return `<article class="ns-status-node" data-node="${esc(code)}"><b>${esc(code==='IESO'?'Market':code)}</b><div class="ns-status-price-box"><span class="ns-status-price ns-status-price-rt">RT <strong>${money(node?.rt)}</strong></span><span class="ns-status-price ns-status-price-da">DA <strong>${money(node?.da)}</strong></span></div>${demand?`<div class="ns-status-demand-box">${demand}</div>`:''}</article>`;
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
    bar.innerHTML=['events','dispatch','markets','crew'].map(key=>`<section class="ns-status-module${key==='events'?' ns-status-events':''}" data-status="${key}"><div class="ns-status-content"></div></section>`).join('');
    document.body.append(bar);document.body.classList.add('ns-has-status');document.querySelector('main').classList.add('ns-persistent-status');
    if(statusWindow){document.body.classList.add('ns-status-window');document.title='Fixed Dashboard · NorthStar';}
    function openStatusWindow(){
      const url=new URL(location.href);url.searchParams.set('nsStatusWindow','1');
      const width=screen.availWidth||innerWidth,height=screen.availHeight||innerHeight;
      const popup=window.open(url.href,'northstar-fixed-dashboard',`popup=yes,left=0,top=0,width=${width},height=${height}`);
      if(!popup)window.alert('Allow pop-up windows for NorthStar, then try again.');else popup.focus();
    }
    const popup=document.createElement('section');popup.id='nsStatusEvents';popup.hidden=true;popup.setAttribute('aria-label','Detailed event log');
    popup.innerHTML='<header><strong>Event log</strong><button type="button" data-close aria-label="Close event preview">×</button></header><div class="ns-status-log" tabindex="0"></div><footer><span role="status"></span><button type="button" data-more hidden>Load older events</button></footer>';document.body.append(popup);
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
      clearTimeout(marketCloseTimer);if(marketPreview.hidden){marketPreview.hidden=false;previewMarketData();positionMarketPreview();requestAnimationFrame(()=>window.NorthstarMarketModules?.mountPreview?.(marketPreview.querySelector('.market-trend-host')));}
    }
    function closeMarketPreview(){clearTimeout(marketHoverTimer);clearTimeout(marketCloseTimer);marketPreview.hidden=true;marketWindow.reset();window.NorthstarMarketTrends?.unmount(marketPreview.querySelector('.market-trend-host'));}
    function scheduleMarketPreviewClose(){clearTimeout(marketHoverTimer);if(marketWindow.pinned)return;clearTimeout(marketCloseTimer);marketCloseTimer=setTimeout(closeMarketPreview,240);}
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
    document.addEventListener('keydown',event=>{if(event.key==='Escape'&&!marketPreview.hidden)scheduleMarketPreviewClose();});
    window.addEventListener('resize',positionMarketPreview);window.addEventListener('northstar:feed-update',()=>{if(!marketPreview.hidden)previewMarketData();});
    const events=bar.querySelector('[data-status=events]');let hoverTimer,closeTimer,loading=false,cursor=null,rows=[],alarmRows=[],alarmFilter='all',alarmLoading=false,lastLoaded=0,lastAlarmLoad=0;
    const alarmPreview=document.createElement('section');alarmPreview.id='nsAlarmPreview';alarmPreview.hidden=true;alarmPreview.setAttribute('role','tooltip');document.body.append(alarmPreview);
    let alarmPreviewTimer,alarmPreviewTarget;
    const hideAlarmPreview=()=>{clearTimeout(alarmPreviewTimer);alarmPreview.hidden=true;alarmPreviewTarget=null;};
    const showAlarmPreview=(eventId,target)=>{
      const item=[...alarmRows,...rows].find(row=>String(row.eventId)===String(eventId));
      if(!item||!(item.category==='alarm'||['critical','warning'].includes(String(item.severity||'').toLowerCase())))return;
      clearTimeout(alarmPreviewTimer);alarmPreviewTarget=target;
      const detail=item.payload?.details||item.payload?.detail||item.payload?.text||item.description||item.message||'No additional details supplied.';
      alarmPreview.innerHTML=`<strong>${esc(item.summary||item.eventType||'Alarm')}</strong><p>${esc(detail)}</p><small>${esc([stamp(item.occurredAt),item.site,item.payload?.equipment||item.payload?.node,item.category,item.severity,item.status,item.source,item.actorId].filter(Boolean).join(' · '))}</small><a href="event-detail.html?id=${encodeURIComponent(item.eventId)}">Open alarm details ↗</a>`;
      alarmPreview.hidden=false;
      const rect=target.getBoundingClientRect(),width=Math.min(360,innerWidth-24),left=rect.right+width+16<=innerWidth?rect.right+8:Math.max(12,rect.left-width-8);
      alarmPreview.style.left=left+'px';alarmPreview.style.top=Math.max(12,Math.min(rect.top,innerHeight-alarmPreview.offsetHeight-12))+'px';alarmPreview.style.width=width+'px';
    };
    const scheduleAlarmPreview=()=>{clearTimeout(alarmPreviewTimer);alarmPreviewTimer=setTimeout(hideAlarmPreview,180);};
    [events,popup].forEach(root=>{
      root.addEventListener('pointerover',event=>{
        const target=event.target.closest('.ns-status-alarm[data-event-id],#nsStatusEvents article[data-event-id]');
        if(!target||target.contains(event.relatedTarget))return;
        clearTimeout(alarmPreviewTimer);alarmPreviewTimer=setTimeout(()=>showAlarmPreview(target.dataset.eventId,target),window.NORTHSTAR_MODULE_HOVER_DELAY||750);
      });
      root.addEventListener('pointerout',event=>{const target=event.target.closest('.ns-status-alarm[data-event-id],#nsStatusEvents article[data-event-id]');if(target&&!target.contains(event.relatedTarget))scheduleAlarmPreview();});
    });
    alarmPreview.addEventListener('pointerenter',()=>clearTimeout(alarmPreviewTimer));alarmPreview.addEventListener('pointerleave',scheduleAlarmPreview);
    const filters=[['all','All'],['alarm','Alarms'],['critical','Critical'],['warning','Warning'],['unacked','Unacked']];
    const close=()=>{clearTimeout(hoverTimer);clearTimeout(closeTimer);popup.hidden=true;eventWindow.reset();};
    const eventWindow=window.NorthStarHoverWindow(popup,'Event log',close);
    popup.addEventListener('pointerdown',()=>clearTimeout(closeTimer));
    function position(){
      const aside=document.querySelector('.app>aside'),left=aside?Math.max(0,aside.getBoundingClientRect().right):0;
      bar.style.left=left+'px';document.body.style.setProperty('--ns-status-height',bar.offsetHeight+'px');
      if(!eventWindow.pinned){popup.style.left=Math.max(8,left+8)+'px';popup.style.top=bar.getBoundingClientRect().bottom+'px';popup.style.maxWidth=Math.max(180,innerWidth-left-16)+'px';}
    }
    function paintRows(){popup.querySelector('.ns-status-log').innerHTML=rows.map(e=>`<article data-event-id="${esc(e.eventId)}"><time>${esc(stamp(e.occurredAt))}</time><strong>${esc(e.summary||e.eventType||'Event')}</strong><p>${esc(e.description||e.message||e.payload?.details||e.payload?.description||'')}</p><small>${esc([e.site,e.source,e.actorId,e.severity,e.status].filter(Boolean).join(' · '))}</small><a href="event-detail.html?id=${encodeURIComponent(e.eventId)}">Open event report ↗</a></article>`).join('')||'<p>No recorded events.</p>';popup.querySelector('[data-more]').hidden=!cursor;}
    async function load(older=false){
      if(loading)return;loading=true;const message=popup.querySelector('footer span'),more=popup.querySelector('[data-more]');more.disabled=true;message.textContent='Loading…';
      try{const params=new URLSearchParams({limit:'50'});if(older&&cursor)params.set('cursor',cursor);
        const response=await fetch('/api/events/register?'+params,{cache:'no-store'});if(!response.ok)throw Error('Event service unavailable');
        const data=await response.json();if(!Array.isArray(data.items))throw Error('Invalid event response');
        rows=older?[...rows,...data.items.filter(e=>!rows.some(old=>old.eventId===e.eventId))]:data.items;cursor=data.nextCursor||null;lastLoaded=Date.now();paintRows();message.textContent=rows.length+' events shown';
      }catch{message.textContent=rows.length?'Refresh failed · previous events retained':'Event log unavailable · reopen to retry';}finally{loading=false;more.disabled=false;}
    }
    function open(){clearTimeout(hoverTimer);clearTimeout(closeTimer);position();popup.hidden=false;if(Date.now()-lastLoaded>30000)load();}
    function matchesFilter(e){
      if(alarmFilter==='all')return true;
      if(alarmFilter==='alarm')return e.category==='alarm' || String(e.eventType||'').includes('alarm') || String(e.eventType||'').includes('help');
      if(alarmFilter==='critical')return e.severity==='critical';
      if(alarmFilter==='warning')return e.severity==='warning';
      if(alarmFilter==='unacked')return unacked(e);
      return true;
    }
    function paintAlarms(){
      const list=events.querySelector('.ns-status-alarms');if(!list)return;
      const visible=alarmRows.filter(matchesFilter).slice(0,window.NORTHSTAR_DEMO_HOME?3:12);
      list.innerHTML=visible.map(e=>{
        const open=unacked(e);
        const href=`event-detail.html?id=${encodeURIComponent(e.eventId)}`;
        const severity=['critical','warning'].includes(e.severity)?e.severity:'info';
        return `<a class="ns-status-alarm ns-status-alarm-${severity}${open?' is-unacked':''}" role="listitem" href="${esc(href)}" data-event-id="${esc(e.eventId)}" title="${esc(e.summary||e.eventType||'Event')}"><time>${esc(time(e.occurredAt))}</time><span class="ns-status-alarm-text">${esc(e.summary||e.eventType||'Event')}</span><span class="ns-status-alarm-site">${esc(e.site||e.source||'')}</span>${open?'<span class="ns-status-alarm-mark" title="New / unacknowledged" aria-label="Unacknowledged">×</span>':'<span class="ns-status-alarm-mark is-quiet" aria-hidden="true"></span>'}</a>`;
      }).join('')||`<p class="ns-status-alarms-empty">${alarmLoading?'Loading alarms…':(events.dataset.alarmError||'No matching alarms.')}</p>`;
      events.querySelectorAll('[data-filter]').forEach(btn=>btn.classList.toggle('is-active',btn.dataset.filter===alarmFilter));
    }
    async function loadAlarms(force=false){
      if(alarmLoading || (!force && Date.now()-lastAlarmLoad<15000 && alarmRows.length)){paintAlarms();return;}
      alarmLoading=true;paintAlarms();
      try{
        const params=new URLSearchParams({limit:'24'});
        if(alarmFilter==='alarm')params.append('type','alarm');
        if(alarmFilter==='critical'||alarmFilter==='warning')params.append('severity',alarmFilter);
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
      const popout=statusWindow?'':`<button type="button" class="ns-status-popout" data-open-status-window title="Open fixed dashboard in a full-screen window" aria-label="Open fixed dashboard in a full-screen window">↗</button>`;
      const shell=`<div class="ns-status-events-head"><b class="ns-status-title">Event Log <span class="ns-status-he" data-he-clock></span></b><div class="ns-status-filters" role="toolbar" aria-label="Alarm filters">${filters.map(([id,label])=>`<button type="button" data-filter="${id}"${id===alarmFilter?' class="is-active"':''}>${label}</button>`).join('')}</div>${popout}</div><div class="ns-status-alarms" role="list" aria-live="polite"></div>`;
      if(content.dataset.shell!==shell){content.innerHTML=shell;content.dataset.shell=shell;}
      tickHeClock();
      paintAlarms();
    }
    function tickHeClock(){
      const label=heLabel();
      const clock=events.querySelector('[data-he-clock]');
      if(clock)clock.textContent=label;
      const popupTitle=popup.querySelector('header strong');
      if(popupTitle)popupTitle.textContent=label?`Event log ${label}`:'Event log';
    }
    events.addEventListener('click',event=>{
      if(event.target.closest('[data-open-status-window]')){event.preventDefault();openStatusWindow();return;}
      const filter=event.target.closest('[data-filter]');
      if(filter){event.preventDefault();alarmFilter=filter.dataset.filter;paintEventShell();loadAlarms(true);return;}
    });
    events.addEventListener('pointerenter',()=>{clearTimeout(closeTimer);clearTimeout(hoverTimer);if(!document.body.classList.contains('layout-edit'))hoverTimer=setTimeout(open,window.NORTHSTAR_MODULE_HOVER_DELAY);});
    events.addEventListener('pointerleave',()=>{clearTimeout(hoverTimer);if(!eventWindow.pinned)closeTimer=setTimeout(close,240);});
    popup.addEventListener('pointerenter',()=>clearTimeout(closeTimer));
    popup.addEventListener('pointerleave',()=>{if(!eventWindow.pinned)closeTimer=setTimeout(close,240);});
    popup.querySelector('[data-close]').onclick=close;popup.querySelector('[data-more]').onclick=()=>load(true);
    document.addEventListener('keydown',event=>{if(event.key==='Escape')close();});
    document.addEventListener('pointerdown',event=>{if(!eventWindow.pinned&&!popup.contains(event.target)&&!events.contains(event.target))close();});
    const crewPopup=document.createElement('div');
    crewPopup.id='nsCrewHover';crewPopup.className='ns-crew-hover';crewPopup.hidden=true;crewPopup.setAttribute('role','tooltip');document.body.append(crewPopup);
    let crewAnchor=null,crewHideTimer,crewHoverTimer;
    const hideCrew=()=>{clearTimeout(crewHoverTimer);clearTimeout(crewHideTimer);crewAnchor?.removeAttribute('aria-describedby');crewAnchor=null;crewPopup.hidden=true;crewWindow.reset();};
    const crewWindow=window.NorthStarHoverWindow(crewPopup,'Crew details',hideCrew);
    crewPopup.addEventListener('pointerdown',()=>clearTimeout(crewHideTimer));
    const deferCrewHide=()=>{clearTimeout(crewHoverTimer);if(crewWindow.pinned)return;clearTimeout(crewHideTimer);crewHideTimer=setTimeout(hideCrew,180);};
    const showCrew=button=>{
      if(crewWindow.pinned)return;
      if(crewEditing())return;
      clearTimeout(crewHideTimer);crewAnchor?.removeAttribute('aria-describedby');crewAnchor=button;
      const site=button.dataset.crewSite,code=crewCode({site}),data=window.NorthstarOverview?.feeds?.staff?.data;
      const people=Array.isArray(data)?data.filter(row=>row.status!=='checked-out'&&crewCode(row)===code):null;
      const stamp=value=>value&&Number.isFinite(Date.parse(value))?new Date(value).toLocaleString('en-CA',{timeZone:'America/Toronto',month:'short',day:'numeric',hour:'2-digit',minute:'2-digit',hour12:false}):'Unavailable';
      if(crewWindow.pinned)return;
      crewPopup.innerHTML=`<h3>${esc(crewNames[code]||site)}</h3>${people===null?'<p>Worker information unavailable</p>':people.map(row=>{
        const state=crewWorkerState(row),status={current:'Check-in current',due:'Check-in 0–5 minutes late',missed:'Manual intervention required — contact worker',pending:'Check-in conditions unverified'}[state];
        const due=Number.isFinite(Date.parse(row.lastHeard))&&Number(row.overdueAfterMinutes)>0?new Date(Date.parse(row.lastHeard)+Number(row.overdueAfterMinutes)*60000).toISOString():null;
        return `<article><strong>${esc(row.name||'Unnamed worker')}</strong><p>${esc(row.company||row.kind||'Worker')}${row.alone?' · Working alone':''}</p><dl><dt>Checked in</dt><dd>${esc(stamp(row.checkedIn))}</dd><dt>Last check-in</dt><dd>${esc(stamp(row.lastHeard))}</dd><dt>Next due</dt><dd>${esc(stamp(due))}</dd></dl><p class="ns-crew-hover-${state}">${esc(status)}</p>${row.notes?`<p>${esc(row.notes)}</p>`:''}</article>`;
      }).join('')||'<p>No active workers at this site</p>'}<footer>Click the site button to open its crew module.</footer>`;
      crewWindow.restoreBar();button.removeAttribute('title');button.setAttribute('aria-describedby',crewPopup.id);crewPopup.hidden=false;
      const rect=button.getBoundingClientRect();crewPopup.style.left=Math.max(8,Math.min(rect.left,innerWidth-crewPopup.offsetWidth-8))+'px';
      crewPopup.style.top=Math.max(8,Math.min(rect.bottom+6,innerHeight-crewPopup.offsetHeight-8))+'px';
    };
    bar.addEventListener('pointerover',event=>{const button=event.target.closest('[data-crew-site]');if(button&&!button.contains(event.relatedTarget)){clearTimeout(crewHoverTimer);clearTimeout(crewHideTimer);crewHoverTimer=setTimeout(()=>showCrew(button),window.NORTHSTAR_MODULE_HOVER_DELAY);}});
    bar.addEventListener('pointerout',event=>{if(event.target.closest('[data-crew-site]')&&!event.target.closest('[data-crew-site]').contains(event.relatedTarget))deferCrewHide();});
    bar.addEventListener('focusin',event=>{const button=event.target.closest('[data-crew-site]');if(button)showCrew(button);});
    bar.addEventListener('focusout',deferCrewHide);
    crewPopup.addEventListener('pointerenter',()=>clearTimeout(crewHideTimer));crewPopup.addEventListener('pointerleave',deferCrewHide);
    document.addEventListener('keydown',event=>{if(event.key==='Escape')hideCrew();});
    window.addEventListener('resize',()=>{if(!crewWindow.pinned)hideCrew();});window.addEventListener('scroll',event=>{if(!crewWindow.pinned&&!crewPopup.contains(event.target))hideCrew();},true);
    let crewDrag=null;
    bar.addEventListener('pointerdown',event=>{
      const button=event.target.closest('[data-crew-code]');if(!crewEditing()||!button||event.button!==0)return;
      event.preventDefault();event.stopPropagation();hideCrew();
      const grid=button.parentElement,rect=grid.getBoundingClientRect();
      crewDrag={button,code:button.dataset.crewCode,rect,dx:event.clientX-button.getBoundingClientRect().left,dy:event.clientY-button.getBoundingClientRect().top};
      button.setPointerCapture(event.pointerId);
    });
    bar.addEventListener('pointermove',event=>{
      if(!crewDrag)return;const d=crewDrag;
      const snap=window.northstarLayoutSnapToGrid!==false,grid=5;
      let x=Math.max(0,Math.min(d.rect.width*0.75,event.clientX-d.rect.left-d.dx));
      let y=Math.max(0,Math.min(d.rect.height-d.button.offsetHeight,event.clientY-d.rect.top-d.dy));
      if(snap){x=Math.round(x/grid)*grid;y=Math.round(y/grid)*grid;}
      crewPositions[d.code]={x:x/d.rect.width*100,y};d.button.style.left=crewPositions[d.code].x+'%';d.button.style.top=y+'px';
    });
    bar.addEventListener('pointerup',()=>{crewDrag=null;});
    bar.addEventListener('pointercancel',()=>{crewDrag=null;});
    bar.addEventListener('click',async event=>{
      if(crewEditing())return;
      const site=event.target.closest('[data-crew-site]');
      if(site){
        event.preventDefault();event.stopPropagation();if(!eventWindow.pinned)close();if(!crewWindow.pinned)hideCrew();
        if(typeof window.openSiteCrew==='function')window.openSiteCrew(site.dataset.crewSite);
        const workspace=document.getElementById('siteCrewWorkspace');
        const module=[...(window.NorthstarModules?.registry?.values()||[])].find(item=>item.el===workspace||item.el.contains(workspace));
        if(module)window.NorthstarModules.open(module.id);
        return;
      }
      const status=event.target.closest('.ns-status-module');if(!status||event.target.closest('button,a,input,select,textarea')||status.dataset.status==='markets')return;if(!eventWindow.pinned)close();
      const key=status.dataset.status,registry=window.NorthstarModules?.registry;
      const id=key==='dispatch'?'markets:dispatch':key==='markets'?'markets:IESO':[...(registry?.values()||[])].find(m=>key==='events'?m.el.id==='eventRegister':m.sourceSection==='crew')?.id;
      if(id)window.NorthstarModules.open(id);
    });
    for (const key of ['dispatch','crew']) {
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
    function render(){
      const f=window.NorthstarOverview?.feeds||{},d=f.dispatch?.data||{},market=window.NorthstarMarketModules?.data()||f.market?.data||{},active=Array.isArray(f.staff?.data)?f.staff.data.filter(r=>r.status!=='checked-out'):null;
      const dispatchEl=bar.querySelector('[data-status=dispatch]');
      const orItems=[['10N','tenN'],['10S','tenS'],['30R','thirtyR']].map(([product,key])=>({product,...orStatus(product,key,d)}));
      const reserveKeys=['tenN','tenS','thirtyR'];
      const totalOr=reserveKeys.every(key=>finite(d?.reserveStandby?.[key]))?reserveKeys.reduce((total,key)=>total+Number(d.reserveStandby[key]),0):null;
      orItems.push({product:'Total',state:totalOr===null?'unknown':'standby',text:num(totalOr)});
      const activeOr=orItems.find(item=>item.state==='active');
      const staffCheckedIn=active?.filter(row=>crewWorkerState(row)==='current').length??0;
      paintEventShell();
      if(Array.isArray(f.events?.data?.items) && f.events.data.items.length && !alarmRows.length){
        alarmRows=f.events.data.items;paintAlarms();
      }
      loadAlarms();
      const content={
        dispatch:`<div class="ns-status-title-row"><b class="ns-status-title">Dispatch · APIROQ</b>${activeOr?`<strong class="ns-dispatch-alert" aria-live="polite">OR ACTIVE · ${activeOr.product}</strong>`:''}</div><div class="ns-status-metrics ns-status-metrics-two ns-dispatch-metrics"><span><small>Dispatch</small><strong>${num(d.dispatchMw)}</strong></span><span><small>Output</small><strong>${num(d.outputMw)}</strong></span></div><div class="ns-or-grid" aria-label="Operating reserve status">${orItems.map(item=>`<span class="ns-or-item ns-or-${item.state}"><small>${item.product}</small><strong>${item.text}</strong></span>`).join('')}</div>`,
        markets:`<div class="ns-market-grid">${['IESO','APIROQ'].map(code=>marketNode(code,market.nodes?.[code],market)).join('')}</div>`,
        crew:window.NORTHSTAR_DEMO_HOME?`<button type="button" class="demo-worker-status" data-demo-field-status><span>Worker Status</span><strong>${active===null?'— / —':`${staffCheckedIn} / ${active.length}`}</strong><small>Open full field status →</small></button>`:`<div class="ns-status-title-row"><b class="ns-status-title">Active Workers - ${active===null?'—/—':`${staffCheckedIn}/${active.length}`}</b><small role="status">${esc(crewSaveState)}</small></div><div class="ns-crew-sites${crewEditing()?' is-editing':''}" style="height:${Math.max(192,...Object.values(crewPositions).map(p=>p.y+32))}px" aria-label="WORKERS ON-SITE check-in status">${crewMarkup(active)}</div>`
      };
      for(const [key,value] of Object.entries(content)){const el=bar.querySelector(`[data-status=${key}] .ns-status-content`);if(el.dataset.markup!==value){el.innerHTML=value;el.dataset.markup=value;}}
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
        icon=document.createElement('img');icon.src='northstar-symbol-transparent.png';icon.alt='';icon.width=17;icon.height=17;icon.setAttribute('aria-hidden','true');icon.className='nav-icon northstar-nav-icon';
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
    const orderToolbar=()=>{
      const add=document.querySelector('.overview-add-module');
      if(toolbar&&add){toolbar.append(add);add.textContent='Add Module';add.title='Open the module builder';}
      if(toolbar){
        const order=['.layout-edit-toggle','.layout-reset','.layout-snap-toggle','.layout-save','.layout-style-wrap','.overview-add-module'];
        order.forEach(selector=>{const control=toolbar.querySelector(selector);if(control)toolbar.append(control)});
      }
    };
    orderToolbar();
    if(toolbar&&!document.querySelector('.overview-add-module')){
      const addObserver=new MutationObserver(()=>{if(document.querySelector('.overview-add-module')){orderToolbar();addObserver.disconnect()}});
      addObserver.observe(document.body,{childList:true,subtree:true});
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
    orderToolbar();
    if(toolbar)new ResizeObserver(()=>document.body.style.setProperty('--ns-dock-height',Math.ceil(toolbar.getBoundingClientRect().height)+'px')).observe(toolbar);
  }
  const start=()=>{if(window.northstarStylesReady)window.northstarStylesReady.then(()=>setTimeout(init,0));else setTimeout(init,0);};
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start);else start();
})();
