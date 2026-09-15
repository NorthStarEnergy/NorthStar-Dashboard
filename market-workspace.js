(() => {
  'use strict';
  if (!document.querySelector('#marketDetail')) return;

  const safe = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
  const money = value => value == null || value === '' || !Number.isFinite(Number(value)) ? '—' : `$${Number(value).toFixed(2)}`;
  const mw = value => value == null || value === '' || !Number.isFinite(Number(value)) ? '— MW' : `${Number(value).toFixed(1)} MW`;
  const time = value => { const date = new Date(value); return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }); };

  const average = values => {
    const finite = values.filter(value => value != null && value !== '').map(Number).filter(Number.isFinite);
    return finite.length ? finite.reduce((total, value) => total + value, 0) / finite.length : null;
  };

  function averageSeries(nodes, primaryField, fallbackField) {
    const byTime = new Map();
    nodes.forEach(node => {
      const points = node?.[primaryField] || node?.[fallbackField] || [];
      points.forEach(point => {
        const value = Number(point.value);
        if (!point.time || point.value == null || point.value === '' || !Number.isFinite(value)) return;
        const values = byTime.get(point.time) || [];
        values.push(value);
        byTime.set(point.time, values);
      });
    });
    return [...byTime.entries()]
      .map(([timeValue, values]) => ({ time: timeValue, value: average(values) }))
      .sort((left, right) => new Date(left.time) - new Date(right.time));
  }

  function buildIesoNode(data = marketData) {
    const nodes = Object.entries(data?.nodes || {}).filter(([key]) => key !== 'IESO').map(([, node]) => node);
    const latest = field => nodes.map(node => node?.[field]).filter(Boolean).sort().at(-1) || data?.updated;
    return {
      rt: average(nodes.map(node => node?.rt)),
      da: average(nodes.map(node => node?.da)),
      rtTimestamp: latest('rtTimestamp'),
      daTimestamp: latest('daTimestamp'),
      history: averageSeries(nodes, 'history'),
      daHistory: averageSeries(nodes, 'daHistory', 'da_history'),
      forward: averageSeries(nodes, 'forward'),
      operations: {
        rtTransfer: data?.ontario?.demand,
        dayAhead: data?.ontario?.forecastDemand,
        source: 'IESO Ontario demand report'
      }
    };
  }

  function ensureIesoMarket(data = marketData) {
    if (!data?.nodes) return;
    data.nodes.IESO = buildIesoNode(data);
    nodeLabels.IESO = 'IESO';
    const buttons = document.querySelector('#nodeButtons');
    if (buttons && !buttons.querySelector('[data-node="IESO"]')) {
      buttons.insertAdjacentHTML('afterbegin', `<button data-node="IESO" class="${selected === 'IESO' ? 'active' : ''}">IESO</button>`);
    }
  }

  const movePrimaryMarketTilesWithoutCompactIeso = movePrimaryMarketTiles;
  movePrimaryMarketTiles = function moveCompactPrimaryMarketTiles() {
    movePrimaryMarketTilesWithoutCompactIeso();
    const tile = document.querySelector('#marketTopTiles [data-module-id="IESO"]');
    if (!tile) return;
    const values = [...tile.querySelectorAll('.ontario-metric b')].map(node => node.textContent.trim());
    const stamp = tile.querySelector('.market-update b')?.textContent.trim() || 'WAITING';
    tile.className = 'node-card featured ieso-tile';
    tile.innerHTML = `<div class="node-head"><div class="node-name">IESO <small class="market-update">${safe(stamp)}</small></div><button class="market-dogear" data-expand="IESO" type="button" title="Open IESO market detail" aria-label="Open IESO market detail"></button></div><div class="node-body"><div class="pricing-column"><div class="price-row"><span>REAL-TIME PRICE</span><span class="row-commit-label">REAL-TIME DEMAND</span><strong>${safe(values[0] || 'â€”')}</strong><b class="row-commit-value">${safe(values[1] || 'â€” MW')}</b></div><div class="price-row"><span>DAY-AHEAD PRICE</span><span class="row-commit-label">DAY-AHEAD DEMAND</span><strong class="near">${safe(values[2] || 'â€”')}</strong><b class="row-commit-value">${safe(values[3] || 'â€” MW')}</b></div></div></div>`;
    tile.querySelector('[data-expand="IESO"]').onclick = () => openNode('IESO');
  };

  function applyCompactPrimaryTileStyle() {
    if (document.querySelector('#compact-primary-market-style')) return;
    const style = document.createElement('style');
    style.id = 'compact-primary-market-style';
    style.textContent = `
      #marketTopTiles .node-card.featured,#marketTopTiles .ontario-market{box-sizing:border-box!important;flex:0 0 240px!important;width:240px!important;min-width:240px!important;height:148px!important;min-height:148px!important;padding:8px!important}
      #marketTopTiles .node-card.featured .node-head{height:19px!important;min-height:19px!important;margin:0 0 4px!important}
      #marketTopTiles .node-card.featured .node-body{display:block!important}
      #marketTopTiles .node-card.featured .pricing-column{overflow:visible!important}
      #marketTopTiles .node-card.featured .price-row{box-sizing:border-box!important;grid-template-columns:minmax(0,1fr) 78px!important;grid-template-rows:9px 18px!important;column-gap:10px!important;row-gap:2px!important;align-content:center!important;height:36px!important;min-height:36px!important;padding:3px 0!important;overflow:visible!important}
      #marketTopTiles .node-card.featured .price-row>span,#marketTopTiles .node-card.featured .row-commit-label{align-self:start!important;height:9px!important;overflow:visible!important;font-size:7px!important;line-height:9px!important;letter-spacing:0!important;text-overflow:clip!important;white-space:nowrap!important}
      #marketTopTiles .node-card.featured .price-row>strong{align-self:start!important;font-size:15px!important;line-height:18px!important;margin-top:0!important}
      #marketTopTiles .node-card.featured .row-commit-label,#marketTopTiles .node-card.featured .row-commit-value{text-align:right!important;padding-right:0!important}
      #marketTopTiles .node-card.featured .row-commit-value{align-self:start!important;font-size:10px!important;line-height:18px!important;margin-top:0!important}
      #marketTopTiles .node-card.featured .or-line{box-sizing:border-box!important;width:100%!important;min-width:0!important;margin-top:6px!important;padding:6px 0 0!important;gap:5px!important}
      #marketTopTiles .node-card.featured .or-item{min-width:0!important;padding:0!important;column-gap:4px!important}
      #marketTopTiles .node-card.featured .or-item span{font-size:7px!important}
      #marketTopTiles .node-card.featured .or-item b{font-size:10px!important}
      #marketTopTiles .ieso-tile .node-name{display:flex!important;align-items:baseline!important;gap:8px!important}
      #marketTopTiles .ieso-tile .market-update{color:var(--muted)!important;font:700 9px/1 monospace!important}
    `;
    document.head.append(style);
  }

  applyCompactPrimaryTileStyle();
  setTimeout(applyCompactPrimaryTileStyle, 0);

  const renderMarketWithoutIeso = renderMarket;
  renderMarket = function renderMarketWithIeso(data) {
    ensureIesoMarket(data);
    renderMarketWithoutIeso(data);
    ensureIesoMarket(data);
  };

  const openNodeWithoutIeso = openNode;
  openNode = function openNodeWithIeso(key) {
    if (window.NorthstarModules?.registry.has("markets:"+key)) { window.NorthstarModules.open("markets:"+key); return; }
    ensureIesoMarket();
    openNodeWithoutIeso(key);
    ensureIesoMarket();
    document.querySelectorAll('#nodeButtons [data-node]').forEach(button => button.classList.toggle('active', button.dataset.node === key));
    requestAnimationFrame(drawGraph);
  };

  ensureIesoMarket();

  document.addEventListener('click', event => {
    const button = event.target.closest('#nodeButtons [data-node]');
    if (!button) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    selected = button.dataset.node;
    document.querySelectorAll('#nodeButtons [data-node]').forEach(nodeButton => nodeButton.classList.toggle('active', nodeButton.dataset.node === selected));
    drawGraph();
    openNode(selected);
  }, true);

  function seriesRows(node) {
    const rows = [
      ...(Array.isArray(node.history) ? node.history.map(point => ({ ...point, kind: 'RT HISTORY' })) : []),
      ...(Array.isArray(node.daHistory) ? node.daHistory.map(point => ({ ...point, kind: 'DA HISTORY' })) : []),
      ...(Array.isArray(node.forward) ? node.forward.map(point => ({ ...point, kind: 'DA FORWARD' })) : [])
    ].filter(point => point.value != null && point.value !== '' && Number.isFinite(Number(point.value))).slice(-36);
    if (!rows.length) return '<div class="muted-note">No price series is available for this node.</div>';
    const values = rows.map(point => Math.abs(Number(point.value)));
    const maximum = Math.max(1, ...values);
    return rows.map(point => `<div class="market-series-row ${point.kind.includes('HISTORY') ? 'history' : ''}"><span>${safe(point.kind)}<br>${safe(time(point.time))}</span><i style="width:${Math.max(2, Math.abs(Number(point.value)) / maximum * 100)}%"></i><b>${money(point.value)}</b></div>`).join('');
  }

  function reserveHtml(node) {
    const reserve = node.reserve;
    if (!reserve) return '';
    const values = [
      ['RT 10S', reserve.tenS], ['RT 10N', reserve.tenN], ['RT 30R', reserve.thirtyR],
      ['DA 10S', reserve.daTenS], ['DA 10N', reserve.daTenN], ['DA 30R', reserve.daThirtyR]
    ];
    return `<section class="market-detail-section"><h3>OPERATING RESERVE PRICES</h3><div class="reserve-grid">${values.map(([label, value]) => `<div><span>${label}</span><b>${money(value)}</b></div>`).join('')}</div></section>`;
  }

  renderNodeDetail = function renderCompletedNodeDetail(key, target) {
    const node = marketData?.nodes?.[key] || {};
    const operations = node.operations || {};
    const setting = alertSettings[key] || {};
    const isIeso = key === 'IESO';
    const detail = target || document.querySelector('#marketDetail');
    const control = id => detail.querySelector('[data-market-control="'+id+'"]');
    detail.innerHTML = `
      <div class="market-head"><div><label>${isIeso ? 'IESO MARKET DETAIL' : 'IESO NODE DETAIL'}</label><h2>${safe(nodeLabels[key] || key)}</h2></div><button class="node-expand" id="backOverview">← OVERVIEW</button></div>
      <div class="market-detail-summary">
        <div class="market-detail-metric"><span>REAL-TIME PRICE</span><strong class="${priceClass(node.rt, node.da)}">${money(node.rt)}</strong><small>${safe(time(node.rtTimestamp))}</small></div>
        <div class="market-detail-metric"><span>DAY-AHEAD PRICE</span><strong>${money(node.da)}</strong><small>${safe(time(node.daTimestamp))}</small></div>
        <div class="market-detail-metric"><span>${isIeso ? 'REAL-TIME DEMAND' : 'REAL-TIME TRANSFER'}</span><strong>${mw(operations.rtTransfer)}</strong><small>${safe(operations.source || 'Feed pending')}</small></div>
        <div class="market-detail-metric"><span>${isIeso ? 'DAY-AHEAD DEMAND' : 'DAY-AHEAD SCHEDULE'}</span><strong>${mw(operations.dayAhead)}</strong><small>${safe(operations.source || 'Feed pending')}</small></div>
      </div>
      ${reserveHtml(node)}
      <section class="market-detail-section"><h3>PRICE SERIES</h3><div class="market-series">${seriesRows(node)}</div></section>
      ${isIeso ? '<p class="market-detail-note">Provincial pricing is calculated from the currently reported IESO nodes. Demand values come from the IESO Ontario demand report.</p>' : `<div class="alert-settings"><div class="alert-settings-head"><h3>PRICING ALERTS</h3><label class="alert-enabled"><input id="alertEnabled" type="checkbox" ${setting.enabled !== false ? 'checked' : ''}> ALERT ENABLED</label></div><div class="alert-grid"><label>LOW THRESHOLD ($/MWh)<input id="alertLow" type="number" step="0.01" placeholder="e.g. 20.00" value="${safe(setting.low ?? '')}"></label><label>HIGH THRESHOLD ($/MWh)<input id="alertHigh" type="number" step="0.01" placeholder="e.g. 100.00" value="${safe(setting.high ?? '')}"></label></div><div class="alert-actions">${alertActionsHtml(setting.actions)}</div><button class="primary-btn" id="saveAlertSettings" type="button">SAVE ALERT SETTINGS</button><div class="saved-note" id="alertSaved">${setting.updatedAt ? `${setting.enabled === false ? 'DISABLED' : 'ACTIVE'} · SAVED ${opsTime(setting.updatedAt)}` : 'NOT CONFIGURED'}</div><div id="alertBanner"></div><p class="muted-note">Email and text actions activate only when their delivery connectors are available.</p></div>`}`;
    detail.querySelectorAll('[id]').forEach(el => {
      el.dataset.marketControl = el.id;
      if (detail.id !== 'marketDetail') el.id = detail.id + '-' + el.id;
    });
    control('backOverview').onclick = () => document.querySelector('[data-tab="overview"]')?.click();
    const saveButton = control('saveAlertSettings');
    if (saveButton) saveButton.onclick = async () => {
      const actions = [...detail.querySelectorAll('input[name="alertAction"]:checked')].map(input => input.value);
      const enabled = control('alertEnabled').checked;
      const body = { node: key, low: control('alertLow').value === '' ? null : Number(control('alertLow').value), high: control('alertHigh').value === '' ? null : Number(control('alertHigh').value), actions, enabled };
      const saved = control('alertSaved');
      saveButton.disabled = true;
      saved.textContent = 'SAVING…';
      try {
        const response = await fetch('/api/alerts/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        if (!response.ok) throw new Error(response.status === 400 ? 'LOW MUST BE BELOW HIGH' : 'SETTINGS SERVICE UNAVAILABLE');
        alertSettings[key] = await response.json();
        saved.textContent = `${enabled ? 'ACTIVE' : 'DISABLED'} · SAVED ${opsTime(alertSettings[key].updatedAt)}`;
        loadAlerts();
      } catch (error) {
        saved.textContent = `NOT SAVED · ${error.message}`;
      } finally {
        saveButton.disabled = false;
      }
    };
    if (detail.id === "marketDetail") renderNodeBanner(key);
  };
  window.NorthstarMarketModules = {render: (key,target) => renderNodeDetail(key,target), data: () => marketData};
})();
