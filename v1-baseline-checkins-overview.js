/* Read-only station overview. Station records and entry stay in v1-baseline-site-crew-detail.js. */
(() => {
  'use strict';
  const root = document.querySelector('#crew'), host = document.querySelector('#crewRows');
  if (!root || !host) return;
  const areas = ['Fort Frances','Kenora','Iroquois','Island','Kap','Quebec'];
  const groups = [
    ['fort-frances','fort-frances-ts','calm-lake','sturgeon-falls'],
    ['kenora','norman','okikendawt-gs'], ['twin-falls','iroquois-falls','iroquois-falls-230-kv'],
    ['island-falls'], ['old-woman-falls','white-otter-rapids','camp-three-rapids','big-beaver-falls'],
    ['mcdougal','bird-gs','cogent','aiyers-1','aiyers-2']
  ];
  const areaOf = station => areas[groups.findIndex(ids => ids.includes(station.id.replace(/^site:/,'')))] || 'Other locations';
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  let records = [], unavailable = false, loaded = false, selected = 'All stations', updated = null, returnSite = '';
  const expandedSites = new Set();
  let sitesView = false;
  root.classList.add('checkins-overview');
  root.querySelector(':scope > .panel > h2').textContent = 'Active Workers';
  root.querySelector(':scope > .panel > label').textContent = 'FIELD OPERATIONS';
  const toolbar = document.createElement('nav'); toolbar.className = 'checkins-toolbar'; toolbar.setAttribute('aria-label','Check-in views');
  toolbar.innerHTML = '<div><h3 id="checkinsAreaTitle">All stations</h3><p id="checkinsFeedState" role="status">Loading check-ins…</p></div><div class="checkins-view-buttons"><button type="button" id="checkinsSites" aria-pressed="false">Sites</button><button type="button" id="checkinsRefresh">Refresh</button></div>';
  root.querySelector('.crew-layout').prepend(toolbar);
  toolbar.querySelector('#checkinsRefresh').onclick = () => window.loadStaff?.();
  toolbar.querySelector('#checkinsSites').onclick = () => selectSites(!sitesView);
  const feedState = () => unavailable ? 'Check-in service unavailable \u00b7 Refresh to retry. Occupancy is unknown.' : updated ? `Updated ${updated.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})} \u00b7 Expand a site to see workers` : 'Loading check-ins\u2026';
  const metric = (label, value) => `<div><dt>${label}</dt><dd>${value}</dd></div>`;
  function stationRows() {
    const stations = (window.NorthStarSites?.stations() || []).map(s => ({...s,people:[]}));
    const byId = new Map(stations.map(s => [s.id,s]));
    for (const row of records.filter(r => r.status !== 'checked-out')) {
      const known = window.NorthStarSites?.resolve(row.siteId) || window.NorthStarSites?.resolve(row.site);
      const id = known?.id || row.siteId || `unknown:${row.site || 'Site not recorded'}`;
      if (!byId.has(id)) {const s = {id,name:known?.name || row.site || 'Site not recorded',people:[]};byId.set(id,s);stations.push(s);}
      byId.get(id).people.push(row);
    }
    return stations;
  }
  const overdue = row => Boolean(row.overdue || row.status === 'overdue');
  function card(station, expanded = expandedSites, prefix = 'checkins') {
    const people = station.people, help = people.filter(r=>r.needsHelp).length, late = people.filter(overdue).length;
    const alone = people.filter(r=>r.alone).length, contractors = people.filter(r=>r.kind==='Contractor').length;
    const pending = people.filter(r=>r.status==='provisional').length;
    const state = unavailable || !loaded ? 'unknown' : help ? 'help' : late ? 'late' : pending ? 'pending' : people.length ? 'active' : 'empty';
    const status = {unknown:unavailable?'Unavailable':'Loading',help:`${help} need help`,late:`${late} overdue`,pending:`${pending} pending review`,active:'Checked in',empty:'No active workers'}[state];
    const last = people.map(r=>Date.parse(r.lastHeard)).filter(Number.isFinite).sort((a,b)=>b-a)[0];
    const count = value => unavailable || !loaded ? '—' : value;
    const companies = [...new Set(people.map(r=>r.kind==='Contractor' ? r.company || 'Contractor' : 'NorthStar'))];
    const attention = loaded && !unavailable && late + pending + help > 0;
    const open = expanded.has(station.id), detailsId = `${prefix}-people-${station.id.replace(/[^a-z0-9-]/gi,'-')}`;
    const workers = unavailable || !loaded ? '<p>Current occupancy unknown.</p>' : people.length ? people.map(row => `<div class="checkins-worker"><span><strong>${esc(row.name || 'Unnamed worker')}</strong><small>${esc(row.kind === 'Contractor' ? row.company || 'Contractor' : 'NorthStar')}</small></span><b>${esc(row.needsHelp ? 'NEEDS HELP' : overdue(row) ? 'OVERDUE' : row.status === 'provisional' ? 'PENDING REVIEW' : 'ON SITE')}</b></div>`).join('') : '<p>No workers currently on site.</p>';
    return `<article class="checkins-site" data-state="${state}"><button type="button" class="checkins-station" data-checkins-site="${esc(station.id)}" aria-expanded="${open}" aria-controls="${detailsId}" aria-label="${esc(station.name)}: ${esc(status)}. ${open ? 'Collapse' : 'Expand'} workers"><span class="checkins-card-head"><strong>${esc(station.name)}</strong><span class="checkins-status">${attention ? '<i class="checkins-alert-dot" aria-hidden="true"></i>' : ''}${esc(status)}</span></span><span class="checkins-card-area">${esc(areaOf(station))}</span><span class="checkins-headcount"><b>${count(people.length)}</b> people on site <span class="checkins-chevron" aria-hidden="true">${open ? '▴' : '▾'}</span></span></button><div class="checkins-site-details" id="${detailsId}" ${open ? '' : 'hidden'}><div class="checkins-worker-list">${workers}</div><dl>${metric('NorthStar',count(people.length-contractors))}${metric('Contractors',count(contractors))}${metric('Marked alone',count(alone))}${metric('Overdue',count(late))}${metric('Need help',count(help))}${metric('Pending review',count(pending))}</dl><span class="checkins-companies">${unavailable || !loaded ? 'Current occupancy unknown' : esc(companies.join(' · ') || 'No crew checked in')}</span><span class="checkins-card-foot"><span>Last activity <b>${unavailable || !loaded ? '—' : last ? esc(new Date(last).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})) : '—'}</b></span><button type="button" data-checkins-detail="${esc(station.id)}">View station record →</button></span></div></article>`;
  }
  function activeWorkersContent(visible, expanded = expandedSites, prefix = 'checkins') {
    const people = visible.flatMap(s=>s.people), count = value => unavailable || !loaded ? '\u2014' : value;
    return `<dl class="checkins-summary">${metric('Stations',visible.length)}${metric('People on site',count(people.length))}${metric('Occupied stations',count(visible.filter(s=>s.people.length).length))}${metric('Overdue',count(people.filter(overdue).length))}${metric('Need help',count(people.filter(r=>r.needsHelp).length))}</dl>` + `<div class="checkins-grid">${visible.sort((a,b)=>Number(b.people.some(r=>r.needsHelp))-Number(a.people.some(r=>r.needsHelp)) || Number(b.people.some(overdue))-Number(a.people.some(overdue)) || [...areas,'Other locations'].indexOf(areaOf(a))-[...areas,'Other locations'].indexOf(areaOf(b)) || a.name.localeCompare(b.name)).map(station=>card(station,expanded,prefix)).join('') || '<p>No stations assigned to this area.</p>'}</div>`;
  }
  function render() {
    root.classList.toggle('checkins-sites-view',sitesView);
    toolbar.querySelector('#checkinsSites').setAttribute('aria-pressed',String(sitesView));
    const stations = stationRows(), visible = stations.filter(s => selected === 'All stations' || areaOf(s) === selected);
    const focusSite = document.activeElement?.dataset.checkinsSite;
    document.querySelector('#checkinsAreaTitle').textContent = sitesView ? (selected === 'All stations' ? 'Sites' : 'Sites · '+selected) : selected;
    document.querySelector('#checkinsFeedState').textContent = feedState();
    host.innerHTML = activeWorkersContent(visible);
    if (focusSite) host.querySelector(`[data-checkins-site="${CSS.escape(focusSite)}"]`)?.focus({preventScroll:true});
    syncMenu();
  }
  function syncMenu() {
    document.querySelectorAll('[data-checkins-area]').forEach(button=>{
      const active = button.dataset.checkinsArea===selected;
      button.classList.toggle('active',active);button.setAttribute('aria-current',active?'page':'false');
    });
  }
  function select(area) {
    selected = areas.includes(area) ? area : 'All stations';
    if (!document.querySelector('#siteCrewWorkspace').hidden) document.querySelector('#siteCrewClose').click();
    render();
  }
  function selectSites(value = true) {
    sitesView = value; expandedSites.clear(); select('All stations');
  }
  function mountMenu(tree, module) {
    if (!module || tree.querySelector('.checkins-area-menu')) {syncMenu();return;}
    const menu = document.createElement('div');menu.className='checkins-area-menu';menu.setAttribute('aria-label','Check-in areas');
    const sites = document.createElement('button'); sites.type='button'; sites.textContent='Sites'; sites.dataset.checkinsSites='';
    sites.onclick=()=>{window.NorthstarModules.open(module.id);selectSites();}; menu.append(sites);
    for (const area of areas) {
      const button=document.createElement('button');button.type='button';button.dataset.checkinsArea=area;button.textContent=area;
      button.onclick=()=>{window.NorthstarModules.open(module.id);select(area);};menu.append(button);
    }
    tree.querySelector(`[data-open-module="${CSS.escape(module.id)}"]`)?.closest('.ns-tree-row')?.after(menu);
    syncMenu();
  }
  host.addEventListener('click',event=>{
    const button=event.target.closest('[data-checkins-site]');
    if(button){const id=button.dataset.checkinsSite;if(expandedSites.has(id))expandedSites.delete(id);else expandedSites.add(id);render();return;}
    const detail=event.target.closest('[data-checkins-detail]');if(!detail)return;
    returnSite=detail.dataset.checkinsDetail;
    const station=stationRows().find(s=>s.id===returnSite);
    if(station)window.openSiteCrew(station.name);
  });
  document.querySelector('#siteCrewClose').addEventListener('click',()=>{
    host.querySelector(`[data-checkins-site="${CSS.escape(returnSite)}"]`)?.focus({preventScroll:true});
  });
  window.NorthstarCheckins={areas,select,selectSites,mountMenu};
  const prior=window.renderCrewRows;
  window.renderCrewRows=(rows,failed)=>{const focused=document.activeElement?.dataset.checkinsSite;prior?.(rows,failed);records=rows||[];unavailable=Boolean(failed);loaded=true;if(!failed)updated=new Date();render();if(focused)host.querySelector(`[data-checkins-site="${CSS.escape(focused)}"]`)?.focus({preventScroll:true});};
  window.addEventListener('northstar:sites-display-change',render);
  Promise.resolve(window.NorthStarSites?.ready).then(()=>{render();window.NorthstarModules?.refresh();window.loadStaff?.();});
})();
