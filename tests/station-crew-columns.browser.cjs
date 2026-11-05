/* Real DOM layout + read-only API fixtures. Never talks to the running backend. */
const {chromium}=require('playwright');
const http=require('node:http'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),out=path.join(root,'outputs','overview-workspace');
(async()=>{
 const server=http.createServer((req,res)=>{
  const file=path.resolve(root,'.'+new URL(req.url,'http://localhost').pathname);
  if(!file.startsWith(root+path.sep)||!['.html','.js','.css','.svg','.png','.ico'].includes(path.extname(file))){res.writeHead(404);return res.end();}
  fs.readFile(file,(err,data)=>{res.writeHead(err?404:200,{'Content-Type':{'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml'}[path.extname(file)]||'application/octet-stream'});res.end(err?'':data);});
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const browser=await chromium.launch({channel:'msedge',headless:true});
 const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];
 await page.addInitScript(()=>{if(!localStorage.northstarCanvasLayoutV1){localStorage.northstarCanvasLayoutV1=JSON.stringify({'canvas:dispatch:dispatchClient':{x:640,y:430,w:330,h:210}});localStorage.northstarOverviewProfilesV2=JSON.stringify({desktop:{positions:{'canvas:dispatch:dispatchClient':{x:640,y:430,w:330,h:210}},width:1196,automatic:false}});}});
 page.on('pageerror',e=>errors.push(e.message));
 const now=new Date().toISOString();
 const fixture={
  '/api/auth/session':{required:false},'/api/checkins':[], '/api/alerts':[],
  '/api/weather':{stations:['Iroquois Falls','Atikokan','Kapuskasing','Oshawa','Toronto','Fort Frances','Dokis FN','Kenora'].map(name=>({name,current:{temperature_2m:18,weather_code:2,precipitation_probability:20,wind_speed_10m:18,wind_direction_10m:292.5},hourly:{time:Array.from({length:48},(_,i)=>new Date(Date.now()+i*3600000).toISOString()),temperature_2m:Array(48).fill(18),apparent_temperature:Array(48).fill(19),weather_code:Array(48).fill(2),precipitation_probability:Array(48).fill(20),wind_speed_10m:Array(48).fill(18),wind_direction_10m:Array(48).fill(292.5)}}))},
  '/api/dispatch/apiroq':{outputMw:24.5,dispatchMw:25,deltaMw:-0.5,healthy:true,simulated:true,updatedAt:now,history:[],reserveStandby:{tenS:1,tenN:2,thirtyR:3}},
  '/api/market-prices':{updated:now,nodes:{APIROQ:{rt:42,da:37,history:[{time:now,value:35},{time:new Date(Date.now()+60000).toISOString(),value:42}],operations:{rtTransfer:12,dayAhead:10}}},ontario:{demand:15000,forecastDemand:15500,history:[{time:new Date(Date.now()-3600000).toISOString(),value:14900}],forecastSeries:[{time:new Date(Date.now()+3600000).toISOString(),value:15500}]}},
  '/api/scada':{feeds:[],readings:[]},'/api/chat/messages':{messages:[{id:'fixture-1',body:'Test message for layout verification.',senderName:'Fixture operator',createdAt:now}]},
  '/api/events/register':{items:Array.from({length:4},(_,i)=>({eventId:'fixture-'+i,occurredAt:now,summary:'Layout verification event '+(i+1),site:'Iroquois Falls',severity:'info',source:'Test fixture'})),nextCursor:null},
 };
 await page.route('**/api/**',route=>{const key=new URL(route.request().url()).pathname;return route.fulfill({status:fixture[key]?200:503,contentType:'application/json',body:JSON.stringify(fixture[key]||{})});});
 fs.mkdirSync(out,{recursive:true});

 try{
  for(const width of [1440,1920]){
   await page.setViewportSize({width,height:1000});
   await page.goto(`http://127.0.0.1:${server.address().port}/northstar-clean.html`);
   await page.waitForFunction(()=>document.querySelector('#overviewStaff')?.dataset.canvasModule && document.querySelector('#weatherCarousel')?.dataset.canvasModule);
   await page.waitForTimeout(900);
   const read=()=>page.evaluate(()=>{
    window.scrollTo(0,0);
    const box=e=>{const r=e.getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height};};
    return {main:box(document.querySelector('main')),staff:box(document.querySelector('#overviewStaff')),graph:box(document.querySelector('#overviewMarketMini')),market:box(document.querySelector('[data-status="markets"]')),fixed:[...document.querySelectorAll('.ns-status-module')].map(box),modules:[...document.querySelectorAll('[data-canvas-module]')].filter(e=>e.getBoundingClientRect().width&&!e.closest('[hidden]')).map(e=>({id:e.dataset.canvasModule,...box(e)})),viewport:document.documentElement.clientWidth};
   });
   const first=await read();
   const clearance=await page.locator('#weatherCarousel').evaluate(e=>e.getBoundingClientRect().bottom-Math.max(...[...e.querySelectorAll('.weather-card')].map(c=>c.getBoundingClientRect().bottom)));
   assert.ok(clearance>=0&&clearance<=12,'carousel bottom clearance '+clearance);
   const stations=first.modules.filter(m=>m.id.startsWith('canvas:stations:'));
   const top=Math.min(...stations.map(m=>m.y));
   const groups=[['twin-falls','iroquois-falls','island-falls'],['old-woman-falls','white-otter-rapids','camp-three-rapids','big-beaver-falls'],['calm-lake','sturgeon-falls','fort-frances'],['kenora','norman','okikendawt-gs'],['aiyers-1','aiyers-2','bird-gs','cogent']];
   for(const group of groups){const cards=group.map(id=>stations.find(m=>m.id==='canvas:stations:site:'+id));assert.ok(cards.every(c=>c&&Math.abs(c.x-cards[0].x)<1),'crew column '+group);for(let i=1;i<cards.length;i++)assert.ok(cards[i].y>cards[i-1].y,'crew order');}
   assert.equal(stations.filter(m=>Math.abs(m.y-top)<2).length,5,'five station tiles in first row');
   assert.ok(Math.abs(first.staff.x-first.main.x-8)<2,'staff left');
   assert.ok(Math.abs(first.staff.y-first.main.y-8)<2,'staff top');
   assert.ok(Math.abs(first.staff.w-Math.min(722,first.viewport-first.main.x-24))<2,'two-site width or viewport fallback');
   
   
   for(const a of first.modules){
    if(/canvas:(stations|weather|carousel):/.test(a.id)||a.id==='canvas:overview:overviewMarketMini')assert.ok(a.x>=first.staff.x+first.staff.w+7,`${a.id} right of check-in`);
    for(const b of first.modules)if(a.id!==b.id)assert.ok(a.x+a.w<=b.x+1||b.x+b.w<=a.x+1||a.y+a.h<=b.y+1||b.y+b.h<=a.y+1,`${a.id} overlaps ${b.id}`);
   }
   await page.reload();await page.waitForTimeout(900);
   assert.deepEqual((await read()).fixed,first.fixed,'fixed dashboard unchanged after reload');
   await page.screenshot({path:path.join(out,`overview-${width}.png`)});
   console.log(`PASS ${width}: right of check-in, no overlaps, fixed dashboard reload`);
  }
 }finally{await browser.close();server.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
