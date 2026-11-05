const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const elements=new Map(),pending=[];
const element=()=>({hidden:false,disabled:false,value:'',textContent:'',innerHTML:'',setAttribute(){}});
const $=id=>{if(!elements.has(id))elements.set(id,element());return elements.get(id);};
const buttons=['history','occurrences','related'].map(section=>({...element(),dataset:{section}}));
const context={document:{getElementById:$,querySelectorAll:()=>buttons},location:{search:'?id=one'},URL,URLSearchParams,Date,JSON,crypto:require('node:crypto').webcrypto,
fetch(url,options){return new Promise(resolve=>pending.push({url,options,resolve}));}};
vm.createContext(context);vm.runInContext(fs.readFileSync(require('node:path').join(__dirname,'../event-detail.js'),'utf8'),context);
const answer=(r,data,status=200)=>r.resolve({ok:status<400,json:async()=>data});
const flush=()=>new Promise(resolve=>setImmediate(resolve));
const event={eventId:'one',summary:'<script>unsafe</script>',eventType:'alarm.open',source:'market',payload:{details:'Details'}};
const result=section=>({event,section,history:{items:[event],total:1,nextCursor:null},recurrence:{total:1,prior:0}});
(async()=>{
answer(pending.shift(),result('history'));await flush();
assert.ok($('timeline').innerHTML.includes('&lt;script&gt;'));
assert.equal($('title').textContent,event.summary);
buttons[1].onclick();const old=pending.shift();buttons[2].onclick();const current=pending.shift();
answer(current,result('related'));await flush();answer(old,{...result('occurrences'),history:{items:[],total:0}});await flush();
assert.ok($('timeline').innerHTML.includes('unsafe'),'late tab response must not erase selected history');
$('note').value='Follow up';const submit={preventDefault(){}};
const first=$('noteForm').onsubmit(submit);const one=pending.shift();answer(one,{error:'Unavailable'},503);await first;
const retry=$('noteForm').onsubmit(submit);const two=pending.shift();
assert.equal(JSON.parse(one.options.body).requestId,JSON.parse(two.options.body).requestId);
answer(two,{error:'Unavailable'},503);await retry;assert.equal($('note').value,'Follow up');
console.log('Event detail: escaped records, history races and safe note retries passed.');
})().catch(e=>{console.error(e);process.exitCode=1;});
