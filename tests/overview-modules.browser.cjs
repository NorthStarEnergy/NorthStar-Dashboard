/* Real DOM layout + read-only API fixtures. Never talks to the running backend. */
const {chromium}=require('playwright');
const http=require('node:http'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),out=path.join(root,'outputs','overview-polish');
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
  '/api/weather':{stations:['Iroquois Falls','Atikokan','Kapuskasing','Oshawa','Toronto','Fort Frances','Dokis FN','Kenora'].map(name=>({name,current:{temperature_2m:18,weather_code:2,precipitation_probability:20},hourly:{time:[now],temperature_2m:[18],weather_code:[2],precipitation_probability:[20]}}))},
  '/api/dispatch/apiroq':{outputMw:24.5,dispatchMw:25,deltaMw:-0.5,healthy:true,simulated:true,updatedAt:now,history:[],reserveStandby:{tenS:1,tenN:2,thirtyR:3}},
  '/api/market-prices':{updated:now,nodes:{APIROQ:{rt:42,da:37,history:[{time:now,value:35},{time:new Date(Date.now()+60000).toISOString(),value:42}],operations:{rtTransfer:12,dayAhead:10}}},ontario:{demand:15000,forecastDemand:15500}},
  '/api/scada':{feeds:[],readings:[]},'/api/chat/messages':{messages:[{id:'fixture-1',body:'Test message for layout verification.',senderName:'Fixture operator',createdAt:now}]},
  '/api/events/register':{items:Array.from({length:4},(_,i)=>({eventId:'fixture-'+i,occurredAt:now,summary:'Layout verification event '+(i+1),site:'Iroquois Falls',severity:'info',source:'Test fixture'})),nextCursor:null},
 };
 await page.route('**/api/**',route=>{const key=new URL(route.request().url()).pathname;return route.fulfill({status:fixture[key]?200:503,contentType:'application/json',body:JSON.stringify(fixture[key]||{})});});
 fs.mkdirSync(out,{recursive:true});
 try{
  await page.goto(`http://127.0.0.1:${server.address().port}/northstar-clean.html`);
  await page.waitForSelector('#overviewEventsSummary .ov-summary');
  await page.waitForFunction(()=>NorthstarOverview.feeds.dispatch?.checked && NorthstarOverview.feeds.events?.checked);
  const layouts=[];
  for(const width of [1920,1440,1371,1100,760,390]){
   await page.setViewportSize({width,height:1000});await page.waitForTimeout(300);
   const layout=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth,cards:[...document.querySelectorAll('[data-canvas-module]')].filter(e=>e.getClientRects().length).map(e=>({id:e.id||e.dataset.moduleId,x:e.getBoundingClientRect().x,y:e.getBoundingClientRect().y,w:e.clientWidth,h:e.clientHeight,scrollW:e.scrollWidth,scrollH:e.scrollHeight}))}));
   assert.equal(await page.locator('#weatherStrip .ov-weather-art:visible').count(),8,'Every station retains its coloured weather graphic');
   assert.equal(await page.locator('#weatherStrip .ov-weather-art').first().getAttribute('aria-label'),'Cloudy');
   layouts.push(layout);await page.screenshot({path:path.join(out,`overview-${width}.png`),fullPage:true});
   assert.ok(layout.scroll<=width+1,`No default horizontal overflow at ${width}: ${layout.scroll}`);
   for(const c of layout.cards)assert.ok(c.scrollW<=c.w+1 && c.scrollH<=c.h+1,`Card content fits ${width} ${c.id}: ${JSON.stringify(c)}`);
  }
  await page.setViewportSize({width:1440,height:1000});await page.waitForTimeout(200);
  assert.equal(await page.locator('#sideNav button .nav-icon').count(),await page.locator('#sideNav button').count(),'Every navigation section has an icon');
  assert.equal(await page.locator('.layout-toolbar > .overview-add-module').count(),1,'Overview controls share one bar');
  assert.equal(await page.locator('#sideNav [data-tab="tools"]').evaluate(e=>getComputedStyle(e).textTransform),'uppercase');
  assert.equal(await page.locator('#eventsCard:visible').count(),0,'Legacy Events content must not leak behind the indicators');
  assert.equal(await page.evaluate(()=>JSON.parse(localStorage.northstarOverviewProfilesV2).beforeIndicatorRow.desktop.positions['canvas:dispatch:dispatchClient'].y),430,'Previous saved arrangement is backed up');
  assert.equal(await page.locator('#overviewSourceStatus').innerText(),'1 source needs attention');
  assert.ok((await page.locator('#dispatchClient .ov-summary').innerText()).includes('24.5 MW'));
  assert.equal(await page.locator('#overviewEventsSummary .ov-events a').count(),4);
  await page.locator('#overviewEventsSummary .ns-open-module').click();
  await page.click('#erWrite');assert.equal(await page.locator('#logSubject:visible').count(),1,'Events composer remains reachable');
  assert.equal(await page.locator('.ns-module-window:visible').count(),1);
  await page.click('#sideNav [data-tab="overview"]');
  await page.locator('#dispatchClient .ns-open-module').click();
  assert.equal(await page.locator('#dispatchDetail:visible').count(),1);
  assert.equal(await page.locator('.ns-module-window:visible').count(),1);
  await page.click('#sideNav [data-tab="overview"]');
  await page.locator('#overviewChatSummary .ns-open-module').click();
  assert.equal(await page.locator('#chatCompose:visible').count(),1);
  await page.click('#sideNav [data-tab="overview"]');
  await page.evaluate(()=>{NorthstarOverview.update('dispatch',{outputMw:null,dispatchMw:null,deltaMw:null});NorthstarOverview.update('staff',null,true);NorthstarOverview.update('events',null,true);});
  await page.waitForTimeout(200);
  assert.ok(!(await page.locator('#dispatchClient .ov-summary').innerText()).includes('0.0 MW'));
  assert.ok((await page.locator('#overviewEventsSummary').innerText()).includes('Stale'));
  assert.equal(await page.locator('#overviewEventsSummary .ov-events a').count(),4,'Retains last good events on failure');
  assert.ok((await page.locator('#alarmIndicator').innerText()).includes('—'),'Failed staff source cannot imply no alarms');
  await page.click('.layout-edit-toggle');
  const weather=page.locator('#weatherStrip > .weather-card').first();
  await weather.focus();await page.keyboard.press('Enter');
  assert.equal(await page.locator('#nsModuleEditor:visible').count(),1,'Narrow weather modules remain keyboard editable');
  await page.locator('#nsModuleEditor [data-editor-close]').first().click();
  await page.evaluate(()=>window.scrollTo(0,document.body.scrollHeight));await page.waitForTimeout(80);
  const dock=await page.locator('.layout-toolbar').boundingBox(),chat=await page.locator('#overviewChatSummary').boundingBox();
  assert.ok(chat.y+chat.height<=dock.y,'Bottom modules scroll fully above the editing bar');
  await page.evaluate(()=>window.scrollTo(0,0));
  const tile=page.locator('#dispatchClient'),before=await tile.boundingBox();
  await tile.locator('[data-corner="nw"]').focus();await page.keyboard.press('ArrowRight');
  const after=await tile.boundingBox();assert.equal(before.width-after.width,5);assert.equal(after.x-before.x,5);
  await page.click('.layout-save');const saved=await tile.boundingBox();
  await page.setViewportSize({width:1100,height:1000});await page.waitForTimeout(200);
  await page.setViewportSize({width:1440,height:1000});await page.waitForTimeout(200);
  assert.deepEqual(await tile.boundingBox(),saved,'Manual desktop layout survives profile switching');
  await page.reload();await page.waitForSelector('#dispatchClient .ov-summary');
  assert.deepEqual(await tile.boundingBox(),saved,'Manual layout survives reload');
  await page.evaluate(()=>NorthstarModules.edit('markets:dispatch','compact'));
  await page.locator('#nsModuleEditor summary').click();
  await page.locator('.ns-field-list label').filter({hasText:/^Output/}).last().locator('input').fill('Generator output');
  await page.click('#nsModuleEditor button[type="submit"]');
  await page.evaluate(()=>NorthstarOverview.update('dispatch',{outputMw:30,dispatchMw:32,deltaMw:-2,healthy:false}));
  await page.waitForTimeout(100);
  assert.ok((await tile.innerText()).includes('Generator output'),'Custom compact labels survive a changing feed');
  assert.ok((await tile.innerText()).includes('Telemetry unavailable'),'HTTP success does not hide telemetry faults');
  assert.ok((await page.locator('#overviewSourceStatus').getAttribute('title')).includes('dispatch'));
  await page.click('.layout-edit-toggle');
  await page.check('[data-ov-snap]');
  await tile.locator('[data-corner="move"]').focus();await page.keyboard.press('ArrowRight');
  const snapped=await page.evaluate(()=>JSON.parse(localStorage.northstarCanvasLayoutV1)['canvas:dispatch:dispatchClient']);
  assert.equal(snapped.x%16,0);
  await page.click('[data-ov-arrange]');
  await Promise.all([page.waitForNavigation({waitUntil:'domcontentloaded'}),page.click('[data-ov-cancel]')]);await page.waitForSelector('#dispatchClient .ov-summary');
  assert.deepEqual(await tile.boundingBox(),saved,'Cancel restores the layout from before editing');
  await page.evaluate(()=>NorthstarOverview.update('staff',{}));await page.waitForTimeout(100);
  assert.ok((await page.locator('#overviewStaffSummary').innerText()).includes('Stale'),'Malformed success cannot reset staff to zero');
  await page.evaluate(()=>{NorthstarOverview.feeds.market.checked=Date.now()-240000;NorthstarOverview.update('scada',{feeds:[{status:'Stale'}],readings:[{siteCode:'fixture'}]});});
  await page.waitForTimeout(100);
  assert.ok(!(await page.locator('#marketTopTiles [data-module-id="IESO"] .ov-freshness').innerText()).includes('Stale'),'Five-minute market polling is not prematurely stale');
  assert.ok((await page.locator('#overviewGeneratingStations .ov-freshness').innerText()).includes('attention'));
  await page.click('.layout-edit-toggle');
  await page.click('[data-ov-previous]');
  assert.deepEqual(await page.evaluate(()=>JSON.parse(localStorage.northstarCanvasLayoutV1)['canvas:dispatch:dispatchClient']),{x:640,y:430,w:330,h:210},'Previous custom arrangement remains recoverable');
  await Promise.all([page.waitForNavigation({waitUntil:'domcontentloaded'}),page.click('[data-ov-cancel]')]);await page.waitForSelector('#dispatchClient .ov-summary');
  const geometry=()=>[...document.querySelectorAll('[data-canvas-module]')].filter(e=>e.getClientRects().length).map(e=>({id:e.dataset.canvasModule,x:e.style.left,y:e.style.top,w:e.style.width,h:e.style.height})).sort((a,b)=>a.id.localeCompare(b.id));
  const stable=await page.evaluate(geometry);
  for(let pass=0;pass<5;pass++){
   fixture['/api/checkins']=Array.from({length:pass%2?8:2},(_,i)=>({id:'reload-'+i,name:'Fixture worker '+i,site:i%2?'Kenora':'Iroquois Falls',status:'checked-in',checkedInAt:now,overdue:false,needsHelp:false}));
   await page.reload();await page.waitForFunction(()=>!!NorthstarModules && NorthstarOverview.feeds.staff?.checked);
   await page.waitForTimeout(700);
   assert.deepEqual(await page.evaluate(geometry),stable,'Reload '+pass+' must preserve visible module geometry despite changing crew data');
   assert.equal(await page.locator('#staffGroups .staff-group:visible').count(),0);
  }
  await page.click('.layout-edit-toggle');
  const marketTile=page.locator('#marketTopTiles [data-module-id="APIROQ"]');
  await marketTile.locator('[data-corner="se"]').evaluate(el=>{
   for(let i=0;i<12;i++)el.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown',shiftKey:true,bubbles:true}));
  });
  await page.waitForTimeout(100);
  assert.equal(await marketTile.locator('.ov-trend svg:visible').count(),1,'Expanded market shows its price history graphic');
  assert.ok((await marketTile.locator('.ov-trend path').getAttribute('d')).includes('L'));
  assert.ok((await marketTile.locator('.ov-trend svg').boundingBox()).width>150,'History graphic uses the module width, not icon dimensions');
  await page.screenshot({path:path.join(out,'restored-market-graphic.png'),fullPage:false});
  await tile.locator('[data-corner="se"]').evaluate(el=>{
   for(let i=0;i<100;i++){
    el.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowLeft',shiftKey:true,bubbles:true}));
    el.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowUp',shiftKey:true,bubbles:true}));
   }
  });
  const tiny=await tile.boundingBox();assert.ok(tiny.width<=2 && tiny.height<=2,'Module can shrink to one pixel without padding forcing a minimum');
  await page.click('.layout-save');await page.reload();await page.waitForSelector('#dispatchClient .ov-summary',{state:'attached'});
  const restoredTiny=await tile.boundingBox();assert.equal(restoredTiny.width,tiny.width);assert.equal(restoredTiny.height,tiny.height);
  await page.screenshot({path:path.join(out,'reload-stability.png'),fullPage:false});
  fs.writeFileSync(path.join(out,'layout-validation.json'),JSON.stringify({fixture:true,layouts,errors,repeatedReloads:5,stableGeometry:stable},null,2));
  assert.deepEqual(errors,[]);console.log('Overview browser scenarios passed: six viewport sizes, containment, links, stale/null values, four-corner resize and profile persistence.');
 }finally{await browser.close();server.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
