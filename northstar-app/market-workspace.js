(() => {
  'use strict';
  if (!document.querySelector('#marketDetail')) return;

  const safe = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
  const money = value => value == null || value === '' || !Number.isFinite(Number(value)) ? '—' : `$${Number(value).toFixed(2)}`;
  const mw = value => value == null || value === '' || !Number.isFinite(Number(value)) ? '— MW' : `${Number(value).toFixed(1)} MW`;
  const time = value => {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '—';
    return window.NorthstarIesoTime
      ? NorthstarIesoTime.shortDateTime(value)
      : date.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: 'America/Toronto' });
  };

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
      rtForecast: averageSeries(nodes, 'rtForecast', 'rt_forecast'),
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
    addHydroQuebecTile();
    const apiroq = document.querySelector('#marketTopTiles [data-module-id="APIROQ"]');
    const apiroqRows = apiroq?.querySelectorAll('.price-row');
    if (apiroqRows?.length >= 2 && marketData?.ontario) {
      const formatDemand = value => value == null || !Number.isFinite(Number(value)) ? '— MW' : `${Math.round(Number(value)).toLocaleString()} MW`;
      const demand = formatDemand(marketData.ontario.demand);
      const forecast = formatDemand(marketData.ontario.forecastDemand);
      apiroqRows[0].querySelector('.row-commit-value').textContent = demand;
      apiroqRows[1].querySelector('.row-commit-value').textContent = forecast;
    }
    const tile = document.querySelector('#marketTopTiles [data-module-id="IESO"]');
    if (!tile) return;
    const values = [...tile.querySelectorAll('.ontario-metric b')].map(node => node.textContent.trim());
    const stamp = tile.querySelector('.market-update b')?.textContent.trim() || 'WAITING';
    tile.className = 'node-card featured ieso-tile';
    tile.innerHTML = `<div class="node-head"><div class="node-name">IESO <small class="market-update">${safe(stamp)}</small></div></div><div class="node-body"><div class="pricing-column"><div class="price-row"><span>REAL-TIME PRICE</span><span class="row-commit-label">REAL-TIME DEMAND</span><strong>${safe(values[0] || '—')}</strong><b class="row-commit-value">${safe(values[1] || '— MW')}</b></div><div class="price-row"><span>DAY-AHEAD PRICE</span><span class="row-commit-label">DEMAND FORECAST</span><strong class="near">${safe(values[2] || '—')}</strong><b class="row-commit-value">${safe(values[3] || '— MW')}</b></div></div></div>`;
  };

  async function loadHydroQuebecSummary() {
    const tile = document.querySelector('#marketTopTiles [data-module-id="HYDRO_QUEBEC"]');
    if (!tile) return;
    const endpoint = 'https://hydroquebec.aws-ec2-ca-central-1.opendatasoft.com/api/explore/v2.1/catalog/datasets/importations-exportations-avec-transits/records?limit=1&order_by=date%20desc';
    try {
      const response = await fetch(endpoint, { cache: 'no-store' });
      if (!response.ok) throw new Error('Feed unavailable');
      const payload = await response.json();
      const row = payload.results?.[0] || {};
      const data = [['Exports total', row.exportationstotal], ['Exports to Ontario', row.exportationsontario], ['Exports to New York', row.exportationsnewyork], ['Exports to New England', row.exportationsnewengland], ['Exports to New Brunswick', row.exportationsnewbrunswick], ['Imports from Ontario', row.importationssourcesontariototal], ['Imports from New York', row.importationssourcesnewyorktotal], ['Imports from New England', row.importationssourcesnewenglandtotal], ['Imports from New Brunswick', row.importationssourcesnewbrunswicktotal]].filter(([, value]) => value != null && Number.isFinite(Number(value)));
      const detail = data.map(([key, value]) => `${key} ${Number(value).toLocaleString()} MW`).join(' · ');
      tile.querySelector('.hydro-values').textContent = detail || 'Hourly exchange data unavailable';
      tile.querySelector('.market-update').textContent = row.date ? `HOURLY · ${time(row.date)}` : 'HOURLY DATA';
      window.NorthstarHydroQuebec = {
        updatedAt: row.date || null,
        metrics: data.map(([label, value]) => ({ label, value: `${Number(value).toLocaleString()} MW` }))
      };
      window.dispatchEvent(new Event('northstar:market-extra-update'));
    } catch (_) {
      tile.querySelector('.hydro-values').textContent = 'Open hourly exchange data unavailable';
      tile.querySelector('.market-update').textContent = 'FEED UNAVAILABLE';
      window.NorthstarHydroQuebec = { updatedAt: null, metrics: [] };
      window.dispatchEvent(new Event('northstar:market-extra-update'));
    }
  }

  function addHydroQuebecTile() {
    const host = document.querySelector('#marketTopTiles');
    if (!host || host.querySelector('[data-module-id="HYDRO_QUEBEC"]')) return;
    const tile = document.createElement('article');
    tile.className = 'node-card featured hydro-quebec-tile';
    tile.dataset.moduleId = 'HYDRO_QUEBEC';
    tile.innerHTML = '<div class="node-head"><div class="node-name">HYDRO-QUÉBEC <small class="market-update">LOADING</small></div></div><div class="node-body"><div class="hydro-values">Loading hourly exchange data…</div><small class="hydro-note">REAL-TIME EXCHANGE · MW · NO PUBLIC RT PRICE</small></div>';
    host.append(tile);
    loadHydroQuebecSummary();
  }
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
      #marketTopTiles .node-card.featured .price-row>span,#marketTopTiles .node-card.featured .row-commit-label{align-self:start!important;height:9px!important;overflow:visible!important;font-size:calc(7px * var(--ns-font-scale, 1))!important;line-height:9px!important;letter-spacing:0!important;text-overflow:clip!important;white-space:nowrap!important}
      #marketTopTiles .node-card.featured .price-row>strong{align-self:start!important;font-size:calc(15px * var(--ns-font-scale, 1))!important;line-height:18px!important;margin-top:0!important}
      #marketTopTiles .node-card.featured .row-commit-label,#marketTopTiles .node-card.featured .row-commit-value{text-align:right!important;padding-right:0!important}
      #marketTopTiles .node-card.featured .row-commit-value{align-self:start!important;font-size:calc(10px * var(--ns-font-scale, 1))!important;line-height:18px!important;margin-top:0!important}
      #marketTopTiles .node-card.featured .or-line{box-sizing:border-box!important;width:100%!important;min-width:0!important;margin-top:6px!important;padding:6px 0 0!important;gap:5px!important}
      #marketTopTiles .node-card.featured .or-item{min-width:0!important;padding:0!important;column-gap:4px!important}
      #marketTopTiles .node-card.featured .or-item span{color:#a7ceb8!important;font:700 calc(14px * var(--ns-font-scale, 1)) Arial,sans-serif!important}
      #marketTopTiles .node-card.featured .or-item b{color:#fff!important;font:700 calc(14px * var(--ns-font-scale, 1)) monospace!important}
      #marketTopTiles .ieso-tile .node-name{display:flex!important;align-items:baseline!important;gap:8px!important}
      #marketTopTiles .ieso-tile .market-update{color:var(--muted)!important;font:700 calc(9px * var(--ns-font-scale, 1))/1 monospace!important}
    `;
    document.head.append(style);
  }

  addHydroQuebecTile();  applyCompactPrimaryTileStyle();
  setTimeout(applyCompactPrimaryTileStyle, 0);

  const renderMarketWithoutIeso = renderMarket;
  let liveNode = 'IESO';
  let marketAlarmRules = {};
  renderMarket = function renderMarketWithIeso(data) {
    ensureIesoMarket(data);
    renderMarketWithoutIeso(data);
    ensureIesoMarket(data);
    document.querySelectorAll('.market-trend-host[data-market-node]').forEach(host => mountTrend(host, host.dataset.marketNode));
    renderOverviewMarketMini();
    const detail = document.querySelector('#marketDetail');
    if (!detail.contains(document.activeElement)) renderNodeDetail(liveNode);
    renderMarketAlarmModule();
  };

  const openNodeWithoutIeso = openNode;
  openNode = function openNodeWithIeso(key) {
    liveNode = key;
    if (window.NorthstarModules?.registry.has('markets:live')) { window.NorthstarModules.open('markets:live'); return; }
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

  async function refreshTrendData() {
    const response = await fetchNorthstar('/api/market-prices?ts=' + Date.now());
    if (!response.ok) throw new Error('Market feed unavailable');
    renderMarket(await response.json());
  }

  let liveArchiveRequest = null;
  let liveArchiveSnapshots = null;
  function combinedLiveMarketData() {
    if (!liveArchiveSnapshots) return marketData || { nodes: {} };
    const combined = { historical: true, liveWindow: true, updated: marketData?.updated || new Date().toISOString(), nodes: {}, ontario: marketData?.ontario || {} };
    for (const snapshot of liveArchiveSnapshots) for (const [key, node] of Object.entries(snapshot.nodes || {})) {
      const target = combined.nodes[key] ||= { history: [], daHistory: [], forward: [], rtForecast: [] };
      for (const field of ['history', 'daHistory']) target[field].push(...(node[field] || []));
    }
    for (const [key, node] of Object.entries(marketData?.nodes || {})) {
      const target = combined.nodes[key] ||= { history: [], daHistory: [], forward: [] };
      for (const field of ['history', 'daHistory']) target[field] = [...(target[field] || []), ...(node[field] || [])];
      target.forward = node.forward || [];
      target.rtForecast = node.rtForecast || node.rt_forecast || [];
      for (const field of ['rt', 'da', 'rtTimestamp', 'daTimestamp']) if (node[field] != null) target[field] = node[field];
    }
    return combined;
  }
  function mountOverviewTrend(host, key, data = combinedLiveMarketData(), height = 220, mode = 'price') {
    const node = data.nodes?.[key] || {};
    const now = Date.parse(mode === 'demand' ? data.updated : node.rtTimestamp) || Date.now();
    const liveWindow = { ...data, liveWindow: true, windowAnchor: now };
    if (mode === 'demand' && Number.isFinite(Number(data.ontario?.demand))) {
      liveWindow.ontario = { ...data.ontario, demandCurrent: { time: new Date(now).toISOString(), value: Number(data.ontario.demand) } };
    }
    window.NorthstarMarketTrends?.mount(host, liveWindow, key, refreshTrendData, { mode, kinds: mode === 'demand' ? ['demand', 'demandForecast'] : ['rt', 'da', 'forward', 'rtForecast'], compact: true, legendInside: true, height, scale: host.closest('#overviewMarketMini')?.dataset.marketValueScale || 'auto', symmetricWindowHours: Number(host.closest('#overviewMarketMini')?.dataset.marketWindowHours || 8) / 2, overviewWindow: true, currentPrices: mode === 'price' ? { time: now, rt: node.rt, da: node.da } : null });
  }
  function renderOverviewMarketMini() {
    const card = document.querySelector('#overviewMarketMini');
    if (!card || window.NORTHSTAR_DEMO_HOME || !marketData?.nodes) return;
    if (!card.dataset.graphJumpBound) {
      card.dataset.graphJumpBound = 'true';
      const settings = card.querySelector('[data-market-settings]');
      const dialog = card.querySelector('.overview-market-scale');
      const form = dialog.querySelector('form');
      const fields = form.elements;
      const updateCustom = () => {
        const custom = fields.preset.value === 'custom';
        form.querySelector('[data-custom-hours]').hidden = !custom;
        fields.hours.disabled = !custom;
      };
      settings.addEventListener('click', () => {
        const hours = Number(card.dataset.marketWindowHours || 8);
        fields.view.value = card.dataset.marketGraphMode || 'price';
        fields.scale.value = card.dataset.marketValueScale || 'auto';
        fields.preset.value = [4,8,12,24].includes(hours) ? String(hours) : 'custom';
        fields.hours.value = String(hours);
        updateCustom();
        dialog.showModal();
      });
      card.querySelector('[data-market-demand]').addEventListener('click', () => {
        card.dataset.marketGraphMode = card.dataset.marketGraphMode === 'demand' ? 'price' : 'demand';
        renderOverviewMarketMini();
      });
      fields.preset.addEventListener('change', updateCustom);
      form.querySelector('[data-scale-cancel]').addEventListener('click', () => dialog.close());
      form.addEventListener('submit', event => {
        event.preventDefault();
        if (!form.reportValidity()) return;
        const hours = Number(fields.preset.value === 'custom' ? fields.hours.value : fields.preset.value);
        if (!Number.isInteger(hours) || hours < 1 || hours > 168) return;
        card.dataset.marketWindowHours = String(hours);
        card.dataset.marketGraphMode = fields.view.value;
        card.dataset.marketValueScale = fields.scale.value;
        renderOverviewMarketMini();
        dialog.close();
      });
      card.querySelector('.overview-market-mini-chart')?.addEventListener('click', event => {
        if (document.body.classList.contains('layout-edit')) return;
        event.preventDefault(); event.stopPropagation();
        window.NorthstarModules?.open('markets:historical');
      });
    }
    const host = card.querySelector('.overview-market-mini-chart');
    const selected = marketData.nodes.IESO ? 'IESO' : (Object.keys(marketData.nodes).find(key => key !== 'IESO') || 'APIROQ');
    const mode = card.dataset.marketGraphMode === 'demand' ? 'demand' : 'price';
    card.querySelector('[data-market-demand]').setAttribute('aria-pressed', String(mode === 'demand'));
    mountOverviewTrend(host, selected, undefined, 155, mode);
    loadLivePriceHistory().then(data => { if (data && host.isConnected) mountOverviewTrend(host, selected, data, 155, card.dataset.marketGraphMode === 'demand' ? 'demand' : 'price'); });
  }
  async function loadLivePriceHistory() {
    if (liveArchiveSnapshots) return combinedLiveMarketData();
    if (liveArchiveRequest) return liveArchiveRequest;
    const eastern = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Toronto', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
    const part = key => eastern.find(value => value.type === key)?.value;
    const today = `${part('year')}-${part('month')}-${part('day')}`;
    const end = new Date(Date.parse(today + 'T00:00:00Z'));
    const days = [...Array.from({ length: 3 }, (_, index) => new Date(end.getTime() - (2 - index) * 86400000).toISOString().slice(0, 10)), today];
    liveArchiveRequest = (async () => {
      const snapshots = [], failures = [];
      for (const day of days) {
        try {
          const response = await fetchNorthstar('/api/market-history?date=' + encodeURIComponent(day), { cache: 'no-store' });
          if (!response.ok) throw new Error('Archive unavailable');
          snapshots.push(await response.json());
        } catch (_) { failures.push(day); }
      }
      if (!snapshots.length) throw new Error(failures.join(' · ') || 'IESO price archive unavailable');
      liveArchiveSnapshots = snapshots;
      const combined = combinedLiveMarketData();
      document.querySelectorAll('.market-home-trend-host').forEach(host => mountTrend(host, host.dataset.marketNode || 'IESO', combined));
      document.querySelectorAll('.demo-market-trend-host').forEach(host => mountOverviewTrend(host, host.dataset.marketNode || 'APIROQ', combined));
      document.querySelectorAll('.market-home-note').forEach(note => { note.textContent = `Loaded IESO price history for ${snapshots.map(snapshot => snapshot.reportDate).join(', ')}${failures.length ? ` · Missing: ${failures.join(' · ')}` : ''}. Current prices and forward prices continue to use the live feed.`; });
      return combined;
    })().catch(error => {
      document.querySelectorAll('.market-home-note').forEach(note => { note.textContent = `Recent IESO archive history unavailable · ${error.message}. Showing current feed readings.`; });
      document.querySelectorAll('.demo-market-note').forEach(note => { note.textContent = 'Recent IESO history unavailable · showing current feed readings.'; });
    }).finally(() => { liveArchiveRequest = null; });
    return liveArchiveRequest;
  }

  function mountTrend(host, key, data = marketData || {}) {
    const live = marketData?.nodes?.IESO || {};
    const demand = host.dataset.marketMode === 'demand';
    window.NorthstarMarketTrends?.mount(host, data, key, refreshTrendData, host.classList.contains('market-home-trend-host') ? {
      identity: host.dataset.marketTrendId,
      mode: demand ? 'demand' : 'price',
      kinds: demand ? ['demand', 'demandForecast'] : ['rt', 'da', 'forward', 'rtForecast'],
      currentPrices: demand ? null : { time: Date.now(), rt: live.rt, da: live.da }
    } : {});
  }

  drawGraph = function drawMarketComparison() {
    const canvas = document.querySelector('#priceGraph');
    if (!canvas) return;
    canvas.hidden = true;
    let host = canvas.parentElement.querySelector('.market-trend-host');
    if (!host) {
      host = document.createElement('div');
      host.className = 'market-trend-host';
      canvas.before(host);
    }
    mountTrend(host, selected);
    const title = document.querySelector('#graphTitle');
    if (title) title.textContent = (nodeLabels[selected] || selected) + ' · Market trends';
  };

  function reserveHtml(node) {
    const reserve = node.reserve;
    if (!reserve) return '';
    const values = [
      ['RT 10S', reserve.tenS], ['RT 10N', reserve.tenN], ['RT 30R', reserve.thirtyR],
      ['DA 10S', reserve.daTenS], ['DA 10N', reserve.daTenN], ['DA 30R', reserve.daThirtyR]
    ];
    return `<section class="market-detail-section"><h3>OPERATING RESERVE PRICES</h3><div class="reserve-grid">${values.map(([label, value]) => `<div><span>${label}</span><b>${money(value)}</b></div>`).join('')}</div></section>`;
  }

  function marketHomeHtml(node) {
    const advisoryFeed = marketData?.advisories || {};
    const notices = (advisoryFeed.notices || []).slice().sort((a, b) =>
      (a.relevance === 'general') - (b.relevance === 'general') || String(b.issued || '').localeCompare(String(a.issued || ''))).slice(0, 250);
    const advisoryStatus = advisoryFeed.stale ? 'Feed unavailable or incomplete; last received notices shown.' :
      `Updated ${time(advisoryFeed.updated)} · ${notices.length} notices shown`;
    const advisoryRows = notices.map(notice => {
      const url = /^https:\/\/(?:www\.)?ieso\.ca\//i.test(notice.url || '') ? notice.url : '';
      const label = notice.relevance === 'site' ? `SITE · ${(notice.matches || []).join(', ')}` : notice.relevance === 'system' ? 'SYSTEM' : 'GENERAL';
      return `<article class="ieso-advisory ${safe(notice.relevance)}"><div><b>${safe(label)}</b><span>${safe(notice.level || 'Notice')} · ${safe(notice.feed)} · ${safe(time(notice.issued))}</span></div><h3>${safe(notice.title)}</h3><p>${safe(notice.description)}</p>${url ? `<a href="${safe(url)}" target="_blank" rel="noopener noreferrer">View IESO notice ↗</a>` : ''}</article>`;
    }).join('');
    return `<section class="market-home" aria-label="Live market price outlook">
      <div class="market-home-chart-shell"><div class="market-home-chart-head"><div><span>LIVE PRICE OUTLOOK</span><h2>Market price trend</h2></div><button type="button" data-open-historical>OPEN HISTORICAL</button></div>
        <div class="market-trend-host market-home-trend-host" data-market-node="IESO" data-market-trend-id="market-live-price"></div>
        <p class="market-home-note">Historical RT price is yellow, DA price is blue, future DA is light blue, and the market pricing forecast is light yellow. Use the chart controls to adjust the time window, reading resolution, and price scale.</p>
      </div>
      <div class="market-home-chart-shell market-home-demand-shell"><div class="market-home-chart-head"><div><span>LIVE DEMAND OUTLOOK</span><h2>Ontario demand trend</h2></div></div>
        <div class="market-trend-host market-home-trend-host" data-market-node="IESO" data-market-mode="demand" data-market-trend-id="market-live-demand"></div>
        <p class="market-home-note">Current Ontario demand is green. The dashed purple line is the IESO forecast demand.</p>
      </div><section class="market-home-advisories" aria-label="IESO advisory notices"><div class="market-home-chart-head"><div><span>IESO ADVISORY NOTICES</span><h2>System and site notices</h2></div></div><p class="market-home-note">${safe(advisoryStatus)} · Site and system matches appear first. Review the source notice before acting.</p><div class="ieso-advisory-list">${advisoryRows || '<p class="market-home-note">No notices received from IESO yet.</p>'}</div></section></section>`;
  }

  renderNodeDetail = function renderCompletedNodeDetail(key, target) {
    const node = marketData?.nodes?.[key] || {};
    const operations = node.operations || {};
    const setting = alertSettings[key] || {};
    const isIeso = key === 'IESO';
    const detail = target || document.querySelector('#marketDetail');
    detail.querySelectorAll('.market-trend-host').forEach(host => window.NorthstarMarketTrends?.unmount(host));
    const control = id => detail.querySelector('[data-market-control="'+id+'"]');
    detail.innerHTML = `${isIeso ? marketHomeHtml(node) : `
      <div class="market-head"><div><label>LIVE · CURRENT MARKET DATA${marketData?.stale ? ' · STALE SNAPSHOT' : ''}</label><h2>${safe(nodeLabels[key] || key)}</h2></div><label>Location <select data-live-node aria-label="Live market location">${[...new Set(['IESO', ...Object.keys(marketData?.nodes || {})])].map(code => `<option value="${safe(code)}" ${code === key ? 'selected' : ''}>${safe(nodeLabels[code] || code)}</option>`).join('')}</select></label><button class="node-expand" id="backOverview">← OVERVIEW</button></div>
      <div class="market-detail-summary">
        <div class="market-detail-metric"><span>REAL-TIME PRICE</span><strong class="${priceClass(node.rt, node.da)}">${money(node.rt)}</strong><small>${safe(time(node.rtTimestamp))}</small></div>
        <div class="market-detail-metric"><span>DAY-AHEAD PRICE</span><strong>${money(node.da)}</strong><small>${safe(time(node.daTimestamp))}</small></div>
        <div class="market-detail-metric"><span>${isIeso ? 'REAL-TIME DEMAND' : 'REAL-TIME TRANSFER'}</span><strong>${mw(operations.rtTransfer)}</strong><small>${safe(operations.source || 'Feed pending')}</small></div>
        <div class="market-detail-metric"><span>${isIeso ? 'DEMAND FORECAST' /* DAY-AHEAD DEMAND */ : 'DAY-AHEAD SCHEDULE'}</span><strong>${mw(operations.dayAhead)}</strong><small>${safe(operations.source || 'Feed pending')}</small></div>
      </div>${reserveHtml(node)}<p class="market-detail-note">Graphs, data exports and price scenarios are available in <button type="button" data-open-historical>Historical</button>.</p><div class="alert-settings"><div class="alert-settings-head"><h3>PRICING ALERTS</h3><label class="alert-enabled"><input id="alertEnabled" type="checkbox" ${setting.enabled !== false ? 'checked' : ''}> ALERT ENABLED</label></div><div class="alert-grid"><label>LOW THRESHOLD ($/MWh)<input id="alertLow" type="number" step="0.01" placeholder="e.g. 20.00" value="${safe(setting.low ?? '')}"></label><label>HIGH THRESHOLD ($/MWh)<input id="alertHigh" type="number" step="0.01" placeholder="e.g. 100.00" value="${safe(setting.high ?? '')}"></label></div><div class="alert-actions">${alertActionsHtml(setting.actions)}</div><button class="primary-btn" id="saveAlertSettings" type="button">SAVE ALERT SETTINGS</button><div class="saved-note" id="alertSaved">${setting.updatedAt ? `${setting.enabled === false ? 'DISABLED' : 'ACTIVE'} · SAVED ${opsTime(setting.updatedAt)}` : 'NOT CONFIGURED'}</div><div id="alertBanner"></div><p class="muted-note">Email and text actions activate only when their delivery connectors are available.</p></div>`}`;
    detail.querySelector('[data-live-node]')?.addEventListener('change', event => { liveNode = event.target.value; renderNodeDetail(liveNode); });
    detail.querySelector('[data-open-historical]')?.addEventListener('click', () => { selected = key; window.NorthstarModules?.open('markets:historical'); });
    detail.querySelectorAll('.market-trend-host[data-market-node]').forEach(host => mountTrend(host, host.dataset.marketNode));
    if (detail.id === 'marketDetail' && isIeso) loadLivePriceHistory();
    detail.querySelectorAll('[id]').forEach(el => {
      el.dataset.marketControl = el.id;
      if (detail.id !== 'marketDetail') el.id = detail.id + '-' + el.id;
    });
    if (control('backOverview')) control('backOverview').onclick = () => document.querySelector('[data-tab="overview"]')?.click();
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

  const alarmLevels = [
    ['advisory', 'Level 1 · Advisory'],
    ['caution', 'Level 2 · Caution'],
    ['warning', 'Level 3 · Warning'],
    ['critical', 'Level 4 · Critical']
  ];
  const alarmMetricOrder = ['generation_price', 'reserve_10s', 'reserve_10n', 'reserve_30r', 'demand_gap', 'price_gap'];
  function alarmLevelOptions(selected) {
    return alarmLevels.map(([value, label]) => `<option value="${value}" ${selected === value ? 'selected' : ''}>${label}</option>`).join('');
  }
  function marketAlarmValue(metric) {
    const nodes = Object.entries(marketData?.nodes || {}).filter(([key]) => key !== 'IESO').map(([, node]) => node);
    const rt = average(nodes.map(node => node?.rt));
    const da = average(nodes.map(node => node?.da));
    const reserve = marketData?.nodes?.APIROQ?.reserve || {};
    const values = {
      generation_price: rt,
      reserve_10s: reserve.tenS,
      reserve_10n: reserve.tenN,
      reserve_30r: reserve.thirtyR,
      demand_gap: Number.isFinite(Number(marketData?.ontario?.demand)) && Number.isFinite(Number(marketData?.ontario?.forecastDemand)) ? Math.abs(Number(marketData.ontario.demand) - Number(marketData.ontario.forecastDemand)) : null,
      price_gap: rt != null && da != null ? Math.abs(rt - da) : null
    };
    return values[metric];
  }
  function renderMarketAlarmModule() {
    const host = document.querySelector('#marketAlarms');
    if (!host) return;
    if (!Object.keys(marketAlarmRules).length) { host.innerHTML = '<div class="placeholder">Loading market alarm settings…</div>'; return; }
    const cards = alarmMetricOrder.map(metric => {
      const rule = marketAlarmRules[metric];
      if (!rule) return '';
      const value = marketAlarmValue(metric);
      const valueText = value == null ? '—' : `${rule.kind === 'gap' && metric === 'demand_gap' ? Math.round(value).toLocaleString() + ' MW' : '$' + Number(value).toFixed(2)}`;
      const controls = rule.kind === 'price'
        ? `<label>Low<input name="low" type="number" step="0.01" value="${safe(rule.low ?? '')}" placeholder="Unset"></label><label>High<input name="high" type="number" step="0.01" value="${safe(rule.high ?? '')}" placeholder="Unset"></label>`
        : `<label>First alarm<input name="primaryThreshold" type="number" min="0.01" step="0.01" value="${safe(rule.primaryThreshold)}"></label><label>Escalation<input name="secondaryThreshold" type="number" min="0.01" step="0.01" value="${safe(rule.secondaryThreshold)}"></label>`;
      return `<form class="market-alarm-rule" data-market-alarm-rule="${safe(metric)}"><header><div><span>${safe(rule.kind === 'price' ? 'PRICING ALARM' : 'DIFFERENCE ALARM')}</span><h3>${safe(rule.label)}</h3></div><strong>${safe(valueText)}</strong></header><div class="market-alarm-fields">${controls}<label>Alert level<select name="level">${alarmLevelOptions(rule.level)}</select></label><label class="market-alarm-enabled"><input name="enabled" type="checkbox" ${rule.enabled ? 'checked' : ''}> Enabled</label></div><footer><span>${rule.kind === 'gap' ? 'Latched until recovery · second alarm only at escalation · maximum once per hour' : 'High and low limits latch until price recovery · dashboard sound enabled'}</span><button type="submit">Save</button></footer><p class="market-alarm-save" role="status">${rule.lastTriggeredAt ? `Last alarm ${safe(time(rule.lastTriggeredAt))}` : 'No alarm recorded'}</p></form>`;
    }).join('');
    host.innerHTML = `<div class="market-alarm-workspace"><header class="market-alarm-page-head"><div><span>MARKETS · ALARMS</span><h2>Market alarm settings</h2><p>Price and difference alarms are written to the Event Log and request the dashboard alarm sound.</p></div><div class="market-alarm-levels"><b>4 LEVELS</b><span>Advisory · Caution · Warning · Critical</span></div></header><section><h3>Pricing alarms</h3><div class="market-alarm-grid">${cards}</div></section></div>`;
    const forms = alarmMetricOrder.map(metric => host.querySelector(`[data-market-alarm-rule="${metric}"]`)).filter(Boolean);
    const pricing = forms.filter(form => marketAlarmRules[form.dataset.marketAlarmRule].kind === 'price');
    const differences = forms.filter(form => marketAlarmRules[form.dataset.marketAlarmRule].kind === 'gap');
    const workspace = host.querySelector('.market-alarm-workspace');
    workspace.querySelector('.market-alarm-grid').replaceChildren(...pricing);
    const differenceSection = document.createElement('section');
    differenceSection.innerHTML = '<h3>Difference alarms</h3><p class="market-alarm-policy">Demand: 1,000 MW then 2,000 MW. RT/DA price: $20 then $40. A continuing first-stage condition does not repeat.</p><div class="market-alarm-grid market-alarm-grid-two"></div>';
    differenceSection.querySelector('.market-alarm-grid').append(...differences); workspace.append(differenceSection);
  }
  async function loadMarketAlarmRules() {
    const response = await fetch('/api/market-alarm-rules?ts=' + Date.now(), { cache: 'no-store' });
    if (!response.ok) throw new Error('Market alarm settings unavailable');
    marketAlarmRules = await response.json(); renderMarketAlarmModule();
  }
  document.querySelector('#marketAlarms')?.addEventListener('submit', async event => {
    const form = event.target.closest('[data-market-alarm-rule]');
    if (!form) return;
    event.preventDefault();
    const rule = marketAlarmRules[form.dataset.marketAlarmRule], status = form.querySelector('.market-alarm-save'), button = form.querySelector('button[type="submit"]');
    const body = { metric: rule.metric, level: form.elements.level.value, enabled: form.elements.enabled.checked };
    if (rule.kind === 'price') { body.low = form.elements.low.value; body.high = form.elements.high.value; }
    else { body.primaryThreshold = form.elements.primaryThreshold.value; body.secondaryThreshold = form.elements.secondaryThreshold.value; }
    button.disabled = true; status.textContent = 'Saving…';
    try {
      const response = await fetch('/api/market-alarm-rules', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || 'Settings were not saved');
      marketAlarmRules[result.metric] = result; renderMarketAlarmModule(); window.loadAlerts?.();
    } catch (error) { status.textContent = error.message; button.disabled = false; }
  });
  loadMarketAlarmRules().catch(() => { const host = document.querySelector('#marketAlarms'); if (host) host.innerHTML = '<div class="placeholder">Market alarm settings are unavailable.</div>'; });
  window.NorthstarMarketModules = {render: (key,target) => renderNodeDetail(key,target),
    selectedNode: () => liveNode,
    selectLive: key => { if (key === 'IESO' || marketData?.nodes?.[key]) liveNode = key; },
    renderLive: () => renderNodeDetail(liveNode),
    renderHistorical: () => drawGraph(),
    data: () => marketData,
    mountOverviewTrend: (host, key = 'APIROQ') => {
      if (!host || !marketData?.nodes) return;
      host.dataset.marketNode = key;
      mountOverviewTrend(host, key);
      loadLivePriceHistory().then(data => { if (data) mountOverviewTrend(host, key, data); });
    },
    mountPreview: host => {
    if (!host) return;
    if (!marketData?.nodes) { host.textContent = 'Waiting for the market feed…'; return; }
    mountTrend(host, 'IESO');
  }};
  window.addEventListener('northstar:test-input', event => {
    const test=event.detail || {}, value=Number(test.value);
    if(test.type!=='market' || !Number.isFinite(value) || !marketData?.nodes)return;
    const requested=String(test.target || 'IESO').trim().toUpperCase();
    ensureIesoMarket(marketData);
    const key=Object.keys(marketData.nodes).find(id=>id.toUpperCase()===requested) || 'IESO';
    const prior=marketData.nodes[key] || {};
    marketData.nodes[key]={...prior,rt:value,da:value,rtTimestamp:new Date().toISOString(),daTimestamp:new Date().toISOString(),simulated:true};
    marketData.simulated=true; renderMarket(marketData); window.NorthstarOverview?.update('market',marketData);
  });
  window.addEventListener('northstar:test-input-clear', () => window.loadMarket?.());
})();
