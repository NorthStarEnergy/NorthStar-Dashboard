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
    { id: 'overview', container: '#overviewModules', item: '[data-overview-module]', step: [20, 20], min: [240, 120] },
    { id: 'staff',   container: '#staffGroups',     item: '.staff-group',  step: [20, 20], min: [180, 90] },
    { id: 'market',  container: '#nodeCards',       item: '.node-card',    step: [20, 20], min: [200, 120] },
    // Weather stations are a uniform set read at a glance, so they reorder but do
    // not resize: the grip crowded a 90px card and individual sizing made the row
    // ragged. resize:false means no handle is created at all.
    { id: 'weather', container: '#weatherGridFull', item: '.weather-card', step: [10, 10], min: [80, 90], resize: false },
    // The header strip renders the same station cards as the Weather tab, so it
    // keeps its own zone id — reordering the strip must not reorder the tab.
    { id: 'weatherStrip', container: '#weatherStrip', item: '.weather-card', step: [10, 10], min: [70, 90], resize: false },
    { id: 'switching', container: '#switchingGrid', item: '.switching-module', step: [20, 20], min: [260, 180] },
  ];

  const STORE = 'northstarModuleLayout';
  // A pointerdown on any of these belongs to the control, not to a drag.
  const INTERACTIVE = 'button,a,input,select,textarea,.module-resize-handle';
  const DRAG_THRESHOLD = 6;

  const editing = () => document.body.classList.contains('layout-edit');
  const readAll = () => { try { return JSON.parse(localStorage.getItem(STORE) || '{}') || {}; } catch { return {}; } };
  const readZone = id => Object.assign({ order: [], size: {} }, readAll()[id]);
  const writeZone = (id, patch) => {
    const state = readAll();
    state[id] = Object.assign({ order: [], size: {} }, state[id], patch);
    try { localStorage.setItem(STORE, JSON.stringify(state)); } catch { /* private mode */ }
  };

  // Stable identity per module. Falls back to position only when a card carries
  // no natural key, in which case its saved size follows the slot, not the card.
  const keyOf = (el, index) => el.dataset.moduleId || el.dataset.site || `#${index}`;
  const itemsOf = (zone, container) => [...container.querySelectorAll(`:scope > ${zone.item}`)];
  const snap = (value, step, min) => Math.max(min, Math.round(value / step) * step);

  function setSize(el, width, height) {
    el.style.setProperty('width', `${width}px`, 'important');
    el.style.setProperty('height', `${height}px`, 'important');
    el.style.setProperty('min-width', '0', 'important');
    el.style.setProperty('min-height', '0', 'important');
    el.style.setProperty('flex', '0 0 auto', 'important');
  }

  function clearSize(el) {
    ['width', 'height', 'min-width', 'min-height', 'flex'].forEach(p => el.style.removeProperty(p));
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
      const move = e => setSize(el,
        snap(rect.width + e.clientX - startX, zone.step[0], zone.min[0]),
        snap(rect.height + e.clientY - startY, zone.step[1], zone.min[1]));
      const up = () => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        saveSize(zone, container, el);
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
    });
  }

  function bindModule(zone, container, el) {
    if (el.dataset.moduleLayoutBound === '1') return;
    el.dataset.moduleLayoutBound = '1';
    if (zone.resize !== false) addHandle(zone, container, el);
    el.addEventListener('pointerdown', event => {
      if (!editing() || event.target.closest(INTERACTIVE)) return;
      event.preventDefault();
      const startX = event.clientX, startY = event.clientY;
      let dragging = false;
      const move = e => {
        // A small threshold keeps a click on a card from counting as a drag.
        if (!dragging && Math.hypot(e.clientX - startX, e.clientY - startY) < DRAG_THRESHOLD) return;
        if (!dragging) { dragging = true; el.classList.add('module-dragging'); }
        const before = insertionPoint(zone, container, el, e.clientX, e.clientY);
        if (before !== el.nextElementSibling) {
          if (before) container.insertBefore(el, before); else container.append(el);
        }
      };
      const up = () => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        el.classList.remove('module-dragging');
        if (dragging) saveOrder(zone, container);
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
    });
  }

  function setupZone(zone) {
    const container = document.querySelector(zone.container);
    if (!container) return null;
    container.dataset.layoutZone = zone.id;
    const sync = () => {
      applyOrder(zone, container);
      applySizes(zone, container);
      itemsOf(zone, container).forEach(el => bindModule(zone, container, el));
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
      'body.layout-edit [data-layout-zone] > *{cursor:move;outline:1px dashed #2f5d74;outline-offset:2px}',
      'body.layout-edit [data-layout-zone] > *.module-dragging{opacity:.6;z-index:5;cursor:grabbing}',
      'body.layout-edit [data-layout-zone] .module-resize-handle{display:block}',
    ].join('');
    document.head.append(style);
  }

  function init() {
    injectStyle();
    const active = ZONES.map(setupZone).filter(Boolean);
    if (!active.length) return;
    document.querySelectorAll('.layout-reset').forEach(button => button.addEventListener('click', () => {
      try { localStorage.removeItem(STORE); } catch { /* private mode */ }
      active.forEach(({ zone, container }) => itemsOf(zone, container).forEach(clearSize));
    }));
    // Entering edit mode can reveal modules rendered while it was off.
    document.querySelectorAll('.layout-edit-toggle').forEach(button =>
      button.addEventListener('click', () => setTimeout(() => active.forEach(z => z.sync()), 0)));
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
