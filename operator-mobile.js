(() => {
  'use strict';

  const REFRESH_MS = 30_000;
  const feeds = {
    workers: { label: 'FIELD STATUS', path: '/api/checkins', items: null, refreshedAt: null, error: null },
    alerts: { label: 'ALERTS', path: '/api/alerts', items: null, refreshedAt: null, error: null },
    outages: { label: 'OUTAGES', path: '/api/outages', items: null, refreshedAt: null, error: null },
  };

  const statusBar = document.querySelector('.live-status');
  const status = document.querySelector('#mobileStatus');
  const refreshButton = document.querySelector('#refreshMobile');
  const summary = document.querySelector('#mobileSummary');
  const workerList = document.querySelector('#mobileWorkers');
  const alertList = document.querySelector('#mobileAlerts');
  const outageList = document.querySelector('#mobileOutages');
  const modulePicker = document.querySelector('#modulePicker');
  const openModulesButton = document.querySelector('#openModules');
  const moduleCount = document.querySelector('#moduleCount');
  const modulePickerCount = document.querySelector('#modulePickerCount');
  const moduleInputs = [...document.querySelectorAll('.module-option input')];
  const closeModuleButtons = [...document.querySelectorAll('[data-close-module]')];
  const moduleIds = new Set(['overview', 'workers', 'alerts', 'outages']);
  const moduleStorageKey = 'northstar.operator-mobile.modules.v1';
  let selectedModules = readModuleSelection();
  let inFlight = false;

  function readModuleSelection() {
    try {
      const stored = JSON.parse(localStorage.getItem('northstar.operator-mobile.modules.v1') || 'null');
      if (Array.isArray(stored)) {
        const valid = [...new Set(stored.filter(id => moduleIds.has(id)))].slice(0, 3);
        if (valid.length) return valid;
      }
    } catch (_) {}
    return ['overview'];
  }

  function saveModuleSelection() {
    try { localStorage.setItem(moduleStorageKey, JSON.stringify(selectedModules)); } catch (_) {}
  }

  function updateModuleSelection() {
    const selected = new Set(selectedModules);
    document.querySelectorAll('[data-module-panel]').forEach(panel => {
      panel.hidden = !selected.has(panel.dataset.modulePanel);
    });
    moduleCount.textContent = `${selectedModules.length} / 3`;
    openModulesButton.setAttribute('aria-label', `Choose modules, ${selectedModules.length} of 3 selected`);
    modulePickerCount.textContent = `${selectedModules.length} of 3 modules shown`;

    moduleInputs.forEach(input => {
      input.checked = selected.has(input.value);
      input.disabled = (!input.checked && selected.size >= 3) || (input.checked && selected.size === 1);
      input.closest('.module-option').classList.toggle('is-selected', input.checked);
      input.closest('.module-option').classList.toggle('is-disabled', input.disabled);
    });
    closeModuleButtons.forEach(button => {
      button.hidden = selected.size === 1;
      button.disabled = false;
    });
  }

  function changeModule(moduleId, show) {
    if (!moduleIds.has(moduleId)) return;
    if (show && !selectedModules.includes(moduleId) && selectedModules.length < 3) selectedModules.push(moduleId);
    if (!show && selectedModules.includes(moduleId) && selectedModules.length > 1) {
      selectedModules = selectedModules.filter(id => id !== moduleId);
    }
    saveModuleSelection();
    updateModuleSelection();
  }

  const create = (tag, className, text) => {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
  };

  const isArray = value => Array.isArray(value);
  const activeWorkers = rows => rows.filter(row => String(row.status || '').toLowerCase() !== 'checked-out');
  const isGps = row => Number.isFinite(Number(row.latitude)) && Number.isFinite(Number(row.longitude))
    && !(Number(row.latitude) === 0 && Number(row.longitude) === 0);

  function time(value) {
    if (!value) return '—';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '—';
    return date.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
  }

  function price(value) {
    const number = Number(value);
    return Number.isFinite(number) ? `$${number.toFixed(2)}` : '—';
  }

  function feedState(name) {
    const feed = feeds[name];
    const target = document.querySelector(`#${name}State`);
    if (!target) return;
    target.classList.toggle('is-stale', Boolean(feed.error));
    target.textContent = feed.error ? 'STALE / UNAVAILABLE' : feed.refreshedAt ? `UPDATED ${time(feed.refreshedAt)}` : 'LOADING';
  }

  function empty(message) {
    return create('div', 'empty-state', message);
  }

  function appendDetail(card, label, value) {
    const detail = create('div');
    detail.append(create('span', 'detail-label', label), create('span', 'detail-value', value));
    card.append(detail);
  }

  function workerState(row) {
    if (row.needsHelp) return { label: 'NEEDS HELP', tone: 'is-priority' };
    if (row.overdue) return { label: 'OVERDUE', tone: 'is-warning' };
    if (row.alone) return { label: 'WORKING ALONE', tone: 'is-warning' };
    return { label: String(row.status || 'ACTIVE').toUpperCase(), tone: '' };
  }

  function renderSummary() {
    const rows = isArray(feeds.workers.items) ? activeWorkers(feeds.workers.items) : [];
    const alerts = isArray(feeds.alerts.items) ? feeds.alerts.items.length : null;
    const metrics = [
      ['ACTIVE WORKERS', feeds.workers.items === null ? '—' : String(rows.length), ''],
      ['NEEDS HELP', feeds.workers.items === null ? '—' : String(rows.filter(row => row.needsHelp).length), rows.some(row => row.needsHelp) ? 'is-priority' : ''],
      ['OVERDUE', feeds.workers.items === null ? '—' : String(rows.filter(row => row.overdue).length), rows.some(row => row.overdue) ? 'is-warning' : ''],
      ['OPEN ALERTS', alerts === null ? '—' : String(alerts), alerts ? 'is-warning' : ''],
    ];
    summary.replaceChildren(...metrics.map(([label, value, tone]) => {
      const metric = create('div', `metric ${tone}`.trim());
      metric.append(create('span', '', label), create('strong', '', value));
      return metric;
    }));
  }

  function renderWorkers() {
    const feed = feeds.workers;
    feedState('workers');
    if (!isArray(feed.items)) {
      workerList.replaceChildren(empty(feed.error ? 'FIELD STATUS IS UNAVAILABLE. DISPLAYED DATA IS NOT CURRENT.' : 'LOADING FIELD STATUS…'));
      return;
    }
    const rows = activeWorkers(feed.items).sort((left, right) => {
      const rank = row => row.needsHelp ? 0 : row.overdue ? 1 : row.alone ? 2 : 3;
      return rank(left) - rank(right) || String(left.name || '').localeCompare(String(right.name || ''));
    });
    if (!rows.length) {
      workerList.replaceChildren(empty('NO ACTIVE WORKERS ARE RECORDED.'));
      return;
    }
    workerList.replaceChildren(...rows.map(row => {
      const state = workerState(row);
      const card = create('article', `worker-card ${state.tone}`.trim());
      const head = create('div', 'worker-head');
      const identity = create('div');
      identity.append(create('strong', 'worker-name', row.name || 'UNNAMED WORKER'));
      identity.append(create('p', 'worker-role', [row.kind || 'Worker', row.company || 'NorthStar', row.site || 'SITE NOT RECORDED'].filter(Boolean).join(' · ')));
      head.append(identity, create('span', `state-pill ${state.tone}`.trim(), state.label));
      const details = create('div', 'detail-grid');
      appendDetail(details, 'LAST HEARD', time(row.lastHeard));
      appendDetail(details, 'CHECKED IN', time(row.checkedIn));
      appendDetail(details, 'HELP STATE', String(row.helpState || 'none').toUpperCase());
      appendDetail(details, 'LOCATION', isGps(row) ? `${Number(row.latitude).toFixed(5)}, ${Number(row.longitude).toFixed(5)}` : 'NO CONSENTED GPS');
      card.append(head, details);
      return card;
    }));
  }

  function renderAlerts() {
    const feed = feeds.alerts;
    feedState('alerts');
    if (!isArray(feed.items)) {
      alertList.replaceChildren(empty(feed.error ? 'ALERT STATUS IS UNAVAILABLE. DISPLAYED DATA IS NOT CURRENT.' : 'LOADING ALERT STATUS…'));
      return;
    }
    if (!feed.items.length) {
      alertList.replaceChildren(empty('NO OPEN ALERTS.'));
      return;
    }
    alertList.replaceChildren(...feed.items.map(alert => {
      const row = create('article', 'compact-row is-priority');
      const detail = create('div');
      detail.append(create('strong', '', `${String(alert.node || 'MARKET').toUpperCase()} · ${String(alert.kind || 'ALERT').toUpperCase()}`));
      detail.append(create('small', '', `STATE ${String(alert.state || 'open').toUpperCase()} · OPENED ${time(alert.openedAt)}`));
      const side = create('span', 'compact-side', price(alert.price));
      row.append(detail, side);
      return row;
    }));
  }

  function renderOutages() {
    const feed = feeds.outages;
    feedState('outages');
    if (!isArray(feed.items)) {
      outageList.replaceChildren(empty(feed.error ? 'OUTAGE STATUS IS UNAVAILABLE. DISPLAYED DATA IS NOT CURRENT.' : 'LOADING OUTAGE STATUS…'));
      return;
    }
    const open = feed.items.filter(row => String(row.status || '').toLowerCase() !== 'closed');
    if (!open.length) {
      outageList.replaceChildren(empty('NO OPEN OUTAGES.'));
      return;
    }
    outageList.replaceChildren(...open.map(outage => {
      const row = create('article', `compact-row ${String(outage.severity || '').toLowerCase() === 'critical' ? 'is-priority' : ''}`.trim());
      const detail = create('div');
      detail.append(create('strong', '', outage.title || 'UNNAMED OUTAGE'));
      detail.append(create('small', '', `${outage.site || 'SITE NOT RECORDED'} · ${String(outage.severity || 'UNSPECIFIED').toUpperCase()} · OPENED ${time(outage.openedAt)}`));
      row.append(detail, create('span', 'compact-side', String(outage.status || 'OPEN').toUpperCase()));
      return row;
    }));
  }

  function render() {
    renderSummary();
    renderWorkers();
    renderAlerts();
    renderOutages();
  }

  async function getRows(path) {
    const response = await fetch(`${path}?ts=${Date.now()}`, {
      cache: 'no-store',
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const body = await response.json();
    if (!Array.isArray(body)) throw new Error('invalid response');
    return body;
  }

  function setStatus() {
    const unavailable = Object.values(feeds).filter(feed => feed.error).map(feed => feed.label);
    statusBar.classList.toggle('is-live', unavailable.length === 0);
    statusBar.classList.toggle('is-stale', unavailable.length > 0);
    status.textContent = unavailable.length
      ? `PARTIAL · ${unavailable.join(', ')} UNAVAILABLE — DISPLAYED DATA MAY BE STALE`
      : `LIVE · UPDATED ${time(new Date())} · REFRESHES WHILE OPEN`;
  }

  async function refresh() {
    if (inFlight) return;
    inFlight = true;
    refreshButton.disabled = true;
    status.textContent = 'REFRESHING LIVE DATA…';
    statusBar.classList.remove('is-live', 'is-stale');
    const entries = Object.entries(feeds);
    const results = await Promise.allSettled(entries.map(([, feed]) => getRows(feed.path)));
    results.forEach((result, index) => {
      const feed = entries[index][1];
      if (result.status === 'fulfilled') {
        feed.items = result.value;
        feed.refreshedAt = new Date();
        feed.error = null;
      } else {
        feed.error = result.reason instanceof Error ? result.reason.message : 'unavailable';
      }
    });
    render();
    setStatus();
    refreshButton.disabled = false;
    inFlight = false;
  }

  refreshButton.addEventListener('click', refresh);
  openModulesButton.addEventListener('click', () => modulePicker.showModal());
  document.querySelector('#closeModules').addEventListener('click', () => modulePicker.close());
  document.querySelector('#doneModules').addEventListener('click', () => modulePicker.close());
  moduleInputs.forEach(input => input.addEventListener('change', () => changeModule(input.value, input.checked)));
  closeModuleButtons.forEach(button => button.addEventListener('click', () => changeModule(button.dataset.closeModule, false)));
  modulePicker.addEventListener('click', event => { if (event.target === modulePicker) modulePicker.close(); });
  updateModuleSelection();
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
  window.setInterval(() => { if (!document.hidden) refresh(); }, REFRESH_MS);
  if ('serviceWorker' in navigator) {
    addEventListener('load', () => navigator.serviceWorker.register('/operator-mobile-sw.js', {
      scope: '/',
      updateViaCache: 'none',
    }).catch(() => {}));
  }
  refresh();
})();
