(() => {
  'use strict';

  const client = document.querySelector('#dispatchClient');
  if (!client) return;

  const healthButton = client.querySelector('#dispatchHealth');
  const popover = client.querySelector('#dispatchHealthPopover');
  const headline = client.querySelector('#dispatchMw');
  const deltaNode = client.querySelector('#dispatchDelta');
  const outputNode = client.querySelector('#dispatchOutput');
  const targetNode = client.querySelector('#dispatchTarget');
  const activationNode = client.querySelector('#dispatchActivation');
  const reserveNode = client.querySelector('#dispatchReserve');
  const activationBanner = client.querySelector('#dispatchActivationBanner');
  const iesoIndicator = client.querySelector('#dispatchIesoIndicator');
  const heartbeatIndicator = client.querySelector('#dispatchHeartbeatIndicator');
  const detailNode = client.querySelector('#dispatchHealthDetail');
  const sparkline = client.querySelector('#dispatchSparkline');
  const overview = document.querySelector('#overview');
  let displayed = {};

  const numeric = value => value != null && value !== '' && Number.isFinite(Number(value));
  const mw = value => (numeric(value) ? Number(value).toFixed(1) : '—');
  const reserveMw = value => (numeric(value) ? Number(value).toFixed(0) : '—');

  function setHealthState(kind) {
    if (!healthButton) return;
    healthButton.classList.remove('stale', 'fault');
    if (kind === 'stale') healthButton.classList.add('stale');
    if (kind === 'fault') healthButton.classList.add('fault');
    const label = kind === 'fault'
      ? 'APIROQ dispatch telemetry unavailable'
      : kind === 'stale'
        ? 'APIROQ dispatch telemetry stale'
        : 'APIROQ dispatch telemetry healthy';
    healthButton.setAttribute('aria-label', label);
  }

  function formatDelta(delta, tracking) {
    if (!numeric(delta)) return 'AWAITING TELEMETRY';
    const signed = Number(delta);
    const prefix = signed > 0 ? '+' : '';
    const text = `${prefix}${signed.toFixed(1)} MW vs dispatch`;
    if (tracking === 'on-target') return text;
    if (tracking === 'minor-deviation') return `${text} · MINOR DEVIATION`;
    if (tracking === 'off-target') return `${text} · OFF TARGET`;
    return text;
  }

  function drawSparkline(history) {
    if (!sparkline) return;
    const points = (history || []).filter(
      row => numeric(row.outputMw) && numeric(row.dispatchMw),
    );
    if (points.length < 2) {
      sparkline.innerHTML = '<rect x="0" y="15" width="120" height="1" fill="#29434d"/>';
      return;
    }
    const width = 120;
    const height = 38;
    const padding = 3;
    const values = points.flatMap(row => [Number(row.outputMw), Number(row.dispatchMw)]);
    const min = Math.min(...values) - 1;
    const max = Math.max(...values) + 1;
    const span = Math.max(1, max - min);
    const xAt = index => padding + (index / (points.length - 1)) * (width - padding * 2);
    const yAt = value => height - padding - ((value - min) / span) * (height - padding * 2);
    const line = (field, color) => points.map((row, index) => {
      const prefix = index === 0 ? 'M' : 'L';
      return `${prefix}${xAt(index).toFixed(1)} ${yAt(Number(row[field])).toFixed(1)}`;
    }).join(' ');
    sparkline.innerHTML = `
      <path d="${line('dispatchMw', '#ff9b73')}" fill="none" stroke="#ff9b73" stroke-width="1.6" vector-effect="non-scaling-stroke"/>
      <path d="${line('outputMw', '#58d7b0')}" fill="none" stroke="#58d7b0" stroke-width="1.8" vector-effect="non-scaling-stroke"/>
    `;
  }

  function render(payload) {
    displayed = payload || {};
    const output = payload?.outputMw;
    const target = payload?.dispatchMw;
    const delta = payload?.deltaMw;
    const tracking = payload?.tracking || 'unknown';

    if (headline) {
      headline.textContent = `${numeric(output) ? Number(output).toFixed(1) : '—'} / ${numeric(target) ? Number(target).toFixed(1) : '—'}`;
    }
    if (deltaNode) {
      deltaNode.textContent = formatDelta(delta, tracking);
      deltaNode.className = `dispatch-delta ${tracking}`;
    }
    if (outputNode) outputNode.textContent = mw(output);
    if (targetNode) targetNode.textContent = mw(target);

    const activation = payload?.orActivation;
    if (activationNode) {
      const active = Boolean(activation);
      activationNode.textContent = active ? `${activation} ACTIVE` : 'NOT ACTIVE';
      activationNode.closest('.dispatch-field')?.classList.toggle('active', active);
      client.classList.toggle('or-active', active);
      const activatedAt = payload?.orActivationAt || payload?.orActivatedAt || payload?.orActivationTimestamp;
      const stamp = activatedAt ? new Date(activatedAt) : new Date(payload?.updated || Date.now());
      if (activationBanner) activationBanner.textContent = active
        ? `OR ACTIVATED (${stamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })})`
        : '';
    }

    const reserve = payload?.reserveStandby || {};
    if (reserveNode) {
      reserveNode.innerHTML = `<span><b>10N</b> ${reserveMw(reserve.tenN)}</span><span><b>10S</b> ${reserveMw(reserve.tenS)}</span><span><b>30R</b> ${reserveMw(reserve.thirtyR)}</span>`;
    }

    if (detailNode) {
      const stamp = payload?.updated
        ? new Date(payload.updated).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
        : 'awaiting telemetry';
      const intervalEnd = payload?.dispatchInterval?.end
        ? new Date(payload.dispatchInterval.end).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })
        : null;
      detailNode.textContent = `Last heartbeat: ${stamp}`
        + (intervalEnd ? ` · dispatch valid to ${intervalEnd}` : '');
    }

    const healthy = payload?.healthy !== false && !payload?.stale;
    [iesoIndicator, heartbeatIndicator].forEach(node => {
      if (!node) return;
      node.classList.toggle('online', healthy);
      node.classList.toggle('offline', !healthy);
      node.setAttribute('aria-pressed', String(healthy));
    });

    drawSparkline(payload?.history);

    const validTelemetry = numeric(output) && numeric(target);
    if (!validTelemetry || payload?.healthy === false || payload?.stale) {
      setHealthState(!validTelemetry || payload?.healthy === false ? 'fault' : 'stale');
    } else {
      setHealthState('ok');
    }

    if (typeof setHealth === 'function') {
      setHealth('dispatch', validTelemetry && payload?.healthy !== false && !payload?.stale);
    }
    if (typeof watchdogMark === 'function') {
      watchdogMark('dispatch', validTelemetry && payload?.healthy !== false && !payload?.stale);
    }
  }

  async function load() {
    try {
      const response = await fetch(`/api/dispatch/apiroq?ts=${Date.now()}`, { cache: 'no-store' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      render(await response.json());
    } catch (error) {
      render({
        healthy: false,
        stale: true,
        tracking: 'unknown',
        history: [],
      });
      if (detailNode) detailNode.textContent = `Telemetry unavailable · ${error.message}`;
    }
  }

  if (healthButton && popover) {
    healthButton.addEventListener('click', () => {
      const open = popover.hidden;
      popover.hidden = !open;
      healthButton.setAttribute('aria-expanded', String(open));
    });
    document.addEventListener('click', event => {
      if (!client.contains(event.target)) {
        popover.hidden = true;
        healthButton.setAttribute('aria-expanded', 'false');
      }
    });
  }

  if (overview) {
    const syncVisibility = () => {
      client.hidden = !overview.classList.contains('active');
    };
    syncVisibility();
    new MutationObserver(syncVisibility).observe(overview, { attributes: true, attributeFilter: ['class'] });
  }

  load();
  window.addEventListener('northstar:test-input', event => {
    const test = event.detail || {}, value = Number(test.value);
    if (!['dispatch','standby','activation','generation'].includes(test.type) || !Number.isFinite(value)) return;
    const next = {...displayed, reserveStandby:{...(displayed.reserveStandby || {})}, simulated:true, source:'Browser-local test input', updated:new Date().toISOString(), healthy:true, stale:false};
    if (test.type === 'dispatch') next.dispatchMw = value;
    if (test.type === 'generation') next.outputMw = value;
    if (test.type === 'standby') {
      const product = String(test.target || '').toUpperCase();
      if (product.includes('10N')) next.reserveStandby.tenN = value;
      else if (product.includes('10S')) next.reserveStandby.tenS = value;
      else next.reserveStandby.thirtyR = value;
    }
    if (test.type === 'activation') {
      const product = /10N|10S|30R/.exec(String(test.target || '').toUpperCase());
      next.orActivation = product?.[0] || '10N'; next.orActivationMw = value; next.orActivationAt = next.updated;
    }
    next.deltaMw = Number.isFinite(Number(next.outputMw)) && Number.isFinite(Number(next.dispatchMw)) ? Number(next.outputMw) - Number(next.dispatchMw) : next.deltaMw;
    render(next); window.NorthstarOverview?.update('dispatch', next);
  });
  window.addEventListener('northstar:test-input-clear', () => load());
  setInterval(load, 5000);
})();
