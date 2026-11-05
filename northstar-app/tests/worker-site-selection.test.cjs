const fs=require('fs'),vm=require('vm'),assert=require('assert');
const html=fs.readFileSync(require('path').join(__dirname,'../contractor-checkin.html'),'utf8');
const script=html.match(/<script>([\s\S]*?)<\/script>/)[1];
async function run(query,tokenSite){
 const nodes={},calls=[];
 const get=id=>nodes[id] ||= {value:'',hidden:false,disabled:false,options:[],add(o){this.options.push(o)},classList:{toggle(){}},setAttribute(){},removeAttribute(){}};
 const context={URLSearchParams,location:{search:query},localStorage:{getItem(){return null},setItem(){},removeItem(){}},document:{querySelector:get,addEventListener(){}},navigator:{},window:{addEventListener(){}},setInterval(){},clearInterval(){},addEventListener(){},Option:function(text,value){this.text=text;this.value=value},fetch:async(url,options)=>{calls.push({url,options});return {ok:true,json:async()=>({site:tokenSite})}},console};
 vm.createContext(context);vm.runInContext(script,context);await new Promise(setImmediate);
 return {context,nodes,calls};
}
(async()=>{
 let result=await run('',null);assert.equal(result.nodes['#siteName'].disabled,false);assert.equal(result.nodes['#siteName'].value,'');
 result.nodes['#siteName'].onchange({target:{value:'Twin Falls'}});assert.equal(vm.runInContext('site',result.context),'Twin Falls');assert.equal(vm.runInContext('token',result.context),'');
 result=await run('?token=signed-test','Iroquois Falls');assert.equal(result.nodes['#siteName'].value,'Iroquois Falls');assert.equal(result.nodes['#siteName'].disabled,true);assert.equal(result.calls[0].url,'/api/checkin-tokens/resolve?token=signed-test');
 result=await run('?site=APIROQ');assert.equal(result.nodes['#siteName'].value,'Iroquois Falls');
 console.log('Manual site selection, signed QR resolution, and legacy QR prefill passed.');
})().catch(e=>{console.error(e);process.exit(1)});
