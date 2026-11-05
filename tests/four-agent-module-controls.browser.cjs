const {chromium}=require('playwright');
const http=require('node:http'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const canonical=path.resolve(__dirname,'..'),work=canonical,out=process.env.NORTHSTAR_REGRESSION_OUTPUT||path.join(canonical,'outputs/change-coordinator/four-agent-integration-20261013');
fs.mkdirSync(out,{recursive:true});
const candidate=true;
(async()=>{
 const server=http.createServer((req,res)=>{
  const url=new URL(req.url,'http://localhost'),rel=decodeURIComponent(url.pathname).slice(1);
  const root=candidate&&['module-workspace.js','module-workspace.css'].includes(rel)?work:canonical;
  const file=path.resolve(root,rel);
  if(!file.startsWith(root+path.sep)||!['.html','.js','.css','.svg','.png','.ico','.json'].includes(path.extname(file))){res.writeHead(404);res.end();return;}
  fs.readFile(file,(err,data)=>{res.writeHead(err?404:200,{'Content-Type':{'.html':'text/html','.js':'text/javascript','.css':'text/css'}[path.extname(file)]||'application/octet-stream'});res.end(err?'':data);});
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const browser=await chromium.launch({channel:'msedge',headless:true});
 const page=await browser.newPage({viewport:{width:1440,height:900}}),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/api/**',route=>{const p=new URL(route.request().url()).pathname;
  const data=p==='/api/auth/session'?{required:false}:p==='/api/weather'?{stations:[]}:p==='/api/market-prices'?{nodes:{},ontario:{}}:p==='/api/events/register'?{items:[],total:0,nextCursor:null,fetchedAt:'2026-10-13T12:00:00Z'}:p==='/api/events/sources'?{sources:[],types:[],statuses:[],note:'Fixture'}:null;
  return route.fulfill({status:data?200:503,contentType:'application/json',body:JSON.stringify(data||{error:'Fixture unavailable'})});});
 try{
  await page.goto(`http://127.0.0.1:${server.address().port}/northstar-clean.html`);
  await page.waitForFunction(()=>window.NorthstarModules?.registry.size>10);
  let modules=await page.evaluate(()=>[...NorthstarModules.registry.values()].filter(m=>!m.el.querySelector('iframe')).map(m=>({id:m.id,section:m.section})));
  if(process.env.DENSITY_FOCUS)modules=modules.filter(m=>process.env.DENSITY_FOCUS.split(',').includes(m.id));
  const results=[],checks=[];
  for(const m of modules){
   await page.evaluate(id=>NorthstarModules.open(id),m.id);
   await page.waitForTimeout(80);
   results.push(await page.evaluate(id=>{
    const m=NorthstarModules.registry.get(id),el=m.el,r=el.getBoundingClientRect();
    const visible=n=>!!n.getClientRects().length&&getComputedStyle(n).visibility!=='hidden';
    const chrome=[...el.querySelectorAll('h1,h2,h3,p,[class*="head"],[class*="toolbar"],[class*="filter"],[class*="controls"]')].filter(n=>visible(n)&&n.getBoundingClientRect().top<r.top+300).map(n=>({tag:n.tagName,cls:n.className,text:n.textContent.trim().slice(0,55),top:Math.round(n.getBoundingClientRect().top-r.top),height:Math.round(n.getBoundingClientRect().height)}));
    const tool=el.querySelector('.er-table-scroll,#priceGraph,.ng-play,.one-line-canvas-wrap,.outage-table-wrap,.oc-body');
    return {id,title:m.title,top:Math.round(r.top),chrome,toolTop:tool?Math.round(tool.getBoundingClientRect().top-r.top):null,collapsed:el.classList.contains('ns-tools-collapsed'),toggle:el.querySelector('.ns-tools-toggle')?.outerHTML};
   },m.id));
   if(candidate){
    const count=await page.evaluate(id=>{
     const el=NorthstarModules.registry.get(id).el;
     window.densityNodes=[...el.querySelectorAll('.ns-secondary-tools')];
     window.densityInput=window.densityNodes.flatMap(n=>[...n.querySelectorAll('input[type=search],input[type=text]')])[0];
     if(window.densityInput){window.densityOriginalValue=window.densityInput.value;window.densityInput.value='density retained';}
     return el.querySelectorAll('.ns-tools-toggle').length;
    },m.id);
    if(count){
     assert.equal(count,1,m.id+' has one Toolbar');
     const toggle=page.locator(`[data-ns-module="${m.id}"] .ns-tools-toggle`);
     await toggle.click();
     assert.equal(await toggle.getAttribute('aria-expanded'),'true',m.id+' opens');
     assert.equal(await toggle.innerText(),'Toolbar ▴',m.id+' readable open arrow');
     assert.equal(await page.evaluate(()=>densityNodes.every(n=>n.isConnected)),true,m.id+' retains native nodes');
     assert.equal(await page.evaluate(()=>!densityInput||densityInput.value==='density retained'),true,m.id+' retains input');
     await toggle.press('Enter');
     assert.equal(await toggle.getAttribute('aria-expanded'),'false',m.id+' keyboard closes');
     assert.equal(await toggle.innerText(),'Toolbar ▾',m.id+' readable closed arrow');
     assert.equal(await page.evaluate(()=>densityNodes.every(n=>getComputedStyle(n).display==='none')),true,m.id+' hides every secondary group');
     await page.evaluate(()=>{if(densityInput)densityInput.value=densityOriginalValue});
     checks.push(m.id);
    }
   }
  }
  if(candidate){
   for(const id of ['logbook:eventRegister','markets:historical','tools:schematic-builder']){
    await page.evaluate(id=>NorthstarModules.open(id),id);
    await page.screenshot({path:path.join(out,id.replace(':','-')+'.png')});
   }
   await page.evaluate(()=>NorthstarModules.open('operations:sites'));
   const tree=page.locator('.ns-tree-toggle:visible').first();
   assert.ok(await tree.count(),'Tree disclosure present');
   const treeOpen=await tree.getAttribute('aria-expanded');
   assert.equal(await tree.innerText(),treeOpen==='true'?'▾':'▸');
   await tree.click();
   assert.equal(await tree.getAttribute('aria-expanded'),treeOpen==='true'?'false':'true');
   assert.equal(await tree.innerText(),treeOpen==='true'?'▸':'▾');
   await tree.press('Enter');
   assert.equal(await tree.getAttribute('aria-expanded'),treeOpen);
   const openMobileEvents=async()=>{
    await page.getByRole('button',{name:'Choose mobile module lineup',exact:true}).click();
    const choice=page.locator('#nsPhonePicker input[value="logbook:eventRegister"]');
    await choice.check();
    const label=await choice.locator('..').innerText();
    await page.locator('#nsPhonePicker ol li > button:first-child').filter({hasText:label}).click();
    await page.waitForSelector('#eventRegister .ns-tools-toggle:visible');
   };
   await page.setViewportSize({width:390,height:844});
   await openMobileEvents();
   await page.waitForTimeout(100);
   const b=await page.locator('#eventRegister .ns-tools-toggle').boundingBox();
   assert.ok(b.x>=0&&b.x+b.width<=390,'Mobile Toolbar stays in viewport');
   await page.locator('#eventRegister .ns-tools-toggle').click();
   assert.equal(await page.locator('#erFilters').isVisible(),true,'Mobile filters open');
   await page.locator('#eventRegister .ns-tools-toggle').click();
   assert.equal(await page.locator('#erFilters').isVisible(),false,'Mobile filters close');
   await page.screenshot({path:path.join(out,'historical-mobile.png')});
   await page.reload();await page.waitForFunction(()=>window.NorthstarModules?.registry.size>10);
   await openMobileEvents();
   assert.equal(await page.locator('#erFilters').isVisible(),false,'Reload defaults to tool content');
   assert.deepEqual(errors,[],'No page errors');
  }
  fs.writeFileSync(path.join(out,candidate?'candidate-audit.json':'baseline-audit.json'),JSON.stringify({results,errors,checks},null,2));
  console.log(JSON.stringify({modules:results.length,disclosures:checks.length,errors,treeArrows:'passed'}));
 }finally{await browser.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1});
