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
    const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    const num=(v,d=1)=>v!=null&&Number.isFinite(Number(v))?Number(v).toFixed(d):'—';
    const money=v=>v!=null&&Number.isFinite(Number(v))?'$'+Number(v).toFixed(2):'—';
    const bar=document.createElement('div');bar.id='nsStatusBar';bar.setAttribute('aria-label','Operations status');
    bar.innerHTML=['events','dispatch','markets','crew'].map(key=>`<section class="ns-status-module" data-status="${key}"><div class="ns-status-content"></div><button class="ns-status-dogear" type="button" aria-label="Open full ${key}" title="Open full ${key}"></button></section>`).join('');
    document.body.append(bar);document.body.classList.add('ns-has-status');document.querySelector('main').classList.add('ns-persistent-status');
    const popup=document.createElement('section');popup.id='nsStatusEvents';popup.hidden=true;popup.setAttribute('aria-label','Detailed event log');
    popup.innerHTML='<header><strong>EVENT LOG</strong><button type="button" data-close aria-label="Close event preview">×</button></header><div class="ns-status-log" tabindex="0"></div><footer><span role="status"></span><button type="button" data-more hidden>Load older events</button></footer>';document.body.append(popup);
    const events=bar.querySelector('[data-status=events]');let hoverTimer,closeTimer,loading=false,cursor=null,rows=[],lastLoaded=0;
    const close=()=>{clearTimeout(hoverTimer);clearTimeout(closeTimer);popup.hidden=true;events.querySelector('button[data-preview]')?.setAttribute('aria-expanded','false');};
    function position(){
      const aside=document.querySelector('.app>aside'),left=aside?Math.max(0,aside.getBoundingClientRect().right):0;
      bar.style.left=left+'px';document.body.style.setProperty('--ns-status-height',bar.offsetHeight+'px');
      popup.style.left=Math.max(8,left+8)+'px';popup.style.top=bar.getBoundingClientRect().bottom+'px';popup.style.maxWidth=Math.max(180,innerWidth-left-16)+'px';
    }
    function paintRows(){popup.querySelector('.ns-status-log').innerHTML=rows.map(e=>`<article><time>${esc(new Date(e.occurredAt).toLocaleString())}</time><strong>${esc(e.summary||e.eventType||'Event')}</strong><p>${esc(e.description||e.message||e.payload?.details||e.payload?.description||'')}</p><small>${esc([e.site,e.source,e.actorId,e.severity,e.status].filter(Boolean).join(' · '))}</small><a href="event-detail.html?id=${encodeURIComponent(e.eventId)}">Open event report ↗</a></article>`).join('')||'<p>No recorded events.</p>';popup.querySelector('[data-more]').hidden=!cursor;}
    async function load(older=false){
      if(loading)return;loading=true;const message=popup.querySelector('footer span'),more=popup.querySelector('[data-more]');more.disabled=true;message.textContent='Loading…';
      try{const params=new URLSearchParams({limit:'50'});if(older&&cursor)params.set('cursor',cursor);
        const response=await fetch('/api/events/register?'+params,{cache:'no-store'});if(!response.ok)throw Error('Event service unavailable');
        const data=await response.json();if(!Array.isArray(data.items))throw Error('Invalid event response');
        rows=older?[...rows,...data.items.filter(e=>!rows.some(old=>old.eventId===e.eventId))]:data.items;cursor=data.nextCursor||null;lastLoaded=Date.now();paintRows();message.textContent=rows.length+' events shown';
      }catch{message.textContent=rows.length?'Refresh failed · previous events retained':'Event log unavailable · reopen to retry';}finally{loading=false;more.disabled=false;}
    }
    function open(){clearTimeout(hoverTimer);clearTimeout(closeTimer);position();popup.hidden=false;events.querySelector('button[data-preview]')?.setAttribute('aria-expanded','true');if(Date.now()-lastLoaded>30000)load();}
    events.addEventListener('pointerenter',()=>{clearTimeout(closeTimer);hoverTimer=setTimeout(open,500);});
    const leave=()=>{clearTimeout(hoverTimer);closeTimer=setTimeout(()=>{if(!popup.contains(document.activeElement)&&!events.contains(document.activeElement))close();},180);};
    events.addEventListener('pointerleave',leave);popup.addEventListener('pointerenter',()=>clearTimeout(closeTimer));popup.addEventListener('pointerleave',leave);
    popup.querySelector('[data-close]').onclick=close;popup.querySelector('[data-more]').onclick=()=>load(true);
    document.addEventListener('keydown',event=>{if(event.key==='Escape')close();});
    document.addEventListener('pointerdown',event=>{if(!popup.contains(event.target)&&!events.contains(event.target))close();});
    bar.addEventListener('click',event=>{
      if(event.target.closest('[data-preview]')){popup.hidden?open():close();return;}
      const dogear=event.target.closest('.ns-status-dogear');if(!dogear)return;close();
      const key=dogear.parentElement.dataset.status,registry=window.NorthstarModules?.registry;
      const id=key==='dispatch'?'markets:dispatch':key==='markets'?'markets:IESO':[...(registry?.values()||[])].find(m=>key==='events'?m.el.id==='eventRegister':m.sourceSection==='crew')?.id;
      if(id)window.NorthstarModules.open(id);
    });
    function render(){
      const f=window.NorthstarOverview?.feeds||{},latest=f.events?.data?.items?.[0],d=f.dispatch?.data||{},market=window.NorthstarMarketModules?.data()||f.market?.data||{},active=Array.isArray(f.staff?.data)?f.staff.data.filter(r=>r.status!=='checked-out'):null;
      const content={
        events:`<button type="button" data-preview aria-controls="nsStatusEvents" aria-expanded="${!popup.hidden}"><b>EVENT LOG</b><span>${esc(latest?.summary|| (f.events?.checked?'No recorded events':'Events unavailable'))}</span><small>${esc((f.events?.error?'Stale · ':'')+(latest?.site||latest?.source||'Hover to preview'))}</small></button>`,
        dispatch:`<b>DISPATCH</b><span>Output <strong>${num(d.outputMw)}</strong> · Target <strong>${num(d.dispatchMw)}</strong> MW</span><small>${d.simulated?'Simulated · ':''}${f.dispatch?.error?'Stale':d.healthy===false?'Telemetry unavailable':f.dispatch?.checked?'Latest telemetry':'Unavailable'}</small>`,
        markets:`<b>MARKET PRICING <small>RT / DAY-AHEAD</small></b><span>IESO <strong>${money(market.nodes?.IESO?.rt)}</strong> / ${money(market.nodes?.IESO?.da)}</span><span>APIROQ <strong>${money(market.nodes?.APIROQ?.rt)}</strong> / ${money(market.nodes?.APIROQ?.da)}${f.market?.error?' · Stale':''}</span>`,
        crew:`<b>CREW STATUS</b><span><strong>${active?active.length:'—'}</strong> active · <strong>${active?active.filter(r=>r.overdue).length:'—'}</strong> overdue</span><small>${active?active.filter(r=>r.needsHelp&&r.helpState!=='resolved').length:'—'} need help${f.staff?.error?' · Stale':''}</small>`
      };
      for(const [key,value] of Object.entries(content)){const el=bar.querySelector(`[data-status=${key}] .ns-status-content`);if(el.dataset.markup!==value){el.innerHTML=value;el.dataset.markup=value;}}
      position();
    }
    window.addEventListener('northstar:feed-update',render);window.addEventListener('resize',position);new ResizeObserver(position).observe(document.querySelector('.app>aside'));render();
  }
  function init(){
    const nav=document.getElementById('sideNav');if(!nav)return;
    statusBar();
    window.dispatchEvent(new Event('northstar:status-ready'));
    const enhance=()=>nav.querySelectorAll('button[data-tab]').forEach(button=>{
      if(button.dataset.chromeReady)return;
      button.dataset.chromeReady='true';
      const [label,path]=items[button.dataset.tab] || [button.textContent.trim(),items.modules[1]];
      [...button.childNodes].filter(node=>node.nodeType===3).forEach(node=>node.remove());
      const icon=document.createElementNS('http://www.w3.org/2000/svg','svg');icon.setAttribute('viewBox','0 0 24 24');icon.setAttribute('width','17');icon.setAttribute('height','17');icon.setAttribute('fill','none');icon.setAttribute('stroke','currentColor');icon.setAttribute('aria-hidden','true');icon.classList.add('nav-icon');
      const line=document.createElementNS('http://www.w3.org/2000/svg','path');line.setAttribute('d',path);icon.append(line);
      const text=document.createElement('span');text.className='nav-label';text.textContent=label;
      button.prepend(icon);button.append(text);button.title=label;button.setAttribute('aria-label',label);
    });
    enhance();new MutationObserver(enhance).observe(nav,{childList:true});
    const toolbar=document.querySelector('.layout-toolbar'),add=document.querySelector('.overview-add-module');
    if(toolbar&&add){toolbar.prepend(add);add.textContent='+ Add module';}
    if(toolbar)new ResizeObserver(()=>document.body.style.setProperty('--ns-dock-height',Math.ceil(toolbar.getBoundingClientRect().height)+'px')).observe(toolbar);
  }
  const start=()=>{if(window.northstarStylesReady)window.northstarStylesReady.then(()=>setTimeout(init,0));else setTimeout(init,0);};
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start);else start();
})();
