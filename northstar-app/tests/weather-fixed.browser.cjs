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
   await page.waitForSelector('#nsStatusBar #weatherCarousel .weather-card');
   await page.waitForTimeout(1200);
   const check=()=>page.evaluate(()=>{
    const rect=e=>{const r=e.getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height,right:r.right,bottom:r.bottom};};
    const frame=document.querySelector('#weatherCarousel');
    return {weather:rect(frame),market:rect(document.querySelector('[data-status=markets]')),bar:rect(document.querySelector('#nsStatusBar')),canvas:frame.dataset.canvasModule,visible:[...frame.querySelectorAll('[data-weather-page=visible]')].map(e=>({id:e.dataset.moduleId,...rect(e)}))};
   });
   const first=await check();console.log(JSON.stringify({width,...first}));
   assert.ok(first.weather.x>=first.market.right,'right of market');
   assert.ok(Math.abs(first.weather.y-first.market.y)<3,'same row');
   assert.ok(first.weather.right<=first.bar.right+1,'inside fixed bar');
   assert.ok(!first.canvas,'not registered on Overview canvas');
   assert.equal(first.visible.length,4);
   assert.ok(first.visible.every(c=>c.bottom<=first.weather.bottom+1),'cards fit vertically');
   const appearance=()=>page.evaluate(()=>({cards:[...document.querySelectorAll('#weatherStrip>[data-weather-page=visible]')].map(card=>{const c=getComputedStyle(card),current=getComputedStyle(card.querySelector('.weather-current'));return {display:c.display,padding:c.padding,background:c.backgroundImage,direction:current.flexDirection};}),arrow:(()=>{const c=getComputedStyle(document.querySelector('.weather-carousel-next'));return {color:c.color,border:c.border,width:c.width};})()}));
   const overviewAppearance=await appearance();
   for(const section of ['weather','logbook','overview']){
    await page.locator('#sideNav [data-tab="'+section+'"]').first().click();
    await page.waitForTimeout(250);
    assert.deepEqual(await appearance(),overviewAppearance,'weather appearance survives '+section);
    assert.equal((await check()).visible.length,4,'four cards on '+section);
    const ids=(await check()).visible.map(c=>c.id);
    await page.locator('.weather-carousel-next').click();
    assert.notDeepEqual((await check()).visible.map(c=>c.id),ids,'paging on '+section);
    await page.locator('.weather-carousel-prev').click();
   }
   await page.locator('.weather-carousel-next').click();
   assert.notDeepEqual((await check()).visible.map(c=>c.id),first.visible.map(c=>c.id),'paging works');
   await page.evaluate(()=>window.scrollTo(0,500));assert.equal((await check()).weather.y,first.weather.y,'fixed on scroll');
   await page.reload();await page.waitForTimeout(1200);assert.deepEqual((await check()).weather,first.weather,'reload stable');
   await page.screenshot({path:path.join(out,`weather-fixed-${width}.png`)});
   console.log('PASS '+width);
  }
 }finally{await browser.close();server.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
