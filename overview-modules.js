/* Read-only compact projections. Original feed anchors and form controls remain intact. */
(() => {
  const feeds = {}, pending = new Map();
  const escape = v => String(v ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const number = v => v !== null && v !== undefined && v !== '' && Number.isFinite(Number(v));
  const fmt = (v,suffix='',digits=0) => number(v) ? Number(v).toLocaleString(undefined,{maximumFractionDigits:digits,minimumFractionDigits:digits})+suffix : '—';
  const money = v => number(v) ? '$'+fmt(v,'',2) : '—';
  const time = value => value && !Number.isNaN(new Date(value).valueOf()) ? new Date(value).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'}) : '';
  const metric = (label,value) => `<div class="ov-metric"><span>${escape(label)}</span><strong>${String(value).endsWith(' MW')?escape(String(value).slice(0,-3))+' <em class="ov-unit">MW</em>':escape(value)}</strong></div>`;
  const rows = value => Array.isArray(value)?value:[];
  const empty = (message,detail) => `<div class="ov-empty"><span class="ov-empty-icon" aria-hidden="true">–</span><strong>${escape(message)}</strong><small>${escape(detail)}</small></div>`;
  function trend(values, label) {
    const finite=values.filter(number).map(Number);
    if(finite.length<2)return `<div class="ov-trend ov-trend-empty">${escape(label)} unavailable</div>`;
    const low=Math.min(...finite),span=Math.max(...finite)-low || 1;
    let drawing=false;
    const path=values.map((value,i)=>{
      if(!number(value)){drawing=false;return '';}
      const command=drawing?'L':'M';drawing=true;
      return command+(4+i*292/Math.max(1,values.length-1)).toFixed(1)+','+(52-(Number(value)-low)*44).toFixed(1);
    }).join(' ');
    return `<figure class="ov-trend"><figcaption>${escape(label)}</figcaption><svg viewBox="0 0 300 60" preserveAspectRatio="none" role="img" aria-label="${escape(label)}"><path d="${path}" fill="none" stroke="currentColor" stroke-width="2" vector-effect="non-scaling-stroke"/></svg></figure>`;
  }
  function update(key, data, error=false, context='') {
    if(key==='events' && /[?&](cursor|q|type|source|severity|status|site|from|to)=/.test(context))return;
    const prior=feeds[key];
    const valid={staff:Array.isArray(data),alarms:Array.isArray(data),weather:Array.isArray(data?.stations),events:Array.isArray(data?.items),chat:Array.isArray(data?.messages),scada:Array.isArray(data?.readings),market:!!data?.nodes,dispatch:!!data && typeof data==='object'};
    if(valid[key]===false)error=true;
    if(key==='chat' && !error && context.includes('since=') && !data.messages?.length && prior?.data) data=prior.data;
    feeds[key]={data:error?prior?.data:data,checked:error?prior?.checked:Date.now(),error,context};
    window.NorthstarModules?.refresh();
    window.dispatchEvent(new Event('northstar:feed-update'));
    refreshStatus();
  }
  const routes={'/api/market-prices':'market','/api/weather':'weather','/api/checkins':'staff','/api/dispatch/apiroq':'dispatch','/api/scada':'scada','/api/alerts':'alarms','/api/chat/messages':'chat'};
  // Observe successful reads through the existing authenticated fetch wrapper.
  // Never consume the caller's response, rewrite a request, or change its failure.
  const fetchBefore=window.fetch.bind(window);
  window.fetch=async function(input,options){
    let key='',url;
    try {url=new URL(typeof input==='string'?input:input.url,location.href);if(url.origin===location.origin && (options?.method || input?.method || 'GET').toUpperCase()==='GET')key=routes[url.pathname] || (url.pathname==='/api/events/register'&&url.searchParams.get('limit')==='5'?'events':'');}catch{}
    const sequence=key?(pending.get(key)||0)+1:0;if(key)pending.set(key,sequence);
    try {
      const response=await fetchBefore(input,options);
      if(key)response.clone().json().then(data=>{if(pending.get(key)===sequence)update(key,data,!response.ok,url.search);}).catch(()=>{if(pending.get(key)===sequence)update(key,null,true);});
      return response;
    }catch(error){if(key&&pending.get(key)===sequence)update(key,null,true);throw error;}
  };
  function issue(key){
    const f=feeds[key];
    if(!f?.checked)return 'Source unavailable';
    const timeout={weather:600000,market:600000}[key] || 120000;
    if(f.error || f.data?.stale || Date.now()-f.checked>timeout)return 'Stale';
    if(key==='dispatch' && (f.data?.healthy===false || !number(f.data?.outputMw) || !number(f.data?.dispatchMw)))return 'Telemetry unavailable';
    if(key==='scada'){
      const statuses=rows(f.data?.feeds).map(feed=>feed.status);
      if(!statuses.length)return 'No feeds configured';
      if(statuses.some(status=>status!=='Current'))return 'Feed attention required';
    }
    return '';
  }
  function freshness(key){
    const f=feeds[key];
    if(!f?.checked)return 'Source unavailable';
    const problem=issue(key);
    return (problem?problem+' · last received ':'Received ')+time(f.checked)+(f.data?.simulated?' · simulated':'');
  }
  function render(id, el){
    let key='',body='';
    if(id.startsWith('weather:')){
      key='weather';const name=id.slice(8),station=feeds.weather?.data?.stations?.find(s=>s.name===name),c=station?.current || {},h=station?.hourly || {};
      const index=Math.max(0,(h.time||[]).findIndex(t=>new Date(t).valueOf()>=Date.now())),temperature=c.temperature_2m ?? h.temperature_2m?.[index],probability=c.precipitation_probability ?? h.precipitation_probability?.[index],code=c.weather_code ?? h.weather_code?.[index];
      const ccode=Number(code),condition=!number(code)?'Conditions unavailable':[95,96,99].includes(ccode)?'Thunderstorms':[71,73,75,77,85,86].includes(ccode)?'Snow':[61,63,65,66,67,80,81,82].includes(ccode)?'Rain':[51,53,55,56,57].includes(ccode)?'Drizzle':[45,48].includes(ccode)?'Fog':[2,3].includes(ccode)?'Cloudy':[0,1].includes(ccode)?'Clear':'Conditions unavailable';
      const weatherIcon=({'Clear':'☀️','Cloudy':ccode===2?'🌤️':'☁️','Rain':'🌧️','Drizzle':'🌦️','Snow':'🌨️','Fog':'🌫️','Thunderstorms':'⛈️'})[condition] || '—';
      body=`<div class="ov-weather-main"><div class="ov-weather-value">${escape(fmt(temperature,'°'))}</div><span class="ov-weather-art" role="img" aria-label="${escape(condition)}">${weatherIcon}</span></div><div class="ov-weather-condition">${escape(condition)}</div><div class="ov-secondary">Precipitation ${escape(fmt(probability,'%'))}</div>`;
      body+=trend((h.temperature_2m || []).slice(index,index+24),'Temperature forecast');
      if(!station)return {key,body,footer:'Station unavailable'};
    } else if(id==='markets:dispatch'){
      key='dispatch';const d=feeds.dispatch?.data || {};
      body=`<div class="ov-metrics">${metric('Output',fmt(d.outputMw,' MW',1))}${metric('Dispatch',fmt(d.dispatchMw,' MW',1))}</div><div class="ov-secondary">Difference ${escape(fmt(d.deltaMw,' MW',1))} · OR ${escape(d.orActivation ?? 'unavailable')}</div>`;
    } else if(id.startsWith('markets:') && id!=='markets:comparison'){
      key='market';const code=id.slice(8),data=window.NorthstarMarketModules?.data() || feeds.market?.data,n=data?.nodes?.[code] || {};
      body=`<div class="ov-metrics">${metric('Real-time',money(n.rt))}${metric('Day-ahead',money(n.da))}</div><div class="ov-secondary">${code==='IESO'?'Demand':'Transfer'} ${escape(fmt(n.operations?.rtTransfer,' MW'))} · ${code==='IESO'?'Forecast':'Schedule'} ${escape(fmt(n.operations?.dayAhead,' MW'))}</div>`;
      body+=trend(rows(n.history).slice(-48).map(point=>point.value),'Real-time price history');
      if(code==='APIROQ')body+=`<div class="ov-expanded">Operating reserve · 10S ${escape(money(n.reserve?.tenS))} · 10N ${escape(money(n.reserve?.tenN))} · 30R ${escape(money(n.reserve?.thirtyR))}</div>`;
    } else if(el.id==='overviewStaffSummary' || el.id==='overviewFieldTracker'){
      key='staff';const f=feeds.staff,active=rows(f?.data).filter(r=>r.status!=='checked-out');
      body=`<div class="ov-metrics ov-three">${metric('Active',f?.checked?String(active.length):'—')}${metric('Overdue',f?.checked?String(active.filter(r=>r.overdue).length):'—')}${metric('Needs help',f?.checked?String(active.filter(r=>r.needsHelp&&r.helpState!=='resolved').length):'—')}</div>`;
      if(el.id==='overviewFieldTracker')body+=`<div class="ov-secondary">Open tracker for location and worker detail</div>`;
    } else if(el.id==='overviewEventsSummary'){
      key='events';const f=feeds.events,events=rows(f?.data?.items);
      body=events.length?`<div class="ov-events">${events.slice(0,4).map((e,i)=>`<a class="${i>1?'ov-secondary':''}" href="event-detail.html?id=${encodeURIComponent(e.eventId)}"><time>${escape(time(e.occurredAt)||'—')}</time><span>${escape(e.summary || e.eventType)}<small>${escape(e.site || e.source || 'Recorded event')}</small></span><b class="ov-severity-${escape(['critical','warning'].includes(e.severity)?e.severity:'info')}">${escape(e.severity || '')}</b></a>`).join('')}</div>`:empty(f?.checked?'No recorded events':'Events unavailable',f?.checked?'New activity will appear here.':'Open Events to check the connection.');
    } else if(el.id==='overviewGeneratingStations'){
      key='scada';const d=feeds.scada?.data,readings=rows(d?.readings),sites=[...new Set(readings.map(r=>r.siteCode).filter(Boolean))];
      const configured=rows(d?.feeds),current=configured.filter(feed=>feed.status==='Current').length;
      body=`<div class="ov-metrics">${metric('Sites with records',d?String(sites.length):'—')}${metric('Current feeds',d?current+' / '+configured.length:'—')}</div><div class="ov-secondary">${escape(d?(configured.length?configured.map(feed=>feed.status || 'Unknown').join(' · '):'No feeds configured'):'Station data unavailable')}</div>`;
    } else if(el.id==='overviewChatSummary'){
      key='chat';const f=feeds.chat,messages=rows(f?.data?.messages),last=messages.at(-1);
      body=last?`<p class="ov-chat-message">${escape(last.body || last.text || last.content || '')}</p><div class="ov-secondary">${escape(last.senderName || last.author || last.source || 'Recorded message')} · ${escape(time(last.createdAt))}</div>`:empty(f?.checked?'No messages yet':'Chat unavailable',f?.checked?'Open Chat to join the conversation.':'Open Chat to check the connection.');
    } else return null;
    return {key,body,footer:freshness(key)};
  }
  function present(m,el,p){
    if(m.id.startsWith('weather:')){
      // Preserve the pre-redesign weatherCard/forecast renderer and its live anchors.
      el.classList.remove('ov-managed');el.classList.add('ns-weather-original');
      el.dataset.ovKind='weather-original';
      el.querySelector(':scope > .ov-summary')?.remove();
      el.style.removeProperty('padding');el.style.removeProperty('border-top-color');
      if(!p.customOnly){
        [...el.children].filter(child=>child.matches('header,.weather-icon,.weather-current,.weather-extra-line,.periods')).forEach(child=>child.style.removeProperty('display'));
      }
      if(!el.dataset.weatherForecastBound){
        el.dataset.weatherForecastBound='1';
        const place=()=>{const rect=el.getBoundingClientRect(),width=Math.min(520,innerWidth-24);el.style.setProperty('--weather-forecast-left',Math.max(12,Math.min(rect.left,innerWidth-width-12))-rect.left+'px');};
        el.addEventListener('pointerenter',place);el.addEventListener('focusin',place);
      }
      const heading=el.querySelector('header .station-title strong');
      if(heading && p.title)heading.textContent=p.title;
      el.tabIndex=0;el.setAttribute('role','group');el.setAttribute('aria-label',p.title || m.title);
      return;
    }
    const content=render(m.id,el);if(!content)return;
    el.classList.add('ov-managed');el.dataset.ovKind=m.id.startsWith('weather:')?'weather':el.id==='overviewEventsSummary'?'events':'metric';
    el.tabIndex=0;el.setAttribute('role','group');
    const caption=el.querySelector('.ns-module-caption');if(caption){caption.title=caption.textContent;el.setAttribute('aria-label',caption.textContent);}
    el.style.setProperty('padding','var(--ov-frame-padding,'+(p.density==='compact' || m.id.startsWith('weather:')?'12px':'16px')+')','important');
    el.style.setProperty('border-top-color',p.accent || 'var(--line)','important');
    let summary=el.querySelector(':scope > .ov-summary');
    if(!summary){summary=document.createElement('div');summary.className='ov-summary';el.append(summary);}
    const problem=issue(content.key);el.dataset.ovState=problem?'attention':'received';
    const emptyUnavailable=content.body.includes('class="ov-empty"') && problem==='Source unavailable';
    const markup=`<div class="ov-summary-body">${content.body}</div><footer ${emptyUnavailable?'hidden ':''}class="ov-freshness${problem?' stale':''}" title="${escape(content.footer)}"><span class="ov-source-dot" aria-hidden="true"></span>${escape(content.footer)}</footer>`;
    if(summary.dataset.render!==markup){summary.innerHTML=markup;summary.dataset.render=markup;}
    summary.hidden=!!p.customOnly;
    // Isolate the compact renderer from inherited per-card grid/position rules.
    [...el.children].forEach(child=>{
      if(!child.matches('.ns-module-content,.ns-open-module,.ns-edit-module,.ov-summary,.canvas-move-handle,.canvas-resize-handle,.canvas-select-handle'))child.style.setProperty('display','none','important');
    });
    const open=el.querySelector(':scope > .ns-open-module');if(open){if(open.textContent!=='↗')open.textContent='↗';open.setAttribute('aria-label','Open '+(p.title || m.title));open.title='Open full module';}
    const edit=el.querySelector(':scope > .ns-edit-module');if(edit){if(edit.textContent!=='✎')edit.textContent='✎';edit.setAttribute('aria-label','Edit '+(p.title || m.title));edit.title='Edit module';}
  }
  function refreshStatus(){
    const node=document.getElementById('overviewSourceStatus');
    if(node){const keys=['staff','dispatch','market','weather','events','scada','chat'],missing=keys.filter(k=>issue(k));const value=missing.length?missing.length+(missing.length===1?' source needs attention':' sources need attention'):'Sources received';if(node.textContent!==value)node.textContent=value;node.dataset.state=missing.length?'attention':'received';node.title=missing.map(k=>({staff:'Field staff',dispatch:'APIROQ dispatch',market:'Markets',weather:'Weather',events:'Events',scada:'Generating stations',chat:'Chat'}[k])+': '+issue(k)).join('\n');node.setAttribute('aria-label',value+(missing.length?'. '+node.title:''));}
    const detail=document.getElementById('dispatchDetail');
    if(detail){const d=feeds.dispatch?.data || {},markup=`<h2>APIROQ dispatch</h2><div class="ov-metrics">${metric('Output',fmt(d.outputMw,' MW',1))}${metric('Dispatch',fmt(d.dispatchMw,' MW',1))}${metric('Difference',fmt(d.deltaMw,' MW',1))}</div><p>${escape(freshness('dispatch'))}</p><p>${escape(d.source || 'Awaiting telemetry')}${d.simulated?' · SIMULATED':''}</p><p>OR standby: ${escape(fmt(d.reserveStandby?.tenS,' MW'))} 10S / ${escape(fmt(d.reserveStandby?.tenN,' MW'))} 10N / ${escape(fmt(d.reserveStandby?.thirtyR,' MW'))} 30R</p>`;if(detail.dataset.snapshot!==markup){detail.innerHTML=markup;detail.dataset.snapshot=markup;}}
    window.renderAlarmBar?.();
  }
  function init(){
    const root=document.getElementById('overviewModules');if(!root)return;
    for(const [id,title] of [['overviewStaffSummary','Field staff'],['overviewEventsSummary','Events'],['overviewChatSummary','Chat']]){
      const card=document.createElement('article');card.id=id;card.className='panel';card.dataset.overviewModule='';card.dataset.moduleId=id;card.setAttribute('aria-label',title);root.append(card);
    }
    const detail=document.createElement('article');detail.id='dispatchDetail';detail.className='panel';document.getElementById('markets')?.append(detail);
    const strip=document.createElement('div');strip.id='overviewStatusStrip';strip.innerHTML='<strong>Overview</strong><span id="overviewSourceStatus" role="status">Connecting to sources…</span>';document.querySelector('main')?.prepend(strip);
    refreshStatus();
    const refreshEvents=()=>{if(!document.hidden)fetch('/api/events/register?limit=5').catch(()=>{});};refreshEvents();setInterval(refreshEvents,30000);setInterval(()=>{refreshStatus();window.NorthstarModules?.refresh();},30000);
  }
  window.NorthstarOverview={feeds,present,update,number};
  document.addEventListener('DOMContentLoaded',init);
})();
