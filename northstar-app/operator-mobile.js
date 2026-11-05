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
  const workspace = document.querySelector('#moduleWorkspace');
  const panels = new Map([...document.querySelectorAll('[data-module-panel]')].map(panel => [panel.dataset.modulePanel, panel]));
  const catalog = {
    overview: { category: 'Overview', title: 'Control-room status' },
    workers: { category: 'Operations', title: 'Field workers' },
    outages: { category: 'Operations', title: 'Open outages' },
    alerts: { category: 'Market', title: 'Market alerts' },
  };
  let activeCategory = 0;
  const categoryModules = new Map();
  const previousCategory = document.querySelector('#previousCategory');
  const nextCategory = document.querySelector('#nextCategory');
  const lineupPosition = document.querySelector('#lineupPosition');
  const moduleOrder = document.querySelector('#moduleOrder');
  const parkedPanels = document.createElement('div');
  parkedPanels.hidden = true; workspace.after(parkedPanels);

  function readModuleSelection() {
    try {
      const stored = JSON.parse(localStorage.getItem('northstar.operator-mobile.modules.v1') || 'null');
      if (Array.isArray(stored)) {
        const valid = [...new Set(stored.filter(id => moduleIds.has(id)))];
        if (valid.length) return valid;
      }
    } catch (_) {}
    return ['overview'];
  }

  function saveModuleSelection() {
    try { localStorage.setItem(moduleStorageKey, JSON.stringify(selectedModules)); } catch (_) {}
  }

  function categoryRows() { return [...workspace.children]; }

  function updatePosition() {
    const rows = categoryRows();
    activeCategory = Math.max(0, Math.min(rows.length - 1, Math.round(workspace.scrollTop / (workspace.clientHeight || 1))));
    lineupPosition.textContent = `${rows[activeCategory]?.dataset.category || ''} · ${activeCategory + 1} / ${rows.length}`;
    rows.forEach((row, i) => { row.inert = i !== activeCategory; });
    previousCategory.disabled = activeCategory === 0;
    nextCategory.disabled = activeCategory === rows.length - 1;
  }

  function goCategory(index) {
    workspace.scrollTo({ top: Math.max(0, Math.min(categoryRows().length - 1, index)) * workspace.clientHeight, behavior: 'instant' });
    updatePosition();
  }

  function updateModuleSelection() {
    const currentCategory = categoryRows()[activeCategory]?.dataset.category;
    const selected = new Set(selectedModules);
    // Move existing panels; feed renderers retain their original DOM references.
    panels.forEach(panel => { panel.remove(); panel.hidden = !selected.has(panel.dataset.modulePanel); });
    workspace.replaceChildren();
    const groups = new Map();
    selectedModules.forEach(id => {
      const category = catalog[id].category;
      if (!groups.has(category)) groups.set(category, []);
      groups.get(category).push(id);
    });
    groups.forEach((ids, category) => {
      const row = document.createElement('section');
      row.className = 'category-page';
      row.dataset.category = category;
      row.setAttribute('aria-label', category);
      const nav = document.createElement('nav');
      nav.className = 'category-navigation';
      nav.setAttribute('aria-label', `${category} modules`);
      const previous = document.createElement('button');
      previous.type = 'button'; previous.textContent = '←'; previous.setAttribute('aria-label', `Previous ${category} module`);
      const label = document.createElement('span');
      label.setAttribute('aria-live', 'polite');
      const next = document.createElement('button');
      next.type = 'button'; next.textContent = '→'; next.setAttribute('aria-label', `Next ${category} module`);
      const track = document.createElement('div');
      track.className = 'category-track'; track.tabIndex = 0;
      track.setAttribute('aria-label', `${category}: swipe left or right for modules`);
      let index = Math.max(0, ids.indexOf(categoryModules.get(category)));
      const sync = () => {
        index = Math.max(0, Math.min(ids.length - 1, Math.round(track.scrollLeft / (track.clientWidth || 1))));
        categoryModules.set(category, ids[index]);
        label.textContent = `${category} · ${index + 1} / ${ids.length}`;
        previous.disabled = index === 0; next.disabled = index === ids.length - 1;
        ids.forEach((id, i) => { panels.get(id).inert = i !== index; });
      };
      const go = target => {
        track.scrollTo({ left: Math.max(0, Math.min(ids.length - 1, target)) * track.clientWidth, behavior: 'instant' });
        sync();
      };
      previous.addEventListener('click', () => go(index - 1));
      next.addEventListener('click', () => go(index + 1));
      track.addEventListener('scroll', sync, { passive: true });
      track.addEventListener('keydown', event => {
        if (event.target !== track) return;
        if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
          event.preventDefault(); go(index + (event.key === 'ArrowRight' ? 1 : -1));
        }
      });
      ids.forEach(id => track.append(panels.get(id)));
      nav.append(previous, label, next); row.append(nav, track); workspace.append(row);
      go(index);
    });
    panels.forEach((panel, id) => { if (!selected.has(id)) parkedPanels.append(panel); });
    moduleCount.textContent = String(selectedModules.length);
    openModulesButton.setAttribute('aria-label', `Menu, ${selectedModules.length} modules selected`);
    modulePickerCount.textContent = `${selectedModules.length} module${selectedModules.length === 1 ? '' : 's'} selected · one view at a time`;
    moduleInputs.forEach(input => {
      input.checked = selected.has(input.value);
      input.disabled = input.checked && selected.size === 1;
      input.closest('.module-option').classList.toggle('is-selected', input.checked);
      input.closest('.module-option').classList.toggle('is-disabled', input.disabled);
    });
    // Selection and removal belong in the menu, leaving more room for module content.
    closeModuleButtons.forEach(button => { button.hidden = true; });
    moduleOrder.replaceChildren();
    selectedModules.forEach((id, index) => {
      const item = document.createElement('li');
      const title = document.createElement('span');
      title.textContent = `${catalog[id].category} / ${catalog[id].title}`;
      item.append(title);
      [-1, 1].forEach(direction => {
        const button = document.createElement('button');
        button.type = 'button'; button.textContent = direction === -1 ? '↑' : '↓';
        button.dataset.orderId = id; button.dataset.direction = String(direction);
        button.setAttribute('aria-label', `Move ${catalog[id].title} ${direction === -1 ? 'up' : 'down'}`);
        button.disabled = index + direction < 0 || index + direction >= selectedModules.length;
        button.addEventListener('click', () => {
          [selectedModules[index], selectedModules[index + direction]] = [selectedModules[index + direction], selectedModules[index]];
          saveModuleSelection(); updateModuleSelection();
          const buttons = [...moduleOrder.querySelectorAll('button')].filter(b => b.dataset.orderId === id);
          (buttons.find(b => b.dataset.direction === String(direction) && !b.disabled) || buttons.find(b => !b.disabled))?.focus();
        });
        item.append(button);
      });
      moduleOrder.append(item);
    });
    goCategory(Math.max(0, categoryRows().findIndex(row => row.dataset.category === currentCategory)));
  }

  function changeModule(moduleId, show) {
    if (!moduleIds.has(moduleId)) return;
    if (show && !selectedModules.includes(moduleId)) selectedModules.push(moduleId);
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
  workspace.addEventListener('scroll', updatePosition, { passive: true });
  workspace.addEventListener('keydown', event => {
    if (event.target !== workspace && !event.target.classList.contains('category-track')) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault(); goCategory(activeCategory + (event.key === 'ArrowDown' ? 1 : -1));
    }
  });
  previousCategory.addEventListener('click', () => goCategory(activeCategory - 1));
  nextCategory.addEventListener('click', () => goCategory(activeCategory + 1));
  // Keep page boundaries aligned on rotation and browser toolbar resize.
  new ResizeObserver(() => {
    goCategory(activeCategory);
    categoryRows().forEach(row => {
      const track = row.querySelector('.category-track');
      const ids = [...track.children].map(panel => panel.dataset.modulePanel);
      track.scrollLeft = Math.max(0, ids.indexOf(categoryModules.get(row.dataset.category))) * track.clientWidth;
    });
  }).observe(workspace);
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
