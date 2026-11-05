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
 const context=await browser.newContext({viewport:{width:1500,height:980}});
 const page=await context.newPage(),errors=[];
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
   await page.click('#sideNav [data-tab="weather"]');
   const before=await page.evaluate(()=>localStorage.northstarModuleWorkspaceV1);
   await page.context().route('**/api/**',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(new URL(route.request().url()).pathname==='/api/auth/session'?{required:false}:{})}));
   const opened=page.waitForEvent('popup');
   await page.evaluate(()=>window.NorthstarModules.popOut(window.NorthstarModules.state.sections.weather.active));
   const popup=await opened;
   await popup.waitForSelector('body.ns-module-popout .ns-module-window:visible');
   assert.equal(await popup.locator('.ns-module-window:visible').count(),1);
   assert.equal(await popup.locator('#sideNav').isVisible(),false);
   assert.equal(await popup.locator('.app>aside').isVisible(),false);
   assert.equal(await popup.locator('#nsStatusBar').isVisible(),false);
   assert.equal(await popup.locator('.ns-section-shell').isVisible(),false);
   assert.equal(await page.evaluate(()=>localStorage.northstarModuleWorkspaceV1),before,'Detached startup preserves main workspace');
   assert.equal(await popup.locator('.ns-popout-toolbar').count(),1);
   assert.equal(await popup.locator('.ns-popout-edge').count(),8);
   await popup.getByRole('button',{name:'Minimize',exact:true}).click();
   assert.equal(await popup.locator('.ns-popout-frame').isVisible(),false);
   await popup.getByRole('button',{name:'Restore',exact:true}).click();
   await popup.getByRole('button',{name:'Maximize',exact:true}).click();
   assert.equal(await popup.locator('body').evaluate(el=>el.classList.contains('ns-popout-maximized')),true);
   await popup.getByRole('button',{name:'Restore size',exact:true}).click();
   const prior=await popup.locator('.ns-popout-frame').boundingBox();
   const edge=await popup.locator('[data-edge=e]').boundingBox();
   await popup.mouse.move(edge.x+4,edge.y+20);await popup.mouse.down();await popup.mouse.move(edge.x-96,edge.y+20);await popup.mouse.up();
   const resized=await popup.locator('.ns-popout-frame').boundingBox();
   assert.ok(resized.width<prior.width-90);assert.equal(resized.height,prior.height);
   for(const width of [600,1920]){
     await popup.setViewportSize({width,height:900});
     const box=await popup.locator('.ns-module-window:visible').boundingBox();
     assert.ok(box.x>=0 && box.x<20 && box.y>=0 && box.y>=40 && box.y<60 && box.x+box.width<=width+1,JSON.stringify({width,box}));
   }
   await popup.screenshot({path:path.join(root,'outputs/Dashboard UI/Detached Windows/preview.png')});
   await page.close();
   await popup.reload();await popup.waitForSelector('body.ns-module-popout .ns-module-window:visible');
   assert.equal(await popup.locator('.ns-module-window:visible').count(),1,'Window works after main window closes');
   await popup.getByRole('button',{name:'Close',exact:true}).click();
   assert.equal(popup.isClosed(),true);
   console.log('Detached module browser checks passed: popup, toolbar, minimize/restore, maximize/restore, edge resize, isolation, resize, opener independence.');
 }finally{await browser.close();server.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
