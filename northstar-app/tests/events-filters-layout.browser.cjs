/* Run with NODE_PATH pointing at a Playwright installation; no live API writes. */
const {chromium}=require('playwright');
const http=require('node:http'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..');
fs.mkdirSync(path.join(root,'work'),{recursive:true});
(async()=>{
 const server=http.createServer((req,res)=>{
   const pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
   const target=path.resolve(root,'.'+pathname);
   if(!target.startsWith(root+path.sep)||!['.html','.js','.css','.svg','.png','.ico'].includes(path.extname(target))){res.writeHead(404);res.end();return;}
   fs.readFile(target,(err,data)=>{res.writeHead(err?404:200,{'Content-Type':{'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml'}[path.extname(target)]||'application/octet-stream'});res.end(err?'':data);});
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const browser=await chromium.launch({channel:'msedge',headless:true});
 const page=await browser.newPage({viewport:{width:1500,height:980}}),errors=[];
 await page.addInitScript(()=>{
   localStorage.setItem('northstar.phone.lineup.v1',JSON.stringify(['logbook:eventLogs']));
   if(!localStorage.northstarModuleWorkspaceV1)localStorage.northstarModuleWorkspaceV1=JSON.stringify({sections:{scada:{tabs:['scada:scada-module-0'],active:'scada:scada-module-0',landing:'scada:scada-module-0',boxes:{'scada:scada-module-0':{x:20,y:60,w:500,h:400}}}},modules:{'scada:scada-module-0':{full:{notes:'Saved SCADA notes'},compact:{}}}});
 });
 page.on('pageerror',error=>errors.push(error.message));
 await page.route('**/api/**',route=>{
   const pathname=new URL(route.request().url()).pathname;
   const data=pathname==='/api/auth/session'?{required:false}:pathname==='/api/weather'?{stations:[]}:pathname==='/api/market-prices'?{updated:'2026-09-15T00:00:00Z',nodes:{APIROQ:{rt:42,da:37,history:[],operations:{rtTransfer:12,dayAhead:10}}},ontario:{demand:15000,forecastDemand:15500}}:{};
   return route.fulfill({status:['/api/auth/session','/api/weather','/api/market-prices'].includes(pathname)?200:503,contentType:'application/json',body:JSON.stringify(data)});
 });
 try{
   await page.goto(`http://127.0.0.1:${server.address().port}/northstar-clean.html`);
   await page.waitForFunction(()=>window.NorthstarModules?.registry.size>10);
   await page.click('#sideNav [data-tab="logbook"]');
   await page.waitForSelector('#eventLogs:visible');
   const logs=page.locator('#eventLogs');
   const geometry=()=>logs.evaluate(el=>{
     const box=el.getBoundingClientRect(), primary=el.querySelector('.el-categories').getBoundingClientRect(), sub=el.querySelector('#elSubcategories').getBoundingClientRect(), next=el.querySelector('.el-events-heading').getBoundingClientRect();
     return {top:primary.top-box.top, bottom:primary.bottom, subTop:sub.top, subBottom:sub.bottom, subHeight:sub.height, next:next.top};
   });
   for(const width of [1500,390]){
     await page.setViewportSize({width,height:980});
     await page.waitForTimeout(300);
     await page.evaluate(()=>NorthstarModules.open('logbook:eventLogs'));
     await page.waitForSelector('#eventLogs:visible');
     await page.locator('[data-el-category="ALL"]').click();
     assert.equal(await logs.locator('.ns-tools-toggle').count(),0,'Logs has no Toolbar');
     assert.equal(await logs.locator('[data-el-category]:visible').count(),8,'Every primary category is visible');
     assert.equal(await logs.locator('.el-categories').evaluate(el=>el.scrollWidth<=el.clientWidth),true,'Filters fit without horizontal scrolling');
     let closed=await geometry(); assert.ok(closed.top<=1,'Primary filters start at the module top');
     assert.equal(closed.subHeight,0); assert.ok(Math.abs(closed.next-closed.bottom)<=1,'No reserved subfilter gap');
     for(const category of ['SCADA','COMS']){
       await page.locator(`[data-el-category="${category}"]`).click();
       const opened=await geometry();
       assert.ok(opened.subHeight>0); assert.ok(Math.abs(opened.subTop-opened.bottom)<=1);
       assert.ok(Math.abs(opened.next-opened.subBottom)<=1,'Following content follows expanded row');
       await page.locator('[data-el-category="WATER"]').click();
       assert.equal((await geometry()).next,closed.next,'Child row collapses completely');
     }
     await page.locator('[data-el-category="SCADA"]').click();
     await page.locator('[data-el-child="S+"]').click();
     await page.evaluate(()=>NorthstarModules.refresh());
     await page.waitForTimeout(150);
     assert.equal(await page.locator('[data-el-child="S+"]').getAttribute('aria-pressed'),'true');
     assert.equal(await logs.locator('.ns-tools-toggle').count(),0);
   }
   await page.screenshot({path:'work/events-filters-mobile.png'});
   console.log('PASS desktop/mobile filters, flush geometry, dynamic children, module refresh');
 } finally {await browser.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1});
