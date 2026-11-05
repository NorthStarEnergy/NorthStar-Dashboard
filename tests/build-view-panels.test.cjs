const test=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const context={module:{exports:{}}};vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../build-view-panels.js'),'utf8'),context);
const panels=context.module.exports;
test('market keeps price and demand axes distinct and preserves missing observations',()=>{
  const data={nodes:{IESO:{history:[{time:'2026-10-17T12:00Z',value:28},{time:'2026-10-17T13:00Z',value:null},{time:'2026-10-17T14:00Z',value:30}]}},ontario:{history:[{time:'2026-10-17T12:00Z',value:18900}]}};
  const series=panels.marketSeries(data);
  assert.equal(series.map(s=>s.unit).join(','),'$/MWh,$/MWh,MW,MW');
  assert.equal(series[0].points[1].value,null);
  const html=panels.chart(series,'Test');
  assert.match(html,/\$\/MWh/);assert.match(html,/>MW</);assert.match(html,/DA price —/);
  assert.match(html,/d="M48\.0 [\d.]+  M568\.0/);
});
test('empty market does not turn absent readings into zero',()=>{
  const html=panels.market({});assert.match(html,/History unavailable/);assert.match(html,/RT —/);assert.doesNotMatch(html,/RT 0/);
});
test('unqualified station data remains unknown with no manufactured limits',()=>{
  const m={units:[{n:1,state:'unknown',output:null,breaker:'unknown'}],value:()=>null};
  assert.match(panels.unitTable(m),/unknown/);assert.match(panels.waterTable(m),/Operating bands are not configured/);assert.doesNotMatch(panels.waterTable(m),/>0\.0</);
});
test('event links preserve identity and escape supplied labels',()=>{
  const html=panels.events([{eventId:'a&b',site:'<img>',summary:'<script>x</script>',severity:'warning'}]);
  assert.match(html,/event-detail.html\?id=a%26b/);assert.match(html,/&lt;script&gt;/);assert.doesNotMatch(html,/<script>/);assert.match(html,/data-severity="warning"/);
});

test('station comparison retains engineering precision, both colors and gaps',()=>{
  const html=panels.station({baseline:{},stationHistory:{headwater:[{at:0,value:267.5},{at:1000,value:null},{at:2000,value:267.6}],output:[{at:0,value:10},{at:2000,value:12}]}});
  assert.match(html,/Headwater vs station output/);assert.match(html,/>m</);assert.match(html,/>MW</);
  assert.match(html,/267\.610/);assert.match(html,/#39d9ff/);assert.match(html,/#4ce3ad/);
  assert.match(html,/fill-opacity=".12"/);assert.match(html,/Station profile/);
  assert.equal((html.match(/<header>/g)||[]).length,1);assert.doesNotMatch(html,/<figcaption>/);
  assert.match(html,/d="M48\.0 [\d.]+  M568\.0/);
});
test('station snapshot never manufactures a time trend or missing headwater',()=>{
  const html=panels.station({current:true,stationHistory:{output:[{at:0,value:0}]}});
  assert.match(html,/Headwater \(m\) — unavailable/);assert.match(html,/Single observation; history unavailable/);
  assert.doesNotMatch(html,/fill-opacity/);assert.match(html,/SCADA snapshot/);
  assert.match(panels.station({}),/History unavailable/);
});
