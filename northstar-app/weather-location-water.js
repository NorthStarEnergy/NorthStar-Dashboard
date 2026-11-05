(() => {
  'use strict';
  const root = document.querySelector('#locationWater');
  const locationName = new URLSearchParams(location.search).get('site') || '';
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const number = (n, suffix=' m') => n !== null && n !== undefined && n !== '' && Number.isFinite(Number(n)) ? Number(n).toFixed(3) + suffix : '—';
  const stamp = t => t ? new Date(t).toLocaleString() : 'Not reported';
  const today = () => new Date().toISOString().slice(0,10);
  let selected, catalog, mapping, rangeResult, rangeRequest = 0, refreshing = false;
  const stateLabel = s => ({ok:'Reporting',stale:'Stale reading',historical_only:'Historical only',not_reported:'Not reported',unavailable:'Unavailable'}[s] || 'Unavailable');
  async function api(path) {
    const response = await fetch(path, {cache:'no-store',signal:AbortSignal.timeout(60000)});
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || `Feed returned ${response.status}`);
    return data;
  }
  function drawCurrent(data) {
    document.querySelector('#waterUpdated').textContent = `Retrieved ${stamp(data.retrievedAt)} · refreshes every two minutes`;
    document.querySelector('#waterCards').innerHTML = data.stations.map(s => {
      const r = s.readings.at(-1) || {};
      return `<article class="gauge-card"><header><h3>${esc(s.name)}</h3><span class="feed-badge ${s.state==='ok'?'ready':'stale'}">${stateLabel(s.state)}</span></header><strong>${number(r.waterLevelM)}</strong><p>Water level · ${esc(s.datum)}</p><p>Flow ${number(r.dischargeM3s,' m³/s')} · ${esc(stamp(r.observedAt))}</p><small>${esc(s.id)} · ${esc(s.provider)} · ${esc(r.quality || 'No reading')}</small><p>${esc(s.mappingNote || '')} ${esc(s.message || '')}</p><a href="https://wateroffice.ec.gc.ca/report/real_time_e.html?stn=${encodeURIComponent(s.id)}" target="_blank" rel="noreferrer">Provider record ↗</a> <button type="button" data-gauge-history="${esc(s.id)}">View history</button></article>`;
    }).join('');
    root.querySelectorAll('[data-gauge-history]').forEach(button => button.onclick = () => {
      selected.value = button.dataset.gaugeHistory;
      clearRange(); selected.focus(); document.querySelector('#gaugeHistory').scrollIntoView({behavior:'smooth',block:'start'});
    });
  }
  async function current() {
    if (refreshing) return;
    refreshing = true;
    try { drawCurrent(await api('/api/water-elevations?'+new URLSearchParams({location:locationName}))); }
    catch(e) {
      document.querySelector('#waterUpdated').textContent = `Connection unavailable: ${e.message}`;
      root.querySelectorAll('#waterCards .feed-badge').forEach(el => {el.textContent='Connection unavailable';el.className='feed-badge stale';});
    } finally {refreshing = false;}
  }
  function clearRange() {
    rangeRequest++; rangeResult=null;
    document.querySelector('#waterCsv').disabled=true;
    document.querySelector('#waterHistoryRows').innerHTML='';
    document.querySelector('#waterRangeStatus').textContent='Select a gauge and dates, then load readings. Up to 366 days per request; older WSC ranges use published daily means and may lag the present.';
  }
  async function history(event) {
    event.preventDefault();
    const id=++rangeRequest, status=document.querySelector('#waterRangeStatus');
    rangeResult=null; document.querySelector('#waterCsv').disabled=true; document.querySelector('#waterHistoryRows').innerHTML='';
    const form=new FormData(event.target), start=form.get('start'), end=form.get('end');
    if(start>end || (Date.parse(end)-Date.parse(start))/86400000>=366 || end>today()) { status.textContent='Choose an ordered range of up to 366 days, ending today or earlier.';return; }
    status.textContent='Retrieving gauge history…';
    try {
      const result=await api('/api/water-elevations?'+new URLSearchParams({location:locationName,station:form.get('station'),start,end}));
      if (id!==rangeRequest) return;
      const gauge=result.stations[0], readings=gauge.readings;
      rangeResult=gauge;
      status.textContent=`${gauge.name} · ${readings.length} readings · ${gauge.resolution==='daily_mean'?'Published daily means':'Instantaneous readings'} · ${gauge.datum}. ${gauge.message || ''} ${readings.length?'':'No readings available for this period.'}`;
      // Limit the rendered table while preserving all fetched records for CSV.
      document.querySelector('#waterHistoryRows').innerHTML=readings.slice(-500).reverse().map(r=>`<tr><td>${esc(stamp(r.observedAt))}</td><td>${number(r.waterLevelM)}</td><td>${number(r.dischargeM3s,' m³/s')}</td><td>${esc(r.quality)}</td></tr>`).join('');
      if(readings.length>500)status.textContent+=' Showing latest 500; CSV contains all readings.';
      document.querySelector('#waterCsv').disabled=!readings.length;
    } catch(e) {if(id===rangeRequest)status.textContent=e.message;}
  }
  function csv() {
    if (!rangeResult) return;
    const s=rangeResult, cell=v=>'"'+String(v??'').replace(/"/g,'""')+'"';
    const rows=[['Station','Name','Timestamp UTC','Water level (m)','Discharge (m3/s)','Datum','Resolution','Quality'],...s.readings.map(r=>[s.id,s.name,r.observedAt,r.waterLevelM,r.dischargeM3s,s.datum,s.resolution,r.quality])];
    const url=URL.createObjectURL(new Blob([rows.map(row=>row.map(cell).join(',')).join('\r\n')],{type:'text/csv;charset=utf-8'}));
    const a=document.createElement('a');a.href=url;a.download=`${s.id}-water-history.csv`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  async function init() {
    try {
      catalog=await api('/api/water-elevations/catalog');mapping=catalog.locations?.[locationName];
      if(!mapping) throw new Error('No river-system mapping is configured for this location.');
      const gauges=catalog.stations.filter(s=>mapping.gauges.includes(s.id));
      root.innerHTML=`<section class="detail-card"><header class="section-head"><div><span class="section-label">RIVER SYSTEM</span><h2>${esc(mapping.riverSystem)}</h2></div><button id="waterRefresh" type="button">Refresh gauges</button></header><p class="source-note">Water Survey of Canada connectors · levels retain the provider datum. Assumed-datum levels are gauge heights, not verified elevations above sea level. Basin gauges do not substitute for plant forebay or tailrace telemetry.</p><p id="waterUpdated" class="source-note">Connecting…</p><div id="waterCards" class="gauge-grid"></div></section><section class="detail-card" id="gaugeHistory"><header class="section-head"><div><span class="section-label">HISTORICAL WATER DATA</span><h2>Gauge history</h2></div></header><form id="waterRangeForm" class="data-controls"><label>Gauge<select name="station" id="waterGauge">${gauges.map(s=>`<option value="${esc(s.id)}">${esc(s.name)} (${esc(s.id)})</option>`).join('')}</select></label><label>From (UTC)<input name="start" type="date" required max="${today()}" value="${new Date(Date.now()-6*86400000).toISOString().slice(0,10)}"></label><label>Through (UTC)<input name="end" type="date" required max="${today()}" value="${today()}"></label><button type="submit">Load readings</button><button type="button" id="waterCsv" disabled>Download CSV</button></form><p class="source-note" id="waterRangeStatus"></p><div class="history-scroll"><table class="history-table"><thead><tr><th>Observed</th><th>Water level</th><th>Flow</th><th>Quality</th></tr></thead><tbody id="waterHistoryRows"></tbody></table></div><p class="source-note">No river-level forecast or internal plant-level connector is configured. Missing values stay blank; levels from different datums are not combined.</p></section>`;
      selected=document.querySelector('#waterGauge');
      document.querySelector('#waterRangeForm').onsubmit=history;
      document.querySelector('#waterRangeForm').oninput=clearRange;
      document.querySelector('#waterRefresh').onclick=current;
      document.querySelector('#waterCsv').onclick=csv;
      clearRange(); await current();
      window.setInterval(()=>{if(!document.hidden)void current();},120000);
    } catch(e) {root.innerHTML=`<section class="error-card"><h2>Water connectors unavailable</h2><p>${esc(e.message)}</p><button type="button" id="retryWater">Retry</button></section>`;root.querySelector('#retryWater').onclick=init;}
  }
  void init();
})();
