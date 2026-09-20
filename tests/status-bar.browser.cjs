/* Real DOM layout + read-only API fixtures. Never talks to the running backend. */
const {chromium}=require('playwright');
const http=require('node:http'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),out=path.join(root,'outputs','persistent-status-bar');
(async()=>{
 const server=http.createServer((req,res)=>{
  const file=path.resolve(root,'.'+new URL(req.url,'http://localhost').pathname);
  if(!file.startsWith(root+path.sep)||!['.html','.js','.css','.svg','.png','.ico'].includes(path.extname(file))){res.writeHead(404);return res.end();}
  fs.readFile(file,(err,data)=>{res.writeHead(err?404:200,{'Content-Type':{'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml'}[path.extname(file)]||'application/octet-stream'});res.end(err?'':data);});
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const browser=await chromium.launch({channel:'msedge',headless:true}).catch(()=>chromium.launch({headless:true}));
 const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];
 await page.addInitScript(()=>{if(!localStorage.northstarCanvasLayoutV1){localStorage.northstarCanvasLayoutV1=JSON.stringify({'canvas:dispatch:dispatchClient':{x:640,y:430,w:330,h:210}});localStorage.northstarOverviewProfilesV2=JSON.stringify({desktop:{positions:{'canvas:dispatch:dispatchClient':{x:640,y:430,w:330,h:210}},width:1196,automatic:false}});}});
 page.on('pageerror',e=>errors.push(e.message));
 const now=new Date().toISOString();
 const fixture={
  '/api/auth/session':{required:false},'/api/checkins':[], '/api/alerts':[],
  '/api/weather':{stations:['Iroquois Falls','Atikokan','Kapuskasing','Oshawa','Toronto','Fort Frances','Dokis FN','Kenora'].map(name=>({name,current:{temperature_2m:18,weather_code:2,precipitation_probability:20},hourly:{time:Array.from({length:48},(_,i)=>new Date(Date.now()+i*3600000).toISOString()),temperature_2m:Array(48).fill(18),apparent_temperature:Array(48).fill(19),weather_code:Array(48).fill(2),precipitation_probability:Array(48).fill(20)}}))},
  '/api/dispatch/apiroq':{outputMw:24.5,dispatchMw:25,deltaMw:-0.5,healthy:true,simulated:true,updatedAt:now,history:[],reserveStandby:{tenS:1,tenN:2,thirtyR:3}},
  '/api/market-prices':{updated:now,nodes:{APIROQ:{rt:42,da:37,history:[{time:now,value:35},{time:new Date(Date.now()+60000).toISOString(),value:42}],operations:{rtTransfer:12,dayAhead:10}},IESO:{rt:40,da:36,history:[],operations:{rtTransfer:15000,dayAhead:15500}}},ontario:{demand:15000,forecastDemand:15500}},
  '/api/scada':{feeds:[],readings:[]},'/api/chat/messages':{messages:[{id:'fixture-1',body:'Test message for layout verification.',senderName:'Fixture operator',createdAt:now}]},
  '/api/events/register':{items:[
    {eventId:'fixture-crit',occurredAt:now,summary:'Critical breaker trip',site:'Iroquois Falls',severity:'critical',source:'SCADA',category:'alarm',status:'active'},
    {eventId:'fixture-warn',occurredAt:now,summary:'Pond level rising',site:'Atikokan',severity:'warning',source:'Hydrometric',category:'alarm',status:'open'},
    {eventId:'fixture-info',occurredAt:now,summary:'Operator note filed',site:'Toronto',severity:'info',source:'logbook',category:'log',status:''},
    {eventId:'fixture-cleared',occurredAt:now,summary:'Price alert cleared',site:'APIROQ',severity:'warning',source:'market',category:'alarm',status:'cleared'}
  ],nextCursor:null,total:4},
 };
 await page.route('**/api/**',route=>{const key=new URL(route.request().url()).pathname;return route.fulfill({status:fixture[key]?200:503,contentType:'application/json',body:JSON.stringify(fixture[key]||{})});});
 fs.mkdirSync(out,{recursive:true});
 try{
  await page.goto(`http://127.0.0.1:${server.address().port}/northstar-clean.html`);
  await page.waitForSelector('#nsStatusBar');
  await page.waitForFunction(()=>NorthstarOverview.feeds.dispatch?.checked);

  const bar=page.locator('#nsStatusBar'),events=bar.locator('[data-status=events]');
  assert.equal(await bar.locator('.ns-status-module').count(),4);
  assert.equal(await page.locator('#overviewEventsSummary:visible,#dispatchClient:visible,#marketTopTiles:visible,#overviewFieldTracker:visible').count(),0);
  await page.waitForSelector('#nsStatusBar .ns-status-alarm');
  assert.ok((await events.boundingBox()).width>(await bar.locator('[data-status=dispatch]').boundingBox()).width,'Event log is wider than sibling tiles');
  assert.equal(await events.locator('[data-filter]').count(),5);
  assert.ok(await events.locator('.ns-status-alarm.is-unacked .ns-status-alarm-mark').count()>=1,'Unacknowledged alarms show ×');
  await events.locator('[data-filter=critical]').click();
  await page.waitForFunction(()=>[...document.querySelectorAll('#nsStatusBar .ns-status-alarm')].every(el=>el.classList.contains('ns-status-alarm-critical')||el.classList.contains('ns-status-alarms-empty')===false));
  assert.ok((await events.innerText()).includes('Critical breaker trip'));
  assert.equal(await events.locator('[data-filter=critical].is-active').count(),1);
  for(const section of ['weather','tools','switching','outages','overview']){
    await page.click(`#sideNav [data-tab="${section}"]`);await page.waitForTimeout(150);
    assert.equal(await bar.isVisible(),true);assert.equal((await bar.boundingBox()).y,0);
  }
  await page.screenshot({path:path.join(out,'event-alarm-listing.png'),fullPage:false});
  for(const [key,target] of [['events','#eventRegister'],['dispatch','#dispatchDetail'],['markets','#marketDetail'],['crew','#crew']]){
    await bar.locator(`[data-status=${key}] .ns-status-dogear`).click();await page.waitForTimeout(180);
    assert.equal(await page.locator(target).isVisible(),true,key+' expands its full module');assert.equal(await bar.isVisible(),true);
  }
  await page.evaluate(()=>window.scrollTo(0,1000));assert.equal((await bar.boundingBox()).y,0);
  const layouts=[];
  for(const width of [1920,1440,1371,900,760,390]){
    await page.setViewportSize({width,height:1000});await page.waitForTimeout(120);
    const rect=await bar.boundingBox();assert.ok(rect.x>=0&&rect.x+rect.width<=width+1);layouts.push({width,bar:rect});
  }
  await page.setViewportSize({width:1440,height:1000});await page.click('#sideNav [data-tab="weather"]');await page.waitForTimeout(200);
  for(const tile of await bar.locator('.ns-status-module').all())assert.ok((await tile.boundingBox()).y>=0,'Status tile remains visible after viewport changes');
  await page.screenshot({path:path.join(out,'weather-with-status-bar.png'),fullPage:false});
  assert.deepEqual(errors,[]);
  fs.writeFileSync(path.join(out,'validation.json'),JSON.stringify({fixture:true,layouts,alarmListing:true,filters:5,dogears:4,errors},null,2));
  console.log('Persistent bar: wide event alarm listing, filters, unacked marks, dogears and six viewports passed.');
 }finally{await browser.close();server.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
