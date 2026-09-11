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
    getAttribute:()=>'',setAttribute(){},closest:()=>null,append(child){this.children.push(child);},
    addEventListener:(name,fn)=>listeners.set(name,fn),removeEventListener:name=>listeners.delete(name),
    setPointerCapture(){},hasPointerCapture:()=>true,releasePointerCapture(){}};
}
const main=element('main'), weather=element('','Kenora'), dispatch=element('dispatchClient');
let market=element('','APIROQ');
const events=element('eventsCard','overview-events'), staff=element('','Station A');
const document={body:{classList:{toggle(){}}},createElement:()=>element(),
  querySelector:s=>s==='main'?main:s==='#overview'?{classList:{contains:()=>active}}:null,
  querySelectorAll:s=>s.includes('#weatherStrip')?[weather]:s==='#dispatchClient'?[dispatch]:
    s.includes('#marketTopTiles')?[market]:s==='#eventsCard'?[events]:
    s==='#staffGroups > .staff-group'?[staff]:[]};
const context={document,window:{scrollX:0,scrollY:0,scrollBy(){},addEventListener(){}},innerHeight:900,
  localStorage:{getItem:k=>memory.get(k)||null,setItem:(k,v)=>memory.set(k,v)},
  readZone:()=>({position:{}}),writeZone:(id,state)=>persisted=state,
  editing:()=>edit,requestAnimationFrame:()=>1,MutationObserver:class{observe(){}},
  overlaps:(a,b)=>a.x<b.x+b.w&&a.x+a.w>b.x&&a.y<b.y+b.h&&a.y+a.h>b.y};
vm.createContext(context);vm.runInContext(source.slice(start,end)+'\nthis.canvas=setupCanvas();',context);
const get=key=>JSON.parse(memory.get('northstarCanvasLayoutV1'))[key];
const fire=(handle,name,values={})=>handle.listeners.get(name)({preventDefault(){},stopPropagation(){},...values});
for(const el of [weather,dispatch,market,events,staff])assert.equal(el.children.length,2);
const initial=get('canvas:market:APIROQ');
for(let i=0;i<60;i++)fire(market.children[0],'keydown',{key:'ArrowRight',shiftKey:true});
assert.equal(get('canvas:market:APIROQ').x,initial.x+1200,'market crosses its former group and viewport boundaries');
fire(market.children[1],'keydown',{key:'ArrowDown',shiftKey:true});
const resized=get('canvas:market:APIROQ');assert.equal(resized.h,initial.h+20);
edit=false;context.canvas.sync();assert.equal(market.properties.height,resized.h+'px','Done preserves size');
market=element('','APIROQ');context.canvas.sync();assert.equal(market.properties.left,resized.x+'px','feed replacement preserves position');
assert.equal(market.properties.height,resized.h+'px');
events.dataset.moduleId='eventLog';context.canvas.sync();assert.ok(get('canvas:events:eventsCard'),'event identity survives header migration');
edit=true;
const before=get('canvas:dispatch:dispatchClient');
fire(dispatch.children[0],'pointerdown',{button:0,clientX:100,clientY:100,pointerId:1});
fire(dispatch.children[0],'pointermove',{clientX:700,clientY:400});
fire(dispatch.children[0],'pointerup',{type:'pointerup'});
assert.equal(get('canvas:dispatch:dispatchClient').x,before.x+600);
assert.equal(get('canvas:dispatch:dispatchClient').y,before.y+300);
const moved=get('canvas:dispatch:dispatchClient');
fire(dispatch.children[1],'pointerdown',{button:0,clientX:100,clientY:100,pointerId:2});
fire(dispatch.children[1],'pointermove',{clientX:500,clientY:500});
fire(dispatch.children[1],'pointercancel',{type:'pointercancel'});
assert.deepEqual(get('canvas:dispatch:dispatchClient'),moved,'cancel restores geometry');
active=false;context.canvas.sync();assert.equal(main.properties['min-height'],undefined,'other workspaces retain normal layout');
active=true;context.canvas.sync();assert.equal(dispatch.properties.left,moved.x+'px');
assert.ok(persisted.position['canvas:staff:Station A']);
console.log('Shared canvas: independent movement, resizing, Done, feed refresh, stable IDs, pointer cancel and tab restoration passed.');
