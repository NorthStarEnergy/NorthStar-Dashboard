const deadline=setTimeout(()=>{console.error('Fixture deadline exceeded');process.exit(1);},90000);deadline.unref();
/* Actual dashboard, synthetic API records, no live backend writes. */
const {chromium}=require('playwright');
const http=require('node:http'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),out=path.join(root,'outputs','change-coordinator','authenticated-overview-popout-20261013');
fs.mkdirSync(out,{recursive:true});
(async()=>{
  const server=http.createServer((req,res)=>{
    const file=path.resolve(root,'.'+new URL(req.url,'http://local').pathname);
    if(!file.startsWith(root+path.sep)||!['.html','.js','.css','.svg','.png','.ico','.json'].includes(path.extname(file))){res.writeHead(404);return res.end();}
    fs.readFile(file,(error,data)=>{res.writeHead(error?404:200,{'Content-Type':{'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json'}[path.extname(file)]||'application/octet-stream'});res.end(error?'':data);});
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  console.log('fixture server started');
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
    console.log('opening workers popout');
    await page.goto(`http://127.0.0.1:${server.address().port}/northstar-clean.html?nsStatusWindow=1#overview`);
    await page.waitForSelector('#staffGroups .staff-group[data-site="Island Falls"] h3');
    console.log('workers ready');
    const opened=page.waitForEvent('popup');
    await page.locator('#staffGroups .staff-group[data-site="Island Falls"] h3').click();
    const station=await opened;console.log('station popup URL',station.url());station.on('pageerror',error=>{errors.push({message:error.message});console.error('station page error',error.message);});
    await station.waitForSelector('#operationsSite-island-falls:visible');console.log('station content visible',await station.evaluate(()=>({owner:!!window.NorthstarWindowLayout,handles:document.querySelectorAll('.ns-popout-edge').length})));
    const launched=new URL(station.url());
    assert.equal(launched.searchParams.has('nsStatusWindow'),false,'module URL drops inherited worker window flag');
    assert.equal(launched.searchParams.get('nsModuleWindow'),'operations:site:island-falls');
    assert.equal(await station.locator('#nsStationWindow').count(),0,'no workers shell in station window');
    assert.equal(await station.locator('#operationsSite-island-falls').getAttribute('data-site-id'),'site:island-falls');
    assert.ok((await station.locator('#operationsSite-island-falls').innerText()).trim().length>20,'station body remains visible after duplicate heading is removed');
    assert.deepEqual(await station.locator('.ns-popout-toolbar [data-window-action]').allTextContents(),['−','□','×']);
    await station.setViewportSize({width:200,height:100});
    await station.waitForFunction(()=>document.querySelector('.ns-popout-frame').getBoundingClientRect().width<300);
    await station.setViewportSize({width:1440,height:1000});
    await station.waitForFunction(()=>document.querySelector('.ns-popout-frame').getBoundingClientRect().width>1400,{},{timeout:5000}).catch(async error=>{console.error('resize geometry',await station.evaluate(()=>({width:innerWidth,height:innerHeight,style:document.querySelector('.ns-popout-frame').getAttribute('style'),handles:document.querySelectorAll('.ns-popout-edge').length})));throw error;});
    const restoredBox=await station.locator('.ns-popout-frame').boundingBox();
    assert.ok(restoredBox.height>900,'full station height recovers after transient viewport shrink');
    await station.locator('.ns-popout-edge[data-edge="e"]').press('ArrowLeft');
    const manualBox=await station.locator('.ns-popout-frame').boundingBox();
    await station.setViewportSize({width:800,height:600});
    await station.waitForFunction(()=>document.querySelector('.ns-popout-frame').getBoundingClientRect().width<800);
    await station.setViewportSize({width:1440,height:1000});
    await station.waitForFunction(width=>Math.abs(document.querySelector('.ns-popout-frame').getBoundingClientRect().width-width)<1,manualBox.width);
    launched.searchParams.set('nsStatusWindow','1');
    console.log('opening legacy mixed URL');
    await station.goto(launched.href);
    await station.waitForSelector('#operationsSite-island-falls:visible');console.log('station content visible');
    const spacing=await station.locator('#operationsSite-island-falls').evaluate(el=>({padding:getComputedStyle(el).padding,header:getComputedStyle(el.querySelector('header')).display}));
    assert.equal(spacing.padding,'8px 12px');
    assert.equal(spacing.header,'none','duplicate inner plant title stays hidden');
    assert.equal(await station.locator('#nsStationWindow').count(),0,'explicit module target wins even on legacy mixed URL');
    assert.equal(await station.locator('body').evaluate(el=>el.classList.contains('ns-station-popout')),false);
    assert.equal(await station.locator('#operationsSite-island-falls').getAttribute('data-site-id'),'site:island-falls');
    assert.deepEqual(errors,[]);
    fs.writeFileSync(path.join(out,'station-route-fixture.json'),JSON.stringify({launchedModuleWindow:true,inheritedStatusFlagRemoved:true,legacyMixedUrlModulePrecedence:true,visibleFullStationContent:true,viewportShrinkRecovery:true,manualResizeRecovery:true,workersShellAbsent:true,toolbarSymbols:['−','□','×'],errors},null,2));
    console.log('closing station');
    await station.close();
    console.log('PASS: standalone workers station link renders full station; mixed legacy URL resolves to module, no workers shell; toolbar symbols correct.');
  }catch(error){console.error('Fixture step failed',error);throw error;}finally{await Promise.race([browser.close(),new Promise(resolve=>setTimeout(resolve,5000))]);server.closeAllConnections();server.close();}
})().then(()=>{clearTimeout(deadline);process.exit(0);},error=>{console.error(error);process.exit(1);});
