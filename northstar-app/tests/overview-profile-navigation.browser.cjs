/* Actual dashboard, synthetic API records, no live backend writes. */
const {chromium}=require('playwright');
const http=require('node:http'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),out=process.env.NORTHSTAR_OVERVIEW_TEST_OUTPUT||path.join(root,'outputs','change-coordinator','overview-profile-navigation-20261013');
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
      {id:'closed',name:'Fixture Active',site:'Island Falls',kind:'Northstar',status:'checked-out',checkedIn:old,lastHeard:old,checkedOutAt:old},
      {id:'peer',name:'Fixture Coworker',site:'Island Falls',kind:'Contractor',company:'Second Crew',status:'on-site',checkedIn:iso,lastHeard:iso},
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
    const person=page.locator('#staffGroups [data-worker-profile="active"]');
    await person.click();
    const dialog=page.locator('#workerProfileSnapshot');
    await page.waitForFunction(()=>document.querySelector('.worker-profile-history')?.textContent.includes('checked-in'));
    assert.equal(await dialog.isVisible(),true);
    const profileText=await dialog.innerText();
    for(const value of ['Fixture Active','***-***-0123','0.00000, -81.12345','LAST SEEN','LAST APP ACCESS','Not recorded separately','Fixture Coworker','not confirm','Fixture visit notes','Operator entry'])assert.ok(profileText.includes(value),value);
    assert.ok(!profileText.includes('Other Station Worker'));
    assert.ok(!profileText.includes('checked-out'));
    assert.equal(await page.locator('#siteCrewWorkspace').isVisible(),false);
    const close=dialog.getByRole('button',{name:'Close profile'}),closeRect=await close.boundingBox(),rect=await dialog.boundingBox();
    assert.ok(closeRect.x>rect.x+rect.width/2 && closeRect.y<rect.y+70,'X top right');
    await dialog.screenshot({path:path.join(out,'profile-fixture.png')});
    await close.click();
    assert.equal(await dialog.isVisible(),false);
    assert.equal(await person.evaluate(el=>el===document.activeElement),true,'Focus returned to person');
    await person.press('Enter');await page.waitForFunction(()=>document.querySelector('.worker-profile-history')?.textContent.includes('checked-in'));
    await page.keyboard.press('Escape');assert.equal(await dialog.isVisible(),false);
    const styles=await page.locator('#staffGroups .staff-crew').evaluateAll(nodes=>nodes.map(el=>({shadow:getComputedStyle(el).boxShadow,tint:getComputedStyle(el.querySelector('.contractor-heading')).backgroundColor,color:getComputedStyle(el.querySelector('.contractor-heading')).color,overflow:el.scrollWidth>el.clientWidth+1})));
    assert.ok(styles.length>=3);
    assert.ok(styles.every(x=>x.shadow.includes('2px')&&!['rgba(0, 0, 0, 0)','transparent'].includes(x.tint)&&!x.overflow),JSON.stringify(styles));
    assert.ok(new Set(styles.map(x=>x.color)).size>1,'Companies distinct');
    await page.locator('#overviewStaff').screenshot({path:path.join(out,'crew-fixture.png')});
    const geometry=await page.locator('#overviewStaff').boundingBox();
    await page.locator('#staffGroups .staff-group[data-site="Island Falls"] h3').click();
    await page.waitForSelector('#siteCrewWorkspace:visible');
    assert.match(await page.locator('#siteCrewTitle').innerText(),/Island Falls/i);
    assert.equal(await page.locator('#crew').isVisible(),true);
    await page.reload();
    await page.waitForSelector('#crew:visible');
    await page.waitForTimeout(1500);
    await page.locator('#sideNav [data-tab="overview"]').click();
    await page.locator('.gs-card[data-module-id="site:calm-lake"]').click();
    await page.waitForSelector('#operationsSite-calm-lake:visible');
    assert.equal(await page.locator('#generatingStationDetails').isVisible(),false);
    await page.locator('#sideNav [data-tab="overview"]').click();
    const after=await page.locator('#overviewStaff').boundingBox();
    assert.ok(Math.abs(after.width-geometry.width)<2 && Math.abs(after.height-geometry.height)<2,'Worker geometry preserved after reload/navigation');
    // Existing operational buttons remain independent; synthetic backend only.
    await page.locator('#staffGroups [data-manual-checkin="active"]').click();
    assert.equal(await dialog.isVisible(),false);
    assert.equal(await page.locator('#operationsSite-island-falls').isVisible(),false);
    // A failed history read leaves available profile fields visible.
    await page.route('**/api/checkins/history?**',route=>route.fulfill({status:503,body:'{}'}));
    await person.click();
    await page.waitForFunction(()=>document.querySelector('.worker-profile-history')?.textContent.includes('History unavailable'));
    assert.match(await dialog.innerText(),/Fixture Active/);
    // Keep the profile open while the phone lineup switches the source module.
    await page.setViewportSize({width:390,height:844});
    await page.waitForFunction(()=>document.querySelector('.worker-profile-history')?.textContent.includes('History unavailable'));
    const mobile=await dialog.boundingBox();assert.ok(mobile.x>=0 && mobile.x+mobile.width<=391);
    assert.equal(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth+1),true,'No mobile horizontal overflow');
    await page.keyboard.press('Escape');
    fs.writeFileSync(path.join(out,'fixture-results.json'),JSON.stringify({passed:true,checks:['profile selected ID only','GPS zero coordinate and masked phone','last activity separate from unrecorded app access','co-presence qualification','X/Escape/focus return','company title tint and 2px border','station labels and tiles direct navigation','worker geometry survives reload; existing Operations landing restoration retained','operational buttons independent','history failure preserves profile','390px dialog fits'],styles,errors},null,2));
    console.log('PASS: Overview station navigation, profile snapshot, crew styles, persistence, keyboard, history failure and mobile bounds');
  } finally { await browser.close();server.close(); }
})().catch(error=>{console.error(error);process.exitCode=1;});
