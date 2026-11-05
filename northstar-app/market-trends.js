/* Market analysis uses only the readings present in the current feed snapshot. */
(() => {
  'use strict';
  const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const stamp = t => new Date(t).toLocaleString('en-CA', {timeZone:'America/Toronto',month:'short',day:'numeric',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
  const number = n => Number.isFinite(n) ? n.toFixed(2) : '—';
  const fields = [['rt','Historical real-time price','history'],['da','DA price','daHistory'],['forward','Future DA price','forward'],['rtForecast','Predispatch price outlook','rtForecast'],['demand','Real-time demand','history'],['demandForecast','Demand forecast','forecastSeries']];
  const colors = {rt:'#f2b84b',da:'#287fbd',forward:'#79caff',rtForecast:'#f4dd91',demand:'#9bdfac',demandForecast:'#dba5f5'};
  function normalize(points = []) {
    const byTime = new Map();
    points.forEach(p => {
      const t = Date.parse(p.time), value = Number(p.value);
      if (p.value != null && p.value !== '' && Number.isFinite(t) && Number.isFinite(value)) byTime.set(t,{time:t,value,count:1});
    });
    return [...byTime.values()].sort((a,b) => a.time-b.time);
  }
  function aggregate(points, interval) {
    const size = {hour:3600000,day:86400000}[interval];
    if (!size) return points;
    const buckets = new Map();
    points.forEach(p => {
      const t = Math.floor(p.time/size)*size;
      const b = buckets.get(t) || {time:t,value:0,count:0};
      b.value += p.value; b.count++; buckets.set(t,b);
    });
    return [...buckets.values()].map(b => ({...b,value:b.value/b.count}));
  }
  function subtract(left, right) {
    const values = new Map(right.map(p => [p.time,p.value]));
    return left.filter(p => values.has(p.time)).map(p => ({...p,value:p.value-values.get(p.time)}));
  }
  function build(data, state) {
    const selected = [state.primary,...state.compare].filter((k,i,a) => k && a.indexOf(k)===i);
    let series = [];
    if (state.mode === 'demand') {
        fields.filter(([kind]) => ['demand','demandForecast'].includes(kind) && state.kinds.includes(kind)).forEach(([kind,label,field]) => {
        const readings = [...(data.ontario?.[field] || [])];
        const current = data.ontario?.demandCurrent;
        if (kind === 'demand' && current?.time && current.value != null) readings.push(current);
        series.push({id:'IESO:'+kind,node:'IESO',label:'Ontario · '+label,color:colors[kind],dash:kind==='demandForecast'?[10,4]:[],points:normalize(readings)});
      });
    } else for (const key of selected) {
      const node = data.nodes?.[key] || {};
      if (state.mode === 'spread') {
        const da = normalize([...(node.daHistory || node.da_history || []),...(node.forward || [])]);
        series.push({id:key+':spread',node:key,label:key+' · RT − DA',color:colors.rt,dash:[],points:subtract(normalize(node.history),da)});
      } else {
        fields.filter(([kind]) => ['rt','da','forward','rtForecast'].includes(kind) && state.kinds.includes(kind)).forEach(([kind,label,field]) => {
          const source = field==='daHistory' ? (node.daHistory || node.da_history) : field==='rtForecast' ? (node.rtForecast || node.rt_forecast || []) : node[field];
          series.push({id:key+':'+kind,node:key,label:key+' · '+label,color:colors[kind],dash:['forward','rtForecast'].includes(kind)?[10,4]:[],points:normalize(source)});
        });
      }
    }
    const available = series.flatMap(s => s.points.map(p => p.time));
    const first = available.length ? Math.min(...available) : null, last = available.length ? Math.max(...available) : null;
    let from = -Infinity, to = Infinity, error = '';
    if (state.range === 'custom') {
      from = state.from ? Date.parse(state.from+'Z') : -Infinity;
      to = state.to ? Date.parse(state.to+'Z') : Infinity;
      if (Number.isNaN(from) || Number.isNaN(to) || from>to) error = 'Enter a valid start and end time, with start before end.';
    } else if (state.range !== 'all' || Number(state.windowHours) > 0 || Number(state.symmetricWindowHours) > 0) {
      const reported = Date.parse(data.updated), suppliedAnchor = Number(data.windowAnchor);
      const anchor = Number.isFinite(suppliedAnchor) ? suppliedAnchor : reported;
      const origin = data.liveWindow ? (Number.isFinite(anchor) ? anchor : Date.now()) : Number.isFinite(anchor) ? anchor : last;
      if (Number(state.symmetricWindowHours) > 0) {from=origin-Number(state.symmetricWindowHours)*3600000;to=origin+Number(state.symmetricWindowHours)*3600000;}
      else if (state.range === 'all' && Number(state.windowHours) > 0) {from=origin-Number(state.windowHours)*3600000;to=origin+Number(state.windowHours)*3600000;}
      else if (state.range.startsWith('next')) {from=origin;to=origin+Number(state.range.slice(4))*3600000;}
      else {to=origin;from=to-Number(state.range)*3600000;}
    }
    series = series.map(s => ({...s,points:error ? [] : aggregate(s.points.filter(p => p.time>=from && p.time<=to),state.interval)}));
    if (state.scenario && state.mode === 'price' && Number.isFinite(Number(state.scenarioPercent))) {
      const percent = Number(state.scenarioPercent);
      series = series.flatMap(s => [s, {...s, id:s.id+':scenario', label:s.label+' · SCENARIO '+percent+'% price change', dash:[6,3], points:s.points.map(p => ({...p,value:p.value*(1+percent/100)}))}]);
    }
    const rolling = Number(state.rolling);
    if (rolling>1) series = series.flatMap(s => [s,{...s,id:s.id+':mean',label:s.label+' · '+rolling+'-point mean',dash:[2,3],points:s.points.slice(rolling-1).map((p,i) => ({time:p.time,value:s.points.slice(i,i+rolling).reduce((sum,v)=>sum+v.value,0)/rolling,count:s.points.slice(i,i+rolling).reduce((sum,v)=>sum+v.count,0),windowPoints:rolling}))}]);
    return {series,first,last,error};
  }
  function csv(series, state) {
    const quote = v => '"'+String(v).replace(/"/g,'""')+'"';
    const unit = state.mode==='demand' ? 'value_mw' : 'value_cad_per_mwh';
    const rows = [['timestamp_utc','timestamp_eastern','node','series',unit,'source_sample_count','moving_window_points','aggregation']];
    series.forEach(s => s.points.forEach(p => rows.push([new Date(p.time).toISOString(),stamp(p.time),s.node,s.label,p.value,p.count,p.windowPoints||'',state.interval])));
    return '\uFEFF'+rows.map(row=>row.map(quote).join(',')).join('\r\n');
  }
  const states = new Map(), controllers = new WeakMap();
  function mount(host, data, primary, refresh, options = {}) {
    const existing = controllers.get(host);
    if (existing) {existing.update(data,primary,options);return;}
    const identity = options.identity || host.closest('[id]')?.id || primary;
    let state = states.get(identity) || {primary,compare:options.compare || [],mode:options.mode || 'price',kinds:options.kinds || ['rt','da','forward'],range:'all',timeScale:'hour',periodLength:'24',windowHours:options.windowHours || 0,symmetricWindowHours:options.symmetricWindowHours || 0,from:'',to:'',interval:'raw',rolling:'0',scale:options.scale || 'auto'};
    state.primary = primary; states.set(identity,state);
    if (options.kinds) state.kinds = [...options.kinds];
    if (options.windowHours) state.windowHours = options.windowHours;
    const overview = !!host.closest('#overviewMarketMini');
    let inspecting = false, hoverTimer = null, hoverTarget = null;
    let currentPrices = options.currentPrices || null;
    let model, cursor = null, cursorTime = null, pinned = false, points = [], plot;
    let liveData = data, archiveData = null, archiveRequest = null;
    host.classList.add('market-trends');
    host.innerHTML = `<div class="mt-controls">
      <label>View<select data-setting="mode"><option value="price">Prices · $/MWh</option><option value="demand">Ontario demand · MW</option><option value="spread">RT − DA spread · $/MWh</option></select></label>
      <label>Period<select data-setting="range"><option value="all">All available</option><option value="6">Last 6 hours</option><option value="24">Last 24 hours</option><option value="72">Last 3 days</option><option value="168">Last 7 days</option><option value="custom">Custom period (UTC)</option></select></label>
      <label>Time scale<select data-setting="timeScale"><option value="hour">Hours</option><option value="day">Days</option></select></label>
      <label>Period length<input type="number" min="1" max="168" step="1" data-setting="periodLength" aria-label="Period length"></label>
      <label>Resolution<select data-setting="interval"><option value="raw">Reported readings</option><option value="hour">Hourly mean (UTC buckets)</option><option value="day">Daily mean (UTC buckets)</option></select></label>
      <label>Y-axis<select data-setting="scale"><option value="auto">Automatic scale</option><option value="zero">Include zero</option></select></label>
      <label>Trend<select data-setting="rolling"><option value="0">No moving average</option><option value="3">3-point moving average</option><option value="6">6-point moving average</option></select></label>
      <button type="button" data-action="refresh">Refresh feed</button><button type="button" data-action="export">Export CSV</button>
      </div><div class="mt-dates" hidden><label>From (UTC)<input type="datetime-local" data-setting="from"></label><label>To (UTC)<input type="datetime-local" data-setting="to"></label></div>
      ${options.overviewWindow ? '<div class="mt-overview-window"><label>Visible window <select data-setting="symmetricWindowHours" aria-label="Overview market chart visible window"><option value="2">4 h</option><option value="4">8 h</option><option value="6">12 h</option><option value="12">24 h</option></select></label><small>Past and upcoming market outlook are split at now.</small></div>' : ''}
      <div class="mt-selectors"><fieldset class="mt-nodes"><legend>Compare price nodes</legend><div></div></fieldset><fieldset class="mt-kinds"><legend>Overlay series</legend>${fields.map(([kind,label])=>`<label><input type="checkbox" data-kind="${kind}">${label}</label>`).join('')}</fieldset></div>
      <p class="mt-status"></p><div class="mt-legend"></div><canvas class="market-price-chart" tabindex="0" role="img" aria-label="Market trends. Arrow keys inspect data points; Enter pins a point; Escape releases it."></canvas>
      <div class="mt-inspection" aria-live="polite"></div><div class="mt-point-actions"><button type="button" data-action="export-point" disabled>Export selected point CSV</button><span class="mt-copy-status" role="status"></span></div><p class="mt-help">Hover or tap to inspect · click to pin · arrow keys step through timestamps · Enter pins · Escape releases. Values match the selected timestamp exactly; no interpolation.</p>
      <div class="mt-table-wrap"><table class="mt-stats"><caption>Selected window · arithmetic statistics ($/MWh)</caption><thead><tr><th>Series</th><th>Points</th><th>Latest</th><th>Minimum</th><th>Mean</th><th>Maximum</th><th>First → last Δ</th></tr></thead><tbody></tbody></table></div>
      <details class="mt-readings"><summary>Explore / copy data points</summary><label>Filter readings<input class="mt-search" type="search" placeholder="Node, series, date or price"></label><p class="mt-count"></p><div class="mt-table-wrap mt-data"><table><thead><tr><th>Timestamp (Eastern)</th><th>Node / series</th><th>$/MWh</th><th>Samples</th></tr></thead><tbody></tbody></table></div></details>`;
    const $ = selector => host.querySelector(selector);
    if (host.closest('#overviewMarket')) {
      const yesterday = new Date(Date.now()-86400000-5*3600000).toISOString().slice(0,10);
      host.insertAdjacentHTML('afterbegin', `<section class="market-history-pull"><h3>Historical data</h3><div class="mt-history-dates"><label>From (IESO EST)<input type="date" data-history-from min="2025-05-01" max="${yesterday}" value="${yesterday}"></label><label>Through (IESO EST)<input type="date" data-history-to min="2025-05-01" max="${yesterday}" value="${yesterday}"></label><button type="button" data-history-load>Pull historical data</button><button type="button" data-history-clear>Use current report</button></div><p data-history-status role="status">Select up to 7 completed days. Availability depends on IESO report retention. Price history only; charts display local Eastern time.</p></section>`);
      $('[data-history-load]').onclick = async () => {
        const from = $('[data-history-from]'), to = $('[data-history-to]');
        const start = Date.parse(from.value+'T00:00:00Z'), end = Date.parse(to.value+'T00:00:00Z');
        const count = (end-start)/86400000+1, status = $('[data-history-status]');
        if (!from.value || !to.value || !from.reportValidity() || !to.reportValidity() || !Number.isFinite(count) || count<1 || count>7) {status.textContent='Choose a valid range of 1–7 completed days.';return;}
        archiveRequest?.abort(); const request = archiveRequest = new AbortController();
        const button = $('[data-history-load]'); button.disabled=true;
        const snapshots = [], failures = [];
        try {
          for (let index=0; index<count; index++) {
            const date = new Date(start+index*86400000).toISOString().slice(0,10);
            status.textContent=`Pulling ${date} · ${index+1} of ${count} days…`;
            const timeout = setTimeout(()=>request.abort(),240000);
            try {
              const response = await fetch('/api/market-history?date='+encodeURIComponent(date), {signal:request.signal});
              const result = await response.json();
              if (!response.ok) throw new Error(result.error || 'History service unavailable');
              snapshots.push(result);
            } catch (error) {
              if (request.signal.aborted) throw error;
              failures.push(date+': '+error.message);
            } finally {clearTimeout(timeout);}
          }
          if (!snapshots.length) throw new Error(failures.join(' · ') || 'No archived readings available.');
          const combined = {historical:true,updated:new Date().toISOString(),nodes:{},ontario:{},sources:[],missing:[],partial:failures.length>0};
          for (const snapshot of snapshots) {
            combined.sources.push(...(snapshot.sources || [])); combined.missing.push(...(snapshot.missing || [])); combined.partial ||= snapshot.partial;
            for (const [key,node] of Object.entries(snapshot.nodes || {})) {
              const target = combined.nodes[key] ||= {history:[],daHistory:[],forward:[]};
              for (const field of ['history','daHistory']) target[field].push(...(node[field] || []));
            }
          }
          archiveData = data = combined; state.range='all'; state.scenario=false;
          state.mode='price'; state.kinds=['rt','da']; cursor=null; cursorTime=null; pinned=false; syncControls(); render();
          $('[data-scenario-status]').textContent='';
          status.textContent=`Loaded ${snapshots.length} of ${count} days · ${combined.sources.length} source reports.${combined.partial?' INCOMPLETE: some reports or readings are missing.':''}${failures.length?' '+failures.join(' · '):''}`;
        } catch (error) {
          if (archiveRequest===request) status.textContent=`Historical pull failed: ${error.message}. Previous chart retained.`;
        } finally {if(archiveRequest===request){archiveRequest=null;button.disabled=false;}}
      };
      $('[data-history-clear]').onclick = () => {
        archiveRequest?.abort(); archiveRequest=null; $('[data-history-load]').disabled=false;
        archiveData=null; data=liveData; state.range='all'; state.scenario=false; state.kinds=['rt','da','forward','rtForecast'];
        syncControls(); render(); $('[data-history-status]').textContent='Showing current feed report. Older history is no longer selected.';
        $('[data-scenario-status]').textContent='';
      };
      host.insertAdjacentHTML('beforeend', '<section class="market-detail-section mt-scenario"><h3>PRICE SCENARIO</h3><p>Apply a percentage change to the selected price series. Source readings stay unchanged. A percentage increase makes negative prices more negative.</p><label>Price change (%) <input type="number" min="-100" max="1000" step="1" value="10" data-scenario-percent></label> <button type="button" data-scenario-run>Run simulation</button> <button type="button" data-scenario-reset>Clear simulation</button><p data-scenario-status role="status"></p></section>');
      $('[data-scenario-run]').onclick = () => {
        const input = $('[data-scenario-percent]');
        if (!input.value || !input.reportValidity()) return;
        state.scenario = true; state.scenarioPercent = Number(input.value);
        state.mode = 'price'; state.kinds = ['rt','da','forward']; syncControls(); render();
        $('[data-scenario-status]').textContent = 'Scenario shown as dashed lines and labelled SCENARIO in CSV exports.';
      };
      $('[data-scenario-reset]').onclick = () => { state.scenario = false; render(); $('[data-scenario-status]').textContent = 'Simulation cleared.'; };
    }
    const canvas = $('canvas');
    const tooltip = document.createElement('div');
    tooltip.className = 'mt-line-tooltip'; tooltip.hidden = true; tooltip.setAttribute('role','tooltip');
    const updatedLabel = document.createElement('small'); updatedLabel.className = 'mt-updated';
    if (overview) host.append(tooltip, updatedLabel);
    function clearHover() { clearTimeout(hoverTimer); hoverTarget = null; tooltip.hidden = true; }
    function pointAt(series, time) {
      const point = series?.points.reduce((best,p)=>!best||Math.abs(p.time-time)<Math.abs(best.time-time)?p:best,null);
      return point && Math.abs(point.time-time)<=3600000 ? point : null;
    }

    function syncControls() {
      host.querySelectorAll('[data-setting]').forEach(el => el.value = state[el.dataset.setting] ?? (el.dataset.setting==='scale'?'auto':''));
      host.querySelectorAll('[data-kind]').forEach(el => el.checked = state.kinds.includes(el.dataset.kind));
      $('.mt-dates').hidden = state.range!=='custom';
      $('.mt-kinds').disabled = state.mode==='spread';
      host.querySelectorAll('[data-kind]').forEach(el=>{el.closest('label').hidden=state.mode==='demand'?!['demand','demandForecast'].includes(el.dataset.kind):!['rt','da','forward','rtForecast'].includes(el.dataset.kind);});
      const keys = Object.keys(data.nodes || {});
      $('.mt-nodes div').innerHTML = keys.map(key=>`<label><input type="checkbox" data-node="${escape(key)}" ${key===primary||state.compare.includes(key)?'checked':''} ${key===primary?'disabled':''}>${escape(key)}${key===primary?' (primary)':''}</label>`).join('');
      $('.mt-nodes').disabled=state.mode==='demand';
      $('[data-setting="mode"] option[value="demand"]').disabled=!!archiveData;
    }
    function rows() {
      const query = $('.mt-search').value.toLowerCase();
      const all = model.series.flatMap(s => s.points.map(p => ({...p,label:s.label}))).sort((a,b)=>b.time-a.time);
      const matching = all.filter(p => `${stamp(p.time)} ${new Date(p.time).toISOString()} ${p.label} ${p.value}`.toLowerCase().includes(query));
      $('.mt-count').textContent = `${matching.length} matching readings${matching.length>1000?' (first 1,000 shown)':''}. CSV includes all charted readings, regardless of this text filter.`;
      $('.mt-data tbody').innerHTML = matching.slice(0,1000).map(p=>`<tr><td title="${new Date(p.time).toISOString()}">${stamp(p.time)}</td><td>${escape(p.label)}</td><td>${number(p.value)}</td><td>${p.count}</td></tr>`).join('');
    }
    function inspect() {
      $('[data-action="export-point"]').disabled = cursor == null || !points.length;
      if (cursorTime == null || !points.length) {$('.mt-inspection').textContent = 'Move across the graph to inspect RT and DA prices.';return;}
      const t = cursorTime;
      const unit=state.mode==='demand'?' MW':' $/MWh';
      const priceReadout = ['rt', 'da'].flatMap(kind => model.series.filter(series => series.id.endsWith(':'+kind)).map(series => {
        const value = series.points.reduce((best, point) => !best || Math.abs(point.time-t)<Math.abs(best.time-t) ? point : best, null);
        return `<span><b>${kind.toUpperCase()} ${escape(series.node)}</b> ${value && Math.abs(value.time-t)<=3600000 ? number(value.value)+unit : '— no reading'}</span>`;
      })).join('');
      $('.mt-inspection').innerHTML = `<strong>${pinned?'Pinned · ':''}${stamp(t)}</strong><small>${new Date(t).toISOString()}</small><div>${priceReadout || model.series.map(s=>{const p=s.points.find(v=>v.time===t);return `<span><b>${escape(s.label)}</b> ${p?number(p.value)+unit:'— no reading'}</span>`;}).join('')}</div>`;
    }
    function paint() {
      const width = Math.floor(canvas.getBoundingClientRect().width);
      if (width<1) return;
      const mini = !!host.closest('#overviewMarketMini');
      const height = mini ? Math.max(60, Math.round(host.getBoundingClientRect().height)) : options.height || (options.compact?190:width<500?280:350), dpr = window.devicePixelRatio||1;
      canvas.width=width*dpr;canvas.height=height*dpr;canvas.style.height=height+'px';
      const c=canvas.getContext('2d');c.setTransform(dpr,0,0,dpr,0,0);
      const theme=getComputedStyle(host), muted=theme.getPropertyValue('--muted').trim()||'#9eafb9';
      c.font='11px system-ui';c.fillStyle=muted;
      const all=model.series.flatMap(s=>s.points);
      if (!all.length) {c.textAlign='center';c.fillText(model.error?'Check the selected date range':'No readings match these settings',width/2,height/2);canvas.setAttribute('aria-label','No readings match these settings.');plot=null;return;}
      const values=all.map(p=>p.value), minV=Math.min(...values), maxV=Math.max(...values), rtSeries=model.series.find(s=>s.id.endsWith(':rt')), daSeries=model.series.find(s=>s.id.endsWith(':da')), rtNow=rtSeries?.points.at(-1)?.value, daNow=daSeries?.points.at(-1)?.value, pad=Math.max(1,(maxV-minV)*.1), high=Math.max(maxV+pad,rtNow??-Infinity,daNow??-Infinity,currentPrices?.rt??-Infinity,currentPrices?.da??-Infinity), low=state.scale==='zero'&&state.mode!=='spread'?Math.min(0,minV-pad):Math.min(minV-pad,currentPrices?.rt??Infinity,currentPrices?.da??Infinity);
      const axisText=v=>mini ? new Intl.NumberFormat('en-CA',{maximumFractionDigits:state.mode==='demand'?0:1}).format(v) : v.toFixed(1);
      const left=mini?Math.max(52,c.measureText(axisText(low)).width+26,c.measureText(axisText(high)).width+26):Math.max(options.compact?38:58,c.measureText(low.toFixed(1)).width+(options.compact?10:16)),right=width-(mini?14:options.compact?6:16),top=mini?Math.max(28,$('.mt-legend').getBoundingClientRect().height+12):options.legendInside?30:options.compact?14:24,bottom=height-(mini?28:options.compact?28:48);
      const start=points[0],end=points.at(-1),x=t=>start===end?(left+right)/2:left+(t-start)/(end-start)*(right-left),y=v=>bottom-(v-low)/(high-low)*(bottom-top);
      plot={left,right,top,bottom,start,end,x,y};
      c.save();c.translate(12,(top+bottom)/2);c.rotate(-Math.PI/2);c.textAlign='center';c.fillText(state.mode==='demand'?'MW':'$/MWh',0,0);c.restore();c.textAlign='right';
      for(let i=0;i<=4;i++){const v=high-(high-low)*i/4;c.strokeStyle=theme.getPropertyValue('--line').trim()||'#2b3c46';c.lineWidth=1;c.globalAlpha=mini?.45:1;c.beginPath();c.moveTo(left,y(v));c.lineTo(right,y(v));c.stroke();c.globalAlpha=1;c.fillText(axisText(v),left-8,y(v)+4);}
      if(low<0&&high>0){c.strokeStyle=muted;c.setLineDash([3,4]);c.beginPath();c.moveTo(left,y(0));c.lineTo(right,y(0));c.stroke();c.setLineDash([]);}
      const tickCount=mini?Math.max(1,Math.floor((right-left)/76)):Math.max(1,Math.floor((right-left)/145))*2;
      const indices=[...new Set(Array.from({length:tickCount+1},(_,i)=>Math.round(i*(points.length-1)/tickCount)))];
      indices.forEach((idx,i)=>{const tickTime=mini?start+(end-start)*i/(indices.length-1||1):points[idx];c.textAlign=i===0?'left':i===indices.length-1?'right':'center';c.fillStyle=muted;c.fillText(mini?new Intl.DateTimeFormat('en-CA',{timeZone:'America/Toronto',hour:'2-digit',minute:'2-digit',hour12:false}).format(tickTime):stamp(points[idx]),x(tickTime),height-10);});
      model.series.forEach(s=>{
        c.strokeStyle=s.color;c.fillStyle=s.color;c.lineWidth=s.id.endsWith(':mean')?2.5:1.8;c.lineJoin='round';c.setLineDash(s.dash);
        // Break missing intervals rather than drawing a false continuous trend.
        const gaps=s.points.slice(1).map((p,i)=>p.time-s.points[i].time).sort((a,b)=>a-b), cadence=gaps[Math.floor(gaps.length/2)]||Infinity;
        c.beginPath();s.points.forEach((p,i)=>{if(!i||p.time-s.points[i-1].time>cadence*1.8)c.moveTo(x(p.time),y(p.value));else c.lineTo(x(p.time),y(p.value));});c.stroke();c.setLineDash([]);
        s.points.filter((p,i)=>!mini||s.points.length===1||s.id.endsWith(':demandCurrent')||i===s.points.length-1).forEach(p=>{c.beginPath();c.arc(x(p.time),y(p.value),s.id.endsWith(':demandCurrent')?4:2,0,Math.PI*2);c.fill();});
      });
      function priceLabels(time, entries, prefix='') {
        const cx=x(time);
        if(cx<left||cx>right)return;
        const items=entries.filter(e=>e.value!=null&&Number.isFinite(Number(e.value))).sort((a,b)=>Number(b.value)-Number(a.value));
        const labels=items.map(e=>({...e,text:`${prefix}${e.kind} $${number(Number(e.value))}`,py:y(Number(e.value))}));
        labels.forEach((e,i)=>{e.ly=Math.max(top+2,Math.min(bottom-16,e.py-8));if(i)e.ly=Math.max(e.ly,labels[i-1].ly+18);});
        if(labels.length){const overflow=Math.max(0,labels.at(-1).ly+16-bottom);labels.forEach(e=>e.ly-=overflow);}
        c.font='700 9px monospace';
        labels.forEach(e=>{
          const w=c.measureText(e.text).width+8,lx=Math.max(left,Math.min(right-w,cx+w+7<right?cx+7:cx-w-7));
          c.fillStyle=e.color;c.beginPath();c.arc(cx,e.py,3,0,Math.PI*2);c.fill();
          c.fillStyle='#101a20';c.fillRect(lx,e.ly,w,16);c.strokeStyle=e.color;c.lineWidth=1;c.strokeRect(lx,e.ly,w,16);
          c.fillStyle=e.color;c.textAlign='left';c.fillText(e.text,lx+4,e.ly+11);
        });
      }
      if(overview&&currentPrices&&Number.isFinite(currentPrices.time)&&options.compact){
        priceLabels(currentPrices.time,[{kind:'RT',value:currentPrices.rt,color:colors.rt},{kind:'DA',value:currentPrices.da,color:colors.da}],'Now ');
      } else if(currentPrices&&Number.isFinite(currentPrices.time)&&options.compact){
        const currentX=x(currentPrices.time);
        if(currentX>=left&&currentX<=right){
          c.strokeStyle='#d6e0e688';c.lineWidth=1;c.setLineDash([]);c.beginPath();c.moveTo(currentX,top);c.lineTo(currentX,bottom);c.stroke();
          if(currentPrices.rt!=null&&Number.isFinite(Number(currentPrices.rt))){
            const priceY=y(Number(currentPrices.rt)),label=`$${number(Number(currentPrices.rt))}`;c.fillStyle='#f2b84b';c.beginPath();c.arc(currentX,priceY,3.5,0,Math.PI*2);c.fill();
            c.font='700 9px monospace';const labelWidth=c.measureText(label).width+8,labelX=currentX+labelWidth+7<right?currentX+7:currentX-labelWidth-7,labelY=Math.max(top+3,Math.min(bottom-17,priceY-9));
            c.fillStyle='#101a20';c.fillRect(labelX,labelY,labelWidth,16);c.strokeStyle='#f2b84b';c.lineWidth=1;c.strokeRect(labelX,labelY,labelWidth,16);c.fillStyle='#f2d486';c.textAlign='left';c.fillText(label,labelX+4,labelY+11);
          }
        }
      } else if(currentPrices&&Number.isFinite(currentPrices.time)){
        const currentX=x(currentPrices.time);
        if(currentX>=left&&currentX<=right){
          c.strokeStyle='#dce7ed99';c.lineWidth=1;c.setLineDash([]);c.beginPath();c.moveTo(currentX,top);c.lineTo(currentX,bottom);c.stroke();
          const label=`NOW  RT ${number(currentPrices.rt)}  ·  DA ${number(currentPrices.da)}`;
          c.font='700 10px system-ui';const labelWidth=c.measureText(label).width+14,labelX=Math.max(left,Math.min(right-labelWidth,currentX-labelWidth/2));
          c.fillStyle='#14242dcc';c.fillRect(labelX,top,labelWidth,20);c.strokeStyle='#dce7ed66';c.strokeRect(labelX,top,labelWidth,20);c.fillStyle='#e7eff3';c.textAlign='left';c.fillText(label,labelX+7,top+14);
        }
      }
      if(cursorTime!=null&&(!overview||inspecting)){
        const cx=x(cursorTime);c.strokeStyle='#e7eff3bb';c.lineWidth=1;c.setLineDash([]);c.beginPath();c.moveTo(cx,top);c.lineTo(cx,bottom);c.stroke();
        const activeSeries=rtSeries||model.series.find(s=>s.points.some(p=>p.time===cursorTime));
        const activePoint=activeSeries?.points.reduce((best,p)=>!best||Math.abs(p.time-cursorTime)<Math.abs(best.time-cursorTime)?p:best,null);
        if(overview&&state.mode==='price'){
          const daPoints=model.series.filter(s=>s.id.endsWith(':da')||s.id.endsWith(':forward')).flatMap(s=>s.points);
          const daPoint=pointAt({points:daPoints},cursorTime),rtPoint=pointAt(rtSeries,cursorTime);
          priceLabels(cursorTime,[{kind:'RT',value:rtPoint?.value,color:colors.rt},{kind:'DA',value:daPoint?.value,color:colors.da}]);
        } else if(activePoint){
          const priceY=y(activePoint.value),label=state.mode==='demand'?`${number(activePoint.value)} MW`:`$${number(activePoint.value)}`;c.font='700 9px monospace';
          const labelWidth=c.measureText(label).width+8,labelX=Math.max(left,Math.min(right-labelWidth,cx+7)),labelY=Math.max(top+2,Math.min(bottom-16,priceY-8));
          c.fillStyle='#101a20';c.fillRect(labelX,labelY,labelWidth,16);c.strokeStyle=activeSeries.color;c.lineWidth=1;c.strokeRect(labelX,labelY,labelWidth,16);
          c.fillStyle=activeSeries.color;c.textAlign='left';c.fillText(label,labelX+4,labelY+11);
        }
      }
      const rtTimes=model.series.filter(s=>s.id.endsWith(':rt')).flatMap(s=>s.points.map(p=>p.time));
      const boundary = rtTimes.length?Math.max(...rtTimes):NaN;
      if(options.showBoundary && Number.isFinite(boundary) && boundary>=start && boundary<=end){
        const bx=x(boundary);c.strokeStyle=muted;c.setLineDash([5,4]);c.beginPath();c.moveTo(bx,top);c.lineTo(bx,bottom);c.stroke();c.setLineDash([]);c.textAlign=bx>(left+right)/2?'right':'left';c.fillStyle=muted;c.fillText('Latest RT | Forward DA',bx,top-7);
      }
      canvas.setAttribute('aria-label',`Market trends: ${model.series.length} series, ${points.length} timestamps. ${number(minV)} to ${number(maxV)} ${state.mode==='demand'?'megawatts':'dollars per MWh'}. Arrow keys inspect, Enter pins, Escape releases.`);
    }
    function render() {
      clearHover();
      const previous=points[cursor];
      model=build(data,state);points=[...new Set(model.series.flatMap(s=>s.points.map(p=>p.time)))].sort((a,b)=>a-b);
      cursor=previous!=null&&points.includes(previous)?points.indexOf(previous):null;
      if(cursorTime!=null&&(!points.length||cursorTime<points[0]||cursorTime>points.at(-1)))cursorTime=null;
      if(cursor==null)pinned=false;
      const updated=Date.parse(data.updated);
      if(overview){
        const parts=Number.isFinite(updated)?Object.fromEntries(new Intl.DateTimeFormat('en-US',{timeZone:'America/Toronto',hour:'2-digit',minute:'2-digit',month:'2-digit',day:'2-digit',hourCycle:'h23'}).formatToParts(updated).map(p=>[p.type,p.value])):null;
        updatedLabel.textContent=parts?`Updated: ${parts.hour}:${parts.minute} ${parts.month}/${parts.day}`:'Updated: unavailable';
      }
      $('.mt-status').textContent = model.error || `${data.stale?'STALE SNAPSHOT · ':''}${data.historical?'Archive loaded':'Feed updated'} ${Number.isFinite(updated)?stamp(updated):'unknown'} · Available: ${model.first!=null?stamp(model.first)+' — '+stamp(model.last):'no readings'}. ${data.historical?'Archived IESO price reports (EST delivery dates).'+(data.partial?' INCOMPLETE COVERAGE.':''):'Current report window only; use Pull historical data for older prices.'}${state.mode==='spread'?' Spread uses exact matching RT / DA timestamps only.':''}${state.mode==='demand'?' Demand history and predispatch forecast are separate IESO system series.':''}${state.interval!=='raw'?' Means use available samples; incomplete buckets are included.':''}${Number(state.rolling)>1?' Moving averages use consecutive displayed points, not elapsed hours.':''}${state.mode!=='demand'&&[primary,...state.compare].includes('IESO')?' IESO price is an average of reported nodes.':''}`;
      $('.mt-legend').innerHTML=model.series.map(s=>{const short=options.legendInside?({rt:'RT history',da:'DA history',forward:'DA forward',rtForecast:'Predict',demand:'Demand history',demandForecast:'Demand forecast'}[s.id.split(':').at(-1)]||s.label):s.label;return `<span><i style="--series-color:${s.color};border-top-style:${s.dash.length?'dashed':'solid'}"></i>${escape(short)}${s.points.length||options.legendInside?'':' (no readings)'}</span>`;}).join('');
      $('.mt-stats caption').textContent=`Selected window · arithmetic statistics (${state.mode==='demand'?'MW':'$/MWh'})`;
      $('.mt-data thead th:nth-child(3)').textContent=state.mode==='demand'?'MW':'$/MWh';
      $('.mt-stats tbody').innerHTML=model.series.map(s=>{const v=s.points.map(p=>p.value);return `<tr><th>${escape(s.label)}</th><td>${v.length}</td><td>${number(v.at(-1))}</td><td>${v.length?number(Math.min(...v)):'—'}</td><td>${v.length?number(v.reduce((a,b)=>a+b,0)/v.length):'—'}</td><td>${v.length?number(Math.max(...v)):'—'}</td><td>${v.length>1?number(v.at(-1)-v[0]):'—'}</td></tr>`;}).join('');
      $('[data-action="export"]').disabled=!points.length;
      rows();paint();inspect();
    }
    host.addEventListener('change',event=>{
      const el=event.target;
      if(el.dataset.setting){const previous=state.mode;state[el.dataset.setting]=el.value;if(el.dataset.setting==='timeScale'||el.dataset.setting==='periodLength'){const amount=Math.max(1,Math.min(168,Number(state.periodLength)||24));state.range=String(amount*(state.timeScale==='day'?24:1));}if(el.dataset.setting==='mode'&&previous!==state.mode)state.kinds=state.mode==='demand'?['demand','demandForecast']:['rt','da','forward','rtForecast'];}
      else if(el.dataset.kind)state.kinds=Array.from(host.querySelectorAll('[data-kind]:checked'),n=>n.dataset.kind);
      else if(el.dataset.node)state.compare=Array.from(host.querySelectorAll('[data-node]:checked'),n=>n.dataset.node).filter(n=>n!==primary);
      else return;
      cursor=null;cursorTime=null;pinned=false;inspecting=false;syncControls();render();
    });
    $('.mt-search').addEventListener('input',rows);
    function downloadCsv(series, suffix) {
      const blob=new Blob([csv(series,state)],{type:'text/csv;charset=utf-8'}),url=URL.createObjectURL(blob),a=document.createElement('a');
      a.href=url;a.download=`market-${primary}-${state.mode}${suffix}-${new Date().toISOString().slice(0,10)}.csv`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
    }
    $('[data-action="export-point"]').onclick=()=>{
      if(cursor==null)return;
      downloadCsv(model.series.map(s=>({...s,points:s.points.filter(p=>p.time===points[cursor])})), '-point');
      $('.mt-copy-status').textContent='Selected timestamp exported with exact values.';
    };
    $('[data-action="export"]').onclick=()=>downloadCsv(model.series,'');
    $('[data-action="refresh"]').onclick=async()=>{
      const button=$('[data-action="refresh"]');button.disabled=true;button.textContent='Refreshing…';
      try{await refresh();}catch{$('.mt-status').textContent='Refresh failed. Previous snapshot retained.';}
      finally{button.disabled=false;button.textContent='Refresh feed';}
    };
    function pick(event){if(!plot||!points.length)return;const r=canvas.getBoundingClientRect(),t=plot.start+Math.max(0,Math.min(1,(event.clientX-r.left-plot.left)/(plot.right-plot.left)))*(plot.end-plot.start);const next=points.reduce((best,p,i)=>Math.abs(p-t)<Math.abs(points[best]-t)?i:best,0);if(next===cursor&&t===cursorTime)return;cursor=next;cursorTime=t;$('.mt-copy-status').textContent='';paint();inspect();}
    function inside(event){const r=canvas.getBoundingClientRect();return plot&&event.clientX-r.left>=plot.left&&event.clientX-r.left<=plot.right&&event.clientY-r.top>=plot.top&&event.clientY-r.top<=plot.bottom;}
    function hoverLine(event){
      if(!inside(event)){clearHover();return;}
      const rect=canvas.getBoundingClientRect(),px=event.clientX-rect.left,py=event.clientY-rect.top;
      let hit=null,distance=7;
      model.series.forEach(series=>{
        const gaps=series.points.slice(1).map((p,i)=>p.time-series.points[i].time).sort((a,b)=>a-b),cadence=gaps[Math.floor(gaps.length/2)]||Infinity;
        series.points.forEach((point,i)=>{
          const a=series.points[i-1],bx=plot.x(point.time),by=plot.y(point.value);
          let d=Math.hypot(px-bx,py-by),sample=point;
          if(a&&point.time-a.time<=cadence*1.8){
            const ax=plot.x(a.time),ay=plot.y(a.value),dx=bx-ax,dy=by-ay,t=Math.max(0,Math.min(1,((px-ax)*dx+(py-ay)*dy)/(dx*dx+dy*dy||1)));
            d=Math.min(d,Math.hypot(px-ax-t*dx,py-ay-t*dy)); sample=t<.5?a:point;
          }
          if(d<distance){distance=d;hit={series,point:sample};}
        });
      });
      if(!hit){clearHover();return;}
      const key=hit.series.id+':'+hit.point.time;
      if(hoverTarget?.key===key&&Math.hypot(px-hoverTarget.px,py-hoverTarget.py)<4)return;
      clearHover();hoverTarget={key,px,py};
      hoverTimer=setTimeout(()=>{
        tooltip.textContent=`${hit.series.label} · ${state.mode==='demand'?number(hit.point.value)+' MW':'$'+number(hit.point.value)+' /MWh'} · ${new Date(hit.point.time).toLocaleString('en-CA',{timeZone:'America/Toronto',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23',timeZoneName:'short'})}`;
        tooltip.style.borderColor=hit.series.color;tooltip.hidden=false;
        tooltip.style.left=Math.max(0,Math.min(rect.width-tooltip.offsetWidth,px+10))+'px';
        tooltip.style.top=Math.max(26,Math.min(rect.height-tooltip.offsetHeight,py+12))+'px';
      },750);
    }
    canvas.addEventListener('pointermove',event=>{if(overview){hoverLine(event);if(inspecting&&inside(event))pick(event);}else if(!pinned)pick(event);});
    canvas.addEventListener('pointerleave',()=>{clearHover();if(overview){cursor=null;cursorTime=null;paint();inspect();}});
    canvas.addEventListener('click',event=>{if(overview){event.stopPropagation();if(!inside(event))return;inspecting=!inspecting;if(inspecting)pick(event);else{cursor=null;cursorTime=null;}}else if(pinned){pinned=false;}else{pick(event);pinned=cursor!=null;}paint();inspect();});
    canvas.addEventListener('keydown',event=>{
      if(!['ArrowLeft','ArrowRight','Home','End','Enter','Escape'].includes(event.key)||!points.length)return;event.preventDefault();
      if(overview){event.stopPropagation();inspecting=event.key!=='Escape';}
      if(event.key==='Escape'){clearHover();pinned=false;cursor=null;cursorTime=null;}else if(event.key==='Enter'){if(cursor==null)cursor=0;cursorTime=points[cursor];pinned=!pinned;}else{cursor=event.key==='Home'?0:event.key==='End'?points.length-1:Math.max(0,Math.min(points.length-1,(cursor??(event.key==='ArrowLeft'?points.length: -1))+(event.key==='ArrowLeft'?-1:1)));cursorTime=points[cursor];}
      paint();inspect();
    });
    const observer=new ResizeObserver(paint);observer.observe(canvas);if(host.closest('#overviewMarketMini'))observer.observe(host);
    const controller={update(next,key,nextOptions={}){liveData=next;data=next;if(nextOptions.mode)state.mode=nextOptions.mode;if(nextOptions.scale)state.scale=nextOptions.scale;if(nextOptions.kinds)state.kinds=[...nextOptions.kinds];if(nextOptions.symmetricWindowHours)state.symmetricWindowHours=nextOptions.symmetricWindowHours;if(Object.prototype.hasOwnProperty.call(nextOptions,'currentPrices'))currentPrices=nextOptions.currentPrices;if(key!==primary){primary=key;state.primary=key;state.compare=state.compare.filter(k=>k!==key);cursor=null;cursorTime=null;pinned=false;}syncControls();render();},destroy(){clearHover();tooltip.remove();updatedLabel.remove();archiveRequest?.abort();observer.disconnect();controllers.delete(host);}};
    controllers.set(host,controller);syncControls();render();
  }
  function unmount(host){controllers.get(host)?.destroy();}
  window.NorthstarMarketTrends={mount,unmount,normalize,aggregate,subtract,build,csv};
})();
