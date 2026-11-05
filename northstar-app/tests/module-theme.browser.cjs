/* Real DOM layout + read-only API fixtures. Never talks to the running backend. */
const {chromium}=require('playwright');
const http=require('node:http'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),out=path.join(root,'outputs','module-theme-fix');
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
 page.setDefaultTimeout(8000);
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

  await page.waitForFunction(()=>window.NorthstarModules?.registry.size>0);
  await page.locator('.layout-edit-toggle').first().click();
  if(await page.getByRole('button',{name:'Collapse designer',exact:true}).isVisible())await page.getByRole('button',{name:'Collapse designer',exact:true}).click();
  const card=page.locator('#overviewChatSummary');
  const other=page.locator('#weatherStrip > .weather-card').first();
  const originalOther=await other.evaluate(el=>getComputedStyle(el).backgroundColor);
  async function choose(root,theme){
    await root.locator(':scope > .ns-module-theme > .ns-module-theme-toggle').click();
    const menu=root.locator(':scope > .ns-module-theme > .ns-module-theme-menu');
    assert.equal(await menu.evaluate(el=>el.matches(':popover-open')),true);
    const option=menu.locator('[data-module-theme="'+theme+'"]');
    const box=await option.boundingBox();
    if(box){assert.ok(box.x>=0 && box.x+box.width<=1440,'Menu fits viewport');}
    await option.click();
  }
  await choose(card,'signal');
  assert.equal(await card.evaluate(el=>getComputedStyle(el).backgroundColor),'rgb(42, 27, 19)');
  assert.equal(await other.evaluate(el=>getComputedStyle(el).backgroundColor),originalOther,'Other module unchanged');
  const weather=page.locator('#weatherStrip > .weather-card').first();
  await page.evaluate(()=>{window.scrollTo(0,0);document.querySelector('main').scrollTop=0;});
  await choose(weather,'forest');
  assert.equal(await weather.evaluate(el=>getComputedStyle(el).getPropertyValue('--panel').trim()),'#112a20');
  // A refresh between pointerdown and pointerup must not discard the selected option.
  await card.locator(':scope > .ns-module-theme > button').click();
  const option=card.locator('[data-module-theme="arctic"]');
  await option.hover();await page.mouse.down();
  await page.evaluate(()=>NorthstarModules.refresh());await page.waitForTimeout(300);
  await page.mouse.up();
  assert.equal(await card.getAttribute('data-ns-theme'),'arctic');
  await page.reload();await page.waitForFunction(()=>window.NorthstarModules?.registry.size>0);
  assert.equal(await card.getAttribute('data-ns-theme'),'arctic','Theme persists after reload');
  if(!await page.locator('body').evaluate(el=>el.classList.contains('layout-edit')))await page.locator('.layout-edit-toggle').first().click();
  if(await page.getByRole('button',{name:'Collapse designer',exact:true}).isVisible())await page.getByRole('button',{name:'Collapse designer',exact:true}).click();
  await page.evaluate(()=>document.body.dataset.theme='signal');
  await choose(card,'default');
  assert.equal(await card.evaluate(el=>getComputedStyle(el).backgroundColor),'rgb(18, 29, 37)','Default overrides global theme');
  const id=await card.getAttribute('data-ns-compact');
  await page.evaluate(id=>NorthstarModules.open(id),id);
  const full=page.locator('.ns-module-window').filter({has:page.locator(':scope > .ns-module-theme')}).first();
  await choose(full,'violet');
  assert.equal(await full.evaluate(el=>getComputedStyle(el).backgroundColor),'rgb(33, 28, 52)');
  await page.screenshot({path:path.join(out,'theme-picker-check.png')});
  console.log('PASS: compact/full colors, weather menu, independent themes, refresh during click, persistence, default reset');
 }finally{await browser.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1;});

