const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const elements=new Map(),pending=[];let formValues=[];
function element(){return {hidden:false,disabled:false,value:'',innerHTML:'',textContent:'',dataset:{},listeners:{},elements:[],open:false,
  classList:{contains:()=>true},setAttribute(){},append(){},prepend(){},focus(){},scrollIntoView(){},
  addEventListener(name,fn){this.listeners[name]=fn;},querySelector(){return element();},querySelectorAll(){return [];},
  showModal(){this.open=true;},close(){this.open=false;this.listeners.close?.();},click(){},reset(){formValues=[];}};}
const host=element();let dialog;
const document={readyState:'complete',hidden:false,body:{append(e){dialog=e;}},activeElement:null,
  getElementById(id){if(!elements.has(id))elements.set(id,element());return elements.get(id);},
  querySelector(s){return s==='#logbook'?host:s==='#eventRegister'?null:element();},createElement:()=>element()};
const context={document,window:{location:{assign(url){context.destination=url;}}},URL,URLSearchParams,Intl,Date,JSON,crypto:require('node:crypto').webcrypto,
  FormData:class{*[Symbol.iterator](){yield*formValues;}},setInterval(){},
  fetch(url,options){return new Promise(resolve=>pending.push({url,options,resolve}));}};
vm.createContext(context);vm.runInContext(fs.readFileSync(require('node:path').join(__dirname,'../events-register.js'),'utf8'),context);
const $=id=>document.getElementById(id);
const flush=()=>new Promise(resolve=>setImmediate(resolve));
const answer=(request,value,status=200)=>request.resolve({ok:status<400,status,json:async()=>value});
const event=(id,summary)=>({eventId:id,occurredAt:'2026-09-11T10:00:00Z',recordedAt:'2026-09-11T10:00:01Z',
  source:'market',actorId:'operator',category:'alarm',severity:'info',aggregateType:'price_alert',aggregateId:id,eventType:'market.resolved',summary,payload:{details:'Recorded details'}});
(async()=>{
  answer(pending.shift(),{sources:[],types:[],statuses:[],note:'Not configured'});
  answer(pending.shift(),{items:[event('one','<script>unsafe</script>')],total:1,nextCursor:null,snapshot:1,fetchedAt:'2026-09-11T10:00:00Z'});
  await flush();assert.ok($('erRows').innerHTML.includes('&lt;script&gt;'));assert.ok(!$('erRows').innerHTML.includes('<script>'));
  const before=$('erRows').innerHTML;
  $('erRefresh').onclick();answer(pending.shift(),{error:'Disconnected'},503);await flush();
  assert.equal($('erRows').innerHTML,before,'failed refresh retains rows');assert.equal($('erError').hidden,false);
  context.window.NorthStarEvents.open('one / two');
  assert.equal(context.destination,'event-detail.html?id=one%20%2F%20two');
  assert.ok(before.includes('href="event-detail.html?id=one"'));
  console.log('Events UI: escaping, failed-refresh retention and event-page navigation passed.');
})().catch(error=>{console.error(error);process.exitCode=1;});
