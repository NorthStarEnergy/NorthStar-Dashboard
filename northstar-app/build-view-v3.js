/* V3 is a reversible presentation over v1's data and operational workflows. */
(() => {
  'use strict';
  const params=new URLSearchParams(location.search);
  if(params.has('nsModuleWindow')||params.get('nsStatusWindow')==='1')return;
  const $=(s,h=document)=>h.querySelector(s), $$=(s,h=document)=>[...h.querySelectorAll(s)];
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const num=(v,n=1)=>typeof v==='number'&&Number.isFinite(v)?v.toFixed(n):'—';
  const KEY='northstarBuildViewV3';
  let active=false,section='overview',workspace,menu,legacySet,legacyGet,bypass=false,scheduled=0;
  const controllers=[],pages=new Map();
  const feed=key=>window.NorthstarOverview?.feeds?.[key];
  const groups={
    overview:[],crew:[],logbook:[],markets:[['Market chart','chart'],['Alarms','markets:alarms']],
    operations:[['Stations','operations:sites'],['Dispatch','dispatch'],['Spill','operations:spill'],['Tasks','operations:tasks'],['Research','operations:research']],
    outages:[['Current outages','outages:current'],['UWPC Builder','outages:uwpc'],['Archive','outages:incident-archive']],
    switching:[['UWPC','outages:uwpc'],['Training examples','uwpc-examples'],['SCADA','scada:scada-module-0']],
    tools:[['Schematic builder','tools:schematic-builder'],['Data connections','tools:data-connections'],['Data workspace','tools:data-workspace']],
  };
  function navNative(id){bypass=true;try{$('#sideNav [data-tab="'+CSS.escape(id)+'"]')?.click();}finally{bypass=false;}}
  function page(id,title){
    if(pages.has(id))return pages.get(id);
    const el=document.createElement('article');el.className='bv3-page';el.dataset.v3Page=id;el.hidden=true;
    if(title){const h=document.createElement('h1');h.textContent=title;el.append(h);}
    workspace.append(el);pages.set(id,el);return el;
  }
  function surface(kind){
    document.body.dataset.v3Surface=kind;
    workspace.hidden=kind!=='custom';
    pages.forEach(p=>p.hidden=true);
    controllers.forEach(c=>c.deactivate?.());
    window.NorthstarBuildV3Dispatch?.deactivate();
  }
  function showPage(id){navNative(section);surface('custom');const p=pages.get(id);if(p)p.hidden=false;return p;}
  function available(item){
    const id=item[1];
    if(id.includes(':'))return window.NorthstarModules.canOpen(id);
    return id!=='uwpc-examples'||!window.NORTHSTAR_PLATFORM_DEMO;
  }
  const choices=()=>[...(groups[section]||[]),...(section==='tools'&&window.NORTHSTAR_PLATFORM_DEMO?[['UWPC','outages:uwpc']]:[])].filter(available);
  function drawMenu(selected=''){
    menu.replaceChildren();menu.hidden=!active||section==='weather'||section==='assistant';
    choices().forEach(([label,id])=>{
      const b=document.createElement('button');b.type='button';b.textContent=label;b.dataset.v3Destination=id;
      b.classList.toggle('active',id===selected);b.setAttribute('aria-current',id===selected?'page':'false');menu.append(b);
    });
    const anchor=$('#sideNav [data-tab="'+CSS.escape(section)+'"]');if(anchor&&menu.previousElementSibling!==anchor)anchor.after(menu);
    $$('#sideNav [data-tab]').forEach(b=>b.classList.toggle('active',b.dataset.tab===section));
  }
  function openSource(id){
    if(!window.NorthstarModules?.canOpen(id))return;
    surface('source');
    window.NorthstarModules?.open(id);drawMenu(id);decorateRows();
  }
  function destination(id){
    if(!available(['',id]))return;
    if(id==='chart'){const p=showPage(id);renderMarket();}
    else if(id==='dispatch'){const p=showPage(id);window.NorthstarBuildV3Dispatch?.mount(p);window.NorthstarBuildV3Dispatch?.activate();}
    else if(id==='uwpc-examples'){const p=showPage(id);window.NorthstarBuildV3Uwpc?.mount?.(p);}
    else openSource(id);
    drawMenu(id);
  }
  function go(id){
    if(!active||(window.NORTHSTAR_PLATFORM_DEMO&&$('#sideNav [data-tab="'+CSS.escape(id)+'"]')?.hidden))return;section=id;document.body.dataset.v3Section=id;
    const agentMenu=$('#assistantWorkspace .ai-assistant-sidebar');
    if(agentMenu?.matches(':popover-open'))agentMenu.hidePopover();
    if(id==='assistant')document.body.style.setProperty('--bv3-rail-width',($('.app>aside')?.getBoundingClientRect().width||148)+'px');
    document.body.classList.toggle('bv3-agent',id==='assistant');
    if(id==='overview'){
      navNative('overview');surface('overview');overviewEvents?.activate();
    }else if(id==='crew'){openSource('crew:field-roster');}
    else if(id==='logbook'){showPage('events');fullEvents?.activate();}
    else if(id==='markets')destination('chart');
    else if(id==='operations')openSource('operations:sites');
    else if(id==='weather'||id==='assistant'){surface('source');navNative(id);if(id==='assistant'&&agentMenu){agentMenu.setAttribute('popover','manual');agentMenu.showPopover();}}
    else if(groups[id]?.length){destination(groups[id][0][1]);}
    else{surface('source');navNative(id);}
    drawMenu(id==='markets'?'chart':id==='operations'?'operations:sites':groups[id]?.[0]?.[1]||'');
    if(id!=='weather')history.replaceState(null,'','#'+id);
    schedule();
  }
  function fitOverview(){
    if(!active||section!=='overview')return;
    const root=$('#overviewModules');
    const mainTop=$(".app>main").getBoundingClientRect().top+scrollY;
    const available=Math.max(400,Math.min(680,innerHeight-Math.max(0,mainTop)-24));
    root.style.setProperty('--bv3-content-height',available+'px');
    const cards=$$('#overviewGeneratingStations .gs-card'),ids=new Set(cards.map(card=>card.dataset.moduleId));
    // Same five geographic columns as v1's arrangeRightOfStaff in module-layout.js.
    const groups=[['twin-falls','iroquois-falls','iroquois-falls-230-kv','island-falls'],['old-woman-falls','white-otter-rapids','camp-three-rapids','big-beaver-falls'],['calm-lake','sturgeon-falls','fort-frances','fort-frances-ts'],['kenora','norman','okikendawt-gs'],['aiyers-1','aiyers-2','bird-gs','cogent','cameron']].map(group=>group.map(id=>'site:'+id).filter(id=>ids.has(id)));
    const places=new Map(groups.flatMap((group,column)=>group.map((id,row)=>[id,[column+1,row+1]])));
    let extra=0;
    cards.forEach(card=>{
      const place=places.get(card.dataset.moduleId)||[(extra%5)+1,Math.max(...groups.map(group=>group.length),0)+1+Math.floor(extra++/5)];
      card.dataset.v3StationColumn=String(place[0]);card.dataset.v3StationRow=String(place[1]);
    });
  }
  let marketReady=false;
  function renderMarket(){
    if(!active||section!=='markets')return;
    const host=$('[data-v3-chart]',pages.get('chart'));
    const data=feed('market')?.data||window.NorthstarMarketModules?.data?.();
    if(!host||!data||!window.NorthstarMarketTrends){$('[data-v3-market-status]',pages.get('chart')).textContent='Waiting for market data…';return;}
    $('[data-v3-market-status]',pages.get('chart')).textContent=feed('market')?.error?'Feed unavailable — showing the last received values.':'';
    window.NorthstarMarketTrends.mount(host,data,'APIROQ',async()=>{const r=await fetch('/api/market-prices',{cache:'no-store'});if(!r.ok)throw Error('Market feed unavailable');const d=await r.json();window.NorthstarOverview?.update('market',d);renderMarket();},marketReady?{identity:'v3-market'}:{identity:'v3-market',kinds:['rt','da','forward','rtForecast']});
    if(!marketReady){
      const ranges=$('[data-setting="range"]',host);
      ranges.insertAdjacentHTML('beforeend','<option value="next24">Next 24 hours</option>');ranges.value='24';ranges.dispatchEvent(new Event('change',{bubbles:true}));
      const advanced=document.createElement('details');advanced.className='bv3-market-advanced';advanced.innerHTML='<summary>Series &amp; data</summary>';
      for(const selector of ['.mt-selectors','.mt-table-wrap','.mt-readings','.mt-point-actions','.mt-help']){const el=$(selector,host);if(el)advanced.append(el);}
      host.append(advanced);marketReady=true;
    }
  }
  const rowSelector='.gs-operations-row,.spill-history tbody tr,.mt-data tbody tr,.event-row,.outage-row,.scada-row,.oc-event-row,.event-item:not(a)';
  function detail(row){
    let dialog=$('#bv3RecordDetail');if(!dialog){dialog=document.createElement('dialog');dialog.id='bv3RecordDetail';dialog.className='bv3-record-detail';document.body.append(dialog);}
    const table=row.closest('table');
    const headings=table?$$('thead th',table).map(x=>x.textContent):[];
    const cells=table?[...row.children].map((cell,i)=>[headings[i]||'Field '+(i+1),cell.textContent.trim()]):[...row.children].filter(c=>!c.matches('button,a')).map(c=>[c.tagName==='TIME'?'Time':c.tagName==='HEADER'?'Record':c.tagName==='STRONG'?'Summary':'Details',c.textContent.trim()]);
    dialog.innerHTML='<header><h2>Record details</h2><button type="button" aria-label="Close record details">×</button></header><dl>'+cells.map(([k,v])=>'<dt>'+esc(k)+'</dt><dd>'+esc(v)+'</dd>').join('')+'</dl>';
    const actions=document.createElement('footer');actions.className='bv3-record-actions';
    $$('a,button',row).forEach(control=>{
      const copy=control.cloneNode(true);copy.removeAttribute('id');
      if(control.tagName==='BUTTON')copy.onclick=()=>{
        const identity=[...control.attributes].find(a=>a.name.startsWith('data-'));
        const current=identity?$$("["+identity.name+"]").find(el=>el.getAttribute(identity.name)===identity.value&&!el.closest('dialog')):control;
        if(current?.isConnected){current.click();dialog.close();}
      };
      actions.append(copy);
    });
    if(actions.children.length)dialog.append(actions);
    $('button',dialog).onclick=()=>dialog.close();dialog.showModal();
  }
  function decorateRows(){
    if(!active)return;
    $$(rowSelector).filter(r=>!r.closest('#weather,#nsStatusBar,dialog')).forEach(row=>{
      if(row.dataset.v3Detail)return;row.dataset.v3Detail='1';row.tabIndex=0;row.setAttribute('aria-label','Open full record: '+row.textContent.trim().slice(0,100));
      const open=e=>{if(!active||e.target.closest('button,a,input,select,textarea'))return;if(e.type==='keydown'&&!['Enter',' '].includes(e.key))return;e.preventDefault();const a=$('a[href*="event-detail"]',row);if(a&&!row.classList.contains('outage-item'))a.click();else detail(row);};
      row.addEventListener('click',open);row.addEventListener('keydown',open);
    });
  }
  function schedule(){if(scheduled)return;scheduled=requestAnimationFrame(()=>{scheduled=0;if(!active)return;fitOverview();renderMarket();decorateRows();});}
  function set(view,{sync=false}={}){
    if(view==='v1'||view==='v2'){try{localStorage.removeItem(KEY);}catch{}const url=new URL('northstar-v1.html',location.href);url.searchParams.set('buildView',view);url.hash='overview';location.assign(url);return;}
    const next=view==='v3';if(next===active&&next){go('overview');return;}
    if(!sync)legacySet(next?'v1':view);active=next;
    document.body.classList.toggle('ns-build-v3',active);
    if(!sync)try{localStorage.setItem(KEY,active?'v3':'');}catch{}
    if(active)go('overview');else{workspace.hidden=true;menu.hidden=true;controllers.forEach(c=>c.deactivate?.());window.NorthstarBuildV3Dispatch?.deactivate();const am=$('#assistantWorkspace .ai-assistant-sidebar');if(am?.matches(':popover-open'))am.hidePopover();am?.removeAttribute('popover');document.body.classList.remove('bv3-agent');delete document.body.dataset.v3Surface;delete document.body.dataset.v3Section;navNative('overview');}
    window.dispatchEvent(new CustomEvent('northstar:build-view-change',{detail:{view:active?'v3':legacyGet()}}));
  }
  let overviewEvents,fullEvents;
  async function init(){
    await Promise.all([window.northstarStylesReady,window.northstarOperatorSession,window.NorthStarSites?.ready]);
    if(!window.NorthStarBuildView||!window.NorthstarModules){setTimeout(init,60);return;}
    legacySet=window.NorthStarBuildView.set;legacyGet=window.NorthStarBuildView.get;
    workspace=document.createElement('div');workspace.id='buildViewV3Workspace';workspace.hidden=true;$('main').append(workspace);
    menu=document.createElement('div');menu.id='buildViewV3Menu';menu.hidden=true;$('#sideNav').append(menu);
    const eventFeed=document.createElement('section');eventFeed.id='buildViewV3OverviewEvents';eventFeed.className='panel';$('#overviewModules').append(eventFeed);
    const events=page('events'),chart=page('chart','Market chart');
    chart.innerHTML+='<p data-v3-market-status role="status"></p><div data-v3-chart></div>';
    page('dispatch');page('uwpc-examples');
    const outageEntry=$('#outageForm')?.closest('.panel');if(outageEntry){outageEntry.classList.add('bv3-outage-entry');const add=document.createElement('button');add.className='bv3-outage-add';add.textContent='Add outage';add.type='button';add.setAttribute('aria-expanded','false');add.onclick=()=>{const on=outageEntry.classList.toggle('bv3-entry-open');add.setAttribute('aria-expanded',String(on));add.textContent=on?'Close form':'Add outage';};$('.outage-register-head')?.append(add);}
    overviewEvents=window.NorthStarV3Data?.mountEvents(eventFeed,{compact:true});
    fullEvents=window.NorthStarV3Data?.mountEvents(events,{compact:false});
    controllers.push(...[overviewEvents,fullEvents].filter(Boolean));controllers.forEach(c=>c.deactivate?.());
    window.NorthStarBuildView={...window.NorthStarBuildView,get:()=>active?'v3':legacyGet(),set};
    const button=document.createElement('button');button.type='button';button.dataset.buildView='v3';button.textContent='v3';button.setAttribute('aria-pressed','false');$('#nsBuildViewOptions')?.append(button);
    if(!$('#nsBuildViewOptions')){const label=document.createElement('label');label.className='bv3-build-picker';label.innerHTML='Build view <select aria-label="Build view"><option value="v1">v1</option><option value="v2">v2</option><option value="v3">v3</option></select>';$('.app>aside').append(label);$('select',label).onchange=e=>set(e.target.value);window.addEventListener('northstar:build-view-change',()=>{$('select',label).value=window.NorthStarBuildView.get();});}
    document.addEventListener('click',event=>{
      if(!active||bypass)return;
      const nav=event.target.closest('#sideNav [data-tab]');
      if(nav){event.preventDefault();event.stopImmediatePropagation();go(nav.dataset.tab);return;}
      const dest=event.target.closest('[data-v3-destination]');if(dest){event.preventDefault();event.stopImmediatePropagation();destination(dest.dataset.v3Destination);return;}
      if(event.target.closest('[data-ai-back]')){event.preventDefault();event.stopImmediatePropagation();go('overview');}
    },true);
    window.addEventListener('northstar:feed-update',schedule);
    window.addEventListener('resize',schedule);
    window.addEventListener('northstar:site-page-open',()=>{if(active){section='operations';document.body.dataset.v3Section=section;surface('source');drawMenu('operations:sites');}});
    window.addEventListener('northstar:sites-display-change',schedule);
    window.addEventListener('storage',e=>{if(e.key===KEY&&((e.newValue==='v3')!==active))set(e.newValue==='v3'?'v3':legacyGet(),{sync:true});});
    const observer=new MutationObserver(()=>{if(active)requestAnimationFrame(decorateRows);});observer.observe($('main'),{childList:true,subtree:true});
    let chosen=false;try{chosen=localStorage.getItem(KEY)==='v3';}catch{}
    if(new URLSearchParams(location.search).get('buildView')==='v3')chosen=true;
    if(chosen)set('v3');
    window.NorthStarBuildV3={go,destination,refresh:schedule};
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>init());else init();
})();
