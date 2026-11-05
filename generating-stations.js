/* Read-only station cards. Configured station values are isolated from the shared SCADA feed. */
(() => {
  'use strict';
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const finite = value => typeof value === 'number' && Number.isFinite(value);
  const fmt = (value, digits = 0) => finite(value) ? value.toFixed(digits) : '—';
  const normalize = value => String(value ?? '').trim().toLowerCase();
  const labels = {generating:'Generating', offline:'Offline · main breaker open', available:'Available · not generating', unknown:'Status unknown'};
  // Indicative loading bands, not a measured plant efficiency curve.
  const OUTPUT_BANDS = {greenEnd:.85, yellowEnd:.95};
  function symbol(state, output = null, capacity = null) {
    if (arguments.length === 1) return `<svg class="gs-generator gs-${state}" viewBox="0 0 48 48" role="img" aria-label="${labels[state]}"><circle cx="24" cy="24" r="20"/><path d="M10 24 C14 9 20 9 24 24 S34 39 38 24"/></svg>`;
    const valid = finite(output) && output >= 0 && finite(capacity) && capacity > 0;
    const fraction = valid ? Math.min(1, output / capacity) : 0;
    const point = t => `${(24 + 20 * Math.sin(t * 2 * Math.PI)).toFixed(4)} ${(24 - 20 * Math.cos(t * 2 * Math.PI)).toFixed(4)}`;
    const color = t => {
      const {greenEnd, yellowEnd} = OUTPUT_BANDS;
      const a = t <= yellowEnd ? [70,238,124] : [255,214,80];
      const b = t <= yellowEnd ? [255,214,80] : [255,106,94];
      const mix = t <= greenEnd ? 0 : t <= yellowEnd ? (t-greenEnd)/(yellowEnd-greenEnd) : (t-yellowEnd)/(1-yellowEnd);
      return `rgb(${a.map((v,i) => Math.round(v+(b[i]-v)*mix)).join(',')})`;
    };
    let arcs = '';
    for (let start = 0; start < fraction; start = Math.round((start + .01) * 100) / 100) {
      const end = Math.min(start + .01, fraction);
      arcs += `<path class="gs-output-arc" stroke="${color(end)}" d="M${point(start)} A20 20 0 0 1 ${point(end)}"/>`;
    }
    const description = valid ? `${fmt(output,2)} of ${fmt(capacity,2)} MW; ${fmt(output/capacity*100,0)}% of capacity. Indicative loading colors; efficiency curve not configured.` : 'Output or capacity unavailable';
    return `<svg class="gs-generator gs-${state} gs-output-gauge" viewBox="0 0 48 48" role="img" aria-label="${esc(labels[state] + '. ' + description)}"><title>${esc(description)}</title><circle class="gs-output-track" cx="24" cy="24" r="20"/>${arcs}<path d="M10 24 C14 9 20 9 24 24 S34 39 38 24"/></svg>`;
  }
  const fields = {
    output:['Plant output','MW'], capacity:['Plant capacity','MW'], efficiency:['Plant efficiency','%'], headwater:['Headwater level','m'],
    flow:['Plant flow','m3/s'], inflow:['Inflow','m3/s'], outflow:['Outflow','m3/s'], spill:['Spill flow','m3/s'], tailwater:['Tailwater level','m'],
    running:['Generators running',''], total:['Generator count',''], breaker:['Main breaker',''], available:['Plant available','']
  };
  const USE_STATION_BASELINES = true;
  const STATION_BASELINES = Object.freeze({
    'site:calm-lake': {code:'CL',name:'Calm Lake',units:2,headwater:[382.480,382.550],capacity:9.5,outflow:[25,55]},
    'site:sturgeon-falls': {code:'SF',name:'Sturgeon Falls',units:2,headwater:[357.480,357.550],capacity:8.5,outflow:[25,55]},
    'site:fort-frances': {code:'FF',name:'Fort Frances',units:8,headwater:[337.477,337.866],capacity:12.8,outflow:[25,140]},
    'site:kenora': {code:'KE',name:'Kenora',units:6,headwater:[322.231,322.677],capacity:6,outflow:[25,100]},
    'site:norman': {code:'NO',name:'Norman',units:5,headwater:[322.255,322.755],capacity:15,outflow:[50,150]},
    'site:twin-falls': {code:'TW',name:'Twin Falls',units:5,headwater:[267.432,267.775],capacity:27.5,outflow:[33,200]},
    'site:island-falls': {code:'IR',name:'Island Falls',units:12,headwater:[250.250,250.500],capacity:28.5,outflow:[60,300]},
    'site:iroquois-falls': {code:'IS',name:'Iroquois Falls',units:4,headwater:[215.700,215.975],capacity:44,outflow:[55,200]},
    'site:old-woman-falls': {code:'OW',name:'Old Woman Falls',units:2,headwater:[221.433,221.955],capacity:5.5,outflow:[25,50]},
    'site:white-otter-rapids': {code:'WO',name:'White Otter Rapids',units:2,headwater:[214.433,214.955],capacity:5.5,outflow:[25,50]},
    'site:camp-three-rapids': {code:'CT',name:'Camp Three Rapids',units:2,headwater:[209.433,209.955],capacity:5.5,outflow:[25,50]},
    'site:big-beaver-falls': {code:'BB',name:'Big Beaver Falls',units:2,headwater:[205.433,205.955],capacity:5.5,outflow:[25,50]},
    'site:mcdougal': {code:'MC',name:'McDougal',units:3,headwater:[165.125,165.833],capacity:6,outflow:[25,50]},
    'site:okikendawt-gs': {code:'OK',name:'Okikendawt GS',units:2,headwater:[195.225,196.150],capacity:11,outflow:[25,200]},
    'site:aiyers-1': {code:'A1',name:'Aiyers 1',units:2,headwater:[155.222,155.775],capacity:10,outflow:[25,50]},
    'site:aiyers-2': {code:'A2',name:'Aiyers 2',units:2,headwater:[151.200,151.775],capacity:8,outflow:[25,50]},
    'site:bird-gs': {code:'B1',name:'Bird GS',units:2,headwater:[125.100,125.775],capacity:5,outflow:[25,75]},
    'site:cogent': {code:'B2',name:'CoGent',units:2,headwater:[120.150,120.775],capacity:5,outflow:[25,75]}
  });
  const STATION_GROUP_ORDER = [
    'site:twin-falls','site:island-falls','site:iroquois-falls-ts','site:iroquois-falls',
    'site:old-woman-falls','site:white-otter-rapids','site:camp-three-rapids','site:big-beaver-falls',
    'site:calm-lake','site:sturgeon-falls','site:fort-frances','site:fort-frances-ts',
    'site:kenora','site:norman','site:okikendawt-gs',
    'site:aiyers-1','site:aiyers-2','site:mcdougal',
    'site:bird-gs','site:cogent'
  ];
  let grid, popup, popupWindow, active, closeTimer, openTimer, logbook=[];
  let popupPreference={useSaved:false,savedSize:null};
  const popupPreferenceReady=fetch('/api/profile/station-popup',{cache:'no-store'}).then(r=>r.ok?r.json():null).then(value=>{if(value&&typeof value.useSaved==='boolean')popupPreference=value;}).catch(()=>{});
  let rangeHours=24, showUnits=true;
  const cards = new Map(), models = new Map();
  const testOutputs = new Map();
  function baselineSites() {
    const catalog = new Map((window.NorthStarSites?.stations() || []).map(site => [site.id, site]));
    return Object.entries(STATION_BASELINES).map(([id, baseline]) => catalog.get(id) || {id,name:baseline.name,area:''});
  }
  function sampleBaseline(baseline, at) {
    const seed = [...baseline.code].reduce((sum, character) => sum + character.charCodeAt(0), 0);
    const phase = at / 3600000 * Math.PI * 2 + seed;
    const wave = (offset, speed = 1) => (Math.sin(phase * speed + offset) + 1) / 2;
    const running = Math.max(1, Math.min(baseline.units, Math.round(baseline.units * (.5 + .5 * wave(.7, .61)))));
    const output = baseline.capacity * running / baseline.units * (.62 + .2 * wave(2.1, .83));
    return {
      headwater: baseline.noWater ? null : baseline.headwater[0] + (baseline.headwater[1] - baseline.headwater[0]) * (.3 + .4 * wave(1.2, .47)),
      outflow: baseline.noWater ? null : baseline.outflow[0] + (baseline.outflow[1] - baseline.outflow[0]) * (.3 + .4 * wave(2.4, .73)),
      output, running
    };
  }
  function baselineModel(site, baseline) {
    const now = Date.now(), current = sampleBaseline(baseline, now), stamp = new Date(now).toISOString();
    const reading = (displayName, numericValue, unit = '', textValue = '') => ({
      displayName, numericValue, unit, textValue, observedAt:stamp
    });
    const readings = [
      reading('Plant output', current.output, 'MW'), reading('Plant capacity', baseline.capacity, 'MW'),
      reading('Generators running', current.running), reading('Generator count', baseline.units),
      reading('Main breaker', null, '', 'closed'), reading('Plant available', null, '', 'available')
    ];
    if (!baseline.noWater) readings.push(reading('Headwater level', current.headwater, 'm'), reading('Outflow', current.outflow, 'm3/s'));
    const units = Array.from({length:baseline.units}, (_, index) => {
      const running = index < current.running;
      readings.push(reading(`Unit ${index + 1} status`, null, '', running ? 'generating' : 'available'));
      readings.push(reading(`Unit ${index + 1} output`, running ? current.output / current.running : 0, 'MW'));
      readings.push(reading(`Unit ${index + 1} breaker`, null, '', 'closed'));
      return {n:index + 1,state:running ? 'generating' : 'available',breaker:'closed',output:running ? current.output / current.running : 0};
    });
    const history = Array.from({length:97}, (_, index) => {
      const at = now - (96 - index) * 15 * 60000;
      return {at,value:sampleBaseline(baseline, at).output};
    });
    const stationHistory = {output:history,headwater:history.map(p => ({at:p.at,value:sampleBaseline(baseline,p.at).headwater}))};
    const unitHistory = Array.from({length:25}, (_, index) => {
      const at = now - (24 - index) * 3600000, sample = sampleBaseline(baseline, at);
      return units.map(unit => ({n:unit.n,at,state:unit.n <= sample.running ? 'generating' : 'available'}));
    }).flat();
    const values = {output:current.output,capacity:baseline.capacity,headwater:current.headwater,outflow:current.outflow,running:current.running,total:baseline.units,available:1};
    const value = key => values[key] ?? null;
    return {site,baseline,readings,units,history,stationHistory,unitHistory,value,running:current.running,total:baseline.units,
      breaker:'closed',state:'generating',current:true};
  }
  function model(site, telemetryOnly = false) {
    if (!telemetryOnly && USE_STATION_BASELINES && STATION_BASELINES[site.id]) return baselineModel(site, STATION_BASELINES[site.id]);
    const feed = window.NorthstarOverview?.feeds?.scada;
    const data = feed?.data || {};
    const readings = (data.readings || []).filter(r => window.NorthStarSites?.resolve(r.siteCode)?.id === site.id);
    const usable = r => {
      const time = Date.parse(r?.observedAt), source = data.feeds?.find(f => f.feedCode === r?.feedCode);
      return !!r && !feed?.error && !data.stale && Date.now() - feed.checked <= 120000 && source?.status === 'Current'
        && Number.isFinite(time) && time <= Date.now() + 60000 && Date.now() - time <= 120000
        && ['good','valid','192'].includes(normalize(r.sourceQuality));
    };
    // Exact semantic labels and engineering units only; no substring/tag guessing.
    const reading = (label, unit) => {
      const matches = readings.filter(r => normalize(r.displayName) === normalize(label));
      return matches.length === 1 && usable(matches[0]) && (unit === undefined || normalize(matches[0].unit).replace('³','3') === normalize(unit)) ? matches[0] : null;
    };
    const value = key => {const r = reading(...fields[key]); return finite(r?.numericValue) ? r.numericValue : null;};
    const text = label => normalize(reading(label)?.textValue);
    const result = {site, readings, value, reading};
    const integer = v => finite(v) && Number.isInteger(v) && v >= 0 ? v : null;
    result.total = integer(value('total')) ?? (STATION_BASELINES[site.id]?.units ?? null);
    result.running = integer(value('running'));
    if (result.total !== null && result.running > result.total) result.running = null;
    result.breaker = ['open','closed'].includes(text('Main breaker')) ? text('Main breaker') : 'unknown';
    const available = text('Plant available') === 'available' || text('Plant available') === 'true' || value('available') === 1;
    result.state = result.breaker === 'open' ? 'offline' : result.breaker === 'closed' && value('output') > 0 ? 'generating'
      : result.breaker === 'closed' && value('output') === 0 && result.running === 0 && available ? 'available' : 'unknown';
    const unitNumbers = new Set(readings.map(r => /^Unit (\d+) status$/i.exec(r.displayName || '')?.[1]).filter(Boolean).map(Number));
    if (result.total !== null && result.total <= 50) for (let i = 1; i <= result.total; i++) unitNumbers.add(i);
    result.units = [...unitNumbers].sort((a,b) => a-b).map(n => {
      const status = text(`Unit ${n} status`), breaker = text(`Unit ${n} breaker`), output = reading(`Unit ${n} output`, 'MW');
      return {n, state:status === 'generating' ? 'generating' : status === 'available' ? 'available' : status === 'offline' ? 'offline' : 'unknown',
        breaker:['open','closed'].includes(breaker) ? breaker : 'unknown', output:output?.numericValue};
    });
    result.history = readings.filter(r => normalize(r.displayName) === 'plant output' && !feed?.error && !data.stale && finite(r.numericValue))
      .map(r => ({at:Date.parse(r.observedAt),value:r.numericValue})).filter(p=>Number.isFinite(p.at)).sort((a,b)=>a.at-b.at);
    result.unitHistory = readings.flatMap(r=>{const match=/^Unit (\d+) status$/i.exec(r.displayName||'');return match&&!feed?.error&&!data.stale?[{n:Number(match[1]),at:Date.parse(r.observedAt),state:normalize(r.textValue)}]:[];}).filter(p=>Number.isFinite(p.at)).sort((a,b)=>a.at-b.at);
    // A SCADA snapshot is not a historian. Plot only qualified observations;
    // never extend current values into an invented time series.
    result.stationHistory = Object.fromEntries(['headwater','output'].map(key => {
      const r = reading(...fields[key]);
      return [key,r && finite(r.numericValue) ? [{at:Date.parse(r.observedAt),value:r.numericValue}] : []];
    }));
    result.current = readings.some(usable);
    return result;
  }
  function content(m) {
    const displayName = m.site.id === 'site:okikendawt-gs' ? 'Okikendawt' : m.site.name;
    const words = String(displayName || '').trim().split(/\s+/);
    const name = words.length === 3 ? `<span>${esc(words.slice(0,2).join(' '))}</span><span>${esc(words[2])}</span>` : esc(displayName);
    const flow = m.baseline?.noWater ? null : m.value('outflow');
    const spill = m.baseline?.noWater ? null : m.value('spill');
    return `<strong class="gs-name">${name}</strong>
      <span class="gs-generation"><span class="gs-generator-stack"${m.site.id==='site:white-otter-rapids' ? ' data-asset-id="white-otter-generation-icon"' : ''}>${symbol(m.state, m.value('output'), m.value('capacity'))}<span class="gs-unit-count" aria-label="${fmt(m.running)} of ${fmt(m.total)} units running">${fmt(m.running)}/${fmt(m.total)}</span></span><span class="gs-generation-metrics"><b class="gs-output">${fmt(m.value('output'),2)}<em> MW</em></b><b class="gs-level">${m.baseline?.noWater ? '—' : `${fmt(m.value('headwater'),3)}<em> m</em>`}</b><span class="gs-units-line"><span class="gs-flow">${fmt(flow,0)}${spill !== null && Number(spill) > 0 ? `<i class="gs-spill">(${fmt(spill,0)})</i>` : ''}<em>m³/s</em></span></span></span></span>`;

  }
  function detail(m, preview = false) {
    // Details always use qualified station telemetry, never card baseline/test values.
    const demoModel = m.baseline ? m : null;
    m = model(m.site, true);
    const baseline = m.baseline;
    const since=Date.now()-rangeHours*3600000,points=m.history.filter(p=>p.at>=since);
    const width=500,height=116,pad=28,values=points.map(p=>p.value),lo=values.length?Math.min(...values):0,hi=values.length?Math.max(...values):1,span=hi-lo||1;
    const coords=points.map(p=>({x:pad+(p.at-since)/(rangeHours*3600000)*(width-pad*2),y:height-pad-(p.value-lo)/span*(height-pad*2)}));
    const path=coords.map((p,i)=>`${i?'L':'M'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
    const intervals=[];if(showUnits){const byUnit=new Map();for(const p of m.unitHistory.filter(p=>p.at>=since)){const list=byUnit.get(p.n)||[];list.push(p);byUnit.set(p.n,list)}for(const [n,list] of byUnit)for(let i=0;i<list.length;i++){if(list[i].state!=='generating')continue;const end=list.slice(i+1).find(p=>p.state!=='generating')?.at??Date.now();intervals.push(`<span class="gs-run" style="left:${Math.max(0,(list[i].at-since)/(rangeHours*3600000)*100)}%;width:${Math.max(.5,Math.min(100,(end-list[i].at)/(rangeHours*3600000)*100))}%" title="Unit ${n} generating"></span>`);}}
    const logRows=logbook.filter(e=>String(e.subject||'').toLowerCase().includes(m.site.name.toLowerCase())||String(e.details||'').toLowerCase().includes(m.site.name.toLowerCase())).slice(0,5);
    const operationalNotes=logRows.slice(0,3).map(e=>({type:e.type||'Note',text:[e.subject,e.details].filter(Boolean).join(' · '),timestamp:e.timestamp}));
    return `${preview ? '' : `<header><div><small>PLANT OVERVIEW</small><h2 id="gs-detail-title">${esc(m.site.name)}</h2></div><button type="button" class="gs-close" aria-label="Close plant details">×</button></header>
      <p class="gs-${m.state}">${labels[m.state]} · ${fmt(m.running)}/${fmt(m.total)} generators running</p>`}

      ${window.NorthStarStationOneLine.render({...m,operationalNotes,popupHeading:preview}, demoModel)}
      ${preview ? '<details class="gs-more"><summary>History, station log and reported points</summary>' : ''}
      <section class="gs-history"><header><h3>Station output</h3><label>Range <select class="gs-range"><option value="1" ${rangeHours===1?'selected':''}>1 hour</option><option value="6" ${rangeHours===6?'selected':''}>6 hours</option><option value="24" ${rangeHours===24?'selected':''}>24 hours</option><option value="168" ${rangeHours===168?'selected':''}>7 days</option><option value="720" ${rangeHours===720?'selected':''}>30 days</option></select></label></header><label class="gs-toggle"><input type="checkbox" class="gs-units-toggle" ${showUnits?'checked':''}> Show unit run periods</label><div class="gs-chart">${points.length>1?`<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Station output over ${rangeHours} hours"><path class="gs-output-path" d="${path}"/><text x="2" y="14">${fmt(hi,1)} MW</text><text x="2" y="${height-4}">${fmt(lo,1)} MW</text></svg><div class="gs-run-track">${intervals.join('')||'<small>No unit status history</small>'}</div>`:points.length===1?`<p class="gs-source">${fmt(points[0].value,2)} MW at ${esc(new Date(points[0].at).toLocaleString())}. Historical trend and run periods require a time-series SCADA feed; the connected feed supplies latest values only.</p>`:'<p class="gs-source">No output points in this range. Historical trend and run periods require a time-series SCADA feed.</p>'}</div></section>
      <div class="gs-aux-grid"><section><h3>Gates & station service</h3>${m.readings.filter(r=>/gate|sluice|station service|log lifter/i.test(r.displayName||'')).map(r=>`<p><b>${esc(r.displayName)}</b><span>${esc(r.numericValue??r.textValue??'—')} ${esc(r.unit||'')}</span>`).join('')||`<p>${baseline ? 'No station auxiliary points reported.' : 'Not reported in the connected SCADA feed.'}</p>`}</section><section><h3>Station log</h3>${logRows.map(e=>`<p><b>${esc(e.type||'Log')}</b> ${esc(e.subject||'')}<small>${esc(e.timestamp||'')} · ${esc(e.details||'')}</small></p>`).join('')||'<p>No station-specific log entries found.</p>'}</section></div>
      ${baseline ? '' : `<p class="gs-source">${m.current ? 'Qualified report readings · missing measurements shown as —' : 'Current qualified telemetry unavailable · measurements shown as —'}</p>`}
      <details><summary>Reported plant points (${m.readings.length})</summary>${m.readings.length ? m.readings.map(r => `<div class="gs-point"><strong>${esc(r.displayName || r.tagName)}</strong><span>${esc(r.numericValue ?? r.textValue ?? '—')} ${esc(r.unit)}</span><small>${baseline ? esc(r.observedAt || 'Time unknown') : `${esc(r.sourceQuality || 'Unqualified')} · ${esc(r.observedAt || 'Time unknown')}`}</small></div>`).join('') : '<p>No mapped plant readings.</p>'}</details>${preview ? '</details>' : ''}`;
  }
  function position() {
    if (!active || popup.hidden) return;
    if (popupWindow?.pinned) return;
    const box = cards.get(active)?.getBoundingClientRect();
    if (!box || !cards.get(active).getClientRects().length) return close();
    window.NorthstarPositionPreview(popup, cards.get(active));
    // The station diagram needs the available viewport, even when neither side of the card fits.
    popup.style.maxHeight = Math.max(100, innerHeight - 16) + 'px';
    popup.style.top = Math.max(8, Math.min(parseFloat(popup.style.top) || 8, innerHeight - popup.offsetHeight - 8)) + 'px';
  }
  function close() {
    clearTimeout(openTimer); clearTimeout(closeTimer);
    if (active) cards.get(active)?.setAttribute('aria-expanded','false');
    active = null; if (popup) {popup.hidden = true;popup.classList.remove('gs-window-minimized','gs-window-maximized');} popupWindow?.reset();
  }
  async function applyPopupPreference(id) {
    await popupPreferenceReady;
    if(active!==id||!popupPreference.useSaved||!popupPreference.savedSize)return;
    popup.style.width=`${popupPreference.savedSize.width}px`;
    popup.style.height=`${popupPreference.savedSize.height}px`;
    position();
  }
  async function setPopupPreference(preference) {
    const response=await fetch('/api/profile/station-popup',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({preference})});
    if(!response.ok)throw new Error('Unable to save station popup size to this profile');
    popupPreference=await response.json();
  }
  function open(id) {
    if (document.body.classList.contains('layout-edit')) return;
    if (popupWindow?.pinned) return;
    clearTimeout(closeTimer);
    if (active !== id) close();
    active = id; const markup = detail(models.get(id), true); popup.innerHTML = markup; popupWindow.restoreBar(); popup.dataset.content = markup; popup.hidden = false;
    cards.get(id).setAttribute('aria-expanded','true'); position(); applyPopupPreference(id);
  }
  const siteModuleId = id => 'operations:site:' + String(id || '').replace(/^site:/,'');
  function ensureSitePages(sites) {
    let section = document.getElementById('operations-sites');
    if (!section) {
      section = document.createElement('section'); section.id = 'operations-sites'; section.className = 'section';
      const directory = document.createElement('div'); directory.id = 'operationsSites'; directory.className = 'panel gs-sites-directory';
      directory.innerHTML = `<label>OPERATIONS</label><div class="gs-operations-layout"><section class="gs-operations-stations"><h2>Stations</h2><div class="gs-sites-list"></div></section><div class="gs-operations-lists"><section class="gs-operations-feed"><h2>Operations activity</h2><div class="gs-activity-list" aria-live="polite">Loading activity…</div></section><section class="gs-operations-outages"><h2>Outages</h2><div class="gs-outage-filters" role="group" aria-label="Filter outages">${['All','Active','Past'].map(name=>`<button type="button" data-operations-outages="${name.toLowerCase()}" aria-pressed="${name==='All'}">${name}</button>`).join('')}</div><div class="gs-outages-list" aria-live="polite">Loading outages…</div></section></div></div>`;
      section.append(directory); document.querySelector('main')?.append(section);
      directory.addEventListener('click', event => {const button=event.target.closest('[data-site-page]');if(button)openFull(button.dataset.sitePage);});
      directory.addEventListener('click', event => {const button=event.target.closest('[data-operations-outages]');if(button){outageFilter=button.dataset.operationsOutages;renderOperationsLists();}});
      loadOperationsLists();
    }
    const list = section.querySelector('.gs-sites-list');
    sites.forEach(site => {
      let card = list.querySelector(`[data-site-page="${CSS.escape(site.id)}"]`);
      if (!card) {
        card = document.createElement('button'); card.type = 'button'; card.className = 'gs-operations-card';
        card.dataset.sitePage = site.id; card.dataset.moduleId = 'operations-station:' + site.id;
        list.append(card);
      }
      const markup = content(models.get(site.id) || model(site));
      if (card.dataset.content !== markup) {card.innerHTML = markup; card.dataset.content = markup;}
      card.setAttribute('aria-label', `${site.name}: view station operating data`);
    });
    sites.forEach(site => {
      const pageId = 'operationsSite-' + site.id.replace(/^site:/,'').replace(/[^a-z0-9-]/gi,'-');
      let page = document.getElementById(pageId);
      if (!page) {
        page = document.createElement('article'); page.id = pageId; page.className = 'panel gs-full-detail gs-site-page';
        page.dataset.siteId = site.id; page.hidden = true; section.append(page);
        page.addEventListener('change', event => {
          if(event.target.matches('.gs-range'))rangeHours=Number(event.target.value)||24;
          if(event.target.matches('.gs-units-toggle'))showUnits=event.target.checked;
          renderFull(site.id);
        });
      }
    });
  }
  let outageFilter = 'all';
  const operationsLists = {activity:null,outages:null,activityError:false,outagesError:false,reduced:null};
  const operationsSources = ['logbook','scada','dispatch','field_operations','switching','outages','outage'];
  const reducedOperations = () => document.body.classList.contains('ns-build-v3');
  let operationsRequest = 0, operationsViewFrame = 0;
  function outagePhase(outage) {
    const status = normalize(outage.status);
    if (outage.closedAt || ['closed','completed','cancelled','canceled'].includes(status)) return 'past';
    const start = Date.parse(outage.scheduledStart || outage.startAt || outage.openedAt);
    if (start > Date.now() || ['scheduled','upcoming'].includes(status)) return 'upcoming';
    return ['open','active','out of service','out-of-service'].includes(status) ? 'active' : 'unknown';
  }
  function renderOperationsLists() {
    const root = document.getElementById('operationsSites'); if (!root) return;
    const reduced = reducedOperations(), filter = reduced ? 'all' : outageFilter;
    const date = value => {const stamp=Date.parse(value);return Number.isFinite(stamp)?new Date(stamp).toLocaleString():'Time not recorded';};
    const report = row => row.eventId ? `<a href="event-detail.html?id=${encodeURIComponent(row.eventId)}">View report</a>` : '';
    const activity = root.querySelector('.gs-activity-list');
    if (operationsLists.activity) activity.innerHTML = (operationsLists.activityError?'<p class="muted-note">Activity unavailable — showing last received records.</p>':'') + (operationsLists.activity.map(row=>`<article class="gs-operations-row"><time>${esc(date(row.occurredAt))}</time><strong>${esc(row.summary || row.eventType || 'Recorded activity')}</strong><span>${esc(row.site || row.source || '')}</span>${report(row)}</article>`).join('') || '<p class="muted-note">No recorded operations activity.</p>');
    else activity.textContent = operationsLists.activityError ? 'Operations activity unavailable.' : 'Loading activity…';
    const filters = root.querySelector('.gs-outage-filters');
    filters.hidden = reduced; filters.style.display = reduced ? 'none' : '';
    root.querySelectorAll('[data-operations-outages]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.operationsOutages===filter)));
    const list = root.querySelector('.gs-outages-list');
    if (!operationsLists.outages) {list.textContent=operationsLists.outagesError?'Outage register unavailable.':'Loading outages…';return;}
    const records = operationsLists.outages.map(row=>({row,phase:outagePhase(row)})).filter(({phase})=>reduced?phase!=='past':filter==='all'?phase!=='past':filter==='past'?phase==='past':phase==='active');
    records.sort((a,b)=> (a.phase==='upcoming')-(b.phase==='upcoming') || (a.phase==='upcoming'? Date.parse(a.row.scheduledStart||a.row.startAt||a.row.openedAt)-Date.parse(b.row.scheduledStart||b.row.startAt||b.row.openedAt):Date.parse(b.row.closedAt||b.row.openedAt)-Date.parse(a.row.closedAt||a.row.openedAt)));
    list.innerHTML = (operationsLists.outagesError?'<p class="muted-note">Outages unavailable — showing last received records.</p>':'') + (records.map(({row,phase})=>`<article class="gs-operations-row gs-outage-${phase}"><header><strong>${esc(row.asset || row.title || 'Unspecified asset')}</strong><b class="gs-outage-phase">${esc(phase==='upcoming'?'Upcoming':phase==='active'?'Active':phase==='past'?(normalize(row.status)==='closed'?'Completed':row.status):'Status unconfirmed')}</b></header><span>${esc(row.site || '')}</span><p>${esc(row.details || row.title || '')}</p><time>${phase==='upcoming'?'Starts ':phase==='past'?'Ended ':'Started '}${esc(date(phase==='past'?row.closedAt:row.scheduledStart||row.startAt||row.openedAt))}</time>${report(row)}</article>`).join('') || `<p class="muted-note">${filter==='past'?'No completed or cancelled outages.':filter==='active'?'No active outages.':'No current or upcoming outages.'}</p>`);
  }
  async function loadOperationsLists() {
    const reduced = reducedOperations(), request = ++operationsRequest;
    if (operationsLists.reduced !== reduced) {
      operationsLists.reduced = reduced;
      operationsLists.activity = operationsLists.outages = null;
      operationsLists.activityError = operationsLists.outagesError = false;
      renderOperationsLists();
    }
    const query = new URLSearchParams({limit:reduced?'6':'30'});
    if (reduced) operationsSources.forEach(source=>query.append('source',source));
    await Promise.all([['activity','/api/events/register?'+query],['outages','/api/outages']].map(async ([key,url])=>{
      try {const response=await fetch(url,{cache:'no-store'});if(!response.ok)throw Error('Unavailable');const data=await response.json(),rows=key==='activity'?data.items:data;if(!Array.isArray(rows))throw Error('Invalid feed');if(request!==operationsRequest||reduced!==reducedOperations())return;operationsLists[key]=rows;operationsLists[key+'Error']=false;}
      catch {if(request===operationsRequest&&reduced===reducedOperations())operationsLists[key+'Error']=true;}
    }));
    if(request===operationsRequest&&reduced===reducedOperations())renderOperationsLists();
  }
  let fullSite = '';
  function openFull(id) {
    clearTimeout(openTimer); close(); fullSite = id;
    ensureSitePages([...models.values()].map(item => item.site));
    renderFull(id);
    window.NorthstarModules?.refresh();
    requestAnimationFrame(() => window.NorthstarModules?.open(siteModuleId(id)));
  }
  function renderFull(id = fullSite) {
    const full=document.querySelector(`.gs-site-page[data-site-id="${CSS.escape(id)}"]`);
    if(!id || !full || !models.has(id))return;
    const markup=detail(models.get(id)).replace('id="gs-detail-title"','id="gs-full-title"');
    if(full.dataset.content!==markup){full.innerHTML=markup;full.querySelector('.gs-close')?.remove();full.dataset.content=markup;}
  }
  function deferClose() {clearTimeout(openTimer); clearTimeout(closeTimer); if(popupWindow?.pinned)return; closeTimer = setTimeout(() => {if(popupWindow?.pinned || popup.matches(':hover') || popup.contains(document.activeElement))return;close();}, 250);}
  function refresh() {
    if (!grid) return;
    const sites = (USE_STATION_BASELINES ? baselineSites() : (window.NorthStarSites?.stations() || []))
      .sort((a,b) => {
        const ai=STATION_GROUP_ORDER.indexOf(a.id), bi=STATION_GROUP_ORDER.indexOf(b.id);
        return (ai<0?STATION_GROUP_ORDER.length:ai)-(bi<0?STATION_GROUP_ORDER.length:bi);
      });
    sites.forEach(site => {
      const m = model(site), testOutput=testOutputs.get(site.id);
      if(finite(testOutput)) {const value=m.value;m.value=key=>key==='output'?testOutput:value(key);m.history=[...m.history,{at:Date.now(),value:testOutput}];m.testInput=true;} models.set(site.id,m);
      let card = cards.get(site.id);
      if (!card) {
        card = document.createElement('article'); card.tabIndex = 0; card.setAttribute('role','button'); card.className = 'gs-card'; card.dataset.moduleId = site.id;
        const body = document.createElement('div'); body.className = 'gs-card-body'; card.append(body);
        card.setAttribute('aria-controls','operationsSite-' + site.id.replace(/^site:/,''));
        card.addEventListener('click', event => {if(!event.target.closest('button')&&!document.body.classList.contains('layout-edit')){event.stopPropagation();openFull(site.id);}});
        card.addEventListener('keydown', e => {if(e.target!==card || document.body.classList.contains('layout-edit'))return;if(['Enter',' '].includes(e.key)){e.stopPropagation();openFull(site.id);e.preventDefault();}});
        grid.append(card); cards.set(site.id,card);
      }
      const markup = content(m);
      if (card.dataset.content !== markup) {card.querySelector('.gs-card-body').innerHTML = markup; card.dataset.content = markup;}
      card.setAttribute('aria-label',`${site.name}: ${labels[m.state]}. View plant details`);
    });
    ensureSitePages(sites);
    renderFull();
    if (active) {const markup = detail(models.get(active), true); if (popup.dataset.content !== markup) {const expanded = popup.querySelector('details')?.open; popup.innerHTML = markup; popupWindow.restoreBar(); popup.dataset.content = markup; popup.querySelector('details').open = !!expanded;} position();}
  }
  // Read-only projections for alternate builds; original feed anchors stay mounted.
  window.NorthStarGeneratingStations = {
    telemetry: id => {const site=models.get(id)?.site;return site?model(site,true):null;},
    list: () => [...models.values()].map(existing => {
      const telemetry = model(existing.site, true);
      return telemetry.current ? telemetry : existing;
    }),
    open: openFull,
  };
  function init() {
    grid = document.querySelector('#overviewGeneratingStations .generating-stations-grid'); if (!grid) return;
    grid.replaceChildren();
    popup = document.createElement('section'); popup.id = 'generatingStationDetails'; popup.className = 'gs-popup'; popup.hidden = true;
    popup.setAttribute('role','dialog'); popup.setAttribute('aria-label','Station details'); document.body.append(popup);
    popupWindow = window.NorthStarHoverWindow(popup, 'Station details', close);
    const toolbar=popup.querySelector('.ns-hover-window-bar'),closeButton=toolbar.querySelector('button');
    toolbar.classList.add('gs-window-toolbar');toolbar.querySelector('span').textContent='';
    closeButton.innerHTML='<svg viewBox="0 0 16 16" aria-hidden="true"><path d="m4 4 8 8M12 4l-8 8"/></svg>';
    const saveButton=document.createElement('button');saveButton.type='button';saveButton.className='gs-window-save';saveButton.title='Save popup size to your profile';saveButton.setAttribute('aria-label','Save popup size to your profile');saveButton.innerHTML='<svg viewBox="0 0 16 16" aria-hidden="true"><path class="gs-icon-disk" d="M2 1h10l3 3v11H1V1z"/><path class="gs-icon-label" d="M4 1h7v5H4z"/><path class="gs-icon-paper" d="M4 9h8v6H4z"/><path class="gs-icon-slot" d="M6 10h4v3H6z"/></svg>';
    const minimizeButton=document.createElement('button');minimizeButton.type='button';minimizeButton.className='gs-window-minimize';minimizeButton.title='Minimize';minimizeButton.setAttribute('aria-label','Minimize');minimizeButton.innerHTML='<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 12h10"/></svg>';
    const maximizeButton=document.createElement('button');maximizeButton.type='button';maximizeButton.className='gs-window-maximize';maximizeButton.title='Maximize';maximizeButton.setAttribute('aria-label','Maximize');maximizeButton.innerHTML='<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="3" y="3" width="10" height="10"/></svg>';
    toolbar.insertBefore(saveButton,closeButton);toolbar.insertBefore(minimizeButton,closeButton);toolbar.insertBefore(maximizeButton,closeButton);
    toolbar.addEventListener('click',async event=>{
      const button=event.target.closest('button');if(!button||button===closeButton)return;
      event.stopPropagation();popupWindow.pin();
      if(button===minimizeButton){popup.classList.toggle('gs-window-minimized');popup.classList.remove('gs-window-maximized');return;}
      if(button===maximizeButton){popup.classList.toggle('gs-window-maximized');popup.classList.remove('gs-window-minimized');return;}
      if(button===saveButton){
        try{
          if(popupPreference.useSaved){await setPopupPreference({useSaved:false,savedSize:null});popup.style.width='';popup.style.height='';popup.classList.remove('gs-window-minimized','gs-window-maximized');position();}
          else {const rect=popup.getBoundingClientRect();await setPopupPreference({useSaved:true,savedSize:{width:Math.round(rect.width),height:Math.round(rect.height)}});saveButton.classList.add('is-saved');}
          saveButton.classList.toggle('is-saved',popupPreference.useSaved);saveButton.removeAttribute('aria-invalid');
        }catch{saveButton.setAttribute('aria-invalid','true');}
      }
    });
    popup.addEventListener('pointerdown', () => clearTimeout(closeTimer));
    popup.addEventListener('pointerenter', () => clearTimeout(closeTimer)); popup.addEventListener('pointerleave',deferClose);
    popup.addEventListener('click', e => {const jump=e.target.closest('[data-site-jump]');if(jump){openFull(jump.dataset.siteJump);return;}if(e.target.closest('.gs-close')) close();});
    document.addEventListener('keydown', e => {if(e.key === 'Escape' && active){const card = cards.get(active); if(popup.contains(document.activeElement)) card?.focus(); close();}});
    document.addEventListener('pointerdown', e => {if(!popupWindow.pinned && !popup.contains(e.target) && !e.target.closest('.gs-card')) close();});
    document.addEventListener('focusin', e => {if(!popupWindow.pinned && !popup.contains(e.target) && !e.target.closest('.gs-card')) close();});
    addEventListener('resize',position); addEventListener('scroll',position,true);
    popup.addEventListener('change',e=>{if(e.target.matches('.gs-range'))rangeHours=Number(e.target.value)||24;if(e.target.matches('.gs-units-toggle'))showUnits=e.target.checked;if(active){const id=active,markup=detail(models.get(id), true);popup.innerHTML=markup;popupWindow.restoreBar();popup.dataset.content=markup;popup.hidden=false;popup.querySelector('.gs-more').open=true;position();popup.querySelector(e.target.matches('.gs-range')?'.gs-range':'.gs-units-toggle')?.focus();}});
    fetch('/api/logbook?limit=250',{cache:'no-store'}).then(r=>r.ok?r.json():[]).then(rows=>{logbook=Array.isArray(rows)?rows:[];refresh();}).catch(()=>{});
    addEventListener('northstar:feed-update',refresh);
    addEventListener('northstar:build-view-change',()=>{
      cancelAnimationFrame(operationsViewFrame);
      operationsViewFrame=requestAnimationFrame(()=>{
        if(operationsLists.reduced!==reducedOperations())loadOperationsLists();
      });
    });
    addEventListener('northstar:site-page-open', event => {
      const id = event.detail?.siteId;
      if (!id || !models.has(id)) return;
      fullSite = id;
      renderFull(id);
    });
    addEventListener('northstar:test-input',event=>{const test=event.detail||{},value=Number(test.value);if(test.type!=='generation'||!finite(value))return;const requested=normalize(test.target).replace(/\s+gs$/,'');const site=baselineSites().find(item=>normalize(item.name)===requested||normalize(item.name).includes(requested)||requested.includes(normalize(item.name)));if(site){testOutputs.set(site.id,value);refresh();}});
    addEventListener('northstar:test-input-clear',()=>{testOutputs.clear();refresh();});
    window.NorthStarSites?.ready?.then(refresh); refresh(); setInterval(refresh,15000);
    setInterval(()=>{if(!document.hidden)loadOperationsLists();},30000);
  }
  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded',init); else init();
})();
