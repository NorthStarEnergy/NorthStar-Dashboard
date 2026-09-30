const fs = require('node:fs'), vm = require('node:vm'), assert = require('node:assert/strict');
const source = fs.readFileSync(require('node:path').join(__dirname,'../module-layout.js'),'utf8');
const start = source.indexOf('  function setupCanvas()');
const end = source.indexOf('  function applyFreeform(',start);
const memory = new Map(), handlers = new Map();
let active = true, edit = true, persisted;
function element(id='',moduleId='') {
  const properties = {}, listeners = new Map();
  return {id,dataset:moduleId?{moduleId}:{},children:[],clientWidth:1200,style:{
    setProperty:(k,v)=>properties[k]=v,removeProperty:k=>delete properties[k]},properties,listeners,
    getAttribute:()=>'',setAttribute(){},querySelector:()=>null,closest:()=>null,matches:s=>s==='#overviewStaff #staffGroups > .staff-group',append(child){this.children.push(child);},
    addEventListener:(name,fn)=>listeners.set(name,fn),removeEventListener:name=>listeners.delete(name),
    setPointerCapture(){},hasPointerCapture:()=>true,releasePointerCapture(){}};
}
const main=element('main'), weather=element('','Kenora'), dispatch=element('dispatchClient');
let market=element('','APIROQ');
const events=element('overviewEventsSummary','overview-events'), staff=element('','Station A');
const document={documentElement:{dataset:{nsStyles:'ready'}},body:{classList:{toggle(){},contains:()=>false}},createElement:()=>element(),
  querySelector:s=>s==='main'?main:s==='#overview'?{classList:{contains:()=>active}}:null,
  querySelectorAll:s=>s.includes('#overviewStaff #staffGroups')?[staff]:s.includes('#weatherStrip')?[weather]:s==='#dispatchClient'?[dispatch]:
    s.includes('#marketTopTiles')?[market]:s.includes('#overviewModules >')?[events]:
    []};
const context={document,window:{northstarLayoutSnapToGrid:false,scrollX:0,scrollY:0,scrollBy(){},addEventListener(){}},innerHeight:900,
  localStorage:{getItem:k=>memory.get(k)||null,setItem:(k,v)=>memory.set(k,v)},
  readZone:()=>({position:{}}),writeZone:(id,state)=>persisted=state,
  readPreference:()=>[],
  editing:()=>edit,requestAnimationFrame:()=>1,MutationObserver:class{observe(){}},
  overlaps:(a,b)=>a.x<b.x+b.w&&a.x+a.w>b.x&&a.y<b.y+b.h&&a.y+a.h>b.y};
vm.createContext(context);vm.runInContext(source.slice(start,end)+'\nthis.canvas=setupCanvas();',context);
const get=key=>JSON.parse(memory.get('northstarCanvasLayoutV1'))[key];
const fire=(handle,name,values={})=>handle.listeners.get(name)({preventDefault(){},stopPropagation(){},...values});
for(const el of [weather,dispatch,market,events])assert.equal(el.children.length,6);
assert.deepEqual([market.children[2].dataset.corner,market.children[3].dataset.corner,market.children[4].dataset.corner,market.children[5].dataset.corner],['se','sw','ne','nw'],'all four resize corners are available');
const initial=get('canvas:market:APIROQ');
for(let i=0;i<60;i++)fire(market.children[1],'keydown',{key:'ArrowRight',shiftKey:true});
assert.equal(get('canvas:market:APIROQ').x,initial.x+1200,'market crosses its former group and viewport boundaries');
fire(market.children[2],'keydown',{key:'ArrowDown',shiftKey:true});
const resized=get('canvas:market:APIROQ');assert.equal(resized.h,initial.h+20);
edit=false;context.canvas.sync();assert.equal(market.properties.height,resized.h+'px','Done preserves size');
market=element('','APIROQ');context.canvas.sync();assert.equal(market.properties.left,resized.x+'px','feed replacement preserves position');
assert.equal(market.properties.height,resized.h+'px');
events.dataset.moduleId='eventLog';context.canvas.sync();assert.ok(get('canvas:overview:overviewEventsSummary'),'event identity survives header migration');
edit=true;
const before=get('canvas:dispatch:dispatchClient');
fire(dispatch.children[1],'pointerdown',{button:0,clientX:100,clientY:100,pointerId:1});
fire(dispatch.children[1],'pointermove',{clientX:700,clientY:400});
fire(dispatch.children[1],'pointerup',{type:'pointerup'});
assert.equal(get('canvas:dispatch:dispatchClient').x,before.x+600);
assert.equal(get('canvas:dispatch:dispatchClient').y,before.y+300);
const moved=get('canvas:dispatch:dispatchClient');
fire(dispatch.children[2],'pointerdown',{button:0,clientX:100,clientY:100,pointerId:2});
fire(dispatch.children[2],'pointermove',{clientX:500,clientY:500});
fire(dispatch.children[2],'pointercancel',{type:'pointercancel'});
assert.deepEqual(get('canvas:dispatch:dispatchClient'),moved,'cancel restores geometry');
for (const [index,corner] of [[2,'sw'],[3,'ne'],[4,'nw']]) {
  const original=get('canvas:dispatch:dispatchClient');
  fire(dispatch.children[index+1],'keydown',{key:'ArrowRight'});
  fire(dispatch.children[index+1],'keydown',{key:'ArrowDown'});
  const next=get('canvas:dispatch:dispatchClient');
  assert.equal(next.w,original.w+(corner.includes('w')?-5:5));
  assert.equal(next.h,original.h+(corner.includes('n')?-5:5));
  if(corner.includes('w'))assert.equal(next.x+next.w,original.x+original.w,'west resize anchors opposite edge');
  if(corner.includes('n'))assert.equal(next.y+next.h,original.y+original.h,'north resize anchors opposite edge');
}
const finalBox=get('canvas:dispatch:dispatchClient');
const oppositeBottom=finalBox.y+finalBox.h;
fire(dispatch.children[5],'keydown',{key:'ArrowUp',shiftKey:true});
assert.equal(get('canvas:dispatch:dispatchClient').y+get('canvas:dispatch:dispatchClient').h,oppositeBottom,'North resize preserves opposite edge');
active=false;context.canvas.sync();assert.equal(main.properties['min-height'],undefined,'other workspaces retain normal layout');
active=true;context.canvas.sync();assert.equal(dispatch.properties.left,finalBox.x+'px');
assert.ok(!persisted.position['canvas:staff:Station A']);
assert.equal(staff.children.length,0,'Roster groups remain inside their own resize zone');
console.log('Shared canvas: independent movement, resizing, Done, feed refresh, stable IDs, pointer cancel and tab restoration passed.');
