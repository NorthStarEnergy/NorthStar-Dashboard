const {chromium}=require('playwright');
const http=require('node:http'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),out=process.env.NORTHSTAR_REGRESSION_OUTPUT||path.join(root,'outputs/change-coordinator/four-agent-integration-20261013');
const overlay=new Set(["dashboard-chrome.js", "lamination-dashboard.js", "market-trends.js", "market-workspace.js", "mobile-dashboard.js", "northstar-clean.html", "one-line-editor-ui.js", "operator-login.html", "operator-session.js", "overview-modules.js", "demo-mode.css"]);
const fixtureCode = `import ast,json
from pathlib import Path
import northstar_demo_roster
m=ast.parse(Path('ieso_backend.py').read_text(encoding='utf-8-sig'))
a=next(n for n in m.body if isinstance(n,ast.Assign) and any(isinstance(t,ast.Name) and t.id=='PLATFORM_DEMO_STATION_NAMES' for t in n.targets))
names={ast.literal_eval(k):ast.literal_eval(v) for k,v in zip(a.value.keys,a.value.values) if isinstance(k,ast.Constant)}
print(json.dumps(northstar_demo_roster.roster(names,'system')))`;
const rows=JSON.parse(require('node:child_process').execFileSync('python',['-c',fixtureCode],{cwd:root,encoding:'utf8'}));
fs.mkdirSync(out,{recursive:true});
(async()=>{
 const server=http.createServer((req,res)=>{const file=path.resolve(root,'.'+new URL(req.url,'http://localhost').pathname);if(!file.startsWith(root+path.sep)||!['.html','.js','.css','.svg','.png','.ico'].includes(path.extname(file))){res.writeHead(404);return res.end();}fs.readFile(overlay.has(path.relative(root,file))?file:path.join(root,path.relative(root,file)),(err,data)=>{res.writeHead(err?404:200,{'Content-Type':{'.html':'text/html','.js':'text/javascript','.css':'text/css'}[path.extname(file)]||'application/octet-stream'});res.end(err?'':data);});});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const browser=await chromium.launch({channel:'msedge',headless:true});
 try {
 const page=await browser.newPage({viewport:{width:1920,height:1080}});
 await page.context().route('**/api/**',route=>{const p=new URL(route.request().url()).pathname;let body=[];if(p==='/api/checkins/history')return route.fulfill({status:403,contentType:'application/json',body:'{"error":"Not available for this account"}'});if(p==='/api/auth/session')body={required:true,authenticated:true,username:'demo',role:'platform_demo'};else if(p==='/api/checkins')body=rows;else if(p==='/api/sites')body={stations:[]};else if(p==='/api/market-prices')body={nodes:{},updated:new Date().toISOString()};else if(p==='/api/weather')body={stations:[]};else if(p==='/api/profile/crew-layout')body={positions:{}};return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(body)});});
 await page.goto(`http://127.0.0.1:${server.address().port}/northstar-clean.html`);
 await page.waitForFunction(()=>document.querySelectorAll('#staffGroups .staff-group').length===20);
 const check=async()=>page.evaluate(()=>({stations:NorthStarSites.stationNames(),groups:[...document.querySelectorAll('#staffGroups .staff-group')].map(e=>({site:e.dataset.site,count:e.querySelectorAll('.staff-row').length})),crew:document.querySelectorAll('#fieldRoster [data-fr-id]').length,tracker:document.querySelectorAll('#mobileWorkers .mobile-worker').length,overview:document.querySelectorAll('#overviewTrackerWorkers .overview-tracker-worker').length,heading:document.querySelector('#staffHeading').textContent,status:document.querySelector('#mobileFeedStatus').textContent}));
 await page.waitForFunction(()=>document.querySelectorAll('#mobileWorkers .mobile-worker').length===40 && document.querySelectorAll('#fieldRoster [data-fr-id]').length===40);
 const result=await check();assert.equal(result.groups.length,20);assert.equal(result.groups.filter(g=>g.count>0).length,16);assert.equal(result.groups.filter(g=>g.count===1||g.count===2).length,10);assert.equal(result.groups.reduce((n,g)=>n+g.count,0),40);assert.equal(result.crew,40);assert.equal(result.tracker,40);assert.ok(result.overview>0);assert.match(result.heading,/40 ACTIVE/);assert.equal(result.status,'REFRESH 30 SEC');
 assert.equal(await page.locator('#mobileWorkers [data-history]').count(),0);
 const labels=await page.evaluate(()=>[document.body.innerText,...[...document.querySelectorAll('[title],[aria-label]')].filter(el=>el.getBoundingClientRect().width&&el.getBoundingClientRect().height).map(el=>[el.title,el.getAttribute('aria-label')].join(' '))].join(' '));
 assert.doesNotMatch(labels,/\b(simulated|demo|demonstration|mock data)\b/i);
 assert.equal(await page.locator('#staffGroups .staff-actions').first().isVisible(),false);
 const person=page.locator('#staffGroups [data-worker-profile]').first();
 await person.click();
 await page.waitForFunction(()=>document.querySelector('.worker-profile-history')?.textContent==='History unavailable for this account.');
 assert.equal(await page.locator('#workerProfileSnapshot').isVisible(),true);
 assert.match(await page.locator('#workerProfileSnapshot').innerText(),/PROFILE SNAPSHOT/);
 assert.match(await page.locator('#workerProfileSnapshot').innerText(),/Not recorded separately/);
 assert.equal(await page.locator('#workerProfileSnapshot button').count(),1,'No profile mutation controls');
 await page.locator('#workerProfileSnapshot').screenshot({path:path.join(out,'account-profile-fixture.png')});
 await page.keyboard.press('Escape');
 assert.equal(await person.evaluate(el=>el===document.activeElement),true);
 await page.screenshot({path:path.join(out,'crew-occupancy.png')});
 await page.reload();await page.waitForFunction(()=>document.querySelectorAll('#staffGroups .staff-row').length===40);assert.deepEqual((await check()).groups,result.groups);
 await page.setViewportSize({width:390,height:844});await page.waitForTimeout(400);assert.equal((await check()).groups.reduce((n,g)=>n+g.count,0),40);
 await page.screenshot({path:path.join(out,'crew-occupancy-mobile.png')});
 await page.evaluate(()=>{window.NORTHSTAR_PLATFORM_DEMO=false;const now=new Date().toISOString();const rows=[{id:'fixture-worker',name:'Test Worker',site:'Island Falls',siteId:'site:island-falls',kind:'Northstar',status:'on-site',checkedIn:now,lastHeard:now}];renderStaff(rows);renderCrewRows(rows);});
 assert.deepEqual(await page.locator('#staffGroups .staff-group').evaluateAll(nodes=>nodes.map(n=>n.dataset.site)),['Island Falls']);
 assert.equal(await page.locator('[data-checkins-site="site:island-falls"] .checkins-card-head strong').textContent(),'Island Falls');
 fs.writeFileSync(path.join(out,'browser-evidence.json'),JSON.stringify({...result,normalOperator:'original Island Falls roster preserved'},null,2));
 console.log('PASS: 40 workers at 16/20 sites; 10 small crews; Crew/Tracker/Overview, reload, mobile, labels, read-only controls and operator rendering.');
 }finally{await browser.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1;});
