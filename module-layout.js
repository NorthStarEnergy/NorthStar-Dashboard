/**
 * Layout zones for the operator dashboard.
 *
 * A zone is a container whose child modules the operator can rearrange inside
 * that section while EDIT LAYOUT is active. Modules reorder and reflow — they
 * never float free and never overlap — and they resize in fixed steps, so a
 * section still lays out correctly when the window or monitor changes.
 *
 * Adding a zone is one entry in ZONES. Nothing else needs to change.
 *
 * Deliberately not converted to CSS Grid: these containers carry a lot of
 * !important flex sizing, and swapping their display model breaks the existing
 * appearance. Reordering achieves the same guarantees on top of what is there.
 */
(() => {
  const ZONES = [
    { id: 'overview', container: '#overviewModules', item: '[data-overview-module]', step: [20, 20], min: [240, 120], freeform: true, version: 3, defaults: { 'overview-field-tracker': { w: 200, h: 220 } }, minimums: { 'overview-field-tracker': [180, 200] }, autoHeight: ['overview-staff', 'overview-field-tracker'] },
    { id: 'staff',   container: '#staffGroups',     item: '.staff-group',  step: [20, 20], min: [180, 90] },
    { id: 'market',  container: '#nodeCards',       item: '.node-card',    step: [20, 20], min: [200, 120] },
    // APIROQ and IESO float across the complete Overview surface, including the
    // open area beside the weather strip.
    { id: 'marketTop', container: '#marketTopTiles', item: '*', step: [20, 20], min: [200, 112], resize: true, freeform: true, boundY: true, anchorWeather: true, version: 3, defaults: { APIROQ: { w: 240, h: 148 }, IESO: { w: 240, h: 148 } } },
    // Weather-tab station tiles can be resized independently.
    { id: 'weather', container: '#weatherGridFull', item: '.weather-card', step: [10, 10], min: [320, 60], resize: true, sizesInEditOnly: true },
    // The header strip renders the same station cards as the Weather tab, so it
    // keeps its own zone id — reordering the strip must not reorder the tab.
    { id: 'weatherStrip', container: '#weatherStrip', item: '.weather-card', step: [10, 10], min: [70, 90], resize: true, alwaysDrag: true },
    { id: 'switching', container: '#switchingGrid', item: '.switching-module', step: [20, 20], min: [260, 180] },
  ];

  const STORE = 'northstarModuleLayout';
  const SAVED_STORE = 'northstarModuleLayoutSaved';
  const SNAPSHOT_KEYS = [
    [STORE, SAVED_STORE],
    ['northstarTabOrder', 'northstarTabOrderSaved'],
    ['northstarClosedOverviewModules', 'northstarClosedOverviewModulesSaved'],
  ];
  const DEFAULT = () => window.NORTHSTAR_LAYOUT_DEFAULT || {};
  // A pointerdown on any of these belongs to the control, not to a drag.
  const INTERACTIVE = 'button,a,input,select,textarea,.module-resize-handle';
  const DRAG_THRESHOLD = 6;

  const editing = () => document.body.classList.contains('layout-edit');
  const readAll = () => { try { return JSON.parse(localStorage.getItem(STORE) || '{}') || {}; } catch { return {}; } };
  const readZone = id => Object.assign({ order: [], size: {}, position: {} }, readAll()[id]);
  const writeZone = (id, patch) => {
    const state = readAll();
    state[id] = Object.assign({ order: [], size: {} }, state[id], patch);
    try { localStorage.setItem(STORE, JSON.stringify(state)); } catch { /* private mode */ }
  };
  const readPreference = key => { try { return JSON.parse(localStorage.getItem(key) || '[]'); } catch { return []; } };
  const publishDefault = () => fetch('/api/dashboard-layout-default', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      layout: readAll(),
      preferences: {
        tabOrder: readPreference('northstarTabOrder'),
        closedOverview: readPreference('northstarClosedOverviewModules'),
      },
    }),
  }).catch(() => {});
  const snapshotSavedLayout = () => {
    try {
      SNAPSHOT_KEYS.forEach(([currentKey, savedKey]) => {
        const value = localStorage.getItem(currentKey);
        if (value != null) localStorage.setItem(savedKey, value);
      });
    } catch { /* private mode */ }
  };
  const seedSavedLayout = () => {
    try {
      SNAPSHOT_KEYS.forEach(([currentKey, savedKey]) => {
        if (localStorage.getItem(savedKey) == null) {
          const value = localStorage.getItem(currentKey);
          if (value != null) localStorage.setItem(savedKey, value);
        }
      });
    } catch { /* private mode */ }
  };
  const restoreSavedLayout = () => {
    try {
      SNAPSHOT_KEYS.forEach(([currentKey, savedKey]) => {
        const value = localStorage.getItem(savedKey);
        if (value != null) localStorage.setItem(currentKey, value);
      });
    } catch { /* private mode */ }
  };

  // Stable identity per module. Falls back to position only when a card carries
  // no natural key, in which case its saved size follows the slot, not the card.
  const keyOf = (el, index) => el.dataset.moduleId || el.dataset.site || `#${index}`;
  const itemsOf = (zone, container) => [...container.querySelectorAll(`:scope > ${zone.item}`)];
  const snap = (value, step, min) => Math.max(min, Math.round(value / step) * step);
  const overlaps = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

  function applyFreeform(zone, container) {
    const items = itemsOf(zone, container);
    if (!items.length) return;
    const containerRect = container.getBoundingClientRect();
    const zoneState = readZone(zone.id);
    const saved = zoneState.position;
    const migrateDefaults = Boolean(zone.version && zoneState.version !== zone.version);
    const positions = {};
    const initialRects = new Map(items.map(el => [el, el.getBoundingClientRect()]));
    let bottom = 0;
    items.forEach((el, index) => {
      const key = keyOf(el, index);
      const rect = initialRects.get(el);
      const existing = saved[key];
      const weatherRect = zone.anchorWeather ? document.querySelector('#weatherStrip')?.getBoundingClientRect() : null;
      const weatherEdge = weatherRect ? Math.round(weatherRect.right - containerRect.left + 6) : null;
      const requiredWidth = items.length * (rect.width + 6);
      const anchorStart = weatherEdge != null && container.clientWidth - weatherEdge >= requiredWidth
        ? weatherEdge : Math.max(0, container.clientWidth - requiredWidth);
      const anchoredX = weatherRect ? anchorStart + index * (rect.width + 6) : null;
      const anchoredY = weatherRect ? Math.round(weatherRect.top - containerRect.top) : null;
      const position = existing ? { ...existing } : {
        x: Math.max(0, Math.min(container.clientWidth - rect.width, anchoredX ?? Math.round(rect.left - containerRect.left))),
        y: Math.max(0, anchoredY ?? Math.round(rect.top - containerRect.top)),
        w: Math.round(rect.width),
        h: Math.round(rect.height),
      };
      if ((!existing || migrateDefaults) && zone.defaults?.[key]) Object.assign(position, zone.defaults[key]);
      if (migrateDefaults && zone.anchorWeather && anchoredX != null) {
        position.x = Math.max(0, Math.min(container.clientWidth - position.w, anchoredX));
        position.y = Math.max(0, anchoredY ?? position.y);
      }
      positions[key] = position;
      const autoHeight = zone.autoHeight?.includes(key);
      setSize(el, position.w, position.h, autoHeight);
      el.style.setProperty('position', 'absolute', 'important');
      el.style.setProperty('left', `${position.x}px`, 'important');
      el.style.setProperty('top', `${position.y}px`, 'important');
      bottom = Math.max(bottom, position.y + el.getBoundingClientRect().height);
    });
    container.style.setProperty('min-height', `${Math.max(bottom, 180)}px`, 'important');
    if (!Object.keys(saved).length || migrateDefaults) writeZone(zone.id, { position: positions, version: zone.version });
  }

  function savePositions(zone, container) {
    const position = {};
    itemsOf(zone, container).forEach((el, index) => {
      const key = keyOf(el, index);
      position[key] = {
        x: Math.round(parseFloat(el.style.left) || 0),
        y: Math.round(parseFloat(el.style.top) || 0),
        w: Math.round(el.getBoundingClientRect().width),
        h: Math.round(el.getBoundingClientRect().height),
      };
    });
    writeZone(zone.id, { position });
  }

  function placeFreeform(zone, container, dragged, x, y) {
    const width = dragged.getBoundingClientRect().width;
    const height = dragged.getBoundingClientRect().height;
    const maxX = Math.max(0, container.clientWidth - width);
    const maxY = zone.boundY ? Math.max(0, container.clientHeight - height) : Infinity;
    let candidate = { x: Math.min(Math.max(0, snap(x, zone.step[0], 0)), maxX), y: Math.min(Math.max(0, snap(y, zone.step[1], 0)), maxY), w: width, h: height };
    const others = itemsOf(zone, container).filter(el => el !== dragged).map(el => ({
      x: parseFloat(el.style.left) || 0, y: parseFloat(el.style.top) || 0,
      w: el.getBoundingClientRect().width, h: el.getBoundingClientRect().height,
    }));
    if (others.some(other => overlaps(candidate, other))) {
      for (let radius = 1; radius < 200 && others.some(other => overlaps(candidate, other)); radius += 1) {
        const choices = [
          { x: candidate.x + radius * zone.step[0], y: candidate.y },
          { x: candidate.x - radius * zone.step[0], y: candidate.y },
          { x: candidate.x, y: candidate.y + radius * zone.step[1] },
          { x: candidate.x, y: candidate.y - radius * zone.step[1] },
        ];
        const open = choices.map(p => ({ ...p, x: Math.min(Math.max(0, p.x), maxX), y: Math.min(Math.max(0, p.y), maxY), w: width, h: height }))
          .find(p => !others.some(other => overlaps(p, other)));
        if (open) { candidate = open; break; }
      }
    }
    dragged.style.setProperty('left', `${candidate.x}px`, 'important');
    dragged.style.setProperty('top', `${candidate.y}px`, 'important');
  }

  function setSize(el, width, height, autoHeight = false) {
    el.style.setProperty('width', `${width}px`, 'important');
    el.style.setProperty('height', autoHeight ? 'auto' : `${height}px`, 'important');
    el.style.setProperty('min-width', '0', 'important');
    el.style.setProperty('min-height', '0', 'important');
    el.style.setProperty('flex', '0 0 auto', 'important');
  }

  function clearSize(el) {
    ['width', 'height', 'min-width', 'min-height', 'flex'].forEach(p => el.style.removeProperty(p));
  }

  function updateFreeformBounds(zone, container) {
    const bottom = itemsOf(zone, container).reduce((max, el) => {
      const top = parseFloat(el.style.top) || 0;
      return Math.max(max, top + el.getBoundingClientRect().height);
    }, 0);
    container.style.setProperty('min-height', `${Math.max(bottom, 180)}px`, 'important');
  }

  function applyOrder(zone, container) {
    const { order } = readZone(zone.id);
    if (!order.length) return;
    const entries = itemsOf(zone, container).map((el, i) => ({ el, key: keyOf(el, i) }));
    const rank = new Map(order.map((key, i) => [key, i]));
    const sorted = [...entries].sort((a, b) =>
      (rank.has(a.key) ? rank.get(a.key) : Infinity) - (rank.has(b.key) ? rank.get(b.key) : Infinity));
    // Bail when already correct. Re-appending identical nodes would fire the
    // MutationObserver again and loop forever.
    if (sorted.every((entry, i) => entry.el === entries[i].el)) return;
    sorted.forEach(entry => container.append(entry.el));
  }

  function applySizes(zone, container) {
    const { size } = readZone(zone.id);
    itemsOf(zone, container).forEach((el, i) => {
      const saved = size[keyOf(el, i)];
      if (saved) setSize(el, saved.w, saved.h);
    });
  }

  const saveOrder = (zone, container) =>
    writeZone(zone.id, { order: itemsOf(zone, container).map((el, i) => keyOf(el, i)) });

  function saveSize(zone, container, el) {
    const size = readZone(zone.id).size;
    const rect = el.getBoundingClientRect();
    size[keyOf(el, itemsOf(zone, container).indexOf(el))] = { w: Math.round(rect.width), h: Math.round(rect.height) };
    writeZone(zone.id, { size });
  }

  // Nearest module centre decides the drop slot: clearly above or below picks the
  // row, otherwise left or right of centre picks the position within it.
  function insertionPoint(zone, container, dragged, x, y) {
    const others = itemsOf(zone, container).filter(el => el !== dragged);
    if (!others.length) return null;
    let best = null, bestDistance = Infinity;
    for (const el of others) {
      const r = el.getBoundingClientRect();
      const distance = Math.hypot(x - (r.left + r.width / 2), y - (r.top + r.height / 2));
      if (distance < bestDistance) { bestDistance = distance; best = el; }
    }
    const r = best.getBoundingClientRect();
    const centreX = r.left + r.width / 2, centreY = r.top + r.height / 2;
    const after = Math.abs(y - centreY) > r.height / 2 ? y > centreY : x > centreX;
    return after ? best.nextElementSibling : best;
  }

  function addHandle(zone, container, el) {
    if (el.querySelector(':scope > .module-resize-handle')) return;
    const handle = document.createElement('span');
    handle.className = 'module-resize-handle';
    handle.title = 'Resize module';
    handle.setAttribute('aria-label', 'Resize module');
    el.append(handle);
    handle.addEventListener('pointerdown', event => {
      if (!editing()) return;
      event.preventDefault();
      event.stopPropagation();
      const rect = el.getBoundingClientRect(), startX = event.clientX, startY = event.clientY;
      const minimum = zone.minimums?.[keyOf(el, itemsOf(zone, container).indexOf(el))] || zone.min;
      const autoHeight = zone.autoHeight?.includes(keyOf(el, itemsOf(zone, container).indexOf(el)));
      const move = e => setSize(el,
        snap(rect.width + e.clientX - startX, zone.step[0], minimum[0]),
        snap(rect.height + e.clientY - startY, zone.step[1], minimum[1]),
        autoHeight);
      const up = () => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        if (zone.freeform) savePositions(zone, container);
        else saveSize(zone, container, el);
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
    });
  }

  function bindModule(zone, container, el) {
    if (el.dataset.moduleLayoutBound === '1') return;
    el.dataset.moduleLayoutBound = '1';
    if (zone.resize !== false) addHandle(zone, container, el);
    if (zone.resizeOnly) return;
    el.addEventListener('pointerdown', event => {
      if ((!editing() && !zone.alwaysDrag) || event.target.closest(INTERACTIVE)) return;
      event.preventDefault();
      const startX = event.clientX, startY = event.clientY;
      const startLeft = parseFloat(el.style.left) || 0, startTop = parseFloat(el.style.top) || 0;
      let dragging = false;
      const move = e => {
        // A small threshold keeps a click on a card from counting as a drag.
        if (!dragging && Math.hypot(e.clientX - startX, e.clientY - startY) < DRAG_THRESHOLD) return;
        if (!dragging) { dragging = true; el.classList.add('module-dragging'); }
        if (zone.freeform) placeFreeform(zone, container, el, startLeft + e.clientX - startX, startTop + e.clientY - startY);
        else {
          const before = insertionPoint(zone, container, el, e.clientX, e.clientY);
          if (before !== el.nextElementSibling) {
            if (before) container.insertBefore(el, before); else container.append(el);
          }
        }
      };
      const up = () => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        el.classList.remove('module-dragging');
        if (dragging) zone.freeform ? savePositions(zone, container) : saveOrder(zone, container);
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
    });
  }

  function setupZone(zone) {
    const container = document.querySelector(zone.container);
    if (!container) return null;
    container.dataset.layoutZone = zone.id;
    const boundsObserver = zone.freeform && window.ResizeObserver
      ? new ResizeObserver(() => updateFreeformBounds(zone, container)) : null;
    const sync = () => {
      if (zone.freeform) applyFreeform(zone, container);
      else {
        applyOrder(zone, container);
        if (zone.sizesInEditOnly && !editing()) itemsOf(zone, container).forEach(clearSize);
        else applySizes(zone, container);
      }
      itemsOf(zone, container).forEach(el => {
        bindModule(zone, container, el);
        boundsObserver?.observe(el);
      });
    };
    sync();
    // These sections re-render wholesale from their feeds; rebind each time.
    new MutationObserver(sync).observe(container, { childList: true });
    return { zone, container, sync };
  }

  function injectStyle() {
    const style = document.createElement('style');
    style.textContent = [
      '[data-layout-zone] > *{position:relative}',
      '[data-layout-zone="overview"]{position:relative!important;display:block!important}',
      '[data-layout-zone="overview"] > [data-overview-module]{position:absolute!important;inset:auto!important;transform:none!important}',
      'main{position:relative!important}',
      '#marketTopTiles[data-layout-zone="marketTop"]{position:absolute!important;inset:0!important;width:auto!important;height:auto!important;margin:0!important;display:block!important;overflow:visible!important;z-index:18!important;pointer-events:none!important}',
      '#marketTopTiles[data-layout-zone="marketTop"] > *{pointer-events:auto!important}',
      '#marketTopTiles[hidden]{display:none!important}',
      'body.layout-edit [data-layout-zone] > *{cursor:move;outline:1px dashed #2f5d74;outline-offset:2px}',
      'body.layout-edit [data-layout-zone] > *.module-dragging{opacity:.6;z-index:5;cursor:grabbing}',
      'body.layout-edit [data-layout-zone] .module-resize-handle{display:block}',
      '[data-layout-zone="weatherStrip"] > .weather-card{cursor:grab;touch-action:none}',
      '[data-layout-zone="weatherStrip"] > .weather-card.module-dragging{opacity:.65;z-index:6;cursor:grabbing}',
    ].join('');
    document.head.append(style);
  }

  function init() {
    injectStyle();
    seedSavedLayout();
    const active = ZONES.map(setupZone).filter(Boolean);
    if (!active.length) return;
    document.querySelectorAll('.layout-save').forEach(button => button.addEventListener('click', () => {
      active.forEach(({ zone, container }) => {
        if (zone.freeform) {
          savePositions(zone, container);
          return;
        }
        saveOrder(zone, container);
        itemsOf(zone, container).forEach(el => {
          if (el.style.width || el.style.height) saveSize(zone, container, el);
        });
      });
      snapshotSavedLayout();
      publishDefault();
    }));
    document.querySelectorAll('.layout-reset').forEach(button => button.addEventListener('click', () => {
      restoreSavedLayout();
      active.forEach(({ zone, container }) => itemsOf(zone, container).forEach(clearSize));
    }));
    // Entering edit mode can reveal modules rendered while it was off.
    document.querySelectorAll('.layout-edit-toggle').forEach(button =>
      button.addEventListener('click', () => setTimeout(() => active.forEach(z => z.sync()), 0)));
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
