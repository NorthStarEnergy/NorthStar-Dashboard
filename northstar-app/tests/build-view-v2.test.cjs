const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const api=renderer();
const symbol={id:'CB1',type:'breaker',x:300,y:200,assetTag:'Manual 52',siteCode:'TW',scada:{feedCode:'plant',tagName:'TW-52G1'},measurements:[]};
const reading={feedCode:'plant',tagName:'TW-52G1',siteCode:'TW',numericValue:1,sourceQuality:'good',observedAt:new Date().toISOString()};
test('SCADA names require an exact unique feed, tag and station match',()=>{
  assert.deepEqual(JSON.parse(JSON.stringify(api.deviceName(symbol,[reading]))),{name:'TW-52G1',source:'SCADA',manual:false});
  for(const rows of [[],[reading,reading],[{...reading,siteCode:'OTHER'}],[{...reading,feedCode:'other'}],[{...reading,tagName:'TW-52G10'}]])
    assert.equal(api.deviceName(symbol,rows).manual,true);
});
test('manual names survive unavailable telemetry without inventing a source name',()=>{
  assert.equal(api.deviceName(symbol,[reading],false).name,'Manual 52');
  assert.equal(api.deviceName({...symbol,scada:{},assetTag:'Custom transformer'},[]).name,'Custom transformer');
  assert.equal(api.deviceName({...symbol,assetTag:'',label:'Manual label'},[]).name,'Manual label');
});
test('a unique measurement binding can name a device without a status binding',()=>{
  const s={...symbol,scada:{},measurements:[symbol.scada]};
  assert.equal(api.deviceName(s,[reading]).name,reading.tagName);
});
function renderer(){
  const context={};context.window=context;vm.createContext(context);
  for(const file of ['one-line-symbol-library.js','one-line-live.js','build-view-schematic.js'])
    vm.runInContext(fs.readFileSync(path.join(__dirname,'..',file),'utf8'),context);
  return context.NorthStarBuildSchematic;
}
test('viewer uses saved terminals and catalogue symbols; no inferred station topology',()=>{
  const viewer=renderer();
  const s={...symbol,scada:{...symbol.scada,openValue:'0',closedValue:'1',staleAfterSeconds:120},rotation:0};
  const record={symbols:[s,{...s,id:'G1',type:'generator',x:100,scada:{},assetTag:'G1'}],edges:[{id:'E1',from:'G1',to:'CB1'}]};
  const markup=viewer.render(record,[reading],true);
  assert.match(markup,/bv2-wire/);assert.match(markup,/TW-52G1/);assert.match(markup,/CLOSED/);
  const noEdges=viewer.render({...record,edges:[]},[reading],true);
  assert.doesNotMatch(noEdges,/class="bv2-wire"/);
  assert.match(viewer.render({symbols:[],edges:[]}),/No devices/);
});
test('stale or ambiguous switch feedback is unknown, never a guessed open or closed state',()=>{
  const viewer=renderer(),record={symbols:[{...symbol,scada:{...symbol.scada,openValue:'0',closedValue:'1',staleAfterSeconds:120}}],edges:[]};
  for(const rows of [[{...reading,observedAt:'2000-01-01'}],[reading,reading],[]]){
    const markup=viewer.render(record,rows,true);
    assert.match(markup,/bv2-unknown/);assert.doesNotMatch(markup,/>CLOSED</);
  }
});
test('manual labels are escaped in SVG',()=>{
  const markup=renderer().render({symbols:[{...symbol,scada:{},assetTag:'<script>alert(1)</script>'}],edges:[]},[],false);
  assert.doesNotMatch(markup,/<script>/);assert.match(markup,/&lt;script&gt;/);
});
