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
  const detailNode = client.querySelector('#dispatchHealthDetail');
  const sparkline = client.querySelector('#dispatchSparkline');
  const overview = document.querySelector('#overview');

  const mw = value => (Number.isFinite(Number(value)) ? `${Number(value).toFixed(1)} MW` : '— MW');
  const reserveMw = value => (Number.isFinite(Number(value)) ? Number(value).toFixed(0) : '—');

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
    if (!Number.isFinite(Number(delta))) return 'AWAITING TELEMETRY';
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
      row => Number.isFinite(Number(row.outputMw)) && Number.isFinite(Number(row.dispatchMw)),
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
    const output = payload?.outputMw;
    const target = payload?.dispatchMw;
    const delta = payload?.deltaMw;
    const tracking = payload?.tracking || 'unknown';

    if (headline) {
      headline.innerHTML = `<span class="dispatch-output-value">${Number.isFinite(Number(output)) ? Number(output).toFixed(1) : '—'}</span>`
        + ' / '
        + `<span class="dispatch-target-value">${Number.isFinite(Number(target)) ? Number(target).toFixed(1) : '—'}</span> MW`;
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
    }

    const reserve = payload?.reserveStandby || {};
    if (reserveNode) {
      reserveNode.textContent = `${reserveMw(reserve.tenS)}S / ${reserveMw(reserve.tenN)}N / ${reserveMw(reserve.thirtyR)}R MW`;
    }

    if (detailNode) {
      const stamp = payload?.updated
        ? new Date(payload.updated).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
        : 'awaiting telemetry';
      const source = payload?.simulated ? 'IESO-style simulated feed' : (payload?.source || 'telemetry');
      const intervalEnd = payload?.dispatchInterval?.end
        ? new Date(payload.dispatchInterval.end).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })
        : null;
      detailNode.textContent = `Last telemetry: ${stamp} · ${source}`
        + (intervalEnd ? ` · dispatch valid to ${intervalEnd}` : '');
    }

    drawSparkline(payload?.history);

    if (payload?.healthy === false || payload?.stale) {
      setHealthState(payload?.healthy === false ? 'fault' : 'stale');
    } else {
      setHealthState('ok');
    }

    if (typeof setHealth === 'function') {
      setHealth('dispatch', payload?.healthy !== false && !payload?.stale);
    }
    if (typeof watchdogMark === 'function') {
      watchdogMark('dispatch', payload?.healthy !== false && !payload?.stale);
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
  setInterval(load, 5000);
})();
