(() => {
  'use strict';

  const REFRESH_MS = 120000;
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
  let refreshTimer = 0;

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

  function render(root, payload) {
    const sources = Array.isArray(payload.sources) ? payload.sources : [];
    const gauges = Array.isArray(payload.gauges) ? payload.gauges : [];
    const liveCount = sources.filter(source => source.public && source.status === 'ok').length;
    const publicCount = sources.filter(source => source.public).length;
    const overall = payload.stale ? 'stale' : (liveCount ? 'ok' : 'not_configured');
    root.innerHTML = `<section class="panel flows-hero" data-module-id="flow-status">
      <div><label>WATER MANAGEMENT · READ-ONLY SOURCES</label><h2>Flows</h2><p class="muted-note" id="flowsSummary">${liveCount}/${publicCount} public sources reporting${payload.updated ? ` · checked ${escape(observedAt(payload.updated))}` : ' · awaiting first source refresh'}</p></div>
      <div class="flows-hero-actions"><span class="flows-status-pill ${overall}" id="flowsOverall">${payload.stale ? 'SOURCE ATTENTION' : liveCount ? 'PUBLIC DATA REPORTING' : 'AWAITING DATA'}</span><button class="secondary-btn" type="button" data-flows-reload>RELOAD DISPLAY</button></div>
    </section>
    <section class="panel" data-module-id="flow-gauges"><div class="flows-module-head"><div><label>CURRENT OBSERVATIONS</label><h3>Gauge readings</h3><p class="muted-note">A blank metric means that source did not report that measure.</p></div></div><div class="flows-gauge-grid">${gauges.length ? gauges.map(gaugeCard).join('') : '<div class="muted-note">Waiting for source observations…</div>'}</div></section>
    <section class="panel" data-module-id="flow-sources"><div class="flows-module-head"><div><label>CONNECTION HEALTH</label><h3>Source adapters</h3><p class="muted-note">Public sources are pulled server-side. Private reporting is not contacted until access is configured.</p></div></div><div class="flows-source-list">${sources.map(sourceCard).join('')}</div></section>
    <p class="flows-caution" data-module-id="flow-notice">${escape(payload.notice || 'Read-only display. Do not use this page to operate equipment.')}${payload.error ? ` <span class="flows-error">Source attention: ${escape(payload.error)}.</span>` : ''}</p>`;
    window.watchdogMark?.('flows', !payload.stale && liveCount > 0);
    window.NorthstarModules?.refresh?.();
  }

  function renderError(root) {
    root.innerHTML = `<section class="panel flows-hero" data-module-id="flow-status"><div><label>WATER MANAGEMENT · READ-ONLY SOURCES</label><h2>Flows</h2><p class="muted-note flows-error">The source snapshot is unavailable. Existing readings are not replaced with estimates.</p></div><div class="flows-hero-actions"><span class="flows-status-pill error">DISPLAY UNAVAILABLE</span><button class="secondary-btn" type="button" data-flows-reload>RETRY DISPLAY</button></div></section>`;
    window.watchdogMark?.('flows', false);
    window.NorthstarModules?.refresh?.();
  }

  async function load(root) {
    try {
      const response = await fetch(`/api/flows?ts=${Date.now()}`, { headers: { Accept: 'application/json' } });
      if (!response.ok) throw new Error(`flow snapshot unavailable (${response.status})`);
      render(root, await response.json());
    } catch {
      renderError(root);
    } finally {
      window.clearTimeout(refreshTimer);
      refreshTimer = window.setTimeout(() => load(root), REFRESH_MS);
    }
  }

  function init() {
    const root = document.querySelector('#flowsWorkspace');
    if (!root) return;
    root.addEventListener('click', event => {
      if (event.target.closest('[data-flows-reload]')) load(root);
    });
    const legacyToolLink = document.querySelector('a[href="flows.html"]');
    if (legacyToolLink) {
      legacyToolLink.href = '#flows';
      legacyToolLink.removeAttribute('target');
      legacyToolLink.querySelector('span')?.replaceChildren(document.createTextNode('OPEN'));
    }
    render(root, {
      updated: null,
      stale: true,
      error: null,
      sources: [],
      gauges: [],
      notice: 'Read-only source workspace. Awaiting the first server refresh.',
    });
    load(root);
    window.NorthstarFlows = { refresh: () => load(root) };
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
