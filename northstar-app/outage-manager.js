(() => {
  'use strict';
  const visitor = document.body.hasAttribute('data-outage-visitor');
  const mount = visitor ? '/outage-manager' : '';
  const api = mount + '/api/uwpc/requests/manager';
  const $ = id => document.getElementById(id);
  const esc = value => String(value ?? '').replace(/[&<>"']/g,c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const paths = {outages:'M3 7V5h6l3 3h9v12H3z',home:'M3 10l9-7 9 7 M5 9v11h5v-6h4v6h5V9',new:'M12 4v16 M4 12h16',
    bell:'M5 16c2-2 2-3 2-7a5 5 0 0 1 10 0c0 4 0 5 2 7l1 1H4z M10 20q2 2 4 0',library:'M3 4h5v16H3z M10 4h4v16h-4z M16 5l4-1 3 15-4 1z',
    back:'M19 12H5 M11 6l-6 6 6 6',search:'M16 16l5 5 M18 10a7 7 0 1 1-14 0 7 7 0 0 1 14 0',
    filters:'M3 6h18 M6 12h12 M9 18h6',file:'M6 3h8l4 4v14H6z M14 3v5h4 M9 12h6 M9 16h5',
    info:'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0 M12 11v6 M12 7v1',download:'M12 3v12 M7 10l5 5 5-5 M4 17v4h16v-4',
    left:'M15 5l-7 7 7 7',right:'M9 5l7 7-7 7',arrow:'M5 18L18 5 M7 5h11v11',
    forms:'M4 16v4h4L20 8l-4-4z M13 7l4 4',approvals:'M15 9a3 3 0 1 1-6 0 3 3 0 0 1 6 0 M5 20v-2a7 7 0 0 1 14 0v2 M18 5a3 3 0 0 1 0 6 M20 14q3 1 3 5',
    check:'M12 2l8 3v6c0 5-4 8-8 11-4-3-8-6-8-11V5z M8 11l3 3 5-6',distribution:'M3 10l18-7-6 18-4-7z M11 14L21 3',
    log:'M3 7h5m8 0h5 M8 7l8-5 M3 18h5m8 0h5 M8 18h8',closeout:'M5 21V3 M5 4q4-2 8 0t7 0v10q-4 2-7 0t-8 0',
    fullscreen:'M9 4H4v5 M15 4h5v5 M20 15v5h-5 M9 20H4v-5',restore:'M4 9h5V4 M15 4v5h5 M20 15h-5v5 M9 20v-5H4',
    reports:'M4 3h11l5 5v13H4z M14 3v6h6 M8 17v-3 M12 17v-6 M16 17v-4'};
  const icon = name => `<svg class="ico" aria-hidden="true" viewBox="0 0 24 24"><path d="${paths[name]}"></path></svg>`;
  const base = visitor ? mount+'/' : '/outage-manager.html';
  const sourceUrl = api + '/library/book';
  const sections = {overview:'Overview', request:'Request', forms:'Forms', documents:'Drawings & documents',
    approvals:'Approvals', distribution:'Final distribution', log:'Switching log', closeout:'Closeout', history:'History & correspondence',events:'Event log'};
  function outageUrl(outage,section='overview',id='') {
    const query = new URLSearchParams({section});
    if(outage) query.set('outage',outage);
    if(id) query.set('id',id);
    return mount+'/outage-manager-package.html?'+query;
  }
  const menuViews = [['home','Home'],['outages','Outages'],['library','UWPC'],['reports','Reports'],['inbox','Inbox']];
  const titles = {...Object.fromEntries(menuViews),new:'New outage'};
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
    const badge='<b class="inbox-badge" aria-hidden="true" hidden>!</b>';
    const navLink = ([key,label]) => `<a href="${base}#${key}" title="${label}" ${key==='inbox'?'id="inboxLink"':''} ${view===key?'aria-current="page"':''}>${icon(key==='inbox'?'bell':key)}<span>${label}</span>${key==='inbox'?badge:''}</a>`;
    $('shell').innerHTML=`<aside class="rail"><header class="rail-head"><a class="brand" href="${base}" aria-label="Outage Manager home">Outage Manager</a>
      <a class="new-outage" href="${base}#new" title="Create an outage" ${view==='new'?'aria-current="page"':''}>${icon('new')}New</a>
      </header>
      <button class="mobile-menu" id="menuToggle" aria-controls="packageNav" aria-expanded="false">Menu ${badge}</button><nav id="packageNav" aria-label="Main menu">${menuViews.map(item=>item[0]==='outages'?
        `${navLink(item)}<div id="outageTree" hidden></div>`:navLink(item)).join('')}</nav>
      ${visitor ? `<form class="back" method="post" action="/outage-manager/exit"><span>${esc(document.body.dataset.outageVisitor)}</span><button class="btn">Sign out</button></form>` : `<a class="back" href="/northstar-clean.html" aria-label="Return to NorthStar">${icon('back')}<span>NorthStar</span></a>`}</aside>`;
    if(selected || !['home','outages','reports'].includes(view))void mountFolder(selected,section);
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
      legacy=await fetchData(mount+'/api/uwpc/requests/'+encodeURIComponent(docId));
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
    const item=query.get('inboxItem');
    if(item)void fetchData(api+'/inbox/open',{key:item}).then(updateAlerts).catch(()=>{});
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
    if(section==='events'){
      page.insertAdjacentHTML('beforeend','<div class="report-picker"><button class="btn" id="refreshEvents">Refresh events</button><span id="eventTime"></span></div><div id="eventTable" aria-live="polite"></div>');
      const button=$('refreshEvents');
      button.onclick=async()=>{
        button.disabled=true;
        try{
          const report=await fetchData(api+'/reports?id='+encodeURIComponent(id));
          $('eventTime').textContent='As of '+reportTime(report.asOf);
          $('eventTable').innerHTML=eventTable(report.events);
        }catch(e){$('eventTime').textContent='';$('eventTable').innerHTML=errorBox(e);}
        finally{button.disabled=false;}
      };
      await button.onclick();
      return {editable:false};
    }
    if(section==='overview'||section==='request') {
      const fields=section==='overview'?[['Sites',sites],['Equipment',row.asset],...timing,
        ['Required signatures',row.requiredSignatures?`${row.signed} of ${row.requiredSignatures} received`:'No assignments recorded']]:
        [['Outage ID',id],['Requested by',row.owner],['Opened',row.created&&date(row.created)],['Type',row.type],
          ['Priority',priorities[row.severity]||row.severity],['Sites',sites],['Equipment',row.asset],...timing];
      page.insertAdjacentHTML('beforeend',`<section class="panel overview-panel"><h2>Work scope</h2><p>${esc(row.scope||'No scope recorded.')}</p>${facts(fields)}</section>`);
      if(section==='overview')page.insertAdjacentHTML('beforeend',`<section class="panel overview-panel"><h2>Package forms</h2>
        ${row.documents.map(doc=>`<a class="file-line" href="${outageUrl(id,'forms',doc.id)}">${icon('file')}<span>${esc(doc.title)}</span><small>${esc(states[doc.status]||doc.status)}</small></a>`).join('')||'<p>No forms have been attached.</p>'}</section>`);
      if(section==='overview') {
        page.insertAdjacentHTML('beforeend','<details class="advanced panel"><summary>Advanced settings</summary><form id="tagPerson" class="fields"><label>Tag a person<select name="recipient" required><option value="">Choose an operator</option></select></label><label>Note<input name="tagNote" required maxlength="500"></label><div><button class="btn">Send tag</button> <span role="status"></span></div></form></details>');
        const form=$('tagPerson'),status=form.querySelector('[role=status]');
        const directory=await session;
        form.elements.recipient.innerHTML=opts((directory?.operators||[]).map(n=>[n,n]),'','Choose an operator');
        if(!directory)status.textContent='Operator directory unavailable.';
        form.onsubmit=async e=>{e.preventDefault();const btn=form.querySelector('button');btn.disabled=true;
          try{await fetchData(api+'/tag',{outage:id,recipient:form.elements.recipient.value,note:form.elements.tagNote.value});
            status.textContent='Tag sent to '+form.elements.recipient.value+'.';form.reset();updateAlerts();}
          catch(err){status.textContent=err.message;}finally{btn.disabled=false;}};
      }
      return {editable:false};
    }
    if(!packageId) {
      page.insertAdjacentHTML('beforeend','<div class="panel overview-panel"><p>No package has been prepared for this outage.</p></div>');
      if(section==='forms'&&row.type==='Planned'&&row.phase==='FUTURE') {
        page.lastElementChild.insertAdjacentHTML('beforeend','<button class="primary">Prepare outage package</button><p role="status"></p>');
        const button=page.querySelector('button');
        button.onclick=async()=>{button.disabled=true;try{const doc=await fetchData(mount+'/api/uwpc/requests',{fromOutage:id});location.assign(outageUrl(id,'forms',doc.id));}
          catch(e){button.nextElementSibling.textContent=e.message;button.disabled=false;}};
      }
      return {editable:false};
    }
    if(row.documents.length>1) {
      page.insertAdjacentHTML('beforeend',`<label class="document-select">Package document <select>${opts(row.documents.map(d=>[d.id,d.title]),packageId)}</select></label>`);
      page.querySelector('select').onchange=e=>location.assign(outageUrl(id,section,e.target.value));
    }
    $('uwpcDesk').hidden=false;$('uwpcDeskStatus').textContent='Loading package…';
    return {editable:true,section,packageId,overview,outageId:id,inheritedSites:packageId!==row.packageId?[row.site,...row.sites]:[]};
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
    main.innerHTML=`<h1 class="sr-only">Outages</h1><div class="register-toolbar"><div class="register-head"><div class="tabs" aria-label="Outage period">${tabs.map(([id,label])=>`<button data-tab="${id}" aria-pressed="${id===state.tab}">${label}<span class="count" data-count="${id}">–</span></button>`).join('')}</div></div>
      <div class="bar">${search('query','Search outages')}<button class="btn" id="toggleFilters" aria-controls="filters" aria-expanded="false">${icon('filters')}Advanced settings</button></div></div>
      <div id="filters" class="filters panel" hidden><div class="fields"><label>Area<select id="registerArea" aria-label="Filter by area" data-help="Show outages affecting any site in this operating area."><option value="">All areas</option></select></label><label>Site<select id="site" aria-label="Filter by site"><option value="">All sites</option></select></label><label>Type<select id="type">${opts([['Planned','Planned'],['Unplanned','Unplanned']],'','All types')}</select></label>
      <label>Priority<select id="severity">${opts(Object.entries(priorities),'','All priorities')}</select></label>
      <label>Plan status<select id="status">${opts(Object.entries(states),'','All statuses')}</select></label>
      <label>Start from<input id="from" type="date"></label><label>Through<input id="until" type="date"></label><button class="btn" id="resetFilters">Clear filters</button></div></div>
      <section class="panel"><div id="rows" class="sheet" aria-live="polite"></div><div class="foot"><span id="range"></span><div class="actions"><button class="iconbtn" id="prev" aria-label="Previous page">${icon('left')}</button><button class="iconbtn" id="next" aria-label="Next page">${icon('right')}</button></div></div></section>`;
    main.querySelectorAll('[data-tab]').forEach(b=>b.onclick=()=>{
      state.tab=b.dataset.tab;state.offset=0;state.sort=state.tab==='past'?'closed':'start';state.direction=state.tab==='past'?'desc':'asc';
      main.querySelectorAll('[data-tab]').forEach(el=>el.setAttribute('aria-pressed',String(el===b)));void loadRegister();
    });
    $('toggleFilters').onclick=()=>{$('filters').hidden=!$('filters').hidden;$('toggleFilters').setAttribute('aria-expanded',String(!$('filters').hidden));};
    $('resetFilters').onclick=()=>{for(const key of ['registerArea','site','type','severity','status','from','until','query'])$(key).value='';state.offset=0;void loadRegister();};
    for(const key of ['registerArea','site','type','severity','status','from','until'])$(key).onchange=()=>{state.offset=0;void loadRegister();};
    $('query').oninput=()=>{state.offset=0;requestId++;clearTimeout(delayed);delayed=setTimeout(loadRegister,180);};
    $('prev').onclick=()=>{state.offset=Math.max(0,state.offset-30);void loadRegister();};
    $('next').onclick=()=>{state.offset+=30;void loadRegister();};
    void loadRegister();
  }
  async function loadRegister(){
    if(!$('rows'))return;
    const fetchId=++requestId;
    const p=new URLSearchParams(state);
    p.set('q',$('query').value);p.set('area',$('registerArea').value);
    for(const key of ['site','type','severity','status'])p.set(key,$(key).value);
    for(const key of ['from','until'])if($(key).value){const d=new Date($(key).value+'T00:00:00');if(key==='until')d.setDate(d.getDate()+1);p.set(key,d.toISOString());}
    try{
      const d=await fetchData(api+'/register?'+p);
      if(fetchId!==requestId||!$('rows'))return;
      state.offset=d.offset;
      $('site').innerHTML=opts(d.sites.filter(Boolean).map(s=>[s,s]),p.get('site'),'All sites');
      $('registerArea').innerHTML=opts(d.areas.map(area=>[area,area]),p.get('area'),'All areas');
      const filters=['area','site','type','severity','status','from','until'].filter(key=>p.get(key)).length;
      $('toggleFilters').innerHTML=icon('filters')+'Advanced settings'+(filters?` · ${filters} active`:'');
      main.querySelectorAll('[data-count]').forEach(el=>el.textContent=d.counts[el.dataset.count]);
      const cols=[['title','Outage'],['site','Site'],['area','Area'],[state.tab==='past'?'closed':'start',state.tab==='past'?'Closed':'Start'],['','End'],['severity','Priority'],['status','Status']];
      $('rows').innerHTML=`<table aria-label="Outage register"><thead><tr>${cols.map(([k,l])=>`<th ${k===state.sort?'aria-sort="'+(state.direction==='asc'?'ascending':'descending')+'"':''}>${k?`<button data-sort="${k}">${l} ${k===state.sort?(state.direction==='asc'?'↑':'↓'):'↕'}</button>`:l}</th>`).join('')}</tr></thead><tbody>
        ${d.rows.map(r=>`<tr data-outage-row="${esc(r.id)}"><td><a class="titlebtn" href="${outageUrl(r.id)}" title="${esc(r.title)}">${esc(r.title)}</a></td>
        <td title="${esc(r.sites.join(', '))}">${esc(r.site)}${r.sites.length>1?' +'+(r.sites.length-1):''}</td>
        <td>${esc(r.areas.join(' · '))}</td><td>${state.tab==='past'?(r.closed?esc(date(r.closed)):'—'):esc(date(r.start))}</td><td>${r.end?esc(date(r.end)):'—'}</td>
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
      <label>Review trigger<select name="reviewTrigger" required>${opts(['routine','multi-site','crew dependency','non-routine switching or lockout','manager designation'].map(x=>[x,x[0].toUpperCase()+x.slice(1)]),'','Select trigger')}</select></label>
      </div><details class="advanced"><summary>Advanced settings</summary><div class="fields">
      <label>Priority<select name="severity">${opts(Object.entries(priorities),'Monitor')}</select></label>
      <label class="wide">Additional affected sites <textarea name="additional" rows="2" placeholder="One site per line"></textarea></label>
      <label>SSC outage manager<select name="sscLead" aria-label="SSC outage manager"><option value="">Unassigned</option></select></label>
      <label>Local outage manager<select name="localLead" aria-label="Local outage manager"><option value="">Unassigned</option></select></label></div></details>
      <div class="formfoot"><span role="status" id="saveStatus"></span><a class="btn" href="#home">Cancel</a><button class="primary" type="submit">Create outage</button></div></form>`;
    let token=crypto.randomUUID();
    const form=$('create');
    form.elements.reviewTrigger.onchange=()=>{if(form.elements.reviewTrigger.value==='multi-site'){
      form.querySelector('details').open=true;form.elements.additional.focus();}};
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
    try{const d=await fetchData(mount+'/api/sites');if(epoch===stamp)$('stations').innerHTML=d.options.map(s=>`<option value="${esc(s.name||s.label||s.site||s)}"></option>`).join('');}catch{/* Site entry remains available. */}
  }
  let inboxSeq=0;
  async function refreshInbox(){
    const seq=++inboxSeq;
    const d=await fetchData(api+'/inbox');if(seq!==inboxSeq)return;
    const count=d.items.filter(item=>item.unread).length;
    document.querySelectorAll('.inbox-badge').forEach(el=>{el.hidden=!count;});
    const label=count ? `Inbox · ${count} unread` : 'Inbox';
    if($('inboxLink')){$('inboxLink').ariaLabel=label;$('inboxLink').title=label;}
    if($('menuToggle'))$('menuToggle').ariaLabel=count?'Menu · unread Inbox items':'Menu';
    if($('reviews')){
      const html=d.items.map(item=>{
        const href=outageUrl(item.outage,item.section,item.document)+'&inboxItem='+encodeURIComponent(item.key);
        return `<a class="librow" href="${esc(href)}"><strong>${esc(item.title)}</strong><span>${esc(item.message)}</span>${item.unread?'<b class="inbox-badge" aria-label="Unread">!</b>':icon('right')}</a>`;
      }).join('')||'<div class="panel empty">Your Inbox is empty.</div>';
      if($('reviews')._rendered!==html){$('reviews').innerHTML=html;$('reviews')._rendered=html;}
    }
  }
  async function inbox(){
    main.innerHTML=head(titles.inbox)+'<div id="reviews" class="toolsList" aria-live="polite">Loading…</div>';
    await refreshInbox();
  }
  async function readPage(number,mode){
    const id=++readId;
    readerPage=number;readerMode=mode;
    const host=$('readerHost');if(!host)return;
    $('pageNumber').value=number;$('readPrevious').disabled=number<=1;$('readNext').disabled=number>=libraryData.pages;
    $('readMode').value=mode;
    if(mode==='pdf'){host.innerHTML=`<iframe title="Utility Work Protection Code" src="${sourceUrl}#page=${number}&toolbar=0"></iframe>`;return;}
    host.textContent='Loading page…';
    try{const d=await fetchData(api+'/library-page?page='+number);
      if(id===readId&&host.isConnected)host.innerHTML=`<article class="pageText"><h3>PDF page ${number}</h3><p>${esc(d.text.trim() || 'See the original page for its illustration.')}</p></article>`;
    }catch(e){if(id===readId&&host.isConnected)host.innerHTML=errorBox(e);}
  }
  function bindReaderLayout(){
    const reader=$('libraryWorkspace'), toggle=$('indexToggle'), full=$('readerFull');
    function buttonLabel(button,label,graphic){
      button.setAttribute('aria-label',label);button.title=label;button.innerHTML=icon(graphic);
    }
    function setCollapsed(collapsed){
      reader.classList.toggle('index-collapsed',collapsed);
      $('indexPanel').hidden=collapsed;
      toggle.setAttribute('aria-expanded',String(!collapsed));
      buttonLabel(toggle,collapsed?'Show manual menu':'Collapse manual menu',collapsed?'right':'left');
    }
    let collapsed=innerWidth<=820;
    try {const saved=sessionStorage.getItem('uwpcIndexCollapsed');if(saved!==null)collapsed=saved==='true';} catch {}
    setCollapsed(collapsed);
    toggle.onclick=()=>{
      const next=!reader.classList.contains('index-collapsed');setCollapsed(next);
      try {sessionStorage.setItem('uwpcIndexCollapsed',String(next));} catch {}
    };
    function syncFull(){
      const active=document.fullscreenElement===reader || reader.classList.contains('reader-expanded');
      full.setAttribute('aria-pressed',String(active));
      buttonLabel(full,active?'Exit full screen':'Full screen',active?'restore':'fullscreen');
    }
    reader.onfullscreenchange=syncFull;
    full.onclick=async()=>{
      if(document.fullscreenElement===reader)await document.exitFullscreen();
      else if(reader.classList.contains('reader-expanded'))reader.classList.remove('reader-expanded');
      else {
        try {await reader.requestFullscreen();}
        catch {if(reader.isConnected)reader.classList.add('reader-expanded');}
      }
      syncFull();
    };
    reader.onkeydown=e=>{
      if(e.key==='Escape' && reader.classList.contains('reader-expanded')){
        reader.classList.remove('reader-expanded');syncFull();full.focus();
      }
    };
    syncFull();
    return setCollapsed;
  }
  function renderLibrary(d,section){
    const tabs=[['manual','Manual'],['forms','Forms & Tags'],['questions','Practice Questions']];
    if(d.referenceOnly){tabs.shift();if(section==='manual')section='forms';}
    const manual=section==='manual';
    const prompt={manual:'Search the manual',forms:'Search forms and tags',questions:'Search practice questions'}[section];
    const paging=manual?`<select id="readMode" aria-label="Reading format"><option value="pdf">PDF</option><option value="text">Page text</option></select>
      <div class="reader-paging"><button class="iconbtn" id="readPrevious" aria-label="Previous manual page">${icon('left')}</button>
      <label>Page <input type="number" id="pageNumber" min="1" max="${d.pages}"> / ${d.pages}</label>
      <button class="iconbtn" id="readNext" aria-label="Next manual page">${icon('right')}</button></div>`:'';
    main.innerHTML=`<h1 class="sr-only">UWPC library</h1><div id="libraryWorkspace"><div class="library-bar"><div class="library-controls">
      <div class="library-buttons" role="group" aria-label="UWPC sections">${tabs.map(([key,label])=>`<button type="button" aria-pressed="${section===key}" data-lib="${key}">${label}</button>`).join('')}</div>
      ${search('bookQuery',prompt)}<a class="source-link" ${d.referenceOnly?'hidden':''} href="${sourceUrl}" target="_blank" rel="noopener">${icon('arrow')}Open source PDF</a>
      ${paging}</div>${manual?'<button type="button" class="iconbtn" id="readerFull"></button>':''}</div><div id="libraryContent"></div></div>`;
    const content=$('libraryContent');
    if(!manual){
      const cards=section==='forms'?d.forms.map(f=>`<article class="card formref"><strong>${esc(f.code)}</strong><p>${esc(f.title)}</p>
        <a class="btn" ${d.referenceOnly?'hidden':''} href="${api}/library/${encodeURIComponent(f.id)}" download>${icon('download')}PDF</a>
        <a ${d.referenceOnly?'hidden':''} href="${sourceUrl}#page=${f.pages?.[0]}" target="_blank" rel="noopener">Source p. ${f.pages?.[0]}</a></article>`):
        d.questions.map(([q,a,cl,p])=>`<details class="card"><summary>${esc(q)}</summary><p>${esc(a)}</p><a ${d.referenceOnly?'hidden':''} href="${sourceUrl}#page=${p}" target="_blank" rel="noopener">${esc(cl)} · PDF p. ${p}</a></details>`);
      content.className=section==='forms'?'formsgrid':'questions';
      content.innerHTML=cards.join('')+'<p class="note" id="libraryEmpty" hidden></p>';
      const filter=()=>{
        const words=$('bookQuery').value.trim().toLowerCase().split(/\s+/);
        let count=0;
        for(const card of content.querySelectorAll('.card')){
          const text=card.textContent.toLowerCase();card.hidden=!words.every(w=>text.includes(w));
          if(!card.hidden)count++;
        }
        $('libraryEmpty').hidden=count>0;
        $('libraryEmpty').textContent=cards.length?'No matching entries.':'No entries for this edition.';
      };
      $('bookQuery').oninput=filter;filter();return;
    }
    content.innerHTML=`<div class="libraryTools" id="manualLayout"><aside class="library-index" aria-label="Manual contents">
      <div class="toc" id="indexPanel"><div id="contents"></div></div>
      <button type="button" class="iconbtn index-toggle" id="indexToggle" aria-controls="indexPanel"></button></aside>
      <div class="reader" id="readerHost"></div></div>`;
    const setCollapsed=bindReaderLayout();
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
    $('bookQuery').oninput=()=>{const q=$('bookQuery').value.trim();if(q)setCollapsed(false);clearTimeout(delayed);const seq=++requestId;
      if(!q){$('contents').innerHTML=contents();return;}delayed=setTimeout(async()=>{try{const data=await fetchData(api+'/library?q='+encodeURIComponent(q));
        if(seq!==requestId||!$('contents'))return;$('contents').innerHTML=data.hits.map(h=>`<a href="${sourceUrl}#page=${Number(h.page)}" data-page="${Number(h.page)}"><strong>PDF p. ${Number(h.page)}</strong> · ${esc(h.text)}</a>`).join('')||'<p>No matching passages.</p>';
      }catch(e){if(seq===requestId&&$('contents'))$('contents').innerHTML=errorBox(e);}},220);};
  }
  const reportClock=new Intl.DateTimeFormat('en-CA',{year:'numeric',month:'short',day:'numeric',hour:'2-digit',minute:'2-digit',second:'2-digit',timeZoneName:'short'});
  function reportTime(value){return value?reportClock.format(new Date(value)):'—';}
  function reportTable(headers,rows,empty){
    if(!rows.length)return `<p class="report-empty">${esc(empty)}</p>`;
    return `<div class="sheet"><table><thead><tr>${headers.map(h=>`<th scope="col">${esc(h)}</th>`).join('')}</tr></thead>
      <tbody>${rows.map(row=>`<tr>${row.map(cell=>`<td>${esc(cell??'—')}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
  }
  function eventTable(events){
    const labels={'review-open':'Review issued','review-sign':'Review signed','review-view':'Revision viewed',
      'save':'Package edited','log-entry':'Switching entry','log-close':'Switching log closed','final-flag':'Final copy flagged',
      'checked-out':'Checked out','checked-in':'Checked in','checkout-expired':'Checkout expired'};
    return reportTable(['When','Recorded by','Event','Document','Details'],events.map(e=>[
      reportTime(e.at),e.actor,labels[e.event]||e.event.replaceAll('-',' '),e.document||'Outage register',e.summary||'—'
    ]),'No events recorded.');
  }
  function reportBody(r){
    const signatures=[],pending=[],switching=[],notes=[];
    const {names}=window.NorthStarOutageReview({esc,when:date,dateValue:localDay});
    const signature=(doc,name,role,site,status,at)=>signatures.push([
      doc.packageReview?`${doc.title} · review ${doc.packageReview.number}`:doc.title,name,role,site||'—',status,reportTime(at)]);
    for(const doc of r.documents){
      const review=doc.packageReview, ordinary=doc.review;
      const terminal=['COMPLETED','CANCELLED'].includes(doc.phase)||['COMPLETED','CANCELLED'].includes(r.phase);
      const unsigned=terminal?'Unsigned':'Pending';
      if(review){
        for(const task of review.tasks)signature(doc,task.account,names[task.role]||task.role,task.site,task.signedAt?'Signed':unsigned,task.signedAt);
      }else if(ordinary){
        for(const name of ordinary.operators){
          const d=ordinary.decisions.find(item=>item.actor===name);
          signature(doc,name,'Assigned operator','',d?(d.decision==='APPROVE'?'Signed':'Returned for changes'):unsigned,d?.at);
          if(d?.decision==='RETURN')pending.push([doc.title,name,d.comment]);
        }
      }else if(!terminal)
        pending.push([doc.title,'—',doc.reissue?'Edited revision awaiting reissue':'No review assigned']);
      for(const i of doc.issues)pending.push([doc.title,i.actor,`${i.comment}${i.answer?' · Awaiting confirmation: '+i.answer:''}`]);
      for(const f of doc.flags)pending.push([doc.title,f.actor,'Final-copy concern · '+f.text]);
      const log=doc.switchLog;
      if(log){
        switching.push([doc.title,'Open',reportTime(log.openedAt),log.openedBy,'—','Log opened']);
        for(const e of log.entries||[])switching.push([doc.title,e.sequence,reportTime(e.occurredAt||e.at),e.actor,e.site||'Control room',
          [e.step?'Step '+e.step:null,e.device,e.text].filter(Boolean).join(' · ')]);
        if(log.closure)notes.push([doc.title,'Closed',reportTime(log.closure.at),log.closure.actor,log.closure.text]);
        for(const n of log.notes||[])notes.push([doc.title,'Follow-up',reportTime(n.at),n.actor,n.text]);
      }
    }
    for(const e of r.events.filter(e=>!e.document && e.event==='closed')){
      if(!r.documents.some(d=>d.switchLog?.closure?.actor===e.actor && d.switchLog.closure.text===e.summary))
        notes.push(['Outage register','Closed',reportTime(e.at),e.actor,e.summary]);
    }
    const section=(title,body)=>`<section class="report-section"><h2>${title}</h2>${body}</section>`;
    const completed=signatures.filter(row=>row[4]==='Signed').length;
    const awaiting=signatures.filter(row=>row[4]==='Pending').length;
    return `<article class="outage-report"><header><h1>${esc(r.title)}</h1><p>${esc([r.site,r.id].filter(Boolean).join(' · '))} · As of ${esc(reportTime(r.asOf))}${r.editOwner?' · Checked out by '+esc(r.editOwner):''}</p></header>
      ${section('Sign-offs',`<p>${completed} signed · ${awaiting} pending</p>`+reportTable(['Document','Person','Role','Site','Decision','When'],signatures,r.documents.length?'No current sign-offs recorded.':'No package is attached to this outage.'))}
      ${section('Outstanding items',reportTable(['Document','Raised by','Item'],pending,'No open corrections, concerns or unassigned reviews.'))}
      ${section('Switching log',reportTable(['Document','Entry','When','Recorded by','Site','Activity'],switching,'No switching log entries recorded.'))}
      ${section('Closeout notes',reportTable(['Record','Type','When','Recorded by','Note'],notes,'No closeout notes recorded.'))}
      <details class="report-section"><summary>Event log (${r.events.length})</summary>${eventTable(r.events)}</details></article>`;
  }
  async function reports(stamp,initial){
    main.innerHTML=head('Reports')+'<p role="status">Loading outages…</p>';
    const [rows,user]=await Promise.all([fetchData(api+'/reports'),session]);if(epoch!==stamp)return;
    if(!rows.length){main.innerHTML=head('Reports')+'<p>No outages recorded.</p>';return;}
    let chosen=initial?decodeURIComponent(initial):'';
    if(!chosen && user?.actor){try{chosen=localStorage.getItem('northstar.outageManager.last.'+user.actor);}catch{}}
    const missing=Boolean(initial && !rows.some(r=>r.id===chosen));
    if(!rows.some(r=>r.id===chosen))chosen=missing?'':rows[0].id;
    main.innerHTML=`<div class="report-picker"><label>Outage <select id="reportChoice">${missing?'<option value="">Select an outage</option>':''}${['active','upcoming','past'].map(tab=>{
      const options=rows.filter(r=>r.period===tab);
      return options.length?`<optgroup label="${{active:'In progress',upcoming:'Upcoming',past:'Past'}[tab]}">${opts(options.map(r=>[r.id,[r.title,r.site,r.id].filter(Boolean).join(' · ')]),chosen)}</optgroup>`:'';
    }).join('')}</select></label><button class="btn" id="reportRefresh">Refresh</button></div><div id="outageReport" aria-live="polite"></div>`;
    const choice=$('reportChoice'), host=$('outageReport');
    let sequence=0;
    async function load(){
      if(!choice.value){host.textContent='Outage not found. Select an outage to view its report.';return;}
      const seq=++sequence;host.textContent='Loading report…';
      history.replaceState(null,'','#reports/'+encodeURIComponent(choice.value));
      try{const r=await fetchData(api+'/reports?id='+encodeURIComponent(choice.value));
        if(seq===sequence && host.isConnected){host.innerHTML=reportBody(r);void mountFolder(r,'');}
      }catch(e){if(seq===sequence && host.isConnected)host.innerHTML=errorBox(e);}
    }
    choice.onchange=load;$('reportRefresh').onclick=load;await load();
  }
  async function route(){
    const stamp=++epoch;requestId++;clearTimeout(delayed);
    const [part,sub]=location.hash.slice(1).split('/');const view=Object.hasOwn(titles,part)?part:'home';
    shell(view);document.title=(view==='home'?'Outages':titles[view])+' · Outage Manager';
    try{
      if(view==='home'||view==='outages'){state={tab:'upcoming',offset:0,sort:'start',direction:'asc'};regHome();}
      else if(view==='new')await newOutage(stamp);
      else if(view==='inbox')await inbox(stamp);
      else if(view==='reports')await reports(stamp,sub);
      else{main.innerHTML=head('UWPC library')+'<p role="status">Loading manual…</p>';const d=libraryData||await fetchData(api+'/library');
        if(epoch===stamp){libraryData=d;renderLibrary(d,['forms','questions'].includes(sub)?sub:'manual');}}
    }catch(e){if(epoch===stamp)main.innerHTML=head(titles[view])+errorBox(e);}
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
    else if(el.dataset.page){e.preventDefault();if(innerWidth<=820 && !$('indexPanel').hidden)$('indexToggle').click();await readPage(Number(el.dataset.page),readerMode);}
  });
  window.addEventListener('hashchange',route);void route();
  window.addEventListener('pageshow',e=>{
    if(!e.persisted)return;
    if($('rows'))void loadRegister();else void mountFolder();
  });
})();
