(() => {
  'use strict';
  const escape = value => String(value ?? '').replace(/[&<>"']/g, x => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[x]));
  function buildQuery(form) {
    const q = new URLSearchParams({station: form.station || 'all'});
    if (form.mode === 'range') {
      if (!form.station || form.station === 'all') throw Error('Select one gauge for a custom range.');
      if (!form.start || !form.end || form.start > form.end) throw Error('Choose a valid start and end date.');
      const a = Date.parse(form.start), b = Date.parse(form.end);
      if (!Number.isFinite(a) || !Number.isFinite(b) || (b-a)/86400000 >= 366) throw Error('Choose a range of at most 366 days.');
      q.set('start', form.start); q.set('end', form.end);
    }
    return q.toString();
  }
  function csv(payload) {
    const cell = value => '"' + String(value ?? '').replace(/^[=+@-]/, "'$&").replaceAll('"', '""') + '"';
    const rows = [['Gauge','Station ID','Provider','Datum','Resolution','Observed UTC','Elevation m','Raw value','Raw unit','Quality']];
    for (const s of payload.stations || []) for (const r of s.readings || []) rows.push([s.name,s.id,s.provider,s.datum,s.resolution,r.observedAt,r.waterLevelM,r.rawValue,r.rawUnit,r.quality]);
    return rows.map(row => row.map(cell).join(',')).join('\r\n');
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = {buildQuery, csv};
  if (typeof window === 'undefined') return;
  let root, catalog, payload, busy = false, error = '', page = 0, requestId = 0, appliedKey = '';
  const form = {mode:'current', station:'all', start:'', end:''};
  const fmt = n => n === null || n === undefined ? 'Not reported' : Number(n).toLocaleString('en-CA',{minimumFractionDigits:3,maximumFractionDigits:3}) + ' m';
  const stamp = v => v ? v.replace('T',' ').replace(/\+00:00$/, ' UTC') : 'Not reported';
  function cards() {
    return `<div class="we-cards">${payload.stations.map(s => {
      const r = s.readings?.at(-1);
      return `<article class="we-card"><div><strong>${escape(s.name)}</strong><span class="we-state ${escape(s.state)}">${escape(s.state.replaceAll('_',' '))}</span></div><p class="we-value">${fmt(r?.waterLevelM)}</p><p>${escape(stamp(r?.observedAt))}</p><small>${escape(s.provider)} · ${escape(s.id)} · ${escape(r?.quality || '')}</small><p class="we-datum">${escape(s.datum)}</p>${s.mappingNote ? `<p class="we-note">${escape(s.mappingNote)}</p>` : ''}${s.message ? `<p class="we-note">${escape(s.message)}</p>` : ''}</article>`;
    }).join('')}</div>`;
  }
  function rangeTable() {
    const s = payload.stations[0], rows = s?.readings || [], shown = rows.slice(page*100,(page+1)*100);
    if (!s) return '';
    const values = rows.filter(r => r.waterLevelM !== null).map(r => r.waterLevelM);
    return `<section class="panel"><h3>${escape(s.name)}</h3><p>${escape(s.datum)} · ${s.resolution === 'daily_mean' ? 'Published daily means (date labels)' : 'Instantaneous observations'}</p><p>${rows.length} returned observations${values.length ? ` · Minimum ${fmt(Math.min(...values))} · Maximum ${fmt(Math.max(...values))}` : ''}. Coverage: ${escape(stamp(rows[0]?.observedAt))} to ${escape(stamp(rows.at(-1)?.observedAt))}.</p>${s.mappingNote ? `<p class="we-note">${escape(s.mappingNote)}</p>` : ''}${s.message ? `<p class="we-note">${escape(s.message)}</p>` : ''}<p>Missing dates are not filled or interpolated.</p><div class="we-table"><table><thead><tr><th>${s.resolution === 'daily_mean' ? 'Provider date' : 'Observed UTC'}</th><th>Elevation (m)</th><th>Source value</th><th>Quality</th></tr></thead><tbody>${shown.map(r => `<tr><td>${escape(s.resolution === 'daily_mean' ? r.observedAt.slice(0,10) : stamp(r.observedAt))}</td><td>${fmt(r.waterLevelM)}</td><td>${escape(r.rawValue ?? 'Not reported')} ${escape(r.rawUnit)}</td><td>${escape(r.quality)}</td></tr>`).join('') || '<tr><td colspan="4">No observations returned for this range.</td></tr>'}</tbody></table></div><div class="we-actions"><button type="button" data-we-prev ${page===0?'disabled':''}>Previous</button><span>Page ${page+1} of ${Math.max(1,Math.ceil(rows.length/100))}</span><button type="button" data-we-next ${(page+1)*100>=rows.length?'disabled':''}>Next</button><button type="button" data-we-csv ${rows.length?'':'disabled'}>Download all readings (CSV)</button></div></section>`;
  }
  function render() {
    if (!root?.isConnected) return;
    root.innerHTML = `<section class="panel"><form class="we-controls"><label>Display<select name="mode"><option value="current" ${form.mode==='current'?'selected':''}>Current elevation</option><option value="range" ${form.mode==='range'?'selected':''}>Custom range</option></select></label><label>Gauge<select name="station"><option value="all">All West public gauges</option>${(catalog?.stations || []).map(s => `<option value="${escape(s.id)}" ${s.id===form.station?'selected':''}>${escape(s.name)} (${escape(s.id)})</option>`).join('')}</select></label>${form.mode==='range' ? `<label>Start date (UTC)<input name="start" type="date" required value="${escape(form.start)}"></label><label>End date (UTC, inclusive)<input name="end" type="date" required value="${escape(form.end)}"></label>` : ''}<button class="primary-btn" type="submit" ${busy?'disabled':''}>${busy?'Loading…':'Pull elevations'}</button></form><p class="muted-note">${form.mode==='current' ? 'Latest available elevation; readings older than six hours are marked stale. Refreshes every two minutes while open.' : 'One gauge per range, up to 366 days. WSC ranges starting more than 29 days ago use the published daily archive, which may not contain recent dates.'}</p><p class="we-note">Each gauge retains its own datum. USGS values are metres NAVD88; legacy workbook offsets are not applied.</p><p role="status">${escape(error || (busy ? 'Retrieving provider data…' : payload ? `Retrieved ${stamp(payload.retrievedAt)}` : catalog ? 'Choose a gauge and dates, then pull elevations.' : 'Loading gauge list…'))}</p></section>${payload ? (payload.mode==='current' ? cards() : rangeTable()) : ''}<details class="panel"><summary>Sources awaiting connection</summary>${(catalog?.pendingSources || []).map(s => `<p><strong>${escape(s.name)}</strong>: ${escape(s.reason)}</p>`).join('')}</details>`;
    root.querySelector('form').onsubmit = event => { event.preventDefault(); void load(); };
    root.querySelector('form').oninput = event => { if (event.target.name in form) form[event.target.name]=event.target.value; };
    root.querySelector('form').onchange = event => {
      if (!(event.target.name in form)) return;
      form[event.target.name]=event.target.value; requestId++; busy=false; payload=null; error=''; page=0;
      render();
      if (form.mode==='current') void load();
    };
    root.querySelector('[data-we-prev]')?.addEventListener('click',()=>{page--;render();});
    root.querySelector('[data-we-next]')?.addEventListener('click',()=>{page++;render();});
    root.querySelector('[data-we-csv]')?.addEventListener('click',()=>{
      const url=URL.createObjectURL(new Blob([csv(payload)],{type:'text/csv;charset=utf-8'}));
      const a=document.createElement('a');a.href=url;a.download=`west-elevations-${payload.stations[0].id}.csv`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
    });
  }
  async function api(url) {
    const r=await fetch(url,{headers:{Accept:'application/json'}}), data=await r.json();
    if (!r.ok) throw Error(data.error || `Request failed (${r.status})`);
    return data;
  }
  async function load() {
    let query;
    try { query=buildQuery(form); } catch(e) {error=e.message;render();return;}
    if (busy) return;
    const id=++requestId;busy=true;error='';payload=null;render();
    try {
      const data=await api('/api/water-elevations?'+query);
      if (id!==requestId) return;
      payload=data;appliedKey=query;page=0;
    } catch(e) {if(id===requestId) error=e.message;}
    finally {if(id===requestId){busy=false;render();}}
  }
  window.NorthstarWaterElevations = {mount: async target => {
    root=target;render();
    try {if(!catalog) catalog=await api('/api/water-elevations/catalog');}
    catch(e){error=e.message;render();return;}
    render();
    if(!payload && !busy && form.mode==='current') void load();
  }};
  window.setInterval(()=>{if(root?.isConnected && form.mode==='current' && !busy && (!payload || appliedKey===buildQuery(form))) void load();},120000);
})();
