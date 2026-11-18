/* All browser requests are intercepted and use synthetic data. */
const {chromium}=require('playwright');
const path=require('path'),fs=require('fs'),assert=require('assert/strict');
const root=process.env.NS_TEST_ROOT||path.resolve(__dirname,'..');
const screenshots=process.env.NORTHSTAR_MONITOR_SCREENSHOTS;
const now=new Date().toISOString();
const people=[['3','Wren Stone','River Services','Twin Falls','2026-11-03'],['2','Finn Vale','NorthStar Energy','Island Falls','2026-11-01'],['1','Casey Lake','NorthStar','Twin Falls','2026-11-02']].map(([id,name,company,site,date])=>({id,name,company,site,status:'on-site',checkedIn:date+'T12:00:00Z',lastHeard:now,kind:'Employee'}));
const events=Array.from({length:15},(_,i)=>({eventId:'test-'+i,occurredAt:now,severity:'info',source:'operator',summary:['Shift handover recorded','Station inspection completed','Crew arrived on site'][i%3]}));
(async()=>{
 const browser=await chromium.launch({channel:'msedge',headless:true});try{
 const ctx=await browser.newContext({viewport:{width:1920,height:960},timezoneId:'America/Toronto'});
 await ctx.route('**/*',async route=>{
  const u=new URL(route.request().url());
  if(u.pathname.startsWith('/api/')){
   const data={'/api/auth/session':{required:true,authenticated:true,username:'Fixture',role:'operator'},'/api/checkins':people,'/api/events/register':{items:events,snapshot:15,total:15},'/api/sites':{stations:[]},'/api/profile/crew-layout':{positions:{}},'/api/scada':{feeds:[],readings:[]},'/api/weather':{stations:[]},'/api/market-prices':{nodes:{},ontario:{}},'/api/chat/messages':{messages:[]}};
   if(u.pathname in data)return route.fulfill({json:data[u.pathname]});return route.fulfill({status:503,json:{error:'Fixture service unavailable'}});
  }
  let f=path.join(root,u.pathname);
  if(!fs.existsSync(f)||!fs.statSync(f).isFile())return route.fulfill({status:404,body:''});
  return route.fulfill({path:f});
 });
 const page=await ctx.newPage(),errors=[];page.setDefaultTimeout(6500);page.on('pageerror',e=>errors.push(e.stack?.split('\n').slice(0,2).join(' ')));
 await page.goto('https://northstar.fixture/northstar-v1.html#overview');
 await page.waitForTimeout(1800);
 const roster=page.locator('#overviewWorkerList');
 if(screenshots)await page.screenshot({path:path.join(screenshots,'overview-wide.png')});
 assert.equal(await roster.locator('tr[data-fr-id]').count(),3);
 const names=()=>roster.locator('tr[data-fr-id]').evaluateAll(rs=>rs.map(r=>r.dataset.frId).join());
 await roster.getByRole('button',{name:'Company',exact:true}).click();
 assert.equal(await names(),'1,2,3');
 await roster.getByRole('button',{name:'Company',exact:true}).click();assert.equal(await names(),'3,1,2');
 await roster.getByRole('button',{name:'Time in',exact:true}).click();assert.equal(await names(),'2,1,3');
 await roster.getByRole('button',{name:'Time in',exact:true}).click();assert.equal(await names(),'3,1,2');
 await roster.getByRole('button',{name:'Person',exact:true}).click();assert.equal(await names(),'1,2,3');
 await roster.getByRole('button',{name:'Resize Company column'}).press('Shift+ArrowRight');
 await roster.locator('summary').click();await roster.getByRole('spinbutton',{name:'Row height in pixels'}).fill('40');await roster.getByRole('spinbutton').press('Tab');
 assert.equal(await roster.locator('tr[data-fr-id] td').first().evaluate(n=>n.getBoundingClientRect().height),40);
 await page.reload();await page.waitForTimeout(1030);assert.equal(await names(),'1,2,3');
 const [ro,ev,gs]=await Promise.all(['#overviewStaff','#overviewShiftEvents','#overviewGeneratingStations .gs-card'].map(s=>page.locator(s).first().boundingBox()));
 assert(ev && ev.x>=ro.x+ro.width-1 && gs.y>=ev.y+ev.height-1,'Event panel aligned above stations');
 assert(await page.locator('.shift-event-list a').count()>0,'Live register entries');
 await page.setViewportSize({width:1100,height:800});await page.waitForTimeout(300);assert(!await page.locator('#overviewShiftEvents').isVisible(),'Original narrower layout');
 await page.setViewportSize({width:1920,height:960});await page.waitForTimeout(300);
 await page.locator('.layout-edit-toggle').click();await page.locator('#nsAssetEditor [name=gridStep]').fill('24');await page.locator('#nsAssetEditor [name=gridStep]').press('Tab');
 assert.equal(await page.evaluate(()=>NorthstarWindowLayout.keyStep({})),24);
 assert.equal(await page.evaluate(()=>NorthstarWindowLayout.keyStep({altKey:true})),1);
 const editor=page.locator('#nsAssetEditor');
 await editor.locator('[name=mode]').selectOption('assets');
 const rootChoice=await editor.locator('[name=root] option').evaluateAll(opts=>opts.find(o=>o.value.endsWith(':overviewShiftEvents'))?.value);
 assert(rootChoice,'Event panel is an editable canvas module');
 await editor.locator('[name=root]').selectOption(rootChoice);
 await editor.locator('[data-add=text]').click();
 const assets=page.locator('#overviewShiftEvents .ns-asset-custom');
 assert.equal(await assets.count(),1);
 await page.evaluate(()=>document.activeElement.blur());
 const left=()=>assets.first().evaluate(n=>parseFloat(n.style.left));
 const original=await left();
 await page.keyboard.press('ArrowRight');assert.equal(await left(),original+24,'Coarse key movement');
 await page.keyboard.press('Alt+ArrowLeft');assert.equal(await left(),original+23,'Fine key movement');
 await page.keyboard.press('Control+c');await page.keyboard.press('Control+v');assert.equal(await assets.count(),2,'Copied custom asset');
 await page.keyboard.press('Control+z');assert.equal(await assets.count(),1,'Undo paste');
 await page.goto('https://northstar.fixture/northstar-v1.html?nsStatusWindow=1#overview');await page.waitForTimeout(1400);
 const splitter=page.getByRole('button',{name:'Resize worker and event panels'});
 const oldWidth=await page.locator('#overviewStaff').evaluate(n=>n.getBoundingClientRect().width);
 await splitter.press('ArrowLeft');
 assert(await page.locator('#overviewStaff').evaluate(n=>n.getBoundingClientRect().width)<oldWidth);
 await page.getByRole('button',{name:'Resize Severity column'}).press('Shift+ArrowRight');
 assert(await page.locator('#nsSimpleEvents col.v3-event-severity').evaluate(c=>parseInt(c.style.width)>70));
 assert(await page.locator('#overviewStaff .staff-panel-head #nsWebToolbar').isVisible(),'Same-row hamburger');
 await page.locator('.ns-monitor-fullscreen').click();assert(await page.evaluate(()=>!!document.fullscreenElement));
 await page.evaluate(()=>document.exitFullscreen());if(screenshots)await page.screenshot({path:path.join(screenshots,'detached-monitor.png')});
 assert.deepEqual(errors,[],'No browser errors');
 console.log('PASS wide layout, events, two-way sorting, resizing, preferences, grid, pop-out and fullscreen.');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
