/* Actual dashboard, synthetic API records, no live backend writes. */
const {chromium}=require('playwright');
const http=require('node:http'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),out=path.join(root,'outputs','change-coordinator','authenticated-overview-popout-20261013');
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
    await page.setViewportSize({width:1691,height:1000});
    await page.goto(`http://127.0.0.1:${server.address().port}/northstar-clean.html?nsStatusWindow=1#overview`);
    const results=[];
    for(const requested of [1691,1720,1800]){
      await page.waitForSelector('[data-fixed-visible]');
      await page.locator('.layout-edit-toggle').click();
      await page.locator('[data-view-width]').fill(String(requested));
      await page.locator('[data-view-width]').press('Tab');
      await page.waitForTimeout(200);
      const before=await page.locator('#nsStatusWorkers').evaluate(el=>el.getBoundingClientRect().width);
      assert.equal(before,requested,'requested width rendered before Save');
      await page.locator('.layout-save').click();
      await page.reload();await page.waitForSelector('[data-fixed-visible]');
      await page.locator('.layout-edit-toggle').click();
      const value=await page.locator('[data-view-width]').inputValue();
      const after=await page.locator('#nsStatusWorkers').evaluate(el=>el.getBoundingClientRect().width);
      assert.equal(value,String(requested),'width input survives Save/reload');
      assert.equal(after,requested,'rendered width survives Save/reload');
      results.push({requested,before,after,input:value});
      await page.locator('.layout-edit-toggle').click();
    }
    assert.deepEqual(errors,[]);fs.writeFileSync(path.join(out,'width-fixture.json'),JSON.stringify({viewportWidth:1691,results,errors},null,2));
    console.log('PASS: popup width1691→1720→1800 persists input and rendered width through Save/reload.');
  }finally{await browser.close();server.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
