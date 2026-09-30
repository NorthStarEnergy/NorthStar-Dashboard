/* Market analysis uses only the readings present in the current feed snapshot. */
(() => {
  'use strict';
  const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const stamp = t => new Date(t).toLocaleString('en-CA', {timeZone:'America/Toronto',month:'short',day:'numeric',hour:'2-digit',minute:'2-digit',hourCycle:'h23',timeZoneName:'short'});
  const number = n => Number.isFinite(n) ? n.toFixed(2) : '—';
  const fields = [['rt','Real-time price','history'],['da','DA price history','daHistory'],['forward','DA price forward','forward'],['demand','Real-time demand','demand'],['demandForecast','Demand forecast','forecastSeries']];
  const palette = ['#efb84b','#6bbcff','#9bdfac','#dba5f5','#ff9d87'];
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
      fields.filter(([kind]) => ['demand','demandForecast'].includes(kind) && state.kinds.includes(kind)).forEach(([kind,label,field],i) => {
        series.push({id:'IESO:'+kind,node:'IESO',label:'Ontario · '+label,color:palette[i%palette.length],dash:kind==='demandForecast'?[10,4]:[],points:normalize(data.ontario?.[field] || [])});
      });
    } else for (const [i,key] of selected.entries()) {
      const node = data.nodes?.[key] || {};
      if (state.mode === 'spread') {
        const da = normalize([...(node.daHistory || node.da_history || []),...(node.forward || [])]);
        series.push({id:key+':spread',node:key,label:key+' · RT − DA',color:palette[i%palette.length],dash:[],points:subtract(normalize(node.history),da)});
      } else {
        fields.filter(([kind]) => ['rt','da','forward'].includes(kind) && state.kinds.includes(kind)).forEach(([kind,label,field]) => {
          series.push({id:key+':'+kind,node:key,label:key+' · '+label,color:palette[i%palette.length],dash:kind==='da'?[4,4]:kind==='forward'?[10,4]:[],points:normalize(node[field] || (field==='daHistory' ? node.da_history : []) )});
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
    } else if (state.range !== 'all') {
      const anchor = Date.parse(data.updated);
      const origin = Number.isFinite(anchor) ? anchor : last;
      if (state.range.startsWith('next')) {from=origin;to=origin+Number(state.range.slice(4))*3600000;}
      else {to=origin;from=to-Number(state.range)*3600000;}
    }
    series = series.map(s => ({...s,points:error ? [] : aggregate(s.points.filter(p => p.time>=from && p.time<=to),state.interval)}));
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
    if (existing) {existing.update(data,primary);return;}
    const identity = host.closest('[id]')?.id || primary;
    let state = states.get(identity) || {primary,compare:options.compare || [],mode:'price',kinds:['rt','da','forward'],range:'all',from:'',to:'',interval:'raw',rolling:'0'};
    state.primary = primary; states.set(identity,state);
    let model, cursor = null, pinned = false, points = [], plot;
    host.classList.add('market-trends');
    host.innerHTML = `<div class="mt-controls">
      <label>View<select data-setting="mode"><option value="price">Prices · $/MWh</option><option value="demand">Ontario demand · MW</option><option value="spread">RT − DA spread · $/MWh</option></select></label>
      <label>Window<select data-setting="range"><option value="all">All available + forward</option><option value="6">Last 6 hours</option><option value="24">Last 24 hours</option><option value="48">Last 48 hours</option><option value="next6">Next 6 hours</option><option value="next12">Next 12 hours</option><option value="custom">Custom range (UTC)</option></select></label>
      <label>Resolution<select data-setting="interval"><option value="raw">Reported readings</option><option value="hour">Hourly mean (UTC buckets)</option><option value="day">Daily mean (UTC buckets)</option></select></label>
      <label>Trend<select data-setting="rolling"><option value="0">No moving average</option><option value="3">3-point moving average</option><option value="6">6-point moving average</option></select></label>
      <button type="button" data-action="refresh">Refresh feed</button><button type="button" data-action="export">Export CSV</button>
      </div><div class="mt-dates" hidden><label>From (UTC)<input type="datetime-local" data-setting="from"></label><label>To (UTC)<input type="datetime-local" data-setting="to"></label></div>
      <div class="mt-selectors"><fieldset class="mt-nodes"><legend>Compare price nodes</legend><div></div></fieldset><fieldset class="mt-kinds"><legend>Overlay series</legend>${fields.map(([kind,label])=>`<label><input type="checkbox" data-kind="${kind}">${label}</label>`).join('')}</fieldset></div>
      <p class="mt-status"></p><div class="mt-legend"></div><canvas class="market-price-chart" tabindex="0" role="img" aria-label="Market trends. Arrow keys inspect data points; Enter pins a point; Escape releases it."></canvas>
      <div class="mt-inspection" aria-live="polite"></div><div class="mt-point-actions"><button type="button" data-action="export-point" disabled>Export selected point CSV</button><span class="mt-copy-status" role="status"></span></div><p class="mt-help">Hover or tap to inspect · click to pin · arrow keys step through timestamps · Enter pins · Escape releases. Values match the selected timestamp exactly; no interpolation.</p>
      <div class="mt-table-wrap"><table class="mt-stats"><caption>Selected window · arithmetic statistics ($/MWh)</caption><thead><tr><th>Series</th><th>Points</th><th>Latest</th><th>Minimum</th><th>Mean</th><th>Maximum</th><th>First → last Δ</th></tr></thead><tbody></tbody></table></div>
      <details class="mt-readings"><summary>Explore / copy data points</summary><label>Filter readings<input class="mt-search" type="search" placeholder="Node, series, date or price"></label><p class="mt-count"></p><div class="mt-table-wrap mt-data"><table><thead><tr><th>Timestamp (Eastern)</th><th>Node / series</th><th>$/MWh</th><th>Samples</th></tr></thead><tbody></tbody></table></div></details>`;
    const $ = selector => host.querySelector(selector);
    const canvas = $('canvas');
    function syncControls() {
      host.querySelectorAll('[data-setting]').forEach(el => el.value = state[el.dataset.setting]);
      host.querySelectorAll('[data-kind]').forEach(el => el.checked = state.kinds.includes(el.dataset.kind));
      $('.mt-dates').hidden = state.range!=='custom';
      $('.mt-kinds').disabled = state.mode==='spread';
      host.querySelectorAll('[data-kind]').forEach(el=>{el.closest('label').hidden=state.mode==='demand'?!['demand','demandForecast'].includes(el.dataset.kind):!['rt','da','forward'].includes(el.dataset.kind);});
      const keys = Object.keys(data.nodes || {});
      $('.mt-nodes div').innerHTML = keys.map(key=>`<label><input type="checkbox" data-node="${escape(key)}" ${key===primary||state.compare.includes(key)?'checked':''} ${key===primary?'disabled':''}>${escape(key)}${key===primary?' (primary)':''}</label>`).join('');
      $('.mt-nodes').disabled=state.mode==='demand';
    }
    function rows() {
      const query = $('.mt-search').value.toLowerCase();
      const all = model.series.flatMap(s => s.points.map(p => ({...p,label:s.label}))).sort((a,b)=>b.time-a.time);
      const matching = all.filter(p => `${stamp(p.time)} ${new Date(p.time).toISOString()} ${p.label} ${p.value}`.toLowerCase().includes(query));
      $('.mt-count').textContent = `${matching.length} matching readings. CSV includes all charted readings, regardless of this text filter.`;
      $('.mt-data tbody').innerHTML = matching.map(p=>`<tr><td title="${new Date(p.time).toISOString()}">${stamp(p.time)}</td><td>${escape(p.label)}</td><td>${number(p.value)}</td><td>${p.count}</td></tr>`).join('');
    }
    function inspect() {
      $('[data-action="export-point"]').disabled = cursor == null || !points.length;
      if (cursor == null || !points.length) {$('.mt-inspection').textContent = 'Select a point on the chart to inspect its values.';return;}
      const t = points[cursor];
      const unit=state.mode==='demand'?' MW':' $/MWh';
      $('.mt-inspection').innerHTML = `<strong>${pinned?'Pinned · ':''}${stamp(t)}</strong><small>${new Date(t).toISOString()}</small><div>${model.series.map(s=>{const p=s.points.find(v=>v.time===t);return `<span><b>${escape(s.label)}</b> ${p?number(p.value)+unit:'— no reading'}</span>`;}).join('')}</div>`;
    }
    function paint() {
      const width = Math.floor(canvas.getBoundingClientRect().width);
      if (width<1) return;
      const height = options.compact?190:width<500?280:350, dpr = window.devicePixelRatio||1;
      canvas.width=width*dpr;canvas.height=height*dpr;canvas.style.height=height+'px';
      const c=canvas.getContext('2d');c.setTransform(dpr,0,0,dpr,0,0);
      const theme=getComputedStyle(host), muted=theme.getPropertyValue('--muted').trim()||'#9eafb9';
      c.font='11px system-ui';c.fillStyle=muted;
      const all=model.series.flatMap(s=>s.points);
      if (!all.length) {c.textAlign='center';c.fillText(model.error?'Check the selected date range':'No readings match these settings',width/2,height/2);canvas.setAttribute('aria-label','No readings match these settings.');plot=null;return;}
      const values=all.map(p=>p.value), minV=Math.min(...values), maxV=Math.max(...values), pad=Math.max(1,(maxV-minV)*.1), low=minV-pad, high=maxV+pad;
      const left=Math.max(58,c.measureText(low.toFixed(1)).width+16,c.measureText(high.toFixed(1)).width+16),right=width-16,top=24,bottom=height-48;
      const start=points[0],end=points.at(-1),x=t=>start===end?(left+right)/2:left+(t-start)/(end-start)*(right-left),y=v=>bottom-(v-low)/(high-low)*(bottom-top);
      plot={left,right,start,end,x};
      c.fillText(state.mode==='demand'?'MW':'$/MWh',left,12);c.textAlign='right';
      for(let i=0;i<=4;i++){const v=high-(high-low)*i/4;c.strokeStyle=theme.getPropertyValue('--line').trim()||'#2b3c46';c.lineWidth=1;c.beginPath();c.moveTo(left,y(v));c.lineTo(right,y(v));c.stroke();c.fillText(v.toFixed(1),left-8,y(v)+4);}
      if(low<0&&high>0){c.strokeStyle=muted;c.setLineDash([3,4]);c.beginPath();c.moveTo(left,y(0));c.lineTo(right,y(0));c.stroke();c.setLineDash([]);}
      const tickCount=Math.max(1,Math.floor((right-left)/145));
      const indices=[...new Set(Array.from({length:tickCount+1},(_,i)=>Math.round(i*(points.length-1)/tickCount)))];
      indices.forEach((idx,i)=>{c.textAlign=i===0?'left':i===indices.length-1?'right':'center';c.fillStyle=muted;c.fillText(stamp(points[idx]),x(points[idx]),height-20);});
      model.series.forEach(s=>{
        c.strokeStyle=s.color;c.fillStyle=s.color;c.lineWidth=s.id.endsWith(':mean')?2.5:1.8;c.lineJoin='round';c.setLineDash(s.dash);
        // Break missing intervals rather than drawing a false continuous trend.
        const gaps=s.points.slice(1).map((p,i)=>p.time-s.points[i].time).sort((a,b)=>a-b), cadence=gaps[Math.floor(gaps.length/2)]||Infinity;
        c.beginPath();s.points.forEach((p,i)=>{if(!i||p.time-s.points[i-1].time>cadence*1.8)c.moveTo(x(p.time),y(p.value));else c.lineTo(x(p.time),y(p.value));});c.stroke();c.setLineDash([]);
        s.points.forEach(p=>{c.beginPath();c.arc(x(p.time),y(p.value),2,0,Math.PI*2);c.fill();});
      });
      if(cursor!=null){const cx=x(points[cursor]);c.strokeStyle=muted;c.setLineDash([3,3]);c.beginPath();c.moveTo(cx,top);c.lineTo(cx,bottom);c.stroke();c.setLineDash([]);}
      const rtTimes=model.series.filter(s=>s.id.endsWith(':rt')).flatMap(s=>s.points.map(p=>p.time));
      const boundary = rtTimes.length?Math.max(...rtTimes):NaN;
      if(options.showBoundary && Number.isFinite(boundary) && boundary>=start && boundary<=end){
        const bx=x(boundary);c.strokeStyle=muted;c.setLineDash([5,4]);c.beginPath();c.moveTo(bx,top);c.lineTo(bx,bottom);c.stroke();c.setLineDash([]);c.textAlign=bx>(left+right)/2?'right':'left';c.fillStyle=muted;c.fillText('Latest RT | Forward DA',bx,top-7);
      }
      canvas.setAttribute('aria-label',`Market trends: ${model.series.length} series, ${points.length} timestamps. ${number(minV)} to ${number(maxV)} ${state.mode==='demand'?'megawatts':'dollars per MWh'}. Arrow keys inspect, Enter pins, Escape releases.`);
    }
    function render() {
      const previous=points[cursor];
      model=build(data,state);points=[...new Set(model.series.flatMap(s=>s.points.map(p=>p.time)))].sort((a,b)=>a-b);
      cursor=previous!=null&&points.includes(previous)?points.indexOf(previous):null;
      if(cursor==null)pinned=false;
      const updated=Date.parse(data.updated);
      $('.mt-status').textContent = model.error || `${data.stale?'STALE SNAPSHOT · ':''}Feed updated ${Number.isFinite(updated)?stamp(updated):'unknown'} · Available: ${model.first!=null?stamp(model.first)+' — '+stamp(model.last):'no readings'}. Current report window only; earlier history is not loaded.${state.mode==='spread'?' Spread uses exact matching RT / DA timestamps only.':''}${state.mode==='demand'?' Demand history and predispatch forecast are separate IESO system series.':''}${state.interval!=='raw'?' Means use available samples; incomplete buckets are included.':''}${Number(state.rolling)>1?' Moving averages use consecutive displayed points, not elapsed hours.':''}${state.mode!=='demand'&&[primary,...state.compare].includes('IESO')?' IESO price is an average of reported nodes.':''}`;
      $('.mt-legend').innerHTML=model.series.map(s=>`<span><i style="--series-color:${s.color};border-top-style:${s.dash.length?'dashed':'solid'}"></i>${escape(s.label)}${s.points.length?'':' (no readings)'}</span>`).join('');
      $('.mt-stats caption').textContent=`Selected window · arithmetic statistics (${state.mode==='demand'?'MW':'$/MWh'})`;
      $('.mt-data thead th:nth-child(3)').textContent=state.mode==='demand'?'MW':'$/MWh';
      $('.mt-stats tbody').innerHTML=model.series.map(s=>{const v=s.points.map(p=>p.value);return `<tr><th>${escape(s.label)}</th><td>${v.length}</td><td>${number(v.at(-1))}</td><td>${v.length?number(Math.min(...v)):'—'}</td><td>${v.length?number(v.reduce((a,b)=>a+b,0)/v.length):'—'}</td><td>${v.length?number(Math.max(...v)):'—'}</td><td>${v.length>1?number(v.at(-1)-v[0]):'—'}</td></tr>`;}).join('');
      $('[data-action="export"]').disabled=!points.length;
      rows();paint();inspect();
    }
    host.addEventListener('change',event=>{
      const el=event.target;
      if(el.dataset.setting){const previous=state.mode;state[el.dataset.setting]=el.value;if(el.dataset.setting==='mode'&&previous!==state.mode)state.kinds=state.mode==='demand'?['demand','demandForecast']:['rt','da','forward'];}
      else if(el.dataset.kind)state.kinds=Array.from(host.querySelectorAll('[data-kind]:checked'),n=>n.dataset.kind);
      else if(el.dataset.node)state.compare=Array.from(host.querySelectorAll('[data-node]:checked'),n=>n.dataset.node).filter(n=>n!==primary);
      else return;
      cursor=null;pinned=false;syncControls();render();
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
    function pick(event){if(!plot||!points.length)return;const r=canvas.getBoundingClientRect(),t=plot.start+Math.max(0,Math.min(1,(event.clientX-r.left-plot.left)/(plot.right-plot.left)))*(plot.end-plot.start);const next=points.reduce((best,p,i)=>Math.abs(p-t)<Math.abs(points[best]-t)?i:best,0);if(next===cursor)return;cursor=next;$('.mt-copy-status').textContent='';paint();inspect();}
    canvas.addEventListener('pointermove',event=>{if(!pinned)pick(event);});
    canvas.addEventListener('click',event=>{if(pinned){pinned=false;}else{pick(event);pinned=cursor!=null;}paint();inspect();});
    canvas.addEventListener('keydown',event=>{
      if(!['ArrowLeft','ArrowRight','Home','End','Enter','Escape'].includes(event.key)||!points.length)return;event.preventDefault();
      if(event.key==='Escape'){pinned=false;cursor=null;}else if(event.key==='Enter'){if(cursor==null)cursor=0;pinned=!pinned;}else{cursor=event.key==='Home'?0:event.key==='End'?points.length-1:Math.max(0,Math.min(points.length-1,(cursor??(event.key==='ArrowLeft'?points.length: -1))+(event.key==='ArrowLeft'?-1:1)));}
      paint();inspect();
    });
    const observer=new ResizeObserver(paint);observer.observe(canvas);
    const controller={update(next,key){data=next;if(key!==primary){primary=key;state.primary=key;state.compare=state.compare.filter(k=>k!==key);cursor=null;pinned=false;}syncControls();render();},destroy(){observer.disconnect();controllers.delete(host);}};
    controllers.set(host,controller);syncControls();render();
  }
  function unmount(host){controllers.get(host)?.destroy();}
  window.NorthstarMarketTrends={mount,unmount,normalize,aggregate,subtract,build,csv};
})();
