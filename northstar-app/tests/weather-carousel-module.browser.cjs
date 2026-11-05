/* Real DOM layout + read-only API fixtures. Never talks to the running backend. */
const {chromium}=require('playwright');
const http=require('node:http'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),out=path.join(root,'outputs','carousel-module');
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
  '/api/market-prices':{updated:now,nodes:{APIROQ:{rt:42,da:37,history:[{time:now,value:35},{time:new Date(Date.now()+60000).toISOString(),value:42}],operations:{rtTransfer:12,dayAhead:10}}},ontario:{demand:15000,forecastDemand:15500}},
  '/api/scada':{feeds:[],readings:[]},'/api/chat/messages':{messages:[{id:'fixture-1',body:'Test message for layout verification.',senderName:'Fixture operator',createdAt:now}]},
  '/api/events/register':{items:Array.from({length:4},(_,i)=>({eventId:'fixture-'+i,occurredAt:now,summary:'Layout verification event '+(i+1),site:'Iroquois Falls',severity:'info',source:'Test fixture'})),nextCursor:null},
 };
 await page.route('**/api/**',route=>{const key=new URL(route.request().url()).pathname;return route.fulfill({status:fixture[key]?200:503,contentType:'application/json',body:JSON.stringify(fixture[key]||{})});});
 fs.mkdirSync(out,{recursive:true});

 try{
  await page.addInitScript(()=>{
   const names=['Iroquois Falls','Atikokan','Kapuskasing','Oshawa','Toronto','Fort Frances','Dokis FN','Kenora'];
   const positions=Object.fromEntries(names.map((name,i)=>['canvas:weather:'+name,{x:16+i*81,y:12,w:75,h:95}]));
   positions['canvas:carousel:weatherCarousel']={x:16,y:12,w:354,h:105};
   if(!JSON.parse(localStorage.northstarCanvasLayoutV1||'{}')['canvas:carousel:weatherCarousel']){localStorage.northstarCanvasLayoutV1=JSON.stringify(positions);
   localStorage.northstarOverviewProfilesV2=JSON.stringify({desktop:{positions,width:1196,automatic:false,indicatorRow:1,weatherOriginal:1,weatherAtikokanSize:true,weatherHeaderRow:1,weatherFamilyLayoutVersion:1,overviewGroupLayoutVersion:1}});
   localStorage.northstarAssetEditorV1=JSON.stringify({version:1,roots:{'compact:weather:locations:Iroquois Falls':{assets:{'div.weather-current > b':{fontSize:17}},custom:[],sizing:'fixed'}}});}
   const interval=window.setInterval;window.setInterval=(fn,ms,...args)=>{if(ms===300000)window.rotateWeatherTest=fn;return interval(fn,ms,...args);};
  });
  await page.goto(`http://127.0.0.1:${server.address().port}/northstar-clean.html`);
  const frame=page.locator('#weatherCarousel');
  await page.waitForFunction(()=>document.querySelector('#weatherCarousel')?.dataset.canvasModule);
  await page.waitForFunction(()=>document.querySelectorAll('#weatherStrip>.weather-card').length>=8);
  const state=()=>page.evaluate(()=>({key:document.querySelector('#weatherCarousel').dataset.canvasModule,width:Math.round(document.querySelector('#weatherCarousel').getBoundingClientRect().width),visible:[...document.querySelectorAll('#weatherStrip>.weather-card')].filter(n=>getComputedStyle(n).display!=='none').map(n=>({name:n.dataset.moduleId,w:Math.round(n.getBoundingClientRect().width),h:Math.round(n.getBoundingClientRect().height)})),childHandles:document.querySelectorAll('#weatherStrip .canvas-move-handle').length,asset:localStorage.northstarAssetEditorV1}));
  const first=await state();assert.equal(first.key,'canvas:carousel:weatherCarousel');assert.equal(first.width,334);assert.equal(first.visible.length,4);assert.equal(first.childHandles,0);assert.ok(first.visible.every(n=>n.w===75&&n.h===119));
  const content=await page.evaluate(()=>[...document.querySelectorAll('#weatherStrip>.weather-card[data-weather-page="visible"]')].map(card=>({height:card.getBoundingClientRect().height,bottoms:[...card.children].filter(el=>el.matches('header,.weather-icon,.weather-current,.weather-extra-line')).map(el=>Math.round(el.getBoundingClientRect().bottom-card.getBoundingClientRect().top))})));assert.ok(content.every(card=>card.bottoms.every(bottom=>bottom<=card.height)));
  await page.getByRole('button',{name:'Next weather stations',exact:true}).click();assert.notDeepEqual((await state()).visible,first.visible);
  const second=await state();await page.evaluate(()=>window.rotateWeatherTest());assert.notDeepEqual((await state()).visible,second.visible);
  await page.locator('.layout-edit-toggle').click();
  const before=await frame.boundingBox();const move=frame.locator(':scope > .canvas-move-handle');
  await move.press('ArrowRight');await move.press('ArrowDown');
  const after=await frame.boundingBox();assert.ok(after.x!==before.x||after.y!==before.y);
  const handleBox=await move.boundingBox();await page.mouse.move(handleBox.x+handleBox.width/2,handleBox.y+handleBox.height/2);await page.mouse.down();await page.mouse.move(handleBox.x+handleBox.width/2+80,handleBox.y+handleBox.height/2+32,{steps:5});await page.mouse.up();const dragged=await frame.boundingBox();assert.ok(dragged.x!==after.x||dragged.y!==after.y,'pointer drag moves group');
  await page.locator('.layout-save').click();
  const stored=await page.evaluate(()=>JSON.parse(localStorage.northstarCanvasLayoutV1)['canvas:carousel:weatherCarousel']);
  await page.reload();await page.waitForFunction(()=>document.querySelectorAll('#weatherStrip>.weather-card').length>=8);
  const restored=await page.evaluate(()=>JSON.parse(localStorage.northstarCanvasLayoutV1)['canvas:carousel:weatherCarousel']);assert.deepEqual(restored,stored);
  const final=await state();assert.equal(final.visible.length,4);assert.ok(final.visible.every(n=>n.w===75&&n.h===119));
  assert.deepEqual(JSON.parse(final.asset).roots['compact:weather:locations:Iroquois Falls'],JSON.parse(first.asset).roots['compact:weather:locations:Iroquois Falls']);
  await page.evaluate(()=>{const strip=document.querySelector('#weatherStrip');strip.replaceChildren(...[...strip.children].map(n=>n.cloneNode(true)));});
  await page.waitForTimeout(200);assert.equal((await state()).visible.length,4);assert.equal((await state()).childHandles,0);
  await page.screenshot({path:path.join(out,'carousel-module-tested.png')});
  assert.deepEqual(errors,[]);console.log('PASS: one carousel module; four 75x119 cards; arrows, rotation, editor movement, save/reload, asset preservation and redraw.');
 }finally{await browser.close();server.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
