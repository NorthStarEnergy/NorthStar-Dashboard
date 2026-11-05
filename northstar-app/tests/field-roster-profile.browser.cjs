/* Actual dashboard, synthetic API records, no live backend writes. */
const {chromium}=require('playwright');
const http=require('node:http'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),out=path.join(root,'outputs','field-roster','profile-regression');
(async()=>{
  const server=http.createServer((req,res)=>{
    const name=new URL(req.url,'http://local').pathname.slice(1),base=['northstar-clean.html','site-crew-detail.js','field-roster.js','field-roster.css'].includes(name)?root:root;const file=path.resolve(base,name);
    if(!file.startsWith(base+path.sep)||!['.html','.js','.css','.svg','.png','.ico','.json'].includes(path.extname(file))){res.writeHead(404);return res.end();}
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
    rows.find(row=>row.id==='peer').name='Fixture Active';
    for(const detached of [false,true]){
      await page.goto(`http://127.0.0.1:${server.address().port}/northstar-clean.html${detached?'?nsStatusWindow=1':''}#overview`);
      const person=page.locator('#staffGroups [data-worker-profile="active"]');
      await person.waitFor({state:'visible'});
      for(const closeWith of ['X','Escape']){
        await person.click();await page.waitForSelector('#workerProfileSnapshot[open]');
        await page.waitForFunction(()=>document.querySelector('.worker-profile-history')?.textContent.includes('checked-in'));
        const oldTrigger=await person.elementHandle();
        await page.evaluate(rows=>renderStaff(rows),rows);
        assert.equal(await oldTrigger.evaluate(el=>el.isConnected),false,'fixture really replaced the original trigger');
        if(closeWith==='X'){
          await page.evaluate(rows=>document.querySelector('#workerProfileSnapshot').addEventListener('close',()=>requestAnimationFrame(()=>renderStaff(rows)),{once:true}),rows);
          await page.getByRole('button',{name:'Close profile',exact:true}).click();
          await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
        }
        else await page.keyboard.press('Escape');
        await page.waitForFunction(()=>document.activeElement?.dataset.workerProfile==='active',{},{timeout:2000});
        assert.ok(await person.evaluate(el=>el===document.activeElement),'exact check-in focus restored after replacement');
        await page.locator('#staffGroups [data-worker-profile="peer"]').focus();
        await page.evaluate(rows=>renderStaff(rows),rows);
        assert.notEqual(await page.evaluate(()=>document.activeElement?.dataset.workerProfile),'active','does not steal focus after the user moves elsewhere');
      }
      await person.click();await page.waitForSelector('#workerProfileSnapshot[open]');
      await page.evaluate(rows=>renderStaff(rows.filter(row=>row.id!=='active')),rows);
      await page.keyboard.press('Escape');
      await page.waitForFunction(()=>document.activeElement?.matches('.staff-group[data-site="Island Falls"]>h3'));
      assert.notEqual(await page.evaluate(()=>document.activeElement?.dataset.workerProfile),'peer','never substitutes a same-name visit');
    }
    assert.deepEqual(errors,[]);
    fs.mkdirSync(out,{recursive:true});
    fs.writeFileSync(path.join(out,'focus-fixture.json'),JSON.stringify({surfaces:['Overview','station popout'],closeMethods:['X','Escape'],feedReplacement:true,afterMouseCloseFeedReplacement:true,noFocusStealAfterUserMoves:true,exactCheckinIdentity:true,removedVisitStationFallback:true,errors},null,2));
    console.log('PASS: Overview/popout profile X and Escape restore exact check-in focus after roster replacement; absent check-in falls back to station, never same-name visit.');
  }finally{await browser.close();server.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
