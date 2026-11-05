/* Dense read-only v2 panels. Missing data stays missing; chart axes retain engineering units. */
((scope)=>{
  'use strict';
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const finite=v=>typeof v==='number'&&Number.isFinite(v);
  const fmt=(v,n=1)=>finite(v)?v.toLocaleString('en-CA',{minimumFractionDigits:n,maximumFractionDigits:n}):'—';
  const stamp=v=>Number.isFinite(Date.parse(v))?new Date(v).toLocaleTimeString('en-CA',{timeZone:'America/Toronto',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}):'—';
  function points(rows){return (Array.isArray(rows)?rows:[]).map(p=>({at:typeof p.at==='number'?p.at:Date.parse(p.time),value:finite(p.value)?p.value:null})).filter(p=>Number.isFinite(p.at)).sort((a,b)=>a.at-b.at);}
  function marketSeries(data){
    const node=data?.nodes?.IESO||{},demand=data?.ontario||{};
    return [
      {label:'RT price',unit:'$/MWh',color:'#55b4ff',points:points(node.history)},
      {label:'DA price',unit:'$/MWh',color:'#2580cf',points:points(node.daHistory||node.da_history)},
      {label:'Demand',unit:'MW',color:'#4ce3ad',points:points(demand.history)},
      {label:'Forecast',unit:'MW',color:'#ffc05a',dash:true,points:points(demand.forecastSeries)}
    ];
  }
  function chart(series,aria,options={}){
    const populated=series.filter(s=>s.points.some(p=>finite(p.value)));
    if(!populated.length)return '<p class="bv2-empty">History unavailable for this snapshot.</p>';
    const times=populated.flatMap(s=>s.points.map(p=>p.at)),start=Math.min(...times),end=Math.max(...times),dt=end-start||1;
    const units=[...new Set(populated.map(s=>s.unit))];
    const scales=new Map(units.map(unit=>{const values=populated.filter(s=>s.unit===unit).flatMap(s=>s.points.filter(p=>finite(p.value)).map(p=>p.value));const min=Math.min(...values),max=Math.max(...values),pad=(max-min)*.1||Math.abs(max)*.05||1;return [unit,{min:min-pad,max:max+pad}];}));
    const x=t=>48+(t-start)/dt*520,y=(s,v)=>{const a=scales.get(s.unit);return 136-(v-a.min)/(a.max-a.min)*108;};
    const lines=populated.map(s=>{let connected=false;const path=s.points.map(p=>{if(!finite(p.value)){connected=false;return '';}const segment=(connected?'L':'M')+x(p.at).toFixed(1)+' '+y(s,p.value).toFixed(1);connected=true;return segment;}).join(' ');const areas=options.area?path.split(/(?=M)/).filter(Boolean).map(segment=>{const coords=[...segment.matchAll(/[ML]([\d.]+) ([\d.]+)/g)];return coords.length>1?'<path fill="'+s.color+'" fill-opacity=".12" d="'+segment+' L'+coords.at(-1)[1]+' 136 L'+coords[0][1]+' 136Z"/>':'';}).join(''):'';return areas+'<path fill="none" stroke="'+s.color+'" stroke-width="2" vector-effect="non-scaling-stroke" '+(s.dash?'stroke-dasharray="5 4"':'')+' d="'+path+'"/>'+s.points.filter(p=>finite(p.value)).map(p=>'<circle cx="'+x(p.at).toFixed(1)+'" cy="'+y(s,p.value).toFixed(1)+'" r="1.4" fill="'+s.color+'"/>').join('');}).join('');
    const axes=units.map((unit,i)=>{const a=scales.get(unit),side=i?620:2,anchor=i?'end':'start';return '<text x="'+side+'" y="13" text-anchor="'+anchor+'">'+esc(unit)+'</text>'+[0,.5,1].map(t=>'<text x="'+side+'" y="'+(32+t*108)+'" text-anchor="'+anchor+'">'+fmt(a.max-t*(a.max-a.min),options.precision?.[unit]??(unit==='MW'?0:1))+'</text>').join('');}).join('');
    const timeLabel=t=>options.dates?new Date(t).toLocaleString('en-CA',{timeZone:'America/Toronto',month:'short',day:'numeric',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}):stamp(new Date(t).toISOString());
    return '<figure class="bv2-comparison">'+(options.legend===false?'':'<figcaption>'+series.map(s=>'<span style="--series:'+s.color+'"'+(!s.points.some(p=>finite(p.value))?' class="bv2-series-missing"':'')+'>'+esc(s.label)+(s.points.some(p=>finite(p.value))?'':' —')+'</span>').join('')+'</figcaption>')+'<svg viewBox="0 0 624 164" role="img" aria-label="'+esc(aria)+'"><path class="bv2-chart-grid" d="M48 28H568M48 82H568M48 136H568M48 28V136M178 28V136M308 28V136M438 28V136M568 28V136"/>'+axes+lines+'<text x="48" y="159">'+timeLabel(start)+'</text><text x="568" y="159" text-anchor="end">'+timeLabel(end)+'</text></svg></figure>';
  }
  function station(m){
    const series=[{label:'Headwater',unit:'m',color:'#39d9ff',points:points(m?.stationHistory?.headwater)},
      {label:'Station output',unit:'MW',color:'#4ce3ad',points:points(m?.stationHistory?.output)}];
    const source=m?.baseline?'Station profile':m?.current?'SCADA snapshot':'Data unavailable';
    const legend=series.map(s=>'<span style="--series:'+s.color+'">'+s.label+' ('+s.unit+')'+(s.points.some(p=>finite(p.value))?'':' — unavailable')+'</span>').join('');
    const count=Math.max(...series.map(s=>s.points.filter(p=>finite(p.value)).length));
    return '<div class="bv2-station-chart"><header><h2>Headwater vs station output</h2><div class="bv2-station-legend">'+legend+'</div></header>'+chart(series,'Headwater in metres and station output in megawatts over time, independently scaled axes',{legend:false,area:true,dates:true,precision:{m:3,MW:1}})+'<div class="bv2-chart-source">'+source+' · Independent axes · '+(count>1?'Times in ET':count===1?'Single observation; history unavailable':'History unavailable')+'</div></div>';
  }
  function market(data){
    const cells=['IESO','APIROQ'].map(key=>{const n=data?.nodes?.[key]||{};return '<span><small>'+key+'</small><b>RT '+fmt(n.rt,2)+'</b><em>DA '+fmt(n.da,2)+'</em></span>';}).join('');
    return chart(marketSeries(data),'IESO prices in dollars per MWh and Ontario demand in MW, with separate axes')+'<div class="bv2-market-summary">'+cells+'<span><small>Demand</small><b>'+fmt(data?.ontario?.demand,0)+' MW</b></span><span><small>Forecast</small><b>'+fmt(data?.ontario?.forecastDemand,0)+' MW</b></span></div>';
  }
  function events(rows){
    return '<div class="bv2-table-scroll"><table class="bv2-data-table"><thead><tr><th>Time</th><th>Level</th><th>Station / event</th><th>State</th></tr></thead><tbody>'+rows.slice(0,5).map(e=>'<tr data-severity="'+esc(e.severity)+'"><td>'+stamp(e.occurredAt||e.timestamp||e.createdAt||e.at)+'</td><td class="bv2-severity">'+esc(e.severity||'—')+'</td><td><b>'+esc(e.site||e.siteName||'System')+'</b><a href="event-detail.html?id='+encodeURIComponent(e.eventId||e.id||'')+'">'+esc(e.summary||e.title||e.description||'Recorded event')+'</a></td><td>'+esc(e.status||'—')+'</td></tr>').join('')+'</tbody></table></div>';
  }
  function unitTable(m){
    return '<div class="bv2-table-scroll"><table class="bv2-data-table"><thead><tr><th>Unit</th><th>State</th><th>Output (MW)</th><th>Breaker</th></tr></thead><tbody>'+(m?.units||[]).map(u=>'<tr><td>U'+esc(u.n)+'</td><td data-state="'+esc(u.state)+'">'+esc(u.state||'unknown')+'</td><td class="bv2-value-output">'+fmt(u.output,2)+'</td><td>'+esc(u.breaker||'unknown')+'</td></tr>').join('')+'</tbody></table></div>';
  }
  function waterTable(m){
    const rows=[['Headwater','headwater','m'],['Tailwater','tailwater','m'],['Flow','flow','m³/s'],['Outflow','outflow','m³/s'],['Spill','spill','m³/s']];
    return '<table class="bv2-data-table"><thead><tr><th>Parameter</th><th>Current</th><th>Unit</th></tr></thead><tbody>'+rows.map(([label,key,unit])=>'<tr><td>'+label+'</td><td class="bv2-value-water">'+fmt(m?.value(key),unit==='m'?3:1)+'</td><td>'+unit+'</td></tr>').join('')+'</tbody></table><p class="bv2-data-note">Operating bands are not configured in this view.</p>';
  }
  const api={marketSeries,chart,station,market,events,unitTable,waterTable};
  if(typeof module!=='undefined')module.exports=api;else scope.NorthStarBuildPanels=api;
})(typeof window==='undefined'?globalThis:window);
