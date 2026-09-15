/**
 * Layout zones for the operator dashboard.
 *
 * Overview uses one shared canvas for independently positioned leaf modules.
 * Other workspaces retain their section-local reordering and resize controls.
 *
 * Adding a zone is one entry in ZONES. Nothing else needs to change.
 *
 * Deliberately not converted to CSS Grid: these containers carry a lot of
 * !important flex sizing, and swapping their display model breaks the existing
 * appearance. Reordering achieves the same guarantees on top of what is there.
 */
(() => {
  // Section windows and Overview share this file as their geometry owner.
  window.NorthstarWindowLayout = {
    resize(box, corner, dx, dy, min = [260, 180]) {
      const next = {...box}, west = corner.includes('w'), north = corner.includes('n');
      next.w = Math.max(min[0], Math.min(west ? box.x + box.w : Infinity, box.w + (west ? -dx : dx)));
      next.h = Math.max(min[1], Math.min(north ? box.y + box.h : Infinity, box.h + (north ? -dy : dy)));
      if (west) next.x += box.w - next.w;
      if (north) next.y += box.h - next.h;
      return next;
    },
    bind(el, handle, corner, get, set, enabled, commit) {
      const change = (box, dx, dy) => corner === 'move'
        ? {...box, x: Math.max(0, box.x + dx), y: Math.max(0, box.y + dy)}
        : window.NorthstarWindowLayout.resize(box, corner, dx, dy);
      handle.addEventListener('keydown', event => {
        if (!enabled() || !['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key)) return;
        event.preventDefault(); event.stopPropagation();
        const step = event.shiftKey ? 20 : 5;
        set(change(get(), event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0,
          event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0));
        commit();
      });
      handle.addEventListener('pointerdown', event => {
        if (!enabled() || event.button !== 0) return;
        event.preventDefault(); event.stopPropagation();
        const original = {...get()}, x = event.clientX, y = event.clientY;
        handle.setPointerCapture(event.pointerId);
        const move = e => set(change(original, e.clientX - x, e.clientY - y));
        const finish = e => {
          if (e.type !== 'pointerup') set(original);
          ['pointerup','pointercancel','lostpointercapture'].forEach(type => handle.removeEventListener(type, finish));
          handle.removeEventListener('pointermove', move);
          if (handle.hasPointerCapture(event.pointerId)) handle.releasePointerCapture(event.pointerId);
          commit();
        };
        handle.addEventListener('pointermove', move);
        ['pointerup','pointercancel','lostpointercapture'].forEach(type => handle.addEventListener(type, finish));
      });
    }
  };
  const ZONES = [
    { id: 'overview', canvas: true },
    { id: 'staff', container: '#staffGroups', item: '.staff-group', step: [20, 20], min: [180, 90] },
    { id: 'market',  container: '#nodeCards',       item: '.node-card',    step: [20, 20], min: [200, 120] },
    // Weather-tab station tiles can be resized independently.
    { id: 'weather', container: '#weatherGridFull', item: '.weather-card', step: [10, 10], min: [320, 60], resize: true, sizesInEditOnly: true },
    // The header strip renders the same station cards as the Weather tab, so it
    // keeps its own zone id — reordering the strip must not reorder the tab.
    { id: 'switching', container: '#switchingGrid', item: '.switching-module', step: [20, 20], min: [260, 180] },
  ];

  const STORE = 'northstarModuleLayout';
  const SAVED_STORE = 'northstarModuleLayoutSaved';
  const SNAPSHOT_KEYS = [
    ['northstarCanvasLayoutV1', 'northstarCanvasLayoutV1Saved'],
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

  // Overview has ONE coordinate system. Keep nodes in their source containers
  // so feed renderers and delegated click handlers continue to find them.
  function setupCanvas() {
    const container = document.querySelector('main');
    if (!container) return null;
    const storageKey = 'northstarCanvasLayoutV1';
    const groups = [
      ['weather', '#weatherStrip > .weather-card', [170, 150], [100, 100]],
      ['dispatch', '#dispatchClient', [360, 140], [260, 110]],
      ['market', '#marketTopTiles > .node-card, #marketTopTiles > .ontario-market', [340, 230], [240, 150]],
      ['events', '#eventsCard', [760, 380], [340, 220]],
      ['staffHeading', '#overviewStaff > .staff-panel-head', [600, 80], [280, 70]],
      ['staff', '#staffGroups > .staff-group', [320, 180], [220, 100]],
      ['staffEmpty', '#staffGroups > .staff-empty', [320, 100], [220, 80]],
      ['overview', '#overviewModules > [data-overview-module]:not(#overviewStaff):not(#eventsCard)', [480, 300], [240, 150]],
    ];
    const originals = new WeakMap(), bound = new WeakSet();
    let positions = {}, frame = 0, gesture = false, topLayer = 30;
    try { positions = JSON.parse(localStorage.getItem(storageKey) || 'null') || readZone('overview').position; } catch {}
    if (!positions || typeof positions !== 'object' || Array.isArray(positions)) positions = {};
    const valid = p => p && ['x','y','w','h'].every(k => Number.isFinite(p[k])) && p.x >= 0 && p.y >= 0 && p.w > 0 && p.h > 0;
    positions = Object.fromEntries(Object.entries(positions).filter(([key,p]) => key.startsWith('canvas:') && valid(p)));
    const entries = () => groups.flatMap(([group, selector, size, min]) => [...document.querySelectorAll(selector)].map(el => ({
      el, size, min, key: 'canvas:' + group + ':' + (el.id || el.dataset.moduleId || el.dataset.site || group)
    })));
    const enabled = () => document.querySelector('#overview')?.classList.contains('active');
    function persist() {
      try { localStorage.setItem(storageKey, JSON.stringify(positions)); } catch {}
      writeZone('overview', {position: positions});
    }
    function bounds() {
      const visible = entries().filter(({el}) => !el.closest('[hidden]'));
      const boxes = visible.map(({key}) => positions[key]).filter(Boolean);
      container.style.setProperty('min-height', Math.max(600, ...boxes.map(p => p.y + p.h + 80)) + 'px', 'important');
      container.style.setProperty('min-width', Math.max(0, ...boxes.map(p => p.x + p.w + 24)) + 'px', 'important');
    }
    function paint(entry) {
      const p = positions[entry.key];
      const el = entry.el;
      el.dataset.canvasModule = entry.key;
      [['position','absolute'],['left',p.x+'px'],['top',p.y+'px'],['width',p.w+'px'],['height',p.h+'px'],
       ['min-width','0'],['min-height','0'],['max-width','none'],['max-height','none'],['margin','0'],['transform','none']]
        .forEach(([k,v]) => el.style.setProperty(k,v,'important'));
    }
    function bind(entry) {
      const el = entry.el;
      if (bound.has(el)) return;
      bound.add(el);
      for (const corner of ['move','se','sw','ne','nw']) {
        const resize = corner !== 'move';
        const handle = document.createElement('button');
        handle.type = 'button';
        handle.className = resize ? 'canvas-resize-handle' : 'canvas-move-handle';
        handle.dataset.corner = corner;
        handle.textContent = resize ? '◢' : '⠿';
        handle.setAttribute('aria-label', (resize ? 'Resize ' : 'Move ') + entry.key.split(':').slice(1).join(' '));
        handle.title = resize ? 'Resize · Arrow keys resize' : 'Move anywhere · Arrow keys move';
        el.append(handle);
        const change = (dx,dy) => {
          const p = positions[entry.key];
          if (resize) {
            const west = corner.includes('w'), north = corner.includes('n');
            const w = Math.max(entry.min[0], Math.min(west ? p.x + p.w : Infinity, p.w + (west ? -dx : dx)));
            const h = Math.max(entry.min[1], Math.min(north ? p.y + p.h : Infinity, p.h + (north ? -dy : dy)));
            if (west) p.x += p.w - w;
            if (north) p.y += p.h - h;
            p.w = w; p.h = h;
          }
          else { p.x = Math.max(0,p.x + dx); p.y = Math.max(0,p.y + dy); }
          paint(entry); bounds();
        };
        handle.addEventListener('keydown', event => {
          if (!editing() || !enabled() || !['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key)) return;
          event.preventDefault(); event.stopPropagation();
          const step = event.shiftKey ? 20 : 5;
          change(event.key==='ArrowRight'?step:event.key==='ArrowLeft'?-step:0,event.key==='ArrowDown'?step:event.key==='ArrowUp'?-step:0);
          persist();
        });
        handle.addEventListener('click', event => {event.preventDefault();event.stopPropagation();});
        handle.addEventListener('pointerdown', event => {
          if (!editing() || !enabled() || event.button !== 0) return;
          event.preventDefault(); event.stopPropagation(); gesture = true;
          const original = {...positions[entry.key]}, x = event.clientX + window.scrollX, y = event.clientY + window.scrollY;
          el.style.zIndex = String(++topLayer);
          handle.setPointerCapture(event.pointerId);
          const move = e => {
            positions[entry.key] = {...original};
            change(e.clientX + window.scrollX - x,e.clientY + window.scrollY - y);
            if (e.clientY > innerHeight-40) window.scrollBy(0,16);
            if (e.clientY < 40) window.scrollBy(0,-16);
            if (e.clientX > window.innerWidth-40) window.scrollBy(16,0);
            if (e.clientX < 40) window.scrollBy(-16,0);
          };
          const finish = e => {
            if (e.type === 'pointercancel' || e.type === 'lostpointercapture') {positions[entry.key] = original;paint(entry);bounds();}
            handle.removeEventListener('pointermove', move);
            handle.removeEventListener('pointerup', finish);
            handle.removeEventListener('pointercancel', finish);
            handle.removeEventListener('lostpointercapture', finish);
            if(handle.hasPointerCapture(event.pointerId))handle.releasePointerCapture(event.pointerId);
            gesture = false; persist(); schedule();
          };
          handle.addEventListener('pointermove', move);
          handle.addEventListener('pointerup', finish);
          handle.addEventListener('pointercancel', finish);
          handle.addEventListener('lostpointercapture', finish);
        });
      }
    }
    function sync() {
      frame = 0;
      if (gesture) return;
      const on = enabled();
      document.body.classList.toggle('overview-canvas', on);
      if (!on) {
        entries().forEach(({el}) => {if(originals.has(el)){el.setAttribute('style',originals.get(el));delete el.dataset.canvasModule;}});
        container.style.removeProperty('min-height');container.style.removeProperty('min-width');
        return;
      }
      const all = entries();
      const width = Math.max(320,container.clientWidth-48);
      const activeKeys = new Set(all.filter(({el})=>!el.closest('[hidden]')).map(e=>e.key));
      const occupied = Object.entries(positions).filter(([key])=>activeKeys.has(key)).map(([,p])=>p);
      all.forEach(entry => {
        if (!originals.has(entry.el)) originals.set(entry.el,entry.el.getAttribute('style') || '');
        if (!positions[entry.key]) {
          const w = Math.min(entry.size[0],width), h = entry.size[1];
          let candidate;
          // Pack NEW cards once. Saved/manual placements are never pushed into a group.
          outer: for (let y=16;;y+=20) for(let x=16;x+w<=width+16;x+=20) {
            const test={x,y,w,h};
            if(!occupied.some(p=>overlaps(test,{x:p.x-8,y:p.y-8,w:p.w+16,h:p.h+16}))) {candidate=test;break outer;}
          }
          positions[entry.key]=candidate;occupied.push(candidate);
        }
        paint(entry);bind(entry);
      });
      bounds();persist();
    }
    function schedule() { if (!frame) frame = requestAnimationFrame(sync); }
    new MutationObserver(schedule).observe(container,{subtree:true,childList:true,attributes:true,attributeFilter:['class','hidden']});
    window.addEventListener('resize',schedule);
    sync();
    return {zone:{id:'overview',canvas:true},container,sync,save:persist};
  }

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
      if (zone.id === 'weatherStrip' && !editing()) {
        el.style.setProperty('width', 'auto', 'important');
        el.style.setProperty('min-width', '64px', 'important');
        el.style.setProperty('flex', '1 1 0', 'important');
      }
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
      'main{position:relative!important}',
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
    const active = ZONES.filter(zone => zone.canvas || !window.NORTHSTAR_MODULE_WORKSPACE).map(zone => zone.canvas ? setupCanvas() : setupZone(zone)).filter(Boolean);
    if (!active.length) return;
    seedSavedLayout();
    document.querySelectorAll('.layout-save').forEach(button => button.addEventListener('click', () => {
      active.forEach(({ zone, container, save }) => {
        if (zone.canvas) { save(); return; }
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
    // The toolbar owns the confirmed reset and reload. A second listener here
    // would restore preferences even when the user cancels its confirmation.
    // Entering edit mode can reveal modules rendered while it was off.
    document.querySelectorAll('.layout-edit-toggle').forEach(button =>
      button.addEventListener('click', () => setTimeout(() => active.forEach(z => z.sync()), 0)));
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
