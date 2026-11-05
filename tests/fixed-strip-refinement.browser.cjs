/* Real DOM layout + read-only API fixtures. Never talks to the running backend. */
const {chromium}=require('playwright');
const http=require('node:http'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),out=path.join(root,'outputs/change-coordinator/fixed-popout-integration-20261013');
(async()=>{
 const server=http.createServer((req,res)=>{
  let file=path.resolve(root,'.'+new URL(req.url,'http://localhost').pathname);
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
  '/api/auth/session':{required:false},'/api/checkins':[{id:'fixture-worker-1',name:'Fixture current worker',site:'Twin Falls',status:'on-site',lastHeard:new Date().toISOString(),alone:true},{id:'fixture-worker-2',name:'Fixture missed worker',site:'Iroquois Falls',status:'on-site',lastHeard:new Date(Date.now()-7200000).toISOString(),alone:true}], '/api/alerts':[],
  '/api/weather':{stations:['Iroquois Falls','Atikokan','Kapuskasing','Oshawa','Toronto','Lake Abitibi','Dokis FN','Kenora'].map(name=>({name,current:{temperature_2m:18,weather_code:2,precipitation_probability:20,wind_speed_10m:18,wind_direction_10m:292.5},hourly:{time:Array.from({length:48},(_,i)=>new Date(Date.now()+i*3600000).toISOString()),temperature_2m:Array(48).fill(18),apparent_temperature:Array(48).fill(19),weather_code:Array(48).fill(2),precipitation_probability:Array(48).fill(20),wind_speed_10m:Array(48).fill(18),wind_direction_10m:Array(48).fill(292.5)}}))},
  '/api/dispatch/apiroq':{outputMw:24.5,dispatchMw:25,deltaMw:-0.5,healthy:true,simulated:true,updatedAt:now,history:[],reserveStandby:{tenS:1,tenN:2,thirtyR:3}},
  '/api/market-prices':{updated:now,nodes:{APIROQ:{rt:42,da:37,reserve:{tenS:1.1,tenN:2.2,thirtyR:3.3},history:[{time:now,value:35},{time:new Date(Date.now()+60000).toISOString(),value:42}],operations:{rtTransfer:12,dayAhead:10}}},ontario:{demand:15000,forecastDemand:15500,history:[{time:new Date(Date.now()-3600000).toISOString(),value:14900}],forecastSeries:[{time:new Date(Date.now()+3600000).toISOString(),value:15500}]}},
  '/api/scada':{feeds:[],readings:[]},'/api/chat/messages':{messages:[{id:'fixture-1',body:'Test message for layout verification.',senderName:'Fixture operator',createdAt:now}]},
  '/api/events/register':{items:Array.from({length:12},(_,i)=>({eventId:'fixture-'+i,occurredAt:now,summary:'Layout verification event '+(i+1),site:'Iroquois Falls',severity:'info',source:'Test fixture'})),nextCursor:null},
 };
 await page.context().route('**/api/**',route=>{const key=new URL(route.request().url()).pathname;return route.fulfill({status:fixture[key]?200:503,contentType:'application/json',body:JSON.stringify(fixture[key]||{})});});
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
   assert.equal(first.visible.length,3);
   assert.ok(first.visible.every(c=>c.bottom<=first.weather.bottom+1),'cards fit vertically');
   const appearance=()=>page.evaluate(()=>({cards:[...document.querySelectorAll('#weatherStrip>[data-weather-page=visible]')].map(card=>{const c=getComputedStyle(card),current=getComputedStyle(card.querySelector('.weather-current'));return {display:c.display,padding:c.padding,background:c.backgroundImage,direction:current.flexDirection};}),arrow:(()=>{const c=getComputedStyle(document.querySelector('.weather-carousel-next'));return {color:c.color,border:c.border,width:c.width};})()}));
   const overviewAppearance=await appearance();
   for(const section of ['weather','logbook','overview']){
    await page.locator('#sideNav [data-tab="'+section+'"]').first().click();
    await page.waitForTimeout(250);
    assert.deepEqual(await appearance(),overviewAppearance,'weather appearance survives '+section);
    assert.equal((await check()).visible.length,3,'three cards on '+section);
    const ids=(await check()).visible.map(c=>c.id);
    await page.locator('.weather-carousel-next').click();
    assert.notDeepEqual((await check()).visible.map(c=>c.id),ids,'paging on '+section);
    await page.locator('.weather-carousel-prev').click();
   }
   await page.locator('.weather-carousel-next').click();
   assert.notDeepEqual((await check()).visible.map(c=>c.id),first.visible.map(c=>c.id),'paging works');
   await page.evaluate(()=>window.scrollTo(0,500));assert.equal((await check()).weather.y,first.weather.y,'fixed on scroll');
   await page.reload();await page.waitForTimeout(1200);assert.deepEqual((await check()).weather,first.weather,'reload stable');
   
   const dispatchFit=()=>page.evaluate(()=>{
    const host=document.querySelector('#nsStatusBar [data-status=dispatch]'),button=host.querySelector('.ns-dispatch-accept'),br=button.getBoundingClientRect(),frame=host.getBoundingClientRect();
    return [...host.querySelectorAll('.ns-dispatch-metrics>span :is(small,strong)')].map(node=>{const range=document.createRange();range.selectNodeContents(node);const r=range.getBoundingClientRect();return {text:node.textContent,x:r.x,right:r.right,y:r.y,bottom:r.bottom,overlap:Math.min(r.right,br.right)-Math.max(r.left,br.left)>0.5&&Math.min(r.bottom,br.bottom)-Math.max(r.top,br.top)>0.5,inside:r.left>=frame.left-0.5&&r.right<=frame.right+0.5};});
   });
   const fit=await dispatchFit();console.log('Dispatch fit',width,JSON.stringify(fit));
   const vertical=await page.locator('#nsStatusBar [data-status=dispatch]').evaluate(el=>({frame:el.getBoundingClientRect().toJSON(),bottom:Math.max(...[...el.querySelectorAll('.ns-dispatch-metrics,.ns-dispatch-alert,.ns-or-grid')].map(n=>n.getBoundingClientRect().bottom))}));console.log('Dispatch vertical',JSON.stringify(vertical));
   assert.ok(vertical.bottom<=vertical.frame.bottom+1,'dispatch contents fit original frame height');
   assert.ok(fit.every(x=>!x.overlap&&x.inside),'dispatch values/labels fit without overlapping Accept');
   const metrics=await page.evaluate(()=>{
    const q=s=>document.querySelector('#nsStatusBar '+s),r=e=>e.getBoundingClientRect(),cx=e=>{const b=r(e);return b.x+b.width/2;};
    const mod=q('[data-status=dispatch]'),list=q('.ns-status-alarms'),rows=[...list.children];
    return {center:cx(mod),accept:cx(q('.ns-dispatch-accept')),alert:cx(q('.ns-dispatch-alert')),title:cx(q('[data-status=dispatch] .ns-status-title')),service:cx(q('.ns-dispatch-service-row')),listHeight:r(list).height,rowHeight:r(rows[0]).height,arrow:r(q('.weather-carousel-next')).width,book:!!q('.ns-events-popout')};
   });
   console.log(JSON.stringify({metrics}));await page.locator('#nsStatusBar').screenshot({path:path.join(out,`fixed-strip-${width}.png`)});
   for(const key of ['accept','alert','title','service'])assert.ok(Math.abs(metrics[key]-metrics.center)<2,key+' centered');
   assert.ok(Math.abs(metrics.listHeight/metrics.rowHeight-5)<0.15,'five log rows');
   assert.equal(metrics.arrow,15);assert.ok(metrics.book);
   const ontario=await page.locator('#nsStatusBar [data-node="IESO"] .ns-status-demand-box strong').allTextContents();
   assert.deepEqual(ontario,['15,000 MW','15,500 MW'],'fixed demand card uses the Ontario report');
   assert.equal(await page.locator('#nsStatusBar [data-node="APIROQ"] .ns-status-reserve-box strong').count(),3,'APIROQ retains its three operating-reserve fields');
   await page.locator('.ns-dispatch-alert').evaluate(e=>{e.textContent='OR ACTIVATED';e.className='ns-dispatch-alert is-active';});
   const activated=await page.locator('.ns-dispatch-alert').boundingBox();assert.ok(Math.abs(activated.x+activated.width/2-metrics.center)<2,'OR activated remains centered');
   const saved=await page.evaluate(()=>JSON.parse(localStorage.northstarAssetEditorV1));assert.equal(saved.fixedStripAlignmentV1,true,'migration persisted');
   for(const root of ['fixed:dispatch','fixed:markets'])for(const asset of Object.values(saved.roots[root]?.assets||{}))for(const key of ['x','y','w','h'])assert.equal(asset[key],undefined,'stale internal geometry retired');
   for(let step=0;step<3;step++){
    await page.locator('.weather-carousel-next').click();
    const names=await page.locator('#weatherStrip>[data-weather-page=visible]').evaluateAll(cards=>cards.map(c=>({name:c.dataset.moduleId,text:c.querySelector('header').textContent,fit:c.querySelector('header').scrollWidth<=c.clientWidth,bottom:c.lastElementChild.getBoundingClientRect().bottom,frame:c.getBoundingClientRect().bottom})));
    assert.ok(names.every(n=>n.name===n.text&&n.fit),'full weather names fit');
   }

   await page.locator('.ns-dispatch-accept').evaluate(e=>{e.textContent='Accepted';e.classList.add('is-accepted');});
   const acceptedFit=await dispatchFit();assert.ok(acceptedFit.every(x=>!x.overlap&&x.inside),'dispatch values/labels fit without overlapping Accepted');
   fs.writeFileSync(path.join(out,`dispatch-fit-${width}.json`),JSON.stringify({accept:fit,accepted:acceptedFit},null,2));
   const accepted=await page.locator('.ns-dispatch-accept').boundingBox();assert.ok(Math.abs(accepted.x+accepted.width/2-metrics.center)<2,'Accepted remains centered');
   await page.evaluate(()=>{window.NorthstarHoverPreviewsEnabled=()=>false;});
   await page.locator('.ns-events-popout').click();await page.waitForSelector('#nsStatusEvents.ns-hover-window-pinned');
   await page.waitForSelector('#nsStatusEvents .ns-status-log article');assert.equal(await page.locator('#nsStatusEvents .ns-status-log article').count(),12,'book opens detailed event records');
   assert.ok((await page.locator('#nsStatusEvents .ns-status-log a').first().getAttribute('href')).startsWith('event-detail.html?id='),'event report navigation');
   await page.locator('#nsStatusEvents').screenshot({path:path.join(out,`event-book-${width}.png`)});
   await page.keyboard.press('Escape');assert.ok(await page.locator('#nsStatusEvents').isHidden());assert.ok(await page.locator('.ns-events-popout').evaluate(e=>e===document.activeElement),'focus returns to book');

   await page.locator('#nsStatusBar').screenshot({path:path.join(out,`fixed-strip-${width}.png`)});

   assert.deepEqual(errors,[],'no uncaught page errors');
   console.log('PASS '+width);
  }
 }finally{await browser.close();server.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
