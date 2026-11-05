(() => {
  'use strict';

  const root = document.querySelector('#unitCyclingWorkspace');
  if (!root) return;

  const FALLBACK_CATALOG = {
    eventTypes: [
      { key: 'START', label: 'Start' }, { key: 'STOP', label: 'Stop' },
      { key: 'TRIP', label: 'Trip' }, { key: 'SYNCHRONIZED', label: 'Synchronized' },
      { key: 'DESYNCHRONIZED', label: 'Desynchronized' }, { key: 'TEST', label: 'Test / exercise' },
      { key: 'OTHER', label: 'Other operational event' },
    ],
    appendOnly: true, requiresReason: ['TRIP', 'OTHER'], timezone: 'America/Toronto',
  };
  let catalog = FALLBACK_CATALOG;
  let summary = { eventsToday: 0, tripsToday: 0, runningUnits: 0, trippedUnits: 0, unitStates: [], records: [] };
  let message = 'LOADING APPEND-ONLY LEDGER…';

  const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[char]));
  const localTime = () => {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Toronto', year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).formatToParts(new Date());
    const get = type => parts.find(part => part.type === type)?.value || '';
    return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}`;
  };
  const formatTime = value => {
    if (!value) return '—';
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return escape(value);
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Toronto', month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
    }).format(parsed) + ' ET';
  };
  const amount = value => value === null || value === undefined || value === '' ? '—' : Number(value).toLocaleString('en-CA', { maximumFractionDigits: 2 });
  const stateClass = value => ['RUNNING', 'STOPPED', 'TRIPPED', 'TESTING'].includes(value) ? value.toLowerCase() : 'recorded';
  const eventOptions = () => (catalog.eventTypes || FALLBACK_CATALOG.eventTypes)
    .map(item => `<option value="${escape(item.key)}">${escape(item.label)}</option>`).join('');

  async function api(path, options = {}) {
    const response = await fetch(path, {
      ...options,
      headers: { Accept: 'application/json', ...(options.headers || {}) },
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `Request failed (${response.status})`);
    return payload;
  }

  function stateRows() {
    const records = Array.isArray(summary.unitStates) ? summary.unitStates : [];
    if (!records.length) return '<p class="unit-cycling-empty">No unit events have been recorded yet.</p>';
    return records.map(record => `<article class="unit-state-row">
      <div><strong>${escape(record.station)} · ${escape(record.unitName)}</strong><small>${escape(record.eventType)} · ${formatTime(record.occurredAt)}</small></div>
      <span class="unit-state ${stateClass(record.state)}">${escape(record.state)}</span>
      <div class="unit-state-hours"><span>${amount(record.runningHours)} H</span><small>${amount(record.runningDays)} D</small></div>
    </article>`).join('');
  }

  function ledgerRows() {
    const records = Array.isArray(summary.records) ? summary.records : [];
    if (!records.length) return '<tr><td colspan="8" class="unit-cycling-empty">No append-only records yet.</td></tr>';
    return records.map(record => `<tr>
      <td>${formatTime(record.occurredAt)}</td>
      <td><strong>${escape(record.station)}</strong><small>${escape(record.unitName)}</small></td>
      <td><span class="unit-event ${stateClass(record.state)}">${escape(record.eventType)}</span></td>
      <td>${amount(record.runningHours)}</td>
      <td>${amount(record.runningDays)}</td>
      <td>${escape(record.reason || '—')}</td>
      <td>${escape(record.sourceRef || 'Operator entry')}</td>
      <td>${escape(record.createdBy || 'operator')}</td>
    </tr>`).join('');
  }

  function render() {
    root.innerHTML = `<section class="unit-cycling-hero panel">
      <div><label>UNIT CYCLING · APPEND-ONLY OPERATOR RECORD</label><h2>Starts, stops, trips &amp; running time</h2><p class="muted-note">Record an operational event once. Corrections are new evidence records; this workspace never sends commands to a unit, SCADA, or plant equipment.</p></div>
      <div class="unit-cycling-hero-state"><span>ET TIME</span><b>${escape(catalog.timezone || 'America/Toronto')}</b><small>IMMUTABLE LEDGER</small></div>
    </section>
    <section class="unit-cycling-kpis" aria-label="Unit cycling summary">
      <div><span>EVENTS TODAY</span><b>${Number(summary.eventsToday || 0)}</b></div>
      <div class="trip"><span>TRIPS TODAY</span><b>${Number(summary.tripsToday || 0)}</b></div>
      <div class="running"><span>RUNNING UNITS</span><b>${Number(summary.runningUnits || 0)}</b></div>
      <div class="tripped"><span>TRIPPED UNITS</span><b>${Number(summary.trippedUnits || 0)}</b></div>
    </section>
    <section class="unit-cycling-layout">
      <form class="panel unit-cycling-form" id="unitCyclingForm">
        <div class="unit-cycling-heading"><div><label>RECORD A CYCLING EVENT</label><h3>Controlled operational intake</h3></div><span>${escape(message)}</span></div>
        <div class="unit-cycling-form-grid">
          <label>STATION<input name="station" required maxlength="120" placeholder="Plant / station"></label>
          <label>UNIT<input name="unitName" required maxlength="120" placeholder="Unit 1"></label>
          <label>EVENT<select name="eventType">${eventOptions()}</select></label>
          <label>OCCURRED AT · ET<input name="occurredAt" type="datetime-local" value="${escape(localTime())}" required></label>
          <label>RUNNING HOURS<input name="runningHours" type="number" min="0" step="0.01" placeholder="Optional cumulative hours"></label>
          <label>RUNNING DAYS<input name="runningDays" type="number" min="0" step="0.01" placeholder="Optional cumulative days"></label>
          <label class="wide">REASON / CAUSE<textarea name="reason" maxlength="2000" placeholder="Required for trip or other events"></textarea></label>
          <label class="wide">SOURCE REFERENCE<input name="sourceRef" maxlength="240" placeholder="SCADA report ID, operator log, ticket, or source record"></label>
          <label class="wide">NOTES<textarea name="notes" maxlength="4000" placeholder="Observed conditions, actions, or handoff context"></textarea></label>
        </div>
        <div class="unit-cycling-actions"><button class="primary-btn" type="submit">RECORD IMMUTABLE EVENT</button><span>Trip and other events require a reason. No edit or delete action is available.</span></div>
      </form>
      <section class="panel unit-cycling-states"><div class="unit-cycling-heading"><div><label>CURRENT UNIT STATE</label><h3>Latest recorded event</h3></div><button class="secondary-btn" type="button" data-unit-cycling-refresh>REFRESH</button></div><div class="unit-state-list">${stateRows()}</div></section>
    </section>
    <section class="panel unit-cycling-ledger"><div class="unit-cycling-heading"><div><label>APPEND-ONLY LEDGER</label><h3>Recent unit cycling records</h3></div><span>${(summary.records || []).length} RECORDS LOADED</span></div><div class="unit-cycling-table-wrap"><table><thead><tr><th>OCCURRED</th><th>STATION / UNIT</th><th>EVENT</th><th>RUN H</th><th>RUN D</th><th>REASON</th><th>SOURCE</th><th>RECORDED BY</th></tr></thead><tbody>${ledgerRows()}</tbody></table></div></section>`;
    root.querySelector('#unitCyclingForm')?.addEventListener('submit', submit);
    root.querySelector('[data-unit-cycling-refresh]')?.addEventListener('click', () => void load(false));
    window.watchdogMark?.('unit-cycling', true);
  }

  function applyRecordedEvent(record) {
    const existingRecords = Array.isArray(summary.records) ? summary.records : [];
    const records = [record, ...existingRecords.filter(item => item.id !== record.id)]
      .sort((left, right) => `${right.occurredAt}|${right.createdAt}`.localeCompare(`${left.occurredAt}|${left.createdAt}`))
      .slice(0, 200);
    const states = new Map((Array.isArray(summary.unitStates) ? summary.unitStates : [])
      .map(item => [`${item.station}\u0000${item.unitName}`, item]));
    const stateKey = `${record.station}\u0000${record.unitName}`;
    const current = states.get(stateKey);
    if (!current || `${record.occurredAt}|${record.createdAt}` >= `${current.occurredAt}|${current.createdAt}`) {
      states.set(stateKey, record);
    }
    const unitStates = [...states.values()].sort((left, right) =>
      `${left.station}\u0000${left.unitName}`.localeCompare(`${right.station}\u0000${right.unitName}`));
    const today = localTime().slice(0, 10);
    const todayRecords = records.filter(item => String(item.occurredAt || '').slice(0, 10) === today);
    summary = {
      ...summary, records, unitStates, eventsToday: todayRecords.length,
      tripsToday: todayRecords.filter(item => item.eventType === 'TRIP').length,
      runningUnits: unitStates.filter(item => item.state === 'RUNNING').length,
      trippedUnits: unitStates.filter(item => item.state === 'TRIPPED').length,
    };
  }

  async function submit(event) {
    event.preventDefault();
    const form = event.currentTarget;
    message = 'RECORDING…';
    render();
    const payload = Object.fromEntries(new FormData(form));
    try {
      const record = await api('/api/unit-cycling', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
      });
      applyRecordedEvent(record);
      message = `RECORDED · ${record.id} · APPEND-ONLY`;
      render();
    } catch (error) {
      message = `RECORD BLOCKED · ${error.message}`;
      render();
    }
  }

  async function load(preserveMessage) {
    if (!preserveMessage) message = 'REFRESHING LEDGER…';
    try {
      const [catalogPayload, summaryPayload] = await Promise.all([
        api('/api/unit-cycling/catalog'), api('/api/unit-cycling/summary?limit=200'),
      ]);
      if (catalogPayload && Array.isArray(catalogPayload.eventTypes)) catalog = catalogPayload;
      summary = summaryPayload || summary;
      if (!preserveMessage) message = 'LEDGER CURRENT · APPEND-ONLY';
      window.watchdogMark?.('unit-cycling', true);
    } catch (error) {
      if (!preserveMessage) message = `LEDGER UNAVAILABLE · ${error.message}`;
      window.watchdogMark?.('unit-cycling', false);
    }
    render();
  }

  render();
  void load(false);
})();
