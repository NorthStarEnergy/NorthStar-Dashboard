const {chromium}=require('playwright');
const http=require('node:http'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..');
(async()=>{
 const server=http.createServer((req,res)=>{const file=path.resolve(root,'.'+new URL(req.url,'http://local').pathname);if(!file.startsWith(root+path.sep)||!['.html','.js','.css','.svg','.png','.ico','.json'].includes(path.extname(file))){res.writeHead(404);return res.end();}fs.readFile(file,(e,d)=>{res.writeHead(e?404:200,{'Content-Type':{'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json'}[path.extname(file)]||'application/octet-stream'});res.end(e?'':d);});});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const browser=await chromium.launch({channel:'msedge',headless:true});
 try{const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.stack));
  await page.route('**/api/**',async route=>{const url=new URL(route.request().url());let data={};if(url.pathname==='/api/auth/session')data={required:false};else if(url.pathname==='/api/checkins'||url.pathname==='/api/checkins/history')data=[];else if(url.pathname==='/api/sites')data={sites:[]};else if(url.pathname==='/api/profile/crew-layout')data={positions:{}};else if(url.pathname==='/api/weather')data={stations:[]};else if(url.pathname==='/api/market-prices')data={nodes:{}};else if(url.pathname==='/api/scada')data={feeds:[],readings:[]};else if(url.pathname==='/api/events/register')data={items:[],total:0};else if(url.pathname==='/api/chat/messages')data={messages:[]};else if(url.pathname==='/api/alerts')data=[];else if(url.pathname==='/api/uwpc/requests')data={requests:[],operators:[],actor:'Fixture',correspondence:[]};else if(url.pathname==='/api/incident-library/catalog')data={available:false,readOnly:true,caseCount:0,categories:[],years:[],source:{}};else if(url.pathname==='/api/incident-library')data={available:false,page:1,limit:60,total:0,pages:0,records:[],source:{}};else if(url.pathname==='/api/service-requests/catalog')data={available:false,readOnly:true,recordCount:0,openCount:0,statuses:[],source:{}};else if(url.pathname==='/api/service-requests')data={available:false,page:1,limit:75,total:0,pages:0,records:[],source:{}};else if(url.pathname==='/api/ai/knowledge')data={sites:[]};else if(url.pathname==='/api/ai/workspace')data={projects:[],conversations:[]};else if(url.pathname==='/api/console/status')data={stations:[],sites:null,actor:'Fixture'};else if(url.pathname==='/api/console/feed')data={tasks:[],alarms:[],recent:[]};else if(url.pathname.startsWith('/api/console/'))data={items:[],nextCursor:null};await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(data)});});
  await page.goto(`http://127.0.0.1:${server.address().port}/northstar-clean.html`);await page.waitForSelector('.northstar-ai-menu-toggle');
  const out=path.join(root,'outputs/change-coordinator/agent-fixed-dashboard-20261015');fs.mkdirSync(out,{recursive:true});
  const geometry=()=>page.evaluate(()=>Object.fromEntries(['#nsStatusBar','#nsStatusBar [data-status="crew"]','#nsStatusBar [data-status="events"]'].map(s=>{const r=document.querySelector(s).getBoundingClientRect();return [s,[r.x,r.y,r.width,r.height]]})));
  const results=[];
  for(const width of [1440,1024]){
    await page.setViewportSize({width,height:1000});
    await page.locator('#sideNav [data-tab="overview"]').click();await page.waitForTimeout(500);
    const before=await geometry();
    const stored=await page.evaluate(()=>localStorage.getItem('northstarStatusLayoutV1'));
    let assistantGeometry;
    const entries=width>1050?['#sideNav [data-tab="assistant"]','.brand-home-control','.northstar-ai-menu-toggle']:['#sideNav [data-tab="assistant"]','.northstar-ai-menu-toggle'];
    for(const entry of entries){
      await page.locator('#sideNav [data-tab="overview"]').click();
      await page.locator(entry).click();await page.waitForTimeout(400);
      assert.equal(await page.locator('#assistant').evaluate(e=>e.classList.contains('active')),true);
      assert.equal(await page.locator('#assistantWorkspace .ai-assistant-layout > .ai-assistant-sidebar').count(),1);
      assert.equal(await page.locator('.app>aside>.ai-assistant-sidebar').count(),0);
      assert.deepEqual(await geometry(),before,`${width} ${entry}: fixed dashboard stays in place`);
      const box=await page.locator('#assistantWorkspace').boundingBox();
      if(assistantGeometry)assert.deepEqual(box,assistantGeometry,'all entry points share the Agent view');else assistantGeometry=box;
      assert.equal(await page.evaluate(()=>localStorage.getItem('northstarStatusLayoutV1')),stored,'saved fixed layout preserved');
    }
    await page.reload();await page.waitForSelector('#assistant.active');await page.waitForTimeout(700);
    assert.deepEqual(await geometry(),before,'reload retains fixed dashboard geometry');
    await page.screenshot({path:path.join(out,`agent-${width}.png`)});
    results.push({width,fixed:before,entryPoints:entries.length,reload:'PASS'});
  }
  assert.deepEqual(errors,[]);fs.writeFileSync(path.join(out,'browser-evidence.json'),JSON.stringify(results,null,2));console.log(JSON.stringify({agentNavigation:'PASS',stationaryFixedDashboard:'PASS',results,pageErrors:errors.length}));
 }finally{await browser.close();server.close();}
})().catch(e=>{console.error(e);process.exitCode=1});
