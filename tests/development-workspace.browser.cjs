/* Run with NODE_PATH pointing at a Playwright installation; no live API writes. */
const {chromium}=require('playwright');
const http=require('node:http'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..');
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
   assert.notEqual(await page.locator('#overview').evaluate(e=>getComputedStyle(e).display),'none');
   assert.equal(await page.locator('#nsStatusBar').isVisible(),true);
   assert.notEqual(await page.locator('#overview').evaluate(e=>getComputedStyle(e).display),'none');
   assert.equal(await page.locator('#demoMarket').count(),0,'legacy Overview is the default');
   const snapshot=await page.evaluate(()=>localStorage.northstarDevelopmentSnapshot20260930);
   assert.ok(JSON.parse(snapshot).preferences.northstarModuleWorkspaceV1.includes('Saved SCADA notes'));
   await page.click('#nsDevelopmentFolder summary');
   const download=page.waitForEvent('download');
   await page.click('[data-development-export]');
   assert.equal((await download).suggestedFilename(),'northstar-development-configuration-20260930.json');
   await page.click('[data-development-view="overview"]');
   await page.waitForFunction(()=>document.documentElement.dataset.nsDevelopment==='demo' && document.documentElement.dataset.nsDevelopmentFixed==='false');
   await page.waitForFunction(()=>window.NorthstarModules?.registry.size>10);
   assert.notEqual(await page.locator('#overview').evaluate(e=>getComputedStyle(e).display),'none');
   assert.equal(await page.locator('#nsStatusBar').isVisible(),true);
   assert.equal(await page.locator('#nsDemoOverview').count(),0);
   assert.equal(await page.evaluate(()=>localStorage.northstarDevelopmentSnapshot20260930),snapshot);
   await page.click('[data-development-view="fixed"]');
   await page.waitForFunction(()=>document.documentElement.dataset.nsDevelopmentFixed==='true');
   await page.waitForFunction(()=>window.NorthstarModules?.registry.size>10);
   assert.equal(await page.locator('#overview').isVisible(),false);
   assert.equal(await page.locator('[data-demo-field-status]').isVisible(),true,'new compact bar is in Development');
   assert.equal(await page.locator('#nsStatusBar').isVisible(),true);
   await page.click('#sideNav [data-tab="switching"]');
   await page.waitForFunction(()=>window.NorthstarModules?.registry.size>10 && !location.search.includes('nsDevelopment'));
   assert.equal(await page.locator('#nsStatusBar').isVisible(),true);
   assert.equal(await page.locator('#nsDemoOverview').count(),0);
   assert.equal(await page.locator('.ns-module-window:visible').count(),1);
   await page.click('#sideNav [data-tab="overview"]');
   assert.notEqual(await page.locator('#overview').evaluate(e=>getComputedStyle(e).display),'none');
   assert.equal(await page.evaluate(()=>localStorage.northstarDevelopmentSnapshot20260930),snapshot);

   console.log('Browser errors:',errors);
   assert.equal(errors.length,0);
   console.log('Development snapshot, download, both archived views, section return and demo home passed.');
 }finally{await browser.close();server.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
