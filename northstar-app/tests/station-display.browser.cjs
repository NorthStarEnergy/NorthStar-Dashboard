/* Actual dashboard, synthetic API records, no live backend writes. */

const {chromium}=require('playwright');

const http=require('node:http'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');

const root=path.resolve(__dirname,'..'),out=path.join(root,'outputs','change-coordinator','active-workers-mirror-20261015');

(async()=>{

  const server=http.createServer((req,res)=>{

    const file=path.resolve(root,'.'+new URL(req.url,'http://local').pathname);

    if(!file.startsWith(root+path.sep)||!['.html','.js','.css','.svg','.png','.ico','.json'].includes(path.extname(file))){res.writeHead(404);return res.end();}

    fs.readFile(file,(error,data)=>{res.writeHead(error?404:200,{'Content-Type':{'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json'}[path.extname(file)]||'application/octet-stream'});res.end(error?'':data);});

  });

  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));

  const browser=await chromium.launch({channel:'msedge',headless:true});

  try {

    const page=await browser.newPage({viewport:{width:1440,height:1000},timezoneId:'America/New_York'}),errors=[];

    page.on('pageerror',error=>{errors.push({message:error.message,stack:error.stack});console.log(error.stack);});

    const now=new Date(),prior=new Date(now.getTime()-86400000),iso=now.toISOString(),old=prior.toISOString();

    const rows=[{id:'active',name:'Fixture Active',site:'Island Falls',kind:'Contractor',company:'Fixture Company',status:'on-site',checkedIn:iso,lastHeard:iso,contactPhone:'***-***-0123',latitude:0,longitude:-81.12345,alone:true,expectedMinutes:120,notes:'Fixture visit notes'},

      {id:'closed',name:'Fixture Previous',site:'Island Falls',kind:'Northstar',status:'checked-out',checkedIn:old,lastHeard:old,checkedOutAt:old},

      {id:'other',name:'Other Station Worker',site:'Kenora',kind:'Northstar',status:'on-site',checkedIn:iso,lastHeard:iso}];

    let posted=null,failPost=false;

    await page.context().route('**/api/**',async route=>{

      const req=route.request(),url=new URL(req.url());let data=[],status=200;

      if(url.pathname==='/api/auth/session')data={required:false};

      else if(url.pathname==='/api/checkins'&&req.method()==='POST'){

        posted=req.postDataJSON();status=failPost?400:201;data=failPost?{error:'Fixture validation error'}:{id:'added'};

        if(!failPost)rows.push({...posted,id:'added',status:'on-site',checkedIn:iso,lastHeard:iso});

      }else if(url.pathname==='/api/checkins')data=rows;

      else if(url.pathname==='/api/checkins/history')data=url.searchParams.get('id')==='closed'?[{checkinId:'closed',worker:'Fixture Previous',site:'Island Falls',at:old,event:'checked-out'}]:[{checkinId:'active',worker:'Fixture Active',site:'Island Falls',at:iso,event:'checked-in',details:'Operator entry'}];

      else if(url.pathname==='/api/sites')data={sites:[]};

      else if(url.pathname==='/api/profile/crew-layout')data={positions:{}};

      else if(url.pathname==='/api/weather')data={stations:[]};

      else if(url.pathname==='/api/market-prices')data={nodes:{}};

      else if(url.pathname==='/api/scada')data={feeds:[],readings:[]};

      else if(url.pathname==='/api/events/register')data={items:[],total:0};

      else if(url.pathname==='/api/chat/messages')data={messages:[]};

      else {status=503;data={};}

      await route.fulfill({status,contentType:'application/json',body:JSON.stringify(data)});

    });

    await page.goto(`http://127.0.0.1:${server.address().port}/northstar-clean.html`);

    await page.waitForFunction(()=>typeof openSiteCrew==='function'&&!!window.NorthstarModules);



    fs.mkdirSync(out,{recursive:true});



    page.setDefaultTimeout(10000);
    await page.waitForFunction(()=>window.NorthStarStationDisplay && document.querySelectorAll('#overviewGeneratingStations .gs-card').length>=18);
    await page.waitForTimeout(1200);
    await page.locator('#sideNav [data-tab="overview"]').click();
    const choose=async (target,value)=>{await target.locator('.ns-web-toolbar-menu').click();await target.locator('[data-action="station-display"]').click();await target.locator('[data-station-display="'+value+'"]').click();};
    const action=async(target,name)=>{await target.locator('.ns-web-toolbar-menu').click();await target.locator('#nsWebToolbar [data-action="'+name+'"]').click();};
    const worker=page.locator('#overviewStaff'),graphics=page.locator('#staffGroups'),original=await worker.boundingBox();
    const generating=await page.locator('#overviewGeneratingStations .gs-card').evaluateAll(nodes=>nodes.map(n=>n.getAttribute('style')));
    const graphicBox=await graphics.boundingBox();
    const graphicGroups=await graphics.locator('.staff-group').evaluateAll(nodes=>nodes.map(n=>({site:n.dataset.site,rect:n.getBoundingClientRect().toJSON()})));
    await choose(page,'list');
    const list=page.locator('#overviewWorkerList');assert.equal(await list.isVisible(),true);assert.equal(await graphics.isVisible(),false);
    await list.locator('[data-fr-id="active"]').waitFor();
    assert.equal(await list.locator('.checkins-grid').count(),0);
    assert.equal(await list.locator('[data-fr-id]').count(),2);
    assert.deepEqual(await list.locator('thead th').allTextContents(),await page.locator('#fieldRoster thead th').allTextContents());
    assert.deepEqual(await list.locator('tbody').allTextContents(),await page.locator('#fieldRoster tbody').allTextContents());
    assert.equal(await list.locator('h2').innerText(),'Active Workers');
    await list.locator('[data-fr-id="active"] .fr-person').click();assert.equal(await page.locator('#workerProfileSnapshot').isVisible(),true);await page.locator('#workerProfileSnapshot .worker-profile-close').click();
    const measure=el=>{const table=el.querySelector('table'),row=el.querySelector('[data-fr-id]'),cell=row.querySelector('td'),style=getComputedStyle(cell);return {tableWidth:table.getBoundingClientRect().width,rowHeight:row.getBoundingClientRect().height,font:style.font,padding:style.padding,border:style.borderBottom,background:getComputedStyle(el).backgroundColor,titleFont:getComputedStyle(el.querySelector("h2")).font};};
    const mirrorMetrics=await list.evaluate(measure);
    const referenceWidth=await list.evaluate(el=>el.getBoundingClientRect().width);
    await page.evaluate(()=>NorthstarModules.open('crew:field-roster'));
    const reference=page.locator('#fieldRoster'),referenceStyle=await reference.getAttribute('style');
    await reference.evaluate((el,width)=>el.style.setProperty('width',width+'px','important'),referenceWidth);
    assert.deepEqual(await reference.evaluate(measure),mirrorMetrics,'reference and Overview have identical table metrics/styles at equal width');
    await reference.screenshot({path:path.join(out,'reference-active-workers.png')});
    await reference.evaluate((el,style)=>style===null?el.removeAttribute('style'):el.setAttribute('style',style),referenceStyle);
    await page.locator('#sideNav [data-tab="overview"]').click();
    await list.locator('input[type="search"]').fill('Fixture');assert.equal(await list.locator('[data-fr-id]').count(),1);
    await list.locator('input[type="search"]').fill('');
    await list.locator('select[aria-label="Station"]').selectOption('site:island-falls');
    await list.locator('[data-fr-add]').click();assert.equal(await page.locator('#siteWorkerDialog').isVisible(),true);await page.locator('#siteWorkerCancel').click();
    await list.locator('select[aria-label="Station"]').selectOption('');
    const refreshRequest=page.waitForRequest(req=>new URL(req.url()).pathname==='/api/checkins');await list.locator('[data-fr-refresh]').click();await refreshRequest;
    await page.screenshot({path:path.join(out,'overview-active-workers.png')});
    assert.equal(await page.locator('#overviewGeneratingStations .gs-card').first().isVisible(),true);
    assert.deepEqual(await page.locator('#overviewGeneratingStations .gs-card').evaluateAll(nodes=>nodes.map(n=>n.getAttribute('style'))),generating);
    const box=await worker.boundingBox();assert.equal(box.x,original.x);assert.equal(box.y,original.y);assert.equal(box.width,original.width);
    await choose(page,'graphical');assert.equal(await graphics.isVisible(),true);
    assert.deepEqual(await graphics.boundingBox(),graphicBox);
    assert.deepEqual(await graphics.locator('.staff-group').evaluateAll(nodes=>nodes.map(n=>({site:n.dataset.site,rect:n.getBoundingClientRect().toJSON()}))),graphicGroups);
    const opened=page.waitForEvent('popup');await page.locator('[data-open-status-window]').first().click();const popup=await opened;
    popup.setDefaultTimeout(10000);popup.on('pageerror',error=>errors.push({message:error.message}));
    await popup.waitForSelector('#nsStatusWorkers #staffGroups .staff-group');await popup.waitForSelector('#nsStationWindow > #nsWebToolbar');await popup.waitForFunction(()=>!!window.NorthStarStationDisplay);
    assert.equal(await page.locator('#overviewOperationsConsole').isVisible(),true);assert.equal(await worker.isVisible(),false);
    const menuBox=await popup.locator('#nsWebToolbar').boundingBox();assert.ok(menuBox.x<=8 && menuBox.y<=2,JSON.stringify(menuBox));
    await popup.locator('.ns-web-toolbar-menu').click();assert.deepEqual(await popup.locator('#nsWebToolbarDropdown > button').allTextContents(),['Refresh Dashboard','Full Screen','Build View ▸','Station Display ▸','Edit Layout','Account Settings','Exit']);
    await popup.screenshot({path:path.join(out,'popout-menu.png')});await popup.keyboard.press('Escape');
    await choose(popup,'list');const detachedList=popup.locator('#overviewWorkerList');assert.equal(await detachedList.isVisible(),true);assert.equal(await popup.locator('#staffGroups').isVisible(),false);
    assert.equal(await page.evaluate(()=>NorthStarStationDisplay.get()),'graphical');assert.equal(await page.locator('#overviewOperationsConsole').isVisible(),true);
    await detachedList.locator('[data-fr-id="active"]').waitFor();
    assert.equal(await detachedList.locator('h2').evaluate(el=>getComputedStyle(el).font),mirrorMetrics.titleFont);
    assert.equal(await detachedList.locator('[data-fr-id]').first().evaluate(el=>el.getBoundingClientRect().height),mirrorMetrics.rowHeight);
    assert.equal(await detachedList.locator('.checkins-grid').count(),0);
    assert.deepEqual(await detachedList.locator('tbody').allTextContents(),await popup.locator('#fieldRoster tbody').allTextContents());
    assert.match(await detachedList.innerText(),/Fixture Active/);assert.doesNotMatch(await detachedList.innerText(),/Fixture Previous/);
    await detachedList.locator('[data-fr-id="active"] .fr-person').click();assert.equal(await popup.locator('#workerProfileSnapshot').isVisible(),true);await popup.locator('#workerProfileSnapshot .worker-profile-close').click();
    await detachedList.locator('select[aria-label="Station"]').selectOption('site:island-falls');await detachedList.locator('[data-fr-add]').click();assert.equal(await popup.locator('#siteWorkerDialog').isVisible(),true);await popup.locator('#siteWorkerCancel').click();
    await detachedList.locator('select[aria-label="Station"]').selectOption('');
    await popup.evaluate(()=>window.dispatchEvent(new CustomEvent('northstar:field-roster-data',{detail:[{id:'new',name:'Updated Worker',site:'Island Falls',kind:'Northstar',status:'on-site',checkedIn:new Date().toISOString(),lastHeard:new Date().toISOString(),needsHelp:true}]})));assert.match(await detachedList.innerText(),/Updated Worker/);
    await popup.screenshot({path:path.join(out,'popout-active-workers.png')});
    await popup.setViewportSize({width:720,height:800});assert.equal(await detachedList.locator('[data-fr-id]').first().evaluate(el=>el.getBoundingClientRect().height),30);assert.ok(await detachedList.locator('table').evaluate(el=>el.getBoundingClientRect().width>=900));await popup.screenshot({path:path.join(out,'popout-active-workers-narrow.png')});await popup.setViewportSize({width:1440,height:1000});
    await action(popup,'refresh');await popup.waitForFunction(()=>window.NorthStarStationDisplay?.get()==='list');assert.equal(await popup.locator('#overviewWorkerList').isVisible(),true);assert.equal(await page.evaluate(()=>NorthStarStationDisplay.get()),'graphical');
    await action(popup,'edit');assert.equal(await popup.locator('body').evaluate(el=>el.classList.contains('layout-edit')),true);await action(popup,'edit');
    await popup.evaluate(()=>{window.__fullscreenRequested=false;document.documentElement.requestFullscreen=()=>{window.__fullscreenRequested=true;return Promise.resolve();};});await action(popup,'fullscreen');assert.equal(await popup.evaluate(()=>window.__fullscreenRequested),true);
    await action(popup,'account');assert.equal(await page.locator('#account').isVisible(),true);assert.equal(popup.isClosed(),false);await page.locator('#sideNav [data-tab="overview"]').click();
    await choose(popup,'graphical');assert.equal(await popup.locator('#staffGroups').isVisible(),true);await popup.screenshot({path:path.join(out,'popout-graphical.png')});
    const closed=popup.waitForEvent('close');await action(popup,'exit');await closed;
    await page.waitForFunction(()=>!document.querySelector('#overviewStaff').classList.contains('ns-console-tracker-away'));assert.equal(await worker.isVisible(),true);assert.equal(await graphics.isVisible(),true);assert.equal(await page.locator('#overviewOperationsConsole').isVisible(),false);assert.deepEqual(errors,[]);
    console.log('PASS: worker-panel target, generating cards unchanged, actual Active Workers table mirror, search/add/refresh, same-width styling, six popout menu choices, feed updates, refresh/persistence, independent parent, Edit Layout, fullscreen request, Account to parent, Exit restores tracker/Event Log swap, no page errors.');
  } finally {await browser.close();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});
