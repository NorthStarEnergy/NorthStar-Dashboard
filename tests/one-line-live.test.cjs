const {test} = require('node:test');
const assert = require('node:assert/strict');
const context = {module:{exports:{}}};
require('node:vm').runInNewContext(require('node:fs').readFileSync(require('node:path').join(__dirname,'../one-line-live.js'),'utf8'),context);
const live = context.module.exports;
const now = Date.parse('2026-09-28T12:00:00Z');
const config = live.binding({feedCode:'plant', tagName:'52A', staleAfterSeconds:30});
const reading = {feedCode:'plant', tagName:'52A', siteCode:'TEST', numericValue:1, sourceQuality:'Good', observedAt:'2026-09-28T11:59:55Z'};
test('maps only explicitly configured valid feedback', () => {
  assert.equal(live.position(config,[reading],now,true,'TEST').state,'closed');
  assert.equal(live.position(config,[{...reading,numericValue:0}],now,true,'TEST').state,'open');
  assert.equal(live.position(config,[{...reading,numericValue:2}],now,true,'TEST').state,'unknown');
  assert.equal(live.position({...config,openValue:'1'},[reading],now,true).label,'INVALID MAPPING');
  assert.equal(live.position({...config,openValue:'OPEN',closedValue:'CLOSED'},[{...reading,numericValue:null,textValue:'closed'}],now,true).state,'closed');
});
test('fails closed on missing, stale, future, bad quality, wrong site/feed, duplicates and transport loss', () => {
  for (const readings of [[],[{...reading,observedAt:'2020-01-01'}],[{...reading,observedAt:'invalid'}],[{...reading,observedAt:'2030-01-01'}],[{...reading,sourceQuality:'bad'}],[{...reading,sourceQuality:null}],[{...reading,feedCode:'other'}],[{...reading,siteCode:'OTHER'}],[reading,reading]]) {
    assert.equal(live.position(config,readings,now,true,'TEST').state,'unknown');
  }
  assert.equal(live.position(config,[reading],now,false).label,'UNAVAILABLE');
  assert.equal(live.position(live.binding(),[reading],now,true).state,'unbound');
});
test('numeric zero is a value, blank or nonfinite is not', () => {
  assert.equal(live.resolve(config,[{...reading,numericValue:0}],now,true).value,0);
  for (const value of [null,NaN,Infinity,'']) assert.equal(live.resolve(config,[{...reading,numericValue:value,textValue:null}],now,true).state,'unknown');
});
test('metadata migration retains tags and bounds measurements without storing live values', () => {
  const result = live.metadata({assetTag:'52-A',measurements:Array(10).fill({tagName:'MW',numericValue:123}),scada:{tagName:'52A'}});
  assert.equal(result.measurements.length,6);
  assert.equal(result.scada.openValue,'0');
  assert.equal(result.measurements[0].numericValue,undefined);
});
