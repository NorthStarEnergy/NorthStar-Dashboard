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
    'site:cogeneration-plant': {code:'CG',name:'Cogeneration Plant',units:3,capacity:10,noWater:true},
    'site:aiyers-1': {code:'A1',name:'Aiyers 1',units:2,headwater:[155.222,155.775],capacity:10,outflow:[25,50]},
    'site:aiyers-2': {code:'A2',name:'Aiyers 2',units:2,headwater:[151.200,151.775],capacity:8,outflow:[25,50]},
    'site:bird-gs': {code:'B1',name:'Bird GS',units:2,headwater:[125.100,125.775],capacity:5,outflow:[25,75]},
    'site:cogent': {code:'B2',name:'Cogent',units:2,headwater:[120.150,120.775],capacity:5,outflow:[25,75]}
  });
  const STATION_GROUP_ORDER = [
    'site:twin-falls','site:island-falls','site:iroquois-falls-ts','site:iroquois-falls',
    'site:old-woman-falls','site:white-otter-rapids','site:camp-three-rapids','site:big-beaver-falls',
    'site:calm-lake','site:sturgeon-falls','site:fort-frances','site:fort-frances-ts',
    'site:kenora','site:norman','site:okikendawt-gs',
    'site:aiyers-1','site:aiyers-2','site:cogeneration-plant','site:mcdougal',
    'site:bird-gs','site:cogent'
  ];
  let grid, popup, popupWindow, active, closeTimer, openTimer, logbook=[];
  let rangeHours=24, showUnits=true;
  const cards = new Map(), models = new Map();
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
    const unitHistory = Array.from({length:25}, (_, index) => {
      const at = now - (24 - index) * 3600000, sample = sampleBaseline(baseline, at);
      return units.map(unit => ({n:unit.n,at,state:unit.n <= sample.running ? 'generating' : 'available'}));
    }).flat();
    const values = {output:current.output,capacity:baseline.capacity,headwater:current.headwater,outflow:current.outflow,running:current.running,total:baseline.units,available:1};
    const value = key => values[key] ?? null;
    return {site,baseline,readings,units,history,unitHistory,value,running:current.running,total:baseline.units,
      breaker:'closed',state:'generating',current:true};
  }
  function model(site) {
    if (USE_STATION_BASELINES && STATION_BASELINES[site.id]) return baselineModel(site, STATION_BASELINES[site.id]);
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
    const result = {site, readings, value};
    const integer = v => finite(v) && Number.isInteger(v) && v >= 0 ? v : null;
    result.total = integer(value('total')) ?? (site.id === 'site:twin-falls' ? 2 : null);
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
    result.current = readings.some(usable);
    return result;
  }
  function content(m) {
    const words = String(m.site.name || '').trim().split(/\s+/);
    const name = words.length === 3 ? `<span>${esc(words.slice(0,2).join(' '))}</span><span>${esc(words[2])}</span>` : esc(m.site.name);
    const flow = m.baseline?.noWater ? null : m.value('outflow');
    const spill = m.baseline?.noWater ? null : m.value('spill');
    return `<strong class="gs-name">${name}</strong>
      <span class="gs-generation"><span class="gs-generator-stack">${symbol(m.state, m.value('output'), m.value('capacity'))}<span class="gs-unit-count" aria-label="${fmt(m.running)} of ${fmt(m.total)} units running">${fmt(m.running)}/${fmt(m.total)}</span></span><span class="gs-generation-metrics"><b class="gs-output">${fmt(m.value('output'),2)}<em> MW</em></b><b class="gs-level">${m.baseline?.noWater ? '—' : `${fmt(m.value('headwater'),3)}<em> m</em>`}</b><span class="gs-units-line"><span class="gs-flow">${fmt(flow,0)}${spill !== null && Number(spill) > 0 ? `<i class="gs-spill">(${fmt(spill,0)})</i>` : ''}<em>m³/s</em></span></span></span></span>`;

  }
  function detail(m) {
    const metric = (label, key, unit, digits) => `<div><dt>${label}</dt><dd>${fmt(m.value(key),digits)} ${unit}</dd></div>`;
    const baseline = m.baseline;
    const waterMetrics = baseline?.noWater ? '' : `${metric('Outflow','outflow','m³/s',1)}${metric('Plant flow','flow','m³/s',1)}${metric('Spill','spill','m³/s',1)}${metric('Headwater','headwater','m',3)}${metric('Tailwater','tailwater','m',3)}`;
    const since=Date.now()-rangeHours*3600000,points=m.history.filter(p=>p.at>=since);
    const width=500,height=116,pad=28,values=points.map(p=>p.value),lo=values.length?Math.min(...values):0,hi=values.length?Math.max(...values):1,span=hi-lo||1;
    const coords=points.map(p=>({x:pad+(p.at-since)/(rangeHours*3600000)*(width-pad*2),y:height-pad-(p.value-lo)/span*(height-pad*2)}));
    const path=coords.map((p,i)=>`${i?'L':'M'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
    const intervals=[];if(showUnits){const byUnit=new Map();for(const p of m.unitHistory.filter(p=>p.at>=since)){const list=byUnit.get(p.n)||[];list.push(p);byUnit.set(p.n,list)}for(const [n,list] of byUnit)for(let i=0;i<list.length;i++){if(list[i].state!=='generating')continue;const end=list.slice(i+1).find(p=>p.state!=='generating')?.at??Date.now();intervals.push(`<span class="gs-run" style="left:${Math.max(0,(list[i].at-since)/(rangeHours*3600000)*100)}%;width:${Math.max(.5,Math.min(100,(end-list[i].at)/(rangeHours*3600000)*100))}%" title="Unit ${n} generating"></span>`);}}
    const logRows=logbook.filter(e=>String(e.subject||'').toLowerCase().includes(m.site.name.toLowerCase())||String(e.details||'').toLowerCase().includes(m.site.name.toLowerCase())).slice(0,5);
    return `<header><div><small>PLANT OVERVIEW</small><h2 id="gs-detail-title">${esc(m.site.name)}</h2></div><button type="button" class="gs-close" aria-label="Close plant details">×</button></header>
      <p class="gs-${m.state}">${labels[m.state]} · ${fmt(m.running)}/${fmt(m.total)} generators running</p>
      <div class="gs-plant"><div class="gs-reservoir">${baseline?.noWater ? 'No water · cogeneration plant' : `Headwater <b>${fmt(m.value('headwater'),3)} m</b>`}</div>
      <div class="gs-units">${m.units.length ? m.units.map(u => `<div class="gs-unit">${symbol(u.state)}<strong>Unit ${u.n}</strong><span>${u.state === 'unknown' ? 'Status unknown' : u.state}</span><b>${fmt(u.output,2)} MW</b><span class="gs-breaker">□ Breaker ${u.breaker}</span></div>`).join('') : '<p>Unit inventory unavailable</p>'}</div>
      <div class="gs-main-breaker">□ Main breaker: <b>${m.breaker}</b></div><small>Plant status overview · electrical topology not configured</small></div>
      <dl class="gs-detail-metrics">${metric('Output','output','MW',2)}${metric('Plant capacity','capacity','MW',1)}${metric('Efficiency','efficiency','%',1)}${waterMetrics}</dl>
      <section class="gs-history"><header><h3>Station output</h3><label>Range <select class="gs-range"><option value="1" ${rangeHours===1?'selected':''}>1 hour</option><option value="6" ${rangeHours===6?'selected':''}>6 hours</option><option value="24" ${rangeHours===24?'selected':''}>24 hours</option><option value="168" ${rangeHours===168?'selected':''}>7 days</option><option value="720" ${rangeHours===720?'selected':''}>30 days</option></select></label></header><label class="gs-toggle"><input type="checkbox" class="gs-units-toggle" ${showUnits?'checked':''}> Show unit run periods</label><div class="gs-chart">${points.length>1?`<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Station output over ${rangeHours} hours"><path class="gs-output-path" d="${path}"/><text x="2" y="14">${fmt(hi,1)} MW</text><text x="2" y="${height-4}">${fmt(lo,1)} MW</text></svg><div class="gs-run-track">${intervals.join('')||'<small>No unit status history</small>'}</div>`:points.length===1?`<p class="gs-source">${fmt(points[0].value,2)} MW at ${esc(new Date(points[0].at).toLocaleString())}. Historical trend and run periods require a time-series SCADA feed; the connected feed supplies latest values only.</p>`:'<p class="gs-source">No output points in this range. Historical trend and run periods require a time-series SCADA feed.</p>'}</div></section>
      <div class="gs-aux-grid"><section><h3>Gates & station service</h3>${m.readings.filter(r=>/gate|sluice|station service|log lifter/i.test(r.displayName||'')).map(r=>`<p><b>${esc(r.displayName)}</b><span>${esc(r.numericValue??r.textValue??'—')} ${esc(r.unit||'')}</span>`).join('')||`<p>${baseline ? 'No station auxiliary points reported.' : 'Not reported in the connected SCADA feed.'}</p>`}</section><section><h3>Station log</h3>${logRows.map(e=>`<p><b>${esc(e.type||'Log')}</b> ${esc(e.subject||'')}<small>${esc(e.timestamp||'')} · ${esc(e.details||'')}</small></p>`).join('')||'<p>No station-specific log entries found.</p>'}</section></div>
      ${baseline ? '' : `<p class="gs-source">${m.current ? 'Qualified report readings · missing measurements shown as —' : 'Current qualified telemetry unavailable · measurements shown as —'}</p>`}
      <details><summary>Reported plant points (${m.readings.length})</summary>${m.readings.length ? m.readings.map(r => `<div class="gs-point"><strong>${esc(r.displayName || r.tagName)}</strong><span>${esc(r.numericValue ?? r.textValue ?? '—')} ${esc(r.unit)}</span><small>${baseline ? esc(r.observedAt || 'Time unknown') : `${esc(r.sourceQuality || 'Unqualified')} · ${esc(r.observedAt || 'Time unknown')}`}</small></div>`).join('') : '<p>No mapped plant readings.</p>'}</details>`;
  }
  function position() {
    if (!active || popup.hidden) return;
    if (popupWindow?.pinned) return;
    const box = cards.get(active)?.getBoundingClientRect();
    if (!box || !cards.get(active).getClientRects().length) return close();
    window.NorthstarPositionPreview(popup, cards.get(active));
  }
  function close() {
    clearTimeout(openTimer); clearTimeout(closeTimer);
    if (active) cards.get(active)?.setAttribute('aria-expanded','false');
    active = null; if (popup) popup.hidden = true; popupWindow?.reset();
  }
  function open(id) {
    if (document.body.classList.contains('layout-edit')) return;
    if (popupWindow?.pinned) return;
    clearTimeout(closeTimer);
    if (active !== id) close();
    active = id; const markup = detail(models.get(id)); popup.innerHTML = markup; popupWindow.restoreBar(); popup.dataset.content = markup; popup.hidden = false;
    cards.get(id).setAttribute('aria-expanded','true'); position();
  }
  let fullSite = '';
  function openFull(id) {
    clearTimeout(openTimer); close(); fullSite = id;
    let full = document.getElementById('generatingStationFull');
    if (!full) {
      full = document.createElement('article'); full.id = 'generatingStationFull';
      full.className = 'panel gs-full-detail'; full.dataset.moduleId = 'station-detail';
      document.getElementById('scada').append(full);
      full.addEventListener('change', event => {
        if(event.target.matches('.gs-range'))rangeHours=Number(event.target.value)||24;
        if(event.target.matches('.gs-units-toggle'))showUnits=event.target.checked;
        renderFull();
      });
    }
    renderFull();
    window.NorthstarModules?.refresh();
    requestAnimationFrame(() => window.NorthstarModules?.open('scada:station-detail'));
  }
  function renderFull() {
    const full=document.getElementById('generatingStationFull');
    if(!fullSite || !full || !models.has(fullSite))return;
    const markup=detail(models.get(fullSite)).replace('id="gs-detail-title"','id="gs-full-title"');
    if(full.dataset.content!==markup){full.innerHTML=markup;full.querySelector('.gs-close')?.remove();full.dataset.content=markup;}
  }
  function deferClose() {clearTimeout(openTimer); if(popupWindow?.pinned)return; closeTimer = setTimeout(() => {if(popup.matches(':hover') || popup.contains(document.activeElement))return;close();}, 250);}
  function refresh() {
    if (!grid) return;
    const sites = (USE_STATION_BASELINES ? baselineSites() : (window.NorthStarSites?.stations() || []))
      .sort((a,b) => {
        const ai=STATION_GROUP_ORDER.indexOf(a.id), bi=STATION_GROUP_ORDER.indexOf(b.id);
        return (ai<0?STATION_GROUP_ORDER.length:ai)-(bi<0?STATION_GROUP_ORDER.length:bi);
      });
    sites.forEach(site => {
      const m = model(site); models.set(site.id,m);
      let card = cards.get(site.id);
      if (!card) {
        card = document.createElement('article'); card.tabIndex = 0; card.setAttribute('role','button'); card.className = 'gs-card'; card.dataset.moduleId = site.id;
        const body = document.createElement('div'); body.className = 'gs-card-body'; card.append(body);
        card.setAttribute('aria-controls','generatingStationDetails'); card.setAttribute('aria-expanded','false'); card.setAttribute('aria-haspopup','dialog');
        card.addEventListener('pointerenter', () => {if(popupWindow?.pinned)return;clearTimeout(closeTimer); openTimer = setTimeout(() => open(site.id), window.NORTHSTAR_MODULE_HOVER_DELAY);});
        card.addEventListener('pointerleave',deferClose);
        card.addEventListener('focus', () => open(site.id));
        card.addEventListener('click', event => {if(!event.target.closest('button')&&!document.body.classList.contains('layout-edit'))openFull(site.id);});
        card.addEventListener('keydown', e => {if(e.target!==card || document.body.classList.contains('layout-edit'))return;if(['Enter',' '].includes(e.key)){openFull(site.id);e.preventDefault();}if(e.key === 'ArrowDown'){open(site.id);popup.querySelector('button')?.focus();e.preventDefault();}});
        grid.append(card); cards.set(site.id,card);
      }
      const markup = content(m);
      if (card.dataset.content !== markup) {card.querySelector('.gs-card-body').innerHTML = markup; card.dataset.content = markup;}
      card.setAttribute('aria-label',`${site.name}: ${labels[m.state]}. View plant details`);
    });
    renderFull();
    if (active) {const markup = detail(models.get(active)); if (popup.dataset.content !== markup) {const expanded = popup.querySelector('details')?.open; popup.innerHTML = markup; popupWindow.restoreBar(); popup.dataset.content = markup; popup.querySelector('details').open = !!expanded;} position();}
  }
  function init() {
    grid = document.querySelector('#overviewGeneratingStations .generating-stations-grid'); if (!grid) return;
    grid.replaceChildren();
    popup = document.createElement('section'); popup.id = 'generatingStationDetails'; popup.className = 'gs-popup'; popup.hidden = true;
    popup.setAttribute('role','dialog'); popup.setAttribute('aria-labelledby','gs-detail-title'); document.body.append(popup);
    popupWindow = window.NorthStarHoverWindow(popup, 'Plant overview', close);
    popup.addEventListener('pointerdown', () => clearTimeout(closeTimer));
    popup.addEventListener('pointerenter', () => clearTimeout(closeTimer)); popup.addEventListener('pointerleave',deferClose);
    popup.addEventListener('click', e => {if(e.target.closest('.gs-close')) close();});
    document.addEventListener('keydown', e => {if(e.key === 'Escape' && active){const card = cards.get(active); if(popup.contains(document.activeElement)) card?.focus(); close();}});
    document.addEventListener('pointerdown', e => {if(!popupWindow.pinned && !popup.contains(e.target) && !e.target.closest('.gs-card')) close();});
    document.addEventListener('focusin', e => {if(!popupWindow.pinned && !popup.contains(e.target) && !e.target.closest('.gs-card')) close();});
    addEventListener('resize',position); addEventListener('scroll',position,true);
    popup.addEventListener('change',e=>{if(e.target.matches('.gs-range'))rangeHours=Number(e.target.value)||24;if(e.target.matches('.gs-units-toggle'))showUnits=e.target.checked;if(active){const id=active,markup=detail(models.get(id));popup.innerHTML=markup;popupWindow.restoreBar();popup.dataset.content=markup;popup.hidden=false;position();popup.querySelector(e.target.matches('.gs-range')?'.gs-range':'.gs-units-toggle')?.focus();}});
    fetch('/api/logbook?limit=250',{cache:'no-store'}).then(r=>r.ok?r.json():[]).then(rows=>{logbook=Array.isArray(rows)?rows:[];refresh();}).catch(()=>{});
    addEventListener('northstar:feed-update',refresh);
    window.NorthStarSites?.ready?.then(refresh); refresh(); setInterval(refresh,15000);
  }
  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded',init); else init();
})();
