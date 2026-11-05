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
 const now=Date.now(), points=(base,start,count)=>Array.from({length:count},(_,i)=>({time:new Date(now+(start+i)*3600000).toISOString(),value:base+i*1.5+(i%3)*2}));
 const market={updated:new Date(now).toISOString(),nodes:Object.fromEntries(['IESO','APIROQ'].map((key,i)=>[key,{rt:42+i*9,da:37+i*8,history:points(30+i*9,-8,9),daHistory:points(28+i*8,-8,9),forward:points(37+i*8,0,13),rtForecast:points(40+i*8,1,4),operations:{rtTransfer:12,dayAhead:10}}])),ontario:{demand:15000,forecastDemand:15500}};
 const workers=Array.from({length:8},(_,i)=>({id:'fixture-'+i,name:'Demo Worker '+(i+1),site:'Kenora',status:'active',lastHeard:new Date(now).toISOString(),kind:'Employee',overdue:i===0,needsHelp:false}));
 const events=Array.from({length:7},(_,i)=>({eventId:'fixture-event-'+i,occurredAt:new Date(now-i*60000).toISOString(),summary:'Demo event '+(i+1),eventType:'operator.note',category:'operator',site:'Kenora',severity:i===0?'critical':i===1?'warning':'info',status:'open'}));
 let logWrites=[];
 await page.route('**/api/**',route=>{
   const pathname=new URL(route.request().url()).pathname;
   const fixtures={'/api/auth/session':{required:false},'/api/weather':{stations:['Kenora','Fort Frances','Iroquois Falls'].map(name=>({name,current:{temperature_2m:14,weather_code:1},hourly:{time:[],temperature_2m:[]}}))},'/api/market-prices':market,'/api/checkins':workers,'/api/events/register':{items:events,nextCursor:null},'/api/dispatch/apiroq':{dispatchMw:67.3,outputMw:68.2,healthy:true,reserveStandby:{tenN:0,tenS:0,thirtyR:0}},'/api/logbook':[]};
   if(pathname==='/api/logbook' && route.request().method()==='POST')logWrites.push(route.request().postDataJSON());
   return route.fulfill({status:pathname in fixtures?200:503,contentType:'application/json',body:JSON.stringify(fixtures[pathname] || {})});
 });
 try{
   await page.goto(`http://127.0.0.1:${server.address().port}/northstar-clean.html?nsDevelopment=overview#overview`);
   await page.waitForFunction(()=>window.NorthstarModules?.registry.size>10 && document.querySelector('#demoMarketChart canvas'));
   const box=await page.locator('#nsStatusBar').boundingBox();assert.ok(box.height<=88);
   for(const id of ['overviewFieldTracker','overviewGeneratingStations','eventsCard','demoWeather','demoMarket','demoRecentEvents'])assert.equal(await page.locator('#'+id).isVisible(),true,id+' visible');
   await page.waitForFunction(()=>document.querySelectorAll('#nsStatusBar .ns-status-alarm').length===3 && document.querySelectorAll('#overviewTrackerWorkers article').length===8);
   assert.equal(await page.locator('#demoLocalWeather').isVisible(),true);
   assert.equal(await page.locator('#nsStatusBar .ns-status-alarm').count(),3,'at most three fixed events');
   assert.equal(await page.locator('#demoMarketChart [data-market-node="APIROQ"]').isVisible(),true);
   assert.equal(await page.locator('#demoMarketChart [data-market-node="IESO"]').getAttribute('class'),'active');
   assert.match(await page.locator('#demoMarketChart .demo-market-legend').innerText(),/RT IESO.*DA IESO.*NOW.*UPCOMING DA.*RT FORECAST/);
   assert.equal(await page.locator('#demoMarketChart .demo-market-trend-host canvas').isVisible(),true);
   const chartWindow=page.locator('#demoMarketChart [data-setting="symmetricWindowHours"]');
   assert.equal(await chartWindow.inputValue(),'4','Overview defaults to an eight-hour window centered on now');
   await chartWindow.selectOption('6');assert.equal(await chartWindow.inputValue(),'6','Overview market time window remains adjustable');
   const chartBox=await page.locator('#demoMarket').boundingBox(),newsBox=await page.locator('#demoRecentEvents').boundingBox();assert.ok(newsBox.y>=chartBox.y+chartBox.height,'right column panels do not overlap');
   await page.fill('#quickLogDetails','Fixture-only operator note');
   await page.locator('#quickLogForm button[type="submit"]').click();
   await page.waitForFunction(()=>document.querySelector('#quickLogStatus').textContent.includes('SAVED'));
   assert.equal(logWrites.length,1);assert.equal(logWrites[0].details,'Fixture-only operator note');

   await page.setViewportSize({width:1000,height:800});
   assert.ok((await page.locator('#demoMarket').boundingBox()).y>=(await page.locator('#overviewFieldTracker').boundingBox()).y);
   await page.setViewportSize({width:600,height:800});
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'no page-wide horizontal overflow on mobile');
   await page.setViewportSize({width:1500,height:980});
   await page.click('[data-demo-field-status]');
   await page.waitForFunction(()=>location.hash==='#mobile');
   assert.equal(await page.locator('#mobileWorkers').isVisible(),true,'full field status opens');
   await page.click('#sideNav [data-tab="overview"]');
   await page.waitForFunction(()=>document.documentElement.dataset.nsDevelopment==='main' && window.NorthstarModules?.registry.size>10);
   assert.equal(await page.locator('#demoMarket').count(),0,'main Overview restores legacy composition');
   const legacy=await page.locator('#nsStatusBar').boundingBox();assert.ok(box.height<=legacy.height/2,`new ${box.height}, old ${legacy.height}`);
   console.log('height',box.height,legacy.height);
   console.log('Browser errors:',errors);assert.equal(errors.length,0);
 }finally{await browser.close();server.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
