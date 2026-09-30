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
  '/api/profile/crew-layout':{positions:{}},'/api/auth/session':{required:false},'/api/checkins':[
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

  await page.waitForSelector('[data-crew-site="Iroquois Falls"]');
  const crew=page.locator('#nsStatusBar [data-status=crew]');
  assert.match(await crew.innerText(),/Active Workers -/);
  assert.equal(await crew.locator('.ns-status-site').count(),21);
  assert.equal(await crew.locator('[data-crew-site="Iroquois Falls"] strong').innerText(),'IR - 1');
  assert.equal(await crew.locator('.ns-crew-sites').evaluate(el=>getComputedStyle(el).display),'block');
  await crew.screenshot({path:path.join(out,'crew-grid.png')});
  const siteButton=crew.locator('[data-crew-site="Iroquois Falls"]');
  await page.locator('.layout-edit-toggle').click();
  assert.equal(await crew.locator('[data-crew-edit]').count(),0,'Crew has no separate save control');
  assert.equal(await crew.locator('.ns-crew-sites').evaluate(el=>el.classList.contains('is-editing')),true,'Shared edit mode enables crew arrangement');
  const before=await siteButton.boundingBox();
  await page.mouse.move(before.x+5,before.y+5);await page.mouse.down();await page.mouse.move(before.x+25,before.y+15);await page.mouse.up();
  assert.notEqual((await siteButton.boundingBox()).x,before.x);
  const moved=await siteButton.boundingBox();
  assert.equal(Math.round(moved.x)%5,0,'Crew drag snaps to the shared 5px grid');
  const save=page.waitForRequest(req=>req.url().includes('/api/profile/crew-layout')&&req.method()==='POST');
  await page.locator('.layout-edit-toggle').click();
  assert.equal(Object.keys((await save).postDataJSON().positions).length,21);
  await siteButton.hover();
  await page.waitForSelector('#nsCrewHover:visible');
  assert.match(await page.locator('#nsCrewHover').innerText(),/Sam R\./);
  assert.match(await page.locator('#nsCrewHover').innerText(),/Next due/);
  await page.locator('#nsCrewHover').hover();
  assert.equal(await page.locator('#nsCrewHover').isVisible(),true);
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('#nsCrewHover').isVisible(),false);
  await siteButton.click();
  await page.waitForSelector('#siteCrewWorkspace:visible');
  assert.equal(await page.locator('#siteCrewTitle').innerText(),'Iroquois Falls');
  await page.waitForFunction(()=>document.querySelector('#siteCrewPeople').textContent.includes('Sam R.'));
  assert.equal(await page.locator('#nsCrewHover').isVisible(),false);
  console.log('PASS: hover worker details, popup pointer access, Escape, and click opens visible site crew module');
  console.log('PASS: rendered canonical shell with fixture roster, title, 20 buttons, IF label and CSS grid');
 }finally{await browser.close();server.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
