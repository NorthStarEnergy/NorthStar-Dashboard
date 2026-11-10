(() => {
  'use strict';
  const api = '/api/uwpc/requests/manager';
  const $ = id => document.getElementById(id);
  const esc = value => String(value ?? '').replace(/[&<>"']/g,c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const paths = {outages:'M3 7V5h6l3 3h9v12H3z',home:'M3 10l9-7 9 7 M5 9v11h5v-6h4v6h5V9',new:'M12 4v16 M4 12h16',
    inbox:'M4 4h16l2 13v3H2v-3z M3 14h5l2 3h4l2-3h5',library:'M3 4h5v16H3z M10 4h4v16h-4z M16 5l4-1 3 15-4 1z',
    back:'M19 12H5 M11 6l-6 6 6 6',search:'M16 16l5 5 M18 10a7 7 0 1 1-14 0 7 7 0 0 1 14 0',
    filters:'M3 6h18 M6 12h12 M9 18h6',file:'M6 3h8l4 4v14H6z M14 3v5h4 M9 12h6 M9 16h5',
    info:'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0 M12 11v6 M12 7v1',download:'M12 3v12 M7 10l5 5 5-5 M4 17v4h16v-4',
    left:'M15 5l-7 7 7 7',right:'M9 5l7 7-7 7',arrow:'M5 18L18 5 M7 5h11v11',
    forms:'M4 16v4h4L20 8l-4-4z M13 7l4 4',approvals:'M15 9a3 3 0 1 1-6 0 3 3 0 0 1 6 0 M5 20v-2a7 7 0 0 1 14 0v2 M18 5a3 3 0 0 1 0 6 M20 14q3 1 3 5',
    check:'M12 2l8 3v6c0 5-4 8-8 11-4-3-8-6-8-11V5z M8 11l3 3 5-6',distribution:'M3 10l18-7-6 18-4-7z M11 14L21 3',
    log:'M3 7h5m8 0h5 M8 7l8-5 M3 18h5m8 0h5 M8 18h8',closeout:'M5 21V3 M5 4q4-2 8 0t7 0v10q-4 2-7 0t-8 0'};
  const icon = name => `<svg class="ico" aria-hidden="true" viewBox="0 0 24 24"><path d="${paths[name]}"></path></svg>`;
  const base = '/outage-manager.html';
  const sourceUrl = api + '/library/book';
  const sections = {overview:'Overview', request:'Request', forms:'Forms', documents:'Drawings & documents',
    approvals:'Approvals', distribution:'Final distribution', log:'Switching log', closeout:'Closeout', history:'History & correspondence'};
  function outageUrl(outage,section='overview',id='') {
    const query = new URLSearchParams({section});
    if(outage) query.set('outage',outage);
    if(id) query.set('id',id);
    return '/outage-manager-package.html?'+query;
  }
  const views = [['home','Home'],['new','New'],['outages','Outages'],['library','UWPC library'],['inbox','My reviews']];
  const main=$('main');
  const date = value => value ? new Date(value).toLocaleString('en-CA',{month:'short',day:'numeric',year:'numeric',hour:'2-digit',minute:'2-digit',hour12:false}) : 'Unscheduled';
  const localDay = value => {const d=new Date(value);return Number.isNaN(+d)?'':new Date(+d-d.getTimezoneOffset()*60000).toISOString().slice(0,10);};
  const states = {DRAFT:'Draft',GENERATED:'Prepared',PENDING_SIGNOFF:'In review',CHANGES_REQUESTED:'Correction requested',SIGNED_OFF:'Checked / approved'};
  const priorities = {Monitor:'Normal',Degraded:'Elevated',Critical:'Critical'};
  const opts=(items,current,empty='') => (empty?`<option value="">${esc(empty)}</option>`:'')+items.map(([value,label])=>`<option value="${esc(value)}" ${value===current?'selected':''}>${esc(label)}</option>`).join('');
  let state={}, epoch=0, requestId=0, delayed, libraryData, readerPage=1, readerMode='pdf', readId=0;
  const session=fetchData(api+'/session').catch(()=>null);
  let folderRequest=0;
  // Store only the identity. Resolve the name and access from this operator's current register.
  async function mountFolder(selected=null,section='',rows=[]) {
    const tree=$('outageTree'), request=++folderRequest;
    const user=await session;
    if(!tree?.isConnected || request!==folderRequest)return;
    const key=user?.actor ? 'northstar.outageManager.last.'+user.actor : '';
    let last='';
    try {if(key)last=localStorage.getItem(key)||'';} catch {}
    let row=selected||rows.find(r=>r.id===last);
    if(!row && last) {
      try {row=await fetchData(api+'/detail?id='+encodeURIComponent(last));}
      catch(e){if(![403,404].includes(e.status))return;}
    }
    if(!tree.isConnected || request!==folderRequest)return;
    row ||= rows[0];
    if(!row){tree.replaceChildren();tree.hidden=true;return;}
    try {if(key && row.id!==last)localStorage.setItem(key,row.id);} catch {}
    document.querySelectorAll('[data-outage-row]').forEach(tr=>tr.classList.toggle('selected-outage',tr.dataset.outageRow===row.id));
    if(tree.firstElementChild?.dataset.folder===row.id && !selected)return;
    const doc=selected?new URLSearchParams(location.search).get('id'):'';
    tree.hidden=false;
    tree.innerHTML=`<details class="package-folder" data-folder="${esc(row.id)}" open>
      <summary title="${esc(row.title)}">${icon('outages')}<span>${esc(row.title)}</span></summary>
      <ul class="tree-children">${Object.entries(sections).map(([key,label])=>{
        const id=['overview','request'].includes(key)?'':doc;
        return `<li><a href="${outageUrl(row.id,key,id)}" ${selected && key===section?'aria-current="page"':''}
          title="${esc(key==='overview'?row.title+' · Overview':label)}">${icon('file')}<span>${esc(key==='overview'?row.title:label)}</span></a></li>`;
      }).join('')}</ul></details>`;
  }
  function shell(view,selected=null,section='overview') {
    const navLink = ([key,label]) => `<a href="${base}#${key}" title="${label}" ${view===key?'aria-current="page"':''}>${icon(key)}<span>${label}</span>${key==='inbox'?'<small id="reviewCount" aria-live="polite"></small>':''}</a>`;
    $('shell').innerHTML=`<aside class="rail"><a class="brand" href="${base}" aria-label="Outage Manager home"><svg class="mark" viewBox="0 0 32 36" aria-hidden="true"><path d="M3 26V10l7-4v16zm10 3V9l7-4v20zm10-7V6l7-4v16z" fill="currentColor"/></svg><span>Outage Manager</span></a>
      <button class="mobile-menu" id="menuToggle" aria-controls="packageNav" aria-expanded="false">Menu</button><nav id="packageNav" aria-label="Main menu">${views.map(item=>item[0]==='outages'?
        `${navLink(item)}<div id="outageTree" hidden></div>`:navLink(item)).join('')}</nav>
      <a class="back" href="/northstar-clean.html" aria-label="Return to NorthStar">${icon('back')}<span>NorthStar</span></a></aside>`;
    if(selected || !['home','outages'].includes(view))void mountFolder(selected,section);
    if(view!=='inbox')void refreshInbox().catch(()=>{});
    const menu=$('menuToggle'), nav=menu.nextElementSibling;
    menu.onclick=()=>{const open=menu.getAttribute('aria-expanded')!=='true';
      menu.setAttribute('aria-expanded',String(open));nav.classList.toggle('menu-open',open);};
  }
  function processStrip(row,plan) {
    const review=plan?.packageReview, delivery=plan?.distribution;
    const significant=plan?.reviewTrigger && plan.reviewTrigger!=='routine';
    const phases=[['request','Request'],['forms','Preparation'],['approvals','Team review']];
    if(significant)phases.push(['check','Accuracy check'],['distribution','Final copy']);
    phases.push(['log','Switching'],['closeout','Closeout']);
    const pending=(review?.tasks||[]).filter(t=>!t.signedAt);
    const issues=(plan?.reviewIssues||[]).filter(i=>!i.closedAt);
    const phase=row.phase==='COMPLETED'||row.phase==='CANCELLED'?row.phase:plan?.phase||row.phase;
    const status=plan?.status||row.status;
    let stage='request',message='Prepare the outage package.',target='forms';
    if(phase==='CANCELLED'||phase==='COMPLETED') {
      stage=target='closeout';message=phase==='CANCELLED'?'Outage cancelled.':'Outage closed.';
    } else if(phase==='ACTIVE') {
      stage=target='log';message=plan?.switchLog?'Switching log open.':'Outage in progress.';
    } else if(delivery) {
      stage='distribution';target='log';message='Final copy delivered. Awaiting the start of switching.';
    } else if(review || status==='PENDING_SIGNOFF' || status==='CHANGES_REQUESTED') {
      stage=target='approvals';
      const team=pending.filter(t=>t.role!=='checker');
      if(issues.length)message='Outstanding corrections: '+issues.map(i=>i.actor+' · '+i.comment).join(' / ');
      else if(review && !team.length && pending.length) {
        stage='check';message='Final accuracy check assigned to '+pending[0].account+'.';
      } else if(review)message='Awaiting '+(review.sscLead?team:pending).map(t=>t.account+' ('+(t.site||t.role)+')').join(', ')+'.';
      else if(status==='CHANGES_REQUESTED')message='Changes requested on the current revision.';
      else message='Awaiting '+(plan.review?.operators||[]).filter(name=>!plan.review.decisions.some(d=>d.actor===name)).join(', ')+'.';
    } else if(status==='SIGNED_OFF') {
      stage=significant?'check':'approvals';target=significant?'distribution':'history';message='Checks complete.';
    } else if(plan) {
      stage=target='forms';message='Complete the draft form.';
      if(plan.preparationMode!=='REQUEST' && plan.preparationMode!=='INTAKE') {
        if(!plan.reviewTrigger)message='Select the outage review trigger.';
        else if(significant && !plan.diagramRevision)message='Enter the drawing revision.';
        else if(significant && !plan.sources.some(s=>s.kind==='diagram')){target='documents';message='Attach the drawing for review.';}
        else if(!significant && !plan.generation){target='documents';message='Prepare the proposal for operator review.';}
        else {target='approvals';message=plan.lastReview?'Reissue the edited package for review.':'Assign and route the review.';}
      }
    }
    const pageFor=k=>k==='check'?'approvals':(!significant && plan && ['log','closeout'].includes(k))?'history':k;
    const current=phases.findIndex(([k])=>k===stage);
    const flags=(delivery?.flags||[]).filter(f=>!f.resolvedAt).length;
    const href=k=>outageUrl(row.id,pageFor(k),['request','overview'].includes(k)?'':plan?.id)+(k==='check'?'#accuracy':'');
    const tasks=(review?.tasks||[]).filter(t=>t.role!=='checker');
    const checker=review?.tasks.find(t=>t.role==='checker');
    const ordinary=plan?.review;
    const teamCount=tasks.length || ordinary?.operators?.length || 0;
    const signed=tasks.length?tasks.filter(t=>t.signedAt).length:(ordinary?.decisions||[]).filter(d=>d.decision==='APPROVE').length;
    const recorded={request:true,forms:plan && !['REQUEST','INTAKE'].includes(plan.preparationMode),
      approvals:teamCount?signed===teamCount:status==='SIGNED_OFF',check:Boolean(checker?.signedAt),
      distribution:Boolean(delivery),log:Boolean(plan?.switchLog),closeout:phase==='COMPLETED'};
    const details={
      request:[['Requested by',row.owner],['Site',row.site],['Opened',row.created&&date(row.created)]],
      forms:[['Package',plan?(states[status]||status):'Not prepared'],['Forms',row.documents?.length],['Drawing revision',plan?.diagramRevision]],
      approvals:[['Team reviews',teamCount?`${signed} of ${teamCount} signed`:'No assignments recorded'],['Due',review?.due&&date(review.due)],['Open corrections',issues.length||null]],
      check:[['Checker',checker?.account||'Not assigned'],['Signed',checker?.signedAt&&date(checker.signedAt)]],
      distribution:[['Final copy',delivery?'Distributed':'Awaiting issue'],['Revision',delivery&&review?.number],['Open concerns',delivery?flags:null]],
      log:[['Scheduled start',date(row.start)],['SSC',review?.sscLead||plan?.proposedLeads?.sscLead],
        ['Local manager',review?.localLead||plan?.proposedLeads?.localLead],['Switching log',plan?.switchLog?'Opened':'No opening recorded']],
      closeout:[['Scheduled end',date(row.end)],['Closed',row.closed&&date(row.closed)]]
    };
    return `<nav class="process" aria-label="Outage process"><ol>${phases.map(([key,label],i)=>{
      const active=i===current, done=recorded[key] && (i<current || key==='check' || key==='closeout');
      const state=active && phase==='CANCELLED'?'Cancelled':done?'Complete':active && (issues.length||status==='CHANGES_REQUESTED')?'On hold':
        active?'Current phase':i<current || phase==='CANCELLED'?'Not recorded':'Upcoming';
      const fields=details[key].filter(([,v])=>v!=null && v!=='');
      return `<li data-phase="${key}" class="${active?'current ':''}${done?'passed':''}"><a href="${href(key)}" aria-describedby="phase-tip-${key}" ${active?'aria-current="step"':''}>
        <span class="phase-marker" aria-hidden="true">${icon(key==='request'?'file':key)}${done?'<b>✓</b>':''}</span>${label}</a>
        <div id="phase-tip-${key}" class="phase-tip" role="tooltip" hidden><div class="phase-tip-head"><strong>${label}</strong><span>${state}</span></div>
        ${active?`<p>${esc(message)}</p>`:''}<dl>${fields.map(([k,v])=>`<dt>${k}</dt><dd>${esc(v)}</dd>`).join('')}</dl></div></li>`;
    }).join('')}</ol><div class="process-note"><a href="${href(target)}">${esc(message)}</a>
    ${flags?`<a class="flag-note" href="${href('distribution')}">${flags} open final-copy concern${flags===1?'':'s'}</a>`:''}</div></nav>
    ${significant||plan?.proposedLeads?`<div class="coordination"><span>SSC outage manager <strong>${esc(review?.sscLead||plan?.proposedLeads?.sscLead||'Unassigned')}</strong></span><span>Local outage manager <strong>${esc(review?.localLead||plan?.proposedLeads?.localLead||'Unassigned')}</strong></span></div>`:''}`;
  }
  function bindProcessStrip(host) {
    let open=null, markup='';
    function close(){
      if(open)open.querySelector('.phase-tip').hidden=true;
      open=null;
    }
    function position(){
      if(!open)return;
      const anchor=open.querySelector('a').getBoundingClientRect();
      const track=open.parentElement.getBoundingClientRect();
      if(anchor.right<=track.left || anchor.left>=track.right || anchor.bottom<=0 || anchor.top>=innerHeight){close();return;}
      const tip=open.querySelector('.phase-tip');
      const left=Math.max(6,Math.min(anchor.left+(anchor.width-tip.offsetWidth)/2,innerWidth-tip.offsetWidth-6));
      const above=anchor.bottom+tip.offsetHeight>innerHeight-6 && anchor.top>innerHeight-anchor.bottom;
      tip.style.left=left+'px';
      tip.style.top=(above?Math.max(4,anchor.top-tip.offsetHeight+1):anchor.bottom-1)+'px';
    }
    function show(item){
      if(!item)return;
      if(open!==item)close();
      open=item;open.querySelector('.phase-tip').hidden=false;position();
    }
    host.addEventListener('pointerover',e=>{if(e.pointerType!=='touch')show(e.target.closest('[data-phase]'));});
    host.addEventListener('pointerout',e=>{if(open && !open.contains(e.relatedTarget))close();});
    host.addEventListener('focusin',e=>{if(e.target.matches('[data-phase] > a:focus-visible'))show(e.target.parentElement);});
    host.addEventListener('focusout',e=>{if(open && !open.contains(e.relatedTarget))close();});
    document.addEventListener('keydown',e=>{if(e.key==='Escape')close();});
    document.documentElement.addEventListener('pointerleave',close);
    window.addEventListener('blur',close);
    window.addEventListener('pagehide',close);
    window.addEventListener('resize',position);
    document.addEventListener('scroll',position,true);
    return html=>{
      if(html===markup)return;
      markup=html;
      const active=open?.dataset.phase, focused=document.activeElement.closest('[data-phase]')?.dataset.phase;
      const scroll=host.querySelector('ol')?.scrollLeft||0;
      close();host.innerHTML=html;
      host.querySelector('ol').scrollLeft=scroll;
      if(focused)host.querySelector(`[data-phase="${focused}"] > a`)?.focus({preventScroll:true});
      if(active)show(host.querySelector(`[data-phase="${active}"]`));else close();
    };
  }
  async function loadWorkspace() {
    const query=new URLSearchParams(location.search);
    const section=Object.hasOwn(sections,query.get('section'))?query.get('section'):'overview';
    const docId=query.get('id');
    let id=query.get('outage'),legacy=null;
    if(!id&&docId) {
      legacy=await fetchData('/api/uwpc/requests/'+encodeURIComponent(docId));
      id=legacy.registerOutage||legacy.outageId||legacy.id;
    }
    if(!id)throw Error('Choose an outage from the register.');
    let row;
    try {row=await fetchData(api+'/detail?id='+encodeURIComponent(id));}
    catch(e) {
      if(!legacy||e.status!==404)throw e;
      row={...legacy,sites:legacy.affectedSites||[],packageId:legacy.id,owner:legacy.createdBy,documents:[legacy]};
    }
    if(docId&&!row.documents.some(doc=>doc.id===docId))throw Error('This document does not belong to the selected outage.');
    const packageId=docId||row.packageId;
    shell('',row,section);
    window.addEventListener('pageshow',e=>{if(e.persisted)void mountFolder(row,section);});
    const overview=outageUrl(id);
    const title=section==='overview'?row.title:sections[section];
    document.title=title+(section==='overview'?'':' · '+row.title)+' · Outage Manager';
    const page=$('packagePage');
    page.innerHTML=section==='overview'?head(esc(title),chip(row)):
      `<header class="pagehead breadcrumb"><a class="outage-parent" href="${overview}">${esc(row.title)}</a>${icon('right')}<h1>${esc(title)}</h1></header>`;
    const plan=row.workflow || legacy;
    page.insertAdjacentHTML('beforeend','<div id="processStrip"></div>');
    const render=bindProcessStrip($('processStrip'));
    const draw=record=>render(processStrip(row,record));
    draw(plan);
    let version=plan?.version||0;
    window.addEventListener('outage-record',e=>{if(e.detail.id===row.packageId){version=e.detail.version;draw(e.detail);}});
    async function refreshProcess() {
      if(document.hidden || !row.workflow)return;
      try {
        const latest=await fetchData(api+'/detail?id='+encodeURIComponent(id));
        if(latest.workflow?.version>=version) {
          version=latest.workflow.version;row=latest;draw(latest.workflow);
        }
      } catch { /* Keep the last loaded revision during a connection interruption. */ }
    }
    window.addEventListener('focus',refreshProcess);setInterval(refreshProcess,45000);
    const facts=entries=>`<dl class="facts">${entries.map(([k,v])=>`<dt>${k}</dt><dd>${esc(v||'—')}</dd>`).join('')}</dl>`;
    const sites=[...new Set([row.site,...row.sites].filter(Boolean))].join(', ');
    const timing=[['Start',date(row.start)],['End',row.end&&date(row.end)]];
    if(section==='overview'||section==='request') {
      const fields=section==='overview'?[['Sites',sites],['Equipment',row.asset],...timing,
        ['Required signatures',row.requiredSignatures?`${row.signed} of ${row.requiredSignatures} received`:'No assignments recorded']]:
        [['Outage ID',id],['Requested by',row.owner],['Opened',row.created&&date(row.created)],['Type',row.type],
          ['Priority',priorities[row.severity]||row.severity],['Sites',sites],['Equipment',row.asset],...timing];
      page.insertAdjacentHTML('beforeend',`<section class="panel overview-panel"><h2>Work scope</h2><p>${esc(row.scope||'No scope recorded.')}</p>${facts(fields)}</section>`);
      if(section==='overview')page.insertAdjacentHTML('beforeend',`<section class="panel overview-panel"><h2>Package forms</h2>
        ${row.documents.map(doc=>`<a class="file-line" href="${outageUrl(id,'forms',doc.id)}">${icon('file')}<span>${esc(doc.title)}</span><small>${esc(states[doc.status]||doc.status)}</small></a>`).join('')||'<p>No forms have been attached.</p>'}</section>`);
      return {editable:false};
    }
    if(!packageId) {
      page.insertAdjacentHTML('beforeend','<div class="panel overview-panel"><p>No package has been prepared for this outage.</p></div>');
      if(section==='forms'&&row.type==='Planned'&&row.phase==='FUTURE') {
        page.lastElementChild.insertAdjacentHTML('beforeend','<button class="primary">Prepare outage package</button><p role="status"></p>');
        const button=page.querySelector('button');
        button.onclick=async()=>{button.disabled=true;try{const doc=await fetchData('/api/uwpc/requests',{fromOutage:id});location.assign(outageUrl(id,'forms',doc.id));}
          catch(e){button.nextElementSibling.textContent=e.message;button.disabled=false;}};
      }
      return {editable:false};
    }
    if(row.documents.length>1) {
      page.insertAdjacentHTML('beforeend',`<label class="document-select">Package document <select>${opts(row.documents.map(d=>[d.id,d.title]),packageId)}</select></label>`);
      page.querySelector('select').onchange=e=>location.assign(outageUrl(id,section,e.target.value));
    }
    $('uwpcDesk').hidden=false;$('uwpcDeskStatus').textContent='Loading package…';
    return {editable:true,section,packageId,overview};
  }
  async function fetchData(url,body) {
    const r=await fetch(url,{credentials:'same-origin',cache:'no-store',...(body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{})});
    const data=await r.json().catch(()=>({}));
    if(!r.ok)throw Object.assign(Error(data.error || `Request failed (${r.status})`),{status:r.status});
    return data;
  }
  function errorBox(e){return `<p class="error" role="alert">${esc(e.message)}</p>`;}
  function head(title,action=''){return `<header class="pagehead"><h1>${title}</h1>${action}</header>`;}
  function search(id,placeholder){return `<label class="search">${icon('search')}<input type="search" id="${id}" aria-label="${placeholder}" placeholder="${placeholder}"></label>`;}
  function chip(r){const [text,tone]=r.phase==='COMPLETED'?['Closed','done']:r.phase==='CANCELLED'?['Cancelled','hold']:r.phase==='ACTIVE'?['In progress','active']:
    [states[r.status] || r.status,({SIGNED_OFF:'done',PENDING_SIGNOFF:'review',CHANGES_REQUESTED:'hold'})[r.status]||''];
    return `<span class="chip ${tone}">${esc(text)}</span>`;}
  function regHome(){
    const tabs=[['upcoming','Upcoming'],['active','In progress'],['past','Past']];
    main.innerHTML=`<h1 class="sr-only">Outages</h1><div class="register-toolbar"><div class="register-head"><div class="tabs" aria-label="Outage period">${tabs.map(([id,label])=>`<button data-tab="${id}" aria-pressed="${id===state.tab}">${label}<span class="count" data-count="${id}">–</span></button>`).join('')}</div><a href="#new" class="btn new-link">${icon('new')}New outage</a></div>
      <div class="bar">${search('query','Search outages')}<select id="site" aria-label="Filter by site"><option value="">All sites</option></select><button class="btn" id="toggleFilters" aria-expanded="false">${icon('filters')}Filters</button></div></div>
      <div id="filters" class="filters panel" hidden><div class="fields"><label>Type<select id="type">${opts([['Planned','Planned'],['Unplanned','Unplanned']],'','All types')}</select></label>
      <label>Priority<select id="severity">${opts(Object.entries(priorities),'','All priorities')}</select></label>
      <label>Plan status<select id="status">${opts(Object.entries(states),'','All statuses')}</select></label>
      <label>Start from<input id="from" type="date"></label><label>Through<input id="until" type="date"></label><button class="btn" id="resetFilters">Clear filters</button></div></div>
      <section class="panel"><div id="rows" class="sheet" aria-live="polite"></div><div class="foot"><span id="range"></span><div class="actions"><button class="iconbtn" id="prev" aria-label="Previous page">${icon('left')}</button><button class="iconbtn" id="next" aria-label="Next page">${icon('right')}</button></div></div></section>`;
    main.querySelectorAll('[data-tab]').forEach(b=>b.onclick=()=>{
      state.tab=b.dataset.tab;state.offset=0;state.sort=state.tab==='past'?'closed':'start';state.direction=state.tab==='past'?'desc':'asc';
      main.querySelectorAll('[data-tab]').forEach(el=>el.setAttribute('aria-pressed',String(el===b)));void loadRegister();
    });
    $('toggleFilters').onclick=()=>{$('filters').hidden=!$('filters').hidden;$('toggleFilters').setAttribute('aria-expanded',String(!$('filters').hidden));};
    $('resetFilters').onclick=()=>{for(const key of ['site','type','severity','status','from','until','query'])$(key).value='';state.offset=0;void loadRegister();};
    for(const key of ['site','type','severity','status','from','until'])$(key).onchange=()=>{state.offset=0;void loadRegister();};
    $('query').oninput=()=>{state.offset=0;requestId++;clearTimeout(delayed);delayed=setTimeout(loadRegister,180);};
    $('prev').onclick=()=>{state.offset=Math.max(0,state.offset-30);void loadRegister();};
    $('next').onclick=()=>{state.offset+=30;void loadRegister();};
    void loadRegister();
  }
  async function loadRegister(){
    if(!$('rows'))return;
    const fetchId=++requestId;
    const p=new URLSearchParams(state);
    p.set('q',$('query').value);
    for(const key of ['site','type','severity','status'])p.set(key,$(key).value);
    for(const key of ['from','until'])if($(key).value){const d=new Date($(key).value+'T00:00:00');if(key==='until')d.setDate(d.getDate()+1);p.set(key,d.toISOString());}
    try{
      const d=await fetchData(api+'/register?'+p);
      if(fetchId!==requestId||!$('rows'))return;
      state.offset=d.offset;
      $('site').innerHTML=opts(d.sites.filter(Boolean).map(s=>[s,s]),p.get('site'),'All sites');
      main.querySelectorAll('[data-count]').forEach(el=>el.textContent=d.counts[el.dataset.count]);
      const cols=[['title','Outage'],['site','Site'],[state.tab==='past'?'closed':'start',state.tab==='past'?'Closed':'Start'],['','End'],['severity','Priority'],['status','Status']];
      $('rows').innerHTML=`<table aria-label="Outage register"><thead><tr>${cols.map(([k,l])=>`<th ${k===state.sort?'aria-sort="'+(state.direction==='asc'?'ascending':'descending')+'"':''}>${k?`<button data-sort="${k}">${l} ${k===state.sort?(state.direction==='asc'?'↑':'↓'):'↕'}</button>`:l}</th>`).join('')}</tr></thead><tbody>
        ${d.rows.map(r=>`<tr data-outage-row="${esc(r.id)}"><td><a class="titlebtn" href="${outageUrl(r.id)}" title="${esc(r.title)}">${esc(r.title)}</a></td>
        <td title="${esc(r.sites.join(', '))}">${esc(r.site)}${r.sites.length>1?' +'+(r.sites.length-1):''}</td>
        <td>${state.tab==='past'?(r.closed?esc(date(r.closed)):'—'):esc(date(r.start))}</td><td>${r.end?esc(date(r.end)):'—'}</td>
        <td>${esc(priorities[r.severity]||r.severity)}</td><td>${chip(r)}${r.requiredSignatures?` <small class="mono" title="Required sign-offs received">${r.signed}/${r.requiredSignatures}</small>`:''}</td></tr>`).join('')}</tbody></table>
        ${d.rows.length?'':'<div class="empty">No outages match this view.</div>'}`;
      void mountFolder(null,'',d.rows);
      $('range').textContent=d.total?`${d.offset+1}–${d.offset+d.rows.length} of ${d.total} outages`:'0 outages';
      $('prev').disabled=!d.offset;$('next').disabled=d.offset+d.rows.length>=d.total;
    }catch(e){if(fetchId===requestId&&$('rows'))$('rows').innerHTML=errorBox(e);}
  }
  async function newOutage(stamp){
    main.innerHTML=head('New outage')+`<form id="create" class="formcard panel"><div class="fields">
      <label class="wide">Outage name<input name="title" required maxlength="160" autofocus></label>
      <label>Primary site<input name="site" list="stations" required maxlength="80" autocomplete="off"></label><datalist id="stations"></datalist>
      <label>Equipment<input name="asset" maxlength="160"></label>
      <label>Start<input type="datetime-local" name="start" required></label><label>End<input type="datetime-local" name="end" required></label>
      <label class="wide">Work scope<textarea name="scope" rows="3" required maxlength="4000"></textarea></label>
      <label>Priority<select name="severity">${opts(Object.entries(priorities),'Monitor')}</select></label>
      <label>Review trigger<select name="reviewTrigger" required>${opts(['routine','multi-site','crew dependency','non-routine switching or lockout','manager designation'].map(x=>[x,x[0].toUpperCase()+x.slice(1)]),'','Select trigger')}</select></label>
      <label class="wide">Additional affected sites <textarea name="additional" rows="2" placeholder="One site per line"></textarea></label>
      <label>SSC outage manager<select name="sscLead" aria-label="SSC outage manager"><option value="">Unassigned</option></select></label>
      <label>Local outage manager<select name="localLead" aria-label="Local outage manager"><option value="">Unassigned</option></select></label></div>
      <div class="formfoot"><span role="status" id="saveStatus"></span><a class="btn" href="#home">Cancel</a><button class="primary" type="submit">Create outage</button></div></form>`;
    let token=crypto.randomUUID();
    const form=$('create');
    void session.then(d=>{
      if(!d)throw Error('Cannot load the directory.');
      const roles=d.outageReviewRoles;
      for(const [key,people] of Object.entries({sscLead:roles.operator,localLead:[...new Set([...roles.area,...roles.field])]}))
        form.elements[key].innerHTML=opts(people.map(s=>[s,s]),'','Unassigned');
    }).catch(e=>{if(epoch===stamp)$('saveStatus').textContent='Reviewer directory unavailable: '+e.message;});
    form.addEventListener('input',()=>{token=crypto.randomUUID();});
    form.onsubmit=async e=>{e.preventDefault();const data=Object.fromEntries(new FormData(form));
      for(const k of ['start','end'])data[k]=new Date(data[k]).toISOString();
      if(data.end<=data.start){$('saveStatus').textContent='End must be later than start.';return;}
      data.affectedSites=data.additional.split(/\r?\n/).map(s=>s.trim()).filter(Boolean);delete data.additional;
      data.requestKey=token;const button=form.querySelector('[type=submit]');button.disabled=true;
      $('saveStatus').textContent='Saving…';
      try{const r=await fetchData(api+'/create',data);if(epoch===stamp)location.assign(outageUrl(r.id));}
      catch(err){if(epoch===stamp)$('saveStatus').textContent=err.message;}finally{button.disabled=false;}
    };
    try{const d=await fetchData('/api/sites');if(epoch===stamp)$('stations').innerHTML=d.options.map(s=>`<option value="${esc(s.name||s.label||s.site||s)}"></option>`).join('');}catch{/* Site entry remains available. */}
  }
  let inboxSeq=0;
  async function refreshInbox(){
    const seq=++inboxSeq;
    const d=await fetchData(api+'/inbox');if(seq!==inboxSeq)return;
    const review=window.NorthStarOutageReview({esc,when:date,dateValue:localDay});
    const rows=d.rows.flatMap(r=>{
      const ordinary=JSON.parse(r.ordinary||'null');
      const messages=review.alerts({...r,lastReview:{owner:r.lastOwner},reviewIssues:JSON.parse(r.issues||'[]'),
        packageReview:JSON.parse(r.packageReview||'null'),distribution:JSON.parse(r.distribution||'null')},d.actor);
      if(r.status==='PENDING_SIGNOFF'&&ordinary?.operators.includes(d.actor)&&!ordinary.decisions.some(v=>v.actor===d.actor))messages.push('Operator review requested');
      return messages.length?[`<a class="librow" href="${outageUrl('',messages[0].startsWith('Final copy')?'distribution':'approvals',r.id)}"><strong>${esc(r.title)}</strong><span>${esc(messages.join(' · '))}</span>${icon('right')}</a>`]:[];
    });
    if($('reviewCount'))$('reviewCount').textContent=rows.length||'';
    if($('reviews'))$('reviews').innerHTML=rows.join('')||'<div class="panel empty">You have no outstanding reviews.</div>';
  }
  async function inbox(){
    main.innerHTML=head('My reviews')+'<div id="reviews" class="toolsList" aria-live="polite">Loading…</div>';
    await refreshInbox();
  }
  async function readPage(number,mode){
    const id=++readId;
    readerPage=number;readerMode=mode;
    const host=$('readerHost');if(!host)return;
    $('pageNumber').value=number;$('readPrevious').disabled=number<=1;$('readNext').disabled=number>=libraryData.pages;
    $('readMode').value=mode;
    if(mode==='pdf'){host.innerHTML=`<iframe title="Utility Work Protection Code" src="${sourceUrl}#page=${number}"></iframe>`;return;}
    host.textContent='Loading page…';
    try{const d=await fetchData(api+'/library-page?page='+number);
      if(id===readId&&host.isConnected)host.innerHTML=`<article class="pageText"><h3>PDF page ${number}</h3><p>${esc(d.text.trim() || 'See the original page for its illustration.')}</p></article>`;
    }catch(e){if(id===readId&&host.isConnected)host.innerHTML=errorBox(e);}
  }
  function renderLibrary(d,section){
    const tabs=[['manual','Manual'],['forms','Forms & tags'],['questions','Practice questions']];
    const book=`<div class="document-source"><span><strong>${esc(d.title)}</strong> · ${d.pages} pages · ${esc(d.status.replaceAll('_',' ').toLowerCase())}</span>
      <a href="${sourceUrl}" target="_blank" rel="noopener">${icon('arrow')}Open source PDF</a></div>`;
    main.innerHTML=`<h1 class="sr-only">UWPC library</h1><div class="tabs" aria-label="UWPC library">
      ${tabs.map(([key,label])=>`<button aria-pressed="${section===key}" data-lib="${key}">${label}</button>`).join('')}</div>`;
    if(section==='forms'){main.insertAdjacentHTML('beforeend',`${book}<div class="formsgrid">${d.forms.map(f=>
      `<article class="card formref"><strong>${esc(f.code)}</strong><p>${esc(f.title)}</p><a class="btn" href="${api}/library/${encodeURIComponent(f.id)}" download>${icon('download')}PDF</a>
      <a href="${sourceUrl}#page=${f.pages[0]}" target="_blank" rel="noopener">Source p. ${f.pages[0]}</a></article>`).join('')||'<p>No form index for this edition.</p>'}</div>`);return;}
    if(section==='questions'){main.insertAdjacentHTML('beforeend',`${book}<div class="questions">${d.questions.map(([q,a,cl,p])=>
      `<details class="card"><summary>${esc(q)}</summary><p>${esc(a)}</p><a href="${sourceUrl}#page=${p}" target="_blank" rel="noopener">${esc(cl)} · PDF p. ${p}</a></details>`).join('')||'<p>No questions for this edition.</p>'}</div>`);return;}
    main.insertAdjacentHTML('beforeend',`<div class="libraryTools"><aside class="library-index">${search('bookQuery','Search the manual')}<details class="toc panel" id="manualContents"><summary>Contents</summary><div id="contents"></div></details></aside>
      <div class="reader">${book}<div class="readerBar"><select id="readMode" aria-label="Reading format"><option value="pdf">Source PDF</option><option value="text">Page text</option></select>
      <button class="iconbtn" id="readPrevious" aria-label="Previous manual page">${icon('left')}</button>
      <label>Page <input type="number" id="pageNumber" min="1" max="${d.pages}"> / ${d.pages}</label>
      <button class="iconbtn" id="readNext" aria-label="Next manual page">${icon('right')}</button></div><div id="readerHost"></div></div></div>`);
    $('manualContents').open=innerWidth>820;
    $('readMode').onchange=e=>readPage(readerPage,e.target.value);
    $('readPrevious').onclick=()=>readPage(readerPage-1,readerMode);
    $('readNext').onclick=()=>readPage(readerPage+1,readerMode);
    $('pageNumber').onchange=e=>readPage(Math.max(1,Math.min(d.pages,parseInt(e.target.value,10)||1)),readerMode);
    void readPage(readerPage,readerMode);
    const contents=()=>d.sections.map(([page,label],i)=>{
      const next=d.sections[i+1]?.[0]||d.pages+1;
      return `<details><summary>${esc(label)}</summary><a href="${sourceUrl}#page=${page}" data-page="${page}">Open section · p. ${page}</a>${d.topics.filter(t=>t.page>=page&&t.page<next).map(t=>
        `<a href="${sourceUrl}#page=${t.page}" data-page="${t.page}">${esc(t.title)} · ${t.page}</a>`).join('')}</details>`;
    }).join('');
    $('contents').innerHTML=contents();
    $('bookQuery').oninput=()=>{const q=$('bookQuery').value.trim();if(q)$('manualContents').open=true;clearTimeout(delayed);const seq=++requestId;
      if(!q){$('contents').innerHTML=contents();return;}delayed=setTimeout(async()=>{try{const data=await fetchData(api+'/library?q='+encodeURIComponent(q));
        if(seq!==requestId||!$('contents'))return;$('contents').innerHTML=data.hits.map(h=>`<a href="${sourceUrl}#page=${Number(h.page)}" data-page="${Number(h.page)}"><strong>PDF p. ${Number(h.page)}</strong> · ${esc(h.text)}</a>`).join('')||'<p>No matching passages.</p>';
      }catch(e){if(seq===requestId&&$('contents'))$('contents').innerHTML=errorBox(e);}},220);};
  }
  async function route(){
    const stamp=++epoch;requestId++;clearTimeout(delayed);
    const [part,sub]=location.hash.slice(1).split('/');const view=views.some(([k])=>k===part)?part:'home';
    shell(view);document.title=(view==='home'?'Outages':views.find(([k])=>k===view)[1])+' · Outage Manager';
    try{
      if(view==='home'||view==='outages'){state={tab:'upcoming',offset:0,sort:'start',direction:'asc'};regHome();}
      else if(view==='new')await newOutage(stamp);
      else if(view==='inbox')await inbox(stamp);
      else{main.innerHTML=head('UWPC library')+'<p role="status">Loading manual…</p>';const d=libraryData||await fetchData(api+'/library');
        if(epoch===stamp){libraryData=d;renderLibrary(d,['forms','questions'].includes(sub)?sub:'manual');}}
    }catch(e){if(epoch===stamp)main.innerHTML=head(views.find(([k])=>k===view)[1])+errorBox(e);}
  }
  function updateAlerts(){if(!document.hidden)void refreshInbox().catch(()=>{});}
  window.addEventListener('focus',updateAlerts);setInterval(updateAlerts,45000);
  window.addEventListener('outage-record',updateAlerts);
  if(document.body.hasAttribute('data-manager-package')){
    window.outageWorkspace=loadWorkspace().catch(e=>{if(!$('packageNav'))shell('');main.innerHTML=head('Outage package')+errorBox(e);return null;});
    return;
  }
  document.addEventListener('click',async e=>{
    const row=e.target.closest('[data-outage-row]');
    if(row && !e.target.closest('a,button') && !getSelection()?.toString()) {
      location.assign(row.querySelector('a').href);return;
    }
    const el=e.target.closest('[data-sort],[data-page],[data-lib]');if(!el)return;
    if(el.dataset.sort){state.direction=state.sort===el.dataset.sort&&state.direction==='asc'?'desc':'asc';state.sort=el.dataset.sort;state.offset=0;await loadRegister();}
    else if(el.dataset.lib){location.hash='library/'+el.dataset.lib;}
    else if(el.dataset.page){e.preventDefault();if(innerWidth<=820)$('manualContents').open=false;await readPage(Number(el.dataset.page),readerMode);}
  });
  window.addEventListener('hashchange',route);void route();
  window.addEventListener('pageshow',e=>{
    if(!e.persisted)return;
    if($('rows'))void loadRegister();else void mountFolder();
  });
})();
