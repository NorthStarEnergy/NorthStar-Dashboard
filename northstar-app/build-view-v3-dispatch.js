/* Build view v3 dispatch monitor. Read-only; no dispatch instructions are submitted. */
(() => {
  'use strict';

  const ENDPOINT = '/api/dispatch/apiroq';
  const EVENTS_ENDPOINT = '/api/events/register?source=dispatch&limit=50';
  const POLL_MS = 10000;
  const MAX_CONNECTIONS = 120;
  let host = null, root = null, active = false, timer = null, pending = null;
  let requestNumber = 0, selected = 'dispatch', snapshot = null, records = [];
  let connections = [], currentRows = [], apiState = 'unknown', previousState = null;
  let latency = null, checkedAt = null, lastSuccess = null, error = '', recordsError = '';
  let returnFocus = null, returnFocusKey = null;
  const esc = value => String(value ?? '').replace(/[&<>"']/g, character => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[character]));
  const numeric = value => value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value));
  const number = (value, places = 1) => numeric(value) ? Number(value).toFixed(places) : '—';
  const stamp = (value, full = false) => {
    const parsed = new Date(value);
    if (!value || Number.isNaN(parsed.valueOf())) return '—';
    return parsed.toLocaleString('en-CA', {timeZone:'America/Toronto', ...(full ? {year:'numeric', month:'short', day:'2-digit'} : {}), hour:'2-digit', minute:'2-digit', second:'2-digit', hourCycle:'h23'});
  };
  const sourceLabel = payload => payload?.simulated || String(payload?.source || '').toLowerCase().includes('simulat') ? 'Simulation' : payload?.source === 'unavailable' || !payload?.source ? 'Unavailable' : String(payload.source);
  const isStale = () => {
    const updated = new Date(snapshot?.updated).valueOf();
    return apiState === 'offline' || !!snapshot?.stale || snapshot?.healthy === false || !Number.isFinite(updated) || Date.now() - updated > 30000;
  };
  const $ = selector => root?.querySelector(selector);
  const setText = (selector, value) => { const node = $(selector); if (node) node.textContent = value; };
  const field = (label, value, className = '') => `<div class="bv3d-metric ${className}"><span>${esc(label)}</span><strong title="${esc(value)}">${esc(value)}</strong></div>`;

  function build() {
    root = document.createElement('article');
    root.className = 'bv3-dispatch';
    root.dataset.moduleId = 'build-v3-dispatch';
    root.setAttribute('aria-label', 'Dispatch monitor');
    root.innerHTML = `<header class="bv3d-heading"><h2>Dispatch</h2><span class="bv3d-freshness" data-freshness role="status">Loading…</span><button type="button" data-check>Check connection</button></header>
      <section class="bv3d-summary" aria-label="Latest dispatch telemetry"><div class="bv3d-summary-head"><strong data-unit>APIROQ · LT.AG4</strong><span data-source class="bv3d-badge">Awaiting source</span></div><div class="bv3d-values" data-values></div><div class="bv3d-telemetry-meta"><span data-reserve>Reserve standby —</span><span data-interval>Interval —</span></div></section>
      <section class="bv3d-connection" aria-label="Connection status"><div class="bv3d-connection-fields" data-connection-fields></div><p>Connection check measures the browser to NorthStar API. An authenticated IESO dispatch connector is not configured; IESO service latency is unavailable.</p></section>
      <section class="bv3d-log" aria-label="Dispatch log"><header class="bv3d-log-heading"><h3>Dispatch log</h3><div class="bv3d-filters" role="group" aria-label="Log type"><button type="button" data-view="dispatch" aria-pressed="true">Telemetry</button><button type="button" data-view="connections" aria-pressed="false">Connections</button><button type="button" data-view="recorded" aria-pressed="false">Recorded events</button></div><span class="bv3d-zone">Times ET</span></header><p class="bv3d-log-note" data-log-note></p><div class="bv3d-table-scroll"><table><thead data-columns></thead><tbody data-rows></tbody></table><p class="bv3d-empty" data-empty hidden></p></div></section>
      <p class="bv3d-error" data-error role="alert" hidden></p>
      <dialog class="bv3d-detail" aria-labelledby="bv3dDetailTitle"><header><h3 id="bv3dDetailTitle">Dispatch detail</h3><button type="button" data-close aria-label="Close dispatch detail">×</button></header><div data-detail></div></dialog>`;
    host.append(root);
    root.addEventListener('click', handleClick);
    root.addEventListener('keydown', handleKeydown);
    $('dialog').addEventListener('close', () => {
      const target = returnFocus?.isConnected ? returnFocus : [...(root?.querySelectorAll('[data-row]') || [])].find(row => row.dataset.key === returnFocusKey) || root?.querySelector('[data-view][aria-pressed="true"]');
      target?.focus({preventScroll:true});
    });
    $('dialog').addEventListener('click', event => { if (event.target === $('dialog')) $('dialog').close(); });
    render();
  }

  function handleClick(event) {
    const check = event.target.closest('[data-check]');
    if (check) { refresh(true); return; }
    const filter = event.target.closest('[data-view]');
    if (filter) { selected = filter.dataset.view; renderRows(); return; }
    if (event.target.closest('[data-close]')) { $('dialog').close(); return; }
    const row = event.target.closest('[data-row]');
    if (row) showDetail(Number(row.dataset.row), row);
  }

  function handleKeydown(event) {
    if (!['Enter', ' '].includes(event.key) || !event.target.matches('[data-row]')) return;
    event.preventDefault();
    showDetail(Number(event.target.dataset.row), event.target);
  }

  function render() {
    if (!root) return;
    const stale = isStale();
    const source = sourceLabel(snapshot);
    const sourceNode = $('[data-source]');
    sourceNode.textContent = `${source}${snapshot && stale ? ' · Stale' : ''}`;
    sourceNode.dataset.state = snapshot && !stale ? 'received' : 'attention';
    setText('[data-unit]', `${snapshot?.site || 'APIROQ'} · ${snapshot?.unit || 'LT.AG4'}`);
    $('[data-values]').innerHTML = field('Output', `${number(snapshot?.outputMw)} MW`)
      + field('Dispatch', `${number(snapshot?.dispatchMw)} MW`)
      + field('Deviation', numeric(snapshot?.deltaMw) ? `${Number(snapshot.deltaMw) > 0 ? '+' : ''}${number(snapshot.deltaMw)} MW` : '—')
      + field('Reserve activation', snapshot?.orActivation ? `${snapshot.orActivation} · ${number(snapshot.orActivationMw)} MW` : snapshot ? 'None' : '—');
    const reserve = snapshot?.reserveStandby || {};
    setText('[data-reserve]', `Standby · 10S ${number(reserve.tenS)} · 10N ${number(reserve.tenN)} · 30R ${number(reserve.thirtyR)} MW`);
    setText('[data-interval]', `Interval ${stamp(snapshot?.dispatchInterval?.start)}–${stamp(snapshot?.dispatchInterval?.end)}`);
    $('[data-connection-fields]').innerHTML = field('NorthStar API', apiState === 'online' ? 'Reachable' : apiState === 'offline' ? 'Unavailable' : 'Checking…', `bv3d-api-${apiState}`)
      + field('API round-trip', latency === null ? '—' : `${Math.round(latency)} ms`)
      + field('IESO dispatch service', 'Not configured')
      + field('Telemetry heartbeat', snapshot?.updated ? `${stamp(snapshot.updated)}${stale ? ' · Stale' : ''}` : 'Unavailable');
    setText('[data-freshness]', pending ? 'Checking…' : apiState === 'offline' ? `Unavailable${lastSuccess ? ' · last received ' + stamp(lastSuccess) : ''}` : checkedAt ? `Checked ${stamp(checkedAt)}` : 'Awaiting connection');
    $('[data-check]').disabled = !!pending;
    $('[data-error]').hidden = !error;
    setText('[data-error]', error);
    renderRows();
  }

  function telemetryRows() {
    const history = Array.isArray(snapshot?.history) ? snapshot.history : [];
    const samples = history.length ? history : snapshot?.updated ? [{time:snapshot.updated, outputMw:snapshot.outputMw, dispatchMw:snapshot.dispatchMw}] : [];
    return samples.slice().reverse().map(sample => ({kind:'sample', ...sample, source:sourceLabel(snapshot)}));
  }

  function cell(text) { return `<td title="${esc(text)}">${esc(text)}</td>`; }

  function renderRows() {
    if (!root) return;
    const focusKey = document.activeElement?.closest('[data-row]')?.dataset.key;
    root.querySelectorAll('[data-view]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.view === selected)));
    $('table').dataset.logView = selected;
    let columns, empty;
    if (selected === 'connections') {
      currentRows = connections.slice().reverse();
      columns = ['Time', 'Check', 'NorthStar API', 'Round-trip', 'IESO service'];
      empty = 'No connection checks in this page session.';
      setText('[data-log-note]', 'This page session · status changes and manual checks · newest first');
    } else if (selected === 'recorded') {
      currentRows = records.map(event => ({kind:'event', ...event}));
      columns = ['Time', 'Severity', 'Event', 'Source', 'State'];
      empty = recordsError || 'No recorded dispatch events. Telemetry samples are shown under Telemetry.';
      setText('[data-log-note]', recordsError ? recordsError : 'Shared event ledger · dispatch source · latest 50 entries');
    } else {
      currentRows = telemetryRows();
      columns = ['Time', 'Source', 'Output MW', 'Dispatch MW', 'Deviation MW'];
      empty = 'No dispatch telemetry received.';
      setText('[data-log-note]', `${sourceLabel(snapshot) === 'Simulation' ? 'Simulated telemetry' : 'Received telemetry'} · available recent samples · newest first`);
    }
    $('[data-columns]').innerHTML = '<tr>' + columns.map(column => `<th scope="col">${esc(column)}</th>`).join('') + '</tr>';
    $('[data-rows]').innerHTML = currentRows.map((row, index) => {
      const time = row.time || row.occurredAt;
      const key = `${row.kind}:${row.eventId || time}:${row.reason || ''}`;
      let values;
      if (row.kind === 'connection') values = [stamp(time, true), row.reason, row.state === 'online' ? 'Reachable' : 'Unavailable', row.latency === null ? '—' : `${Math.round(row.latency)} ms`, 'Not configured'];
      else if (row.kind === 'event') values = [stamp(time, true), row.severity || 'Info', row.summary || row.eventType, row.source || 'dispatch', row.status || '—'];
      else values = [stamp(time, true), row.source, number(row.outputMw), number(row.dispatchMw), numeric(row.outputMw) && numeric(row.dispatchMw) ? number(Number(row.outputMw) - Number(row.dispatchMw)) : '—'];
      return `<tr data-row="${index}" data-key="${esc(key)}" tabindex="0" aria-label="Open detail: ${esc(values.join(', '))}">${values.map(cell).join('')}</tr>`;
    }).join('');
    $('[data-empty]').hidden = currentRows.length > 0;
    setText('[data-empty]', empty);
    if (focusKey) [...root.querySelectorAll('[data-row]')].find(row => row.dataset.key === focusKey)?.focus({preventScroll:true});
  }

  function details(fields) {
    return `<dl>${fields.map(([label, value]) => `<dt>${esc(label)}</dt><dd>${esc(value ?? '—')}</dd>`).join('')}</dl>`;
  }

  function showDetail(index, element) {
    const row = currentRows[index];
    if (!row) return;
    returnFocus = element;
    returnFocusKey = element?.dataset.key;
    const title = row.kind === 'connection' ? 'Connection check' : row.kind === 'event' ? 'Recorded dispatch event' : 'Dispatch telemetry';
    setText('#bv3dDetailTitle', title);
    let fields, link = '';
    if (row.kind === 'connection') fields = [
      ['Checked at (ET)', stamp(row.time, true)], ['Check', row.reason], ['NorthStar API', row.state === 'online' ? 'Reachable' : 'Unavailable'],
      ['Endpoint', ENDPOINT], ['HTTP status', row.httpStatus], ['Browser to NorthStar round-trip', row.latency === null ? 'Unavailable' : `${Math.round(row.latency)} ms`],
      ['IESO dispatch connection', 'Not configured'], ['IESO service latency', 'Unavailable — no authenticated dispatch connector'], ['Result', row.message], ['History scope', 'Current page session only']
    ];
    else if (row.kind === 'event') {
      fields = [['Time (ET)', stamp(row.occurredAt, true)], ['Event ID', row.eventId], ['Event', row.summary || row.eventType], ['Severity', row.severity], ['Source', row.source], ['Actor', row.actorId], ['Site', row.site], ['State', row.status]];
      if (row.eventId) link = `<a class="bv3d-report" href="event-detail.html?id=${encodeURIComponent(row.eventId)}">Open full event report</a>`;
    } else fields = [['Time (ET)', stamp(row.time, true)], ['Site', snapshot?.site], ['Unit', snapshot?.unit], ['Source', row.source], ['Output', `${number(row.outputMw)} MW`], ['Dispatch target', `${number(row.dispatchMw)} MW`], ['Deviation', numeric(row.outputMw) && numeric(row.dispatchMw) ? `${number(Number(row.outputMw) - Number(row.dispatchMw))} MW` : '—'], ['Data origin', row.source === 'Simulation' ? 'NorthStar dispatch simulator; this is not an IESO dispatch instruction.' : 'NorthStar dispatch telemetry endpoint']];
    $('[data-detail]').innerHTML = details(fields) + link;
    const dialog = $('dialog');
    if (!dialog.open) dialog.showModal();
  }

  async function readJson(path, signal) {
    const response = await fetch(path, {method:'GET', cache:'no-store', credentials:'same-origin', signal});
    if (!response.ok) {
      const failure = new Error(response.status === 401 || response.status === 403 ? 'Operator access is required.' : `NorthStar returned HTTP ${response.status}.`);
      failure.httpStatus = response.status;
      throw failure;
    }
    const data = await response.json();
    return {data, status:response.status};
  }

  function addConnection(state, reason, message, httpStatus = null) {
    if (previousState === state && reason !== 'Manual check') return;
    connections.push({kind:'connection', time:checkedAt, reason, state, latency, message, httpStatus});
    connections = connections.slice(-MAX_CONNECTIONS);
    previousState = state;
  }

  async function refresh(manual = false) {
    if (!active || !root || pending) return;
    const request = ++requestNumber;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);
    pending = controller;
    render();
    const began = performance.now();
    try {
      const result = await readJson(ENDPOINT, controller.signal);
      if (request !== requestNumber || !active) return;
      if (!result.data || typeof result.data !== 'object' || Array.isArray(result.data) || !('source' in result.data)) throw new Error('Dispatch telemetry response was not recognized.');
      latency = Math.max(0, performance.now() - began);
      checkedAt = new Date().toISOString();
      lastSuccess = checkedAt;
      apiState = 'online'; error = ''; snapshot = result.data;
      addConnection('online', manual ? 'Manual check' : previousState === null ? 'Page opened' : 'Connection restored', `NorthStar API responded; telemetry source: ${sourceLabel(snapshot)}.`, result.status);
      render();
      // Recorded events are separate from the simulator's rolling sample history.
      try {
        const result = await readJson(EVENTS_ENDPOINT, controller.signal);
        if (request !== requestNumber || !active) return;
        if (!Array.isArray(result.data?.items)) throw new Error('Event response was not recognized.');
        records = result.data.items; recordsError = '';
      } catch (failure) {
        if (request !== requestNumber || !active) return;
        recordsError = `Recorded events unavailable${records.length ? ' · showing previous results' : ''}.`;
      }
    } catch (failure) {
      if (request !== requestNumber || !active) return;
      checkedAt = new Date().toISOString(); apiState = 'offline'; latency = null;
      error = failure.name === 'AbortError' ? 'Connection check timed out. Previous telemetry is retained.' : `${failure.message}${snapshot ? ' Previous telemetry is retained.' : ''}`;
      addConnection('offline', manual ? 'Manual check' : previousState === null ? 'Page opened' : 'Connection lost', error, failure.httpStatus || null);
    } finally {
      clearTimeout(timeout);
      if (request === requestNumber) { pending = null; render(); }
    }
  }

  function activate() {
    if (!root || active) return;
    active = true;
    refresh();
    timer = setInterval(() => { if (!document.hidden) refresh(); }, POLL_MS);
  }

  function deactivate() {
    active = false;
    clearInterval(timer); timer = null;
    ++requestNumber;
    pending?.abort(); pending = null;
    $('dialog')?.close();
  }

  function destroy() {
    deactivate(); root?.remove(); root = null; host = null;
  }

  function mount(target) {
    if (!(target instanceof Element)) throw new TypeError('A Dispatch host element is required.');
    if (host !== target || !root?.isConnected) { destroy(); host = target; build(); }
    activate();
    return api;
  }

  const api = Object.freeze({mount, activate, deactivate, destroy, refresh:() => refresh(true)});
  window.NorthstarBuildV3Dispatch = api;
})();
