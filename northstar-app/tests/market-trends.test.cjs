const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const window = {};
vm.runInNewContext(fs.readFileSync('market-trends.js','utf8'), {window,Map,Set,Date,Number});
const {normalize,aggregate,subtract,build,csv} = window.NorthstarMarketTrends;
const t = Date.parse('2026-09-22T00:00:00Z');
const p = (minutes,value) => ({time:new Date(t+minutes*60000).toISOString(),value});
const state = changes => ({primary:'A',compare:[],mode:'price',kinds:['rt','da','forward'],range:'all',from:'',to:'',interval:'raw',rolling:'0',...changes});
const data = {updated:new Date(t+86400000).toISOString(),nodes:{A:{history:[p(0,-5),p(5,0),p(60,10)],daHistory:[p(0,2),p(60,3)],forward:[p(1500,9)]},B:{history:[p(0,25),p(60,30)]}}};
test('normalization preserves zero/negative values and sorts unique valid timestamps',()=>{
 const points=normalize([p(5,0),p(0,-4),p(0,-5),p(10,null),p(15,''),p(20,'x'),{time:'invalid',value:9}]);
 assert.equal(points.length,2);assert.equal(points[0].value,-5);assert.equal(points[1].value,0);
});
test('RT minus DA uses exact timestamp matches only, not adjacent intervals',()=>{
 const model=build(data,state({mode:'spread'}));
 assert.equal(model.series[0].points.length,2);assert.equal(model.series[0].points[0].value,-7);assert.equal(model.series[0].points[1].value,7);
 assert.equal(subtract(normalize([p(5,2)]),normalize([p(0,3)])).length,0);
});
test('compare nodes, toggle series and preserve source counts in hourly means',()=>{
 const model=build(data,state({compare:['B','A'],kinds:['rt'],interval:'hour'}));
 assert.equal(model.series.length,2);assert.equal(model.series[0].points[0].value,-2.5);assert.equal(model.series[0].points[0].count,2);
 assert.equal(model.series[1].points[0].value,25);
});
test('relative window anchors to feed time and excludes forward data',()=>{
  const model=build(data,state({range:'24'}));
  assert.equal(model.series.find(s=>s.id==='A:forward').points.length,0);
  assert.equal(model.series[0].points.length,3);
});
test('symmetric overview window keeps historical and forecast prices on opposite sides of now',()=>{
 const overview={updated:new Date(t+4*3600000).toISOString(),liveWindow:true,windowAnchor:t+4*3600000,nodes:{A:{history:[p(0,10),p(240,20)],daHistory:[p(0,9),p(240,19)],forward:[p(240,21),p(360,22)],rtForecast:[p(300,23)]}}};
 const model=build(overview,state({kinds:['rt','da','forward','rtForecast'],symmetricWindowHours:4}));
 assert.equal(model.series.map(series=>series.id).join(','),'A:rt,A:da,A:forward,A:rtForecast');
 assert.equal(model.series[0].points.at(-1).time,t+4*3600000);
 assert.equal(model.series[2].points[0].time,t+4*3600000);
 assert.equal(model.series[3].points[0].time,t+5*3600000);
});
test('custom range is UTC, inclusive and rejects reversed ranges',()=>{
 let model=build(data,state({range:'custom',from:'2026-09-22T00:05',to:'2026-09-22T01:00'}));
 assert.equal(model.series[0].points.length,2);
 model=build(data,state({range:'custom',from:'2026-09-23T00:00',to:'2026-09-22T00:00'}));
 assert.ok(model.error);assert.ok(model.series.every(s=>s.points.length===0));
});
test('moving averages start only after a full window and do not alter raw data',()=>{
 const model=build(data,state({kinds:['rt'],rolling:'3'}));
 assert.equal(model.series.length,2);assert.equal(model.series[0].points.length,3);assert.equal(model.series[1].points.length,1);
 assert.equal(model.series[1].points[0].value,5/3);assert.equal(model.series[1].points[0].time,t+3600000);
});
test('CSV includes every charted point with exact UTC timestamp and unrounded value',()=>{
 const model=build(data,state({kinds:['rt'],rolling:'3'}));const output=csv(model.series,state());
 assert.equal(output.split('\r\n').length,5);assert.ok(output.includes('2026-09-22T00:00:00.000Z'));assert.ok(output.includes('1.6666666666666667'));assert.ok(output.includes('"-5"'));
});
test('empty data and daily buckets remain valid without fabricated readings',()=>{
 assert.equal(build({nodes:{}},state()).first,null);assert.equal(aggregate([], 'day').length,0);
 assert.equal(aggregate(normalize([p(0,10),p(1500,20)]),'day').length,2);
});
test('demand view charts Ontario history, forecast and current demand together',()=>{
 const demandData={updated:new Date(t).toISOString(),nodes:{},ontario:{demand:18000,history:[p(-3600000,17900)],forecastSeries:[p(0,17500)],demandCurrent:p(0,18000)}};
 const model=build(demandData,state({mode:'demand',kinds:['demand','demandForecast']}));
 assert.equal(model.series.map(series=>series.id).join(','),'IESO:demand,IESO:demandForecast');
 assert.equal(model.series[0].points[0].value,17900);assert.equal(model.series[0].points[1].value,18000);assert.equal(model.series[1].points[0].value,17500);
});
test('price scenarios retain original readings and label simulated chart/export series',()=>{
 const original=JSON.stringify(data);
 const config=state({kinds:['rt'],scenario:true,scenarioPercent:10});
 const model=build(data,config);
 assert.equal(model.series.length,2);
 assert.equal(model.series[0].points[2].value,10);
 assert.equal(model.series[1].points[2].value,11);
 assert.equal(model.series[1].points[0].value,-5.5);
 assert.ok(csv(model.series,config).includes('SCENARIO 10%'));
 assert.equal(JSON.stringify(data),original);
 assert.equal(build(data,state({...config,scenario:false})).series.length,1);
 assert.equal(build(data,state({...config,mode:'spread'})).series.length,1);
});
