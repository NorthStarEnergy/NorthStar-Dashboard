(() => {
  'use strict';

  const REFRESH_MS = 120000;
  const FALLBACK_CATALOG = {
    regions: ['EAST', 'WEST', 'QUEBEC'],
    sourceChecks: [
      { key: 'hydrometric', label: 'Hydrometric readings' },
      { key: 'scada_production', label: 'SCADA / production summary' },
      { key: 'forecast_weather', label: 'Forecast / weather' },
      { key: 'outages', label: 'Outages / incidents' },
      { key: 'unit_cycling', label: 'Unit cycling' },
      { key: 'maintenance', label: 'Maintenance / service requests' },
    ],
    sourceStates: ['NOT REVIEWED', 'REVIEWED', 'NOT APPLICABLE', 'EXCEPTION'],
    metrics: [
      { key: 'gauge_water_level', label: 'Gauge water level' },
      { key: 'gauge_discharge', label: 'Gauge discharge' },
      { key: 'water_level', label: 'Water level' },
      { key: 'inflow', label: 'Inflow' }, { key: 'outflow', label: 'Outflow' },
      { key: 'spill', label: 'Spill / leakage' }, { key: 'generation', label: 'Generation' },
      { key: 'precipitation', label: 'Precipitation' }, { key: 'water_temperature', label: 'Water temperature' },
      { key: 'forecast', label: 'Forecast' }, { key: 'unit_status', label: 'Unit status' },
      { key: 'operation_note', label: 'Operational note' },
    ],
  };
  const FALLBACK_WATER_CATALOG = {
    regions: ['EAST', 'WEST', 'QUEBEC'],
    facilities: [
      { region: 'EAST', name: 'Lake Abitibi' }, { region: 'EAST', name: 'Twin Falls' },
      { region: 'EAST', name: 'Iroquois Falls' }, { region: 'EAST', name: 'Island Falls' },
      { region: 'EAST', name: 'Old Woman Falls' }, { region: 'EAST', name: 'White Otter Falls' },
      { region: 'EAST', name: 'Camp Three Rapids' }, { region: 'EAST', name: 'Big Beaver Falls' },
      { region: 'EAST', name: 'Okikendawt' }, { region: 'QUEBEC', name: 'COGEN' },
      { region: 'QUEBEC', name: 'Bird' }, { region: 'QUEBEC', name: 'McDougall' },
      { region: 'QUEBEC', name: 'Ayers 1' }, { region: 'QUEBEC', name: 'Ayers 2' },
      { region: 'WEST', name: 'Raft Lake' }, { region: 'WEST', name: 'Calm Lake' },
      { region: 'WEST', name: 'Sturgeon Falls' }, { region: 'WEST', name: 'Namakan Lake' },
      { region: 'WEST', name: 'Rainy Lake' }, { region: 'WEST', name: 'Lake of the Woods' },
    ],
    metrics: [
      { key: 'ELEVATION', label: 'Reservoir elevation', unit: 'm' },
      { key: 'INFLOW', label: 'Inflow', unit: 'm³/s' },
      { key: 'OUTFLOW', label: 'Outflow', unit: 'm³/s' },
      { key: 'PRECIPITATION', label: 'Precipitation', unit: 'mm' },
      { key: 'STORAGE', label: 'Storage', unit: 'm³/s·days' },
      { key: 'RULE_CURVE', label: 'Rule curve position', unit: '%' },
      { key: 'GENERATION', label: 'Generation', unit: 'MWh' },
      { key: 'GATE_POSITION', label: 'Gate position', unit: '%' },
      { key: 'FLOW_FORECAST', label: 'Flow forecast', unit: 'm³/s' },
    ],
    qualities: [
      { key: 'VERIFIED', label: 'Verified' }, { key: 'PRELIMINARY', label: 'Preliminary' },
      { key: 'ESTIMATED', label: 'Estimated' }, { key: 'CORRECTED', label: 'Correction record' },
    ],
    sourceTypes: [
      { key: 'HYDROMETRIC', label: 'Hydrometric station' },
      { key: 'MANUAL_READ', label: 'Manual field / control-room read' },
      { key: 'OPERATIONS_REPORT', label: 'Operations report' },
      { key: 'FORECAST', label: 'Forecast source' },
      { key: 'CALCULATED', label: 'Calculated estimate' },
    ],
  };
  const EMPTY_FLOW_SNAPSHOT = {
    updated: null, stale: true, error: null, sources: [], gauges: [],
    notice: 'Read-only source workspace. Awaiting the first server refresh.',
  };
  const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[char]));
  const statusLabel = status => ({
    ok: 'LIVE', stale: 'STALE', partial: 'PARTIAL', error: 'UNAVAILABLE',
    not_configured: 'AWAITING ACCESS', not_reported: 'NOT REPORTED', unavailable: 'UNAVAILABLE'
  }[status] || 'WAITING');
  const statusClass = status => ['ok', 'stale', 'partial', 'error', 'not_configured', 'not_reported', 'unavailable'].includes(status) ? status : 'not_configured';
  const metric = (value, unit) => value === null || value === undefined || value === ''
    ? '—'
    : `${Number(value).toLocaleString('en-CA', { maximumFractionDigits: 3 })} ${unit}`;
  const observedAt = value => {
    if (!value) return 'No current observation';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return escape(value);
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Toronto', month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false
    }).format(date) + ' ET';
  };
  const sourceState = source => statusClass(source?.status);
  const clone = value => JSON.parse(JSON.stringify(value));
  const torontoDate = () => {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Toronto', year: 'numeric', month: '2-digit', day: '2-digit'
    }).formatToParts(new Date());
    const read = type => parts.find(part => part.type === type)?.value || '';
    return `${read('year')}-${read('month')}-${read('day')}`;
  };
  const localDateTimeValue = value => String(value || '').replace('Z', '').slice(0, 16);

  let refreshTimer = 0;
  let currentView = 'inflows';
  let flowPayload = clone(EMPTY_FLOW_SNAPSHOT);
  let catalog = clone(FALLBACK_CATALOG);
  let archiveCatalog = null;
  let dailyReports = [];
  let dailyMessage = '';
  let dailyDraft = freshDailyDraft();
  let waterCatalog = clone(FALLBACK_WATER_CATALOG);
  let waterSummary = { latestReadings: [], records: [], observationsToday: 0, facilitiesMonitored: 0, reviewBandAlerts: 0, staleSeries: 0 };
  let waterMessage = '';
  let waterTrendKey = '';
  let waterDraft = freshWaterDraft();

  function sourceChecklist() {
    return Array.isArray(catalog.sourceChecks) && catalog.sourceChecks.length
      ? catalog.sourceChecks : FALLBACK_CATALOG.sourceChecks;
  }

  function metricCatalog() {
    return Array.isArray(catalog.metrics) && catalog.metrics.length ? catalog.metrics : FALLBACK_CATALOG.metrics;
  }

  function freshDailyDraft() {
    return {
      reportDate: torontoDate(), region: 'EAST', title: 'Daily Operations Report', notes: '',
      sourceChecks: FALLBACK_CATALOG.sourceChecks.map(item => ({ ...item, state: 'NOT REVIEWED', note: '' })),
      metrics: [], validation: null, status: 'DRAFT', version: null, id: null,
    };
  }

  function waterMetrics() {
    return Array.isArray(waterCatalog.metrics) && waterCatalog.metrics.length
      ? waterCatalog.metrics : FALLBACK_WATER_CATALOG.metrics;
  }

  function waterMetric(key) {
    return waterMetrics().find(item => item.key === key) || waterMetrics()[0];
  }

  function freshWaterDraft() {
    const metric = FALLBACK_WATER_CATALOG.metrics[0];
    return {
      region: 'EAST', facility: '', metricType: metric.key, observedAt: localDateTimeValue(new Date().toISOString()),
      value: '', quality: 'PRELIMINARY', sourceType: 'HYDROMETRIC', sourceRef: '',
      reviewBandLow: '', reviewBandHigh: '', notes: '',
    };
  }

  function normalizedChecks(draft) {
    const provided = new Map((Array.isArray(draft.sourceChecks) ? draft.sourceChecks : [])
      .filter(item => item && item.key).map(item => [item.key, item]));
    return sourceChecklist().map(item => ({
      key: item.key, label: item.label,
      state: String(provided.get(item.key)?.state || 'NOT REVIEWED').toUpperCase(),
      note: String(provided.get(item.key)?.note || ''),
    }));
  }

  async function api(path, options = {}) {
    const response = await fetch(path, {
      ...options,
      headers: { Accept: 'application/json', ...(options.headers || {}) },
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || `Request failed (${response.status})`);
    return body;
  }

  function sourceCard(source) {
    const state = sourceState(source);
    const link = source.url
      ? `<a class="flows-source-link" href="${escape(source.url)}" target="_blank" rel="noreferrer">OPEN SOURCE ↗</a>`
      : '';
    return `<article class="flows-source-card">
      <div class="flows-source-top"><div><strong>${escape(source.name)}</strong><small>${source.public ? 'PUBLIC · READ-ONLY' : 'INTERNAL · NOT CONNECTED'}</small></div><span class="flows-source-status ${state}">${statusLabel(state)}</span></div>
      <div class="flows-source-bottom"><div class="flows-source-message">${escape(source.message || (state === 'ok' ? 'Latest source request completed.' : 'No current source status.'))}</div><div>${source.updated ? `<small>Checked ${escape(observedAt(source.updated))}</small>` : ''}${link}</div></div>
    </article>`;
  }

  function gaugeCard(gauge) {
    const state = statusClass(gauge.state);
    const status = state === 'not_reported' && (gauge.waterLevelM !== null || gauge.dischargeM3s !== null) ? 'ok' : state;
    const approval = gauge.approval ? ` · ${escape(gauge.approval)}` : '';
    return `<article class="flows-gauge-card">
      <div class="flows-gauge-top"><div><strong>${escape(gauge.name || gauge.stationId)}</strong><small>${escape(gauge.provider || 'Hydrometric source')} · ${escape(gauge.stationId || '—')}${approval}</small></div><span class="flows-gauge-state ${status}">${statusLabel(status)}</span></div>
      <div class="flows-metrics"><div class="flows-metric"><span>WATER LEVEL</span><b>${metric(gauge.waterLevelM, 'm')}</b></div><div class="flows-metric"><span>DISCHARGE</span><b>${metric(gauge.dischargeM3s, 'm³/s')}</b></div></div>
      <div class="flows-gauge-bottom"><time>${escape(observedAt(gauge.observedAt))}</time><span class="flows-gauge-state ${status}">${status === 'ok' ? 'PRELIMINARY' : statusLabel(status)}</span></div>
    </article>`;
  }

  function viewNav() {
    return `<nav class="flows-view-nav" aria-label="Flows workspace views">
      <button type="button" data-flows-view="inflows" class="${currentView === 'inflows' ? 'active' : ''}">INFLOW OUTLOOK</button>
      <button type="button" data-flows-view="elevations" class="${currentView === 'elevations' ? 'active' : ''}">WEST ELEVATIONS</button>
      <button type="button" data-flows-view="sources" class="${currentView === 'sources' ? 'active' : ''}">LIVE SOURCES</button>
      <button type="button" data-flows-view="water" class="${currentView === 'water' ? 'active' : ''}">WATER LOG</button>
      <button type="button" data-flows-view="daily" class="${currentView === 'daily' ? 'active' : ''}">DAILY OPERATIONS</button>
      <button type="button" data-flows-view="archive" class="${currentView === 'archive' ? 'active' : ''}">IMPORTED ARCHIVE</button>
      <a class="flows-collection-link" href="water-collection.html" target="_blank" rel="noopener">COLLECTION &amp; SCHEDULES ↗</a>
    </nav>`;
  }

  function archiveTopicCard(topic, details) {
    const examples = Array.isArray(details.examples) ? details.examples : [];
    return `<article class="flows-archive-topic"><div><strong>${escape(topic.replaceAll('-', ' ').toUpperCase())}</strong><span>${Number(details.count || 0).toLocaleString('en-CA')} SOURCE RECORDS</span></div><details><summary>SHOW EXAMPLES</summary><ul>${examples.map(item => `<li>${escape(item)}</li>`).join('')}</ul></details></article>`;
  }

  function renderArchive(root) {
    const data = archiveCatalog;
    if (!data) {
      root.innerHTML = `<section class="panel flows-archive-empty"><label>WATER MANAGEMENT · IMPORT</label><h2>Imported archive</h2><p class="muted-note">Loading the source catalog…</p>${viewNav()}</section>`;
      return;
    }
    const extensions = Object.entries(data.extensionCounts || {}).slice(0, 8).map(([name, count]) => `<span><b>${Number(count).toLocaleString('en-CA')}</b> ${escape(name)}</span>`).join('');
    const topics = Object.entries(data.topics || {}).map(([topic, details]) => archiveTopicCard(topic, details)).join('');
    root.innerHTML = `<section class="panel flows-archive-hero"><div><label>WATER MANAGEMENT · IMPORTED SOURCE LAYER</label><h2>Archive inventory</h2><p class="muted-note">${Number(data.entryCount || 0).toLocaleString('en-CA')} source records indexed · ${Number(data.extractedCsvCount || 0).toLocaleString('en-CA')} CSV files extracted for time-series review</p></div><div class="flows-archive-actions"><span class="flows-status-pill ok">READ-ONLY</span><a class="secondary-btn" href="/data/water-management/catalog.json" target="_blank" rel="noreferrer">OPEN CATALOG JSON</a></div>${viewNav()}</section><section class="panel"><div class="flows-module-head"><div><label>WHAT IS AVAILABLE</label><h3>Data backbone</h3><p class="muted-note">The archive is spread by operational topic; examples retain their original source paths.</p></div></div><div class="flows-archive-metrics"><div><span>ARCHIVE RECORDS</span><b>${Number(data.entryCount || 0).toLocaleString('en-CA')}</b></div><div><span>EXTRACTED CSV</span><b>${Number(data.extractedCsvCount || 0).toLocaleString('en-CA')}</b></div><div><span>TOPICS</span><b>${Object.keys(data.topics || {}).length}</b></div></div><div class="flows-extension-list">${extensions}</div></section><section class="panel"><div class="flows-module-head"><div><label>TOPIC INDEX</label><h3>Water / flow / precip / logs</h3></div></div><div class="flows-archive-topics">${topics}</div></section><p class="flows-caution">${escape(data.note || 'Source documents are read-only records. Review and map values before using them in an operational report.')}</p>`;
    window.NorthstarModules?.refresh?.();
  }

  function sourceHeader(payload) {
    const sources = Array.isArray(payload.sources) ? payload.sources : [];
    const liveCount = sources.filter(source => source.public && source.status === 'ok').length;
    const publicCount = sources.filter(source => source.public).length;
    const overall = payload.stale ? 'stale' : (liveCount ? 'ok' : 'not_configured');
    return `<section class="panel flows-hero">
      <div><label>WATER MANAGEMENT · READ-ONLY SOURCES</label><h2>Flows</h2><p class="muted-note">${liveCount}/${publicCount} public sources reporting${payload.updated ? ` · checked ${escape(observedAt(payload.updated))}` : ' · awaiting first source refresh'}</p></div>
      <div class="flows-hero-actions"><span class="flows-status-pill ${overall}">${payload.stale ? 'SOURCE ATTENTION' : liveCount ? 'PUBLIC DATA REPORTING' : 'AWAITING DATA'}</span><button class="secondary-btn" type="button" data-flows-reload>RELOAD DISPLAY</button></div>
      ${viewNav()}
    </section>`;
  }

  function renderSources(root) {
    const payload = flowPayload;
    const sources = Array.isArray(payload.sources) ? payload.sources : [];
    const gauges = Array.isArray(payload.gauges) ? payload.gauges : [];
    const liveCount = sources.filter(source => source.public && source.status === 'ok').length;
    root.innerHTML = `${sourceHeader(payload)}
      <section class="panel"><div class="flows-module-head"><div><label>CURRENT OBSERVATIONS</label><h3>Gauge readings</h3><p class="muted-note">A blank metric means that source did not report that measure.</p></div></div><div class="flows-gauge-grid">${gauges.length ? gauges.map(gaugeCard).join('') : '<div class="muted-note">Waiting for source observations…</div>'}</div></section>
      <section class="panel"><div class="flows-module-head"><div><label>CONNECTION HEALTH</label><h3>Source adapters</h3><p class="muted-note">Public sources are pulled server-side. Private reporting is not contacted until access is configured.</p></div></div><div class="flows-source-list">${sources.map(sourceCard).join('')}</div></section>
      <p class="flows-caution">${escape(payload.notice || 'Read-only display. Do not use this page to operate equipment.')}${payload.error ? ` <span class="flows-error">Source attention: ${escape(payload.error)}.</span>` : ''}</p>`;
    window.watchdogMark?.('flows', !payload.stale && liveCount > 0);
    window.NorthstarModules?.refresh?.();
  }

  function reportStatusClass(status) {
    return status === 'PUBLISHED' ? 'published' : 'draft';
  }

  function dailyReportCard(report) {
    const validation = report.validation || {};
    const count = Array.isArray(report.metrics) ? report.metrics.length : validation.metricCount || 0;
    const exception = Array.isArray(validation.exceptions) && validation.exceptions.length
      ? ` · ${validation.exceptions.length} EXCEPTION${validation.exceptions.length === 1 ? '' : 'S'}` : '';
    return `<article class="daily-report-card">
      <div><strong>${escape(report.reportDate)} · ${escape(report.region)}</strong><small>${escape(report.title || 'Daily Operations Report')} · ${count} METRICS${exception}</small></div>
      <div><span class="daily-status ${reportStatusClass(report.status)}">${escape(report.status)}</span><button type="button" data-daily-open-report="${escape(report.id)}">OPEN</button></div>
    </article>`;
  }

  function optionList(items, selected) {
    return items.map(item => {
      const key = typeof item === 'string' ? item : item.key;
      const label = typeof item === 'string' ? item : item.label;
      return `<option value="${escape(key)}"${key === selected ? ' selected' : ''}>${escape(label)}</option>`;
    }).join('');
  }

  function sourceCheckRow(check, locked) {
    const states = Array.isArray(catalog.sourceStates) && catalog.sourceStates.length
      ? catalog.sourceStates : FALLBACK_CATALOG.sourceStates;
    const disabled = locked ? ' disabled' : '';
    return `<article class="daily-source-check" data-daily-source="${escape(check.key)}">
      <div><strong>${escape(check.label)}</strong><small>Explicit review is required before publication.</small></div>
      <select data-daily-source-state="${escape(check.key)}"${disabled}>${optionList(states, check.state)}</select>
      <input data-daily-source-note="${escape(check.key)}" value="${escape(check.note)}" placeholder="Reason if not applicable or exception"${disabled}>
    </article>`;
  }

  function metricRow(item, index, locked) {
    const disabled = locked ? ' disabled' : '';
    return `<tr data-daily-metric="${index}">
      <td><input data-daily-field="station" value="${escape(item.station)}" placeholder="Station / gauge"${disabled}></td>
      <td><select data-daily-field="metricKey"${disabled}>${optionList(metricCatalog(), item.metricKey)}</select></td>
      <td><input data-daily-field="value" value="${escape(item.value)}" placeholder="Value"${disabled}></td>
      <td><input data-daily-field="unit" value="${escape(item.unit)}" placeholder="Unit"${disabled}></td>
      <td><input data-daily-field="observedAt" value="${escape(localDateTimeValue(item.observedAt))}" type="datetime-local"${disabled}></td>
      <td><input data-daily-field="source" value="${escape(item.source)}" placeholder="Source"${disabled}></td>
      <td><input data-daily-field="sourceRef" value="${escape(item.sourceRef)}" placeholder="Reference"${disabled}></td>
      <td><input data-daily-field="note" value="${escape(item.note)}" placeholder="Note"${disabled}></td>
      <td>${locked ? '—' : `<button type="button" class="daily-remove" data-daily-remove-metric="${index}" aria-label="Remove metric">×</button>`}</td>
    </tr>`;
  }

  function validationPanel(validation) {
    if (!validation) return '<div class="daily-validation pending">SAVE A DRAFT TO RUN SERVER VALIDATION.</div>';
    const errors = Array.isArray(validation.errors) ? validation.errors : [];
    const exceptions = Array.isArray(validation.exceptions) ? validation.exceptions : [];
    const state = validation.ready ? 'ready' : 'blocked';
    return `<div class="daily-validation ${state}"><b>${validation.ready ? 'READY FOR OPERATOR PUBLICATION' : 'VALIDATION NEEDS ATTENTION'}</b><span>${validation.metricCount || 0} METRICS · ${validation.reviewedSourceCount || 0} SOURCES REVIEWED</span>${errors.length ? `<ul>${errors.map(error => `<li>${escape(error)}</li>`).join('')}</ul>` : ''}${exceptions.length ? `<p>EXCEPTIONS RECORDED: ${escape(exceptions.join(', '))}</p>` : ''}</div>`;
  }

  function renderDaily(root) {
    dailyDraft.sourceChecks = normalizedChecks(dailyDraft);
    dailyDraft.metrics = Array.isArray(dailyDraft.metrics) ? dailyDraft.metrics : [];
    const locked = dailyDraft.status === 'PUBLISHED' || dailyDraft.immutable;
    const disabled = locked ? ' disabled' : '';
    const status = locked ? 'PUBLISHED SNAPSHOT · IMMUTABLE' : dailyDraft.id ? 'SAVED DRAFT' : 'NEW LOCAL DRAFT';
    root.innerHTML = `<section class="panel daily-ops-hero">
      <div><label>DAILY OPERATIONS · OPERATOR-ONLY</label><h2>Staged report & immutable snapshot</h2><p class="muted-note">Stage manual or public readings, explicitly review every source, then publish a sealed record. This workspace never sends commands to SCADA or equipment.</p></div>
      <div class="daily-ops-actions"><span class="daily-status ${locked ? 'published' : 'draft'}">${status}</span><button type="button" class="secondary-btn" data-daily-new-report>NEW REPORT</button><button type="button" class="secondary-btn" data-daily-save-report${disabled}>SAVE DRAFT</button><button type="button" class="primary-btn" data-daily-publish-report${disabled}>PUBLISH SNAPSHOT</button></div>
      ${viewNav()}
    </section>
    <section class="daily-ops-layout">
      <div class="daily-ops-main">
        <section class="panel"><form id="dailyOperationsForm" novalidate>
          <div class="daily-form-head"><div><label>REPORT CONTEXT</label><h3>${escape(dailyDraft.title || 'Daily Operations Report')}</h3></div><span>${dailyMessage ? escape(dailyMessage) : 'MANUAL / STAGED INPUTS'}</span></div>
          <div class="daily-context-grid">
            <label>REPORT DATE<input name="reportDate" type="date" value="${escape(dailyDraft.reportDate)}"${disabled}></label>
            <label>REGION<select name="region"${disabled}>${optionList(catalog.regions || FALLBACK_CATALOG.regions, dailyDraft.region)}</select></label>
            <label class="wide">TITLE<input name="title" value="${escape(dailyDraft.title)}"${disabled}></label>
            <label class="wide">OPERATOR NOTES<textarea name="notes" placeholder="State data gaps, assumptions, or handoff context"${disabled}>${escape(dailyDraft.notes)}</textarea></label>
          </div>
          <div class="daily-source-head"><div><label>SOURCE ACCOUNTABILITY</label><p>Do not leave a source implicitly clear. Record a review, an exception, or why it does not apply.</p></div>${locked ? '' : '<button type="button" class="secondary-btn" data-daily-stage-gauges>STAGE LIVE PUBLIC GAUGES</button>'}</div>
          <div class="daily-source-list">${dailyDraft.sourceChecks.map(check => sourceCheckRow(check, locked)).join('')}</div>
          <div class="daily-metrics-head"><div><label>CONTROLLED METRICS</label><p>Station-to-gauge mapping remains explicit; no source value is silently converted into a plant operating value.</p></div>${locked ? '' : '<button type="button" class="secondary-btn" data-daily-add-metric>ADD METRIC</button>'}</div>
          <div class="daily-metric-scroll"><table class="daily-metric-table"><thead><tr><th>STATION / GAUGE</th><th>METRIC</th><th>VALUE</th><th>UNIT</th><th>OBSERVED</th><th>SOURCE</th><th>REFERENCE</th><th>NOTE</th><th></th></tr></thead><tbody>${dailyDraft.metrics.length ? dailyDraft.metrics.map((item, index) => metricRow(item, index, locked)).join('') : '<tr><td colspan="9" class="daily-empty">No staged metrics. Add one manually or stage live public gauges.</td></tr>'}</tbody></table></div>
        </form></section>
        ${validationPanel(dailyDraft.validation)}
        ${locked ? `<section class="panel daily-snapshot-proof"><label>IMMUTABLE SNAPSHOT</label><p>SHA-256 ${escape(dailyDraft.snapshotSha256 || 'NOT AVAILABLE')}</p><small>Published ${escape(observedAt(dailyDraft.publishedAt))} by ${escape(dailyDraft.publishedBy || 'operator')}</small></section>` : ''}
      </div>
      <aside class="daily-report-list panel"><div><label>REPORT REGISTER</label><h3>Recent daily records</h3></div><div>${dailyReports.length ? dailyReports.map(dailyReportCard).join('') : '<p class="muted-note">No daily records have been saved yet.</p>'}</div></aside>
    </section>`;
    window.watchdogMark?.('flows', !flowPayload.stale && (flowPayload.gauges || []).length > 0);
    window.NorthstarModules?.refresh?.();
  }

  function waterSeriesKey(record) {
    return [record.region, record.facility, record.metricType].join('||');
  }

  function waterIsStale(record) {
    const observed = new Date(record?.observedAt || '');
    return Number.isNaN(observed.getTime()) || Date.now() - observed.getTime() > 36 * 60 * 60 * 1000;
  }

  function waterBandClass(record) {
    if (waterIsStale(record)) return 'stale';
    if (record.bandStatus === 'ABOVE REVIEW BAND' || record.bandStatus === 'BELOW REVIEW BAND') return 'attention';
    if (record.bandStatus === 'WITHIN REVIEW BAND') return 'within';
    return 'neutral';
  }

  function waterValue(record) {
    const value = Number(record?.value);
    if (!Number.isFinite(value)) return '—';
    return `${value.toLocaleString('en-CA', { maximumFractionDigits: 3 })} ${escape(record.unit || '')}`;
  }

  function waterTrendChart(records) {
    const series = records.filter(record => Number.isFinite(Number(record.value))).slice(0, 20).reverse();
    if (!series.length) return '<p class="muted-note">Record observations to build a trend. Only recorded source values are plotted.</p>';
    const values = series.map(record => Number(record.value));
    const minimum = Math.min(...values);
    const maximum = Math.max(...values);
    const spread = Math.max(1e-9, maximum - minimum);
    const width = 680;
    const height = 190;
    const left = 44;
    const right = 18;
    const top = 20;
    const bottom = 32;
    const x = index => left + (series.length === 1 ? (width - left - right) / 2 : index * (width - left - right) / (series.length - 1));
    const y = value => top + (maximum - value) / spread * (height - top - bottom);
    const points = values.map((value, index) => `${x(index).toFixed(1)},${y(value).toFixed(1)}`).join(' ');
    const lines = [0, .5, 1].map(fraction => {
      const position = top + fraction * (height - top - bottom);
      const label = (maximum - fraction * spread).toLocaleString('en-CA', { maximumFractionDigits: 3 });
      return `<g><line x1="${left}" y1="${position}" x2="${width - right}" y2="${position}" class="water-trend-grid"></line><text x="2" y="${position + 3}" class="water-trend-axis">${escape(label)}</text></g>`;
    }).join('');
    const dots = values.map((value, index) => `<circle cx="${x(index).toFixed(1)}" cy="${y(value).toFixed(1)}" r="3" class="water-trend-dot"><title>${escape(observedAt(series[index].observedAt))}: ${escape(waterValue(series[index]))}</title></circle>`).join('');
    return `<svg class="water-trend-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="Recorded observation trend">${lines}<polyline points="${points}" class="water-trend-line"></polyline>${dots}<text x="${left}" y="${height - 8}" class="water-trend-axis">EARLIEST</text><text x="${width - right - 48}" y="${height - 8}" class="water-trend-axis">LATEST</text></svg>`;
  }

  function waterLatestCard(record) {
    const key = waterSeriesKey(record);
    const band = record.bandStatus || 'NO REVIEW BAND';
    return `<article class="water-latest-card">
      <div class="water-latest-head"><div><strong>${escape(record.facility)}</strong><small>${escape(record.region)} · ${escape(record.metricLabel || record.metricType)}</small></div><span class="water-band ${waterBandClass(record)}">${escape(waterIsStale(record) ? 'STALE' : band)}</span></div>
      <b>${waterValue(record)}</b>
      <div class="water-latest-meta"><span>${escape(record.quality || '—')} · ${escape(observedAt(record.observedAt))}</span><button type="button" data-water-series="${escape(key)}">VIEW TREND</button></div>
    </article>`;
  }

  function waterRecordRow(record) {
    const band = record.bandStatus || 'NO REVIEW BAND';
    const review = record.reviewBandLow === null || record.reviewBandLow === undefined
      ? '—'
      : `${Number(record.reviewBandLow).toLocaleString('en-CA', { maximumFractionDigits: 3 })}–${Number(record.reviewBandHigh).toLocaleString('en-CA', { maximumFractionDigits: 3 })}`;
    return `<tr><td>${escape(observedAt(record.observedAt))}</td><td><b>${escape(record.region)}</b><br>${escape(record.facility)}</td><td>${escape(record.metricLabel || record.metricType)}</td><td><b>${waterValue(record)}</b></td><td>${escape(record.quality)}</td><td>${escape(band)}</td><td>${escape(review)}</td><td>${escape(record.sourceType)}<br><small>${escape(record.sourceRef)}</small></td></tr>`;
  }

  function renderWater(root) {
    const metric = waterMetric(waterDraft.metricType);
    const facilities = (Array.isArray(waterCatalog.facilities) ? waterCatalog.facilities : FALLBACK_WATER_CATALOG.facilities)
      .filter(item => item.region === waterDraft.region);
    const qualities = Array.isArray(waterCatalog.qualities) && waterCatalog.qualities.length
      ? waterCatalog.qualities : FALLBACK_WATER_CATALOG.qualities;
    const sourceTypes = Array.isArray(waterCatalog.sourceTypes) && waterCatalog.sourceTypes.length
      ? waterCatalog.sourceTypes : FALLBACK_WATER_CATALOG.sourceTypes;
    const records = Array.isArray(waterSummary.records) ? waterSummary.records : [];
    const latestReadings = Array.isArray(waterSummary.latestReadings) ? waterSummary.latestReadings : [];
    const seriesKeys = latestReadings.map(waterSeriesKey);
    if (!waterTrendKey || !seriesKeys.includes(waterTrendKey)) waterTrendKey = seriesKeys[0] || '';
    const trendRecord = latestReadings.find(record => waterSeriesKey(record) === waterTrendKey);
    const trendRecords = records.filter(record => waterSeriesKey(record) === waterTrendKey);
    root.innerHTML = `<section class="panel water-ops-hero">
      <div><label>WATER MANAGEMENT · APPEND-ONLY OBSERVATIONS</label><h2>Hydrology review &amp; trends</h2><p class="muted-note">Record the measurements behind WaterDB and regional graphs with a timestamp, source reference, and stated data quality. Review bands compare recorded values; they never operate gates, SCADA, or plant equipment.</p></div>
      <div class="water-ops-actions"><span class="flows-status-pill ${Number(waterSummary.reviewBandAlerts || 0) ? 'stale' : 'ok'}">${Number(waterSummary.reviewBandAlerts || 0) ? `${waterSummary.reviewBandAlerts} REVIEW ATTENTION` : 'NO REVIEW ALERTS'}</span><button class="secondary-btn" type="button" data-water-reload>REFRESH</button></div>
      ${viewNav()}
    </section>
    <section class="water-summary-grid">
      <article><span>OBSERVATIONS TODAY</span><b>${Number(waterSummary.observationsToday || 0)}</b></article>
      <article><span>FACILITIES MONITORED</span><b>${Number(waterSummary.facilitiesMonitored || 0)}</b></article>
      <article class="${Number(waterSummary.reviewBandAlerts || 0) ? 'attention' : ''}"><span>REVIEW BAND ALERTS</span><b>${Number(waterSummary.reviewBandAlerts || 0)}</b></article>
      <article class="${Number(waterSummary.staleSeries || 0) ? 'attention' : ''}"><span>STALE SERIES</span><b>${Number(waterSummary.staleSeries || 0)}</b></article>
    </section>
    <section class="water-ops-layout">
      <section class="panel"><form id="waterObservationForm" novalidate>
        <div class="water-form-head"><div><label>RECORD A WATER OBSERVATION</label><h3>Controlled regional intake</h3></div><span>${waterMessage ? escape(waterMessage) : 'SOURCE REFERENCE REQUIRED'}</span></div>
        <div class="water-form-grid">
          <label>REGION<select name="region">${optionList(waterCatalog.regions || FALLBACK_WATER_CATALOG.regions, waterDraft.region)}</select></label>
          <label>FACILITY<input name="facility" value="${escape(waterDraft.facility)}" list="waterFacilityOptions" placeholder="Reservoir / station"></label>
          <label>MEASUREMENT<select name="metricType">${optionList(waterMetrics(), waterDraft.metricType)}</select></label>
          <label>OCCURRED AT · ET<input name="observedAt" type="datetime-local" value="${escape(localDateTimeValue(waterDraft.observedAt))}"></label>
          <label>VALUE<input name="value" type="number" step="any" value="${escape(waterDraft.value)}" placeholder="Recorded value"></label>
          <label>UNIT<output>${escape(metric?.unit || '')}</output></label>
          <label>DATA QUALITY<select name="quality">${optionList(qualities, waterDraft.quality)}</select></label>
          <label>SOURCE TYPE<select name="sourceType">${optionList(sourceTypes, waterDraft.sourceType)}</select></label>
          <label class="wide">SOURCE REFERENCE<input name="sourceRef" value="${escape(waterDraft.sourceRef)}" placeholder="Station ID, report ID, or source file reference"></label>
          <label>REVIEW BAND LOW<input name="reviewBandLow" type="number" step="any" value="${escape(waterDraft.reviewBandLow)}" placeholder="Optional"></label>
          <label>REVIEW BAND HIGH<input name="reviewBandHigh" type="number" step="any" value="${escape(waterDraft.reviewBandHigh)}" placeholder="Optional"></label>
          <label class="wide">NOTES<textarea name="notes" placeholder="Context, correction rationale, or data limitation">${escape(waterDraft.notes)}</textarea></label>
        </div>
        <datalist id="waterFacilityOptions">${facilities.map(item => `<option value="${escape(item.name)}"></option>`).join('')}</datalist>
        <p class="water-intake-note">A review band must include both values. Corrections are newly recorded observations; no edit or delete action is available.</p>
        <button type="button" class="primary-btn" data-water-record>RECORD IMMUTABLE OBSERVATION</button>
      </form></section>
      <section class="panel water-trend-panel"><div class="water-trend-head"><div><label>RECORDED TREND</label><h3>${escape(trendRecord ? `${trendRecord.facility} · ${trendRecord.metricLabel || trendRecord.metricType}` : 'Select a series')}</h3></div><select data-water-trend ${latestReadings.length ? '' : 'disabled'}>${latestReadings.length ? latestReadings.map(record => `<option value="${escape(waterSeriesKey(record))}"${waterSeriesKey(record) === waterTrendKey ? ' selected' : ''}>${escape(record.region)} · ${escape(record.facility)} · ${escape(record.metricLabel || record.metricType)}</option>`).join('') : '<option>NO SERIES</option>'}</select></div>
        ${waterTrendChart(trendRecords)}
        ${trendRecord ? `<p class="water-trend-caption">Latest ${escape(waterValue(trendRecord))} · ${escape(observedAt(trendRecord.observedAt))} · ${escape(trendRecord.quality)}</p>` : ''}
      </section>
    </section>
    <section class="panel water-latest-panel"><div class="flows-module-head"><div><label>CURRENT RECORDED VALUES</label><h3>Latest by facility and measurement</h3><p class="muted-note">Source quality and review-band status remain attached to every value.</p></div></div><div class="water-latest-grid">${latestReadings.length ? latestReadings.map(waterLatestCard).join('') : '<p class="muted-note">No water observations have been recorded yet.</p>'}</div></section>
    <section class="panel water-ledger-panel"><div class="flows-module-head"><div><label>APPEND-ONLY LEDGER</label><h3>Recent water observations</h3><p class="muted-note">${records.length} records loaded. The latest record is selected per facility and measurement.</p></div></div><div class="water-ledger-scroll"><table class="water-ledger"><thead><tr><th>OCCURRED</th><th>REGION / FACILITY</th><th>MEASUREMENT</th><th>VALUE</th><th>QUALITY</th><th>REVIEW STATE</th><th>REVIEW BAND</th><th>SOURCE</th></tr></thead><tbody>${records.length ? records.map(waterRecordRow).join('') : '<tr><td colspan="8" class="water-empty">No append-only observations yet.</td></tr>'}</tbody></table></div></section>`;
    window.watchdogMark?.('flows', !flowPayload.stale && (flowPayload.gauges || []).length > 0);
    window.NorthstarModules?.refresh?.();
  }

  function render(root) {
    if (currentView === 'inflows') {
      if(root.querySelector('[data-inflow-frame]')) return;
      root.innerHTML = `<section class="panel"><label>WATER MANAGEMENT / FLOWS</label><h2>Inflow outlook</h2>${viewNav()}</section><iframe data-inflow-frame title="Weather and inflow forecast" src="inflow-outlook.html" style="width:100%;height:1100px;border:0;border-radius:8px;background:#0b1420"></iframe>`;
    }
    else if (currentView === 'elevations') {
      root.innerHTML = `<section class="panel"><label>WATER MANAGEMENT / FLOWS</label><h2>West water elevations</h2>${viewNav()}</section><div data-west-elevations></div>`;
      window.NorthstarWaterElevations?.mount(root.querySelector('[data-west-elevations]'));
      window.NorthstarModules?.refresh?.();
    }
    else if (currentView === 'daily') renderDaily(root);
    else if (currentView === 'water') renderWater(root);
    else if (currentView === 'archive') renderArchive(root);
    else renderSources(root);
  }

  function captureDailyDraft(root) {
    const form = root.querySelector('#dailyOperationsForm');
    if (!form || dailyDraft.status === 'PUBLISHED') return;
    const data = new FormData(form);
    dailyDraft.reportDate = String(data.get('reportDate') || '');
    dailyDraft.region = String(data.get('region') || '');
    dailyDraft.title = String(data.get('title') || '');
    dailyDraft.notes = String(data.get('notes') || '');
    dailyDraft.sourceChecks = sourceChecklist().map(item => ({
      key: item.key, label: item.label,
      state: root.querySelector(`[data-daily-source-state="${CSS.escape(item.key)}"]`)?.value || 'NOT REVIEWED',
      note: root.querySelector(`[data-daily-source-note="${CSS.escape(item.key)}"]`)?.value || '',
    }));
    dailyDraft.metrics = [...root.querySelectorAll('[data-daily-metric]')].map(row => {
      const value = field => row.querySelector(`[data-daily-field="${field}"]`)?.value || '';
      return {
        station: value('station'), metricKey: value('metricKey'), value: value('value'), unit: value('unit'),
        observedAt: value('observedAt'), source: value('source'), sourceRef: value('sourceRef'), note: value('note'),
      };
    });
  }

  function captureWaterDraft(root) {
    const form = root.querySelector('#waterObservationForm');
    if (!form) return;
    const data = new FormData(form);
    waterDraft = {
      region: String(data.get('region') || ''),
      facility: String(data.get('facility') || ''),
      metricType: String(data.get('metricType') || ''),
      observedAt: String(data.get('observedAt') || ''),
      value: String(data.get('value') || ''),
      quality: String(data.get('quality') || ''),
      sourceType: String(data.get('sourceType') || ''),
      sourceRef: String(data.get('sourceRef') || ''),
      reviewBandLow: String(data.get('reviewBandLow') || ''),
      reviewBandHigh: String(data.get('reviewBandHigh') || ''),
      notes: String(data.get('notes') || ''),
    };
  }

  async function refreshWater(preserveMessage = false) {
    try {
      const [nextCatalog, nextSummary] = await Promise.all([
        api('/api/water-observations/catalog'),
        api('/api/water-observations/summary?limit=600'),
      ]);
      waterCatalog = nextCatalog && Array.isArray(nextCatalog.metrics) ? nextCatalog : clone(FALLBACK_WATER_CATALOG);
      waterSummary = nextSummary && typeof nextSummary === 'object'
        ? nextSummary
        : { latestReadings: [], records: [], observationsToday: 0, facilitiesMonitored: 0, reviewBandAlerts: 0, staleSeries: 0 };
    } catch {
      if (!preserveMessage) waterMessage = 'WATER LEDGER UNAVAILABLE · LOCAL INTAKE RETAINED';
    }
  }

  async function recordWaterObservation(root) {
    captureWaterDraft(root);
    waterMessage = 'RECORDING…';
    render(root);
    try {
      const record = await api('/api/water-observations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(waterDraft),
      });
      waterMessage = `RECORDED · ${record.id} · APPEND-ONLY`;
      waterDraft = freshWaterDraft();
      waterTrendKey = waterSeriesKey(record);
      render(root);
      void refreshWater(true).then(() => render(root));
      return;
    } catch (error) {
      waterMessage = `RECORD BLOCKED · ${error.message}`;
    }
    render(root);
  }

  function blankMetric() {
    return { station: '', metricKey: 'water_level', value: '', unit: '', observedAt: '', source: '', sourceRef: '', note: '' };
  }

  function stagePublicGauges(root) {
    captureDailyDraft(root);
    const existing = new Set(dailyDraft.metrics.map(item => `${item.sourceRef}|${item.metricKey}`));
    let added = 0;
    for (const gauge of Array.isArray(flowPayload.gauges) ? flowPayload.gauges : []) {
      if (gauge.state !== 'ok' || !gauge.observedAt) continue;
      const base = { station: gauge.name || gauge.stationId || 'Hydrometric gauge', observedAt: gauge.observedAt, source: gauge.provider || 'Public hydrometric source', sourceRef: gauge.id || gauge.stationId || '', note: 'Staged from read-only public source; operator review required.' };
      for (const item of [
        { metricKey: 'gauge_water_level', value: gauge.waterLevelM, unit: 'm' },
        { metricKey: 'gauge_discharge', value: gauge.dischargeM3s, unit: 'm3/s' },
      ]) {
        const key = `${base.sourceRef}|${item.metricKey}`;
        if (item.value === null || item.value === undefined || item.value === '' || existing.has(key)) continue;
        dailyDraft.metrics.push({ ...base, ...item });
        existing.add(key);
        added += 1;
      }
    }
    dailyMessage = added ? `${added} LIVE PUBLIC METRIC${added === 1 ? '' : 'S'} STAGED · REVIEW REQUIRED` : 'NO CURRENT PUBLIC METRICS AVAILABLE TO STAGE';
    render(root);
  }

  async function refreshReports(preserveMessage = false) {
    try {
      const records = await api('/api/daily-operations?limit=60');
      dailyReports = Array.isArray(records) ? records : [];
    } catch {
      if (!preserveMessage) dailyMessage = 'REPORT REGISTER UNAVAILABLE · LOCAL DRAFT RETAINED';
    }
  }

  async function saveDailyDraft(root) {
    captureDailyDraft(root);
    dailyMessage = 'SAVING…';
    render(root);
    const payload = {
      reportDate: dailyDraft.reportDate, region: dailyDraft.region, title: dailyDraft.title,
      sourceChecks: dailyDraft.sourceChecks, metrics: dailyDraft.metrics, notes: dailyDraft.notes,
    };
    try {
      dailyDraft = dailyDraft.id
        ? await api(`/api/daily-operations/${encodeURIComponent(dailyDraft.id)}/draft`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...payload, version: dailyDraft.version }),
        })
        : await api('/api/daily-operations', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
        });
      dailyMessage = dailyDraft.validation?.ready ? 'DRAFT SAVED · READY FOR PUBLICATION' : 'DRAFT SAVED · VALIDATION NEEDS ATTENTION';
      render(root);
      void refreshReports(true).then(() => render(root));
      return;
    } catch (error) {
      dailyMessage = `SAVE BLOCKED · ${error.message}`;
    }
    render(root);
  }

  async function publishDailyDraft(root) {
    if (!dailyDraft.id) {
      await saveDailyDraft(root);
      if (!dailyDraft.id) return;
    }
    dailyMessage = 'PUBLISHING…';
    render(root);
    try {
      dailyDraft = await api(`/api/daily-operations/${encodeURIComponent(dailyDraft.id)}/publish`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ version: dailyDraft.version }),
      });
      dailyMessage = 'PUBLISHED · IMMUTABLE SNAPSHOT CREATED';
      render(root);
      void refreshReports(true).then(() => render(root));
      return;
    } catch (error) {
      dailyMessage = `PUBLICATION BLOCKED · ${error.message}`;
    }
    render(root);
  }

  async function openDailyReport(root, id) {
    captureDailyDraft(root);
    try {
      dailyDraft = await api(`/api/daily-operations/${encodeURIComponent(id)}`);
      dailyMessage = dailyDraft.immutable ? 'PUBLISHED SNAPSHOT LOADED' : 'DRAFT LOADED';
    } catch (error) {
      dailyMessage = `LOAD BLOCKED · ${error.message}`;
    }
    render(root);
  }

  async function load(root) {
    if (currentView === 'daily') captureDailyDraft(root);
    if (currentView === 'water') captureWaterDraft(root);
    try {
      const response = await fetch(`/api/flows?ts=${Date.now()}`, { headers: { Accept: 'application/json' } });
      if (!response.ok) throw new Error(`flow snapshot unavailable (${response.status})`);
      flowPayload = await response.json();
    } catch {
      flowPayload = { ...clone(EMPTY_FLOW_SNAPSHOT), error: 'Flow source snapshot unavailable.' };
    }
    try {
      const [serverCatalog] = await Promise.all([
        api('/api/daily-operations/catalog'), refreshReports(), refreshWater(true),
      ]);
      if (serverCatalog && Array.isArray(serverCatalog.metrics)) catalog = serverCatalog;
    } catch {
      catalog = clone(FALLBACK_CATALOG);
    }
    try {
      archiveCatalog = await api('/api/water-management/catalog?ts=' + Date.now());
    } catch { archiveCatalog = null; }
    render(root);
    window.clearTimeout(refreshTimer);
    refreshTimer = window.setTimeout(() => load(root), REFRESH_MS);
  }

  function init() {
    const root = document.querySelector('#flowsWorkspace');
    if (!root) return;
    root.addEventListener('click', event => {
      const target = event.target.closest('button');
      if (!target) return;
      if (target.matches('[data-flows-reload]')) load(root);
      else if (target.dataset.flowsView) { captureDailyDraft(root); captureWaterDraft(root); currentView = target.dataset.flowsView; render(root); }
      else if (target.matches('[data-water-reload]')) refreshWater().then(() => render(root));
      else if (target.matches('[data-water-record]')) recordWaterObservation(root);
      else if (target.dataset.waterSeries) { waterTrendKey = target.dataset.waterSeries; render(root); }
      else if (target.matches('[data-daily-new-report]')) { dailyDraft = freshDailyDraft(); dailyMessage = 'NEW LOCAL DRAFT'; render(root); }
      else if (target.matches('[data-daily-stage-gauges]')) stagePublicGauges(root);
      else if (target.matches('[data-daily-add-metric]')) { captureDailyDraft(root); dailyDraft.metrics.push(blankMetric()); dailyMessage = ''; render(root); }
      else if (target.dataset.dailyRemoveMetric !== undefined) { captureDailyDraft(root); dailyDraft.metrics.splice(Number(target.dataset.dailyRemoveMetric), 1); dailyMessage = ''; render(root); }
      else if (target.matches('[data-daily-save-report]')) saveDailyDraft(root);
      else if (target.matches('[data-daily-publish-report]')) publishDailyDraft(root);
      else if (target.dataset.dailyOpenReport) openDailyReport(root, target.dataset.dailyOpenReport);
    });
    root.addEventListener('change', event => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      if (target.matches('#waterObservationForm [name="region"], #waterObservationForm [name="metricType"]')) {
        captureWaterDraft(root);
        render(root);
      } else if (target.matches('[data-water-trend]')) {
        waterTrendKey = target.value;
        render(root);
      }
    });
    const legacyToolLink = document.querySelector('a[href="flows.html"]');
    if (legacyToolLink) {
      legacyToolLink.href = '#flows';
      legacyToolLink.removeAttribute('target');
      legacyToolLink.querySelector('span')?.replaceChildren(document.createTextNode('OPEN'));
    }
    render(root);
    load(root);
    window.NorthstarFlows = { refresh: () => load(root) };
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
