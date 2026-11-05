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
   await page.click('#sideNav [data-tab="tools"]');
   const ids=await page.evaluate(()=>[...NorthstarModules.registry.values()].filter(m=>m.section==='tools').map(m=>m.id));
   await page.evaluate(id=>NorthstarModules.open(id),ids[1]);
   const tabs=page.locator('.ns-module-tabs');
   assert.equal(await page.locator('[data-popout-module]').count(),0);
   assert.equal(await tabs.evaluate(el=>!!el.closest('.ns-module-window')),true);
   assert.ok((await tabs.boundingBox()).height<=30);
   const drag=async(from,x,y)=>{await from.scrollIntoViewIfNeeded();const r=await from.boundingBox();await page.mouse.move(r.x+r.width/2,r.y+r.height/2);await page.mouse.down();await page.mouse.move(x,y,{steps:15});await page.mouse.up();};
   await drag(page.locator('.ns-tab').last(),900,300);
   await page.waitForSelector('.ns-detached-window');
   assert.equal(await page.locator('.ns-tab').count(),1);
   assert.equal(await page.locator('.ns-module-window:visible').count(),2);
   assert.equal(await page.locator('.ns-detached-window .ns-detached-toolbar').count(),1,'Detached module has one full-width drag bar');
   assert.equal(await page.locator('.ns-detached-window .ns-window-handle').count(),0,'Detached module has no visible resize boxes');
   assert.equal(await page.locator('.ns-detached-window .ns-detached-edge').count(),8,'Detached module has transparent edge resize targets');
   const detached=page.locator('.ns-detached-window');
   const beforeResize=await detached.boundingBox();
   await page.mouse.move(beforeResize.x+beforeResize.width-2,beforeResize.y+beforeResize.height/2);await page.mouse.down();await page.mouse.move(beforeResize.x+beforeResize.width+60,beforeResize.y+beforeResize.height/2);await page.mouse.up();
   assert.ok((await detached.boundingBox()).width>beforeResize.width+50,'Detached module resizes from its edge');
   await page.reload();await page.waitForSelector('.ns-detached-window');
   const row=await tabs.boundingBox();
   await drag(page.locator('.ns-detached-window .ns-detached-toolbar'),row.x+50,row.y+row.height/2);
   await page.waitForFunction(()=>!document.querySelector('.ns-detached-window'));
   assert.equal(await page.locator('.ns-tab').count(),2);
   await drag(page.locator('.ns-tab').last(),900,300);
   await page.waitForSelector('.ns-detached-window');
   await drag(page.locator('.ns-tab').first(),500,500);
   assert.equal(await page.locator('.ns-detached-window').count(),2);
   assert.equal(await page.locator('.ns-empty-dock').count(),1);
   const empty=await tabs.boundingBox();
   await drag(page.locator('.ns-detached-window .ns-detached-toolbar').first(),empty.x+40,empty.y+10);
   assert.equal(await page.locator('.ns-tab').count(),1);
   const otherRow=await tabs.boundingBox();
   await drag(page.locator('.ns-detached-window .ns-detached-toolbar'),otherRow.x+40,otherRow.y+10);
   assert.equal(await page.locator('.ns-detached-window').count(),0);
   const firstId=await page.locator('.ns-tab').first().getAttribute('data-tab-id');
   const last=await page.locator('.ns-tab').last().boundingBox();
   await drag(page.locator('.ns-tab').first(),last.x+last.width+12,last.y+8);
   assert.equal(await page.locator('.ns-tab').last().getAttribute('data-tab-id'),firstId,'Tabs reorder');
   await page.locator('.ns-tab [role=tab]').first().click();
   assert.equal(await page.locator('.ns-tab [role=tab]').first().getAttribute('aria-selected'),'true','Click still activates');
   await page.locator('.ns-tab [data-close-module]').last().click();
   assert.equal(await page.locator('.ns-tab').count(),1,'Close still works');
   await page.evaluate(()=>getSelection().removeAllRanges());
   await page.screenshot({path:path.join(root,'outputs/module-tabs-preview.png')});
   console.log('PASS: compact internal tabs, no arrows, detach, reload persistence, redock, last-tab empty dock, repeated docking.');
 }finally{await browser.close();server.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
