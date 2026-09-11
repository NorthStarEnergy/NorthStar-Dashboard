(() => {
  'use strict';
  const root = document.querySelector('#oneLineEditor');
  const library = window.NorthStarOneLineSymbols;
  if (!root || !library) return;
  const svg = root.querySelector('#oneLineCanvas');
  const empty = root.querySelector('#oneLineEmpty');
  const status = root.querySelector('#oneLineStatus');
  const STORAGE = 'northstar.oneLineEditor.draft.v1';
  const state = { revision: 0, symbols: [], edges: [], selected: null, tool: 'select', dirty: false };
  let serverDocument = null;
  let serverDocuments = [];
  let outageRecords = [];
  let drag = null;
  let connectStart = null;
  const $ = selector => root.querySelector(selector);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[char]);
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const symbolById = id => state.symbols.find(item => item.id === id);
  const typeInfo = type => library.get(type);
  const cleanText = (value, limit = 80) => String(value ?? '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, limit);
  const safeNumber = (value, fallback, min, max) => clamp(Number.isFinite(Number(value)) ? Number(value) : fallback, min, max);
  function setStatus(message, ok = false) { status.innerHTML = `<span>${esc(message)}</span><strong id="oneLineCount">${state.symbols.length} SYMBOLS · ${state.edges.length} CONNECTIONS · ${ok ? 'SAVED' : 'DRAFT'}</strong>`; }
  function markDirty(message = 'Unsaved local changes') { state.dirty = true; setStatus(message); }
  function nextId(type) {
    const prefix = typeInfo(type).prefix;
    const used = new Set(state.symbols.map(item => item.id));
    let number = 1;
    while (used.has(`${prefix}-${String(number).padStart(2, '0')}`)) number += 1;
    return `${prefix}-${String(number).padStart(2, '0')}`;
  }
  function normaliseSymbol(item, index) {
    const info = library.definitions.find(definition => definition.id === item?.type) || library.get('source');
    const rotation = [0, 90, 180, 270].includes(Number(item?.rotation)) ? Number(item.rotation) : 0;
    return {
      id: cleanText(item?.id, 32) || `${info.prefix}-${String(index + 1).padStart(2, '0')}`,
      type: info.id,
      x: Math.round(safeNumber(item?.x, 120 + index * 100, 30, 970) / 20) * 20,
      y: Math.round(safeNumber(item?.y, 280, 30, 530) / 20) * 20,
      rotation,
      label: cleanText(item?.label),
      deviceFunction: cleanText(item?.deviceFunction ?? info.functionNumber ?? '', 16),
    };
  }
  function normaliseEdges(items) {
    const ids = new Set(state.symbols.map(item => item.id));
    return (Array.isArray(items) ? items : []).filter(item => ids.has(item?.from) && ids.has(item?.to) && item.from !== item.to).map((item, index) => ({
      id: cleanText(item.id, 32) || `E-${String(index + 1).padStart(2, '0')}`,
      from: item.from,
      to: item.to,
    }));
  }
  function canvasPoint(event) {
    const rect = svg.getBoundingClientRect();
    return { x: clamp((event.clientX - rect.left) * (1000 / rect.width), 24, 976), y: clamp((event.clientY - rect.top) * (560 / rect.height), 24, 536) };
  }
  function grid() {
    let output = '';
    for (let x = 0; x <= 1000; x += 40) output += `<line class="grid" x1="${x}" y1="0" x2="${x}" y2="560"/>`;
    for (let y = 0; y <= 560; y += 40) output += `<line class="grid" x1="0" y1="${y}" x2="1000" y2="${y}"/>`;
    return output;
  }
  function symbolMarkup(symbol) {
    const info = typeInfo(symbol.type);
    const designation = symbol.deviceFunction && !['relay', 'lockout'].includes(symbol.type) ? `<text class="device-function" x="${symbol.x}" y="${symbol.y - 36}">${esc(symbol.deviceFunction)}</text>` : '';
    const label = esc(symbol.label || symbol.id);
    return `<g class="node ${state.selected === symbol.id ? 'selected' : ''}" data-symbol-id="${esc(symbol.id)}"><title>${esc(info.name)} · ${esc(info.standard)}</title><g transform="rotate(${symbol.rotation} ${symbol.x} ${symbol.y})">${library.draw(symbol)}</g>${designation}<text class="scada-tag" x="${symbol.x}" y="${symbol.y + 42}">${label}</text><rect class="scada-value" x="${symbol.x - 22}" y="${symbol.y + 47}" width="44" height="12" rx="0"/><text class="scada-value-text" x="${symbol.x}" y="${symbol.y + 56}">0</text><text class="node-type" x="${symbol.x}" y="${symbol.y + 70}">${esc(info.name.toUpperCase())}</text></g>`;
  }
  function render() {
    const wires = state.edges.map(edge => {
      const from = symbolById(edge.from), to = symbolById(edge.to);
      if (!from || !to) return '';
      return `<line class="wire ${state.selected === edge.id ? 'selected' : ''}" data-edge-id="${esc(edge.id)}" x1="${from.x}" y1="${from.y}" x2="${to.x}" y2="${to.y}"/>`;
    }).join('');
    svg.innerHTML = `${grid()}<g class="wires">${wires}</g><g class="symbols">${state.symbols.map(symbolMarkup).join('')}</g>`;
    empty.hidden = state.symbols.length > 0;
    const count = $('#oneLineCount');
    if (count) count.textContent = `${state.symbols.length} SYMBOLS · ${state.edges.length} CONNECTIONS · ${state.dirty ? 'DRAFT' : 'SAVED'}`;
    renderInspector();
  }
  function functionOptions(selected) {
    const known = new Set(library.functions.map(item => item[0]));
    const custom = selected && !known.has(selected) ? `<option value="${esc(selected)}"></option>` : '';
    return custom + library.functions.map(([value, name]) => `<option value="${esc(value)}">${esc(value ? `${value} · ${name}` : name)}</option>`).join('');
  }
  function renderInspector() {
    const symbol = symbolById(state.selected);
    const inspector = $('#oneLineInspectorBody');
    if (!symbol) { inspector.innerHTML = '<p class="hint">Select a symbol to edit its label, IEEE device designation, rotation, or position. Use CONNECT to draw a conductor between two symbols.</p>'; return; }
    const info = typeInfo(symbol.type);
    let markup;
    try {
      markup = `<label>SYMBOL ID<input value="${esc(symbol.id)}" disabled></label><label>SYMBOL TYPE<input value="${esc(info.name)}" disabled></label><label>LABEL<input id="oneLineLabel" value="${esc(symbol.label)}" placeholder="Equipment or circuit label"></label><label>IEEE DEVICE FUNCTION<input id="oneLineFunction" list="oneLineFunctionList" value="${esc(symbol.deviceFunction)}" placeholder="Optional C37.2 designation"><datalist id="oneLineFunctionList">${functionOptions(symbol.deviceFunction)}</datalist></label><p class="symbol-standard-ref">${esc(info.standard)}</p><label>ROTATION<select id="oneLineRotation"><option value="0" ${symbol.rotation === 0 ? 'selected' : ''}>0°</option><option value="90" ${symbol.rotation === 90 ? 'selected' : ''}>90°</option><option value="180" ${symbol.rotation === 180 ? 'selected' : ''}>180°</option><option value="270" ${symbol.rotation === 270 ? 'selected' : ''}>270°</option></select></label><div class="one-line-actions"><button type="button" id="oneLineDelete">DELETE SYMBOL</button><button type="button" id="oneLineRotate">ROTATE 90°</button></div>`;
    } catch (error) {
      inspector.innerHTML = `<p class="hint">Inspector unavailable: ${esc(error.message)}</p>`;
      return;
    }
    inspector.innerHTML = markup;
    $('#oneLineLabel').onchange = event => { symbol.label = cleanText(event.target.value); markDirty('Label updated'); render(); };
    $('#oneLineFunction').onchange = event => { symbol.deviceFunction = cleanText(event.target.value, 16); markDirty('Device designation updated'); render(); };
    $('#oneLineRotation').onchange = event => { symbol.rotation = Number(event.target.value); markDirty(); render(); };
    $('#oneLineDelete').onclick = () => { state.symbols = state.symbols.filter(item => item.id !== symbol.id); state.edges = state.edges.filter(edge => edge.from !== symbol.id && edge.to !== symbol.id); state.selected = null; markDirty('Symbol deleted'); render(); };
    $('#oneLineRotate').onclick = () => { symbol.rotation = (symbol.rotation + 90) % 360; markDirty(); render(); };
  }
  function renderPalette(filter = '') {
    const query = filter.trim().toLowerCase();
    const visible = library.definitions.filter(item => !item.hidden && (!query || `${item.name} ${item.id} ${item.functionNumber || ''}`.toLowerCase().includes(query)));
    const groups = [...new Set(visible.map(item => item.category))];
    $('#oneLineSymbolLibrary').innerHTML = groups.map(category => `<section class="symbol-group"><h4>${esc(category)}</h4>${visible.filter(item => item.category === category).map(item => `<button class="symbol-tool" type="button" data-symbol-type="${esc(item.id)}" title="${esc(item.standard)}"><span class="symbol-glyph">${esc(item.glyph)}</span><span>${esc(item.name)}${item.functionNumber ? `<small>IEEE ${esc(item.functionNumber)}</small>` : ''}</span></button>`).join('')}</section>`).join('') || '<p class="hint">No matching symbols.</p>';
    bindToolButtons($('#oneLineSymbolLibrary'));
  }
  function addSymbol(type, point = { x: 170 + (state.symbols.length % 5) * 150, y: 120 + Math.floor(state.symbols.length / 5) * 110 }) {
    const info = typeInfo(type);
    const symbol = normaliseSymbol({ id: nextId(type), type, x: point.x, y: point.y, rotation: 0, label: '', deviceFunction: info.functionNumber || '' }, state.symbols.length);
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
      setStatus(type === 'select' ? 'Select mode' : 'Connect mode · choose two symbols');
      return;
    }
    addSymbol(type);
  }
  function bindToolButtons(scope = root) { scope.querySelectorAll('.symbol-tool').forEach(button => { button.onclick = () => chooseTool(button); }); }
  function startDemo() {
    const raw = [
      { id:'SRC-01', type:'source', x:90, y:280, label:'UTILITY' },
      { id:'BUS-01', type:'bus', x:250, y:280, label:'BUS A' },
      { id:'DSC-01', type:'disconnect', x:410, y:280, label:'89-1' },
      { id:'CBR-01', type:'breaker', x:570, y:280, label:'52-1' },
      { id:'XFMR-01', type:'transformer', x:730, y:280, label:'T1' },
      { id:'LOD-01', type:'load', x:900, y:280, label:'FEEDER 1' },
    ];
    state.symbols = raw.map(normaliseSymbol);
    state.edges = state.symbols.slice(1).map((symbol, index) => ({ id:`E-${String(index + 1).padStart(2, '0')}`, from:state.symbols[index].id, to:symbol.id }));
    state.selected = null;
    state.revision = 0;
    markDirty('IEEE compatibility example loaded');
    render();
  }
  function recordPayload(nextRevision = state.revision) {
    return { version:2, revision:nextRevision, state:'draft', symbolLibraryProfile:library.profile, graphicalStandard:library.graphicalStandard, designationStandard:library.designationStandard, symbols:state.symbols, edges:state.edges, provenanceLabel:'LOCAL DRAFT · NOT OPERATIONAL RELEASE' };
  }
  function save() {
    const payload = { ...recordPayload(state.revision + 1), savedAt:new Date().toISOString() };
    localStorage.setItem(STORAGE, JSON.stringify(payload));
    state.revision = payload.revision;
    state.dirty = false;
    setStatus(`Revision ${state.revision} saved locally · ${library.profile}`, true);
  }
  function applyPayload(payload, imported = false) {
    if (!payload || !Array.isArray(payload.symbols) || !Array.isArray(payload.edges)) throw new Error('Invalid one-line record');
    state.symbols = payload.symbols.map(normaliseSymbol);
    state.edges = normaliseEdges(payload.edges);
    state.revision = Number(payload.revision) || 0;
    state.selected = null;
    if (imported) markDirty('Imported record migrated to current symbol profile');
    else setStatus(`Revision ${state.revision} loaded · ${library.profile}`, true);
    render();
  }
  function load() {
    try { const payload = JSON.parse(localStorage.getItem(STORAGE) || 'null'); if (!payload) return false; applyPayload(payload); return true; }
    catch { return false; }
  }
  async function serverRequest(path, method = 'GET', payload) {
    const options = { method, headers:{ Accept:'application/json' } };
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
    const payload = {
      name:cleanText($('#oneLineName').value, 160) || 'Untitled one-line',
      outageId:$('#oneLineOutage').value,
      standardApprovalRef:cleanText($('#oneLineApprovalRef').value, 240),
      revision:serverDocument?.revision || undefined,
      record:recordPayload()
    };
    const path = serverDocument?.id ? `/api/schematics/${encodeURIComponent(serverDocument.id)}` : '/api/schematics';
    const documentRecord = await serverRequest(path, 'POST', payload);
    applyServerDocument(documentRecord);
    const summary = { ...documentRecord }; delete summary.record; delete summary.history;
    const existing = serverDocuments.findIndex(item => item.id === summary.id);
    if (existing >= 0) serverDocuments.splice(existing, 1, summary); else serverDocuments.unshift(summary);
    renderServerSelectors();
    document.dispatchEvent(new CustomEvent('northstar:schematics-changed', { detail:summary }));
    return documentRecord;
  }
  async function loadSelectedServer() {
    const id = $('#oneLineServerSelect').value;
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
    clone.querySelectorAll('.grid').forEach(node => node.remove());
    clone.querySelectorAll('.selected').forEach(node => node.classList.remove('selected'));
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 560" width="1000" height="560"><rect width="1000" height="560" fill="#091219"/><style>.wire{stroke:#75b7cf;stroke-width:3;fill:none}.node-shape{fill:#10222b;stroke:#86b9c9;stroke-width:2}.node-shape.symbol-heavy{fill:none;stroke-width:7}.node text{fill:#eaf3f5;font:12px monospace;text-anchor:middle}.node-type{fill:#82a7b4!important;font-size:9px!important}.symbol-letter{font-weight:700;dominant-baseline:middle}.device-function{fill:#f2b84b!important;font-size:10px;font-weight:700}.terminal-dot{fill:#f2b84b;stroke:#101a20;stroke-width:2}</style>${clone.innerHTML}</svg>`;
  }
  function exportSvg() {
    downloadBlob(new Blob([standaloneSvg()], { type:'image/svg+xml' }), `northstar-one-line-rev-${serverDocument?.revision || state.revision || 0}.svg`);
    setStatus('SVG drawing downloaded', true);
  }
  function exportPng() {
    const source = URL.createObjectURL(new Blob([standaloneSvg()], { type:'image/svg+xml' }));
    const image = new Image();
    image.onload = () => {
      const canvas = document.createElement('canvas'); canvas.width = 2000; canvas.height = 1120;
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
    popup.document.write(`<title>${esc($('#oneLineName').value || 'NorthStar one-line')}</title><style>body{margin:20px;font-family:Arial;color:#111}h1{font-size:18px}p{font-size:11px}svg{width:100%;height:auto}.node-shape{stroke:#111!important}.wire{stroke:#111!important}.node text{fill:#111!important}@media print{body{margin:0}}</style><h1>${esc($('#oneLineName').value || 'NorthStar one-line')}</h1><p>Drafting record · not operational release · ${esc(library.profile)}</p>${standaloneSvg()}`);
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
    setStatus('Version 2 IEEE-profile JSON downloaded', true);
  }
  function importFile(file) {
    const reader = new FileReader();
    reader.onload = () => { try { applyPayload(JSON.parse(reader.result), true); } catch { setStatus('Import rejected: invalid one-line record'); } };
    reader.readAsText(file);
  }
  svg.addEventListener('pointerdown', event => {
    const node = event.target.closest('.node');
    const edge = event.target.closest('.wire');
    if (edge) { state.selected = edge.dataset.edgeId; render(); return; }
    if (!node) { state.selected = null; render(); return; }
    const symbol = symbolById(node.dataset.symbolId);
    if (state.tool === 'connect') {
      if (!connectStart) { connectStart = symbol.id; setStatus(`Connect from ${symbol.id} · choose destination`); return; }
      if (connectStart !== symbol.id && !state.edges.some(item => (item.from === connectStart && item.to === symbol.id) || (item.from === symbol.id && item.to === connectStart))) state.edges.push({ id:`E-${String(state.edges.length + 1).padStart(2, '0')}`, from:connectStart, to:symbol.id });
      connectStart = null;
      markDirty('Connection updated');
      render();
      return;
    }
    state.selected = symbol.id;
    const point = canvasPoint(event);
    drag = { id:symbol.id, dx:symbol.x - point.x, dy:symbol.y - point.y };
    svg.setPointerCapture(event.pointerId);
    render();
  });
  svg.addEventListener('pointermove', event => {
    if (!drag) return;
    const symbol = symbolById(drag.id);
    if (!symbol) return;
    const point = canvasPoint(event);
    symbol.x = Math.round(clamp(point.x + drag.dx, 30, 970) / 20) * 20;
    symbol.y = Math.round(clamp(point.y + drag.dy, 30, 530) / 20) * 20;
    markDirty();
    render();
  });
  svg.addEventListener('pointerup', () => { if (drag) markDirty('Position updated'); drag = null; });
  bindToolButtons();
  renderPalette();
  $('#oneLineSymbolSearch').oninput = event => renderPalette(event.target.value);
  $('#oneLineDemo').onclick = startDemo;
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
  load() || startDemo();
  void loadServerReferences();
})();
