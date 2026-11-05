/* Real DOM layout + read-only API fixtures. Never talks to the running backend. */
const {chromium}=require('playwright');
const http=require('node:http'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),out=path.join(root,'outputs','change-coordinator','market-four-demand-two-20261011');
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
  '/api/auth/session':{required:false,authenticated:true,username:'chart-fixture',role:'operator'},'/api/checkins':[], '/api/alerts':[],
  '/api/weather':{stations:['Iroquois Falls','Atikokan','Kapuskasing','Oshawa','Toronto','Fort Frances','Dokis FN','Kenora'].map(name=>({name,current:{temperature_2m:18,weather_code:2,precipitation_probability:20,wind_speed_10m:18,wind_direction_10m:292.5},hourly:{time:Array.from({length:48},(_,i)=>new Date(Date.now()+i*3600000).toISOString()),temperature_2m:Array(48).fill(18),apparent_temperature:Array(48).fill(19),weather_code:Array(48).fill(2),precipitation_probability:Array(48).fill(20),wind_speed_10m:Array(48).fill(18),wind_direction_10m:Array(48).fill(292.5)}}))},
  '/api/dispatch/apiroq':{outputMw:24.5,dispatchMw:25,deltaMw:-0.5,healthy:true,simulated:true,updatedAt:now,history:[],reserveStandby:{tenS:1,tenN:2,thirtyR:3}},
  '/api/market-prices':{updated:now,nodes:{APIROQ:{rt:42,da:37,history:Array.from({length:49},(_,i)=>({time:new Date(Date.now()+(i-48)*300000).toISOString(),value:38+Math.sin(i/6)*8+i/12})),daHistory:Array.from({length:5},(_,i)=>({time:new Date(Date.now()+(i-4)*3600000).toISOString(),value:39+i})),forward:Array.from({length:5},(_,i)=>({time:new Date(Date.now()+i*3600000).toISOString(),value:43+i*2})),rtForecast:Array.from({length:5},(_,i)=>({time:new Date(Date.now()+i*3600000).toISOString(),value:45+i*3})),rtTimestamp:now,operations:{rtTransfer:12,dayAhead:10}}},ontario:{demand:15000,forecastDemand:15500,history:Array.from({length:5},(_,i)=>({time:new Date(Date.now()+(i-4)*3600000).toISOString(),value:14000+i*250})),forecastSeries:Array.from({length:5},(_,i)=>({time:new Date(Date.now()+i*3600000).toISOString(),value:15000+i*150}))}},
  '/api/scada':{feeds:[],readings:[]},'/api/chat/messages':{messages:[{id:'fixture-1',body:'Test message for layout verification.',senderName:'Fixture operator',createdAt:now}]},
  '/api/events/register':{items:Array.from({length:4},(_,i)=>({eventId:'fixture-'+i,occurredAt:now,summary:'Layout verification event '+(i+1),site:'Iroquois Falls',severity:'info',source:'Test fixture'})),nextCursor:null},
 };
 await page.route('**/api/**',route=>{const key=new URL(route.request().url()).pathname;return route.fulfill({status:fixture[key]?200:503,contentType:'application/json',body:JSON.stringify(fixture[key]||{})});});
 fs.mkdirSync(out,{recursive:true});
 try{
  await page.goto(`http://127.0.0.1:${server.address().port}/northstar-clean.html`);
  await page.waitForSelector('#nsStatusBar');



  const card=page.locator('#overviewMarketMini');
  const chart=card.locator('canvas');
  await chart.waitFor({state:'visible'});
  assert.equal(await card.locator('header h2,header>small,header>div').count(),0);
  const trigger=card.locator('[data-market-settings]');
  const dialog=page.locator('#overviewMarketScale');
  assert.equal(await card.locator('header button').count(),2);
  assert.ok((await trigger.boundingBox()).height<=19.1);
  const geometry=await card.evaluate(el=>{
    const box=el.getBoundingClientRect(),staff=document.querySelector('#overviewStaff').getBoundingClientRect(),edge=document.querySelector('#nsStatusBar').getBoundingClientRect();
    const buttons=[...el.querySelectorAll('header button')].map(e=>{const b=e.getBoundingClientRect();return {x:b.x,y:b.y,w:b.width,h:b.height};});
    const legend=el.querySelector('.mt-legend').getBoundingClientRect();
    return {box:{x:box.x,y:box.y,w:box.width,h:box.height,right:box.right},staffRight:staff.right,edge:edge.right,buttons,padding:getComputedStyle(el).padding,legendRight:legend.right};
  });
  assert.ok(Math.abs(geometry.box.x-geometry.staffRight-4)<2,JSON.stringify(geometry));
  assert.ok(Math.abs(geometry.box.right-geometry.edge+4)<2,JSON.stringify(geometry));
  assert.equal(geometry.padding,'6px');
  assert.ok(geometry.legendRight<=geometry.buttons[0].x);
  fs.writeFileSync(path.join(out,'verification.json'),JSON.stringify(geometry,null,2));
  assert.equal(await trigger.textContent(),'Options');
  const demand=card.locator('[data-market-demand]');
  const initial=await chart.getAttribute('aria-label');
  assert.match(initial,/Market trends: 4 series/);
  await trigger.click();
  await dialog.locator('[name="preset"]').selectOption('4');
  await dialog.locator('[data-scale-cancel]').click();
  assert.equal(await chart.getAttribute('aria-label'),initial,'Cancel leaves chart unchanged');
  await trigger.click();
  await dialog.locator('[name="preset"]').selectOption('custom');
  await dialog.locator('[name="hours"]').fill('6');
  await dialog.locator('[name="scale"]').selectOption('zero');
  await dialog.screenshot({path:path.join(out,'advanced-settings.png')});
  await dialog.locator('[type="submit"]').click();
  assert.equal(await card.getAttribute('data-market-window-hours'),'6');
  assert.equal(await card.getAttribute('data-market-value-scale'),'zero');
  assert.equal(await card.locator('[data-setting="scale"]').inputValue(),'zero');
  assert.notEqual(await chart.getAttribute('aria-label'),initial,'Range changes plotted samples');
  await card.screenshot({path:path.join(out,'overview-graph.png')});
  await demand.click();
  assert.equal(await demand.getAttribute('aria-pressed'),'true');
  assert.match(await chart.getAttribute('aria-label'),/Market trends: 2 series/);
  assert.match(await chart.getAttribute('aria-label'),/megawatts/);
  assert.equal(await card.getAttribute('data-market-window-hours'),'6','Custom window survives mode switch');
  await demand.click();
  assert.match(await chart.getAttribute('aria-label'),/dollars/);
  assert.equal(await demand.getAttribute('aria-pressed'),'false');
  await demand.click();
  await trigger.click();
  assert.equal(await dialog.locator('[name="view"]').inputValue(),'demand');
  await page.keyboard.press('Escape');
  assert.equal(await dialog.isVisible(),false);
  await card.screenshot({path:path.join(out,'overview-demand.png')});
  for(const width of [1024,1920]) {
   await page.setViewportSize({width,height:1000});
   await chart.screenshot({path:path.join(out,'chart-'+width+'.png')});
   const bounds=await card.evaluate(el=>{const a=el.getBoundingClientRect(),b=el.querySelector('canvas').getBoundingClientRect();return {fits:b.bottom<=a.bottom&&b.right<=a.right,h:b.height};});
   assert.ok(bounds.fits && bounds.h>60,JSON.stringify(bounds));
  }
  await page.setViewportSize({width:1440,height:1000});
  await page.click('.layout-edit-toggle');
  await card.locator('[data-corner="se"]').evaluate(el=>el.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown',shiftKey:true,bubbles:true})));
  const resized=await card.boundingBox();
  await page.evaluate(()=>{window.chartSaved=false;window.addEventListener('northstar:layout-saved',()=>window.chartSaved=true,{once:true});});await page.click('.layout-save');await page.waitForFunction(()=>window.chartSaved);await page.reload();await chart.waitFor({state:'visible'});
  assert.equal((await card.boundingBox()).height,resized.height,'Saved resize survives reload');
  assert.deepEqual(errors,[]);console.log('Overview chart price/demand rendering passed');
 }finally{await browser.close();server.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
