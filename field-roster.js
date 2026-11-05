/* Compact field roster; records and actions use the existing check-in service. */
(() => {
  'use strict';
  const section = document.querySelector('#crew');
  if (!section) return;
  section.querySelector(':scope > .panel').dataset.moduleId ||= 'crew-module-0';
  const root = document.createElement('article');
  root.id = 'fieldRoster'; root.className = 'panel field-roster'; root.dataset.moduleId = 'field-roster';
  section.append(root);
  const mounted = new WeakMap(), referenceRoot = root;
  const v3CheckedOut = new Set(), v3Busy = new Set();

  function mount(root, {mirrorAppearance=true,compact=false}={}) {
  if(mounted.has(root))return mounted.get(root);
  root.classList.add('field-roster');
  const overview = root.id === 'overviewWorkerList';
  const overviewV3 = () => overview && document.body.classList.contains('ns-build-v3');
  const isV3 = () => !overview && document.body.classList.contains('ns-build-v3');
  root.setAttribute('aria-label', 'Active Workers');
  root.innerHTML = `<div class="fr-toolbar"><h2>Active Workers</h2><div class="fr-regions" role="group" aria-label="Filter by region">${['All','East','West','QC'].map(region=>`<button type="button" data-fr-region="${region}" aria-pressed="${region==='All'}">${region}</button>`).join('')}</div><input type="search" aria-label="Find person or company" placeholder="Find person / company"><select aria-label="Station"><option value="">All stations</option></select><select aria-label="Presence"><option value="active">In the field</option><option value="all">All visits</option><option value="out">Checked out</option></select><button type="button" data-fr-refresh>Refresh</button><button type="button" data-fr-add>Add person</button><details class="fr-columns"><summary>Columns</summary><div></div></details><span role="status">Loading…</span></div><div class="fr-scroll"><table aria-label="People by station"><thead><tr><th scope="col">Person</th><th scope="col" data-fr-col="company">Company</th><th scope="col" data-fr-col="in">Time in</th><th scope="col" data-fr-col="out">Time out</th><th scope="col" data-fr-col="seen">Last seen</th><th scope="col" data-fr-col="status">Status</th><th scope="col">Actions</th></tr></thead><tbody></tbody></table></div>`;
  if(compact)root.querySelector('thead').innerHTML='<tr><th scope="col">Person</th><th scope="col" data-fr-col="company">Company</th><th scope="col">Station</th><th scope="col" data-fr-col="in">Time in</th><th scope="col" data-fr-col="seen">Last seen</th><th scope="col" data-fr-col="status">Status</th></tr>';
  const $ = s => root.querySelector(s), esc = v => String(v ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const search = $('input[type=search]'), station = $('select[aria-label=Station]'), presence = $('select[aria-label=Presence]'), status = $('[role=status]');
  const originalHead = $('thead').innerHTML;
  const countLabel = document.createElement('span'); countLabel.className='fr-v3-count'; countLabel.hidden=true;
  $('.fr-toolbar').insertBefore(countLabel, status);
  let reduced = false, actionError = '', lastUpdated = '';
  const stamp = (v, row) => {
    if (!v || !Number.isFinite(Date.parse(v))) return '—';
    const date = new Date(v);
    if(isV3()){
      const time=date.toLocaleTimeString('en-CA',{timeZone:'America/Toronto',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
      const day=date.toLocaleDateString('en-CA',{timeZone:'America/Toronto'}),today=new Date().toLocaleDateString('en-CA',{timeZone:'America/Toronto'});
      return time+(day===today?'':' · '+day.slice(5).replace('-','/'));
    }
    if (!overview) return date.toLocaleString([], compact?{hour:'2-digit',minute:'2-digit',hourCycle:'h23'}:{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'});
    const start = new Date(row.checkedIn), end = row.status === 'checked-out' ? new Date(row.checkedOutAt) : new Date();
    const overnight = Number.isFinite(start.getTime()) && Number.isFinite(end.getTime()) && start.toDateString() !== end.toDateString();
    const time = date.toLocaleTimeString([], {hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
    return (overnight ? `${String(date.getMonth()+1).padStart(2,'0')}/${String(date.getDate()).padStart(2,'0')} ` : '') + time;
  };
  const siteOf = r => window.NorthStarSites?.resolve(r.siteId) || window.NorthStarSites?.resolve(r.site) || {id:r.siteId || r.site || "unknown",name:r.site || "Unassigned"};
  let rows = [], failed = false, loading = false, regionFilter = 'All';
  const regionOf = s => {
    const area=String((window.NorthStarSites?.resolve(s.id) || s).area || '').toLowerCase();
    return ({east:'East',west:'West',central:'CEN',cen:'CEN',quebec:'QC',qc:'QC'})[area] || '';
  };
  root.querySelectorAll('[data-fr-region]').forEach(button=>button.onclick=()=>{
    regionFilter=button.dataset.frRegion;
    root.querySelectorAll('[data-fr-region]').forEach(b=>b.setAttribute('aria-pressed',String(b===button)));
    station.value='';render();
  });
  const busy = new Set(), hidden = new Set();
  try { for (const col of JSON.parse(localStorage.getItem('northstarFieldRosterColumnsV1') || '[]')) hidden.add(col); } catch {}
  for (const [key,title] of Object.entries({company:'Company',in:'Time in',out:'Time out',seen:'Last seen',status:'Status'})) {
    if(compact&&key==='out')continue;
    const label=document.createElement('label'); label.innerHTML=`<input type="checkbox" ${hidden.has(key)?'':'checked'} value="${key}">${title}`;
    label.querySelector('input').onchange=event=>{event.target.checked?hidden.delete(key):hidden.add(key);try{localStorage.setItem('northstarFieldRosterColumnsV1',JSON.stringify([...hidden]));}catch{}render();};
    $('.fr-columns > div').append(label);
  }
  function stations() {
    const map = new Map((window.NorthStarSites?.stations() || []).map(s=>[s.id,s]));
    rows.forEach(r=>{const s=siteOf(r);map.set(s.id,s);});
    return [...map.values()];
  }
  function syncAppearance() {
    if(root===referenceRoot || !mirrorAppearance)return;
    const style=getComputedStyle(referenceRoot);
    for(const name of ['--panel','--panel2','--line','--text','--muted','--blue','--gold'])root.style.setProperty(name,style.getPropertyValue(name));
    for(const name of ['background-color','color','padding'])root.style.setProperty(name,style.getPropertyValue(name),'important');
    const heading=getComputedStyle(referenceRoot.querySelector('.fr-toolbar h2'));
    for(const name of ['font','margin','letter-spacing','color'])$('.fr-toolbar h2').style.setProperty(name,heading.getPropertyValue(name),'important');
    root.parentElement.style.setProperty('--ns-roster-background',style.backgroundColor);
    root.parentElement.style.setProperty('--ns-roster-border',style.borderColor);
  }
  if(root!==referenceRoot && mirrorAppearance){
    const appearance=new MutationObserver(syncAppearance);
    appearance.observe(referenceRoot,{attributes:true,attributeFilter:['style','class','data-ns-theme']});
    appearance.observe(document.body,{attributes:true,attributeFilter:['class','data-ui-style']});
  }
  const companyOf = r => String(r.company || (r.kind==='Contractor'?'Contractor':'NorthStar')).trim();
  const companyKey = r => {
    const key=companyOf(r).toLowerCase().replace(/[^a-z0-9]/g,'');
    return ['northstar','northstarenergy'].includes(key)?'northstar':key;
  };
  const companyTone = r => companyKey(r)==='northstar'?0:1+[...companyKey(r)].reduce((h,c)=>(h*31+c.charCodeAt(0))>>>0,0)%5;
  function configureV3() {
    const next=isV3(); if(next===reduced)return;
    reduced=next; root.classList.toggle('fr-v3',next);countLabel.hidden=!next;
    const add=$('[data-fr-add]');
    if(next){
      $('.fr-toolbar').insertBefore(add,$('h2'));
      $('thead').innerHTML=`<tr><th scope="col">Person</th><th scope="col" data-fr-col="company">Company</th>${overview?'':'<th scope="col">Station</th>'}<th scope="col" data-fr-col="in">Time in</th><th scope="col" data-fr-col="status">Status</th><th scope="col"><span class="fr-v3-sr">Check out</span></th></tr>`;
      if(overview){const columns=document.createElement('colgroup');columns.className='fr-v3-columns';columns.innerHTML='<col style="width:30%"><col style="width:23%"><col style="width:18%"><col><col style="width:30px">';$('table').insertBefore(columns,$('thead'));}
    }else{
      $('.fr-toolbar').insertBefore(add,$('.fr-columns'));
      $('thead').innerHTML=originalHead;
      $('.fr-v3-columns')?.remove();
    }
    // Only switching builds rebuilds the table. Refreshes reconcile keyed rows below.
    $('tbody').replaceChildren();actionError='';
  }
  function canonicalStation(row) {
    const station=window.NorthStarSites?.resolve(row.siteId)||window.NorthStarSites?.resolve(row.site);
    return station && window.NorthStarSites.stations().some(site=>site.id===station.id) ? station : null;
  }
  function reconcileV3(markup) {
    const body=$('tbody'), template=document.createElement('template');template.innerHTML=`<table><tbody>${markup}</tbody></table>`;
    for(const row of [...body.children])if(!row.dataset.frKey)row.remove();
    const existing=new Map([...body.children].map(row=>[row.dataset.frKey,row]));
    let cursor=body.firstElementChild;
    for(const fresh of template.content.querySelector('tbody').children){
      const key=fresh.dataset.frKey;let row=existing.get(key);existing.delete(key);
      if(!row){row=fresh.cloneNode(true);row._frMarkup=fresh.innerHTML;}
      else {
        if(row._frMarkup!==fresh.innerHTML){row.innerHTML=fresh.innerHTML;row._frMarkup=fresh.innerHTML;}
        for(const attribute of [...row.attributes])if(!fresh.hasAttribute(attribute.name))row.removeAttribute(attribute.name);
        for(const attribute of fresh.attributes)if(row.getAttribute(attribute.name)!==attribute.value)row.setAttribute(attribute.name,attribute.value);
      }
      if(row!==cursor)body.insertBefore(row,cursor);cursor=row.nextElementSibling;
    }
    existing.forEach(row=>row.remove());
  }
  function renderV3() {
    const open=rows.filter(row=>row.status!=='checked-out'&&!v3CheckedOut.has(String(row.id)));
    const omitted=overview?open.filter(row=>!canonicalStation(row)):[];
    const query=overview?'':search.value.trim().toLowerCase();
    const active=open.filter(row=>(!overview||canonicalStation(row))&&`${row.name} ${companyOf(row)} ${siteOf(row).name}`.toLowerCase().includes(query));
    const layout=window.NorthStarWorkerSiteGroups||[];
    const layoutIds=layout.map(names=>names.map(name=>window.NorthStarSites?.resolve(name)?.id||name));
    const groupOf=site=>{const index=layoutIds.findIndex(ids=>ids.includes(site.id));return index<0?layout.length:index;};
    const siteOrder=(a,b)=>Number(!canonicalStation(a))-Number(!canonicalStation(b))||groupOf(siteOf(a))-groupOf(siteOf(b))||(layoutIds[groupOf(siteOf(a))]?.indexOf(siteOf(a).id)??0)-(layoutIds[groupOf(siteOf(b))]?.indexOf(siteOf(b).id)??0)||siteOf(a).name.localeCompare(siteOf(b).name);
    active.sort((a,b)=>siteOrder(a,b)||Number(companyKey(b)==='northstar')-Number(companyKey(a)==='northstar')||companyKey(a).localeCompare(companyKey(b))||Number(Boolean(b.alone))-Number(Boolean(a.alone))||String(a.name).localeCompare(String(b.name)));
    const palette=['#66b9e8','#b795e8','#e0b469','#66c5a5','#e28ead','#91a5b8'];
    const markup=[];let previousSite='';
    active.forEach((row,index)=>{
      const site=siteOf(row),area=groupOf(site),key=companyKey(row),previous=active[index-1],next=active[index+1];
      const first=!previous||siteOf(previous).id!==site.id||companyKey(previous)!==key,last=!next||siteOf(next).id!==site.id||companyKey(next)!==key;
      const help=row.needsHelp||['requested','acknowledged'].includes(row.helpState),overdue=row.overdue||row.status==='overdue',pending=row.status==='provisional';
      const state=help?'Needs help':pending?'Pending review':overdue?'Overdue':row.alone?'Working alone':'On site';
      if(overview&&previousSite!==site.id){
        markup.push(`<tr data-fr-key="station:${esc(site.id)}" data-fr-group="${area}" class="fr-station"><th colspan="5" scope="rowgroup">${esc(site.name)} <span>${active.filter(person=>siteOf(person).id===site.id).length}</span></th></tr>`);previousSite=site.id;
      }
      const unknown=!canonicalStation(row),stationTitle=unknown?`${site.name} — outside configured station catalog`:site.name;
      markup.push(`<tr data-fr-key="person:${esc(row.id)}" data-fr-id="${esc(row.id)}" data-fr-group="${area}" style="--group-color:${palette[area%palette.length]}" class="fr-company-${companyTone(row)}${first?' fr-company-start':''}${last?' fr-company-end':''}${help?' fr-help':overdue?' fr-overdue':''}"><td><button type="button" class="fr-person" data-fr-action="profile" title="Open ${esc(row.name)} details">${esc(row.name)}</button></td><td data-fr-col="company" title="${esc(companyOf(row))}">${esc(companyOf(row))}</td>${overview?'':`<td title="${esc(stationTitle)}">${esc(site.name)}${unknown?' <span class="fr-v3-other" aria-label="Outside station catalog">*</span>':''}</td>`}<td data-fr-col="in" title="${esc(row.checkedIn)}">${esc(stamp(row.checkedIn,row))}</td><td data-fr-col="status" title="${esc(state)}" data-presence="${help?'help':pending?'pending':overdue?'overdue':'active'}">${esc(state)}</td><td class="fr-actions">${pending?'':`<button type="button" data-fr-action="out" aria-label="Check out ${esc(row.name)}" title="Check out ${esc(row.name)}">×</button>`}</td></tr>`);
    });
    reconcileV3(markup.join('')||`<tr data-fr-key="empty"><td colspan="${overview?5:6}" class="fr-empty">${loading?'Loading…':query?'No matching people':'No active workers'}</td></tr>`);
    const groupRows=[...root.querySelectorAll('tbody tr[data-fr-group]')];
    groupRows.forEach((row,index)=>{
      row.style.setProperty('--group-color',palette[Number(row.dataset.frGroup)%palette.length]);
      row.classList.toggle('fr-group-start',groupRows[index-1]?.dataset.frGroup!==row.dataset.frGroup);
      row.classList.toggle('fr-group-end',groupRows[index+1]?.dataset.frGroup!==row.dataset.frGroup);
    });
    root.querySelectorAll('[data-fr-id]').forEach(row=>row.querySelectorAll('.fr-actions button').forEach(button=>{button.disabled=failed||v3Busy.has(row.dataset.frId);}));
    countLabel.textContent=`${active.length} people`;
    const attention=omitted.filter(row=>row.needsHelp||['requested','acknowledged'].includes(row.helpState)||row.overdue||row.status==='overdue'||row.status==='provisional').length;
    const outside=omitted.length?`${omitted.length} outside station catalog${attention?` (${attention} need attention)`:''}; see Checkins`:'';
    if(!failed)status.textContent=actionError||(loading?'Refreshing…':outside||(lastUpdated?'Updated '+lastUpdated:''));
    status.title=outside||status.textContent;
  }
  function render() {
    configureV3();
    if(overviewV3())$('.fr-toolbar').insertBefore($('[data-fr-add]'),$('h2'));
    syncAppearance();
    if(reduced){renderV3();return;}
    const focusId = document.activeElement?.closest('[data-fr-id]')?.dataset.frId;
    const focusAction = document.activeElement?.dataset.frAction;
    const selected=station.value, sites=stations();
    station.innerHTML='<option value="">All stations</option>'+sites.map(s=>`<option value="${esc(s.id)}">${esc(s.name)}</option>`).join(''); station.value=selected;
    const query=search.value.trim().toLowerCase(); let count=0;
    let layout=window.NorthStarWorkerSiteGroups || [];
    if(!layout.length)try { layout=JSON.parse(document.querySelector('#nsStatusWorkers')?.dataset.stationGroups || '[]'); } catch {}
    const siteKey = s => window.NorthStarSites?.resolve(s.id)?.id || window.NorthStarSites?.resolve(s.name)?.id || s.id;
    const layoutIds=layout.map(names=>names.map(name=>window.NorthStarSites?.resolve(name)?.id || name));
    const groupOf = s => {const i=layoutIds.findIndex(ids=>ids.includes(siteKey(s)));return i<0?layout.length:i;};
    const selectedSites=sites.filter(s=>(regionFilter==='All' || regionOf(s)===regionFilter) && (!station.value || s.id===station.value)).sort((a,b)=>groupOf(a)-groupOf(b) || (layoutIds[groupOf(a)]?.indexOf(siteKey(a))??0)-(layoutIds[groupOf(b)]?.indexOf(siteKey(b))??0) || a.name.localeCompare(b.name));
    let previousArea=-1;
    const markup=selectedSites.map(s=>{
      const people=rows.filter(r=>siteOf(r).id===s.id && (!overviewV3() || !v3CheckedOut.has(String(r.id))) && (presence.value==='all' || (presence.value==='out')===(r.status==='checked-out')) && `${r.name} ${r.company || ''}`.toLowerCase().includes(query)).sort((a,b)=>Number(companyKey(b)==='northstar')-Number(companyKey(a)==='northstar') || companyKey(a).localeCompare(companyKey(b)) || Number(Boolean(b.alone))-Number(Boolean(a.alone)) || a.name.localeCompare(b.name));
      if (!people.length && (query || presence.value!=='active')) return '';
      const quickAdd=`<button type="button" class="fr-site-add" data-fr-add-site="${esc(s.id)}" aria-label="Add person at ${esc(s.name)}" title="Add person at ${esc(s.name)}">+</button>`;
      count+=people.length;
      const area=groupOf(s);
      return (compact?'':`<tr data-fr-group="${area}" class="fr-station"><th colspan="7" scope="rowgroup">${esc(s.name)} ${quickAdd} <span>${people.length}</span></th></tr>`)+ (people.map((r,index)=>{
        const out=r.status==='checked-out', provisional=r.status==='provisional', contact=String(r.notes || '').startsWith('[Crew contact]');
        const company=companyOf(r);
        const key=companyKey(r), first=index===0 || companyKey(people[index-1])!==key, last=index===people.length-1 || companyKey(people[index+1])!==key;
        const companyClass=`fr-company-${companyTone(r)}${first?' fr-company-start':''}${last?' fr-company-end':''}`;
        const state=r.needsHelp?'Needs help':out?'Checked out':provisional?'Pending review':r.overdue || r.status==='overdue'?'Overdue':r.alone?'Working alone':'On site';
        if(compact)return `<tr data-fr-group="${area}" data-fr-id="${esc(r.id)}" class="${companyClass} ${r.needsHelp?'fr-help':r.overdue?'fr-overdue':''}"><td><button type="button" class="fr-person" data-fr-action="profile" title="Open person details">${esc(r.name)}${overview && r.alone ? ' <strong class="fr-alone">Alone</strong>' : ''}</button></td><td data-fr-col="company" title="${esc(company)}">${esc(company)}</td><td title="${esc(s.name)}"><span>${esc(s.name)}</span> ${quickAdd}</td><td data-fr-col="in" title="${esc(r.checkedIn)}">${esc(stamp(r.checkedIn,r))}</td><td data-fr-col="seen" title="${esc(r.lastHeard)}">${esc(stamp(r.lastHeard,r))}</td><td data-fr-col="status" title="${esc(state)}" data-presence="${r.needsHelp?'help':r.overdue||r.status==='overdue'?'overdue':out?'out':provisional?'pending':'active'}">${state}</td></tr>`;
        return `<tr data-fr-group="${area}" data-fr-id="${esc(r.id)}" class="${companyClass} ${r.needsHelp?'fr-help':r.overdue?'fr-overdue':''}"><td><button type="button" class="fr-person" data-fr-action="profile" title="Open person details">${esc(r.name)}${overview && r.alone ? ' <strong class="fr-alone">Alone</strong>' : ''}${contact?` <span>— ${esc(company)} · crew contact</span>`:''}</button></td><td data-fr-col="company" title="${esc(company)}">${esc(company)}</td><td data-fr-col="in">${esc(stamp(r.checkedIn,r))}</td><td data-fr-col="out">${esc(stamp(r.checkedOutAt,r))}</td><td data-fr-col="seen">${esc(stamp(r.lastHeard,r))}</td><td data-fr-col="status">${state}</td><td class="fr-actions">${out?'<button type="button" data-fr-action="return">Check in</button>':provisional?'<button type="button" data-fr-action="accept">Accept</button><button type="button" data-fr-action="reject">Reject</button>':'<button type="button" data-fr-action="in">Check in</button><button type="button" data-fr-action="out">Check out</button>'}</td></tr>`;
      }).join('') || (compact?`<tr data-fr-group="${area}"><td class="fr-empty">No one on site</td><td data-fr-col="company"></td><td>${esc(s.name)} ${quickAdd}</td><td colspan="3"></td></tr>`:'<tr><td colspan="7" class="fr-empty">No one on site</td></tr>'));
    }).join('') || '<tr><td colspan="'+(compact?6:7)+'" class="fr-empty">No matching people</td></tr>';
    if(overviewV3()){
      const template=document.createElement('template');template.innerHTML='<table><tbody>'+markup+'</tbody></table>';
      let stationKey='empty';
      for(const row of template.content.querySelector('tbody').children){
        if(row.classList.contains('fr-station'))stationKey=row.querySelector('[data-fr-add-site]')?.dataset.frAddSite||row.textContent;
        row.dataset.frKey=row.dataset.frId?'person:'+row.dataset.frId:(row.classList.contains('fr-station')?'station:':'empty:')+stationKey;
        const button=row.querySelector('[data-fr-action="out"]');if(button){button.textContent='×';button.setAttribute('aria-label','Check out '+(rows.find(r=>String(r.id)===row.dataset.frId)?.name||'person'));button.title=button.getAttribute('aria-label');}
      }
      reconcileV3(template.content.querySelector('tbody').innerHTML);
    }else $('tbody').innerHTML=markup;
    const groupRows=[...root.querySelectorAll('tbody tr[data-fr-group]')];
    const palette=['#66b9e8','#b795e8','#e0b469','#66c5a5','#e28ead','#91a5b8'];
    groupRows.forEach((row,index)=>{
      row.style.setProperty('--group-color',palette[Number(row.dataset.frGroup)%palette.length]);
      row.classList.toggle('fr-group-start',groupRows[index-1]?.dataset.frGroup!==row.dataset.frGroup);
      row.classList.toggle('fr-group-end',groupRows[index+1]?.dataset.frGroup!==row.dataset.frGroup);
    });
    root.querySelectorAll('[data-fr-col]').forEach(el=>el.hidden=hidden.has(el.dataset.frCol));
    root.querySelectorAll('[data-fr-id]').forEach(el=>el.querySelectorAll('.fr-actions button').forEach(b=>b.disabled=failed || (!overviewV3() && loading) || busy.has(el.dataset.frId) || (overviewV3() && v3Busy.has(el.dataset.frId))));
    if(focusId)root.querySelector(`[data-fr-id="${CSS.escape(focusId)}"] [data-fr-action="${CSS.escape(focusAction || 'profile')}"]`)?.focus({preventScroll:true});
    if(!failed)status.textContent=actionError||(loading&&!overviewV3()?'Refreshing…':`${count} people`);
  }
  async function refresh() {
    if(loading)return; loading=true; render();
    try {
      await window.northstarOperatorSession;
      const data=await window.NorthstarRoster.load(isV3()?{force:true}:undefined); if(!Array.isArray(data))throw Error('Invalid roster response.');
      rows=data; failed=false;lastUpdated=new Date().toLocaleTimeString('en-CA',{timeZone:'America/Toronto',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});window.dispatchEvent(new CustomEvent('northstar:field-roster-data',{detail:rows}));
    } catch(error) {failed=true;status.textContent=error.message+' Displayed records may be stale.';}
    finally {loading=false;render();}
  }
  function add(row) {
    const site = row ? siteOf(row).name : isV3() ? undefined : stations().find(s=>s.id===station.value)?.name;
    window.NorthstarWorkerDetails?.signIn(site);
    if(row) {document.querySelector('#siteWorkerName').value=row.name;document.querySelector('#siteWorkerKind').value=row.kind;document.querySelector('#siteWorkerCompany').value=row.company || '';}
  }
  root.addEventListener('click',async event=>{
    if(isV3() || (overviewV3() && event.target.closest('[data-fr-action=out]'))){
      const tr=event.target.closest('[data-fr-id]');if(!tr)return;
      const row=rows.find(row=>String(row.id)===tr.dataset.frId);if(!row)return;
      const button=event.target.closest('[data-fr-action]'),action=button?.dataset.frAction||'profile';
      if(action==='profile'){
        const trigger=tr.querySelector('.fr-person');
        if(window.NorthStarV3Data?.openWorker)window.NorthStarV3Data.openWorker(row,trigger);
        else window.NorthstarWorkerDetails?.openProfile(row.id,trigger);
        return;
      }
      if(action!=='out'||failed||v3Busy.has(String(row.id))||row.status==='provisional')return;
      const id=String(row.id);v3Busy.add(id);actionError='';window.dispatchEvent(new Event('northstar:field-roster-v3-change'));
      try{
        const response=await fetch('/api/checkins/'+encodeURIComponent(id),{method:'DELETE',headers:{'Content-Type':'application/json'}});
        if(!response.ok)throw Error('Checkout failed. No change confirmed; retry.');
        v3CheckedOut.add(id);window.dispatchEvent(new Event('northstar:field-roster-v3-change'));
        // The shared roster fetch wrapper invalidates every view and other open windows.
      }catch(error){actionError=error.message;}
      finally{v3Busy.delete(id);window.dispatchEvent(new Event('northstar:field-roster-v3-change'));}
      return;
    }
    const siteAdd=event.target.closest('[data-fr-add-site]');
    if(siteAdd){window.NorthstarWorkerDetails?.signIn(siteAdd.dataset.frAddSite);return;}
    const button=event.target.closest('[data-fr-action]'), tr=button?.closest('[data-fr-id]');if(!tr)return;
    const row=rows.find(r=>String(r.id)===tr.dataset.frId), action=button.dataset.frAction;if(!row)return;
    if(action==='profile'){window.NorthstarWorkerDetails?.openProfile(row.id,button);return;}
    if(action==='return'){add(row);return;}
    if(busy.has(row.id))return;
    if(action==='reject'&&!confirm('Reject this provisional check-in? Its history is retained.'))return;
    busy.add(row.id);render();
    try {
      const path='/api/checkins/'+encodeURIComponent(row.id)+(action==='in'?'/safety-checkin':['accept','reject'].includes(action)?'/provisional':'');
      const options={method:action==='out'?'DELETE':'POST',headers:{'Content-Type':'application/json'},...(action==='out'?{}:{body:JSON.stringify(action==='in'?{}:{accept:action==='accept'})})};let response=await fetch(path,options);if(action==='in'&&response.status===404)response=await fetch(path.replace('/safety-checkin','/heartbeat'),options);
      if(!response.ok)throw Error('Action failed. No change confirmed; refresh and retry.');
      await refresh();window.loadStaff?.();
    } catch(error) {status.textContent=error.message;}
    finally {busy.delete(row.id);tr.querySelectorAll('button').forEach(b=>b.disabled=false);root.querySelectorAll(`[data-fr-id="${CSS.escape(String(row.id))}"] .fr-actions button`).forEach(b=>b.disabled=failed);}
  });
  root.addEventListener('dblclick',event=>{if(isV3()||event.target.closest('button,input,select'))return;const tr=event.target.closest('[data-fr-id]');if(tr)window.NorthstarWorkerDetails?.openProfile(tr.dataset.frId,tr.querySelector('.fr-person'));});
  search.oninput=render;station.onchange=render;presence.onchange=render;
  $('[data-fr-refresh]').onclick=refresh;$('[data-fr-add]').onclick=()=>add();
  window.addEventListener('northstar:field-roster-data',event=>{rows=event.detail;failed=false;render();});
  window.addEventListener('northstar:roster-error',event=>{failed=true;status.textContent=event.detail+' Displayed records may be stale.';render();});
  window.addEventListener('northstar:sites-display-change',render);
  window.addEventListener('northstar:worker-site-groups',render);
  window.addEventListener('northstar:field-roster-v3-change',()=>{if(isV3()||overviewV3())render();});
  window.addEventListener('northstar:build-view-change',render);
  new MutationObserver(()=>{if(isV3()!==reduced)render();}).observe(document.body,{attributes:true,attributeFilter:['class']});
  document.querySelector('#siteWorkerDialog')?.addEventListener('close',refresh);
  document.addEventListener('visibilitychange',()=>{if(!document.hidden&&root.getClientRects().length)refresh();});
  setInterval(()=>{if(!document.hidden&&root.getClientRects().length)refresh();},30000);
  Promise.resolve(window.NorthStarSites?.ready).then(()=>{window.NorthstarModules?.refresh();refresh();});
  const view={refresh};mounted.set(root,view);return view;
  }
  window.NorthstarFieldRoster={mount};
  mount(root);
})();

