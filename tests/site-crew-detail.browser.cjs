/* Actual dashboard, synthetic API records, no live backend writes. */
const {chromium}=require('playwright');
const http=require('node:http'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),out=path.join(root,'outputs','station-checkins');
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
    // Test the actual Overview station click-through.
    await page.locator('#staffGroups .staff-group[data-site="Island Falls"] h3').click();
    await page.waitForFunction(()=>document.querySelector('#siteCrewPeople').textContent.includes('Fixture Active'));
    assert.equal(await page.locator('#siteCrewWorkspace').isVisible(),true);
    assert.equal(await page.locator('#crew .crew-layout').isVisible(),false);
    const text=await page.locator('#siteCrewPeople').innerText();
    for(const value of ['Fixture Active','***-***-0123','0.00000, -81.12345','LAST ACTIVITY','TIME ON SITE','120 minutes','Fixture visit notes'])assert.ok(text.includes(value),value);
    assert.ok(!text.includes('Fixture Previous')&&!text.includes('Other Station Worker'));
    await page.waitForFunction(()=>document.querySelector('#siteCrewHistory').textContent.includes('checked-in'));
    const boxes=await Promise.all(['#siteCrewWorkspace','#siteCrewWorkspace .site-crew-columns','#siteCrewWorkspace .site-crew-panel:first-child','#siteCrewWorkspace .site-crew-panel:last-child'].map(selector=>page.locator(selector).boundingBox()));
    assert.ok(Math.abs(boxes[0].width-boxes[1].width)<2,'panels use complete workspace width');
    assert.ok(await page.locator('#siteCrewWorkspace').evaluate(el=>Math.abs(el.getBoundingClientRect().width-el.closest('.section').getBoundingClientRect().width)<3),'workspace fills section width');
    await page.locator('#siteCrewWorkspace').evaluate(el=>el.style.setProperty('width','670px','important'));
    await page.waitForFunction(()=>document.querySelector('#siteCrewWorkspace').style.width==='100%');
    assert.ok(Math.abs(boxes[2].y-boxes[3].y)<2&&boxes[3].x>boxes[2].x,'active left, history right');
    fs.mkdirSync(out,{recursive:true});await page.locator('#siteCrewWorkspace').screenshot({path:path.join(out,'station-detail.png')});
    const priorDate=await page.evaluate(value=>{const d=new Date(value);return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;},old);
    await page.locator('#siteCrewDate').fill(priorDate);await page.locator('#siteCrewDate').dispatchEvent('change');
    await page.waitForFunction(()=>document.querySelector('#siteCrewHistory').textContent.includes('Fixture Previous'));
    assert.ok(!(await page.locator('#siteCrewHistory').innerText()).includes('Fixture Active'));
    await page.locator('#siteCrewHistory details summary').click();assert.match(await page.locator('#siteCrewHistory').innerText(),/CHECKED OUT/);
    await page.locator('#siteCrewAddWorker').click();assert.equal(await page.locator('#siteWorkerDialog').isVisible(),true);
    assert.equal(await page.locator('#siteWorkerSite').inputValue(),'Island Falls');
    await page.locator('#siteWorkerName').fill('Fixture New');await page.locator('#siteWorkerKind').selectOption('Contractor');
    await page.locator('#siteWorkerSubmit').click();assert.match(await page.locator('#siteWorkerReply').innerText(),/company/);assert.equal(posted,null);
    await page.locator('#siteWorkerCompany').fill('Fixture Contractor');await page.locator('#siteWorkerPhone').fill('4165550100');
    failPost=true;await page.locator('#siteWorkerSubmit').click();await page.waitForFunction(()=>document.querySelector('#siteWorkerReply').textContent.includes('Fixture validation error'));
    failPost=false;await page.locator('#siteWorkerSubmit').click();await page.waitForFunction(()=>!document.querySelector('#siteWorkerDialog').open);
    assert.equal(posted.site,'Island Falls');assert.equal(posted.contactPhone,'4165550100');
    await page.waitForFunction(()=>document.querySelector('#siteCrewPeople').textContent.includes('Fixture New'));
    await page.setViewportSize({width:600,height:900});
    const left=await page.locator('#siteCrewWorkspace .site-crew-panel:first-child').boundingBox(),right=await page.locator('#siteCrewWorkspace .site-crew-panel:last-child').boundingBox();assert.ok(right.y>left.y,'mobile stacks panels');
    await page.locator('#siteCrewClose').click();assert.equal(await page.locator('#siteCrewWorkspace').isVisible(),false);
    assert.equal(await page.locator('#crew .crew-layout').isVisible(),true);
    assert.deepEqual(errors.filter(error=>error.stack?.includes('site-crew-detail.js')),[]);
    console.log('PASS: Overview navigation, full-width columns, worker data, prior-date history, modal validation/save/error, refresh, mobile, back navigation.');
  } finally {await browser.close();server.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
