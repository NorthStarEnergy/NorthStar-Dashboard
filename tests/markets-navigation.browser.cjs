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
 const marketAlarmRules={
  generation_price:{metric:'generation_price',label:'Generation market price',kind:'price',low:null,high:null,level:'warning',enabled:false,updatedAt:'2026-09-15T06:00:00Z',lastTriggeredAt:null},
  reserve_10s:{metric:'reserve_10s',label:'APIROQ 10S price',kind:'price',low:null,high:null,level:'warning',enabled:false,updatedAt:'2026-09-15T06:00:00Z',lastTriggeredAt:null},
  reserve_10n:{metric:'reserve_10n',label:'APIROQ 10N price',kind:'price',low:null,high:null,level:'warning',enabled:false,updatedAt:'2026-09-15T06:00:00Z',lastTriggeredAt:null},
  reserve_30r:{metric:'reserve_30r',label:'APIROQ 30R price',kind:'price',low:null,high:null,level:'warning',enabled:false,updatedAt:'2026-09-15T06:00:00Z',lastTriggeredAt:null},
  demand_gap:{metric:'demand_gap',label:'Market demand gap',kind:'gap',primaryThreshold:1000,secondaryThreshold:2000,level:'warning',enabled:true,updatedAt:'2026-09-15T06:00:00Z',lastTriggeredAt:null},
  price_gap:{metric:'price_gap',label:'RT / DA price gap',kind:'gap',primaryThreshold:20,secondaryThreshold:40,level:'warning',enabled:true,updatedAt:'2026-09-15T06:00:00Z',lastTriggeredAt:null}
 };
 await page.addInitScript(()=>{
   if(!localStorage.northstarModuleWorkspaceV1)localStorage.northstarModuleWorkspaceV1=JSON.stringify({sections:{markets:{tabs:['markets:APIROQ'],active:'markets:APIROQ',landing:'markets:APIROQ'},scada:{tabs:['scada:scada-module-0'],active:'scada:scada-module-0',landing:'scada:scada-module-0',boxes:{'scada:scada-module-0':{x:20,y:60,w:500,h:400}}}},modules:{'scada:scada-module-0':{full:{notes:'Saved SCADA notes'},compact:{}}}});
 });
 page.on('pageerror',error=>errors.push(error.message));
 await page.route('**/api/**',route=>{
   const pathname=new URL(route.request().url()).pathname;
   if(pathname==='/api/market-alarm-rules') {
     if(route.request().method()==='POST'){const body=route.request().postDataJSON();marketAlarmRules[body.metric]={...marketAlarmRules[body.metric],...body,low:body.low===''?null:Number(body.low),high:body.high===''?null:Number(body.high),updatedAt:new Date().toISOString()};return route.fulfill({status:201,contentType:'application/json',body:JSON.stringify(marketAlarmRules[body.metric])});}
     return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(marketAlarmRules)});
   }
   if(pathname==='/api/market-history') {
     const day=new URL(route.request().url()).searchParams.get('date');
     const missing=day==='2026-07-03';
     return route.fulfill({status:missing?502:200,contentType:'application/json',body:JSON.stringify(missing?{error:'No archived readings'}:{historical:true,reportDate:day,nodes:{APIROQ:{history:[{time:day+'T00:00:00-05:00',value:12}],daHistory:[],forward:[]},IESO:{history:[{time:day+'T00:00:00-05:00',value:12}],daHistory:[],forward:[]}},sources:['https://reports-public.ieso.ca/fixture'],missing:[],partial:false})});
   }
   const data=pathname==='/api/auth/session'?{required:false}:pathname==='/api/weather'?{stations:[]}:pathname==='/api/market-prices'?{updated:'2026-09-15T06:00:00Z',nodes:{APIROQ:{rt:42,da:37,history:[{time:'2026-09-15T04:00:00Z',value:40},{time:'2026-09-15T05:00:00Z',value:41}],daHistory:[{time:'2026-09-15T05:00:00Z',value:36}],forward:[{time:'2026-09-15T06:00:00Z',value:37},{time:'2026-09-15T07:00:00Z',value:38}],operations:{rtTransfer:12,dayAhead:10}},M1S:{rt:52,da:47,history:[{time:'2026-09-15T04:00:00Z',value:50},{time:'2026-09-15T05:00:00Z',value:52}],daHistory:[{time:'2026-09-15T05:00:00Z',value:46}],forward:[{time:'2026-09-15T06:00:00Z',value:47},{time:'2026-09-15T07:00:00Z',value:48}]}},ontario:{demand:15000,forecastDemand:15500}}:{};
   return route.fulfill({status:['/api/auth/session','/api/weather','/api/market-prices'].includes(pathname)?200:503,contentType:'application/json',body:JSON.stringify(data)});
 });
 try {
   await page.goto(`http://127.0.0.1:${server.address().port}/northstar-clean.html#markets`);
   await page.waitForFunction(()=>window.NorthstarModules?.state.sections.markets?.active==='markets:live');
   assert.deepEqual(await page.locator('.ns-module-tree [data-open-module]').evaluateAll(es=>es.map(e=>e.dataset.openModule)),['markets:live','markets:alarms','markets:historical']);
   assert.equal(await page.locator('#marketLive').isVisible(),true);
   assert.equal(await page.locator('#marketDetail > .market-head').count(),0);
   assert.equal(await page.locator('#marketDetail .market-home-summary').count(),0);
   assert.equal(await page.locator('#dispatchDetail').isVisible(),true);
   assert.equal(await page.locator('#marketDetail .market-trend-host').count(),0);
   assert.equal(await page.locator('#marketDetail .market-home-trend-host .market-price-chart').isVisible(),true);
   assert.match(await page.locator('#marketDetail .market-home-trend-host .mt-legend').innerText(),/IESO · Real-time price/);
   assert.match(await page.locator('#marketDetail .market-home-trend-host .mt-legend').innerText(),/IESO · DA price history/);
   assert.match(await page.locator('#marketDetail .market-home-trend-host .mt-legend').innerText(),/IESO · DA price forward/);
   assert.equal(await page.locator('#marketDetail .market-home-trend-host .mt-legend span').nth(0).locator('i').evaluate(el=>getComputedStyle(el).getPropertyValue('--series-color').trim()),'#f2b84b');
   assert.equal(await page.locator('#marketDetail .market-home-trend-host .mt-legend span').nth(1).locator('i').evaluate(el=>getComputedStyle(el).getPropertyValue('--series-color').trim()),'#287fbd');
   assert.equal(await page.locator('#marketDetail .market-home-trend-host .mt-legend span').nth(2).locator('i').evaluate(el=>getComputedStyle(el).getPropertyValue('--series-color').trim()),'#79caff');
   assert.doesNotMatch(await page.locator('#marketDetail .market-home-trend-host').innerText(),/Predicted RT|market trend · unavailable/i);
   assert.equal(await page.locator('#marketDetail .market-home-trend-host [data-kind="rt"]').isChecked(),true);
   assert.equal(await page.locator('#marketDetail .market-home-trend-host [data-kind="da"]').isChecked(),true);
   assert.equal(await page.locator('#marketDetail .market-home-trend-host [data-kind="forward"]').isChecked(),true);
   assert.equal(await page.locator('#marketDetail .market-home-trend-host [data-setting="range"]').inputValue(),'all');
   assert.ok(await page.locator('#marketDetail .market-home-trend-host [data-setting="range"] option').evaluateAll(options=>options.some(option=>option.value==='72')&&options.some(option=>option.value==='168')));
   assert.equal(await page.locator('#marketDetail .market-home-trend-host [data-setting="timeScale"]').inputValue(),'hour');
   assert.equal(await page.locator('#marketDetail .market-home-trend-host [data-setting="periodLength"]').inputValue(),'24');
   assert.equal(await page.locator('#marketDetail .market-home-trend-host .mt-kinds').isVisible(),true);
   assert.equal(await page.locator('#marketDetail .market-home-trend-host [data-setting="scale"]').inputValue(),'auto');
   await page.screenshot({path:path.join(root,'outputs/markets-live-historical/market-home.png'),fullPage:true});
   await page.setViewportSize({width:390,height:844});
   assert.equal(await page.locator('#marketDetail .market-home-summary').evaluate(el=>getComputedStyle(el).gridTemplateColumns.split(' ').length),2);
   assert.ok(await page.locator('#marketDetail .market-home-trend-host .market-price-chart').evaluate(el=>el.getBoundingClientRect().width<=390));
   assert.equal(await page.locator('#marketLive').evaluate(el=>getComputedStyle(el).overflowY),'auto');
   await page.locator('#marketDetail .market-home-trend-host .market-price-chart').scrollIntoViewIfNeeded();
   assert.equal(await page.locator('#marketDetail .market-home-trend-host .market-price-chart').isVisible(),true);
   await page.screenshot({path:path.join(root,'outputs/markets-live-historical/market-home-mobile.png'),fullPage:true});
   await page.setViewportSize({width:1500,height:980});
   await page.click('[data-open-module="markets:alarms"]');
   await page.waitForSelector('#marketAlarms .market-alarm-rule:visible');
   assert.equal(await page.locator('#marketAlarms .market-alarm-rule').count(),6);
   assert.equal(await page.locator('#marketAlarms [name="level"]').first().locator('option').count(),4);
   assert.equal(await page.locator('#marketAlarms [data-market-alarm-rule="demand_gap"] [name="primaryThreshold"]').inputValue(),'1000');
   assert.equal(await page.locator('#marketAlarms [data-market-alarm-rule="price_gap"] [name="primaryThreshold"]').inputValue(),'20');
   await page.locator('#marketAlarms [data-market-alarm-rule="reserve_10s"] [name="high"]').fill('25');
   await page.locator('#marketAlarms [data-market-alarm-rule="reserve_10s"] [name="level"]').selectOption('critical');
   await page.locator('#marketAlarms [data-market-alarm-rule="reserve_10s"] [name="enabled"]').check();
   await page.locator('#marketAlarms [data-market-alarm-rule="reserve_10s"] button[type="submit"]').click();
   await page.waitForFunction(()=>document.querySelector('[data-market-alarm-rule="reserve_10s"] [name="high"]').value==='25');
   assert.equal(marketAlarmRules.reserve_10s.level,'critical');
   await page.evaluate(()=>{scrollTo(0,0);document.querySelector('#marketAlarms').scrollTop=0;});
   await page.screenshot({path:path.join(root,'outputs/markets-live-historical/market-alarms.png'),fullPage:true});
   await page.click('[data-open-module="markets:live"]');
   await page.selectOption('[data-live-node]','APIROQ');
   assert.match(await page.locator('#marketDetail h2').innerText(),/APIROQ/);
   await page.click('[data-open-module="markets:historical"]');
   await page.waitForSelector('#overviewMarket .market-trends:visible');
   assert.equal(await page.locator('#marketLive').isVisible(),false);
   await page.click('#nodeButtons [data-node="IESO"]');
   assert.equal(await page.evaluate(()=>NorthstarModules.state.sections.markets.active),'markets:historical');
   await page.click('[data-scenario-run]');
   assert.match(await page.locator('#overviewMarket .mt-legend').innerText(),/SIMULATED 10%/);
   await page.getByRole('button',{name:'Show tools and filters for Historical'}).click();
   const [csv] = await Promise.all([page.waitForEvent('download'),page.click('#overviewMarket [data-action="export"]')]);
   const content=fs.readFileSync(await csv.path(),'utf8');
   assert.match(content,/SIMULATED 10%/);
   await page.click('[data-scenario-reset]');
   assert.doesNotMatch(await page.locator('#overviewMarket .mt-legend').innerText(),/SIMULATED/);
   await page.fill('[data-history-from]','2026-07-01');
   await page.fill('[data-history-to]','2026-07-02');
   await page.click('[data-history-load]');
   await page.waitForFunction(()=>document.querySelector('[data-history-status]').textContent.includes('Loaded 2 of 2'));
   await page.click('#overviewMarket [data-action="refresh"]');
   assert.match(await page.locator('#overviewMarket .mt-status').innerText(),/Archived IESO/);
   assert.match(await page.locator('#overviewMarket .mt-stats').innerText(),/12.00/);
   const [archiveCsv]=await Promise.all([page.waitForEvent('download'),page.click('#overviewMarket [data-action="export"]')]);
   assert.match(fs.readFileSync(await archiveCsv.path(),'utf8'),/2026-07-01T05:00:00/);
   await page.fill('[data-history-from]','2026-07-03');await page.fill('[data-history-to]','2026-07-03');
   await page.click('[data-history-load]');
   await page.waitForFunction(()=>document.querySelector('[data-history-status]').textContent.includes('Previous chart retained'));
   assert.match(await page.locator('#overviewMarket .mt-stats').innerText(),/12.00/);
   await page.click('[data-history-clear]');
   assert.doesNotMatch(await page.locator('#overviewMarket .mt-status').innerText(),/Archived IESO/);
   await page.evaluate(()=>NorthstarModules.open('markets:APIROQ'));
   assert.equal(await page.locator('[data-live-node]').inputValue(),'APIROQ');
   assert.equal(await page.locator('#marketLive').isVisible(),true);
   await page.screenshot({path:path.join(root,'outputs/markets-live-historical/live.png')});
   await page.click('[data-open-module="markets:historical"]');
   await page.screenshot({path:path.join(root,'outputs/markets-live-historical/historical.png')});
   await page.reload();
   await page.waitForFunction(()=>window.NorthstarModules?.state.sections.markets?.active==='markets:live');
   assert.deepEqual(await page.locator('.ns-module-tree [data-open-module]').evaluateAll(es=>es.map(e=>e.dataset.openModule)),['markets:live','markets:alarms','markets:historical']);
   assert.equal(errors.length,0,errors.join('\n'));
   console.log('PASS Markets live, alarms, historical navigation, alarm settings, archived range pull, CSV export, simulation and reload');
 } finally { await browser.close(); await new Promise(resolve=>server.close(resolve)); }
})().catch(error=>{console.error(error);process.exitCode=1;});
