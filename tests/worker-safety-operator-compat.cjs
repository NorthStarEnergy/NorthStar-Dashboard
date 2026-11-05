const fs=require('fs'),path=require('path'),assert=require('assert/strict');
const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
(async()=>{
 for(const file of ['field-roster.js','field-roster-v1-original.js','build-view-v3-data.js','northstar-clean.html','northstar-v1.html']){
  const s=fs.readFileSync(path.join(__dirname,'..',file),'utf8');
  let code,args,values;
  if(file.startsWith('field-roster')){
   const start=s.indexOf("const options={method:action==='out'");
   code=s.slice(start,s.indexOf('if(!response.ok)',start));
   args=['fetch','action','path'];values=['in','/api/checkins/fixture/safety-checkin'];
  }else if(file==='build-view-v3-data.js'){
   const start=s.indexOf("const options = {method:'POST'");
   code=s.slice(start,s.indexOf('if (!response.ok)',start));
   args=['fetch','action','worker','suffix'];values=['heartbeat',{id:'fixture'},'/safety-checkin'];
  }else{
   const start=s.indexOf("const options={method:'POST',headers:{'Content-Type':'application/json'},body:'{}'},path=");
   code=s.slice(start,s.indexOf('loadStaff()',start));
   args=['fetch','b'];values=[{dataset:{manualCheckin:'fixture'}}];
  }
  assert(code.includes("response.status===404"),file);
  const perform=new AsyncFunction(...args,code+'return response;');
  for(const first of [200,403,404,503]){
   const calls=[];
   const result=await perform(async(url,options)=>{calls.push({url,options});return {status:calls.length===1?first:200}},...values);
   assert.equal(calls[0].url,'/api/checkins/fixture/safety-checkin',file);
   assert.equal(calls.length,first===404?2:1,file);
   if(first===404){assert.equal(calls[1].url,'/api/checkins/fixture/heartbeat',file);assert.equal(result.status,200)}
   for(const call of calls)assert.equal(call.options.method,'POST');
  }
 }
 console.log('PASS: five operator surfaces prefer explicit safety confirmation; legacy fallback only on 404, never on permission or service failure (20 cases).');
})().catch(e=>{console.error(e);process.exitCode=1});
