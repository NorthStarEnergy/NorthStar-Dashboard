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
  const moduleNudges = new WeakMap();
  // Section windows and Overview share this file as their geometry owner.
  window.NorthstarWindowLayout = {
    nudge(handle, dx, dy) {
      return moduleNudges.get(handle)?.(dx, dy) || false;
    },
    resize(box, corner, dx, dy, min = [1, 1]) {
      const next = {...box}, west = corner.includes('w'), north = corner.includes('n');
      if (/[ew]/.test(corner)) next.w = Math.max(min[0], Math.min(west ? box.x + box.w : Infinity, box.w + (west ? -dx : dx)));
      if (/[ns]/.test(corner)) next.h = Math.max(min[1], Math.min(north ? box.y + box.h : Infinity, box.h + (north ? -dy : dy)));
      if (west) next.x += box.w - next.w;
      if (north) next.y += box.h - next.h;
      return next;
    },
    bind(el, handle, corner, get, set, enabled, commit) {
      const change = (box, dx, dy) => corner === 'move'
        ? {...box, x: Math.max(0, box.x + dx), y: Math.max(0, box.y + dy)}
        : window.NorthstarWindowLayout.resize(box, corner, dx, dy);
      if (corner === 'move') moduleNudges.set(handle, (dx, dy) => {
        if (!enabled()) return false;
        set(change(get(), dx, dy)); commit(); return true;
      });
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
        el.classList.add('module-dragging');
        handle.setPointerCapture(event.pointerId);
        const move = e => set(change(original, e.clientX - x, e.clientY - y));
        const finish = e => {
          if (e.type !== 'pointerup') set(original);
          el.classList.remove('module-dragging');
          ['pointerup','pointercancel','lostpointercapture'].forEach(type => handle.removeEventListener(type, finish));
          handle.removeEventListener('pointermove', move);
          if (handle.hasPointerCapture(event.pointerId)) handle.releasePointerCapture(event.pointerId);
          commit(e);
        };
        handle.addEventListener('pointermove', move);
        ['pointerup','pointercancel','lostpointercapture'].forEach(type => handle.addEventListener(type, finish));
      });
    }
  };
  // Asset geometry shares this owner with module geometry. Built-in assets keep
  // their feed-owned DOM and flow position; custom assets use a module canvas.
  window.NorthstarAssetLayout = {
    box(node, record = {}) {
      const css = getComputedStyle(node);
      return {x: Number(record.x) || 0, y: Number(record.y) || 0,
        w: Number(record.w) || parseFloat(css.width) || node.getBoundingClientRect().width,
        h: Number(record.h) || parseFloat(css.height) || node.getBoundingClientRect().height};
    },
    change(box, corner, dx, dy, snap = 1) {
      const round = value => Math.round(value / snap) * snap;
      if (corner === 'move') return {...box, x: round(box.x + dx), y: round(box.y + dy)};
      const next = window.NorthstarWindowLayout.resize(box, corner, round(dx), round(dy), [8, 8]);
      return {...next, w: Math.max(8, next.w), h: Math.max(8, next.h)};
    },
    styles(record, custom = false, node) {
      const styles = {};
      if (custom) Object.assign(styles, {position:'absolute', left:(record.x || 0)+'px', top:(record.y || 0)+'px', margin:'0'});
      else if ('x' in record || 'y' in record) styles.translate = `${record.x || 0}px ${record.y || 0}px`;
      if ('w' in record) Object.assign(styles, {width:record.w+'px', 'min-width':'0', 'max-width':'none', 'box-sizing':'border-box', 'flex-shrink':'0'});
      if ('h' in record) Object.assign(styles, {height:record.h+'px', 'min-height':'0', 'max-height':'none', 'box-sizing':'border-box'});
      if (node && ('w' in record || 'h' in record || 'x' in record || 'y' in record) && getComputedStyle(node).display === 'inline') styles.display = 'inline-block';
      return styles;
    }
  };
  const ZONES = [
    { id: 'overview', canvas: true },
    { id: 'staff', container: '#staffGroups', item: '.staff-group', step: [5, 5], min: [240, 100], resizeOnly: true },
    { id: 'market',  container: '#nodeCards',       item: '.node-card',    step: [5, 5], min: [1, 1] },
    // Weather-tab station tiles can be resized independently.
    { id: 'weather', container: '#weatherGridFull', item: '.weather-card', step: [5, 5], min: [180, 180], resize: true, sizesInEditOnly: true },
    // The header strip renders the same station cards as the Weather tab, so it
    // keeps its own zone id — reordering the strip must not reorder the tab.
    { id: 'switching', container: '#switchingGrid', item: '.switching-module', step: [5, 5], min: [1, 1] },
  ];

  const STORE = 'northstarModuleLayout';
  const SAVED_STORE = 'northstarModuleLayoutSaved';
  const STAFF_FORT_FRANCES_FORMAT_VERSION = 1;
  const SNAPSHOT_KEYS = [
    ['northstarOverviewProfilesV2', 'northstarOverviewProfilesV2Saved'],
    ['northstarCanvasLayoutV1', 'northstarCanvasLayoutV1Saved'],
    ['northstarStatusLayoutV1', 'northstarStatusLayoutV1Saved'],
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
  const publishDefault = () => window.NorthstarLayoutPersistence ? Promise.resolve() : fetch('/api/dashboard-layout-default', {
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
  const snap = (value, step, min) => { const grid = Math.max(1, Number(window.northstarLayoutGridStep) || Number(step) || 1); return Math.max(min, window.northstarLayoutSnapToGrid === false ? value : Math.round(value / grid) * grid); };
  const overlaps = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

  // Overview has ONE coordinate system. Keep nodes in their source containers
  // so feed renderers and delegated click handlers continue to find them.
  function setupCanvas() {
    const container = document.querySelector('main');
    if (!container) return null;
    const storageKey = 'northstarCanvasLayoutV1';
    const STATION_SIZE_VERSION = 10;
    const STATION_SIZE_REFERENCE = 'canvas:stations:site:twin-falls';
    const WEATHER_HEADER_LAYOUT_VERSION = 7;
    const WEATHER_DENSITY_VERSION = 9;
    const WEATHER_REFERENCE_SIZE_VERSION = 1;
    // Overview weather is one visual family; no saved station is its width source.
    const WEATHER_FAMILY_LAYOUT_VERSION = 1;
    const OVERVIEW_GROUP_LAYOUT_VERSION = 5;
    const CAROUSEL_TIGHT_CONTROLS_VERSION = 1;
    // The Overview weather cards need room for their title and current readings.
    const WEATHER_CARD = { width: 96, height: 170, left: 16, top: 12, gap: 6, scale: 1 };
    let weatherWidth = WEATHER_CARD.width;
    const adoptWeatherWidth = source => {
      const reference = Object.entries(source || {}).find(([key, value]) => key.toLowerCase().includes('sturgeon-falls') && key.startsWith('canvas:weather:') && valid(value));
      if (reference) weatherWidth = reference[1].w;
    };
    const groups = [
      ['weather', '#weatherStrip:not([data-carousel-grouped]) > .weather-card', [weatherWidth, WEATHER_CARD.height], [1, 1]],
      ['market', '#marketTopTiles > .node-card, #marketTopTiles > .ontario-market', [340, 230], [200, 88]],
      ['stations', '#overviewGeneratingStations .gs-card', [106, 79], [1, 1]],
      ['overview', '#overviewModules > [data-overview-module]:not(#eventsCard):not(#overviewGeneratingStations)', [480, 300], [240, 150]],
    ];
    // The original live APIROQ panel is header content; hide it when the
    // fixed status bar owns dispatch so it cannot bleed through the canvas.
    const headerDispatch = document.getElementById('dispatchClient');
    if (headerDispatch && window.NORTHSTAR_PERSISTENT_STATUS) headerDispatch.hidden = true;
    const originals = new WeakMap(), bound = new WeakSet();
    let positions = {}, frame = 0, gesture = false, topLayer = 30, restoring = false, activeSignature = '';
    let statusReady = !window.NORTHSTAR_PERSISTENT_STATUS || document.body.classList.contains('ns-has-status');
    const profileKey = 'northstarOverviewProfilesV2';
    let profiles = {}, profile = '', lastWidth = 0, automatic = true, snapping = window.northstarLayoutSnapToGrid !== false, showAlignmentGuides = true, editSnapshot = null, weatherSizeApplied = false, weatherDensityApplied = false, weatherReferenceSizeApplied = false, weatherFamilyLayoutApplied = false, overviewGroupLayoutApplied = false, carouselTightControlsApplied = false;
    try { showAlignmentGuides = localStorage.getItem('northstarShowAlignmentGuides') !== 'false'; } catch {}
    window.addEventListener('northstar:layout-snap-change', event => { snapping = event.detail?.enabled !== false; renderGuides(); });
    const guideLayer = document.createElement('div');
    guideLayer.className = 'canvas-alignment-guides';
    guideLayer.setAttribute('aria-hidden', 'true');
    container.append(guideLayer);
    try { profiles = JSON.parse(localStorage.getItem(profileKey) || '{}'); } catch {}
    if (!profiles || typeof profiles !== 'object' || Array.isArray(profiles)) profiles = {};
    try { weatherDensityApplied = localStorage.getItem('northstarOverviewWeatherDensityVersion') === String(WEATHER_DENSITY_VERSION); } catch {}
    try { positions = JSON.parse(localStorage.getItem(storageKey) || 'null') || readZone('overview').position; } catch {}
    if (!positions || typeof positions !== 'object' || Array.isArray(positions)) positions = {};
    const valid = p => p && ['x','y','w','h'].every(k => Number.isFinite(p[k])) && p.x >= 0 && p.y >= 0 && p.w > 0 && p.h > 0;
    positions = Object.fromEntries(Object.entries(positions).filter(([key,p]) => key.startsWith('canvas:') && valid(p)));
    adoptWeatherWidth(positions);
    // Keep the old canvas intact as a selectable arrangement, never delete it.
    if (!profiles.previous && Object.keys(positions).length) profiles.previous = JSON.parse(JSON.stringify(positions));
    const entries = () => groups.flatMap(([group, selector, size, min]) => [...document.querySelectorAll(selector)].filter(el=>!document.body.classList.contains('ns-has-status') || !el.matches('#dispatchClient,#marketTopTiles>*,#overviewEventsSummary,#overviewFieldTracker')).map(el => {
      const staffPanel = el.id === 'overviewStaff';
      const fieldTracker = el.id === 'overviewFieldTracker';
      return {el, size: staffPanel ? [560, 320] : fieldTracker ? [280, 180] : size, min: fieldTracker ? [220, 140] : staffPanel ? [300, 180] : [1, 1], key: 'canvas:' + group + ':' + (el.id || el.dataset.moduleId || el.dataset.site || group)};
    }));
    const overviewModuleId = el => el.id || el.dataset.moduleId || el.dataset.site;
    const closedOverview = () => readPreference('northstarClosedOverviewModules');
    const restoreRemoved = document.createElement('button');
    restoreRemoved.type = 'button';
    restoreRemoved.textContent = 'Restore removed';
    restoreRemoved.hidden = true;
    function updateRestoreRemoved() { restoreRemoved.hidden = !closedOverview().length; }
    function removeFromOverview(el) {
      const id = overviewModuleId(el); if (!id) return false;
      const closed = closedOverview(); if (!closed.includes(id)) closed.push(id);
      try { localStorage.setItem('northstarClosedOverviewModules', JSON.stringify(closed)); } catch {}
      el.dataset.canvasRemoved = '1'; el.hidden = true; updateRestoreRemoved(); schedule();
      return true;
    }
    document.addEventListener('northstar:remove-overview-module', event => {
      const el = event.detail?.module;
      if (el && entries().some(entry => entry.el === el)) removeFromOverview(el);
    });
    const enabled = () => document.querySelector('#overview')?.classList.contains('active') && !document.body.classList.contains('ns-build-v2');
    function persist() {
      if(restoring || document.documentElement.dataset.nsStyles === 'loading' || document.documentElement.dataset.nsStyles === 'failed')return;
      if (profile) profiles[profile] = {positions, width:lastWidth, automatic, indicatorRow:1, weatherOriginal:1,weatherAtikokanSize:weatherSizeApplied,weatherHeaderRow:WEATHER_HEADER_LAYOUT_VERSION,weatherReferenceSizeVersion:weatherReferenceSizeApplied?WEATHER_REFERENCE_SIZE_VERSION:0,weatherFamilyLayoutVersion:WEATHER_FAMILY_LAYOUT_VERSION,overviewGroupLayoutVersion:OVERVIEW_GROUP_LAYOUT_VERSION,workspaceLayoutVersion:1,staffPaddingVersion:4,carouselTightControlsVersion:carouselTightControlsApplied?CAROUSEL_TIGHT_CONTROLS_VERSION:0};
      try { localStorage.setItem(profileKey, JSON.stringify(profiles)); } catch {}
      try { localStorage.setItem(storageKey, JSON.stringify(positions)); } catch {}
      writeZone('overview', {position: positions});
    }
    function bounds() {
      if (matchMedia('(max-width:700px)').matches) {
        container.style.removeProperty('min-height');
        container.style.removeProperty('min-width');
        return;
      }
      const visible = entries().filter(({el}) => !el.closest('[hidden]'));
      const boxes = visible.map(({key}) => {
        const p = positions[key];
        return p && key.startsWith('canvas:weather:') ? {
          ...p,
          x: p.x * WEATHER_CARD.scale,
          y: p.y * WEATHER_CARD.scale,
          w: p.w * WEATHER_CARD.scale,
          h: p.h * WEATHER_CARD.scale,
        } : p;
      }).filter(Boolean);
      container.style.setProperty('min-height', Math.max(600, ...boxes.map(p => p.y + p.h + 80)) + 'px', 'important');
      container.style.setProperty('min-width', Math.max(0, ...boxes.map(p => p.x + p.w + 24)) + 'px', 'important');
    }
    function paint(entry) {
      const p = positions[entry.key];
      const el = entry.el;
      el.dataset.canvasModule = entry.key;
      if (matchMedia('(max-width:700px)').matches) {
        ['position','left','top','width','height','min-width','min-height','max-width','max-height','margin','transform']
          .forEach(key => el.style.removeProperty(key));
        return;
      }
      // Station tiles share one frame size, including saved layouts.
      if (el.matches('#overviewGeneratingStations .gs-card')) {
        p.w = 94;
        p.h = 75;
      }
      el.dataset.ovSize = p.h < 160 || p.w < 220 ? 'compact' : p.h >= 240 && p.w >= 300 ? 'expanded' : 'standard';
      el.dataset.ovIndicator = String(p.h <= 112);
      el.style.setProperty('--ov-frame-padding',Math.min(p.h<=112?8:12,Math.max(0,(Math.min(p.w,p.h)-2)/4))+'px');
      el.style.setProperty('border-width',Math.min(1,p.w/4,p.h/4)+'px','important');
      [['position','absolute'],['left',p.x+'px'],['top',p.y+'px'],['width',p.w+'px'],['height',p.h+'px'],
       ['min-width','0'],['min-height','0'],['max-width','none'],['max-height','none'],['margin','0'],['transform','none']]
        .forEach(([k,v]) => el.style.setProperty(k,v,'important'));
    }
    function guideTargets(excludeKey) {
      const x = [0], y = [0];
      Object.entries(positions).forEach(([key, p]) => {
        if (key === excludeKey || !valid(p)) return;
        x.push(p.x, p.x + p.w / 2, p.x + p.w);
        y.push(p.y, p.y + p.h / 2, p.y + p.h);
      });
      return { x, y };
    }
    function closest(value, targets, threshold = 4) {
      let best = value, distance = threshold + 1;
      targets.forEach(target => { const next = Math.abs(value - target); if (next < distance) { best = target; distance = next; } });
      return best;
    }
    function snapMove(p, targets) {
      const xs = [p.x, p.x + p.w / 2, p.x + p.w].map((edge, i) => closest(edge, targets.x) - [0, p.w / 2, p.w][i]);
      const ys = [p.y, p.y + p.h / 2, p.y + p.h].map((edge, i) => closest(edge, targets.y) - [0, p.h / 2, p.h][i]);
      p.x = Math.max(0, xs.reduce((best, next) => Math.abs(next - p.x) < Math.abs(best - p.x) ? next : best, p.x));
      p.y = Math.max(0, ys.reduce((best, next) => Math.abs(next - p.y) < Math.abs(best - p.y) ? next : best, p.y));
    }
    function snapResize(p, corner, targets, min) {
      const right = p.x + p.w, bottom = p.y + p.h;
      if (corner.includes('w')) { const x = closest(p.x, targets.x); if (right - x >= min[0]) { p.x = Math.max(0, x); p.w = right - p.x; } }
      else if (corner.includes('e')) { const x = closest(right, targets.x); if (x - p.x >= min[0]) p.w = x - p.x; }
      if (corner.includes('n')) { const y = closest(p.y, targets.y); if (bottom - y >= min[1]) { p.y = Math.max(0, y); p.h = bottom - p.y; } }
      else if (corner.includes('s')) { const y = closest(bottom, targets.y); if (y - p.y >= min[1]) p.h = y - p.y; }
    }
    function renderGuides() {
      guideLayer.innerHTML = '';
      if (!editing() || !enabled() || !showAlignmentGuides) return;
      const {x, y} = guideTargets();
      [...new Set(x.map(Math.round))].forEach(left => {
        const line = document.createElement('span'); line.className = 'canvas-alignment-guide vertical';
        line.style.setProperty('left', `${left}px`); guideLayer.append(line);
      });
      [...new Set(y.map(Math.round))].forEach(top => {
        const line = document.createElement('span'); line.className = 'canvas-alignment-guide horizontal';
        line.style.setProperty('top', `${top}px`); guideLayer.append(line);
      });
    }
    function placeWeatherHeader(next, weather, width, card = WEATHER_CARD) {
      const {gap, scale} = WEATHER_CARD;
      const left = WEATHER_CARD.left, top = WEATHER_CARD.top;
      const cardWidth = card.width, cardHeight = card.height;
      const columns = Math.max(1, Math.min(weather.length, Math.floor((width - left * 2 + gap * scale) / ((cardWidth + gap) * scale))));
      weather.forEach((entry, index) => {
        const column = index % columns, row = Math.floor(index / columns);
        next[entry.key] = {
          x: left + column * (cardWidth + gap),
          y: top + row * (cardHeight + gap),
          w: cardWidth,
          h: cardHeight,
        };
      });
      const rows = Math.ceil(weather.length / columns);
      return scale * (top + rows * cardHeight + Math.max(0, rows - 1) * gap);
    }
    const STATION_GEOGRAPHIC_GROUPS = [
      ['twin-falls','island-falls','iroquois-falls-ts','iroquois-falls'],
      ['old-woman-falls','white-otter-rapids','camp-three-rapids','big-beaver-falls'],
      ['calm-lake','sturgeon-falls','fort-frances','fort-frances-ts'],
      ['kenora','norman','okikendawt-gs'],
      ['aiyers-1','aiyers-2','mcdougal'],
      ['bird-gs','cogent']
    ];
    function repeatedSize(entries, fallback) {
      const counts = new Map();
      entries.forEach(entry => {
        const p = positions[entry.key];
        if (!valid(p)) return;
        const width = Math.round(p.w), height = Math.round(p.h), key = `${width}x${height}`;
        const current = counts.get(key) || {width, height, count:0};
        current.count += 1; counts.set(key, current);
      });
      return [...counts.values()].sort((a,b) => b.count-a.count || a.width*a.height-b.width*b.height || a.width-b.width)[0] || fallback;
    }
    function placeStationGroups(next, stations, width, top, card) {
      const left = WEATHER_CARD.left, gap = WEATHER_CARD.gap;
      const columns = Math.max(1, Math.floor((width - left * 2 + gap) / (card.width + gap)));
      const key = entry => String(entry.el.dataset.moduleId || entry.el.dataset.site || entry.key).replace(/^site:/,'');
      const pending = new Map(stations.map(entry => [key(entry), entry]));
      let y = top;
      STATION_GEOGRAPHIC_GROUPS.forEach(group => {
        const entries = group.map(id => pending.get(id)).filter(Boolean);
        entries.forEach(entry => pending.delete(key(entry)));
        if (!entries.length) return;
        entries.forEach((entry, index) => {
          if (index && index % columns === 0) y += card.height + gap;
          next[entry.key] = {x:left + (index % columns) * (card.width + gap), y, w:card.width, h:card.height, stationFormatVersion:STATION_SIZE_VERSION};
        });
        y += card.height + gap;
      });
      [...pending.values()].forEach((entry, index) => {
        if (index && index % columns === 0) y += card.height + gap;
        next[entry.key] = {x:left + (index % columns) * (card.width + gap), y, w:card.width, h:card.height, stationFormatVersion:STATION_SIZE_VERSION};
      });
      return y + (pending.size ? card.height : 0) - gap;
    }
    function applyOverviewGroupLayout(all, width) {
      const weather = all.filter(entry => entry.key.startsWith('canvas:weather:'));
      const stations = all.filter(entry => entry.key.startsWith('canvas:stations:'));
      if (!weather.length || !stations.length) return false;
      const weatherCard = repeatedSize(weather, {width:weatherWidth, height:WEATHER_CARD.height});
      const stationCard = repeatedSize(stations, {width:106, height:79});
      weatherWidth = weatherCard.width;
      const next = Object.fromEntries(Object.entries(positions).map(([key, value]) => [key, {...value}]));
      let bottom = placeWeatherHeader(next, weather, width, weatherCard) + WEATHER_CARD.gap;
      bottom = placeStationGroups(next, stations, width, bottom, stationCard);
      const other = Object.entries(next).filter(([key]) => !key.startsWith('canvas:weather:') && !key.startsWith('canvas:stations:'));
      const earliest = Math.min(...other.map(([, p]) => p.y));
      if (Number.isFinite(earliest) && earliest < bottom + WEATHER_CARD.gap) {
        const shift = bottom + WEATHER_CARD.gap - earliest;
        other.forEach(([, p]) => { p.y += shift; });
      }
      positions = next;
      all.forEach(paint);
      return true;
    }
    function moveWeatherToHeader(all, width) {
      const next = Object.fromEntries(Object.entries(positions).map(([key,p]) => [key,{...p}]));
      const weather = all.filter(entry => entry.key.startsWith('canvas:weather:'));
      const bottom = placeWeatherHeader(next, weather, width);
      const other = Object.entries(next).filter(([key]) => !key.startsWith('canvas:weather:'));
      const earliest = Math.min(...other.map(([,p]) => p.y));
      if (Number.isFinite(earliest) && earliest < bottom + WEATHER_CARD.gap) {
        const shift = bottom + WEATHER_CARD.gap - earliest;
        other.forEach(([,p]) => { p.y += shift; });
      }
      return next;
    }
    function bind(entry) {
      const el = entry.el;
      if (bound.has(el)) return;
      bound.add(el);
      for (const corner of ['move','n','e','s','w','se','sw','ne','nw']) {
        const resize = corner !== 'move';
        const handle = document.createElement('button');
        handle.type = 'button';
        handle.className = resize ? 'canvas-resize-handle' : 'canvas-move-handle';
        handle.dataset.corner = corner;
        handle.textContent = resize ? '' : '⠿';
        handle.setAttribute('aria-label', (resize ? 'Resize ' : 'Move ') + entry.key.split(':').slice(1).join(' '));
        handle.title = resize ? 'Resize · Arrow keys resize' : 'Move anywhere · Arrow keys move';
        el.append(handle);
        const change = (dx,dy,precise=false) => {
          automatic = false;
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
          if(snapping && !precise){
            if(resize){
              const right=p.x+p.w,bottom=p.y+p.h;
              p.w=Math.max(entry.min[0],Math.min(corner.includes('w')?right:Infinity,p.w));p.h=Math.max(entry.min[1],Math.min(corner.includes('n')?bottom:Infinity,p.h));
              if(corner.includes('w'))p.x=Math.max(0,right-p.w);
              if(corner.includes('n'))p.y=Math.max(0,bottom-p.h);
              snapResize(p, corner, guideTargets(entry.key), entry.min);
            }else{
              p.x=Math.max(0,Math.round(p.x/16)*16);p.y=Math.max(0,Math.round(p.y/16)*16);
              snapMove(p, guideTargets(entry.key));
            }
          }
          p.y=Math.max(0,p.y);
          paint(entry); bounds(); renderGuides();
        };
        if (!resize) moduleNudges.set(handle, (dx, dy) => {
          if (!editing() || !enabled()) return false;
          change(dx, dy, true); persist(); return true;
        });
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
          const original = {...positions[entry.key]}, wasAutomatic=automatic, x = event.clientX + window.scrollX, y = event.clientY + window.scrollY;
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
            if (e.type === 'pointercancel' || e.type === 'lostpointercapture') {positions[entry.key] = original;automatic=wasAutomatic;paint(entry);bounds();}
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
    function arrangeRightOfStaff(all, boxes, width) {
      const staff=boxes['canvas:overview:overviewStaff'];
      if(!staff)return boxes;
      const gap=4,left=staff.x+staff.w+gap;
      const targets=all.filter(e=>e.key.startsWith('canvas:stations:') || e.key.startsWith('canvas:weather:') || e.key.startsWith('canvas:carousel:') || e.el.id==='overviewMarketMini');
      const stationWidth=Math.max(94,...targets.filter(e=>e.key.startsWith('canvas:stations:')).map(e=>boxes[e.key]?.w||e.size[0]));
      const available=stationWidth*5+gap*4;
      const columns=[
        ['twin-falls','iroquois-falls','iroquois-falls-230-kv','island-falls'],
        ['old-woman-falls','white-otter-rapids','camp-three-rapids','big-beaver-falls'],
        ['calm-lake','sturgeon-falls','fort-frances','fort-frances-ts'],
        ['kenora','norman','okikendawt-gs'],
        ['aiyers-1','aiyers-2','bird-gs','cogent','cameron']
      ];
      const stations=targets.filter(e=>e.key.startsWith('canvas:stations:'));
      const placed=new Set();
      let bottom=staff.y;
      columns.forEach((sites,column)=>{
        let y=staff.y;
        for(const site of sites){
          const entry=stations.find(e=>e.key==='canvas:stations:site:'+site);
          if(!entry)continue;
          const box=boxes[entry.key] ||= {w:entry.size[0],h:entry.size[1]};
          box.x=left+column*(stationWidth+gap);box.y=y;
          y+=box.h+gap;placed.add(entry.key);
        }
        bottom=Math.max(bottom,y);
      });
      let x=left,y=bottom,rowHeight=0;
      // Keep stations absent from the crew strip (e.g. McDougal) below its groups.
      const ordered=[...stations.filter(e=>!placed.has(e.key)),...targets.filter(e=>!e.key.startsWith('canvas:stations:'))];
      for(const entry of ordered){
        const box=boxes[entry.key] ||= {w:entry.size[0],h:entry.size[1]};
        if(x>left && x+box.w>left+available){x=left;y+=rowHeight+gap;rowHeight=0;}
        box.x=x;box.y=y;x+=box.w+gap;rowHeight=Math.max(rowHeight,box.h);
      }
      return boxes;
    }
    function arrange(all,width) {
      const next={},gap=8,left=8,top=8,right=left+width;
      const find=id=>all.find(e=>e.el.id===id);
      const put=(entry,x,y,w,h)=>{if(entry)next[entry.key]={x,y,w,h};};
      const staff=find('overviewStaff'),graph=find('overviewMarketMini');
      // Two full 342px site cards, their gap, panel padding and scrollbar.
      const staffW=Math.min(width,722);
      const mainBox=container.getBoundingClientRect();
      const staffH=Math.max(400,Math.min(680,window.innerHeight-Math.max(0,mainBox.top+window.scrollY)-24));
      put(staff,left,top,staffW,staffH);
      const market=document.querySelector('.ns-status-module[data-status="markets"]')?.getBoundingClientRect();
      if(graph){
        const w=Math.min(width,Math.max(420,market?.width||340));
        const x=Math.max(left,Math.min(right-w,(market?.left||mainBox.left+left)-mainBox.left));
        const y=staff && x<left+staffW+gap?top+staffH+gap:top;
        put(graph,x,y,w,280);
      }
      const fits=p=>Object.values(next).every(q=>p.x>=q.x+q.w+gap || p.x+p.w+gap<=q.x || p.y>=q.y+q.h+gap || p.y+p.h+gap<=q.y);
      const pack=(entry,w,h)=>{
        w=Math.min(width,w);
        const boxes=Object.values(next);
        const xs=[left,...boxes.map(p=>p.x+p.w+gap)].sort((a,b)=>a-b);
        const ys=[top,...boxes.map(p=>p.y+p.h+gap)].sort((a,b)=>a-b);
        for(const y of ys)for(const x of xs){
          if(x+w>right+.5 || !fits({x,y,w,h}))continue;
          put(entry,x,y,w,h);return;
        }
      };
      const carousel=all.find(e=>e.key.startsWith('canvas:carousel:'));
      if(carousel)pack(carousel,334,105);
      all.filter(e=>e.key.startsWith('canvas:weather:')).forEach(e=>pack(e,weatherWidth,WEATHER_CARD.height));
      all.filter(e=>e.key.startsWith('canvas:stations:')).forEach(e=>{
        const p=positions[e.key];
        pack(e,valid(p)?p.w:106,valid(p)?p.h:79);
        next[e.key].stationFormatVersion=STATION_SIZE_VERSION;
      });
      all.filter(e=>!next[e.key]).forEach(e=>pack(e,e.size[0],e.size[1]));
      return arrangeRightOfStaff(all,next,width);
    }

    const tools=document.createElement('div');tools.id='overviewArrangementTools';
    tools.innerHTML='<span class="ov-profile-label"></span><label><input type="checkbox" data-ov-snap aria-label="Toggle alignment guide snapping"> Snap to alignment</label><label><input type="checkbox" data-ov-guides aria-label="Show or hide uneven alignment lines"> Uneven lines</label><button type="button" data-ov-grid-toggle aria-pressed="false">Hide grid lines</button><button type="button" data-ov-arrange>Arrange default</button><button type="button" data-ov-previous>Previous arrangement</button><button type="button" data-ov-fit>Bring into view</button><button type="button" data-ov-cancel>Cancel</button>';
    tools.append(restoreRemoved);
    restoreRemoved.addEventListener('click', () => {
      const closed = new Set(closedOverview());
      try { localStorage.setItem('northstarClosedOverviewModules', '[]'); } catch {}
      document.querySelectorAll('main [data-overview-module], main [data-canvas-module]').forEach(el => {
        if (closed.has(overviewModuleId(el))) { el.hidden = false; delete el.dataset.canvasRemoved; }
      });
      updateRestoreRemoved(); automatic = true; schedule();
    });
    document.querySelector('.layout-toolbar')?.prepend(tools);
    document.querySelector('.layout-edit-toggle')?.addEventListener('click',()=>{
      if(!editing())editSnapshot=['northstarModuleWorkspaceV1',profileKey,storageKey,'northstarStatusLayoutV1',STORE,'northstarTabOrder','northstarClosedOverviewModules'].map(key=>[key,localStorage.getItem(key)]);
      setTimeout(renderGuides, 0);
    },true);
    tools.querySelector('[data-ov-cancel]')?.addEventListener('click',()=>{
      if(!editSnapshot)return;
      restoring=true;
      editSnapshot.forEach(([key,value])=>value===null?localStorage.removeItem(key):localStorage.setItem(key,value));location.reload();
    });
    tools.querySelector('[data-ov-snap]')?.addEventListener('change',e=>{snapping=e.target.checked;renderGuides();});
    const guideToggle=tools.querySelector('[data-ov-guides]');
    if(guideToggle){guideToggle.checked=showAlignmentGuides;guideToggle.addEventListener('change',e=>{showAlignmentGuides=e.target.checked;try{localStorage.setItem('northstarShowAlignmentGuides',String(showAlignmentGuides))}catch{}renderGuides();});}
    tools.querySelector('[data-ov-grid-toggle]')?.addEventListener('click',e=>{
      const hidden=document.body.classList.toggle('overview-grid-hidden');
      e.currentTarget.textContent=hidden?'Show grid lines':'Hide grid lines';
      e.currentTarget.setAttribute('aria-pressed',String(hidden));
    });
    tools.querySelector('[data-ov-arrange]')?.addEventListener('click',()=>{automatic=true;positions={};sync();});
    tools.querySelector('[data-ov-previous]')?.addEventListener('click',()=>{if(profiles.previous){positions=JSON.parse(JSON.stringify(profiles.previous));Object.values(positions).forEach(p=>p.y=Math.max(88,p.y));automatic=false;sync();}});
    tools.querySelector('[data-ov-fit]')?.addEventListener('click',()=>{Object.values(positions).forEach(p=>{p.w=Math.min(p.w,lastWidth);p.x=Math.max(16,Math.min(p.x,lastWidth+16-p.w));});automatic=false;sync();});
    function sync() {
      frame = 0;
      if(!statusReady)return;
      if (gesture || ['loading','failed'].includes(document.documentElement.dataset.nsStyles)) return;
      const on = enabled();
      document.body.classList.toggle('overview-canvas', on);
      if (!on) {
        entries().forEach(({el}) => {if(originals.has(el)){el.setAttribute('style',originals.get(el));delete el.dataset.canvasModule;}});
        container.style.removeProperty('min-height');container.style.removeProperty('min-width');
        return;
      }
      const all = entries();
      const removed = new Set(closedOverview());
      all.forEach(({el}) => {
        if (removed.has(overviewModuleId(el))) { el.dataset.canvasRemoved = '1'; el.hidden = true; }
        else if (el.dataset.canvasRemoved === '1') { el.hidden = false; delete el.dataset.canvasRemoved; }
      });
      updateRestoreRemoved();
      if (matchMedia('(max-width:700px)').matches) {
        all.forEach(entry => {
          if (!originals.has(entry.el)) originals.set(entry.el, entry.el.getAttribute('style') || '');
          entry.el.dataset.canvasModule = entry.key;
          ['position','left','top','width','height','min-width','min-height','max-width','max-height','margin','transform']
            .forEach(key => entry.el.style.removeProperty(key));
          bind(entry);
        });
        container.style.removeProperty('min-height');
        container.style.removeProperty('min-width');
        return;
      }
      // Measure the viewport, not the canvas's manual overflow extent.
      container.style.removeProperty('min-width');
      const width = Math.max(260,Math.min(container.clientWidth,document.documentElement.clientWidth-container.getBoundingClientRect().left)-24);
      const nextProfile=width>=1500?'wide':width>=1050?'desktop':width>=620?'laptop':'narrow';
      if(nextProfile!==profile){
        if(profile)profiles[profile]={positions,width:lastWidth,automatic,indicatorRow:1,weatherOriginal:1,weatherAtikokanSize:weatherSizeApplied,weatherHeaderRow:WEATHER_HEADER_LAYOUT_VERSION,weatherReferenceSizeVersion:weatherReferenceSizeApplied?WEATHER_REFERENCE_SIZE_VERSION:0,weatherFamilyLayoutVersion:WEATHER_FAMILY_LAYOUT_VERSION,overviewGroupLayoutVersion:OVERVIEW_GROUP_LAYOUT_VERSION,workspaceLayoutVersion:1,staffPaddingVersion:4,carouselTightControlsVersion:carouselTightControlsApplied?CAROUSEL_TIGHT_CONTROLS_VERSION:0};
        profile=nextProfile;const saved=profiles[profile];
        weatherSizeApplied=saved?.weatherAtikokanSize===true;
        weatherReferenceSizeApplied=saved?.weatherReferenceSizeVersion===WEATHER_REFERENCE_SIZE_VERSION;
        weatherFamilyLayoutApplied=saved?.weatherFamilyLayoutVersion===WEATHER_FAMILY_LAYOUT_VERSION;
        overviewGroupLayoutApplied=saved?.overviewGroupLayoutVersion===OVERVIEW_GROUP_LAYOUT_VERSION;
        carouselTightControlsApplied=saved?.carouselTightControlsVersion===CAROUSEL_TIGHT_CONTROLS_VERSION;
        lastWidth=Number(saved?.width) || 0;
        positions=Object.fromEntries(Object.entries(saved?.positions||{}).filter(([,p])=>valid(p)));
        adoptWeatherWidth(positions);
        automatic=saved?.automatic!==false;
        const savedStaff=positions['canvas:overview:overviewStaff'];
        if(saved?.staffPaddingVersion!==4 && savedStaff) savedStaff.w=Math.min(width,722);
        if(saved?.workspaceLayoutVersion!==1){
          profiles.beforeWorkspaceLayout ||= {};
          profiles.beforeWorkspaceLayout[profile] ||= JSON.parse(JSON.stringify(saved||{positions}));
          positions={};automatic=true;
        }
        if(automatic && !saved?.weatherOriginal)positions={};
        // Apply the requested row to existing browser layouts once, not only new defaults.
        if(saved && saved.indicatorRow!==1){
          profiles.beforeIndicatorRow ||= {};
          profiles.beforeIndicatorRow[profile]=JSON.parse(JSON.stringify(saved));
          positions={};automatic=true;
        }
        // Weather cards render asynchronously; wait before marking this migration complete.
        const groupedWeather = all.some(entry=>entry.key==='canvas:carousel:weatherCarousel');
        if(saved && saved.weatherHeaderRow!==WEATHER_HEADER_LAYOUT_VERSION && !groupedWeather && !all.some(entry=>entry.key.startsWith('canvas:weather:'))){profile='';return;}
        if(saved && saved.weatherHeaderRow!==WEATHER_HEADER_LAYOUT_VERSION && !groupedWeather){
          profiles.beforeWeatherHeaderRow ||= {};
          profiles.beforeWeatherHeaderRow[profile] ||= JSON.parse(JSON.stringify(saved));
          if(automatic || !Object.keys(positions).length){positions={};automatic=true;}
          else positions=moveWeatherToHeader(all,width);
        }
        // Normalize every legacy weather card once. Other Overview modules keep
        // their coordinates; Lachute, Kenora, and the rest share this row.
        if(saved && !weatherFamilyLayoutApplied && all.some(entry=>entry.key.startsWith('canvas:weather:'))){
          profiles.beforeWeatherFamilyLayout ||= {};
          profiles.beforeWeatherFamilyLayout[profile] ||= JSON.parse(JSON.stringify(saved));
          positions=moveWeatherToHeader(all,width);
          weatherWidth=WEATHER_CARD.width;
          weatherSizeApplied=true;
          weatherFamilyLayoutApplied=true;
        }
      }
      const visible=all.filter(({el})=>!el.closest('[hidden]'));
      const marketBounds=document.querySelector('.ns-status-module[data-status="markets"]')?.getBoundingClientRect();
      const signature=visible.map(entry=>entry.key).sort().join('|')+'|'+Math.round(marketBounds?.left||0)+':'+Math.round(marketBounds?.width||0);
      const reflow=automatic && (!Object.keys(positions).length || width!==lastWidth || signature!==activeSignature);
      activeSignature=signature;
      lastWidth=width;
      if(reflow)positions=arrange(visible,width);
      const carouselPosition=positions['canvas:carousel:weatherCarousel'];
      if (!carouselTightControlsApplied && carouselPosition?.w === 354 && carouselPosition?.h === 105) {
        carouselPosition.w=334;
        carouselTightControlsApplied=true;
      }
      if(carouselPosition){
        const frame=all.find(entry=>entry.key==='canvas:carousel:weatherCarousel')?.el;
        const cardHeights=frame?[...frame.querySelectorAll('.weather-card')].map(card=>card.offsetHeight).filter(h=>h>0):[];
        if(cardHeights.length){
          const style=getComputedStyle(frame);
          const frameTop=frame.getBoundingClientRect().top;
          const contentBottom=Math.max(...[...frame.querySelectorAll('.weather-card')].map(card=>card.getBoundingClientRect().bottom-frameTop));
          carouselPosition.h=Math.ceil(contentBottom+(parseFloat(style.paddingBottom)||0)+(parseFloat(style.borderBottomWidth)||0));
        }
      }
      const label=tools.querySelector('.ov-profile-label');if(label)label.textContent=profile+' layout';
      const previous=tools.querySelector('[data-ov-previous]');if(previous)previous.disabled=!profiles.previous;
      const activeKeys = new Set(visible.map(e=>e.key));
      const occupied = Object.entries(positions).filter(([key])=>activeKeys.has(key)).map(([,p])=>p);
      all.forEach(entry => {
        if (!originals.has(entry.el)) originals.set(entry.el,entry.el.getAttribute('style') || '');
        if (!positions[entry.key] && entry.key==='canvas:carousel:weatherCarousel') {
          const weatherBoxes=Object.entries(positions).filter(([key,p])=>key.startsWith('canvas:weather:')&&valid(p)).map(([,p])=>p);
          if(weatherBoxes.length)positions[entry.key]={x:Math.min(...weatherBoxes.map(p=>p.x)),y:Math.min(...weatherBoxes.map(p=>p.y)),w:Math.max(...weatherBoxes.map(p=>p.w))*4+54,h:Math.max(...weatherBoxes.map(p=>p.h))+10};
        }
        const missing = !positions[entry.key];
        if (missing) {
          const w = Math.min(entry.size[0],width), h = entry.size[1];
          let candidate;
          // Pack NEW cards once. Saved/manual placements are never pushed into a group.
          const startY = entry.el.id === 'overviewFieldTracker' ? Math.max(88, ...occupied.map(p=>p.y+p.h+16)) : 88;
          outer: for (let y=startY;;y+=20) for(let x=16;x+w<=width+16;x+=20) {
            const test={x,y,w,h};
            if(!occupied.some(p=>overlaps(test,{x:p.x-8,y:p.y-8,w:p.w+16,h:p.h+16}))) {candidate=test;break outer;}
          }
          positions[entry.key]=candidate;occupied.push(candidate);
        }
        if((missing || !weatherSizeApplied || !weatherDensityApplied || reflow) && entry.key.startsWith('canvas:weather:')){
          positions[entry.key].w=weatherWidth;
          positions[entry.key].h=WEATHER_CARD.height;
        }
        paint(entry);bind(entry);
      });
      // A later default capture widened every weather frame to 106px while
      // retaining the compact 91px slot spacing. Restore the original 85px
      // family only for that exact all-card legacy state; manual sizes and
      // positions remain untouched.
      const weatherEntries = all.filter(entry => entry.key.startsWith('canvas:weather:'));
      if (!weatherReferenceSizeApplied && weatherEntries.length) {
        const legacyInflatedWeather = weatherEntries.every(entry => {
          const p = positions[entry.key];
          return p?.w === 106 && p?.h === WEATHER_CARD.height;
        });
        if (legacyInflatedWeather) {
          profiles.beforeWeatherReferenceSize ||= {};
          profiles.beforeWeatherReferenceSize[profile] ||= JSON.parse(JSON.stringify(positions));
          weatherEntries.forEach(entry => {
            positions[entry.key].w = WEATHER_CARD.width;
            paint(entry);
          });
        }
        weatherWidth = WEATHER_CARD.width;
        weatherReferenceSizeApplied = true;
      }
      // Use the saved Sturgeon Falls weather card as the shared width reference.
      const weatherReference = all.find(entry => entry.key.toLowerCase().includes('sturgeon-falls'));
      if (automatic && weatherReference && valid(positions[weatherReference.key])) {
        weatherWidth = positions[weatherReference.key].w;
        all.filter(entry => entry.key.startsWith('canvas:weather:')).forEach(entry => {
          positions[entry.key].w = weatherWidth;
          paint(entry);
        });
      }
      // Copy the operator-sized Twin Falls frame once to every station while
      // preserving each card's saved position.
      const stationReference=positions[STATION_SIZE_REFERENCE];
      if(Number.isFinite(stationReference?.w) && Number.isFinite(stationReference?.h)){
        all.filter(entry=>entry.key.startsWith('canvas:stations:')).forEach(entry=>{
          const p=positions[entry.key];
          // Repair the one legacy Old Woman Falls frame saved with 86x90;
          // preserve all other user-resized station frames.
          const legacyOldWomanFrame = entry.key === 'canvas:stations:site:old-woman-falls'
            && p.w === 86 && p.h === 90;
          if(p.stationFormatVersion===STATION_SIZE_VERSION && !legacyOldWomanFrame)return;
          p.w=stationReference.w;
          p.h=stationReference.h;
          p.stationFormatVersion=STATION_SIZE_VERSION;
          paint(entry);
        });
      }
      // Keep an automatic Overview compact. The geographic station migration
      // moved every other module beneath the map and stranded the live roster.
      if (automatic || !overviewGroupLayoutApplied) {
        if (!overviewGroupLayoutApplied) {
          profiles.beforeRightOfWorkersV5 ||= {};
          profiles.beforeRightOfWorkersV5[profile] ||= JSON.parse(JSON.stringify(positions));
        }
        positions=arrangeRightOfStaff(all,positions,width);
        all.forEach(entry=>paint(entry));
        overviewGroupLayoutApplied=true;
      }
      // Compact existing saved station rows once, retaining custom heights and other modules.
      const stationEntries=all.filter(entry=>entry.key.startsWith('canvas:stations:'));
      if(stationEntries.some(entry=>positions[entry.key].compactFiveVersion!==1)){
        profiles.beforeCompactFive ||= {};
        profiles.beforeCompactFive[profile] ||= JSON.parse(JSON.stringify(positions));
        const oldLeft=Math.min(...stationEntries.map(entry=>positions[entry.key].x));
        const top=Math.min(...stationEntries.map(entry=>positions[entry.key].y));
        const row=stationEntries.map(entry=>positions[entry.key]).filter(p=>Math.abs(p.y-top)<2).sort((a,b)=>a.x-b.x);
        const oldPitch=row.length>1 ? row[1].x-row[0].x : 114;
        const left=positions['canvas:overview:overviewStaff'] ? positions['canvas:overview:overviewStaff'].x+positions['canvas:overview:overviewStaff'].w+4 : oldLeft;
        stationEntries.forEach(entry=>{
          const p=positions[entry.key];
          if(p.compactFiveVersion===1)return;
          p.x=left+(p.x-oldLeft)*98/Math.max(1,oldPitch);
          p.w=94;p.compactFiveVersion=1;paint(entry);
        });
      }
      // Widen only the chart once per saved profile; retain later manual resizing.
      const graphEntry=all.find(entry=>entry.el.id==='overviewMarketMini');
      const graphBox=graphEntry && positions[graphEntry.key];
      const staffBox=positions['canvas:overview:overviewStaff'];
      if(graphBox && staffBox && (automatic || graphBox.demandWidthVersion!==1)){
        const left=staffBox.x+staffBox.w+4;
        const mainRect=container.getBoundingClientRect();
        const edge=document.querySelector('#nsStatusBar')?.getBoundingClientRect().right || mainRect.right;
        const available=Math.floor(edge-mainRect.left-left-4);
        graphBox.x=left;graphBox.w=Math.max(240,available);
        // A wider chart must not cover another saved module on its row.
        for(const entry of all){
          if(entry===graphEntry)continue;
          const p=positions[entry.key];
          if(p && p.x<graphBox.x+graphBox.w && p.x+p.w>graphBox.x && p.y<graphBox.y+graphBox.h && p.y+p.h>graphBox.y)graphBox.y=p.y+p.h+4;
        }
        graphBox.demandWidthVersion=1;paint(graphEntry);
      }
      if(!weatherSizeApplied && all.some(entry=>entry.key.startsWith('canvas:weather:'))){weatherSizeApplied=true;}
      if(!weatherFamilyLayoutApplied && all.some(entry=>entry.key.startsWith('canvas:weather:'))){
        positions=moveWeatherToHeader(all,width);
        weatherWidth=WEATHER_CARD.width;
        weatherFamilyLayoutApplied=true;
        all.filter(entry=>entry.key.startsWith('canvas:weather:')).forEach(entry=>paint(entry));
      }
      if(!weatherDensityApplied && all.some(entry=>entry.key.startsWith('canvas:weather:'))){weatherDensityApplied=true;try{localStorage.setItem('northstarOverviewWeatherDensityVersion',String(WEATHER_DENSITY_VERSION));}catch{}}
      bounds();persist();renderGuides();
    }
    function schedule() { if (!frame) frame = requestAnimationFrame(sync); }
    window.addEventListener('northstar:rebuild-overview-weather', event => {
      const entry=entries().find(item=>item.el===event.detail?.root);
      if(!entry || !entry.key.startsWith('canvas:weather:'))return;
      const current=positions[entry.key];
      if(!current)return;
      current.w=weatherWidth;current.h=WEATHER_CARD.height;
      paint(entry);bounds();persist();renderGuides();
    });
    new MutationObserver(schedule).observe(container,{subtree:true,childList:true,attributes:true,attributeFilter:['class','hidden']});
    window.addEventListener('resize',schedule);
    window.addEventListener('northstar:status-layout-change',schedule);
    window.addEventListener('northstar:build-view-change',schedule);
    // The persistent status bar removes duplicate top modules. Wait for it so a
    // returning section never saves a transient pre-status arrangement.
    const startAfterStatus=()=>{statusReady=true;sync();};
    if(statusReady)startAfterStatus();
    else window.addEventListener('northstar:status-ready',startAfterStatus,{once:true});
    return {zone:{id:'overview',canvas:true},container,sync,save:persist,fit(el,box){
      const entry=entries().find(item=>item.el===el);if(!entry)return false;
      const rect=container.getBoundingClientRect();
      positions[entry.key]={...(positions[entry.key]||{}),...box,x:Math.max(0,box.x-rect.left),y:Math.max(0,box.y-rect.top)};automatic=false;persist();sync();return true;
    }};
  }

  // The fixed top dashboard is a separate canvas: it remains pinned, but its
  // cards and lower boundary become editable alongside the Overview.
  function setupStatusCanvas() {
    const bar = document.getElementById('nsStatusBar');
    if (!bar || bar.dataset.statusCanvasReady) return null;
    bar.dataset.statusCanvasReady = '1';
    const detached = new URLSearchParams(location.search).get('nsStatusWindow') === '1' && !new URLSearchParams(location.search).has('nsModuleWindow');
    const storageKey = detached ? 'northstarStatusWindowLayoutV1' : 'northstarStatusLayoutV1', MIN_HEIGHT = 1;
    const snapStatus = value => { const grid = Math.max(1, Number(window.northstarLayoutGridStep) || 5); return Math.round(Number(value || 0) / grid) * grid; };
    const profileFor = width => width >= 1500 ? 'wide' : width >= 1100 ? 'desktop' : width >= 900 ? 'laptop' : 'narrow';
    const modules = () => [...bar.querySelectorAll(':scope > .ns-status-module')];
    const moduleKey = el => el.dataset.status;
    const copy = value => JSON.parse(JSON.stringify(value));
    let state = { profiles: {} }, profile = '', draft = null, frame = 0, snapToGrid = window.northstarLayoutSnapToGrid !== false;
    window.addEventListener('northstar:layout-snap-change', event => { snapToGrid = event.detail?.enabled !== false; });
    try { state = JSON.parse(localStorage.getItem(storageKey) || (detached ? localStorage.getItem('northstarStatusLayoutV1') : '') || '{}') || state; } catch {}
    if (!state || typeof state !== 'object' || Array.isArray(state)) state = { profiles: {} };
    if (!state.profiles || typeof state.profiles !== 'object' || Array.isArray(state.profiles)) state.profiles = {};
    if (!state.profiles.desktop) {
      state.profiles.desktop = { height: 113, modules: {
        crew: { x: 2, y: 0, w: 342, h: 112 },
        events: { x: 346, y: 0, w: 369, h: 112 },
        dispatch: { x: 717, y: 0, w: 167, h: 112 },
        markets: { x: 886, y: 1, w: 300, h: 112 },
      }};
      try { localStorage.setItem(storageKey, JSON.stringify(state)); } catch {}
    }


    const valid = layout => layout && Number.isFinite(layout.height) && layout.height >= MIN_HEIGHT && layout.modules && typeof layout.modules === 'object';
    const heightFor = value => {
      const max = Math.max(MIN_HEIGHT, Math.round(window.innerHeight - 48));
      return Math.max(MIN_HEIGHT, Math.min(max, Math.round(Number(value) || MIN_HEIGHT)));
    };
    const constrain = (key, next, height) => {
      const width = Math.max(1, bar.clientWidth);
      // Frames, including fixed-dashboard cards, may shrink to their asset
      // bounds. Content is allowed to clip rather than imposing a hidden floor.
      const minW = Math.min(1, width), minH = Math.min(1, height);
      const w = Math.max(minW, Math.min(width, Math.round(Number(next?.w) || minW)));
      const h = Math.max(minH, Math.min(height, Math.round(Number(next?.h) || minH)));
      return {
        x: Math.max(0, Math.min(width - w, Math.round(Number(next?.x) || 0))),
        y: Math.max(0, Math.min(height - h, Math.round(Number(next?.y) || 0))),
        w, h,
      };
    };
    const measure = () => {
      const rect = bar.getBoundingClientRect(), height = heightFor(rect.height);
      const layout = { height, modules: {} };
      modules().forEach(el => {
        const card = el.getBoundingClientRect();
        layout.modules[moduleKey(el)] = constrain(moduleKey(el), {
          x: card.left - rect.left,
          y: card.top - rect.top,
          w: card.width,
          h: card.height,
        }, height);
      });
      return layout;
    };
    const current = () => state.profiles[profile] || draft;
    const ensureLayout = () => current() || (draft = measure());
    const fit = (el,box) => {
      const layout=ensureLayout(),rect=el.getBoundingClientRect(),barRect=bar.getBoundingClientRect(),key=moduleKey(el);
      if(!modules().includes(el))return false;
      layout.height=heightFor(Math.max(layout.height,box.y-barRect.top+box.h));
      layout.modules[key]=constrain(key,{...(layout.modules[key]||{x:rect.left-barRect.left,y:rect.top-barRect.top,w:rect.width,h:rect.height}),...box,x:box.x-barRect.left,y:box.y-barRect.top},layout.height);
      state.profiles[profile]=copy(layout);draft=null;persist();apply(state.profiles[profile]);if(detached)window.dispatchEvent(new Event('northstar:status-window-dirty'));return true;
    };
    let publishTimer = 0;
    const persist = () => {
      try { localStorage.setItem(storageKey, JSON.stringify(state)); } catch {}
      if (detached || window.NorthstarLayoutPersistence) return;
      window.clearTimeout(publishTimer);
      publishTimer = window.setTimeout(() => {
        const defaults = window.NORTHSTAR_LAYOUT_DEFAULT || {};
        fetch('/api/dashboard-layout-default', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          // Publish only this editor's state; the server preserves other fields.
          // Bootstrap defaults may predate newer Overview edits in another tab.
          body: JSON.stringify({ statusLayout: state }),
        }).then(response => {
          if (response.ok) defaults.statusLayout = copy(state);
        }).catch(() => {});
      }, 250);
    };
    const notify = () => window.dispatchEvent(new Event('northstar:status-layout-change'));
    // Repair legacy half-height / overlapping frames without changing main-dashboard settings.
    const stationHeaderLayout = () => {
      const width = Math.max(1, bar.clientWidth), gap = 6, h = 154;
      const rows = width >= 1400 ? [['crew','events','dispatch','markets','weather']]
        : width >= 700 ? [['crew','events'],['dispatch','markets','weather']]
        : [['crew'],['events'],['dispatch'],['markets'],['weather']];
      const weights = {crew:310,events:350,dispatch:180,markets:300,weather:330};
      const result = {height:rows.length*(h+gap)-gap,modules:{}};
      rows.forEach((row,index)=>{
        const total=row.reduce((sum,key)=>sum+weights[key],0), available=width-gap*(row.length-1);
        let x=0;
        row.forEach((key,i)=>{const w=i===row.length-1?width-x:Math.floor(available*weights[key]/total);result.modules[key]={x,y:index*(h+gap),w,h};x+=w+gap;});
      });
      return result;
    };
    const repairStationHeader = layout => {
      const boxes=modules().map(el=>layout.modules[moduleKey(el)]);
      const invalid=boxes.some(box=>!box || box.w<1 || box.h<140 || box.x<0 || box.y<0 || box.x+box.w>bar.clientWidth+1)
        || boxes.some((a,i)=>boxes.slice(i+1).some(b=>a && b && a.x<b.x+b.w && a.x+a.w>b.x && a.y<b.y+b.h && a.y+a.h>b.y));
      if(invalid)Object.assign(layout,stationHeaderLayout());
    };
    const apply = layout => {
      if (!layout) return;
      if (detached) repairStationHeader(layout);
      // Add weather once per saved profile, immediately after the market module.
      // Fit the existing row only when it cannot accommodate the new module.
      if (!layout.modules.weather && layout.modules.markets) {
        const width=Math.max(1,bar.clientWidth),weatherWidth=Math.min(334,Math.max(120,width*.3));
        const right=Math.max(...Object.values(layout.modules).map(box=>box.x+box.w));
        const scale=Math.min(1,Math.max(1,width-weatherWidth-4)/Math.max(1,right));
        Object.values(layout.modules).forEach(box=>{box.x=Math.round(box.x*scale);box.w=Math.max(1,Math.round(box.w*scale));});
        const market=layout.modules.markets;
        layout.modules.weather={x:market.x+market.w+4,y:market.y,w:weatherWidth,h:129};
        layout.height=Math.max(layout.height,market.y+129);
      }
      layout.height = detached ? Math.max(layout.height,...Object.values(layout.modules).map(box=>box.y+box.h)) : heightFor(layout.height);
      modules().forEach(el => { layout.modules[moduleKey(el)] = constrain(moduleKey(el), layout.modules[moduleKey(el)], layout.height); });
      bar.classList.add('ns-status-layout-custom');
      bar.style.setProperty('height', layout.height + 'px', 'important');
      bar.style.setProperty('min-height', layout.height + 'px', 'important');
      modules().forEach(el => {
        const box = layout.modules[moduleKey(el)];
        [['position', 'absolute'], ['left', box.x + 'px'], ['top', box.y + 'px'], ['width', box.w + 'px'], ['height', box.h + 'px'], ['min-width', '0'], ['min-height', '0'], ['margin', '0']]
          .forEach(([name, value]) => el.style.setProperty(name, value, 'important'));
      });
      document.body.style.setProperty('--ns-status-height', layout.height + 'px');
      notify();
    };
    const clear = () => {
      bar.classList.remove('ns-status-layout-custom');
      ['height', 'min-height'].forEach(name => bar.style.removeProperty(name));
      modules().forEach(el => ['position', 'left', 'top', 'width', 'height', 'min-width', 'min-height', 'margin'].forEach(name => el.style.removeProperty(name)));
      document.body.style.removeProperty('--ns-status-height');
      notify();
    };
    const commit = () => {
      const layout = current();
      if (!layout) return;
      state.profiles[profile] = copy(layout);
      draft = null;
      persist();
      try { localStorage.setItem(storageKey + "Saved", JSON.stringify(state)); } catch (error) {if(detached)throw error;}
      apply(state.profiles[profile]);
    };
    const setModule = (key, next) => {
      const layout = ensureLayout();
      const box = snapToGrid ? { ...next, x: snapStatus(next.x), y: snapStatus(next.y), w: snapStatus(next.w), h: snapStatus(next.h) } : next;
      layout.height = heightFor(Math.max(layout.height, box.y + box.h));
      layout.modules[key] = constrain(key, box, layout.height);
      draft = layout;
      apply(layout);
      if(detached)window.dispatchEvent(new Event('northstar:status-window-dirty'));
    };
    const setHeight = next => {
      const layout = ensureLayout();
      const occupiedHeight = Math.max(MIN_HEIGHT, ...Object.values(layout.modules).map(box => box.y + box.h));
      layout.height = heightFor(Math.max(occupiedHeight, snapToGrid ? snapStatus(next.h) : next.h));
      modules().forEach(el => { layout.modules[moduleKey(el)] = constrain(moduleKey(el), layout.modules[moduleKey(el)], layout.height); });
      draft = layout;
      apply(layout);
      if(detached)window.dispatchEvent(new Event('northstar:status-window-dirty'));
    };
    function controls() {
      let toolbar = document.getElementById('statusCanvasTools');
      if (!toolbar) {
        toolbar = document.createElement('div');
        toolbar.id = 'statusCanvasTools';
        toolbar.innerHTML = '<label><input type="checkbox" data-status-snap checked> Fixed dashboard snap to grid</label><span>Uncheck for free flow</span>';
        document.querySelector('.layout-toolbar')?.prepend(toolbar);
        toolbar.querySelector('[data-status-snap]')?.addEventListener('change', event => { snapToGrid = event.target.checked; });
      }
      if (!bar.querySelector(':scope > .status-canvas-resize-handle')) {
        const handle = document.createElement('button');
        handle.type = 'button'; handle.className = 'status-canvas-resize-handle'; handle.dataset.statusLayoutHandle = 'height';
        handle.textContent = '↕ Bar height'; handle.title = 'Drag up or down to resize the top bar; resize modules individually to make it shorter'; handle.setAttribute('aria-label', 'Resize fixed dashboard height');
        bar.append(handle);
        window.NorthstarWindowLayout.bind(bar, handle, 's',
          () => ({ x: 0, y: 0, w: bar.clientWidth, h: ensureLayout().height }),
          setHeight, editing, () => {});
      }
      modules().forEach(el => {
        if (el.dataset.statusCanvasControls) return;
        el.dataset.statusCanvasControls = '1';
        const key = moduleKey(el);
        const move = document.createElement('button');
        move.type = 'button'; move.className = 'status-layout-move-handle'; move.dataset.statusLayoutHandle = 'move';
        move.textContent = '⠿'; move.title = 'Move ' + key + ' in fixed dashboard'; move.setAttribute('aria-label', move.title);
        const resizes = ['n','e','s','w','se','sw','ne','nw'].map(corner => {
          const resize = document.createElement('button');
          resize.type = 'button'; resize.className = 'status-layout-resize-handle'; resize.dataset.statusLayoutHandle = 'resize'; resize.dataset.corner = corner;
          resize.title = 'Resize ' + key + ' from ' + corner.toUpperCase() + ' corner'; resize.setAttribute('aria-label', resize.title);
          el.append(resize);
          return [corner, resize];
        });
        el.append(move);
        window.NorthstarWindowLayout.bind(el, move, 'move',
          () => ({ ...ensureLayout().modules[key] }), next => setModule(key, next), editing, () => {});
        resizes.forEach(([corner, resize]) => window.NorthstarWindowLayout.bind(el, resize, corner,
          () => ({ ...ensureLayout().modules[key] }), next => setModule(key, next), editing, () => {}));
      });
    }
    function sync() {
      frame = 0;
      if (detached && bar.hidden) return;
      const nextProfile = profileFor(bar.clientWidth || window.innerWidth);
      if (nextProfile !== profile) {
        profile = nextProfile; draft = null;
        try { state = JSON.parse(localStorage.getItem(storageKey) || '{"profiles":{}}') || {profiles:{}}; } catch { state = {profiles:{}}; }
        if (!state.profiles || typeof state.profiles !== 'object' || Array.isArray(state.profiles)) state.profiles = {};
      }
      let fallback = ['wide', 'laptop'].includes(profile) && valid(state.profiles.desktop)
        ? copy(state.profiles.desktop) : null;
      if (fallback && profile === 'laptop') {
        const right = Math.max(1, ...Object.values(fallback.modules).map(box => box.x + box.w));
        const scale = Math.min(1, bar.clientWidth / right);
        Object.values(fallback.modules).forEach(box => {
          box.x = Math.round(box.x * scale);
          box.w = Math.max(1, Math.round(box.w * scale));
        });
      }
      const saved = valid(state.profiles[profile]) ? state.profiles[profile] : fallback;
      if (saved) { controls(); apply(saved); return; }
      if (detached) { controls(); draft ||= stationHeaderLayout(); apply(draft); return; }
      if (bar.classList.contains('ns-status-layout-custom')) clear();
      if (!editing()) return;
      controls();
      draft ||= measure();
      apply(draft);
    }
    const schedule = () => { if (!frame) frame = requestAnimationFrame(sync); };
    window.addEventListener('resize', schedule);
    window.addEventListener('northstar:layout-cancel', () => {
      try { state = JSON.parse(localStorage.getItem(storageKey + 'Saved') || '{"profiles":{}}') || {profiles:{}}; } catch { state = {profiles:{}}; }
      if (!state.profiles || typeof state.profiles !== 'object' || Array.isArray(state.profiles)) state.profiles = {};
      draft = null; schedule();
    });
    sync();
    return { zone: { id: 'status', canvas: true }, container: bar, sync, save: commit, fit };
  }

  // Detached stations retain their feed anchors; geometry stays in this owner.
  function setupStatusWindow(statusOwner) {
    const shell=document.getElementById('nsStationWindow'),workers=document.getElementById('nsStatusWorkers');
    if(!shell || !workers)return null;
    const key='northstarStatusWindowViewV1',bar=document.getElementById('nsStatusBar');
    const toolbar=document.querySelector('.layout-toolbar'),toggle=document.querySelector('[data-toggle-fixed]');
    const load=()=>{try{const value=JSON.parse(localStorage.getItem(key)||'{}');return {frames:{},...value};}catch{return {frames:{}};}};
    let state=load(),dirty=false,frame=0;
    const stationSizes=new ResizeObserver(()=>{if(!frame)frame=requestAnimationFrame(sync);});
    if(!state.frames || typeof state.frames!=='object')state.frames={};
    const groups=JSON.parse(workers.dataset.stationGroups||'[]');
    const normalize=value=>String(value||'').toLowerCase().replace(/^site:/,'').replace(/[-_]/g,' ').replace(/\bgs\b/g,'').replace(/\s+/g,' ').trim();
    const places=new Map(groups.flatMap((group,col)=>group.map((site,row)=>[normalize(site),[col+1,row+1]])));
    const roots=()=>[workers,document.getElementById('overviewStaff'),document.getElementById('nsFieldActivity'),...workers.querySelectorAll('.staff-group[data-site]')].filter(Boolean);
    const id=node=>node.dataset.site?'site:'+normalize(node.dataset.site):node.id;
    const mark=()=>{dirty=true;document.body.classList.add('ns-station-dirty');};
    const options=document.createElement('div');options.className='ns-station-options';
    options.innerHTML='<label><input type="checkbox" data-fixed-visible checked> Fixed dashboard</label><label class="ns-station-view-width">View width <input type="number" data-view-width min="320" max="20000" placeholder="Auto" aria-label="Station view width in pixels"></label><span data-popout-save-status role="status"></span>';
    toolbar?.prepend(options);
    const visible=options.querySelector('[data-fixed-visible]'),width=options.querySelector('[data-view-width]');
    const setHidden=hidden=>{
      state.hidden=hidden;bar.hidden=hidden;visible.checked=!hidden;
      toggle.setAttribute('aria-expanded',String(!hidden));toggle.setAttribute('aria-label',hidden?'Show fixed dashboard':'Hide fixed dashboard');toggle.title=toggle.getAttribute('aria-label');
      if(!hidden)window.dispatchEvent(new Event('resize'));
    };
    toggle.addEventListener('click',()=>{setHidden(!state.hidden);mark();});
    visible.addEventListener('change',()=>{setHidden(!visible.checked);mark();});
    width.value=state.frames.nsStatusWorkers?.w||'';
    width.addEventListener('change',()=>{
      if(!width.value){delete state.frames.nsStatusWorkers;workers.style.removeProperty('width');}
      else if(width.checkValidity()){state.frames.nsStatusWorkers={...state.frames.nsStatusWorkers,w:Number(width.value)};}
      else {width.reportValidity();return;}
      sync();mark();
    });
    const geometry=node=>{const rect=node.getBoundingClientRect();return {x:0,y:0,w:rect.width,h:rect.height};};
    const fit=(node,box)=>{
      if(!roots().includes(node))return false;
      state.frames[id(node)]={w:Math.max(1,Math.round(box.w)),h:Math.max(1,Math.round(box.h))};
      sync();mark();return true;
    };
    function sync(){
      frame=0;
      const grid=document.getElementById('staffGroups');
      if(!grid)return;
      const columnWidths=Array(5).fill(0), columnRows=Array(5).fill(1);let unknown=groups[4]?.length||0;
      roots().forEach(node=>{
        const saved=state.frames[id(node)];
        if(node.dataset.site){
          const [col,row]=places.get(normalize(node.dataset.site))||[5,++unknown];
          node.style.gridColumn=String(col);
          node.dataset.stationOrder=String(row);
          stationSizes.observe(node);
          if(Number.isFinite(saved?.w))columnWidths[col-1]=Math.max(columnWidths[col-1],saved.w);
        }
        if(saved){for(const dimension of ['w','h'])if(Number.isFinite(saved[dimension]))node.style.setProperty(dimension==='w'?'width':'height',saved[dimension]+'px','important');}
        if(node.querySelector(':scope > [data-station-resize]'))return;
        ['e','s','se'].forEach(corner=>{
          const handle=document.createElement('button');handle.type='button';handle.className='canvas-resize-handle';handle.dataset.stationResize=corner;handle.dataset.corner=corner;
          handle.setAttribute('aria-label','Resize '+(node.dataset.site||node.getAttribute('aria-label')||node.id)+' '+corner.toUpperCase());node.append(handle);
          window.NorthstarWindowLayout.bind(node,handle,corner,()=>geometry(node),box=>fit(node,box),editing,()=>{});
        });
      });
      [...grid.querySelectorAll(':scope > .staff-group')].sort((a,b)=>Number(a.dataset.stationOrder)-Number(b.dataset.stationOrder)).forEach(node=>{
        const col=Number(node.style.gridColumn)-1, height=Math.ceil(node.getBoundingClientRect().height);
        if(height>0){node.style.gridRow=columnRows[col]+' / span '+height;columnRows[col]+=height+4;}
      });
      grid.style.setProperty('grid-template-columns',columnWidths.map(value=>value?value+'px':'minmax(0,1fr)').join(' '),'important');
      const staff=state.frames.overviewStaff,activity=state.frames.nsFieldActivity;
      workers.style.setProperty('--station-main-width',Number.isFinite(staff?.w)?staff.w+'px':'minmax(0,7fr)');
      workers.style.setProperty('--station-activity-width',Number.isFinite(activity?.w)?activity.w+'px':'minmax(0,1fr)');
    }
    const schedule=()=>{if(!frame)frame=requestAnimationFrame(sync);};
    new MutationObserver(records=>{if(records.some(record=>[...record.addedNodes,...record.removedNodes].some(node=>node.nodeType===1 && !node.matches('[data-station-resize],.ns-asset-layer'))))schedule();}).observe(workers,{childList:true,subtree:true});
    window.addEventListener('northstar:station-display-change',schedule);
    window.addEventListener('resize',schedule);
    window.addEventListener('northstar:status-window-dirty',()=>{if(editing())mark();});
    const save=()=>{
      statusOwner()?.save();
      if(window.NorthstarAssetEditor?.checkpoint()===false)throw new Error('Asset settings could not be saved.');
      const value=JSON.stringify(state);localStorage.setItem(key,value);localStorage.setItem(key+'Saved',value);
      if(localStorage.getItem(key)!==value)throw new Error('View settings could not be saved.');
      dirty=false;document.body.classList.remove('ns-station-dirty');
    };
    // Window capture precedes the shared document checkpoint: popout edits never
    // publish or reset the main Overview profile.
    window.addEventListener('click',event=>{
      if(!event.target.closest('.layout-save,.layout-reset'))return;
      event.preventDefault();event.stopImmediatePropagation();
      if(event.target.closest('.layout-reset')){
        if(!confirm('Restore the saved station pop-out layout?'))return;
        [key,'northstarStatusWindowLayoutV1','northstarStatusWindowAssetsV1'].forEach(name=>{const saved=localStorage.getItem(name+'Saved');if(saved===null)localStorage.removeItem(name);else localStorage.setItem(name,saved);});
        location.reload();return;
      }
      try{
        save();options.querySelector('[data-popout-save-status]').textContent='Saved in this browser';
        if(editing())document.querySelector('.layout-edit-toggle')?.click();
      }catch(error){mark();options.querySelector('[data-popout-save-status]').textContent='Save failed: '+error.message;}
    },true);
    window.addEventListener('beforeunload',event=>{if(dirty){event.preventDefault();event.returnValue='';}});
    workers.dataset.moduleId='status-window-view';
    setHidden(Boolean(state.hidden));sync();
    return {zone:{id:'station-window',canvas:true},container:workers,owns:node=>roots().includes(node),fit,sync,save};
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
    el.style.setProperty('box-sizing','border-box','important');
    el.style.setProperty('padding',Math.min(12,Math.max(0,(Math.min(width,height)-2)/4))+'px','important');
    el.style.setProperty('border-width',Math.min(1,width/4,height/4)+'px','important');
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
    let zoneState = readZone(zone.id);
    if (zone.id === 'staff' && zoneState.fortFrancesFormatVersion !== STAFF_FORT_FRANCES_FORMAT_VERSION) {
      zoneState = {...zoneState, size:{}, fortFrancesFormatVersion:STAFF_FORT_FRANCES_FORMAT_VERSION};
      writeZone(zone.id, {size:{}, fortFrancesFormatVersion:STAFF_FORT_FRANCES_FORMAT_VERSION});
      try {
        const savedAll=JSON.parse(localStorage.getItem(SAVED_STORE)||'{}')||{};
        savedAll.staff={...(savedAll.staff||{}),size:{},fortFrancesFormatVersion:STAFF_FORT_FRANCES_FORMAT_VERSION};
        localStorage.setItem(SAVED_STORE,JSON.stringify(savedAll));
      } catch {}
    }
    const { size } = zoneState;
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
    ['n','e','s','w','se','sw','ne','nw'].forEach(corner => {
      const handle = document.createElement('span');
      handle.className = 'module-resize-handle';
      handle.dataset.corner = corner;
      handle.title = `Resize module · ${corner.toUpperCase()} corner`;
      handle.setAttribute('aria-label', handle.title);
      el.append(handle);
      handle.addEventListener('pointerdown', event => {
      if (!editing()) return;
      event.preventDefault();
      event.stopPropagation();
      const rect = el.getBoundingClientRect(), startX = event.clientX, startY = event.clientY;
      const startLeft = parseFloat(el.style.left) || 0, startTop = parseFloat(el.style.top) || 0;
      const minimum = zone.minimums?.[keyOf(el, itemsOf(zone, container).indexOf(el))] || zone.min;
      const autoHeight = zone.autoHeight?.includes(keyOf(el, itemsOf(zone, container).indexOf(el)));
      const west = corner.includes('w'), north = corner.includes('n');
      const move = e => {
        const dx = e.clientX - startX, dy = e.clientY - startY;
        const width = snap(rect.width + (west ? -dx : dx), zone.step[0], minimum[0]);
        const height = snap(rect.height + (north ? -dy : dy), zone.step[1], minimum[1]);
        if (zone.freeform && west) el.style.left = `${Math.max(0, startLeft + rect.width - width)}px`;
        if (zone.freeform && north) el.style.top = `${Math.max(0, startTop + rect.height - height)}px`;
        setSize(el, width, height, autoHeight);
      };
      const up = () => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        if (zone.freeform) savePositions(zone, container);
        else saveSize(zone, container, el);
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
      });
    });
  }

  function bindModule(zone, container, el) {
    if (el.dataset.moduleLayoutBound === '1') return;
    el.dataset.moduleLayoutBound = '1';
    if (zone.resize !== false) addHandle(zone, container, el);
    if (zone.resizeOnly) return;
    el.addEventListener('pointerdown', event => {
      if (editing() || !zone.alwaysDrag || event.target.closest(INTERACTIVE)) return;
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
      'body.layout-edit [data-layout-zone] > *{cursor:default;outline:0}',
      'body.layout-edit [data-layout-zone] > * > :empty:not(button):not(a):not(input):not(select):not(textarea):not(.module-resize-handle){cursor:move}',
      'body.layout-edit [data-layout-zone] > *.module-dragging{opacity:.6;z-index:5;cursor:grabbing}',
      'body.layout-edit [data-layout-zone] .module-resize-handle{display:block}',
      '.canvas-alignment-guides{position:absolute;inset:0;pointer-events:none;z-index:20;overflow:visible}',
      '.canvas-alignment-guide{position:absolute;display:block;opacity:.58;border-color:#e7c364;border-style:dashed;border-width:0}',
      '.canvas-alignment-guide.vertical{top:0;bottom:0;border-left-width:1px}',
      '.canvas-alignment-guide.horizontal{left:0;right:0;border-top-width:1px}',
      '[data-layout-zone="weatherStrip"] > .weather-card{cursor:grab;touch-action:none}',
      '[data-layout-zone="weatherStrip"] > .weather-card.module-dragging{opacity:.65;z-index:6;cursor:grabbing}',
    ].join('');
    document.head.append(style);
  }

  function init() {
    injectStyle();
    seedSavedLayout();
    const statusWindow = new URLSearchParams(location.search).get('nsStatusWindow') === '1' && !new URLSearchParams(location.search).has('nsModuleWindow');
    const active = ZONES.filter(zone => !(zone.canvas && (statusWindow || window.NORTHSTAR_DEMO_HOME || window.NORTHSTAR_DEVELOPMENT_VIEW === 'fixed')) && (zone.canvas || zone.id === 'staff' && !statusWindow || !window.NORTHSTAR_MODULE_WORKSPACE)).map(zone => zone.canvas ? setupCanvas() : setupZone(zone)).filter(Boolean);
    window.NorthstarModuleGeometry={fit(root,box){
      const owner=active.find(layout=>layout.fit && (layout.container===root.parentElement || layout.zone?.id==='overview' && root.dataset.canvasModule || layout.zone?.id==='status' && root.matches('.ns-status-module[data-status]')));
      const popout=active.find(layout=>layout.owns?.(root));
      return popout?.fit(root,box) || owner?.fit(root,box) || false;
    }};
    let statusAttached = false;
    const attachStatusCanvas = () => {
      if (statusAttached || window.NORTHSTAR_DEMO_HOME && !statusWindow) return;
      const status = setupStatusCanvas();
      if (status) {
        active.push(status); statusAttached = true;
        if (statusWindow) {const popout=setupStatusWindow(()=>status);if(popout)active.push(popout);}
      }
    };
    if (document.getElementById('nsStatusBar')) attachStatusCanvas();
    else window.addEventListener('northstar:status-ready', attachStatusCanvas, { once: true });
    if (!active.length && !statusWindow) return;
    window.addEventListener('northstar:styles-ready',()=>active.forEach(z=>z.sync()));
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
      try { localStorage.setItem('northstarStatusLayoutV1Saved', localStorage.getItem('northstarStatusLayoutV1') || ''); } catch {}
      publishDefault();
    }));
    document.querySelectorAll('.layout-reset').forEach(button => button.addEventListener('click', event => {
      event.preventDefault();
      restoreSavedLayout();
      window.dispatchEvent(new Event('northstar:layout-cancel'));
    }));
    // The toolbar owns the confirmed reset and reload. A second listener here
    // would restore preferences even when the user cancels its confirmation.
    // Entering edit mode can reveal modules rendered while it was off.
    document.querySelectorAll('.layout-edit-toggle').forEach(button =>
      button.addEventListener('click', () => setTimeout(() => active.forEach(z => z.sync()), 0)));
  }

  const start = () => Promise.resolve(window.northstarLayoutReady).then(() => window.northstarStylesReady ? window.northstarStylesReady.then(init) : init());
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
