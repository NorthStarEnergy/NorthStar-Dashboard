/* Actual dashboard, synthetic API records, no live backend writes. */
const {chromium}=require('playwright');
const http=require('node:http'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),out=path.join(root,'outputs','checkins-station-overview');
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
    page.on('pageerror',error=>errors.push({message:error.message,stack:error.stack}));
    const now=new Date(),prior=new Date(now.getTime()-86400000),iso=now.toISOString(),old=prior.toISOString();
    const rows=[{id:'active',name:'Fixture Active',site:'Island Falls',kind:'Contractor',company:'Fixture Company',status:'on-site',checkedIn:iso,lastHeard:iso,contactPhone:'***-***-0123',latitude:0,longitude:-81.12345,alone:true,expectedMinutes:120,notes:'Fixture visit notes'},
      {id:'closed',name:'Fixture Previous',site:'Island Falls',kind:'Northstar',status:'checked-out',checkedIn:old,lastHeard:old,checkedOutAt:old},
      {id:'other',name:'Other Station Worker',site:'Kenora',kind:'Northstar',status:'on-site',checkedIn:iso,lastHeard:iso}];
    let posted=null,failPost=false;
    await page.route('**/api/**',async route=>{
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
    // Let the dashboard finish its asynchronous saved-route restoration.
    await page.waitForTimeout(1500);
    await page.evaluate(()=>{const m=[...NorthstarModules.registry.values()].find(m=>m.sourceSection==='crew');NorthstarModules.open(m.id);});
    await page.waitForSelector('.checkins-station');
    assert.equal(await page.locator('.checkins-station').count(),20);
    assert.deepEqual(await page.locator('[data-checkins-area]').allTextContents(),['Fort Frances','Kenora','Iroquois','Island','Kap','Quebec']);
    assert.match(await page.locator('.checkins-summary').innerText(),/People on site\s+2/);
    const island=page.locator('[data-checkins-site="site:island-falls"]');
    assert.equal(await island.getAttribute('aria-expanded'),'false');
    assert.equal(await page.locator('.checkins-site-details:visible').count(),0);
    await island.click();
    assert.equal(await island.getAttribute('aria-expanded'),'true');
    assert.match(await page.locator('#checkins-people-site-island-falls').innerText(),/Fixture Active/);
    assert.match(await page.locator('#checkins-people-site-island-falls').innerText(),/Contractors\s+1/);
    assert.match(await page.locator('#checkins-people-site-island-falls').innerText(),/Marked alone\s+1/);
    assert.match(await page.locator('[data-checkins-site="site:fort-frances"]').innerText(),/No active workers/);
    console.log(await page.locator('#crew').evaluate(el=>({root:el.getBoundingClientRect().width,panel:el.querySelector('.panel').getBoundingClientRect().width,viewport:innerWidth})));
    await page.screenshot({path:path.join(out,'overview-desktop.png'),fullPage:true});
    await page.locator('#checkinsSites').click();
    assert.equal(await page.locator('#checkinsSites').getAttribute('aria-pressed'),'true');
    assert.equal(await page.locator('.checkins-station').count(),20);
    const rowBoxes=await page.locator('.checkins-station').evaluateAll(nodes=>nodes.map(n=>{const r=n.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width};}));
    assert.ok(rowBoxes.every(r=>Math.abs(r.x-rowBoxes[0].x)<1 && Math.abs(r.width-rowBoxes[0].width)<1),'Sites use full-width rows');
    assert.ok(rowBoxes[1].y>rowBoxes[0].y,'Sites stack vertically');
    await island.click();
    await page.locator('[data-checkins-detail="site:island-falls"]').click();
    await page.waitForFunction(()=>document.querySelector('#siteCrewHistory').textContent.includes('checked-in'));
    assert.equal(await page.locator('#siteCrewHistoryHeading').innerText(),'Site Log');
    const todayKey=await page.evaluate(()=>{const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;});
    assert.equal(await page.locator('#siteCrewDate').inputValue(),todayKey);
    assert.doesNotMatch(await page.locator('#siteCrewHistory').innerText(),/Fixture Previous/);
    const panels=await page.locator('.site-crew-columns>.site-crew-panel').evaluateAll(nodes=>nodes.map(n=>{const r=n.getBoundingClientRect();return {x:r.x,right:r.right};}));
    assert.ok(panels[1].x>=panels[0].right,'Site Log on right');
    const yesterdayKey=await page.evaluate(value=>{const d=new Date(value);return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;},old);
    await page.locator('#siteCrewDate').fill(yesterdayKey);
    await page.locator('#siteCrewDate').dispatchEvent('change');
    await page.waitForFunction(()=>document.querySelector('#siteCrewHistory').textContent.includes('checked-out'));
    assert.doesNotMatch(await page.locator('#siteCrewHistory').innerText(),/Fixture Active/);
    await page.locator('#siteCrewRefresh').click();
    await page.waitForFunction(()=>document.querySelector('#siteCrewHistory').textContent.includes('checked-out'));
    assert.equal(await page.locator('#siteCrewDate').inputValue(),yesterdayKey);
    await page.locator('#siteCrewClose').click();
    await page.locator('#sideNav [data-tab="overview"]').click();
    await page.locator('#staffGroups .staff-group[data-site="Island Falls"] h3').click();
    await page.waitForFunction(()=>document.querySelector('#siteCrewHistory').textContent.includes('checked-in'));
    assert.equal(await page.locator('#siteCrewDate').inputValue(),todayKey);
    assert.equal(await page.locator('#crew').isVisible(),true);
    await page.screenshot({path:path.join(out,'site-log-desktop.png'),fullPage:true});
    await page.setViewportSize({width:390,height:844});
    await page.waitForTimeout(300);
    if(await page.locator('#nsPhoneLineup').isVisible()) {
      await page.getByRole('button',{name:'Choose mobile module lineup',exact:true}).click();
      await page.getByRole('button',{name:'View check-ins: All stations',exact:true}).click();
      await page.evaluate(()=>openSiteCrew('Island Falls'));
    }
    const logBox=await page.locator('.site-log-panel').boundingBox();
    assert.ok(logBox.x>=0 && logBox.x+logBox.width<=391,'Site Log fits phone');
    await page.screenshot({path:path.join(out,'site-log-mobile.png'),fullPage:true});
    await page.setViewportSize({width:1440,height:1000});
    await page.locator('#siteCrewClose').click();
    await page.screenshot({path:path.join(out,'sites-desktop.png'),fullPage:true});
    await page.locator('#checkinsSites').click();
    await island.click();
    await page.locator('[data-checkins-area="Island"]').click();
    assert.equal(await page.locator('.checkins-station').count(),1);
    await island.focus();await page.keyboard.press('Enter');
    assert.equal(await island.getAttribute('aria-expanded'),'false');
    await island.focus();await page.keyboard.press('Enter');
    await page.locator('[data-checkins-detail="site:island-falls"]').click();
    await page.waitForFunction(()=>document.querySelector('#siteCrewPeople').textContent.includes('Fixture Active'));
    assert.equal(await page.locator('#crew .crew-layout').isVisible(),false);
    assert.match(await page.locator('#siteCrewTitle').innerText(),/Island Falls/i);
    await page.locator('#siteCrewClose').click();
    assert.equal(await page.locator('.checkins-station').count(),1);
    assert.equal(await page.evaluate(()=>document.activeElement.dataset.checkinsSite),'site:island-falls');
    await page.locator('[data-checkins-area="Kenora"]').click();
    assert.equal(await page.locator('.checkins-station').count(),3);
    await page.locator('[data-checkins-area="Quebec"]').click();
    assert.equal(await page.locator('.checkins-station').count(),5);
    for(const [area,count] of [['Fort Frances',4],['Kenora',3],['Iroquois',3],['Island',1],['Kap',4],['Quebec',5]]){await page.locator(`[data-checkins-area="${area}"]`).click();assert.equal(await page.locator('.checkins-station').count(),count);}
    await page.evaluate(()=>NorthstarCheckins.select('All stations'));
    await page.evaluate(()=>renderCrewRows([{id:'attention',siteId:'site:kenora',site:'Alias ignored',name:'Fixture help',kind:'Contractor',company:'<img src=x onerror=alert(1)>',needsHelp:true,overdue:true,status:'on-site',alone:true,lastHeard:new Date().toISOString()},{id:'pending',site:'Norman',name:'Fixture Pending',status:'provisional'}]));
    assert.equal(await page.locator('[data-checkins-site="site:kenora"]').locator('..').getAttribute('data-state'),'help');
    assert.equal(await page.locator('[data-checkins-site="site:norman"]').locator('..').getAttribute('data-state'),'pending');
    assert.equal(await page.locator('.checkins-companies img').count(),0);
    await page.locator('[data-checkins-site="site:kenora"]').focus();
    const alertRows=[
      {id:'late',site:'Kenora',name:'Fixture overdue',status:'on-site',overdue:true},
      {id:'pending',site:'Norman',name:'Fixture pending',status:'provisional'},
      {id:'help',site:'Okikendawt GS',name:'Fixture help',status:'on-site',needsHelp:true},
      {id:'active',site:'Island Falls',name:'Fixture active',status:'on-site'},
      {id:'status-late',site:'Twin Falls',name:'Fixture status overdue',status:'overdue'}
    ].map(r=>({...r,kind:'Northstar',checkedIn:iso,lastHeard:iso}));
    rows.splice(0,rows.length,...alertRows);
    await page.evaluate(data=>renderCrewRows(data),alertRows);
    assert.equal(await page.locator('.checkins-alert-dot').count(),4);
    for(const state of ['active','empty','help','late','pending']) {
      const station=page.locator(`.checkins-site[data-state="${state}"]`).first();
      const borders=await station.evaluate(el=>{const s=getComputedStyle(el);return [s.borderTopColor,s.borderRightColor,s.borderBottomColor,s.borderLeftColor];});
      assert.deepEqual(borders,Array(4).fill('rgb(235, 187, 100)'),state+' yellow outline');
      await station.hover();assert.equal(await station.evaluate(el=>getComputedStyle(el).borderTopColor),'rgb(235, 187, 100)');
    }
    assert.equal(await page.locator('.checkins-alert-dot').first().evaluate(el=>getComputedStyle(el).animationName),'checkins-alert-flash');
    await page.emulateMedia({reducedMotion:'reduce'});
    assert.equal(await page.locator('.checkins-alert-dot').first().evaluate(el=>getComputedStyle(el).animationName),'none');
    for(const [id,name,label] of [['site:kenora','Fixture overdue','OVERDUE'],['site:norman','Fixture pending','PENDING REVIEW'],['site:okikendawt-gs','Fixture help','NEEDS HELP'],['site:twin-falls','Fixture status overdue','OVERDUE']]) {
      await page.locator(`[data-checkins-site="${id}"]`).click();
      await page.locator(`[data-checkins-detail="${id}"]`).click();
      await page.waitForFunction(name=>document.querySelector('#siteCrewPeople').textContent.includes(name),name);
      assert.equal(await page.locator('#siteCrewPeople .site-worker-alert-dot').count(),1);
      assert.match(await page.locator('#siteCrewPeople').innerText(),new RegExp(label));
      assert.equal(await page.locator('#siteCrewPeople .site-worker-alert-dot').evaluate(el=>getComputedStyle(el).animationName),'none');
      await page.locator('#siteCrewClose').click();
    }
    await page.emulateMedia({reducedMotion:'no-preference'});
    await page.locator('[data-checkins-site="site:kenora"]').focus();
    await page.evaluate(()=>renderCrewRows([],true));
    assert.equal(await page.evaluate(()=>document.activeElement.dataset.checkinsSite),'site:kenora');
    assert.equal(await page.locator('.checkins-site[data-state="unknown"]').count(),20);
    assert.equal(await page.locator('.checkins-alert-dot').count(),0);
    assert.equal(await page.locator('.checkins-station').first().evaluate(el=>getComputedStyle(el).borderTopColor),'rgb(235, 187, 100)');
    assert.match(await page.locator('#checkinsFeedState').innerText(),/unavailable/);
    assert.doesNotMatch(await page.locator('.checkins-summary').innerText(),/People on site\s+0/);
    await page.locator('#checkinsRefresh').evaluate(button=>button.click());
    await page.waitForFunction(()=>document.querySelector('#checkinsFeedState').textContent.startsWith('Updated'));
    await page.setViewportSize({width:390,height:844});
    if(await page.locator('#nsPhoneLineup').isVisible()) {
      await page.getByRole('button',{name:'Choose mobile module lineup',exact:true}).click();
      await page.getByRole('button',{name:'View check-ins: All stations',exact:true}).click();
    }

    await page.waitForTimeout(500);
    const overflow=await page.locator('#crew').evaluate(el=>{const r=el.getBoundingClientRect();return [...el.querySelectorAll('.checkins-station')].some(e=>e.getBoundingClientRect().right>innerWidth+1 || e.getBoundingClientRect().left< -1);});
    assert.equal(overflow,false,'cards fit mobile viewport');
    await page.screenshot({path:path.join(out,'overview-mobile.png'),fullPage:false});
    await page.setViewportSize({width:1920,height:1080});await page.waitForTimeout(400);
    await page.screenshot({path:path.join(out,'overview-wide.png'),fullPage:true});
    assert.deepEqual(errors.filter(error=>/checkins-overview|module-workspace|site-crew-detail/.test(error.stack||'')),[]);
    fs.writeFileSync(path.join(out,'verification.json'),JSON.stringify({passed:true,stations:20,areas:6,viewports:[1440,390,1920],checks:['headcounts','empty station','canonical identity','area filtering','keyboard detail','return area and focus','help and overdue','provisional','escaping','service unavailable','refresh recovery','responsive containment'],pageErrors:errors},null,2));
    console.log('PASS: 20 stations; six area links; accurate counts; detail/back; keyboard; attention, empty, unavailable and recovery states; desktop/mobile.');
  } finally {await browser.close();server.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});

