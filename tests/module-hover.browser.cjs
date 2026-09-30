/* Real DOM layout + read-only API fixtures. Never talks to the running backend. */
const {chromium}=require('playwright');
const http=require('node:http'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),out=path.join(root,'outputs','module-hover');
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
 page.on('pageerror',e=>errors.push(e.stack));
 const now=new Date().toISOString();
 const fixture={
  '/api/auth/session':{required:false},'/api/checkins':[
    {id:'crew-island',name:'Alex M.',site:'Island Falls',kind:'Northstar',company:'',status:'on-site',overdue:false,needsHelp:false,helpState:'none',checkedIn:now,lastHeard:now},
    {id:'crew-iroquois',name:'Sam R.',site:'Iroquois Falls',kind:'Contractor',company:'Field Services',status:'overdue',overdue:true,needsHelp:false,helpState:'none',checkedIn:now,lastHeard:now}
  ], '/api/checkins/history':[], '/api/alerts':[],
  '/api/weather':{stations:['Iroquois Falls','Atikokan','Kapuskasing','Oshawa','Toronto','Fort Frances','Dokis FN','Kenora'].map(name=>({name,current:{temperature_2m:18,weather_code:2,precipitation_probability:20},hourly:{time:Array.from({length:48},(_,i)=>new Date(Date.now()+i*3600000).toISOString()),temperature_2m:Array(48).fill(18),apparent_temperature:Array(48).fill(19),weather_code:Array(48).fill(2),precipitation_probability:Array(48).fill(20)}}))},
  '/api/dispatch/apiroq':{outputMw:24.5,dispatchMw:25,deltaMw:-0.5,healthy:true,simulated:true,updatedAt:now,history:[],orActivation:'10S',orActivationMw:8,reserveStandby:{tenS:8,tenN:2,thirtyR:0}},
  '/api/market-prices':{updated:now,nodes:{APIROQ:{rt:42,da:37,history:[{time:now,value:35},{time:new Date(Date.now()+60000).toISOString(),value:42}],operations:{rtTransfer:12,dayAhead:10}},IESO:{rt:40,da:36,history:[],operations:{rtTransfer:15000,dayAhead:15500}},M1S:{rt:30,da:31,history:[],operations:{}},F2B:{rt:20,da:20.2,history:[],operations:{}},'K2M CCTS':{rt:63,da:60,history:[],operations:{}}},ontario:{demand:15000,forecastDemand:15500}},
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


  await page.waitForFunction(()=>window.NorthstarModules?.registry.size>0 && document.querySelector('#weatherStrip .weather-card[data-ns-preview-bound]'));
  await page.waitForTimeout(300);
  assert.equal(await page.locator('[data-canvas-module]:visible').evaluateAll(els=>els.filter(e=>!e.dataset.nsPreviewBound&&!e.classList.contains('gs-card')).length),0,'Every Overview module supports previews');
  const reset=async()=>{await page.mouse.move(1,1);await page.keyboard.press('Escape');await page.locator('#sideNav [data-tab="overview"]').click();await page.waitForTimeout(300);};
  async function hoverCheck(selector,popup){
    await page.mouse.move(1,1);await page.keyboard.press('Escape');await page.waitForTimeout(300);
    const tile=page.locator(selector).first();await tile.hover();
    await page.waitForTimeout(450);assert.equal(await page.locator(popup).isVisible(),false,selector+' must wait 0.75s');
    await page.waitForTimeout(400);assert.equal(await page.locator(popup).isVisible(),true,selector+' opens after 0.75s');
  }
  for(const [selector,popup] of [
    ['#nsStatusBar [data-status=events]','#nsStatusEvents'],
    ['#nsStatusBar [data-status=markets]','#nsMarketPreview'],
    ['#nsStatusBar [data-status=dispatch]','#nsModulePreview'],
    ['#nsStatusBar [data-crew-site]','#nsCrewHover'],
    ['#weatherStrip .weather-card','#nsModulePreview'],
    ['#overviewChatSummary','#nsModulePreview'],
    ['.gs-card','#generatingStationDetails']
  ]){await hoverCheck(selector,popup);}
  await page.screenshot({path:path.join(out,'station-preview.png')});
  await page.locator('.gs-card').first().click();
  await page.waitForSelector('#generatingStationFull:visible');
  assert.equal(await page.locator('#generatingStationFull .gs-history').isVisible(),true);
  assert.equal(await page.locator('#generatingStationDetails').isVisible(),false);
  await reset();
  await page.locator('#nsStatusBar [data-status=dispatch]').click();
  assert.equal(await page.locator('#dispatchDetail').isVisible(),true);
  await reset();
  await page.locator('#nsStatusBar [data-status=events] .ns-status-content').click({position:{x:5,y:5}});
  assert.equal(await page.locator('#eventRegister').isVisible(),true);
  await reset();
  await page.locator('#weatherStrip .weather-card').first().click();
  assert.equal(await page.locator('#weatherGridFull').isVisible(),true);
  await reset();
  await page.locator('#overviewChatSummary').click();
  assert.equal(await page.locator('#overviewChat').isVisible(),true);
  await reset();
  await page.locator('#nsStatusBar [data-node="APIROQ"]').click();
  assert.equal(await page.locator('#nsMarket-APIROQ').isVisible(),true,'Market node opens its own detail module');
  await reset();
  await hoverCheck('#overviewChatSummary','#nsModulePreview');
  assert.equal(await page.locator('#nsModulePreview [id],#nsModulePreview form,#nsModulePreview input,#nsModulePreview textarea').count(),0,'Read-only preview does not duplicate live controls or IDs');
  await page.locator('#nsModulePreview h3').click();
  await page.mouse.move(1,1);await page.waitForTimeout(300);
  assert.equal(await page.locator('#nsModulePreview.ns-hover-window-pinned').isVisible(),true,'Clicked preview stays open');
  await page.locator('#nsModulePreview .ns-hover-window-bar button').click();
  assert.equal(await page.locator('#nsModulePreview').isVisible(),false,'Pinned preview closes');
  await page.screenshot({path:path.join(out,'overview.png'),fullPage:true});
  const tile=page.locator('#weatherStrip .weather-card').first();
  await tile.hover();await page.waitForTimeout(200);await page.mouse.move(1,1);await page.waitForTimeout(800);
  assert.equal(await page.locator('#nsModulePreview').isVisible(),false,'Leaving cancels preview');
  await page.locator('.layout-edit-toggle').click();await tile.hover();await page.waitForTimeout(850);
  assert.equal(await page.locator('#nsModulePreview').isVisible(),false,'No preview during layout editing');
  await tile.focus();await page.keyboard.press('Enter');
  assert.equal(await page.locator('#nsModuleEditor').isVisible(),true,'Editing preserved');
  await page.locator('#nsModuleEditor [data-editor-close]').first().click();
  await page.locator('.layout-edit-toggle').click();
  assert.equal(await page.locator('.dogear:visible,.market-dogear:visible,.ns-status-dogear:visible,.ns-open-module:visible,.builder-dogear:visible').count(),0,'No dog-ears remain');
  assert.equal(errors.length,0,errors.join('\n'));
  await page.screenshot({path:path.join(out,'overview.png'),fullPage:true});
  console.log('PASS: hover delay, cancellation, full module navigation, editing, dog-ear removal, no browser errors');
 }finally{await browser.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1;});
