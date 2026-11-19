/* All HTTP and static requests run against this isolated fixture. */
const {chromium}=require('playwright');
const fs=require('fs'), path=require('path'), assert=require('assert/strict');
const root=process.env.NS_TEST_ROOT||path.resolve(__dirname,'..');
const event={eventId:'fixture-alarm',category:'alarm',eventType:'threshold.raised',severity:'warning',site:'Fixture Station',summary:'Fixture pump alert',occurredAt:new Date().toISOString(),payload:{siteId:'site:fixture'}};
const log={...event,eventId:'fixture-log',category:'log',severity:'info',summary:'Shift readings recorded',source:'logbook'};
const critical={...event,eventId:'fixture-critical',severity:'critical',site:'Other station',summary:'High limit · '+('extended message '.repeat(20)),source:'market'};
const feedQueries=[];
const draft={id:'draft',version:1,category:'Log Book',recurrenceTemplateId:'daily',stationId:'site:fixture',title:'Daily readings',description:'Readings reviewed.',dueAt:event.occurredAt};
const writes=[];
(async()=>{
 const browser=await chromium.launch({channel:'msedge',headless:true});
 try{
  const ctx=await browser.newContext({viewport:{width:1800,height:950}});
  await ctx.route('**/*',route=>{
    const u=new URL(route.request().url());
    if(!u.pathname.startsWith('/api/')){
      const f=path.join(root,u.pathname);
      return route.fulfill(fs.existsSync(f)&&fs.statSync(f).isFile()?{path:f}:{status:404,body:''});
    }
    if(route.request().method()==='POST'){
      writes.push([u.pathname,route.request().postDataJSON()]);
      return route.fulfill({json:{eventId:'entry',id:'ticket',status:'open',answer:'Pump reading verified.'}});
    }
    if(u.pathname==='/api/events/register') {
      const p=u.searchParams;feedQueries.push(Object.fromEntries(p));
      const items=[event,log,critical].filter(row=>(!p.has('type')||p.getAll('type').includes(row.category))&&
        (!p.has('severity')||p.get('severity')===row.severity)&&(!p.has('site')||p.get('site')===row.site)&&
        (!p.has('q')||row.summary.includes(p.get('q')))&&(!p.has('source')||row.source===p.get('source')));
      return route.fulfill({json:{items,total:items.length}});
    }
    const d={'/api/auth/session':{required:true,authenticated:true,role:'operator',username:'Fixture'},'/api/checkins':[],'/api/console/status':{stations:[{id:'site:fixture',name:'Fixture Station'}]},'/api/events/register':{items:[event],total:1},'/api/console/tasks':{items:[draft]},'/api/console/task-templates':{items:[]},'/api/events/detail':{history:{items:[]}},'/api/library/note-counts':{counts:{'equipment:E:P1':1}},'/api/maximo/equipment':{available:true,sites:[{code:'E'}],pages:1,total:1,assets:[{assetNum:'P1',description:'Cooling pump',site:'E',noteItemId:'equipment:E:P1'}]},'/api/library/item':{id:'equipment:E:P1',name:'P1',notes:[]},'/api/profile/crew-layout':{positions:{}},'/api/sites':{stations:[]},'/api/scada':{feeds:[],readings:[]},'/api/weather':{stations:[]},'/api/market-prices':{nodes:{},ontario:{}},'/api/chat/messages':{messages:[]}};
    return route.fulfill(u.pathname in d?{json:d[u.pathname]}:{status:503,json:{error:'Unavailable in fixture'}});
  });
  const page=await ctx.newPage();page.setDefaultTimeout(7000);
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  for (const shell of ['northstar-v1.html','northstar-clean.html?buildView=v3']) {
    await page.goto('https://northstar.fixture/'+shell+'#overview');
    const agent=page.getByRole('button',{name:'AGENT',exact:true});
    await agent.waitFor();
    const tabs=await page.locator('#sideNav > [data-tab]').evaluateAll(nodes=>nodes.map(n=>n.dataset.tab));
    assert.equal(tabs[tabs.indexOf('logbook')+1],'assistant');
    const [eventsBox,agentBox,operationsBox]=await Promise.all(['logbook','assistant','operations'].map(tab=>page.locator('#sideNav > [data-tab="'+tab+'"]').boundingBox()));
    assert(eventsBox.y+eventsBox.height<=agentBox.y+1 && agentBox.y+agentBox.height<=operationsBox.y+1);
    const mark=agent.locator('img.northstar-nav-icon');
    assert(await mark.evaluate(n=>n.complete && n.naturalWidth>0 && n.src.includes('northstar-agent-favicon-light') && getComputedStyle(n).filter==='grayscale(1)'));
    assert(!await page.locator('.brand .northstar-ai-menu-toggle').isVisible());
    await agent.click();await page.locator('#assistant.active').waitFor({state:'attached'});
  }
  await page.goto('https://northstar.fixture/northstar-v1.html#overview');
  const entry=page.locator('#sideNav [data-book-page=entry]');
  await entry.click();
  const frame=page.frameLocator('#operatorBookFrame');
  await frame.locator('#live .record').first().waitFor();
  const divider=frame.locator('[data-page=entry] .divider');await divider.press('ArrowLeft');
  assert.equal(await divider.getAttribute('aria-valuenow'),'51');
  const box=await page.locator('#operatorBookFrame').boundingBox();assert(box.height>450 && box.width>800,'usable workspace');
  const positions=await page.locator('#sideNav').evaluate(n=>['[data-tab=overview]','[data-book-page=entry]','[data-book-page=general]','[data-book-page=notes]','[data-book-page=historical]','[data-tab=crew]','[data-tab=logbook]'].map(s=>n.querySelector(s).getBoundingClientRect().y));
  assert(positions.every((y,i)=>!i||y>=positions[i-1]+23),'Sidebar entries align without overlap');
  assert(await page.locator('#nsOperatorBrand').evaluate(n=>n.offsetHeight)<50,'Compact single-row brand');
  await page.locator('#nsWebToolbar .ns-web-toolbar-menu').click();await page.locator('[data-book-version]').waitFor();await page.locator('#nsWebToolbar .ns-web-toolbar-menu').click();
  const rows=frame.locator('#live .record');
  await rows.nth(2).waitFor();
  const rowBoxes=await rows.evaluateAll(list=>list.map(n=>({height:n.offsetHeight,shade:getComputedStyle(n).backgroundColor})));
  assert(rowBoxes.every(r=>r.height===26));assert.equal(new Set(rowBoxes.map(r=>r.shade)).size,3);
  await frame.getByRole('button',{name:'Critical',exact:true}).click();
  await frame.locator('#live [data-tone=warning]').waitFor({state:'detached'});
  assert.equal(await rows.count(),1);
  await frame.getByRole('button',{name:'Alarms',exact:true}).click();
  await frame.locator('#live [data-tone=warning]').waitFor();
  await frame.locator('#moreFilters').click();await frame.locator('#feedSite').selectOption('Fixture Station');
  await frame.locator('#liveFilters [name=q]').fill('pump');await frame.locator('#liveFilters .primary').click();
  await frame.locator('#live [data-tone=critical]').waitFor({state:'detached'});
  assert(feedQueries.some(q=>q.type==='alarm'&&q.site==='Fixture Station'&&q.q==='pump'));
  await frame.locator('#clearFilters').click();await rows.nth(2).waitFor();await frame.locator('#moreFilters').click();
  const toolbar=page.locator('.layout-toolbar'), edit=toolbar.locator('.layout-edit-toggle');
  const composer=frame.locator('[data-layout-panel=composer]'), move=composer.locator('.book-move');
  await edit.click();await move.waitFor();
  const grid=toolbar.locator('[data-layout-grid-step]');await grid.fill('12');await grid.press('Tab');
  const pos=()=>composer.evaluate(n=>({x:n.getBoundingClientRect().x,y:n.getBoundingClientRect().y}));
  const start=await pos(), handle=await move.boundingBox();
  await page.mouse.move(handle.x+40,handle.y+30);await page.mouse.down();await page.mouse.move(handle.x+66,handle.y+67,{steps:4});await page.mouse.up();
  const dragged=await pos();assert.equal(dragged.x-start.x,24);assert.equal(dragged.y-start.y,36);
  await page.keyboard.press('ArrowDown');await page.keyboard.press('Alt+ArrowLeft');
  const nudged=await pos();assert.equal(nudged.x,dragged.x-1);assert.equal(nudged.y,dragged.y+12);
  await page.keyboard.press('Shift+ArrowDown');assert.equal((await pos()).y,nudged.y+120);
  await page.keyboard.press('Shift+ArrowUp');await toolbar.locator('[data-layout-snap]').uncheck();
  await move.press('ArrowDown');assert.equal((await pos()).y,nudged.y+1);await move.press('ArrowUp');
  await toolbar.locator('[data-layout-snap]').check();
  await toolbar.locator('.layout-save').click();assert(!await move.isVisible());
  await page.reload();await frame.locator('#live .record').first().waitFor();assert.deepEqual(await pos(),nudged);
  await edit.click();await toolbar.locator('.layout-reset').click();assert.deepEqual(await pos(),start);
  await edit.click();assert.deepEqual(await pos(),nudged);
  await edit.click();await toolbar.locator('.layout-reset').click();await toolbar.locator('.layout-save').click();
  assert.deepEqual(await pos(),start);
  if(process.env.NS_BOOK_PREVIEW)await page.screenshot({path:process.env.NS_BOOK_PREVIEW});
  await frame.locator('#schedules summary').click();await frame.locator('#drafts button').first().click();
  assert.equal(await frame.locator('#subject').inputValue(),'Daily readings');
  await frame.locator('#assist').click();await frame.locator('#useAi').click();
  await frame.locator('#record').click();await frame.locator('#entryStatus a').waitFor();
  const posted=writes.find(([route])=>route==='/api/console/logbook')[1];
  assert.equal(posted.taskId,'draft');assert.equal(posted.details,'Pump reading verified.');
  await frame.locator('#live .record').first().click();await frame.locator('#comment').fill('Operator reviewed alert.');
  await frame.locator('#commentForm button').click();await frame.getByText('Comment recorded.').waitFor();
  await frame.locator('#ticket').click();await frame.getByText('Follow-up ticket ticket · open').waitFor();
  assert(writes.some(([route,data])=>route==='/api/events/notes'&&data.eventId===event.eventId));
  assert(writes.some(([route,data])=>route==='/api/console/tasks'&&data.sourceEventId===event.eventId));
  await frame.locator('#closeEvent').click();
  await page.locator('[data-book-page=notes]').click();
  await frame.locator('#targetKind').selectOption('equipment');await frame.locator('#assetResults .flag').waitFor();
  await frame.locator('#assetResults button').first().click();
  await frame.locator('#assetNote').fill('Packing inspected.');await frame.locator('#noteForm button').click();await frame.getByText('Note attached.').waitFor();
  assert(writes.some(([route,data])=>route==='/api/library/notes'&&data.itemId==='equipment:E:P1'));
  await page.locator('[data-book-page=historical]').click();await frame.locator('#trend b').first().waitFor();
  await page.locator('[data-book-page=general]').click();await frame.locator('#news .record').first().waitFor();
  await page.locator('#sideNav [data-tab=overview]').click();assert(!await page.locator('#operatorBookFrame').isVisible());
  await page.locator('[data-quick-log]').first().click();await frame.locator('#entryForm').waitFor();
  assert(await page.locator('#sideNav [data-tab=tools] .nav-icon').count());
  assert(!writes.some(([route])=>route.includes('acknowledge')));
  await page.locator('#operatorTools').click();await page.waitForURL('**/*nsLibrary*');assert.equal(new URL(page.url()).searchParams.get('type'),'Tools');
  await page.goto('https://northstar.fixture/northstar-clean.html?buildView=v3&logBook=notes#overview');await page.frameLocator('#operatorBookFrame').locator('#assetResults button').first().waitFor();
  await page.locator('.layout-toolbar .layout-edit-toggle').click();
  const noteHandle=page.frameLocator('#operatorBookFrame').locator('[data-layout-panel=find] .book-move');
  await noteHandle.waitFor();await noteHandle.press('Alt+ArrowDown');
  await page.locator('.layout-toolbar .layout-save').click();assert(!await noteHandle.isVisible());
  await page.goto('https://northstar.fixture/operator-book.html');
  await page.setViewportSize({width:550,height:800});
  const standalone=page.locator('#bookLayoutToolbar'), soloPanel=page.locator('[data-layout-panel=composer]');
  await standalone.locator('[data-edit]').click();
  const soloGrip=soloPanel.locator('.book-move');await soloGrip.press('Alt+ArrowDown');
  await standalone.locator('[data-action=save]').click();
  assert.equal(await soloPanel.evaluate(n=>getComputedStyle(n).translate),'0px 1px');
  assert.deepEqual(errors,[]);console.log('PASS V1/V3 panel editing, grid drag, fine/coarse keyboard moves, save/reset/cancel, single-row shading, event filters and operator workflows.');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1});
