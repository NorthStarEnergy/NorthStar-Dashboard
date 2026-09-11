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
const context={document,window:{},URL,URLSearchParams,Intl,Date,JSON,crypto:require('node:crypto').webcrypto,
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
  context.window.NorthStarEvents.open('one');const old=pending.shift();
  context.window.NorthStarEvents.open('two');const newest=pending.shift();
  answer(newest,{event:event('two','Second event'),history:{items:[event('two','Second event')],nextCursor:null,total:1}});await flush();
  answer(old,{event:event('one','First event'),history:{items:[event('one','First event')],nextCursor:null,total:1}});await flush();
  assert.ok($('erSelected').innerHTML.includes('Second event'));assert.ok(!$('erSelected').innerHTML.includes('First event'),'late detail response cannot replace current selection');
  $('erNote').value='Operator follow-up';const submit={preventDefault(){},submitter:element()};
  const first=$('erNoteForm').onsubmit(submit);const request=pending.shift();const token=JSON.parse(request.options.body).requestId;
  answer(request,{error:'Connection lost'},503);await first;
  const retry=$('erNoteForm').onsubmit(submit);const request2=pending.shift();assert.equal(JSON.parse(request2.options.body).requestId,token,'uncertain note retries use same idempotency key');
  answer(request2,{error:'Still disconnected'},503);await retry;
  assert.equal($('erNote').value,'Operator follow-up','failed notes remain editable');
  console.log('Events UI: escaped content, retained results, detail request races and idempotent note retry passed.');
})().catch(error=>{console.error(error);process.exitCode=1;});
