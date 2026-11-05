(() => {
  'use strict';
  const root = document.querySelector('.switching-sim');
  if (!root) return;
  const api = '/api/training/switching';
  const $ = selector => root.querySelector(selector);
  const stationSelect = $('.sim-station'), scenarioSelect = $('.sim-scenario');
  let scenarioCatalog = [];
  function filterScenarios() {
    scenarioSelect.replaceChildren();
    scenarioCatalog.filter(item => item.modelId === stationSelect.value).forEach(item => {
      const option = document.createElement('option'); option.value = item.scenarioId;
      option.textContent = item.title; scenarioSelect.append(option);
    });
  }
  let sessionId = '', snapshot = null, selected = '', selection = null, eventCursor = 0, pollTimer = 0, lastDebrief = null;
  let renderingR013 = false;
  const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const request = async (path, options = {}) => {
    const response = await fetch(api + path, {credentials:'same-origin', ...options,
      headers:{'Content-Type':'application/json', ...(options.headers || {})}});
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.message || data.error || `Request failed (${response.status})`);
    return data;
  };
  const status = text => { $('.sim-readiness').textContent = text; };
  const fmtTime = ms => `${String(Math.floor(ms / 60000)).padStart(2,'0')}:${String(Math.floor(ms / 1000) % 60).padStart(2,'0')}.${String(Math.floor(ms / 100) % 10)}`;
  const clockBody = (action, speed) => ({action, ...(speed == null ? {} : {speed}),
    expectedControlRevision:snapshot.controlRevision, idempotencyKey:crypto.randomUUID()});
  function openFromEntry(siteId = '') {
    window.NorthstarModules?.open('training:switching-simulator');
    if (siteId) {
      stationSelect.value = siteId;
      $('.sim-launch').disabled = true;
      status(`${siteId}: catalog-only. No reviewed station model is available; the synthetic training model is not this station.`);
    }
  }
  window.NorthstarSwitchingSimulator = {open:openFromEntry};
  function installEntryLinks() {
    const switching = document.querySelector('#switching .switching-workspace');
    if (switching && !switching.querySelector('[data-simulator-entry]')) {
      const link = document.createElement('button'); link.type = 'button'; link.dataset.simulatorEntry = '';
      link.className = 'sim-entry-link'; link.textContent = 'TRAINING MODEL STATUS / SIMULATOR';
      link.addEventListener('click', () => openFromEntry()); switching.prepend(link);
    }
    document.querySelectorAll('#operationsSites .gs-site-page').forEach(page => {
      if (page.querySelector('[data-simulator-entry]')) return;
      const link = document.createElement('button'); link.type = 'button'; link.dataset.simulatorEntry = '';
      link.className = 'sim-entry-link'; link.textContent = 'TRAINING MODEL STATUS — NOT SITE-SPECIFIC';
      link.addEventListener('click', () => openFromEntry(page.dataset.siteId || ''));
      page.append(link);
    });
  }

  async function initialize() {
    try {
      const [models, scenarios] = await Promise.all([request('/models'), request('/scenarios')]);
      stationSelect.replaceChildren();
      models.models.forEach(model => {
        const option = document.createElement('option');
        option.value = model.modelId || model.siteId;
        option.textContent = model.synthetic ? `${model.label || model.modelId} — ${model.readiness.replaceAll('_',' ').toUpperCase()}` : `${model.name} — CATALOG ONLY`;
        option.disabled = !model.canLaunch;
        option.dataset.readiness = model.readiness;
        stationSelect.append(option);
      });
      scenarioCatalog = scenarios.scenarios;
      stationSelect.value = 'SIM-IS-TW-IR-R013'; filterScenarios();
      status('r013: Island / Twin / Iroquois source-qualified draft. Unresolved wiring and assumed dynamics are marked. Training only.');
      $('.sim-launch').disabled = !stationSelect.value.startsWith('SIM-');
      installEntryLinks();
    } catch (error) { status(`Simulator unavailable: ${error.message}`); $('.sim-launch').disabled = true; }
  }

  function renderDiagram() {
    const nodes = snapshot?.diagram?.nodes || [];
    const devices = snapshot?.diagram?.equipment || [];
    const width = 760, height = 250;
    const layout = {N0:[60,86],N1:[220,86],N2:[380,86],BUS:[540,86],NG:[540,180],EARTH:[690,180]};
    const position = nodeId => layout[nodeId] || [60 + Math.max(0,nodes.findIndex(node => node.nodeId === nodeId)) * 110, 86];
    const x = Object.fromEntries(nodes.map(node => [node.nodeId, position(node.nodeId)[0]]));
    const nodeState = snapshot.diagram?.nodeObservations || {};
    const lines = devices.filter(device => device.terminals.length === 2).map(device => {
      const [a,b] = device.terminals, left = nodeState[a.nodeId], right = nodeState[b.nodeId];
      const energized = left?.energization === 'energized' && right?.energization === 'energized';
      const knownPosition = device.type === 'line' || device.indicationQuality === 'good';
      const active = device.type === 'line' || (knownPosition && device.reportedPosition === 'closed');
      const cls = !left || !right || left.energization === 'indeterminate' || right.energization === 'indeterminate' || (!knownPosition && device.type !== 'line') ? 'unknown' : active && energized ? 'energized' : 'deenergized';
      const [ax,ay] = position(a.nodeId), [bx,by] = position(b.nodeId), midpoint = (ax + bx) / 2, midY = (ay + by) / 2;
      const switcher = ['breaker','isolator','earth_switch'].includes(device.type);
      const reported = device.indicationQuality === 'good' ? device.reportedPosition : 'unknown';
      const symbol = switcher ? `<g class="sim-switch" data-equipment="${esc(device.equipmentId)}" tabindex="0" role="button" aria-label="Select ${esc(device.equipmentId)}, returned indication ${esc(reported)}, quality ${esc(device.indicationQuality)}"><circle cx="${midpoint}" cy="${midY}" r="12"/><text x="${midpoint}" y="${midY+4}">${reported === 'closed' ? '●' : reported === 'open' ? '○' : '?'}</text><text class="sim-device-label" x="${midpoint}" y="${midY+31}">${esc(device.equipmentId)}</text></g>` : `<text class="sim-device-label" x="${midpoint}" y="${midY-10}">${esc(device.equipmentId)}</text>`;
      return `<g class="sim-edge ${cls}"><line x1="${ax}" y1="${ay}" x2="${bx}" y2="${by}"/>${symbol}</g>`;
    }).join('');
    const points = nodes.filter(node => node.kind !== 'earth').map(node => {
      const state = nodeState[node.nodeId] || {};
      const cls = state.energization === 'energized' ? 'energized-node' : state.energization === 'deenergized' ? 'dead-node' : 'unknown-node';
      const [nx,ny] = position(node.nodeId);
      return `<g class="sim-node ${cls}"><circle cx="${nx}" cy="${ny}" r="5"/><text x="${nx}" y="${ny+54}">${esc(node.nodeId)}</text><text class="sim-voltage" x="${nx}" y="${ny+70}">${state.voltageKVLL == null ? `${state.energization || 'unknown'} · ${state.quality || 'no scan'}` : `${Number(state.voltageKVLL).toFixed(3)} kV · ${state.quality}`}</text></g>`;
    }).join('');
    const sources = devices.filter(device => device.terminals.length === 1).map(device => {
      const [sx,sy] = position(device.terminals[0].nodeId);
      return `<text class="sim-device-label" x="${sx}" y="${sy-20}">${esc(device.type)} · ${esc(device.equipmentId)}</text>`;
    }).join('');
    $('.sim-diagram').innerHTML = `<svg viewBox="0 0 ${width} ${height}" role="presentation" aria-label="Electrical connections come from explicit terminal mappings">${sources}${lines}${points}</svg>`;
    $('.sim-diagram').querySelectorAll('[data-equipment]').forEach(node => {
      node.addEventListener('click', () => chooseDevice(node.dataset.equipment));
      node.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); chooseDevice(node.dataset.equipment); } });
    });
  }

  function render() {
    if (!snapshot) return;
    $('.sim-session-title').textContent = `${snapshot.modelId} · ${snapshot.scenarioId} · ${snapshot.readiness.replaceAll('_',' ').toUpperCase()}`;
    $('.sim-time').textContent = fmtTime(snapshot.simTimeMs);
    $('.sim-clock-state').textContent = snapshot.status.toUpperCase();
    $('.sim-workspace').hidden = false; $('.sim-empty').hidden = true;
    $('.sim-finish').disabled = snapshot.status === 'completed';
    $('.sim-reset').disabled = snapshot.status !== 'completed';
    $('.sim-speed').value = String(snapshot.speed);
    if (!snapshot.r013 || !renderingR013) window.ComplexTrainer?.render(snapshot.r013 ? {...snapshot,complex:false} : snapshot, {chooseDevice, selectAction});
    window.R013Trainer?.render(snapshot, {chooseDevice, selectAction});
    renderingR013 = !!snapshot.r013;
    if (!snapshot.complex) { renderUnit(); renderDiagram(); }
    $('.sim-tags').innerHTML = (snapshot.tags || []).map(tag => `<div class="sim-tag"><span>${esc(tag.tagId)}</span><strong>${tag.value == null ? '—' : esc(typeof tag.value === 'number' ? Number(tag.value).toFixed(3) : tag.value)} ${esc(tag.unit)}</strong><small>${esc(tag.quality)} · observed ${fmtTime(tag.observedSimTimeMs)}</small></div>`).join('');
    paintAlarms();
    if (selected) paintFaceplate();
    const activeCommand = (snapshot.commands || []).find(c => c.commandId === $('.sim-command-status').dataset.commandId);
    if (activeCommand && !selection) {
      $('.sim-command-status').textContent = `COMMAND ${activeCommand.lifecycle.toUpperCase()} · ${activeCommand.equipmentId} · ${activeCommand.action}` +
        (activeCommand.failureReason ? ` · ${activeCommand.failureReason}` : activeCommand.indicationConfirmed ? ' · returned indication confirmed' : ['completed','succeeded'].includes(activeCommand.lifecycle) ? ' · applied in simulation' : ' · awaiting completion and returned indication');
    }
  }

  function renderUnit() {
    const sample = id => (snapshot.tags || []).find(tag => tag.tagId === id);
    const rows = entries => `<dl class="sim-unit-readouts">${entries.map(([label,id]) => {
      const tag = sample(id);
      const good = tag?.quality === 'good' && tag.value != null;
      const value = good ? (typeof tag.value === 'number' ? Number(tag.value).toFixed(2) : tag.value) : 'UNKNOWN';
      return `<dt>${esc(label)}</dt><dd>${esc(value)}${good && tag.unit ? ` ${esc(tag.unit)}` : ''}<small> ${esc(tag?.quality || 'no scan')}${tag ? ` · ${fmtTime(tag.observedSimTimeMs)}` : ''}</small></dd>`;
    }).join('')}</dl>`;
    $('.sim-mode').textContent = snapshot.sessionMode;
    $('.sim-unit-sequence').innerHTML = rows([['Sequence','sim.GEN1.sequenceState'],['Breaker feedback','sim.GB1.position']]);
    $('.sim-unit-electrical').innerHTML = rows([['Unit voltage','sim.GEN1.voltage'],['Bus voltage','sim.BUS1.voltage'],['Power','sim.GEN1.power'],['Reactive demand','sim.GEN1.reactivePower'],['Frequency','sim.GEN1.frequency'],['Current','sim.GEN1.current'],['Power factor','sim.GEN1.powerFactor']]);
    $('.sim-unit-governor').innerHTML = rows([['MW demand','sim.GEN1.requestedPower'],['Gate fraction','sim.GEN1.gate'],['Flow','sim.TUR1.flow'],['Hydraulic power','sim.TUR1.hydraulicPower'],['Generated energy','sim.GEN1.energy']]);
    $('.sim-unit-excitation').innerHTML = rows([['Field current','sim.GEN1.fieldCurrent'],['Unit voltage','sim.GEN1.voltage'],['Mvar demand','sim.GEN1.reactivePower']]);
    $('.sim-unit-water').innerHTML = rows([['Speed','sim.GEN1.speed'],['Headwater','sim.POND1.level'],['Net head','sim.TUR1.netHead'],['Turbine flow','sim.TUR1.flow']]);
    $('.sim-unit-aux').innerHTML = rows([['HPU pressure','sim.GEN1.hpuPressure'],['Bearing temperature','sim.GEN1.bearingTemperature']]);
    root.querySelectorAll('[data-unit-action]').forEach(button => { button.disabled = snapshot.status !== 'running'; });
    $('.sim-instructor').hidden = snapshot.sessionMode !== 'SOLO LOCAL — LEARNER + INSTRUCTOR';
    $('.sim-inject').disabled = !['running','paused'].includes(snapshot.status);
  }

  function paintAlarms() {
    const host = $('.sim-alarm-list'); host.replaceChildren();
    const alarms = snapshot?.alarms || [];
    if (!alarms.length) { host.textContent = 'No simulated alarm occurrences.'; return; }
    alarms.forEach(alarm => {
      const row = document.createElement('div'); row.className = `sim-alarm ${alarm.state}`;
      const label = document.createElement('span');
      label.textContent = `${alarm.alarmId} · ${alarm.severity} · ${alarm.state.replaceAll('_',' ')} · picked up ${fmtTime(alarm.pickedUpAtSimTimeMs)}`;
      row.append(label);
      if (!alarm.acknowledged) {
        const button = document.createElement('button'); button.type = 'button'; button.textContent = 'ACK SIM ALARM';
        button.addEventListener('click', async () => {
          button.disabled = true;
          try {
            await request(`/sessions/${encodeURIComponent(sessionId)}/alarms/${encodeURIComponent(alarm.occurrenceId)}/ack`, {
              method:'POST', body:JSON.stringify({expectedControlRevision:snapshot.controlRevision, idempotencyKey:crypto.randomUUID()})});
            await refresh();
          } catch (error) { $('.sim-command-status').textContent = error.message; button.disabled = false; }
        });
        row.append(button);
      }
      host.append(row);
    });
  }

  function chooseDevice(id) {
    selected = id; selection = null;
    $('.sim-command-status').dataset.commandId = '';
    paintFaceplate();
    $('.sim-command-status').textContent = 'Choose an explicit action to evaluate simulated permissives.';
    $('.sim-execute').disabled = true;
  }
  function paintFaceplate() {
    if (snapshot?.r013) { window.R013Trainer?.faceplate(snapshot, selected); return; }
    if (snapshot?.complex) { window.ComplexTrainer?.faceplate(snapshot, selected); return; }
    const device = snapshot?.diagram?.equipment.find(item => item.equipmentId === selected);
    const actual = snapshot?.equipment.find(item => item.equipmentId === selected);
    if (!device) return;
    const latest = [...(snapshot.commands || [])].reverse().find(item => item.equipmentId === selected);
    const feedback = actual?.indicationQuality === 'good' ? actual.reportedPosition : 'unknown';
    $('.sim-device').innerHTML = `<dl><dt>Equipment</dt><dd>${esc(device.equipmentId)} · ${esc(device.type)}</dd><dt>Returned indication</dt><dd>${esc(feedback || 'unknown')}</dd><dt>Indication quality</dt><dd>${esc(actual?.indicationQuality || 'unknown')}${actual?.indicationObservedSimTimeMs == null ? '' : ` · observed ${fmtTime(actual.indicationObservedSimTimeMs)}`}</dd><dt>Last command</dt><dd>${latest ? `${esc(latest.action)} · ${esc(latest.lifecycle)} (not feedback)` : 'none'}</dd><dt>Local / DC / lockout</dt><dd>Checked by server during selection and execution; no independent feedback tag</dd><dt>Control</dt><dd>Simulation only</dd></dl>`;
    $('.sim-actions [data-action="open"]').disabled = snapshot.status !== 'running' || !['breaker','isolator','earth_switch'].includes(device.type);
    $('.sim-actions [data-action="close"]').disabled = snapshot.status !== 'running' || !['breaker','isolator','earth_switch'].includes(device.type);
    $('.sim-actions [data-action="reset_lockout"]').disabled = snapshot.status !== 'running' || !['breaker','isolator'].includes(device.type);
  }

  async function selectAction(action, extra = {}) {
    if (!snapshot || !selected) return;
    $('.sim-command-status').dataset.commandId = '';
    $('.sim-command-status').textContent = 'Checking simulation permissives…';
    $('.sim-execute').disabled = true;
    try {
      selection = await request(`/sessions/${encodeURIComponent(sessionId)}/select`, {method:'POST', body:JSON.stringify({
        equipmentId:selected, action, ...extra, expectedControlRevision:snapshot.controlRevision})});
      const reasons = selection.permissives || [];
      $('.sim-command-status').textContent = reasons.length ? `REFUSED: ${reasons.map(item => `${item.code} — ${item.message}`).join('; ')}` : `Ready: ${action.toUpperCase()} selected. Selection expires in 10 seconds; execution is a separate action.`;
      $('.sim-execute').disabled = Boolean(reasons.length);
    } catch (error) { selection = null; $('.sim-command-status').textContent = error.message; }
  }

  async function execute() {
    if (!selection?.selectionToken) return;
    $('.sim-execute').disabled = true;
    try {
      const result = await request(`/sessions/${encodeURIComponent(sessionId)}/commands`, {method:'POST', body:JSON.stringify({
        selectionToken:selection.selectionToken, expectedControlRevision:selection.controlRevision,
        idempotencyKey:crypto.randomUUID()})});
      $('.sim-command-status').textContent = `COMMAND ${result.lifecycle.toUpperCase()} · expected travel complete at ${fmtTime(result.expectedCompletionSimTimeMs)}. Acceptance is not proof of operation.`;
      $('.sim-command-status').dataset.commandId = result.commandId;
      selection = null; await refresh();
    } catch (error) { $('.sim-command-status').textContent = error.message; selection = null; }
  }

  async function refresh() {
    if (!sessionId) return;
    try {
      snapshot = await request(`/sessions/${encodeURIComponent(sessionId)}`);
      render();
      const feed = await request(`/sessions/${encodeURIComponent(sessionId)}/events?afterSequence=${eventCursor}`);
      feed.events.forEach(event => {
        eventCursor = Math.max(eventCursor, event.sequence);
        const li = document.createElement('li');
        li.textContent = `${fmtTime(event.simTimeMs)} · ${event.kind.replaceAll('_',' ')}${event.detail?.equipmentId ? ` · ${event.detail.equipmentId}` : ''}${event.detail?.reason ? ` · ${event.detail.reason}` : ''}`;
        $('.sim-events ol').prepend(li);
      });
      eventCursor = Math.max(eventCursor, Number(feed.nextSequence || 0));
      while ($('.sim-events ol').children.length > 100) $('.sim-events ol').lastElementChild.remove();
    } catch (error) { $('.sim-command-status').textContent = `Reconnecting: ${error.message}`; }
  }

  $('.sim-launch').addEventListener('click', async () => {
    if (!stationSelect.value.startsWith('SIM-')) { status('This real station is catalog-only and has no reviewed model.'); return; }
    try {
      const created = await request('/sessions', {method:'POST', body:JSON.stringify({modelId:stationSelect.value, scenarioId:scenarioSelect.value})});
      sessionId = created.sessionId; snapshot = created; eventCursor = 0; selection = null; selected = ''; lastDebrief = null;
      $('.sim-device').replaceChildren(); $('.sim-command-status').textContent = ''; $('.sim-command-status').dataset.commandId = ''; $('.sim-execute').disabled = true;
      $('.sim-events ol').replaceChildren(); $('.sim-debrief').hidden = true; $('.sim-export').disabled = true;
      render(); clearInterval(pollTimer); pollTimer = setInterval(refresh, 1000); await refresh();
    } catch (error) { status(`Could not start exercise: ${error.message}`); }
  });
  stationSelect.addEventListener('change', () => { filterScenarios(); $('.sim-launch').disabled = !stationSelect.value.startsWith('SIM-'); });
  root.querySelectorAll('[data-clock]').forEach(button => button.addEventListener('click', async () => {
    if (!sessionId) return;
    try { snapshot = await request(`/sessions/${encodeURIComponent(sessionId)}/clock`, {method:'POST', body:JSON.stringify(clockBody(button.dataset.clock))}); render(); }
    catch (error) { $('.sim-command-status').textContent = error.message; }
  }));
  $('.sim-speed').addEventListener('change', async event => {
    if (!sessionId) return;
    try { snapshot = await request(`/sessions/${encodeURIComponent(sessionId)}/clock`, {method:'POST', body:JSON.stringify(clockBody('speed', Number(event.target.value)))}); render(); }
    catch (error) { $('.sim-command-status').textContent = error.message; }
  });
  root.querySelectorAll('.sim-actions [data-action]').forEach(button => button.addEventListener('click', () => selectAction(button.dataset.action)));
  root.querySelectorAll('[data-unit-action]').forEach(button => button.addEventListener('click', () => {
    chooseDevice('GEN1');
    const action = button.dataset.unitAction;
    const input = action === 'setpoint' ? $('.sim-mw') : action === 'set_mvar' ? $('.sim-mvar') : null;
    if (input && (input.value.trim() === '' || !input.validity.valid)) {
      $('.sim-command-status').textContent = 'Enter a finite setpoint within the fictional limits.'; return;
    }
    selectAction(action, input ? {requestedValue:Number(input.value), unit:action === 'setpoint' ? 'MW' : 'Mvar'} : {});
    $('.sim-faceplate').scrollIntoView({behavior:'smooth', block:'nearest'});
  }));
  $('.sim-gb-faceplate').addEventListener('click', () => { chooseDevice('GB1'); $('.sim-faceplate').scrollIntoView({behavior:'smooth', block:'nearest'}); });
  $('.sim-inject').addEventListener('click', async () => {
    if (!sessionId || !confirm('Inject the fictional five-second overload into this simulation session?')) return;
    try {
      await request(`/sessions/${encodeURIComponent(sessionId)}/faults`, {method:'POST', body:JSON.stringify({type:'load_overcurrent', durationMs:5000, expectedControlRevision:snapshot.controlRevision, idempotencyKey:crypto.randomUUID()})});
      $('.sim-command-status').textContent = 'Synthetic overload injected; observe the simulation response.'; await refresh();
    } catch (error) { $('.sim-command-status').textContent = error.message; }
  });
  $('.sim-execute').addEventListener('click', execute);
  $('.sim-finish').addEventListener('click', async () => {
    if (!sessionId || !confirm('Finish this simulation run and freeze its training debrief?')) return;
    try {
      const debrief = await request(`/sessions/${encodeURIComponent(sessionId)}/finish`, {method:'POST',
        body:JSON.stringify({expectedControlRevision:snapshot.controlRevision, idempotencyKey:crypto.randomUUID()})});
      lastDebrief = debrief; $('.sim-export').disabled = false;
      $('.sim-debrief').textContent = `${debrief.objectiveAchieved ? 'OBJECTIVE ACHIEVED' : 'OBJECTIVE NOT ACHIEVED'}\n` +
        `This is simulation learning evidence only — not a competency certificate or operating authorization.\n` +
        JSON.stringify(debrief, null, 2);
      $('.sim-debrief').hidden = false; await refresh();
    } catch (error) { $('.sim-command-status').textContent = error.message; }
  });
  $('.sim-reset').addEventListener('click', async () => {
    if (!sessionId || !confirm('Start a new run from the same pinned model and scenario? The previous run debrief will be retained.')) return;
    try {
      snapshot = await request(`/sessions/${encodeURIComponent(sessionId)}/reset`, {method:'POST',
        body:JSON.stringify({expectedControlRevision:snapshot.controlRevision, idempotencyKey:crypto.randomUUID()})});
      selected = ''; selection = null; lastDebrief = null; $('.sim-export').disabled = true; eventCursor = snapshot.nextSequence || eventCursor;
      $('.sim-debrief').hidden = true; $('.sim-events ol').replaceChildren(); render();
    } catch (error) { $('.sim-command-status').textContent = error.message; }
  });
  $('.sim-export').addEventListener('click', () => {
    if (!lastDebrief) return;
    const url = URL.createObjectURL(new Blob([JSON.stringify(lastDebrief, null, 2)], {type:'application/json'}));
    const link = document.createElement('a'); link.href = url; link.download = `synthetic-debrief-${lastDebrief.runId}.json`;
    link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
  const entryObserver = new MutationObserver(installEntryLinks);
  entryObserver.observe(document.body, {subtree:true, childList:true});
  initialize();
})();
