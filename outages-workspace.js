(() => {
  const tabs = [...document.querySelectorAll('[data-outage-tab]')];
  const panes = [...document.querySelectorAll('[data-outage-pane]')];
  const switchingPane = document.querySelector('[data-outage-pane="switching-plans"]');
  if (!tabs.length || !switchingPane) return;

  switchingPane.innerHTML = `<div class="source-truth engineering-outage-link">
    <div class="panel">
      <label>ENGINEERING WORKSPACE</label>
      <h2>Switching plans &amp; one-line drawings</h2>
      <p class="muted-note">Engineering is now a dedicated workspace for one-line drafting, source intake, work packages, qualified-person review, and audit records.</p>
      <button class="primary-btn" type="button" data-open-engineering>OPEN ENGINEERING</button>
    </div>
    <div class="panel">
      <label>SAFETY BOUNDARY</label>
      <h2>Drafting only</h2>
      <p class="muted-note">Engineering records do not issue equipment commands or provide operational release.</p>
    </div>
  </div>`;

  const show = name => {
    tabs.forEach(tab => {
      const active = tab.dataset.outageTab === name;
      tab.classList.toggle('active', active);
      tab.setAttribute('aria-selected', active ? 'true' : 'false');
    });
    panes.forEach(pane => {
      const active = pane.dataset.outagePane === name;
      pane.hidden = !active;
      pane.classList.toggle('active', active);
    });
    if (name === 'uwpc') renderUwpcSource();
  };

  tabs.forEach(tab => tab.addEventListener('click', () => show(tab.dataset.outageTab)));
  document.querySelectorAll('[data-open-outage-tab]').forEach(button => {
    button.addEventListener('click', () => show(button.dataset.openOutageTab));
  });

  switchingPane.querySelector('[data-open-engineering]')?.addEventListener('click', () => {
    document.querySelector('[data-tab="switching"]')?.click();
  });

  const outageList = document.querySelector('#outageList');
  const outageSummary = document.querySelector('#outageSummary');

  function outageMarkup(outage) {
    const severity = String(outage.severity || 'Monitor').toLowerCase();
    const type = String(outage.type || 'Unplanned').toLowerCase() === 'planned' ? 'Planned' : 'Unplanned';
    const asset = outage.asset || outage.title || 'Unspecified asset';
    const title = outage.asset && outage.title ? `${outage.title} · ` : '';
    const close = outage.status === 'Open' && outage.id
      ? `<button class="node-expand outage-close" data-close-outage="${escapeHtml(outage.id)}">CLOSE</button>`
      : '';
    return `<article class="event-item outage-item outage-severity-${severity} outage-type-${type.toLowerCase()}">
      <header><span>${reportTime(outage.openedAt)} · ${escapeHtml(outage.site || '')}</span><span class="outage-badges"><b class="outage-badge ${severity}">${escapeHtml(outage.severity || 'Monitor')}</b><b class="outage-badge ${type.toLowerCase()}">${type.toUpperCase()}</b>${close}</span></header>
      <strong>${escapeHtml(asset)}</strong><p>${escapeHtml(title + (outage.details || ''))}</p>
    </article>`;
  }

  function renderOutageSummary(open) {
    if (!outageSummary) return;
    const cards = [
      ['OPEN', open.length, ''],
      ['CRITICAL', open.filter(outage => outage.severity === 'Critical').length, 'critical'],
      ['DEGRADED', open.filter(outage => outage.severity === 'Degraded').length, 'degraded'],
      ['PLANNED', open.filter(outage => (outage.type || 'Unplanned') === 'Planned').length, 'planned'],
      ['UNPLANNED', open.filter(outage => (outage.type || 'Unplanned') !== 'Planned').length, 'unplanned']
    ];
    outageSummary.innerHTML = cards.map(([label, count, kind]) => `<div class="outage-summary-card ${kind}"><span>${label}</span><b>${count}</b></div>`).join('');
  }

  async function loadOutageRegister() {
    if (!outageList) return;
    try {
      const response = await fetch('/api/outages?ts=' + Date.now());
      if (!response.ok) throw new Error('outage register unavailable');
      const records = await response.json();
      const open = records.filter(outage => outage.status === 'Open');
      outageList.innerHTML = open.map(outageMarkup).join('') || '<div class="muted-note">No open outages.</div>';
      renderOutageSummary(open);
    } catch {
      outageList.innerHTML = '<div class="muted-note">Outage register unavailable.</div>';
      renderOutageSummary([]);
    }
  }

  const outageForm = document.querySelector('#outageForm');
  if (outageForm) {
    outageForm.onsubmit = async event => {
      event.preventDefault();
      const response = await fetch('/api/outages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: document.querySelector('#outageTitle').value,
          asset: document.querySelector('#outageAsset').value,
          site: document.querySelector('#outageSite').value,
          severity: document.querySelector('#outageSeverity').value,
          type: document.querySelector('#outageType').value,
          details: document.querySelector('#outageDetails').value
        })
      });
      if (response.ok) {
        outageForm.reset();
        await loadOutageRegister();
        if (typeof window.loadOps === 'function') window.loadOps();
      }
    };
  }

  const baseLoadOps = window.loadOps;
  if (typeof baseLoadOps === 'function') {
    window.loadOps = async (...args) => {
      await baseLoadOps(...args);
      await loadOutageRegister();
    };
  }
  document.addEventListener('click', event => {
    if (event.target.closest('[data-close-outage]')) setTimeout(loadOutageRegister, 350);
  });
  setTimeout(loadOutageRegister, 500);
  setInterval(loadOutageRegister, 60000);

  function readDraft() {
    try {
      const value = JSON.parse(localStorage.getItem('northstarSwitchingDraftV1') || 'null');
      return value && value.schema === 1 ? value : null;
    } catch {
      return null;
    }
  }

  function renderUwpcSource() {
    const node = document.querySelector('#uwpcSourceSummary');
    if (!node) return;
    const draft = readDraft();
    const sources = Array.isArray(draft?.ruleSources) ? draft.ruleSources : [];
    const fields = [
      ['PACKAGE', draft?.packageName || 'Not configured'],
      ['RULE SET', draft?.ruleSet || 'Not configured'],
      ['SOURCE FILES', sources.length ? sources.map(source => source.name).join(', ') : 'None attached'],
      ['REVIEW STATE', draft?.status || 'DRAFT']
    ];
    node.innerHTML = fields.map(([label, value]) => `<div><b>${label}</b><span>${escapeHtml(value)}</span></div>`).join('');
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value).replace(/[<>&"]/g, character => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[character]));
  }

  function reportTime(value) {
    if (!value) return '—';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString([], { dateStyle: 'short', timeStyle: 'short' });
  }

  function reportLine(outage) {
    const type = outage.type || 'Unplanned';
    const asset = outage.asset || outage.title || 'Unspecified asset';
    return `${reportTime(outage.openedAt)} · ${type.toUpperCase()} · ${outage.severity || 'Monitor'} · ${outage.site || 'Unknown site'} · ${asset}`;
  }

  async function buildReport(kind) {
    const output = document.querySelector('#outageReportOutput');
    if (!output) return;
    output.textContent = 'Loading source records…';
    try {
      const [outages, logs] = await Promise.all([
        fetch('/api/outages?ts=' + Date.now()).then(response => response.json()),
        fetch('/api/logbook?ts=' + Date.now()).then(response => response.json())
      ]);
      const open = outages.filter(outage => outage.status === 'Open');
      const lines = kind === 'history'
        ? outages.map(reportLine)
        : kind === 'shift'
          ? [...open.map(reportLine), ...logs.slice(0, 12).map(log => `${reportTime(log.timestamp)} · LOG · ${log.type || 'Operator action'} · ${log.subject || ''}`)]
          : open.map(reportLine);
      const title = kind === 'history' ? 'OUTAGE HISTORY' : kind === 'shift' ? 'SHIFT IMPACT' : 'CURRENT OUTAGE SUMMARY';
      output.textContent = `${title}\nGenerated ${reportTime(new Date().toISOString())}\n\n${lines.length ? lines.join('\n') : 'No matching source records.'}`;
    } catch {
      output.textContent = 'Source records unavailable. Refresh the dashboard and try again.';
    }
  }

  document.querySelectorAll('[data-outage-report]').forEach(button => {
    button.addEventListener('click', () => buildReport(button.dataset.outageReport));
  });

  show('current');
})();
