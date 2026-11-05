(() => {
  'use strict';
  const $ = selector => document.querySelector(selector);
  const workspace = $('#siteCrewWorkspace');
  if (!workspace) return;
  const canonical = (site, id) => window.NorthStarSites?.displayName(site, id) || site;
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const dateKey = value => {
    const date = new Date(value);
    return Number.isFinite(date.getTime()) ? `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}` : '';
  };
  const time = value => value && Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString([], {month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'}) : 'Not recorded';
  const duration = row => {
    const minutes = Math.max(0, Math.floor(((Date.parse(row.checkedOutAt) || Date.now()) - Date.parse(row.checkedIn))/60000));
    return Number.isFinite(minutes) ? `${Math.floor(minutes/60)}h ${minutes%60}m` : 'Not recorded';
  };
  const field = (label, value) => `<div><dt>${label}</dt><dd>${value}</dd></div>`;
  function workerDetails(row) {
    const lat = row.latitude, lng = row.longitude;
    const hasGps = lat !== null && lat !== undefined && lat !== '' && lng !== null && lng !== undefined && lng !== '' && Number.isFinite(Number(lat)) && Number.isFinite(Number(lng));
    const gps = hasGps ? `<a href="https://maps.google.com/?q=${Number(lat)},${Number(lng)}" target="_blank" rel="noopener noreferrer">${Number(lat).toFixed(5)}, ${Number(lng).toFixed(5)} ↗</a>` : 'Not shared / not recorded';
    return `<dl class="site-worker-details">${field('PHONE (MASKED)',esc(row.contactPhone || 'Not recorded'))}${field('GPS LOCATION',gps)}${field('CHECKED IN',time(row.checkedIn))}${field('CHECKED OUT',time(row.checkedOutAt))}${field('LAST ACTIVITY',time(row.lastHeard))}${field('TIME ON SITE',duration(row))}${field('WORKING ALONE',row.alone ? 'Yes · hourly check-in' : 'No')}${field('EXPECTED STAY',row.expectedMinutes ? `${esc(row.expectedMinutes)} minutes` : 'Not set')}${field('HELP STATUS',esc(row.helpState || 'none'))}${field('PHONE VERIFIED',row.phoneVerified ? time(row.phoneVerifiedAt) : 'Not verified')}</dl>${row.notes ? `<p class="site-worker-notes">${esc(row.notes)}</p>` : ''}`;
  }
  let site = '', records = [], request = 0, historyRequest = 0;
  const expanded = new Map();
  const sizeRules=new Map([
    [workspace,{width:'100%',height:'auto','max-width':'none',overflow:'visible'}],
    [workspace.parentElement,{width:'100%',height:'auto','max-width':'none',overflow:'visible'}],
    [$('#siteCrewTitle'),{width:'auto',height:'auto',display:'block'}],
    [workspace.querySelector('.site-crew-head>div>label'),{width:'auto',height:'auto',display:'block'}]
  ]);
  const fullWidth = () => {
    if(workspace.hidden)return;
    for(const [node,rules] of sizeRules) {
      for(const [property,value] of Object.entries(rules)) {
        if(node.style.getPropertyValue(property)!==value || node.style.getPropertyPriority(property)!=='important')node.style.setProperty(property,value,'important');
      }
    }
  };
  const sizingObserver=new MutationObserver(fullWidth);
  function expandDetail() {
    if(!expanded.size)for(const [node,rules] of sizeRules) {
      expanded.set(node,Object.keys(rules).map(property=>[property,node.style.getPropertyValue(property),node.style.getPropertyPriority(property)]));
      sizingObserver.observe(node,{attributes:true,attributeFilter:['style']});
    }
    fullWidth();
  }
  function restoreSizing() {
    sizingObserver.disconnect();
    for(const [node,properties] of expanded)for(const [property,value,priority] of properties) {
      if(value)node.style.setProperty(property,value,priority);else node.style.removeProperty(property);
    }
    expanded.clear();
  }
  $('#siteCrewDate').value = dateKey(Date.now());
  const logPanel = $('#siteCrewHistory').closest('.site-crew-panel');
  logPanel.classList.add('site-log-panel');
  $('#siteCrewHistoryHeading').textContent = 'Site Log';
  const logFilter = $('#siteCrewDate').closest('label');
  logFilter.firstChild.textContent = 'Day ';
  logFilter.classList.add('site-log-filter');
  logPanel.querySelector('header').after(logFilter);
  $('#siteCrewClose').textContent = 'BACK TO CHECK-INS';
  function renderPeople() {
    const active = records.filter(row => row.status !== 'checked-out');
    $('#siteCrewActiveCount').textContent = `${active.length} ACTIVE`;
    $('#siteCrewSummary').textContent = `${active.filter(row=>row.kind==='Contractor').length} contractors · ${active.filter(row=>row.overdue).length} overdue · ${records.length} visits on file`;
    $('#siteCrewPeople').innerHTML = active.map(row => {const missed=row.overdue || row.status==='overdue', alert=row.needsHelp || missed || row.status==='provisional';return `<article class="site-worker ${alert ? 'needs-attention' : ''}"><header><div><strong>${alert ? '<i class="site-worker-alert-dot" aria-hidden="true"></i>' : ''}${esc(row.name)}</strong><small>${esc(row.kind==='Contractor' ? row.company || 'Contractor' : 'NorthStar Energy')}</small></div><b class="${alert ? 'status-due' : 'status-ok'}">${esc(row.needsHelp ? 'NEEDS HELP' : missed ? 'OVERDUE' : row.status==='provisional' ? 'PENDING REVIEW' : row.status || 'ACTIVE').toUpperCase()}</b></header>${workerDetails(row)}</article>`;}).join('') || '<div class="muted-note">NO ACTIVE WORKERS AT THIS STATION</div>';
  }
  async function renderHistory() {
    const ticket = ++historyRequest, selected = $('#siteCrewDate').value;
    const visits = records.filter(row => dateKey(row.checkedIn) <= selected && (!row.checkedOutAt || dateKey(row.checkedOutAt) >= selected));
    $('#siteCrewHistory').innerHTML = '<div class="muted-note">LOADING CHECK-IN HISTORY…</div>';
    try {
      const batches = [];
      // Bound concurrent reads while retaining history for older station visits.
      for (let index=0; index<visits.length; index+=8) {
        if (ticket !== historyRequest) return;
        batches.push(...await Promise.all(visits.slice(index,index+8).map(async row => {
          const response = await fetch(`/api/checkins/history?id=${encodeURIComponent(row.id)}&limit=1000&ts=${Date.now()}`);
          if (!response.ok) throw new Error('History unavailable');
          return response.json();
        })));
      }
      if (ticket !== historyRequest) return;
      const byId = new Map(records.map(row=>[row.id,row]));
      const events = batches.flat().filter(event=>dateKey(event.at)===selected).sort((a,b)=>Date.parse(b.at)-Date.parse(a.at));
      $('#siteCrewHistoryCount').textContent = `${events.length} EVENTS`;
      $('#siteCrewHistory').innerHTML = (batches.some(batch=>batch.length>=1000) ? '<div class="muted-note">History is limited to the latest 1,000 events per visit.</div>' : '') + (events.map(event => {
        const row=byId.get(event.checkinId);
        return `<article class="site-history-event"><header><strong>${esc(event.worker || row?.name || 'Worker')}</strong><time>${time(event.at)}</time></header><b>${esc(event.event)}</b><p>${esc(event.details || [event.priorStatus,event.newStatus].filter(Boolean).join(' → '))}</p>${row ? `<details><summary>Worker / visit details</summary>${workerDetails(row)}</details>` : ''}</article>`;
      }).join('') || '<div class="muted-note">NO CHECK-IN HISTORY FOR THIS DATE</div>');
    } catch {
      if (ticket===historyRequest) { $('#siteCrewHistoryCount').textContent='UNAVAILABLE'; $('#siteCrewHistory').innerHTML='<div class="status-due">HISTORY UNAVAILABLE · TRY REFRESH</div>'; }
    }
  }
  async function openSiteCrew(value, preserveDate = false) {
    if (!preserveDate) $('#siteCrewDate').value = dateKey(Date.now());
    site=canonical(value); const ticket=++request; ++historyRequest;
    const module=[...(window.NorthstarModules?.registry?.values() || [])].find(m=>m.sourceSection==='crew');
    if (module) window.NorthstarModules.open(module.id); else $('[data-tab="crew"]')?.click();
    workspace.hidden=false; $('#crew').classList.add('site-detail-open');
    expandDetail();
    $('#siteCrewTitle').textContent=site;
    $('#siteCrewPeople').innerHTML='<div class="muted-note">LOADING ACTIVE WORKERS…</div>';
    $('#siteCrewSummary').textContent=''; $('#siteCrewActiveCount').textContent='LOADING';
    $('#siteCrewHistoryCount').textContent='LOADING'; $('#siteCrewHistory').innerHTML='';
    try {
      const response=await fetch('/api/checkins?include=all&ts='+Date.now());
      if(!response.ok) throw new Error('Station unavailable');
      const rows=await response.json(); if(ticket!==request) return;
      records=rows.filter(row=>canonical(row.site,row.siteId)===site);
      renderPeople(); await renderHistory();
    } catch {
      if(ticket===request) { records=[]; $('#siteCrewPeople').innerHTML='<div class="status-due">STATION RECORDS UNAVAILABLE · TRY REFRESH</div>'; $('#siteCrewHistory').innerHTML='<div class="status-due">HISTORY UNAVAILABLE</div>'; }
    }
  }
  // A read-only snapshot of this check-in, not an inferred cross-visit identity.
  const profile = document.createElement('dialog');
  profile.id = 'workerProfileSnapshot';
  profile.setAttribute('aria-labelledby','workerProfileTitle');
  profile.innerHTML = '<header><div><small>PROFILE SNAPSHOT</small><h2 id="workerProfileTitle">Worker</h2></div><button type="button" class="worker-profile-close" aria-label="Close profile">×</button></header><div class="worker-profile-body" aria-live="polite"></div>';
  document.body.append(profile);
  const profileBody=profile.querySelector('.worker-profile-body');
  let profileRequest=0, profileTrigger=null, profileCheckinId=null, profileSite=null, stopProfileFocus=()=>{};
  profile.querySelector('.worker-profile-close').onclick=()=>profile.close();
  profile.addEventListener('click',event=>{if(event.target===profile)profile.close();});
  profile.addEventListener('close',()=>{
    ++profileRequest;
    stopProfileFocus();
    let target=null;
    const restore=()=>{
      const current=[...document.querySelectorAll('#staffGroups [data-worker-profile]')].find(node=>node.dataset.workerProfile===profileCheckinId);
      const station=[...document.querySelectorAll('#staffGroups .staff-group[data-site]')].find(node=>node.dataset.site===profileSite)?.querySelector('h3');
      target=profileTrigger?.isConnected?profileTrigger:current || station;
      if(target?.getClientRects().length)target.focus({preventScroll:true});
    };
    restore();
    // A pending feed can replace the newly focused row after the close event.
    // Preserve this return position only until the user's next interaction.
    const observer=new MutationObserver(()=>{
      if(!target?.isConnected && document.activeElement===document.body)restore();
    });
    const host=document.querySelector('#staffGroups');
    if(host)observer.observe(host,{childList:true,subtree:true});
    const onFocus=event=>{if(event.target!==target)stopProfileFocus();};
    stopProfileFocus=()=>{
      observer.disconnect();
      document.removeEventListener('pointerdown',stopProfileFocus,true);
      document.removeEventListener('keydown',stopProfileFocus,true);
      document.removeEventListener('focusin',onFocus,true);
    };
    document.addEventListener('pointerdown',stopProfileFocus,true);
    document.addEventListener('keydown',stopProfileFocus,true);
    document.addEventListener('focusin',onFocus,true);
  });
  async function openWorkerProfile(id, trigger) {
    stopProfileFocus();
    const ticket=++profileRequest; profileTrigger=trigger; profileCheckinId=String(id); profileSite=trigger?.closest('.staff-group[data-site]')?.dataset.site;
    $('#workerProfileTitle').textContent='Worker';
    profileBody.textContent='Loading profile…';
    if(!profile.open)profile.showModal();
    profile.querySelector('.worker-profile-close').focus();
    try {
      const response=await fetch('/api/checkins?include=all&ts='+Date.now(),{cache:'no-store'});
      if(!response.ok)throw Error('Profile unavailable');
      const rows=await response.json();
      if(ticket!==profileRequest || !profile.open)return;
      if(!Array.isArray(rows))throw Error('Profile unavailable');
      const row=rows.find(item=>String(item.id)===String(id));
      if(!row)throw Error('This worker record is no longer available');
      $('#workerProfileTitle').textContent=row.name || 'Worker';
      const sameSite=rows.filter(item=>item.id!==row.id && item.status!=='checked-out' && canonical(item.site,item.siteId)===canonical(row.site,row.siteId));
      const companions=row.status==='checked-out'?'Past companions are not recorded.':sameSite.length?sameSite.map(item=>esc(item.name)+(item.company?' · '+esc(item.company):'')).join('<br>'):'No other active workers recorded at this station.';
      profileBody.innerHTML=`<p class="worker-profile-summary">${esc(row.kind || 'Worker')} · ${esc(row.company || 'NorthStar Energy')}<br>${esc(canonical(row.site,row.siteId))} · ${esc(row.needsHelp?'Needs help':row.overdue?'Overdue':row.status || 'Status not recorded')}</p><p class="worker-profile-note">Snapshot retrieved ${time(new Date().toISOString())}. GPS is the latest stored coordinate, not a live position.</p>${workerDetails(row)}<dl class="site-worker-details worker-profile-extra">${field('LAST SEEN / CHECK-IN ACTIVITY',time(row.lastHeard))}${field('LAST APP ACCESS','Not recorded separately')}${field('PHONE VERIFICATION METHOD',esc(row.verificationMethod || 'Not recorded'))}${field('CHECK-IN ACCEPTED',row.acceptedAt?time(row.acceptedAt)+' · '+esc(row.acceptedBy || ''):'Not recorded')}${field('CHECK-IN REJECTED',row.rejectedAt?time(row.rejectedAt)+' · '+esc(row.rejectedBy || ''):'Not recorded')}${field('GPS REMOVED',time(row.coordinatesPurgedAt))}</dl><section><h3>Also checked in at this station</h3><p>${companions}</p><p class="worker-profile-note">Shared station presence does not confirm they are together.</p></section><section><h3>Visit history</h3><p class="worker-profile-note">This check-in record only; separate visits are not linked by name.</p><div class="worker-profile-history">Loading history…</div></section>`;
      try {
        const historyResponse=await fetch('/api/checkins/history?id='+encodeURIComponent(id)+'&limit=1000',{cache:'no-store'});
        if(historyResponse.status===403){
          if(ticket===profileRequest && profile.open)profile.querySelector('.worker-profile-history').textContent='History unavailable for this account.';
          return;
        }
        if(!historyResponse.ok)throw Error('History unavailable');
        const history=await historyResponse.json();
        if(ticket!==profileRequest || !profile.open)return;
        if(!Array.isArray(history))throw Error('History unavailable');
        profile.querySelector('.worker-profile-history').innerHTML=(history.length>=1000?'<p>Latest 1,000 recorded events.</p>':'')+(history.filter(item=>String(item.checkinId)===String(id)).sort((a,b)=>Date.parse(b.at)-Date.parse(a.at)).map(item=>`<article><time>${time(item.at)}</time><strong>${esc(item.event)}</strong><p>${esc(item.details || [item.priorStatus,item.newStatus].filter(Boolean).join(' → '))}</p></article>`).join('') || '<p>No history recorded for this visit.</p>');
      } catch {
        if(ticket===profileRequest && profile.open)profile.querySelector('.worker-profile-history').textContent='History unavailable. Close and reopen to retry.';
      }
    } catch(error) {
      if(ticket===profileRequest && profile.open)profileBody.textContent=error.message+'. Close and reopen to retry.';
    }
  }
  function openStation(value) {
    const chosen=window.NorthStarSites?.resolve(value);
    const id=chosen && 'operations:site:'+chosen.id.replace(/^site:/,'');
    window.NorthstarModules?.refresh();
    if(id && document.body.classList.contains('ns-station-popout')) {
      try {if(window.opener && !window.opener.closed && window.opener.NorthstarModules?.registry?.has(id)){window.opener.NorthstarModules.open(id);window.opener.focus();return;}} catch {}
      if(window.NorthstarModules?.registry?.has(id)){window.NorthstarModules.popOut(id);return;}
    }
    openSiteCrew(value);
  }
  const dialog=$('#siteWorkerDialog'), form=$('#siteWorkerForm');
  document.body.append(dialog); // Shared by station cards and the independent roster module.
  const contactLabel=document.createElement('label');
  contactLabel.className='site-worker-alone';
  contactLabel.innerHTML='<input id="siteWorkerCrewContact" type="checkbox">Crew contact / caller';
  form.querySelector('.site-worker-form-actions').before(contactLabel);
  const siteSelect=$('#siteWorkerSite');
  const crewLabel=document.createElement('label');
  crewLabel.innerHTML='Existing crew / company<select id="siteWorkerCrew"><option value="">New person / crew</option></select>';
  siteSelect.closest('label').after(crewLabel);
  const hint=document.createElement('p');hint.id='siteWorkerSuggestions';hint.setAttribute('role','status');crewLabel.after(hint);
  const names=document.createElement('datalist');names.id='siteWorkerNames';form.append(names);$('#siteWorkerName').setAttribute('list',names.id);
  const companies=document.createElement('datalist');companies.id='siteWorkerCompanies';form.append(companies);$('#siteWorkerCompany').setAttribute('list',companies.id);
  let suggestionRows=[],suggestionTicket=0,crews=[];
  const companyOf=row=>row.company || (row.kind==='Contractor'?'Contractor':'NorthStar');
  function suggestNames() {
    const company=$('#siteWorkerCompany').value.trim().toLowerCase();
    const options=suggestionRows.filter(row=>!company || companyOf(row).toLowerCase()===company);
    const unique=new Map();
    options.sort((a,b)=>Number(a.status==='checked-out')-Number(b.status==='checked-out')).forEach(row=>{if(!unique.has(row.name))unique.set(row.name,row);});
    names.innerHTML=[...unique.values()].map(row=>'<option value="'+esc(row.name)+'" label="'+esc((row.status==='checked-out'?'Previous visit':'Currently on site')+' · '+companyOf(row))+'"></option>').join('');
  }
  async function loadSuggestions() {
    const ticket=++suggestionTicket,value=siteSelect.value;
    suggestionRows=[];crews=[];names.replaceChildren();companies.replaceChildren();
    $('#siteWorkerCrew').innerHTML='<option value="">New person / crew</option>';
    hint.textContent=value?'Loading crews and previous visits…':'Choose a station to see its crews and previous visitors.';
    if(!value)return;
    try {
      const rows=await window.NorthstarRoster.load();
      if(ticket!==suggestionTicket || !dialog.open || siteSelect.value!==value)return;
      suggestionRows=rows.filter(row=>canonical(row.site,row.siteId)===value);
      const grouped=new Map();
      for(const row of suggestionRows){const company=companyOf(row),kind=row.kind==='Contractor'?'Contractor':'Northstar',key=kind+':'+company.toLowerCase();const item=grouped.get(key)||{company,kind,current:false};item.current ||= row.status!=='checked-out';grouped.set(key,item);}
      crews=[...grouped.values()].sort((a,b)=>Number(b.current)-Number(a.current)||a.company.localeCompare(b.company));
      $('#siteWorkerCrew').innerHTML='<option value="">New person / crew</option>'+crews.map((crew,i)=>'<option value="'+i+'">'+esc(crew.company+' · '+(crew.current?'On site':'Previous visits'))+'</option>').join('');
      companies.innerHTML=[...new Set(crews.map(c=>c.company))].map(company=>'<option value="'+esc(company)+'"></option>').join('');
      hint.textContent=crews.length?'Choose a crew or enter a new company. Previous visits supply suggestions only.':'No previous crew visits found. Enter a new person and company.';
      suggestNames();
    } catch {if(ticket===suggestionTicket)hint.textContent='Crew suggestions unavailable. You can still enter a person manually.';}
  }
  siteSelect.addEventListener('change',loadSuggestions);
  $('#siteWorkerCrew').addEventListener('change',()=>{const value=$('#siteWorkerCrew').value,crew=value===''?null:crews[Number(value)];if(crew){$('#siteWorkerKind').value=crew.kind;$('#siteWorkerCompany').value=crew.company;}suggestNames();});
  $('#siteWorkerCompany').addEventListener('input',suggestNames);
  function signIn(value) {
    form.reset();
    const selected=window.NorthStarSites?.resolve(value);
    siteSelect.innerHTML='<option value="">Choose a station</option>'+(window.NorthStarSites?.stations()||[]).map(row=>'<option value="'+esc(row.name)+'">'+esc(row.name)+'</option>').join('');
    siteSelect.value=selected?.name || '';
    $('#siteWorkerReply').textContent='';
    if(!dialog.open)dialog.showModal();
    (siteSelect.value?$('#siteWorkerName'):siteSelect).focus();
    loadSuggestions();
  }
  dialog.addEventListener('close',()=>{++suggestionTicket;});
  $('#siteCrewAddWorker').onclick=()=>signIn(site);
  $('#siteWorkerCancel').onclick=()=>dialog.close();
  dialog.addEventListener('click',event=>{if(event.target===dialog)dialog.close();});
  form.addEventListener('submit',async event=>{
    event.preventDefault(); const button=$('#siteWorkerSubmit');
    const chosen=window.NorthStarSites?.resolve($('#siteWorkerSite').value);
    const payload={name:$('#siteWorkerName').value.trim(),site:$('#siteWorkerSite').value,siteId:chosen?.id || '',kind:$('#siteWorkerKind').value,company:$('#siteWorkerCompany').value.trim(),contactPhone:$('#siteWorkerPhone').value.trim(),alone:$('#siteWorkerAlone').checked,notes:($('#siteWorkerCrewContact').checked?'[Crew contact] ':'')+$('#siteWorkerNotes').value.trim()};
    if(!chosen){$('#siteWorkerReply').textContent='Choose a station.';siteSelect.focus();return;}
    if(!payload.name || (payload.kind==='Contractor'&&!payload.company)) { $('#siteWorkerReply').textContent=!payload.name?'Enter worker name.':'Enter contractor company.'; return; }
    button.disabled=true;
    try {
      const response=await fetch('/api/checkins',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
      if(!response.ok) { let data={}; try {data=await response.json();}catch{} throw new Error(data.error || 'Check-in service unavailable.'); }
      dialog.close(); window.loadStaff?.(); if(!workspace.hidden && site===payload.site) await openSiteCrew(site,true);
    } catch(error) { $('#siteWorkerReply').textContent=error.message; }
    finally { button.disabled=false; }
  });
  $('#siteCrewDate').addEventListener('change',()=>{if($('#siteCrewDate').value)renderHistory();});
  $('#siteCrewRefresh').onclick=()=>openSiteCrew(site,true);
  $('#siteCrewClose').onclick=()=>{++request;++historyRequest;workspace.hidden=true;$('#crew').classList.remove('site-detail-open');restoreSizing();};
  $('#soloStationButtons')?.addEventListener('click',event=>{const button=event.target.closest('[data-solo-site]');if(button){event.stopPropagation();openStation(button.dataset.soloSite);}});
  $('#staffGroups')?.addEventListener('click',event=>{
    if(document.body.classList.contains('layout-edit'))return;
    const add=event.target.closest('[data-quick-add-site]'),group=event.target.closest('.staff-group');
    if(add){event.stopPropagation();signIn(add.dataset.quickAddSite);return;}
    const person=event.target.closest('.staff-row[data-staff-id]');
    if(person && !event.target.closest('button,.staff-time,.staff-actions,input')){event.stopPropagation();openWorkerProfile(person.dataset.staffId,person.querySelector('[data-worker-profile]'));return;}
    if(group&&!event.target.closest('.staff-row,.module-resize-handle')){event.stopPropagation();openStation(group.dataset.site);}
  });
  $('#staffGroups')?.addEventListener('keydown',event=>{
    if(document.body.classList.contains('layout-edit') || !['Enter',' '].includes(event.key))return;
    const person=event.target.closest('[data-worker-profile]'), heading=event.target.closest('.staff-group > h3');
    if(person){event.preventDefault();event.stopPropagation();openWorkerProfile(person.dataset.workerProfile,person);}
    else if(heading && event.target===heading){event.preventDefault();event.stopPropagation();openStation(heading.closest('.staff-group').dataset.site);}
  });
  $('#crewRows')?.addEventListener('click',event=>{const header=event.target.closest('.crew-site-header');if(header)openSiteCrew(header.querySelector('strong').textContent);});
  const detailVisible=()=>!document.hidden&&!workspace.hidden&&workspace.getClientRects().length>0;
  document.addEventListener('visibilitychange',()=>{if(detailVisible())openSiteCrew(site,true);});
  setInterval(()=>{if(detailVisible()&&!dialog.open)openSiteCrew(site,true);},60000);
  window.NorthstarWorkerDetails={openProfile:openWorkerProfile,signIn};
  window.openSiteCrew=openSiteCrew;
  window.NorthstarOpenStation=openStation;
})();
