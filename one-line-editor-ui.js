(() => {
  'use strict';
  const root = document.querySelector('#oneLineEditor');
  const library = window.NorthStarOneLineSymbols;
  const live = window.NorthStarOneLineLive;
  if (!root || !library || !live) return;
  const svg = root.querySelector('#oneLineCanvas');
  const empty = root.querySelector('#oneLineEmpty');
  const status = root.querySelector('#oneLineStatus');
  const STORAGE = 'northstar.oneLineEditor.draft.v1';
  const GRID_STEP = 20;
  const state = { revision: 0, symbols: [], edges: [], selected: null, tool: 'select', dirty: false };
  let serverDocument = null;
  let serverDocuments = [];
  let outageRecords = [];
  let drag = null;
  let connectStart = null;
  let displayMode = false;
  let telemetry = [];
  let telemetryAvailable = false;
  let telemetryBusy = false;
  let telemetryTimer = null;
  let tagCatalogue = [];
  const undoStack = [], redoStack = [];
  let lastSnapshot = null;
  let zoom = 1;
  let savingServer = false;
  const $ = selector => root.querySelector(selector);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[char]);
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const symbolById = id => state.symbols.find(item => item.id === id);
  const typeInfo = type => library.get(type);
  const cleanText = (value, limit = 80) => String(value ?? '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, limit);
  const safeNumber = (value, fallback, min, max) => clamp(Number.isFinite(Number(value)) ? Number(value) : fallback, min, max);
  const windingValues = new Set((library.windingConfigs || []).map(item => item[0]));
  function setStatus(message, ok = false) { status.innerHTML = `<span>${esc(message)}</span><strong id="oneLineCount">${state.symbols.length} SYMBOLS · ${state.edges.length} CONNECTIONS · ${ok ? 'SAVED' : 'DRAFT'}</strong>`; }
  function snapshot() { return JSON.stringify({symbols:state.symbols, edges:state.edges}); }
  function resetHistory() { undoStack.length = 0; redoStack.length = 0; lastSnapshot = snapshot(); }
  function markDirty(message = 'Unsaved local changes') {
    if (!drag && lastSnapshot !== null && snapshot() !== lastSnapshot) {
      undoStack.push(lastSnapshot); if (undoStack.length > 80) undoStack.shift();
      redoStack.length = 0; lastSnapshot = snapshot();
    }
    state.dirty = true; setStatus(message); updateHistoryButtons();
  }
  function updateHistoryButtons() {
    if ($('#oneLineUndo')) $('#oneLineUndo').disabled = !undoStack.length;
    if ($('#oneLineRedo')) $('#oneLineRedo').disabled = !redoStack.length;
  }
  function historyStep(backward) {
    if (displayMode) return;
    const from = backward ? undoStack : redoStack, to = backward ? redoStack : undoStack;
    if (!from.length) return;
    to.push(snapshot()); const restored = JSON.parse(from.pop());
    state.symbols = restored.symbols; state.edges = restored.edges; state.selected = null;
    lastSnapshot = snapshot(); state.dirty = true; setStatus(backward ? 'Undone' : 'Redone'); render(); updateHistoryButtons();
  }
  function duplicateSelected() {
    const original = symbolById(state.selected);
    if (!original || displayMode) return;
    const copy = normaliseSymbol({...JSON.parse(JSON.stringify(original)), id:nextId(original.type), x:original.x + 60, y:original.y + 60,
      assetTag:'', scada:live.binding(), measurements:original.measurements.map(item => ({...item, feedCode:'',tagName:''}))},state.symbols.length);
    state.symbols.push(copy); state.selected = copy.id; markDirty('Equipment duplicated · assign its own tag and feedback'); render();
  }
  function validateDrawing() {
    const messages = [], tags = new Set();
    if (!state.symbols.length) messages.push('Add equipment to the drawing.');
    for (const symbol of state.symbols) {
      const name = symbol.assetTag || symbol.label || symbol.id;
      if (!symbol.assetTag) messages.push(`${name}: equipment tag is blank.`);
      const key = `${symbol.siteCode.toLowerCase()}|${symbol.assetTag.toLowerCase()}`;
      if (symbol.assetTag && tags.has(key)) messages.push(`${name}: duplicate equipment tag at this site.`);
      if (symbol.assetTag) tags.add(key);
      const bindings = [...(typeInfo(symbol.type)?.switching ? [symbol.scada] : []), ...symbol.measurements];
      for (const binding of bindings) {
        if (!binding.feedCode || !binding.tagName) messages.push(`${name}: ${binding.label || 'status'} feedback is not fully bound.`);
      }
      if (typeInfo(symbol.type)?.switching && symbol.scada.tagName && (!symbol.scada.openValue || !symbol.scada.closedValue || symbol.scada.openValue.toLowerCase() === symbol.scada.closedValue.toLowerCase())) messages.push(`${name}: open / closed mapping must use two different values.`);
      if (!state.edges.some(edge => edge.from === symbol.id || edge.to === symbol.id)) messages.push(`${name}: no connections.`);
    }
    const panel = $('#oneLineValidation');
    panel.hidden = false;
    panel.innerHTML = `<div><strong>Drawing checks · ${messages.length ? `${messages.length} items` : 'passed'}</strong><button type="button" id="oneLineCloseValidation">CLOSE</button></div><p>Checks cover drawing configuration only. They do not verify station topology or authorize operation.</p>${messages.length ? `<ul>${messages.map(message => `<li>${esc(message)}</li>`).join('')}</ul>` : '<p>Equipment tags, configured bindings and connections passed the available checks.</p>'}`;
    $('#oneLineCloseValidation').onclick = () => { panel.hidden = true; };
  }
  function nextId(type) {
    const info = typeInfo(type);
    if (!info) return `S-01`;
    const prefix = info.prefix;
    const used = new Set(state.symbols.map(item => item.id));
    let number = 1;
    while (used.has(`${prefix}-${String(number).padStart(2, '0')}`)) number += 1;
    return `${prefix}-${String(number).padStart(2, '0')}`;
  }
  function normaliseSymbol(item, index) {
    const info = library.get(item?.type);
    if (!info) return null;
    const rotation = [0, 90, 180, 270].includes(Number(item?.rotation)) ? Number(item.rotation) : 0;
    const windingConfig = info.winding && windingValues.has(String(item?.windingConfig || '')) ? String(item.windingConfig) : '';
    return {
      id: cleanText(item?.id, 32) || `${info.prefix}-${String(index + 1).padStart(2, '0')}`,
      type: info.id,
      x: Math.round(safeNumber(item?.x, 120 + index * 100, 30, 970) / GRID_STEP) * GRID_STEP,
      y: Math.round(safeNumber(item?.y, 280, 30, 530) / GRID_STEP) * GRID_STEP,
      rotation,
      label: cleanText(item?.label),
      deviceFunction: cleanText(item?.deviceFunction ?? info.functionNumber ?? '', 16),
      operatingState: info.switching ? (item?.operatingState === 'open' ? 'open' : 'closed') : '',
      windingConfig,
      ...live.metadata(item),
    };
  }
  function normaliseEdges(items) {
    const ids = new Set(state.symbols.map(item => item.id));
    return (Array.isArray(items) ? items : []).filter(item => ids.has(item?.from) && ids.has(item?.to) && item.from !== item.to).map((item, index) => {
      const from = symbolById(item.from);
      const to = symbolById(item.to);
      const fromSnap = library.snapPoint(from, to.x, to.y, item.fromTerminal);
      const toSnap = library.snapPoint(to, from.x, from.y, item.toTerminal);
      return {
        id: cleanText(item.id, 32) || `E-${String(index + 1).padStart(2, '0')}`,
        from: item.from,
        to: item.to,
        fromTerminal: fromSnap.id,
        toTerminal: toSnap.id,
      };
    });
  }
  function canvasPoint(event) {
    const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(svg.getScreenCTM().inverse());
    return { x: clamp(point.x, 24, 976), y: clamp(point.y, 24, 536) };
  }
  function grid() {
    let output = '';
    for (let x = 0; x <= 1000; x += GRID_STEP) output += `<line class="grid" x1="${x}" y1="0" x2="${x}" y2="560"/>`;
    for (let y = 0; y <= 560; y += GRID_STEP) output += `<line class="grid" x1="0" y1="${y}" x2="1000" y2="${y}"/>`;
    return output;
  }
  function snapMarkup(symbol) {
    if (displayMode) return '';
    if (state.tool !== 'connect' && state.selected !== symbol.id) return '';
    return library.terminals(symbol).map(term => {
      if (term.kind === 'segment') {
        return `<line class="snap-port snap-span" data-symbol-id="${esc(symbol.id)}" data-terminal-id="${esc(term.id)}" x1="${term.x1}" y1="${term.y1}" x2="${term.x2}" y2="${term.y2}"/>`;
      }
      return `<circle class="snap-port" data-symbol-id="${esc(symbol.id)}" data-terminal-id="${esc(term.id)}" cx="${term.x}" cy="${term.y}" r="6"/>`;
    }).join('');
  }
  function symbolMarkup(symbol) {
    const info = typeInfo(symbol.type);
    if (!info) return '';
    const designation = symbol.deviceFunction && !['relay', 'lockout'].includes(symbol.type) ? `<text class="device-function" x="${symbol.x}" y="${symbol.y - 36}">${esc(symbol.deviceFunction)}</text>` : '';
    const feedback = live.position(symbol.scada, telemetry, Date.now(), telemetryAvailable, symbol.siteCode);
    const drawn = displayMode && info.switching ? {...symbol, operatingState:feedback.state === 'closed' ? 'closed' : 'open'} : symbol;
    const position = info.switching ? `<text class="operating-state" x="${symbol.x}" y="${symbol.y - (symbol.deviceFunction && !['relay', 'lockout'].includes(symbol.type) ? 48 : 36)}">${esc(displayMode ? feedback.label : `DRAWN ${symbol.operatingState.toUpperCase()}`)}</text>` : '';
    const values = symbol.measurements.map((binding, index) => {
      const result = live.resolve(binding, telemetry, Date.now(), telemetryAvailable, symbol.siteCode);
      const value = displayMode ? (result.state === 'good' ? `${result.value} ${binding.unit || result.unit}` : `— ${result.label}`) : `[${binding.tagName || 'Select tag'}]`;
      return `<text class="dynamic-value" x="${symbol.x}" y="${symbol.y + 72 + index * 14}"><title>${esc(`${binding.feedCode} / ${binding.tagName} · ${result.observedAt || 'No observation'} · ${result.quality || ''}`)}</title>${esc(`${binding.label || 'Value'}: ${value}`)}</text>`;
    }).join('');
    const winding = info.winding && symbol.windingConfig ? `<text class="winding-config" x="${symbol.x}" y="${symbol.y - 36}">${esc(symbol.windingConfig.toUpperCase())}</text>` : '';
    const unknown = displayMode && info.switching && !['open', 'closed'].includes(feedback.state);
    const geometry = unknown ? `<rect class="node-shape" x="${symbol.x - 18}" y="${symbol.y - 18}" width="36" height="36"/><text x="${symbol.x}" y="${symbol.y + 5}">?</text>` : library.draw(drawn);
    return `<g class="node ${state.selected === symbol.id ? 'selected' : ''} ${displayMode ? `feedback-${feedback.state}` : ''}" data-symbol-id="${esc(symbol.id)}"><title>${esc([info.name, symbol.assetTag, symbol.siteCode, symbol.voltage, symbol.description, displayMode ? `${symbol.scada.feedCode}/${symbol.scada.tagName} · ${feedback.label} · ${feedback.observedAt || 'No observation'} · ${feedback.quality || ''}` : info.standard].filter(Boolean).join(' · '))}</title><rect class="symbol-hit" x="${symbol.x - 35}" y="${symbol.y - 32}" width="70" height="100" fill="transparent" pointer-events="all"/><g transform="rotate(${symbol.rotation} ${symbol.x} ${symbol.y})">${geometry}</g>${position}${designation}${winding}<text x="${symbol.x}" y="${symbol.y + 42}">${esc(symbol.assetTag || symbol.label || symbol.id)}</text><text class="node-type" x="${symbol.x}" y="${symbol.y + 55}">${esc(symbol.label || symbol.voltage || info.name.toUpperCase())}</text>${values}${snapMarkup(symbol)}</g>`;
  }
  function render(canvasOnly = false) {
    updateHistoryButtons();
    const wires = state.edges.map(edge => {
      const from = symbolById(edge.from), to = symbolById(edge.to);
      if (!from || !to) return '';
      const start = library.snapPoint(from, to.x, to.y, edge.fromTerminal);
      const end = library.snapPoint(to, from.x, from.y, edge.toTerminal);
      const middle = Math.round((start.x + end.x) / 2 / GRID_STEP) * GRID_STEP;
      return `<path class="wire ${state.selected === edge.id ? 'selected' : ''}" data-edge-id="${esc(edge.id)}" d="M ${start.x} ${start.y} H ${middle} V ${end.y} H ${end.x}"/>`;
    }).join('');
    svg.setAttribute('viewBox', `0 0 1000 ${Math.max(560, ...state.symbols.map(symbol => symbol.y + 90 + symbol.measurements.length * 14))}`);
    svg.style.width = `${zoom * 100}%`;
    svg.style.maxWidth = 'none';
    svg.innerHTML = `${displayMode ? '' : grid()}<g class="wires">${wires}</g><g class="symbols">${state.symbols.map(symbolMarkup).join('')}</g>`;
    empty.hidden = state.symbols.length > 0;
    const count = $('#oneLineCount');
    if (count) count.textContent = `${state.symbols.length} SYMBOLS · ${state.edges.length} CONNECTIONS · ${state.dirty ? 'DRAFT' : 'SAVED'}`;
    if (!canvasOnly) renderInspector();
  }
  function functionOptions(selected) {
    const known = new Set(library.functions.map(item => item[0]));
    const custom = selected && !known.has(selected) ? `<option value="${esc(selected)}"></option>` : '';
    return custom + library.functions.map(([value, name]) => `<option value="${esc(value)}">${esc(value ? `${value} · ${name}` : name)}</option>`).join('');
  }
  function renderInspector() {
    if (displayMode) return;
    const symbol = symbolById(state.selected);
    const inspector = $('#oneLineInspectorBody');
    const selectedEdge = state.edges.find(edge => edge.id === state.selected);
    if (selectedEdge) { inspector.innerHTML = '<p>Connection</p><button id="oneLineDeleteWire" type="button">DELETE CONNECTION</button>'; $('#oneLineDeleteWire').onclick = () => { state.edges = state.edges.filter(edge => edge !== selectedEdge); state.selected = null; markDirty('Connection deleted'); render(); }; return; }
    if (!symbol) { inspector.innerHTML = '<p class="hint">Select a symbol to edit its label, IEEE device designation, drawn position, winding, rotation, or terminals. Use CONNECT to snap a conductor between two terminals.</p>'; return; }
    const info = typeInfo(symbol.type);
    if (!info) { inspector.innerHTML = '<p class="hint">Unknown symbol type was not migrated into the current catalogue.</p>'; return; }
    let markup;
    try {
      const switching = info.switching ? `<label>DRAWN POSITION<select id="oneLineState"><option value="closed" ${symbol.operatingState === 'closed' ? 'selected' : ''}>Closed · in-service sketch</option><option value="open" ${symbol.operatingState === 'open' ? 'selected' : ''}>Open · isolated sketch</option></select></label><p class="symbol-standard-ref">Drawn OPEN/CLOSED is a drafting position for the switching package. It is not live equipment state.</p>` : '';
      const winding = info.winding ? `<label>WINDING CONFIGURATION<select id="oneLineWinding">${(library.windingConfigs || []).map(([value, name]) => `<option value="${esc(value)}" ${symbol.windingConfig === value ? 'selected' : ''}>${esc(name)}</option>`).join('')}</select></label>` : '';
      markup = `<label>SYMBOL ID<input value="${esc(symbol.id)}" disabled></label><label>SYMBOL TYPE<input value="${esc(info.name)}" disabled></label><label>IEEE DEVICE FUNCTION<input id="oneLineFunction" list="oneLineFunctionList" value="${esc(symbol.deviceFunction)}" placeholder="Optional C37.2 designation"><datalist id="oneLineFunctionList">${functionOptions(symbol.deviceFunction)}</datalist></label>${switching}${winding}<p class="symbol-standard-ref">${esc(info.standard)} · catalogue ${esc(library.catalogueVersion)}</p><label>ROTATION<select id="oneLineRotation"><option value="0" ${symbol.rotation === 0 ? 'selected' : ''}>0°</option><option value="90" ${symbol.rotation === 90 ? 'selected' : ''}>90°</option><option value="180" ${symbol.rotation === 180 ? 'selected' : ''}>180°</option><option value="270" ${symbol.rotation === 270 ? 'selected' : ''}>270°</option></select></label><div class="one-line-actions"><button type="button" id="oneLineDelete">DELETE SYMBOL</button><button type="button" id="oneLineRotate">ROTATE 90°</button></div>`;
    } catch (error) {
      inspector.innerHTML = `<p class="hint">Inspector unavailable: ${esc(error.message)}</p>`;
      return;
    }
    inspector.innerHTML = `<h4>Equipment</h4><label>LABEL<input id="oneLineLabel" value="${esc(symbol.label)}" placeholder="Equipment or circuit label"></label>${['assetTag','siteCode','voltage','description'].map((key, index) => `<label>${['EQUIPMENT TAG','SCADA SITE CODE','VOLTAGE / RATING','DESCRIPTION'][index]}<input data-equipment="${key}" value="${esc(symbol[key])}"></label>`).join('')}${bindingInspector(symbol, info)}<details><summary>Symbol settings</summary>${markup}</details>`;
    inspector.querySelectorAll('[data-equipment]').forEach(field => { field.onchange = () => { symbol[field.dataset.equipment] = cleanText(field.value, field.dataset.equipment === 'description' ? 320 : 160); markDirty('Equipment details updated'); render(); }; });
    bindFeedbackInspector(symbol);
    $('#oneLineLabel').onchange = event => { symbol.label = cleanText(event.target.value); markDirty('Label updated'); render(); };
    $('#oneLineFunction').onchange = event => { symbol.deviceFunction = cleanText(event.target.value, 16); markDirty('Device designation updated'); render(); };
    $('#oneLineRotation').onchange = event => { symbol.rotation = Number(event.target.value); markDirty(); render(); };
    const stateField = $('#oneLineState');
    if (stateField) stateField.onchange = event => { symbol.operatingState = event.target.value === 'open' ? 'open' : 'closed'; markDirty('Drawn position updated'); render(); };
    const windingField = $('#oneLineWinding');
    if (windingField) windingField.onchange = event => { symbol.windingConfig = windingValues.has(event.target.value) ? event.target.value : ''; markDirty('Winding configuration updated'); render(); };
    $('#oneLineDelete').onclick = () => { state.symbols = state.symbols.filter(item => item.id !== symbol.id); state.edges = state.edges.filter(edge => edge.from !== symbol.id && edge.to !== symbol.id); state.selected = null; markDirty('Symbol deleted'); render(); };
    $('#oneLineRotate').onclick = () => { symbol.rotation = (symbol.rotation + 90) % 360; markDirty(); render(); };
    const geometry = document.createElement('div');
    geometry.className = 'one-line-coordinate-fields';
    geometry.innerHTML = `<label>X<input id="oneLineX" type="number" min="40" max="960" step="20" value="${symbol.x}"></label><label>Y<input id="oneLineY" type="number" min="40" max="520" step="20" value="${symbol.y}"></label>`;
    inspector.append(geometry);
    ['x','y'].forEach(axis => { $(`#oneLine${axis.toUpperCase()}`).onchange = event => { symbol[axis] = Math.round(safeNumber(event.target.value, symbol[axis], 40, axis === 'x' ? 960 : 520) / GRID_STEP) * GRID_STEP; markDirty('Position updated'); render(); }; });
    const alignment = document.createElement('div');
    alignment.className = 'one-line-actions';
    alignment.innerHTML = '<button type="button" data-align-connected="y" title="Move directly connected equipment onto the selected equipment row">ALIGN CONNECTED ROW</button><button type="button" data-align-connected="x" title="Move directly connected equipment onto the selected equipment column">ALIGN CONNECTED COLUMN</button>';
    inspector.append(alignment);
    alignment.querySelectorAll('button').forEach(button => { button.onclick = () => {
      const axis = button.dataset.alignConnected;
      state.edges.filter(edge => edge.from === symbol.id || edge.to === symbol.id).forEach(edge => {
        const peer = symbolById(edge.from === symbol.id ? edge.to : edge.from); if (peer) peer[axis] = symbol[axis];
      });
      markDirty('Connected equipment aligned'); render();
    }; });
  }
  function paletteHaystack(item) {
    const aliasKeys = Object.entries(library.aliases || {}).filter(([, id]) => id === item.id).map(([key]) => key);
    return `${item.name} ${item.id} ${item.functionNumber || ''} ${item.category} ${item.standard || ''} ${aliasKeys.join(' ')}`.toLowerCase();
  }
  function bindingInspector(symbol, info) {
    const fields = (binding, index) => {
      const input = (key, label, type = 'text') => `<label>${label}<input type="${type}" data-binding="${index}" data-field="${key}" value="${esc(binding[key])}" ${type === 'number' ? 'min="10" max="86400"' : ''}></label>`;
      const choices = tagCatalogue.map((reading, choice) => `<option value="${choice}" ${binding.feedCode === reading.feedCode && binding.tagName === reading.tagName ? 'selected' : ''}>${esc(`${reading.siteCode || reading.feedCode} · ${reading.tagName}`)}</option>`).join('');
      return `${index !== 'status' ? input('label', 'VALUE LABEL') : ''}<label>IMPORTED TAG<select data-tag-choice="${index}"><option value="">Choose a tag or enter below</option>${choices}</select></label>${input('feedCode', 'FEED CODE')}${input('tagName', 'SCADA TAG NAME')}${index === 'status' ? input('openValue', 'OPEN VALUE') + input('closedValue', 'CLOSED VALUE') : input('unit', 'UNIT (BLANK = SOURCE)')}${input('staleAfterSeconds', 'STALE AFTER (SECONDS)', 'number')}`;
    };
    return `<details class="one-line-binding" open><summary>SCADA feedback</summary><button type="button" id="oneLineBrowseTags">LOAD IMPORTED TAGS</button><p class="hint">Choose from up to 500 imported tags, or enter the exact feed and tag. Read-only report feedback; Display checks freshness and quality.</p>${info.switching ? fields(symbol.scada, 'status') : ''}${symbol.measurements.map((binding, index) => `<fieldset><legend>Dynamic value ${index + 1}</legend>${fields(binding, index)}<button type="button" data-remove-value="${index}">REMOVE VALUE</button></fieldset>`).join('')}<button type="button" id="oneLineAddValue" ${symbol.measurements.length >= 6 ? 'disabled' : ''}>ADD DYNAMIC VALUE</button></details>`;
  }
  function bindFeedbackInspector(symbol) {
    $('#oneLineBrowseTags').onclick = async () => {
      try { tagCatalogue = await serverRequest('/api/scada/readings?limit=500'); if (!Array.isArray(tagCatalogue)) tagCatalogue = []; renderInspector(); setStatus(`${tagCatalogue.length} imported tags available`); }
      catch (error) { setStatus(`Tag list unavailable: ${error.message}`); }
    };
    $('#oneLineInspectorBody').querySelectorAll('[data-tag-choice]').forEach(field => { field.onchange = () => {
      if (field.value === '') return;
      const reading = tagCatalogue[Number(field.value)];
      const binding = field.dataset.tagChoice === 'status' ? symbol.scada : symbol.measurements[Number(field.dataset.tagChoice)];
      binding.feedCode = reading.feedCode; binding.tagName = reading.tagName;
      markDirty('Imported SCADA tag selected'); render();
    }; });
    $('#oneLineInspectorBody').querySelectorAll('[data-binding]').forEach(field => { field.onchange = () => {
      const binding = field.dataset.binding === 'status' ? symbol.scada : symbol.measurements[Number(field.dataset.binding)];
      binding[field.dataset.field] = field.dataset.field === 'staleAfterSeconds' ? safeNumber(field.value, 1800, 10, 86400) : cleanText(field.value, 160);
      markDirty('SCADA binding updated'); render();
    }; });
    $('#oneLineAddValue').onclick = () => { symbol.measurements.push({...live.binding(), label:'', unit:''}); markDirty('Dynamic value added'); render(); };
    $('#oneLineInspectorBody').querySelectorAll('[data-remove-value]').forEach(button => { button.onclick = () => { symbol.measurements.splice(Number(button.dataset.removeValue), 1); markDirty('Dynamic value removed'); render(); }; });
  }
  async function refreshTelemetry() {
    if (!displayMode || telemetryBusy) return;
    telemetryBusy = true;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    try {
      const groups = new Map();
      state.symbols.flatMap(symbol => [symbol.scada, ...symbol.measurements]).forEach(binding => {
        if (!binding.feedCode || !binding.tagName) return;
        if (!groups.has(binding.feedCode)) groups.set(binding.feedCode, new Set());
        groups.get(binding.feedCode).add(binding.tagName);
      });
      const readings = [];
      for (const [feed, tags] of groups) {
        const names = [...tags];
        for (let offset = 0; offset < names.length; offset += 100) {
          const query = new URLSearchParams({feed, limit:'500'});
          names.slice(offset, offset + 100).forEach(tag => query.append('tag', tag));
          const response = await fetch(`/api/scada/readings?${query}`, {cache:'no-store', signal:controller.signal});
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          const batch = await response.json();
          if (!Array.isArray(batch)) throw new Error('Invalid SCADA response');
          readings.push(...batch.filter(reading => tags.has(reading.tagName)));
        }
      }
      telemetry = readings; telemetryAvailable = true;
      $('#oneLineFeedbackStatus').textContent = groups.size ? `Read-only SCADA · checked ${new Date().toLocaleTimeString()} · hover equipment for observation time / quality` : 'No SCADA bindings configured';
    } catch (error) {
      telemetry = []; telemetryAvailable = false;
      $('#oneLineFeedbackStatus').textContent = `SCADA unavailable · ${error.message}`;
    } finally { clearTimeout(timeout); telemetryBusy = false; if (displayMode) render(true); }
  }
  function setDisplayMode(enabled) {
    $('#oneLineDrawingTitle').textContent = $('#oneLineName').value || 'Untitled station drawing';
    displayMode = enabled; state.selected = null; connectStart = null; drag = null;
    root.classList.toggle('one-line-display', enabled);
    $('#oneLineMode').textContent = enabled ? 'EDIT DRAWING' : 'DISPLAY';
    $('#oneLineMode').setAttribute('aria-pressed', String(enabled));
    $('#oneLineFeedbackStatus').textContent = enabled ? 'Loading SCADA feedback…' : 'Drawing mode · positions are drafting values';
    clearInterval(telemetryTimer);
    if (enabled) {
      telemetryAvailable = false;
      void refreshTelemetry();
      telemetryTimer = setInterval(() => { render(true); void refreshTelemetry(); }, 5000);
    }
    render();
  }
  function renderPalette(filter = '') {
    const query = filter.trim().toLowerCase();
    const common = new Set(['bus','breaker','disconnect','transformer','generator','source','load','ground','ct','vt','junction','line']);
    const visible = library.definitions.filter(item => !item.hidden && (query || $('#oneLineAllSymbols')?.checked || common.has(item.id)) && (!query || paletteHaystack(item).includes(query)));
    const groups = [...new Set(visible.map(item => item.category))];
    $('#oneLineSymbolLibrary').innerHTML = groups.map(category => `<section class="symbol-group"><h4>${esc(category)}</h4>${visible.filter(item => item.category === category).map(item => `<button class="symbol-tool" type="button" data-symbol-type="${esc(item.id)}" title="${esc(item.standard)}"><span class="symbol-glyph">${esc(item.glyph)}</span><span>${esc(item.name)}${item.functionNumber ? `<small>IEEE ${esc(item.functionNumber)}</small>` : ''}${item.switching ? '<small>OPEN/CLOSED</small>' : ''}${item.winding ? '<small>WINDING</small>' : ''}</span></button>`).join('')}</section>`).join('') || '<p class="hint">No matching symbols.</p>';
    bindToolButtons($('#oneLineSymbolLibrary'));
  }
  function addSymbol(type, point = { x: 170 + (state.symbols.length % 5) * 150, y: 120 + Math.floor(state.symbols.length / 5) * 110 }) {
    if (displayMode) return;
    const info = typeInfo(type);
    if (!info || info.hidden) { setStatus(`Unknown symbol type: ${type || 'blank'}`); return; }
    const symbol = normaliseSymbol({ id: nextId(type), type, x: point.x, y: point.y, rotation: 0, label: '', deviceFunction: info.functionNumber || '', operatingState: info.switching ? 'closed' : '', windingConfig: '' }, state.symbols.length);
    if (!symbol) return;
    state.symbols.push(symbol);
    state.selected = symbol.id;
    state.tool = 'select';
    root.querySelectorAll('.symbol-tool').forEach(button => button.classList.toggle('active', button.dataset.symbolType === 'select'));
    markDirty(`${info.name} added`);
    render();
  }
  function chooseTool(button) {
    const type = button.dataset.symbolType;
    if (type === 'select' || type === 'connect') {
      state.tool = type;
      connectStart = null;
      root.querySelectorAll('.symbol-tool').forEach(item => item.classList.toggle('active', item === button));
      setStatus(type === 'select' ? 'Select mode' : 'Connect mode · click terminals, or two symbols');
      render();
      return;
    }
    addSymbol(type);
  }
  function bindToolButtons(scope = root) { scope.querySelectorAll('.symbol-tool').forEach(button => { button.onclick = () => chooseTool(button); }); }
  function startDemo() {
    if (savingServer) return;
    const raw = [
      { id:'SRC-01', type:'source', x:80, y:220, label:'UTILITY' },
      { id:'BUS-01', type:'bus', x:230, y:220, label:'BUS A' },
      { id:'DSC-01', type:'disconnect', x:390, y:220, label:'89-1', operatingState:'open' },
      { id:'CBR-01', type:'breaker', x:540, y:220, label:'52-1', operatingState:'closed' },
      { id:'XF3-01', type:'transformer-3winding', x:720, y:220, label:'T1', windingConfig:'dy' },
      { id:'LOD-01', type:'load', x:900, y:220, label:'FEEDER 1' },
      { id:'FUS-01', type:'fuse', x:230, y:380, label:'F1', operatingState:'open' },
      { id:'RCL-01', type:'recloser', x:390, y:380, label:'RCL-1', operatingState:'closed' },
      { id:'LBS-01', type:'load-break', x:540, y:380, label:'LBS-1', operatingState:'closed' },
      { id:'CS-01', type:'circuit-switcher', x:720, y:380, label:'CS-1', operatingState:'closed' },
      { id:'LOD-02', type:'load', x:880, y:380, label:'TAP 2' },
    ];
    state.symbols = raw.map(normaliseSymbol).filter(Boolean);
    state.edges = [
      { from:'SRC-01', to:'BUS-01' },
      { from:'BUS-01', to:'DSC-01' },
      { from:'DSC-01', to:'CBR-01' },
      { from:'CBR-01', to:'XF3-01' },
      { from:'XF3-01', to:'LOD-01' },
      { from:'BUS-01', to:'FUS-01' },
      { from:'BUS-01', to:'RCL-01' },
      { from:'RCL-01', to:'LBS-01' },
      { from:'LBS-01', to:'CS-01' },
      { from:'CS-01', to:'LOD-02' },
    ];
    state.edges = normaliseEdges(state.edges);
    state.selected = null;
    state.revision = 0;
    markDirty('Workplace catalogue 2026.4 feeder example loaded');
    render();
  }
  function startCircuitDemo() {
    if (savingServer) return;
    const raw = [
      { id:'PWR-01', type:'power', x:80, y:140, label:'POWER' },
      { id:'SW-01', type:'switch', x:240, y:140, label:'SW', operatingState:'open' },
      { id:'RES-01', type:'resistor', x:400, y:140, label:'R1' },
      { id:'LED-01', type:'led', x:560, y:140, label:'LED' },
      { id:'GND-01', type:'ground', x:720, y:140, label:'GND' },
      { id:'CEL-01', type:'capacitior', x:80, y:300, label:'C1' },
      { id:'IND-01', type:'inductor', x:240, y:300, label:'L1' },
      { id:'DIO-01', type:'diode', x:400, y:300, label:'D1' },
      { id:'LMP-01', type:'lamp', x:560, y:300, label:'LAMP' },
      { id:'MTR-01', type:'motor', x:720, y:300, label:'M1' },
      { id:'LDR-01', type:'ldr', x:240, y:460, label:'LDR' },
      { id:'POT-01', type:'potentiometer', x:400, y:460, label:'POT' },
      { id:'Q-01', type:'transistor', x:560, y:460, label:'Q1' },
    ];
    state.symbols = raw.map(normaliseSymbol).filter(Boolean);
    state.edges = [
      { from:'PWR-01', to:'SW-01' },
      { from:'SW-01', to:'RES-01' },
      { from:'RES-01', to:'LED-01' },
      { from:'LED-01', to:'GND-01' },
      { from:'CEL-01', to:'IND-01' },
      { from:'IND-01', to:'DIO-01' },
      { from:'DIO-01', to:'LMP-01' },
      { from:'LMP-01', to:'MTR-01' },
      { from:'LDR-01', to:'POT-01' },
      { from:'POT-01', to:'Q-01' },
    ];
    state.edges = normaliseEdges(state.edges);
    state.selected = null;
    state.revision = 0;
    markDirty('Figure A-1 circuit example loaded');
    render();
  }
  function recordPayload(nextRevision = state.revision) {
    return {
      version:3,
      drawingName:cleanText($('#oneLineName').value, 160),
      standardApprovalRef:cleanText($('#oneLineApprovalRef').value, 240),
      outageId:$('#oneLineOutage').value,
      revision:nextRevision,
      state:'draft',
      symbolLibraryProfile:library.profile,
      catalogueVersion:library.catalogueVersion,
      graphicalStandard:library.graphicalStandard,
      designationStandard:library.designationStandard,
      symbols:state.symbols,
      edges:state.edges,
      provenanceLabel:'LOCAL DRAFT · NOT OPERATIONAL RELEASE',
    };
  }
  function save() {
    const payload = { ...recordPayload(state.revision + 1), savedAt:new Date().toISOString() };
    try { localStorage.setItem(STORAGE, JSON.stringify(payload)); }
    catch (error) { setStatus(`Local save failed: ${error.message}`); return; }
    state.revision = payload.revision;
    state.dirty = false;
    setStatus(`Revision ${state.revision} saved locally · ${library.profile}`, true);
  }
  function applyPayload(payload, imported = false) {
    if (!payload || !Array.isArray(payload.symbols) || !Array.isArray(payload.edges)) throw new Error('Invalid one-line record');
    if (payload.symbols.length > 500 || payload.edges.length > 1000) throw new Error('Drawing exceeds 500 symbols or 1000 connections');
    const migrated = payload.symbols.map(normaliseSymbol).filter(Boolean);
    if (new Set(migrated.map(symbol => symbol.id)).size !== migrated.length) throw new Error('Duplicate symbol IDs are not allowed');
    if (displayMode) setDisplayMode(false);
    if (Object.hasOwn(payload, 'drawingName')) $('#oneLineName').value = cleanText(payload.drawingName, 160);
    if (Object.hasOwn(payload, 'standardApprovalRef')) $('#oneLineApprovalRef').value = cleanText(payload.standardApprovalRef, 240);
    if (Object.hasOwn(payload, 'outageId')) $('#oneLineOutage').value = payload.outageId;
    state.symbols = migrated;
    state.edges = normaliseEdges(payload.edges);
    state.revision = Number(payload.revision) || 0;
    state.selected = null;
    if (imported) markDirty(`Imported record migrated to ${library.profile}`);
    else setStatus(`Revision ${state.revision} loaded · ${library.profile}`, true);
    resetHistory();
    render();
  }
  function load() {
    try { const payload = JSON.parse(localStorage.getItem(STORAGE) || 'null'); if (!payload) return false; applyPayload(payload); return true; }
    catch { return false; }
  }
  async function serverRequest(path, method = 'GET', payload) {
    const options = { method, headers:{ Accept:'application/json' }, signal:AbortSignal.timeout(20000) };
    if (payload !== undefined) { options.headers['Content-Type'] = 'application/json'; options.body = JSON.stringify(payload); }
    const response = await fetch(path, options);
    let body = null;
    try { body = await response.json(); } catch { /* handled below */ }
    if (!response.ok) throw new Error(body?.error || `server returned ${response.status}`);
    return body;
  }
  function renderServerSelectors() {
    const drawingSelect = $('#oneLineServerSelect');
    const outageSelect = $('#oneLineOutage');
    drawingSelect.innerHTML = '<option value="">New server drawing</option>';
    serverDocuments.forEach(documentRecord => {
      const option = document.createElement('option'); option.value = documentRecord.id;
      option.textContent = `${documentRecord.name} · REV ${documentRecord.revision} · ${documentRecord.symbolCount} symbols`;
      drawingSelect.append(option);
    });
    drawingSelect.value = serverDocument?.id || '';
    const selectedOutage = $('#oneLineOutage').value;
    outageSelect.innerHTML = '<option value="">No linked outage</option>';
    outageRecords.forEach(outage => {
      const option = document.createElement('option'); option.value = outage.id;
      option.textContent = `${outage.status === 'Open' ? 'OPEN' : outage.status} · ${outage.site || 'Unknown site'} · ${outage.asset || outage.title}`;
      outageSelect.append(option);
    });
    outageSelect.value = serverDocument?.outageId || selectedOutage || '';
  }
  async function loadServerReferences() {
    try {
      const [outages, documents] = await Promise.all([serverRequest('/api/outages'), serverRequest('/api/schematics')]);
      outageRecords = Array.isArray(outages) ? outages : [];
      serverDocuments = Array.isArray(documents) ? documents : [];
      renderServerSelectors();
    } catch (error) { setStatus(`Server drawing library unavailable: ${error.message}`); }
  }
  function applyServerDocument(documentRecord) {
    serverDocument = documentRecord;
    $('#oneLineName').value = documentRecord.name || '';
    $('#oneLineApprovalRef').value = documentRecord.standardApprovalRef || '';
    renderServerSelectors();
    $('#oneLineOutage').value = documentRecord.outageId || '';
    applyPayload({ ...documentRecord.record, revision:documentRecord.revision });
    state.dirty = false;
    setStatus(`Server revision ${documentRecord.revision} loaded · backed up centrally`, true);
  }
  async function saveServer() {
    if (savingServer) throw new Error('A drawing save is already in progress.');
    savingServer = true;
    root.setAttribute('aria-busy', 'true');
    const savedFingerprint = JSON.stringify(recordPayload());
    try {
    const payload = {
      name:cleanText($('#oneLineName').value, 160) || 'Untitled one-line',
      outageId:$('#oneLineOutage').value,
      standardApprovalRef:cleanText($('#oneLineApprovalRef').value, 240),
      revision:serverDocument?.revision || undefined,
      record:recordPayload()
    };
    const path = serverDocument?.id ? `/api/schematics/${encodeURIComponent(serverDocument.id)}` : '/api/schematics';
    const documentRecord = await serverRequest(path, 'POST', payload);
    if (JSON.stringify(recordPayload()) === savedFingerprint) applyServerDocument(documentRecord);
    else { serverDocument = documentRecord; state.dirty = true; setStatus(`Server revision ${documentRecord.revision} saved; newer local edits remain unsaved`); }
    const summary = { ...documentRecord }; delete summary.record; delete summary.history;
    const existing = serverDocuments.findIndex(item => item.id === summary.id);
    if (existing >= 0) serverDocuments.splice(existing, 1, summary); else serverDocuments.unshift(summary);
    renderServerSelectors();
    document.dispatchEvent(new CustomEvent('northstar:schematics-changed', { detail:summary }));
    return documentRecord;
    } finally { savingServer = false; root.removeAttribute('aria-busy'); }
  }
  async function loadSelectedServer() {
    if (savingServer) return;
    const id = $('#oneLineServerSelect').value;
    if (state.dirty && !confirm('Discard unsaved changes and load this drawing?')) return;
    if (!id) { serverDocument = null; $('#oneLineName').value = ''; $('#oneLineApprovalRef').value = ''; setStatus('New server drawing ready'); return; }
    try { applyServerDocument(await serverRequest(`/api/schematics/${encodeURIComponent(id)}`)); }
    catch (error) { setStatus(`Server drawing could not be loaded: ${error.message}`); }
  }
  async function attachToPackage() {
    try {
      const documentRecord = !serverDocument || state.dirty ? await saveServer() : serverDocument;
      if (!window.NorthStarSwitching?.attachSchematic) throw new Error('Switching workspace is not ready.');
      await window.NorthStarSwitching.attachSchematic(documentRecord);
      setStatus(`Server schematic revision ${documentRecord.revision} attached to the current package`, true);
    } catch (error) { setStatus(`Attach failed: ${error.message}`); }
  }
  function downloadBlob(blob, filename) {
    const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = filename; link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 0);
  }
  function standaloneSvg() {
    const clone = svg.cloneNode(true);
    const height = svg.viewBox.baseVal.height;
    const stamp = `${displayMode ? 'SCADA SNAPSHOT' : 'DRAWING REFERENCE'} · ${new Date().toISOString()} · NOT OPERATIONAL RELEASE`;
    clone.insertAdjacentHTML('beforeend', `<text x="12" y="${height + 24}" fill="#cbd5dd" font-size="11">${esc(stamp)}</text>`);
    clone.querySelectorAll('.grid,.snap-port,.symbol-hit').forEach(node => node.remove());
    clone.querySelectorAll('.selected').forEach(node => node.classList.remove('selected'));
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 ${height + 40}" width="1000" height="${height + 40}"><rect width="1000" height="${height + 40}" fill="#091219"/><style>.wire{stroke:#75b7cf;stroke-width:3;fill:none}.node-shape{fill:#10222b;stroke:#86b9c9;stroke-width:2}.node-shape.symbol-heavy{fill:none;stroke-width:7}.node-shape.device-open{stroke-dasharray:5 4;fill:#091219}.node text{fill:#eaf3f5;font:calc(12px * var(--ns-font-scale, 1)) monospace;text-anchor:middle}.node-type{fill:#82a7b4!important;font-size:calc(9px * var(--ns-font-scale, 1))!important}.symbol-letter{font-weight:700;dominant-baseline:middle}.device-function,.operating-state,.winding-config{fill:#f2b84b!important;font-size:calc(10px * var(--ns-font-scale, 1));font-weight:700}.terminal-dot{fill:#f2b84b;stroke:#101a20;stroke-width:2}.dynamic-value{fill:#90d4ed!important;font-size:11px}.feedback-open .node-shape{stroke:#f2b84b}.feedback-closed .node-shape{stroke:#72d7aa}.feedback-unknown .node-shape,.feedback-unbound .node-shape{stroke:#a8afb7;stroke-dasharray:4 3}</style>${clone.innerHTML}</svg>`;
  }
  function exportSvg() {
    downloadBlob(new Blob([standaloneSvg()], { type:'image/svg+xml' }), `northstar-one-line-rev-${serverDocument?.revision || state.revision || 0}.svg`);
    setStatus('SVG drawing downloaded', true);
  }
  function exportPng() {
    const source = URL.createObjectURL(new Blob([standaloneSvg()], { type:'image/svg+xml' }));
    const image = new Image();
    image.onload = () => {
      const canvas = document.createElement('canvas'); canvas.width = 2000; canvas.height = (svg.viewBox.baseVal.height + 40) * 2;
      const context = canvas.getContext('2d'); context.drawImage(image, 0, 0, canvas.width, canvas.height);
      canvas.toBlob(blob => { if (blob) downloadBlob(blob, `northstar-one-line-rev-${serverDocument?.revision || state.revision || 0}.png`); }, 'image/png');
      URL.revokeObjectURL(source); setStatus('PNG drawing downloaded', true);
    };
    image.onerror = () => { URL.revokeObjectURL(source); setStatus('PNG export failed'); };
    image.src = source;
  }
  function printDrawing() {
    const popup = window.open('', '_blank', 'width=1100,height=720');
    if (!popup) { setStatus('Print window was blocked'); return; }
    popup.opener = null;
    popup.document.write(`<title>${esc($('#oneLineName').value || 'NorthStar one-line')}</title><style>body{margin:20px;font-family:Arial;color:#111}h1{font-size:calc(18px * var(--ns-font-scale, 1))}p{font-size:calc(11px * var(--ns-font-scale, 1))}svg{width:100%;height:auto}.node-shape{stroke:#111!important}.wire{stroke:#111!important}.node text{fill:#111!important}@media print{body{margin:0}}</style><h1>${esc($('#oneLineName').value || 'NorthStar one-line')}</h1><p>Drafting record · not operational release · ${esc(library.profile)}</p>${standaloneSvg()}`);
    popup.document.close(); popup.focus(); setTimeout(() => popup.print(), 250);
  }
  function download() {
    const payload = { ...recordPayload(), exportedAt:new Date().toISOString() };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type:'application/json' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `northstar-one-line-rev-${state.revision || 0}.json`;
    link.click();
    URL.revokeObjectURL(link.href);
    setStatus(`Version 3 catalogue ${library.catalogueVersion} JSON downloaded`, true);
  }
  function exportTemplate() {
    const payload = JSON.parse(JSON.stringify(recordPayload()));
    payload.revision = 0; payload.outageId = ''; payload.drawingName = 'Station template';
    payload.symbols.forEach(symbol => {
      symbol.assetTag = ''; symbol.siteCode = ''; symbol.scada = live.binding();
      symbol.measurements.forEach(binding => { binding.feedCode = ''; binding.tagName = ''; });
    });
    downloadBlob(new Blob([JSON.stringify(payload, null, 2)], {type:'application/json'}), 'northstar-station-template.json');
    setStatus('Reusable template exported · equipment tags and feedback bindings cleared');
  }
  function importFile(file) {
    if (savingServer) return;
    if (state.dirty && !confirm('Replace unsaved drawing with this imported file?')) return;
    serverDocument = null;
    const reader = new FileReader();
    reader.onload = () => { try { applyPayload(JSON.parse(reader.result), true); } catch { setStatus('Import rejected: invalid one-line record'); } };
    reader.readAsText(file);
  }
  function connectSymbols(fromRef, toSymbol, toTerminal) {
    if (!fromRef || fromRef.id === toSymbol.id) return;
    if (state.edges.some(item => (item.from === fromRef.id && item.to === toSymbol.id) || (item.from === toSymbol.id && item.to === fromRef.id))) return;
    const from = symbolById(fromRef.id);
    if (!from) return;
    const fromSnap = library.snapPoint(from, toSymbol.x, toSymbol.y, fromRef.terminal);
    const toSnap = library.snapPoint(toSymbol, from.x, from.y, toTerminal);
    let number = 1;
    while (state.edges.some(edge => edge.id === `E-${String(number).padStart(2, '0')}`)) number += 1;
    state.edges.push({
      id:`E-${String(number).padStart(2, '0')}`,
      from:from.id,
      to:toSymbol.id,
      fromTerminal:fromSnap.id,
      toTerminal:toSnap.id,
    });
  }
  svg.addEventListener('pointerdown', event => {
    if (displayMode) return;
    const port = event.target.closest('.snap-port');
    const node = event.target.closest('.node');
    const edge = event.target.closest('.wire');
    if (edge && !port) { state.selected = edge.dataset.edgeId; connectStart = null; render(); return; }
    if (!node && !port) { state.selected = null; connectStart = null; render(); return; }
    const symbol = symbolById((port || node).dataset.symbolId);
    if (!symbol) return;
    const terminalId = port?.dataset.terminalId || '';
    if (state.tool === 'connect') {
      if (!connectStart) {
        connectStart = { id: symbol.id, terminal: terminalId };
        setStatus(`Connect from ${symbol.id}${terminalId ? ' · ' + terminalId : ''} · choose destination`);
        render();
        return;
      }
      connectSymbols(connectStart, symbol, terminalId);
      connectStart = null;
      markDirty('Connection updated');
      render();
      return;
    }
    state.selected = symbol.id;
    const point = canvasPoint(event);
    drag = { id:symbol.id, dx:symbol.x - point.x, dy:symbol.y - point.y };
    try { svg.setPointerCapture(event.pointerId); } catch { /* synthetic or non-pointer events */ }
    render();
  });
  svg.addEventListener('pointermove', event => {
    if (!drag) return;
    const symbol = symbolById(drag.id);
    if (!symbol) return;
    const point = canvasPoint(event);
    symbol.x = Math.round(clamp(point.x + drag.dx, 30, 970) / GRID_STEP) * GRID_STEP;
    symbol.y = Math.round(clamp(point.y + drag.dy, 30, 530) / GRID_STEP) * GRID_STEP;
    markDirty();
    render();
  });
  svg.addEventListener('pointerup', () => { const moved = drag; drag = null; if (moved) markDirty('Position updated'); });
  svg.addEventListener('pointercancel', () => { drag = null; markDirty('Position updated'); });
  bindToolButtons();
  $('#oneLineSnapshot').onclick = exportSvg;
  $('#oneLineTemplate').onclick = exportTemplate;
  $('#oneLineSaveCopy').onclick = async () => {
    if (savingServer) return;
    const previous = serverDocument, previousName = $('#oneLineName').value;
    serverDocument = null; $('#oneLineName').value = `${previousName || 'Station drawing'} copy`;
    try { await saveServer(); } catch (error) { serverDocument = previous; $('#oneLineName').value = previousName; setStatus(`Save copy failed: ${error.message}`); }
  };
  $('#oneLineUndo').onclick = () => historyStep(true);
  $('#oneLineRedo').onclick = () => historyStep(false);
  $('#oneLineDuplicate').onclick = duplicateSelected;
  $('#oneLineValidate').onclick = validateDrawing;
  $('#oneLineZoom').onchange = event => { zoom = Number(event.target.value); render(true); };
  root.tabIndex = 0;
  root.addEventListener('keydown', event => {
    if (displayMode || event.target.closest('input,select,textarea,[contenteditable=true]')) return;
    const command = event.ctrlKey || event.metaKey;
    if (command && event.key.toLowerCase() === 'z') { event.preventDefault(); historyStep(!event.shiftKey); }
    else if (command && event.key.toLowerCase() === 'y') { event.preventDefault(); historyStep(false); }
    else if (command && event.key.toLowerCase() === 'd') { event.preventDefault(); duplicateSelected(); }
    else if (event.key === 'Delete') { event.preventDefault(); ($('#oneLineDelete') || $('#oneLineDeleteWire'))?.click(); }
    else if (event.key === 'Escape') { state.selected = null; state.tool = 'select'; connectStart = null; render(); }
    else if (['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key)) {
      const symbol = symbolById(state.selected); if (!symbol) return;
      event.preventDefault(); const axis = ['ArrowLeft','ArrowRight'].includes(event.key) ? 'x' : 'y';
      symbol[axis] = clamp(symbol[axis] + (['ArrowLeft','ArrowUp'].includes(event.key) ? -GRID_STEP : GRID_STEP),40,axis === 'x' ? 960 : 520);
      markDirty('Position updated'); render();
    }
  });
  $('#oneLineMode').onclick = () => setDisplayMode(!displayMode);
  $('#oneLineRefresh').onclick = () => { void refreshTelemetry(); };
  $('#oneLineAllSymbols').onchange = () => renderPalette($('#oneLineSymbolSearch').value);
  $('#oneLineNew').onclick = () => {
    if (savingServer) return;
    if (state.dirty && !confirm('Discard unsaved changes and start a blank station drawing?')) return;
    setDisplayMode(false); serverDocument = null;
    state.symbols = []; state.edges = []; state.revision = 0;
    $('#oneLineName').value = ''; $('#oneLineApprovalRef').value = ''; $('#oneLineOutage').value = '';
    renderServerSelectors(); markDirty('New station drawing'); render();
  };
  renderPalette();
  $('#oneLineSymbolSearch').oninput = event => renderPalette(event.target.value);
  $('#oneLineDemo').onclick = () => { if (!state.dirty || confirm('Replace unsaved drawing with the example?')) startDemo(); };
  $('#oneLineCircuitExample').onclick = () => { if (!state.dirty || confirm('Replace unsaved drawing with the example?')) startCircuitDemo(); };
  $('#oneLineSave').onclick = save;
  $('#oneLineSaveServer').onclick = async () => { try { await saveServer(); } catch (error) { setStatus(`Server save failed: ${error.message}`); } };
  $('#oneLineLoadServer').onclick = loadSelectedServer;
  $('#oneLineAttachPackage').onclick = attachToPackage;
  $('#oneLineExport').onclick = download;
  $('#oneLineExportSvg').onclick = exportSvg;
  $('#oneLineExportPng').onclick = exportPng;
  $('#oneLinePrint').onclick = printDrawing;
  $('#oneLineClear').onclick = () => { if (!state.symbols.length || confirm('Clear this local draft?')) { state.symbols = []; state.edges = []; state.selected = null; markDirty('Canvas cleared'); render(); } };
  $('#oneLineImport').onclick = () => $('#oneLineImportFile').click();
  $('#oneLineImportFile').onchange = event => { if (event.target.files[0]) importFile(event.target.files[0]); event.target.value = ''; };
  ['#oneLineName','#oneLineOutage','#oneLineApprovalRef'].forEach(selector => $(selector).addEventListener('change', () => markDirty('Server drawing metadata updated')));
  if (!load()) { resetHistory(); render(); setStatus('Add equipment, connect terminals, then save your station drawing'); }
  void loadServerReferences();
})();
