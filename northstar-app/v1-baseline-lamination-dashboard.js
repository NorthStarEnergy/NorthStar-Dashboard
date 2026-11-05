(() => {
  'use strict';
  const root = document.querySelector('#laminationSimulator');
  if (!root) return;

  const query = selector => root.querySelector(selector);
  const fields = {
    max: '#lamMaxCapacity', da: '#lamDaCleared', lmp: '#lamDaLmp',
    must: '#lamMustRun', water: '#lamWaterValue', spike: '#lamSpikeThreshold', rt: '#lamRtPrice'
  };
  const fieldInfo = {
    max: ['Unit max capacity', 'The unit’s maximum available output. This sets the chart’s total MW scale.'],
    da: ['DA cleared position', 'The MW quantity cleared in the day-ahead market. Real-time deviations settle against this position.'],
    lmp: ['DA LMP', 'The day-ahead locational marginal price used to calculate locked market revenue.'],
    must: ['Environmental minimum', 'The minimum output required for environmental, hydraulic, or operating conditions.'],
    water: ['Water value', 'The estimated future value of stored water. Below this RT price, the scenario buys back generation and ponds water.'],
    spike: ['Spike threshold', 'The RT price at which the scenario dispatches available capacity above the day-ahead position.'],
    rt: ['Scenario RT LMP', 'The real-time price used for this what-if. Move it across the thresholds to compare ponding, hold, and spike dispatch.']
  };
  const number = key => Number(query(fields[key]).value);
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const money = value => {
    const sign = value < 0 ? '−' : '';
    return `${sign}$${Math.abs(value).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  };

  function addFieldHelp() {
    for (const [key, selector] of Object.entries(fields)) {
      const input = query(selector);
      const label = input?.closest('.lamination-field');
      const textNode = label ? [...label.childNodes].find(node => node.nodeType === Node.TEXT_NODE && node.textContent.trim()) : null;
      if (!label || !textNode) continue;
      const [title, detail] = fieldInfo[key];
      const copy = document.createElement('span');
      const name = document.createElement('span');
      const button = document.createElement('button');
      const popup = document.createElement('span');
      const popupId = `lamInfo${key}`;
      copy.className = 'lamination-field-copy';
      name.className = 'lamination-field-name';
      name.textContent = textNode.textContent.trim();
      button.type = 'button';
      button.className = 'lamination-info-button';
      button.textContent = 'i';
      button.setAttribute('aria-label', `About ${title}`);
      button.setAttribute('aria-expanded', 'false');
      button.setAttribute('aria-controls', popupId);
      popup.id = popupId;
      popup.className = 'lamination-info-popup';
      popup.hidden = true;
      popup.setAttribute('role', 'tooltip');
      popup.innerHTML = `<strong>${title}</strong>${detail}`;
      button.onclick = event => {
        event.preventDefault();
        event.stopPropagation();
        const willOpen = popup.hidden;
        root.querySelectorAll('.lamination-info-popup').forEach(item => { item.hidden = true; });
        root.querySelectorAll('.lamination-info-button').forEach(item => item.setAttribute('aria-expanded', 'false'));
        popup.hidden = !willOpen;
        button.setAttribute('aria-expanded', String(willOpen));
      };
      textNode.remove();
      copy.append(name, button, popup);
      label.prepend(copy);
    }
    document.addEventListener('click', event => {
      if (event.target.closest('.lamination-info-popup')) return;
      root.querySelectorAll('.lamination-info-popup').forEach(item => { item.hidden = true; });
      root.querySelectorAll('.lamination-info-button').forEach(item => item.setAttribute('aria-expanded', 'false'));
    });
    document.addEventListener('keydown', event => {
      if (event.key !== 'Escape') return;
      root.querySelectorAll('.lamination-info-popup').forEach(item => { item.hidden = true; });
      root.querySelectorAll('.lamination-info-button').forEach(item => item.setAttribute('aria-expanded', 'false'));
    });
  }

  function setLiveState(message, kind = '') {
    let element = query('#lamLiveState');
    if (!element) {
      element = document.createElement('div');
      element.id = 'lamLiveState';
      element.className = 'lamination-live-state';
      element.setAttribute('role', 'status');
      query('.lamination-actions')?.after(element);
    }
    element.className = `lamination-live-state ${kind}`.trim();
    element.textContent = message;
  }

  function normalizeInputs() {
    const maxInput = query(fields.max);
    const daInput = query(fields.da);
    const mustInput = query(fields.must);
    const max = clamp(Number(maxInput.value) || 1, 1, 1000);
    const da = clamp(Number(daInput.value) || 0, 0, max);
    const must = clamp(Number(mustInput.value) || 0, 0, da);
    maxInput.value = max;
    daInput.max = max;
    daInput.value = da;
    mustInput.max = da;
    mustInput.value = must;
    return { max, da, must };
  }

  function render() {
    const { max, da, must } = normalizeInputs();
    const lmp = Number.isFinite(number('lmp')) ? number('lmp') : 0;
    const water = number('water');
    const spike = number('spike');
    const rt = number('rt');
    const status = query('#laminationStatus');

    for (const key of Object.keys(fields)) {
      const input = query(fields[key]);
      const output = query(`${fields[key]}Out`);
      if (output) output.textContent = input.type === 'range' ? `${money(number(key))}/MWh` : number(key).toFixed(1);
    }

    if (spike <= water) {
      status.dataset.zone = 'invalid';
      status.textContent = 'INVALID SCENARIO · SPIKE THRESHOLD MUST EXCEED WATER VALUE';
      query('#laminationSvg').innerHTML = '';
      return;
    }

    const damRevenue = da * lmp;
    let dispatch = da;
    let zone = 'SCHEDULED / HOLD';
    let zoneKey = 'hold';
    if (rt < water) {
      dispatch = must;
      zone = 'PONDING / BUY-BACK';
      zoneKey = 'ponding';
    } else if (rt >= spike) {
      dispatch = max;
      zone = 'SPIKE CAPTURE';
      zoneKey = 'spike';
    }
    const settlement = (dispatch - da) * rt;
    const net = damRevenue + settlement;
    const ponded = Math.max(0, da - dispatch);

    status.dataset.zone = zoneKey;
    status.textContent = `${zone} · DISPATCH TARGET ${dispatch.toFixed(1)} MW · APIROQ RT ${money(rt)}/MWh`;
    query('#lamDam').textContent = money(damRevenue);
    query('#lamSettlement').textContent = money(settlement);
    query('#lamNet').textContent = money(net);
    query('#lamSaved').textContent = `${ponded.toFixed(1)} MW`;
    query('#lamSettlementDetail').textContent = dispatch < da ? 'RT buy-back deviation' : dispatch > da ? 'RT incremental generation' : 'No RT deviation';
    query('#lamSavedDetail').textContent = ponded ? 'Held for later dispatch' : 'No water ponded';

    const x0 = 102;
    const width = 820;
    const bottom = 345;
    const top = 42;
    const minPrice = Math.floor((Math.min(0, rt, water) - 25) / 25) * 25;
    const maxPrice = Math.ceil((Math.max(spike, rt, water) + 25) / 25) * 25;
    const y = value => bottom - ((value - minPrice) / (maxPrice - minPrice)) * (bottom - top);
    const floorY = y(minPrice);
    const waterY = y(water);
    const spikeY = y(spike);
    const priceY = y(rt);
    const mustX = x0 + (must / max) * width;
    const daX = x0 + (da / max) * width;
    const dispatchX = x0 + (dispatch / max) * width;
    const svg = query('#laminationSvg');
    svg.setAttribute('viewBox', '0 0 1000 430');
    svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
    const ticks = [...new Set([minPrice, water, spike, maxPrice])].sort((a, b) => a - b);
    const grid = ticks.map(value => `<line x1="${x0}" y1="${y(value)}" x2="${x0 + width}" y2="${y(value)}" stroke="#293943" stroke-dasharray="3 5"/><text x="${x0 - 12}" y="${y(value) + 4}" class="grid-label" text-anchor="end">${value.toFixed(0)}</text>`).join('');
    svg.innerHTML = `
      ${grid}
      <rect x="${x0}" y="${waterY}" width="${Math.max(0, mustX - x0)}" height="${Math.max(0, floorY - waterY)}" fill="#4b9ac2"/>
      <rect x="${mustX}" y="${waterY}" width="${Math.max(0, daX - mustX)}" height="${Math.max(0, floorY - waterY)}" fill="#d7a63e"/>
      <rect x="${daX}" y="${spikeY}" width="${Math.max(0, x0 + width - daX)}" height="${Math.max(0, waterY - spikeY)}" fill="#9d62c7"/>
      <path d="M${x0},${floorY} H${mustX} V${waterY} H${daX} V${spikeY} H${x0 + width}" fill="none" stroke="#fff" stroke-width="2"/>
      <line x1="${x0}" y1="${priceY}" x2="${x0 + width}" y2="${priceY}" stroke="#ff7169" stroke-width="2" stroke-dasharray="7 5"/>
      <circle cx="${dispatchX}" cy="${priceY}" r="6" fill="#ff7169" stroke="#fff"/>
      <text x="${x0 - 12}" y="${waterY - 7}" class="threshold-label" text-anchor="end">WATER</text>
      <text x="${x0 - 12}" y="${spikeY - 7}" class="threshold-label" text-anchor="end">SPIKE</text>
      <text x="${x0 + 8}" y="${floorY - 14}" class="block-label" text-anchor="start">MUST-RUN ${must.toFixed(0)} MW</text>
      <text x="${mustX + Math.max(20, (daX - mustX) / 2)}" y="${waterY - 10}" class="block-label">PONDING ${Math.max(0, da - must).toFixed(0)} MW</text>
      <text x="${daX + Math.max(20, (x0 + width - daX) / 2)}" y="${spikeY + 18}" class="block-label">SPIKE ${Math.max(0, max - da).toFixed(0)} MW</text>
      <text x="${x0 + width - 8}" y="${priceY - 9}" class="dispatch-label" text-anchor="end">RT PRICE ${money(rt)}/MWh</text>
      <text x="${Math.min(x0 + width - 78, Math.max(x0 + 8, dispatchX + 10))}" y="${priceY + 18}" class="dispatch-label">TARGET ${dispatch.toFixed(1)} MW</text>
      <text x="${x0}" y="${bottom + 22}" class="axis-label">0 MW</text>
      <text x="${x0 + width}" y="${bottom + 22}" class="axis-label" text-anchor="end">${max.toFixed(0)} MW</text>
      <text x="${x0 + width / 2}" y="${bottom + 54}" class="axis-title" text-anchor="middle">DISPATCH / AVAILABLE CAPACITY (MW)</text>
      <text x="24" y="${top + (bottom - top) / 2}" class="axis-title" text-anchor="middle" transform="rotate(-90 24 ${top + (bottom - top) / 2})">PRICE ($/MWh)</text>`;
  }

  addFieldHelp();
  const legendLabels = ['Environmental minimum', 'Ponding / buy-back range', 'Spike dispatch range', 'Scenario RT price'];
  query('.lamination-legend')?.querySelectorAll('span').forEach((item, index) => { item.textContent = legendLabels[index]; });
  for (const selector of Object.values(fields)) query(selector).addEventListener('input', render);
  query('#lamUseLive').onclick = async event => {
    const button = event.currentTarget;
    button.disabled = true;
    setLiveState('Loading current APIROQ price…');
    try {
      const response = await fetch('/api/market-prices?ts=' + Date.now());
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = await response.json();
      const value = Number(payload.nodes?.APIROQ?.rt);
      if (!Number.isFinite(value)) throw new Error('No current APIROQ price');
      query(fields.rt).value = clamp(value, -50, 500);
      setLiveState(`LIVE APIROQ ${money(value)}/MWh · ${payload.updated ? (window.NorthstarIesoTime ? NorthstarIesoTime.clock(payload.updated) : new Date(payload.updated).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: 'America/Toronto' })) : 'CURRENT'}`, 'ok');
      render();
    } catch {
      setLiveState('LIVE PRICE UNAVAILABLE · SCENARIO VALUE RETAINED', 'error');
    } finally {
      button.disabled = false;
    }
  };
  query('#lamReset').onclick = () => {
    const defaults = { max: 80, da: 50, lmp: 40, must: 5, water: 25, spike: 150, rt: 15 };
    for (const [key, value] of Object.entries(defaults)) query(fields[key]).value = value;
    setLiveState('Scenario reset to defaults');
    render();
  };
  render();
})();
