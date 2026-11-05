/* Build v3 data surfaces. The shared roster and append-only event ledger remain authoritative. */
(() => {
  'use strict';
  const mounted = new WeakMap(), views = new Set(), checkedOut = new Set();
  let profileRequest = 0;
  const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const time = (value, date = false) => {
    if (!value || !Number.isFinite(Date.parse(value))) return '—';
    return new Date(value).toLocaleString('en-CA', {timeZone:'America/Toronto', ...(date ? {month:'2-digit',day:'2-digit'} : {}), hour:'2-digit',minute:'2-digit', ...(date ? {second:'2-digit'} : {}), hourCycle:'h23'});
  };
  const workerTime = value => {
    if (!value || !Number.isFinite(Date.parse(value))) return '—';
    const day = date => new Date(date).toLocaleDateString('en-CA',{timeZone:'America/Toronto'});
    if (day(value) === day(Date.now())) return time(value);
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:'America/Toronto',month:'2-digit',day:'2-digit'}).formatToParts(new Date(value)).map(part => [part.type,part.value]));
    return `${parts.month}/${parts.day} ${time(value)}`;
  };
  const listen = (target, name, fn, disposers) => { target?.addEventListener(name, fn); disposers.push(() => target?.removeEventListener(name, fn)); };
  const visible = host => !document.hidden && host.isConnected && host.getClientRects().length > 0;

  async function openWorker(row, trigger) {
    const current = ++profileRequest;
    document.querySelector('#workerProfileSnapshot .v3-profile-actions')?.remove();
    let rosterAvailable = true;
    await Promise.all([
      window.NorthstarWorkerDetails?.openProfile(row.id, trigger),
      window.NorthstarRoster?.load({force:true}).catch(() => { rosterAvailable = false; })
    ]);
    const profile = document.querySelector('#workerProfileSnapshot');
    if (!profile?.open || current !== profileRequest) return;
    // The shared profile catches read failures itself. Never offer mutations on its error state.
    if (profile.querySelector('.worker-profile-body') && !profile.querySelector('.worker-profile-summary')) return;
    if (!profile.dataset.v3ActionsBound) {
      profile.dataset.v3ActionsBound = 'true';
      profile.addEventListener('close',() => { ++profileRequest; profile.querySelector('.v3-profile-actions')?.remove(); });
    }
    const worker = window.NorthstarRoster?.rows?.find(item => String(item.id) === String(row.id)) || row;
    if (worker.status === 'checked-out') return;
    const actions = document.createElement('section'); actions.className = 'v3-profile-actions';
    const knownHelpState = ['requested','acknowledged'].includes(worker.helpState);
    const available = rosterAvailable && (!worker.needsHelp || knownHelpState);
    const buttons = !available ? [] : worker.helpState === 'requested' ? [['acknowledge','Acknowledge help request']] : worker.helpState === 'acknowledged' ? [['resolve','Mark help resolved']] : worker.status === 'provisional' ? [['accept','Accept check-in'],['reject','Reject check-in']] : [['heartbeat','Record check-in']];
    actions.innerHTML = '<h3>Visit actions</h3><div>' + buttons.map(([action,label]) => `<button type="button" data-v3-worker-action="${action}">${label}</button>`).join('') + '</div><p role="status" aria-live="polite"></p>';
    profile.append(actions);
    if (!available) actions.querySelector('[role=status]').textContent = 'Current worker status is unavailable. Close and reopen the profile before responding.';
    actions.addEventListener('click', async event => {
      const button = event.target.closest('[data-v3-worker-action]'); if (!button || button.disabled) return;
      const action = button.dataset.v3WorkerAction;
      // Keep the existing explicit safeguards for closing a provisional visit or a help request.
      if (action === 'reject' && !confirm('Reject this check-in? The record is closed but stays in the audit log.')) return;
      if (action === 'resolve' && !confirm('Confirm this help request is resolved?')) return;
      actions.querySelectorAll('button').forEach(item => item.disabled = true);
      const status = actions.querySelector('[role=status]'); status.textContent = 'Saving…';
      let confirmed = false;
      try {
        const suffix = ['accept','reject'].includes(action) ? '/provisional' : ['acknowledge','resolve'].includes(action) ? '/help/' + action : '/safety-checkin';
        const options = {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(['accept','reject'].includes(action) ? {accept:action === 'accept'} : {})};let response = await fetch('/api/checkins/' + encodeURIComponent(worker.id) + suffix, options);if(action==='heartbeat'&&response.status===404)response=await fetch('/api/checkins/'+encodeURIComponent(worker.id)+'/heartbeat',options);
        if (!response.ok) { let result = {}; try { result = await response.json(); } catch {} throw Error(result.error || 'The action was not confirmed.'); }
        confirmed = true; status.textContent = 'Saved';
        await window.NorthstarRoster?.load({force:true});
        window.loadOps?.();
        if (profile.open && current === profileRequest) await openWorker(worker,trigger);
      } catch (cause) {
        status.textContent = confirmed ? 'Saved. Updated records could not be loaded. Close and reopen the profile to refresh.' : cause.message + ' No change confirmed; retry when available.';
        if (!confirmed) actions.querySelectorAll('button').forEach(item => item.disabled = false);
      }
    });
  }

  // Reconcile only changed records. Refreshing never clears the list or replaces unchanged rows.
  function reconcile(body, entries) {
    const old = new Map([...body.children].map(row => [row.dataset.v3Key, row]));
    let previous = null;
    for (const entry of entries) {
      let row = old.get(entry.key);
      if (!row) { row = document.createElement('tr'); row.dataset.v3Key = entry.key; }
      old.delete(entry.key);
      if (row._v3Markup !== entry.markup) { row.innerHTML = entry.markup; row._v3Markup = entry.markup; }
      row.className = entry.className || '';
      if (entry.workerId !== undefined) row.dataset.v3Worker = entry.workerId;
      if (entry.eventId !== undefined) { row.dataset.v3Event = entry.eventId; row.tabIndex = 0; }
      if ((previous ? previous.nextSibling : body.firstChild) !== row) body.insertBefore(row, previous ? previous.nextSibling : body.firstChild);
      previous = row;
    }
    old.forEach(row => row.remove());
  }

  function lifecycle(host, refresh, disposers, extra = {}) {
    let active = true, destroyed = false;
    const view = {
      ...extra, refresh,
      activate() { if (destroyed) return; active = true; return refresh(); },
      deactivate() { active = false; },
      destroy() { if (destroyed) return; destroyed = true; active = false; disposers.splice(0).forEach(dispose => dispose()); views.delete(view); mounted.delete(host); },
      get active() { return active && !destroyed; }
    };
    const interval = setInterval(() => { if (view.active && visible(host)) refresh(); }, 30000);
    disposers.push(() => clearInterval(interval));
    listen(document, 'visibilitychange', () => { if (view.active && visible(host)) refresh(); }, disposers);
    mounted.set(host, view); views.add(view); return view;
  }

  function mountWorkers(host, {overview = false} = {}) {
    if (!host) throw Error('A worker list host is required.');
    if (mounted.has(host)) return mounted.get(host);
    const disposers = [], busy = new Set();
    let rows = window.NorthstarRoster?.rows || [], loading = false, failed = false, loaded = Array.isArray(window.NorthstarRoster?.rows), statusMessage = '', lastUpdated = null;
    host.classList.add('v3-data', 'v3-workers'); host.classList.toggle('v3-workers-overview', overview);
    host.setAttribute('aria-label', 'Active workers');
    host.innerHTML = `<header class="v3-data-header">${overview ? '' : '<h2>Active Workers</h2>'}<button type="button" data-v3-add>Add person</button>${overview ? '' : '<input type="search" class="v3-worker-search" aria-label="Find worker, company or station" placeholder="Find person, company or station">'}<span class="v3-data-count"></span><span class="v3-data-freshness" role="status" aria-live="polite"></span><button type="button" class="v3-refresh" data-v3-refresh aria-label="Refresh workers" title="Refresh workers">↻</button></header><p class="v3-data-error" role="alert" hidden></p><div class="v3-data-scroll"><table class="v3-worker-table" aria-label="Active workers"><colgroup><col class="v3-col-person"><col class="v3-col-company">${overview ? '' : '<col class="v3-col-station">'}<col class="v3-col-time"><col class="v3-col-state"><col class="v3-col-action"></colgroup><thead><tr><th scope="col">Person</th><th scope="col">Company</th>${overview ? '' : '<th scope="col">Station</th>'}<th scope="col">In · ET</th><th scope="col">Status</th><th scope="col"><span class="v3-sr-only">Check out</span></th></tr></thead><tbody></tbody></table></div>`;
    const $ = selector => host.querySelector(selector), body = $('tbody'), search = $('.v3-worker-search'), status = $('.v3-data-freshness'), error = $('.v3-data-error');
    const siteOf = row => window.NorthStarSites?.resolve(row.siteId) || window.NorthStarSites?.resolve(row.site) || {id:row.siteId || row.site || 'unknown',name:row.site || 'Unassigned'};
    const stateOf = row => row.needsHelp ? 'Needs help' : row.status === 'provisional' ? 'Pending review' : row.overdue || row.status === 'overdue' ? 'Overdue' : row.alone ? 'Working alone' : 'On site';
    const toneOf = row => row.needsHelp ? 'help' : row.overdue || row.status === 'overdue' ? 'overdue' : row.status === 'provisional' ? 'pending' : 'active';
    const activeRows = () => rows.filter(row => row.status !== 'checked-out' && !checkedOut.has(String(row.id)));
    function paintStatus() {
      status.textContent = loading ? 'Refreshing…' : statusMessage || (failed ? 'Stale' : lastUpdated ? 'Updated ' + time(lastUpdated) : loaded ? 'Loaded' : 'Loading…');
      status.title = status.textContent;
      $('[data-v3-refresh]').disabled = loading;
      host.querySelectorAll('[data-v3-checkout]').forEach(button => { button.disabled = failed || busy.has(button.closest('[data-v3-worker]').dataset.v3Worker); });
    }
    function render() {
      const query = search?.value.trim().toLowerCase() || '';
      const all = activeRows(), shown = all.filter(row => `${row.name} ${row.company || ''} ${siteOf(row).name}`.toLowerCase().includes(query));
      shown.sort((a,b) => siteOf(a).name.localeCompare(siteOf(b).name) || Number(Boolean(b.needsHelp))-Number(Boolean(a.needsHelp)) || Number(Boolean(b.overdue))-Number(Boolean(a.overdue)) || String(a.name || '').localeCompare(String(b.name || '')));
      const entries = [], columns = overview ? 5 : 6;
      let lastSite = null;
      for (const row of shown) {
        const site = siteOf(row), id = String(row.id), company = row.company || (row.kind === 'Contractor' ? 'Contractor' : 'NorthStar'), state = stateOf(row), contact = String(row.notes || '').startsWith('[Crew contact]');
        if (overview && site.id !== lastSite) {
          entries.push({key:'site:' + site.id,className:'v3-worker-station',markup:`<th colspan="${columns}" scope="rowgroup"><span title="${esc(site.name)}">${esc(site.name)}</span><span>${shown.filter(person => siteOf(person).id === site.id).length}</span></th>`}); lastSite = site.id;
        }
        entries.push({key:'worker:' + id,workerId:id,className:'v3-worker-row',markup:`<td><button type="button" data-v3-profile class="v3-person" title="Open ${esc(row.name || 'worker')} details${contact ? ' · Crew contact' : ''}">${esc(row.name || 'Unnamed worker')}${contact ? '<span class="v3-contact" title="Crew contact"> · contact</span>' : ''}</button></td><td title="${esc(company)}">${esc(company)}</td>${overview ? '' : `<td title="${esc(site.name)}">${esc(site.name)}</td>`}<td title="${esc(row.checkedIn || 'Time not supplied')}">${esc(workerTime(row.checkedIn))}</td><td><span class="v3-worker-state" data-state="${toneOf(row)}" title="${esc(state)}">${esc(state)}</span></td><td class="v3-worker-action">${row.status === 'provisional' ? '<button type="button" data-v3-profile class="v3-worker-review" title="Open pending worker details" aria-label="Review pending worker">…</button>' : `<button type="button" data-v3-checkout aria-label="Check out ${esc(row.name || 'worker')}" title="Check out ${esc(row.name || 'worker')}">×</button>`}</td>`});
      }
      if (!entries.length) entries.push({key:'empty',markup:`<td colspan="${columns}" class="v3-data-empty">${failed && !loaded ? 'Current occupancy is unknown.' : loaded ? query ? 'No matching workers.' : 'No active workers.' : 'Loading workers…'}</td>`});
      reconcile(body, entries);
      $('.v3-data-count').textContent = query ? `${shown.length} / ${all.length}` : `${all.length} ${all.length === 1 ? 'person' : 'people'}`;
      paintStatus();
    }
    async function refresh({force = false} = {}) {
      if (loading) return;
      loading = true; paintStatus();
      try {
        if (!window.NorthstarRoster?.load) throw Error('Shared roster service is not ready.');
        const result = await window.NorthstarRoster.load({force});
        if (!Array.isArray(result)) throw Error('Invalid roster response.');
        rows = result; loaded = true; failed = false; lastUpdated = new Date().toISOString(); statusMessage = ''; error.hidden = true; render();
      } catch (cause) { failed = true; statusMessage = 'Roster unavailable'; error.textContent = `${cause.message} ${loaded ? 'Displayed records may be stale.' : 'Current occupancy is unknown.'}`; error.hidden = false; render(); }
      finally { loading = false; paintStatus(); }
    }
    async function checkout(row, button) {
      const id = String(row.id);
      if (failed || busy.has(id)) return;
      busy.add(id); button.disabled = true; button.setAttribute('aria-busy','true'); statusMessage = 'Checking out…'; paintStatus();
      try {
        const response = await fetch('/api/checkins/' + encodeURIComponent(id), {method:'DELETE'});
        if (!response.ok) { let result = {}; try { result = await response.json(); } catch {} throw Error(result.error || 'Check-out was not confirmed.'); }
        checkedOut.add(id);
        // Publish confirmed removal to every v3 mount immediately; the shared store broadcasts its own reconciliation.
        window.dispatchEvent(new CustomEvent('northstar:v3-checkout', {detail:{id,name:row.name}}));
        error.hidden = true; statusMessage = 'Checked out'; render();
      } catch (cause) { statusMessage = 'Check-out failed'; error.textContent = cause.message + ' The worker remains in this list.'; error.hidden = false; }
      finally { busy.delete(id); button.removeAttribute('aria-busy'); paintStatus(); }
    }
    listen(host, 'click', event => {
      if (event.target.closest('[data-v3-add]')) { window.NorthstarWorkerDetails?.signIn(); return; }
      if (event.target.closest('[data-v3-refresh]')) { refresh({force:true}); return; }
      const tr = event.target.closest('[data-v3-worker]'); if (!tr) return;
      const row = rows.find(person => String(person.id) === tr.dataset.v3Worker); if (!row) return;
      const button = event.target.closest('[data-v3-checkout]');
      if (button) { checkout(row, button); return; }
      if (event.target.closest('input,select,a')) return;
      openWorker(row, event.target.closest('[data-v3-profile]') || tr.querySelector('[data-v3-profile]'));
    }, disposers);
    listen(search, 'input', render, disposers);
    listen(window, 'northstar:field-roster-data', event => { if (!Array.isArray(event.detail)) return; rows = event.detail; loaded = true; failed = false; lastUpdated = new Date().toISOString(); statusMessage = ''; error.hidden = true; render(); }, disposers);
    listen(window, 'northstar:v3-checkout', () => render(), disposers);
    listen(window, 'northstar:roster-error', event => { failed = true; statusMessage = 'Roster unavailable'; error.textContent = String(event.detail || 'Roster unavailable.') + ' Displayed records may be stale.'; error.hidden = false; render(); }, disposers);
    listen(window, 'northstar:sites-display-change', render, disposers);
    listen(document.querySelector('#siteWorkerDialog'), 'close', () => refresh(), disposers);
    const view = lifecycle(host, refresh, disposers);
    render(); Promise.resolve(window.NorthStarSites?.ready).then(() => { if (view.active) refresh(); });
    return view;
  }

  const eventFilters = [
    {id:'all',label:'All',params:[]}, {id:'alarms',label:'Alarms',params:[['type','alarm']]},
    {id:'scada',label:'SCADA',params:[['source','scada'],['source','s+'],['source','splus'],['source','s-plus'],['source','wonderware']]},
    {id:'dispatch',label:'Dispatch',params:[['source','dispatch']]},
    {id:'communications',label:'Comms',params:[['type','communication'],['type','voice']]},
    {id:'water',label:'Water',params:[['source','water'],['source','water_management'],['source','water-management']]},
    {id:'market',label:'Market',params:[['source','market'],['source','markets']]},
    {id:'workers',label:'Workers',params:[['source','workforce']]},
    {id:'outages',label:'Outages',params:[['type','outage']]},
    {id:'logs',label:'Operator',params:[['type','log']]}
  ];
  function mountEvents(host, {compact = false} = {}) {
    if (!host) throw Error('An event log host is required.');
    if (mounted.has(host)) return mounted.get(host);
    const disposers = [];
    let rows = [], filter = 'all', appliedQuery = '', cursor = null, snapshot = 0, total = 0, request = 0, loading = false, lastSuccess = null, loadedOlder = false, controller, searchTimer;
    host.classList.add('v3-data','v3-events'); host.classList.toggle('v3-events-compact',compact); host.setAttribute('aria-label','Control room event log');
    host.innerHTML = `<header class="v3-data-header"><h2>Event log</h2>${compact ? '' : '<input type="search" data-v3-event-search aria-label="Search events" maxlength="500" placeholder="Search message, site or person">'}<span class="v3-data-freshness" role="status" aria-live="polite">Loading…</span><button type="button" class="v3-refresh" data-v3-event-refresh aria-label="Refresh event log" title="Refresh event log">↻</button></header><nav class="v3-event-filters" aria-label="Event categories">${eventFilters.map(item => `<button type="button" data-v3-event-filter="${item.id}" aria-pressed="${item.id === 'all'}">${item.label}</button>`).join('')}</nav><p class="v3-data-error" role="alert" hidden></p><button type="button" class="v3-events-new" data-v3-events-new hidden>New events — refresh</button><div class="v3-data-scroll"><table class="v3-event-table" aria-label="Control room alarm and event log"><colgroup><col class="v3-event-time"><col class="v3-event-severity"><col class="v3-event-source"><col class="v3-event-site"><col class="v3-event-message"><col class="v3-event-state"></colgroup><thead><tr><th scope="col">Time · ET</th><th scope="col">Severity</th><th scope="col">Source</th><th scope="col">Site</th><th scope="col">Message</th><th scope="col" title="Recorded state at the time of the event">State</th></tr></thead><tbody></tbody></table></div><footer class="v3-data-footer"><span class="v3-event-count"></span><button type="button" data-v3-event-more hidden>Older events</button></footer>`;
    if(compact){host.querySelector('colgroup').innerHTML='<col class="v3-event-time"><col class="v3-event-severity"><col class="v3-event-message">';host.querySelector('thead').innerHTML='<tr><th scope="col">Time</th><th scope="col">Level</th><th scope="col">Event</th></tr>';host.querySelector('footer').hidden=true;}
    const $ = selector => host.querySelector(selector), body = $('tbody'), status = $('.v3-data-freshness'), error = $('.v3-data-error'), search = $('[data-v3-event-search]'), more = $('[data-v3-event-more]'), newer = $('[data-v3-events-new]');
    const params = () => { const p = new URLSearchParams(eventFilters.find(item => item.id === filter).params); if (search?.value.trim()) p.set('q',search.value.trim()); return p; };
    const sourceLabel = item => item.display?.channelLabel || ({workforce:'Workers',logbook:'Operator',field_operations:'Field',market:'Market',scada:'SCADA',dispatch:'Dispatch',water_management:'Water'})[item.source] || item.source || '—';
    function render() {
      reconcile(body, rows.map(item => {
        const id = String(item.eventId), severity = ['critical','warning'].includes(String(item.severity).toLowerCase()) ? String(item.severity).toLowerCase() : 'info';
        const summary = item.summary || item.eventType || 'Event', source = sourceLabel(item), site = item.site || item.payload?.site || '—';
        const message=compact&&site!=='—'&&!summary.toLowerCase().includes(site.toLowerCase())?site+' · '+summary:summary;
        return {key:'event:' + id,eventId:id,className:'v3-event-row',markup:compact?`<td title="${esc(item.occurredAt || 'Time not supplied')}">${esc(time(item.occurredAt))}</td><td><span class="v3-event-severity-label" data-severity="${severity}">${esc(item.severity || 'info')}</span></td><td><a href="event-detail.html?id=${encodeURIComponent(id)}" title="${esc([message,source,item.status].filter(Boolean).join(' · '))}">${esc(message)}</a></td>`:`<td title="${esc(item.occurredAt || 'Time not supplied')}">${esc(time(item.occurredAt,true))}</td><td><span class="v3-event-severity-label" data-severity="${severity}">${esc(item.severity || 'info')}</span></td><td title="${esc([item.source,item.actorId].filter(Boolean).join(' · '))}">${esc(source)}</td><td title="${esc(site)}">${esc(site)}</td><td><a href="event-detail.html?id=${encodeURIComponent(id)}" title="${esc(summary)}">${esc(summary)}</a></td><td title="${esc(item.status || 'State not supplied')}">${esc(item.status || '—')}</td>`};
      }));
      if (!rows.length) reconcile(body,[{key:'empty',markup:'<td colspan="'+(compact?3:6)+'" class="v3-data-empty">No matching events.</td>'}]);
      $('.v3-event-count').textContent = `${rows.length.toLocaleString()} of ${total.toLocaleString()} events`;
      more.hidden = compact || !cursor;
    }
    async function get(query, signal) {
      await window.northstarOperatorSession;
      const response = await fetch('/api/events/register?' + query, {cache:'no-store',signal});
      let result; try { result = await response.json(); } catch { throw Error('Unreadable event service response.'); }
      if (!response.ok) throw Error(result.error || 'Event service unavailable.');
      if (!Array.isArray(result.items)) throw Error('Invalid event register response.');
      return result;
    }
    async function load(older = false) {
      if (older && (loading || !cursor)) return;
      controller?.abort(); controller = new AbortController();
      const current = ++request, p = params(), selectedQuery = p.toString();
      if (older && selectedQuery !== appliedQuery) return load(false);
      p.set('limit',compact ? '6' : '50'); if (older) p.set('cursor',cursor);
      loading = true; status.textContent = older ? 'Loading older…' : 'Refreshing…'; more.disabled = true; $('[data-v3-event-refresh]').disabled = true;
      try {
        const result = await get(p,controller.signal); if (current !== request) return;
        rows = older ? [...rows,...result.items.filter(item => !rows.some(old => old.eventId === item.eventId))] : result.items;
        loadedOlder = older; cursor = result.nextCursor || null; snapshot = result.snapshot || 0; total = result.total ?? rows.length; appliedQuery = selectedQuery; lastSuccess = result.fetchedAt || new Date().toISOString();
        error.hidden = true; newer.hidden = true; status.textContent = 'Updated ' + time(lastSuccess); render();
      } catch (cause) {
        if (current !== request || cause.name === 'AbortError') return;
        error.textContent = `${cause.message} ${rows.length ? 'Previous results retained; requested filters may not be applied.' : 'No current event data available.'}`; error.hidden = false;
        status.textContent = lastSuccess ? 'Stale · ' + time(lastSuccess) : 'Unavailable'; more.hidden = !cursor || selectedQuery !== appliedQuery;
      } finally { if (current === request) { loading = false; more.disabled = false; $('[data-v3-event-refresh]').disabled = false; } }
    }
    async function refresh() {
      if(compact)return loading?undefined:load();
      if (!lastSuccess || !rows.length) return load();
      if (loading) return;
      // Preserve a paginated snapshot until the operator chooses the new arrivals.
      if (cursor || loadedOlder) {
        const current = request, p = params(); p.set('limit','1');
        try { const result = await get(p); if (current === request && result.snapshot > snapshot) newer.hidden = false; }
        catch { if (current === request) status.textContent = 'Refresh check failed · ' + time(lastSuccess); }
        return;
      }
      return load();
    }
    listen(host, 'click', event => {
      const selected = event.target.closest('[data-v3-event-filter]');
      if (selected) { filter = selected.dataset.v3EventFilter; host.querySelectorAll('[data-v3-event-filter]').forEach(button => button.setAttribute('aria-pressed',String(button === selected))); load(); return; }
      if (event.target.closest('[data-v3-event-more]')) { load(true); return; }
      if (event.target.closest('[data-v3-event-refresh],[data-v3-events-new]')) { load(); return; }
      const row = event.target.closest('[data-v3-event]');
      if (row && !event.target.closest('a,button,input')) row.querySelector('a').click();
    }, disposers);
    listen(host, 'keydown', event => { const row = event.target.closest('[data-v3-event]'); if (row && event.target === row && ['Enter',' '].includes(event.key)) { event.preventDefault(); row.querySelector('a').click(); } }, disposers);
    listen(search, 'input', () => { clearTimeout(searchTimer); searchTimer = setTimeout(() => load(),250); }, disposers);
    disposers.push(() => { ++request; controller?.abort(); clearTimeout(searchTimer); });
    const view = lifecycle(host,refresh,disposers,{loadOlder:() => load(true)});
    load(); return view;
  }

  window.NorthStarV3Data = {mountWorkers,mountEvents,openWorker,refresh:() => Promise.all([...views].filter(view => view.active).map(view => view.refresh())),deactivate:() => views.forEach(view => view.deactivate())};
})();
