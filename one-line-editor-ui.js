(() => {
  'use strict';
  const root = document.querySelector('#oneLineEditor');
  if (!root) return;
  const svg = root.querySelector('#oneLineCanvas');
  const empty = root.querySelector('#oneLineEmpty');
  const status = root.querySelector('#oneLineStatus');
  const STORAGE = 'northstar.oneLineEditor.draft.v1';
  const TYPES = [
    ['source', 'Source', '⌁'], ['bus', 'Bus', '━'], ['disconnect', 'Disconnect', '◇'],
    ['breaker', 'Breaker', '□'], ['transformer', 'Transformer', '◎'], ['line', 'Line', '╱'],
    ['load', 'Load', '▱'], ['terminal', 'Terminal', '●'], ['edge', 'Edge', '—']
  ];
  const state = { revision: 0, symbols: [], edges: [], selected: null, tool: 'select', dirty: false };
  let drag = null;
  let connectStart = null;
  const $ = (selector) => root.querySelector(selector);
  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[char]));
  const typeInfo = type => TYPES.find(item => item[0] === type) || TYPES[0];
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const canvasPoint = event => { const rect = svg.getBoundingClientRect(); return { x: clamp((event.clientX - rect.left) * (1000 / rect.width), 24, 976), y: clamp((event.clientY - rect.top) * (560 / rect.height), 24, 536) }; };
  const symbolById = id => state.symbols.find(item => item.id === id);
  function setStatus(message, ok = false) { status.innerHTML = `<span>${esc(message)}</span><strong>${ok ? 'SAVED' : 'DRAFT'}</strong>`; }
  function markDirty(message = 'Unsaved local changes') { state.dirty = true; setStatus(message); }
  function nextId(type) { return `${type.slice(0, 3).toUpperCase()}-${String(state.symbols.length + 1).padStart(2, '0')}`; }
  function grid() { let out = ''; for (let x = 0; x <= 1000; x += 40) out += `<line class="grid" x1="${x}" y1="0" x2="${x}" y2="560"/>`; for (let y = 0; y <= 560; y += 40) out += `<line class="grid" x1="0" y1="${y}" x2="1000" y2="${y}"/>`; return out; }
  function shape(symbol) {
    const x = symbol.x, y = symbol.y, type = symbol.type;
    if (type === 'source') return `<circle class="node-shape" cx="${x}" cy="${y}" r="25"/><path class="node-shape" d="M${x-8} ${y-8}q8 8 0 16m8-16q8 8 0 16" fill="none"/>`;
    if (type === 'bus') return `<path class="node-shape" d="M${x-42} ${y-16}H${x+42}M${x-42} ${y}H${x+42}M${x-42} ${y+16}H${x+42}" fill="none"/>`;
    if (type === 'disconnect') return `<path class="node-shape" d="M${x-28} ${y}h12m16 0h28M${x-16} ${y}l12-17" fill="none"/>`;
    if (type === 'breaker') return `<rect class="node-shape" x="${x-22}" y="${y-22}" width="44" height="44" rx="3"/><path class="node-shape" d="M${x-13} ${y+10}l26-20" fill="none"/>`;
    if (type === 'transformer') return `<circle class="node-shape" cx="${x-10}" cy="${y}" r="17"/><circle class="node-shape" cx="${x+10}" cy="${y}" r="17"/>`;
    if (type === 'line') return `<path class="node-shape" d="M${x-30} ${y+18}L${x+30} ${y-18}M${x-20} ${y+24}L${x+40} ${y-12}" fill="none"/>`;
    if (type === 'load') return `<path class="node-shape" d="M${x-28} ${y-18}h56v36h-56zM${x-18} ${y+8}q9-28 18 0t18 0"/>`;
    if (type === 'terminal') return `<circle class="terminal-dot" cx="${x}" cy="${y}" r="10"/>`;
    return `<path class="node-shape" d="M${x-35} ${y}H${x+35}" fill="none"/>`;
  }
  function render() {
    svg.innerHTML = `${grid()}<g class="wires">${state.edges.map(edge => { const a = symbolById(edge.from), b = symbolById(edge.to); if (!a || !b) return ''; return `<line class="wire ${state.selected === edge.id ? 'selected' : ''}" data-edge-id="${edge.id}" x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}"/>`; }).join('')}</g><g class="symbols">${state.symbols.map(symbol => { const info = typeInfo(symbol.type); return `<g class="node ${state.selected === symbol.id ? 'selected' : ''}" data-symbol-id="${symbol.id}" transform="rotate(${symbol.rotation || 0} ${symbol.x} ${symbol.y})">${shape(symbol)}<text x="${symbol.x}" y="${symbol.y + 42}">${esc(symbol.label || symbol.id)}</text><text class="node-type" x="${symbol.x}" y="${symbol.y + 55}">${esc(info[1].toUpperCase())}</text></g>`; }).join('')}</g>`;
    empty.hidden = state.symbols.length > 0;
    root.querySelector('#oneLineCount').textContent = `${state.symbols.length} SYMBOLS · ${state.edges.length} CONNECTIONS`;
    renderInspector();
  }
  function renderInspector() {
    const symbol = symbolById(state.selected); const inspector = root.querySelector('#oneLineInspectorBody');
    if (!symbol) { inspector.innerHTML = '<p class="hint">Select a symbol to edit its label, rotation, or position. Use CONNECT to draw a wire between two symbols.</p>'; return; }
    inspector.innerHTML = `<label>SYMBOL ID<input value="${esc(symbol.id)}" disabled></label><label>LABEL<input id="oneLineLabel" value="${esc(symbol.label || '')}" placeholder="Optional label"></label><label>ROTATION<select id="oneLineRotation"><option value="0" ${symbol.rotation === 0 ? 'selected' : ''}>0°</option><option value="90" ${symbol.rotation === 90 ? 'selected' : ''}>90°</option><option value="180" ${symbol.rotation === 180 ? 'selected' : ''}>180°</option><option value="270" ${symbol.rotation === 270 ? 'selected' : ''}>270°</option></select></label><div class="one-line-actions"><button type="button" id="oneLineDelete">DELETE SYMBOL</button><button type="button" id="oneLineRotate">ROTATE 90°</button></div>`;
    $('#oneLineLabel').oninput = event => { symbol.label = event.target.value; markDirty(); render(); };
    $('#oneLineRotation').onchange = event => { symbol.rotation = Number(event.target.value); markDirty(); render(); };
    $('#oneLineDelete').onclick = () => { state.symbols = state.symbols.filter(item => item.id !== symbol.id); state.edges = state.edges.filter(edge => edge.from !== symbol.id && edge.to !== symbol.id); state.selected = null; markDirty('Symbol deleted'); render(); };
    $('#oneLineRotate').onclick = () => { symbol.rotation = ((symbol.rotation || 0) + 90) % 360; markDirty(); render(); };
  }
  function addSymbol(type, point = { x: 170 + (state.symbols.length % 5) * 150, y: 120 + Math.floor(state.symbols.length / 5) * 110 }) { const symbol = { id: nextId(type), type, x: Math.round(point.x / 20) * 20, y: Math.round(point.y / 20) * 20, rotation: 0, label: '' }; state.symbols.push(symbol); state.selected = symbol.id; state.tool = 'select'; root.querySelectorAll('.symbol-tool').forEach(button => button.classList.remove('active')); markDirty(`${typeInfo(type)[1]} added`); render(); }
  function startDemo() { state.symbols = [{ id:'SRC-01',type:'source',x:120,y:280,rotation:0,label:'GRID' },{ id:'BUS-02',type:'bus',x:300,y:280,rotation:0,label:'BUS A' },{ id:'BRK-03',type:'breaker',x:480,y:280,rotation:0,label:'52-1' },{ id:'TRN-04',type:'transformer',x:660,y:280,rotation:0,label:'T1' },{ id:'LOAD-05',type:'load',x:850,y:280,rotation:0,label:'FEEDER 1' }]; state.edges = [{id:'E-01',from:'SRC-01',to:'BUS-02'},{id:'E-02',from:'BUS-02',to:'BRK-03'},{id:'E-03',from:'BRK-03',to:'TRN-04'},{id:'E-04',from:'TRN-04',to:'LOAD-05'}]; state.selected = null; state.revision = 0; markDirty('Example one-line loaded'); render(); }
  function save() { const payload = { version: 1, revision: state.revision + 1, state: 'draft', symbols: state.symbols, edges: state.edges, savedAt: new Date().toISOString(), provenanceLabel: 'LOCAL DRAFT · NOT OPERATIONAL RELEASE' }; localStorage.setItem(STORAGE, JSON.stringify(payload)); state.revision = payload.revision; state.dirty = false; setStatus(`Revision ${state.revision} saved locally`, true); }
  function load() { try { const payload = JSON.parse(localStorage.getItem(STORAGE) || 'null'); if (!payload) return false; state.symbols = Array.isArray(payload.symbols) ? payload.symbols : []; state.edges = Array.isArray(payload.edges) ? payload.edges : []; state.revision = Number(payload.revision) || 0; setStatus(`Revision ${state.revision} loaded locally`, true); render(); return true; } catch { return false; } }
  function download() { const payload = { version: 1, revision: state.revision, state: 'draft', symbols: state.symbols, edges: state.edges, exportedAt: new Date().toISOString(), provenanceLabel: 'LOCAL DRAFT · NOT OPERATIONAL RELEASE' }; const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }); const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = `northstar-one-line-rev-${state.revision || 0}.json`; link.click(); URL.revokeObjectURL(link.href); setStatus('JSON record downloaded', true); }
  function importFile(file) { const reader = new FileReader(); reader.onload = () => { try { const payload = JSON.parse(reader.result); if (!Array.isArray(payload.symbols) || !Array.isArray(payload.edges)) throw new Error(); state.symbols = payload.symbols; state.edges = payload.edges; state.revision = Number(payload.revision) || 0; state.selected = null; markDirty('Imported record requires save'); render(); } catch { setStatus('Import rejected: invalid one-line record'); } }; reader.readAsText(file); }
  svg.addEventListener('pointerdown', event => { const node = event.target.closest('.node'); const edge = event.target.closest('.wire'); if (edge) { state.selected = edge.dataset.edgeId; render(); return; } if (!node) { state.selected = null; render(); return; } const symbol = symbolById(node.dataset.symbolId); if (state.tool === 'connect') { if (!connectStart) { connectStart = symbol.id; setStatus(`Connect from ${symbol.id} · choose destination`); return; } if (connectStart !== symbol.id && !state.edges.some(item => (item.from === connectStart && item.to === symbol.id) || (item.from === symbol.id && item.to === connectStart))) state.edges.push({ id: `E-${String(state.edges.length + 1).padStart(2, '0')}`, from: connectStart, to: symbol.id }); connectStart = null; markDirty('Connection updated'); render(); return; } state.selected = symbol.id; const point = canvasPoint(event); drag = { id: symbol.id, dx: symbol.x - point.x, dy: symbol.y - point.y }; svg.setPointerCapture(event.pointerId); render(); });
  svg.addEventListener('pointermove', event => { if (!drag) return; const symbol = symbolById(drag.id); if (!symbol) return; const point = canvasPoint(event); symbol.x = Math.round(clamp(point.x + drag.dx, 30, 970) / 20) * 20; symbol.y = Math.round(clamp(point.y + drag.dy, 30, 530) / 20) * 20; markDirty(); render(); });
  svg.addEventListener('pointerup', () => { if (drag) markDirty('Position updated'); drag = null; });
  root.querySelectorAll('.symbol-tool').forEach(button => button.onclick = () => { const type = button.dataset.symbolType; if (type === 'select') { state.tool = 'select'; connectStart = null; root.querySelectorAll('.symbol-tool').forEach(item => item.classList.remove('active')); button.classList.add('active'); setStatus('Select mode'); return; } if (type === 'connect') { state.tool = 'connect'; connectStart = null; root.querySelectorAll('.symbol-tool').forEach(item => item.classList.toggle('active', item === button)); setStatus('Connect mode · choose two symbols'); return; } addSymbol(type); });
  $('#oneLineDemo').onclick = startDemo; $('#oneLineSave').onclick = save; $('#oneLineExport').onclick = download; $('#oneLineClear').onclick = () => { if (!state.symbols.length || confirm('Clear this local draft?')) { state.symbols = []; state.edges = []; state.selected = null; markDirty('Canvas cleared'); render(); } }; $('#oneLineImport').onclick = () => $('#oneLineImportFile').click(); $('#oneLineImportFile').onchange = event => { if (event.target.files[0]) importFile(event.target.files[0]); event.target.value = ''; };
  load() || startDemo();
})();
