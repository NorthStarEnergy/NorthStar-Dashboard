(() => {
  'use strict';
  const api = '/api/uwpc/requests/manager';
  const $ = id => document.getElementById(id);
  const esc = value => String(value ?? '').replace(/[&<>"']/g,c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const paths = {home:'M3 10l9-7 9 7 M5 9v11h5v-6h4v6h5V9',new:'M12 4v16 M4 12h16',
    inbox:'M4 4h16l2 13v3H2v-3z M3 14h5l2 3h4l2-3h5',library:'M3 4h5v16H3z M10 4h4v16h-4z M16 5l4-1 3 15-4 1z',
    back:'M19 12H5 M11 6l-6 6 6 6',search:'M16 16l5 5 M18 10a7 7 0 1 1-14 0 7 7 0 0 1 14 0',
    filters:'M3 6h18 M6 12h12 M9 18h6',file:'M6 3h8l4 4v14H6z M14 3v5h4 M9 12h6 M9 16h5',
    info:'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0 M12 11v6 M12 7v1',download:'M12 3v12 M7 10l5 5 5-5 M4 17v4h16v-4',
    left:'M15 5l-7 7 7 7',right:'M9 5l7 7-7 7',arrow:'M5 18L18 5 M7 5h11v11'};
  const icon = name => `<svg class="ico" aria-hidden="true" viewBox="0 0 24 24"><path d="${paths[name]}"></path></svg>`;
  const base = '/outage-manager.html';
  const sourceUrl = api + '/library/book';
  const packageUrl = id => '/outage-manager-package.html?id='+encodeURIComponent(id);
  const views = [['home','Home'],['new','New'],['inbox','My reviews'],['library','UWPC library']];
  const main=$('main');
  const date = value => value ? new Date(value).toLocaleString('en-CA',{month:'short',day:'numeric',year:'numeric',hour:'2-digit',minute:'2-digit',hour12:false}) : 'Unscheduled';
  const localDay = value => {const d=new Date(value);return Number.isNaN(+d)?'':new Date(+d-d.getTimezoneOffset()*60000).toISOString().slice(0,10);};
  const states = {DRAFT:'Draft',GENERATED:'Prepared',PENDING_SIGNOFF:'In review',CHANGES_REQUESTED:'Correction requested',SIGNED_OFF:'Checked / approved'};
  const priorities = {Monitor:'Normal',Degraded:'Elevated',Critical:'Critical'};
  const opts=(items,current,empty='') => (empty?`<option value="">${esc(empty)}</option>`:'')+items.map(([value,label])=>`<option value="${esc(value)}" ${value===current?'selected':''}>${esc(label)}</option>`).join('');
  let state={}, epoch=0, requestId=0, delayed, libraryData, detailToken=0, readerPage=1, readerMode='pdf', readId=0;
  function shell(view) {
    $('shell').innerHTML=`<aside class="rail"><a class="brand" href="${base}" aria-label="Outage Manager home"><svg class="mark" viewBox="0 0 32 36" aria-hidden="true"><path d="M3 26V10l7-4v16zm10 3V9l7-4v20zm10-7V6l7-4v16z" fill="currentColor"/></svg><span>Outage Manager</span></a>
      <nav aria-label="Main menu">${views.map(([key,label])=>`<a href="${base}#${key}" aria-label="${label}" title="${label}" ${view===key?'aria-current="page"':''}>${icon(key)}<span>${label}</span></a>`).join('')}</nav>
      <a class="back" href="/northstar-clean.html" aria-label="Return to NorthStar">${icon('back')}<span>NorthStar</span></a></aside>`;
  }
  async function fetchData(url,body) {
    const r=await fetch(url,{credentials:'same-origin',cache:'no-store',...(body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{})});
    const data=await r.json().catch(()=>({}));
    if(!r.ok)throw Error(data.error || `Request failed (${r.status})`);
    return data;
  }
  function errorBox(e){return `<p class="error" role="alert">${esc(e.message)}</p>`;}
  function head(title,action=''){return `<header class="pagehead"><h1>${title}</h1>${action}</header>`;}
  function search(id,placeholder){return `<label class="search">${icon('search')}<input type="search" id="${id}" aria-label="${placeholder}" placeholder="${placeholder}"></label>`;}
  function chip(r){const [text,tone]=r.phase==='COMPLETED'?['Closed','done']:r.phase==='CANCELLED'?['Cancelled','hold']:r.phase==='ACTIVE'?['In progress','active']:
    [states[r.status] || r.status,({SIGNED_OFF:'done',PENDING_SIGNOFF:'review',CHANGES_REQUESTED:'hold'})[r.status]||''];
    return `<span class="chip ${tone}">${esc(text)}</span>`;}
  function rowAction(key,id,label,graphic){return `<button class="iconbtn" data-${key}="${esc(id)}" title="${esc(label)}" aria-label="${esc(label)}">${icon(graphic)}</button>`;}
  function regHome(){
    const tabs=[['upcoming','Upcoming'],['active','In progress'],['past','Past']];
    main.innerHTML=head('Outages',`<a href="#new" class="primary">${icon('new')}New outage</a>`)+
      `<div class="tabs" aria-label="Outage period">${tabs.map(([id,label])=>`<button data-tab="${id}" aria-pressed="${id===state.tab}">${label}<span class="count" data-count="${id}">–</span></button>`).join('')}</div>
      <div class="bar">${search('query','Search outages')}<select id="site" aria-label="Filter by site"><option value="">All sites</option></select><button class="btn" id="toggleFilters" aria-expanded="false">${icon('filters')}Filters</button></div>
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
      const cols=[['title','Outage'],['site','Site'],[state.tab==='past'?'closed':'start',state.tab==='past'?'Closed':'Start'],['','End'],['severity','Priority'],['status','Status'],['','Actions']];
      $('rows').innerHTML=`<table aria-label="Outage register"><thead><tr>${cols.map(([k,l])=>`<th ${k===state.sort?'aria-sort="'+(state.direction==='asc'?'ascending':'descending')+'"':''}>${k?`<button data-sort="${k}">${l} ${k===state.sort?(state.direction==='asc'?'↑':'↓'):'↕'}</button>`:l}</th>`).join('')}</tr></thead><tbody>
        ${d.rows.map(r=>`<tr><td><button class="titlebtn" data-detail="${esc(r.id)}" title="${esc(r.title)}">${esc(r.title)}</button></td>
        <td title="${esc(r.sites.join(', '))}">${esc(r.site)}${r.sites.length>1?' +'+(r.sites.length-1):''}</td>
        <td>${state.tab==='past'?(r.closed?esc(date(r.closed)):'—'):esc(date(r.start))}</td><td>${r.end?esc(date(r.end)):'—'}</td>
        <td>${esc(priorities[r.severity]||r.severity)}</td><td>${chip(r)}${r.requiredSignatures?` <small class="mono" title="Required sign-offs received">${r.signed}/${r.requiredSignatures}</small>`:''}</td><td><div class="actions">${rowAction('detail',r.id,'View outage details','info')}
        ${r.packageId?`<a class="iconbtn" href="${packageUrl(r.packageId)}" title="Open outage package" aria-label="Open outage package">${icon('file')}</a>`:
        (r.type==='Planned'&&r.phase==='FUTURE'?rowAction('prepare',r.id,'Prepare outage package','file'):'')}</div></td></tr>`).join('')}</tbody></table>
        ${d.rows.length?'':'<div class="empty">No outages match this view.</div>'}`;
      $('range').textContent=d.total?`${d.offset+1}–${d.offset+d.rows.length} of ${d.total} outages`:'0 outages';
      $('prev').disabled=!d.offset;$('next').disabled=d.offset+d.rows.length>=d.total;
    }catch(e){if(fetchId===requestId&&$('rows'))$('rows').innerHTML=errorBox(e);}
  }
  async function showDetail(id){
    const stamp=++detailToken;
    $('detailBody').textContent='Loading…';if(!$('detail').open)$('detail').showModal();
    try{const r=await fetchData(api+'/detail?id='+encodeURIComponent(id));if(stamp!==detailToken)return;
      $('detailBody').innerHTML=`<h3>${esc(r.title)}</h3>${chip(r)}<dl class="facts">${Object.entries({
        'Outage ID':r.id,'Sites':r.sites.join(', ')||r.site,'Equipment':r.asset||'—','Type':r.type,'Priority':priorities[r.severity]||r.severity,
        'Starts':date(r.start),'Ends':r.end?date(r.end):'—','Opened by':r.owner,'Work scope':r.scope||'—'
      }).map(([k,v])=>`<dt>${k}</dt><dd>${esc(v)}</dd>`).join('')}</dl><div class="toolsList">
      ${r.documents.map(pkg=>`<a class="librow" href="${packageUrl(pkg.id)}">${icon('file')}${esc(pkg.title)}${icon('right')}</a>`).join('')}
      ${!r.documents.length&&r.type==='Planned'&&r.phase==='FUTURE'?`<button class="primary" data-prepare="${esc(id)}">Prepare outage package</button>`:''}</div>`;
    }catch(e){$('detailBody').innerHTML=errorBox(e);}
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
      <label class="wide">Additional affected sites <textarea name="additional" rows="2" placeholder="One site per line"></textarea></label></div>
      <div class="formfoot"><span role="status" id="saveStatus"></span><a class="btn" href="#home">Cancel</a><button class="primary" type="submit">Create outage</button></div></form>`;
    let token=crypto.randomUUID();
    const form=$('create');
    form.addEventListener('input',()=>{token=crypto.randomUUID();});
    form.onsubmit=async e=>{e.preventDefault();const data=Object.fromEntries(new FormData(form));
      for(const k of ['start','end'])data[k]=new Date(data[k]).toISOString();
      if(data.end<=data.start){$('saveStatus').textContent='End must be later than start.';return;}
      data.affectedSites=data.additional.split(/\r?\n/).map(s=>s.trim()).filter(Boolean);delete data.additional;
      data.requestKey=token;const button=form.querySelector('[type=submit]');button.disabled=true;
      $('saveStatus').textContent='Saving…';
      try{const r=await fetchData(api+'/create',data);if(epoch===stamp){location.hash='home';await showDetail(r.id);}}
      catch(err){if(epoch===stamp)$('saveStatus').textContent=err.message;}finally{button.disabled=false;}
    };
    try{const d=await fetchData('/api/sites');if(epoch===stamp)$('stations').innerHTML=d.options.map(s=>`<option value="${esc(s.name||s.label||s.site||s)}"></option>`).join('');}catch{/* Site entry remains available. */}
  }
  async function inbox(stamp){
    main.innerHTML=head('My reviews')+'<div id="reviews" class="toolsList" aria-live="polite">Loading…</div>';
    const d=await fetchData(api+'/inbox');if(epoch!==stamp)return;
    const review=window.NorthStarOutageReview({esc,when:date,dateValue:localDay});
    const rows=d.rows.flatMap(r=>{
      const ordinary=JSON.parse(r.ordinary||'null');
      const messages=review.alerts({...r,lastReview:{owner:r.lastOwner},reviewIssues:JSON.parse(r.issues||'[]'),
        packageReview:JSON.parse(r.packageReview||'null'),distribution:JSON.parse(r.distribution||'null')},d.actor);
      if(r.status==='PENDING_SIGNOFF'&&ordinary?.operators.includes(d.actor)&&!ordinary.decisions.some(v=>v.actor===d.actor))messages.push('Operator review requested');
      return messages.length?[`<a class="librow" href="${packageUrl(r.id)}"><strong>${esc(r.title)}</strong><span>${esc(messages.join(' · '))}</span>${icon('right')}</a>`]:[];
    });$('reviews').innerHTML=rows.join('')||'<div class="panel empty">You have no outstanding reviews.</div>';
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
    main.innerHTML=head('UWPC library',`<a class="btn" href="${sourceUrl}" target="_blank" rel="noopener">${icon('arrow')}Open source PDF</a>`)+
      `<p class="bookmeta">${esc(d.title)} · ${d.pages} pages · ${esc(d.status.replaceAll('_',' ').toLowerCase())}</p><div class="tabs">
      ${tabs.map(([key,label])=>`<button aria-pressed="${section===key}" data-lib="${key}">${label}</button>`).join('')}</div>`;
    if(section==='forms'){main.insertAdjacentHTML('beforeend',`<p class="note">Form and tag illustrations from the source manual.</p><div class="formsgrid">${d.forms.map(f=>
      `<article class="card formref"><strong>${esc(f.code)}</strong><p>${esc(f.title)}</p><a class="btn" href="${api}/library/${encodeURIComponent(f.id)}" download>${icon('download')}PDF</a>
      <a href="${sourceUrl}#page=${f.pages[0]}" target="_blank" rel="noopener">Source p. ${f.pages[0]}</a></article>`).join('')||'<p>No form index for this edition.</p>'}</div>`);return;}
    if(section==='questions'){main.insertAdjacentHTML('beforeend',`<div class="questions">${d.questions.map(([q,a,cl,p])=>
      `<details class="card"><summary>${esc(q)}</summary><p>${esc(a)}</p><a href="${sourceUrl}#page=${p}" target="_blank" rel="noopener">${esc(cl)} · PDF p. ${p}</a></details>`).join('')||'<p>No questions for this edition.</p>'}</div>`);return;}
    main.insertAdjacentHTML('beforeend',`<div class="bar">${search('bookQuery','Search the manual')}</div><div class="libraryTools"><aside class="toc panel" aria-label="Manual contents" id="contents"></aside>
      <div class="reader"><div class="readerBar"><select id="readMode" aria-label="Reading format"><option value="pdf">Source PDF</option><option value="text">Page text</option></select>
      <button class="iconbtn" id="readPrevious" aria-label="Previous manual page">${icon('left')}</button>
      <label>Page <input type="number" id="pageNumber" min="1" max="${d.pages}"> / ${d.pages}</label>
      <button class="iconbtn" id="readNext" aria-label="Next manual page">${icon('right')}</button></div><div id="readerHost"></div></div></div>`);
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
    $('bookQuery').oninput=()=>{const q=$('bookQuery').value.trim();clearTimeout(delayed);const seq=++requestId;
      if(!q){$('contents').innerHTML=contents();return;}delayed=setTimeout(async()=>{try{const data=await fetchData(api+'/library?q='+encodeURIComponent(q));
        if(seq!==requestId||!$('contents'))return;$('contents').innerHTML=data.hits.map(h=>`<a href="${sourceUrl}#page=${Number(h.page)}" data-page="${Number(h.page)}"><strong>PDF p. ${Number(h.page)}</strong> · ${esc(h.text)}</a>`).join('')||'<p>No matching passages.</p>';
      }catch(e){if(seq===requestId&&$('contents'))$('contents').innerHTML=errorBox(e);}},220);};
  }
  async function route(){
    const stamp=++epoch;requestId++;clearTimeout(delayed);
    const [part,sub]=location.hash.slice(1).split('/');const view=views.some(([k])=>k===part)?part:'home';
    shell(view);document.title=(view==='home'?'Outages':views.find(([k])=>k===view)[1])+' · Outage Manager';
    try{
      if(view==='home'){state={tab:'upcoming',offset:0,sort:'start',direction:'asc'};regHome();}
      else if(view==='new')await newOutage(stamp);
      else if(view==='inbox')await inbox(stamp);
      else{main.innerHTML=head('UWPC library')+'<p role="status">Loading manual…</p>';const d=libraryData||await fetchData(api+'/library');
        if(epoch===stamp){libraryData=d;renderLibrary(d,['forms','questions'].includes(sub)?sub:'manual');}}
    }catch(e){if(epoch===stamp)main.innerHTML=head(views.find(([k])=>k===view)[1])+errorBox(e);}
  }
  if(document.body.hasAttribute('data-manager-package')){shell('');return;}
  $('closeDetail').onclick=()=>$('detail').close();
  document.addEventListener('click',async e=>{
    const el=e.target.closest('[data-detail],[data-prepare],[data-sort],[data-page],[data-lib]');if(!el)return;
    if(el.dataset.detail)await showDetail(el.dataset.detail);
    else if(el.dataset.prepare){el.disabled=true;try{const r=await fetchData('/api/uwpc/requests',{fromOutage:el.dataset.prepare});location.assign(packageUrl(r.id));}
      catch(err){if(!$('detail').open)$('detail').showModal();$('detailBody').innerHTML=errorBox(err);}finally{el.disabled=false;}}
    else if(el.dataset.sort){state.direction=state.sort===el.dataset.sort&&state.direction==='asc'?'desc':'asc';state.sort=el.dataset.sort;state.offset=0;await loadRegister();}
    else if(el.dataset.lib){location.hash='library/'+el.dataset.lib;}
    else if(el.dataset.page){e.preventDefault();await readPage(Number(el.dataset.page),readerMode);}
  });
  window.addEventListener('hashchange',route);void route();
})();
