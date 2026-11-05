const {chromium}=require('playwright');
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),out=path.join(root,'outputs/field-roster');
const owned=new Set(['northstar-clean.html','site-crew-detail.js','field-roster.js','field-roster.css']);
(async()=>{
const server=http.createServer((req,res)=>{const name=decodeURIComponent(new URL(req.url,'http://local').pathname).slice(1),base=owned.has(name)?root:root,file=path.resolve(base,name);if(!file.startsWith(base+path.sep)||!['.html','.js','.css','.svg','.png','.ico','.json'].includes(path.extname(file))){res.writeHead(404);return res.end();}fs.readFile(file,(e,d)=>{res.writeHead(e?404:200,{'Content-Type':{'.html':'text/html','.js':'text/javascript','.css':'text/css'}[path.extname(file)]||'application/octet-stream'});res.end(e?'':d);});});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const browser=await chromium.launch({channel:'msedge',headless:true});
try{
const page=await browser.newPage({viewport:{width:1600,height:1000}}),errors=[],actions=[];page.on('pageerror',e=>errors.push(e.message));
const iso=new Date().toISOString();const rows=[{id:'a',name:'Henry Adams',site:'Island Falls',kind:'Contractor',company:'Henry Corporation',status:'on-site',checkedIn:iso,lastHeard:iso,notes:'[Crew contact] Inspection'},{id:'b',name:'Jane Wilson',site:'Island Falls',kind:'Contractor',company:'Henry Corporation',status:'on-site',checkedIn:iso,lastHeard:iso},{id:'c',name:'Morgan Lee',site:'Kenora',kind:'Northstar',status:'checked-out',checkedIn:iso,checkedOutAt:iso,lastHeard:iso},{id:'p',name:'Pending Worker',site:'Kenora',kind:'Northstar',status:'provisional',checkedIn:iso,lastHeard:iso}];
let fail=false,failRead=false;
await page.route('**/api/**',async route=>{const req=route.request(),u=new URL(req.url());let data={},status=200;
if(u.pathname==='/api/auth/session')data={required:false};
else if(u.pathname==='/api/checkins'&&req.method()==='POST'){const body=req.postDataJSON();actions.push(body);rows.push({...body,id:'new',status:'on-site',checkedIn:iso,lastHeard:iso});data={id:'new'};status=201;}
else if(u.pathname==='/api/checkins'){data=rows;status=failRead?503:200;}
else if(u.pathname==='/api/checkins/history')data=[{checkinId:'a',worker:'Henry Adams',site:'Island Falls',event:'checked-in',at:iso}];
else if(u.pathname.startsWith('/api/checkins/')){actions.push({path:u.pathname,method:req.method(),body:req.postData()});status=fail?503:200;if(!fail&&req.method()==='DELETE'){const r=rows.find(r=>u.pathname.endsWith('/'+r.id));r.status='checked-out';r.checkedOutAt=iso;}if(!fail&&u.pathname.endsWith('/provisional'))rows.find(r=>r.id==='p').status='on-site';}
else if(u.pathname==='/api/sites')data={sites:[]};
else if(u.pathname==='/api/profile/crew-layout')data={positions:{}};
else if(u.pathname==='/api/weather')data={stations:[]};
else if(u.pathname==='/api/market-prices')data={nodes:{}};
else if(u.pathname==='/api/scada')data={feeds:[],readings:[]};
else if(u.pathname==='/api/events/register')data={items:[],total:0};
else if(u.pathname==='/api/chat/messages')data={messages:[]};
else {data={};status=503;}
await route.fulfill({status,contentType:'application/json',body:JSON.stringify(data)});});
await page.goto(`http://127.0.0.1:${server.address().port}/northstar-clean.html`);
await page.waitForFunction(()=>window.NorthstarModules?.registry.has('crew:field-roster'));
await page.evaluate(()=>NorthstarModules.open('crew:field-roster'));
await page.locator('#fieldRoster [data-fr-id=a]').waitFor();
assert.equal(await page.locator('#fieldRoster [data-fr-id]').count(),3);
assert.match(await page.locator('#fieldRoster [data-fr-id=a]').innerText(),/Henry Adams — Henry Corporation · crew contact/);
assert.equal(await page.locator('#fieldRoster [data-fr-id=c]').count(),0);
assert.ok(await page.locator('#fieldRoster').isVisible());
assert.ok(await page.evaluate(()=>NorthstarModules.registry.has('crew:crew-module-0')),'existing station module retained');
const heights=await page.locator('#fieldRoster [data-fr-id]').evaluateAll(els=>els.map(el=>el.getBoundingClientRect().height));assert.ok(heights.every(h=>h<=31),JSON.stringify(heights));
fs.mkdirSync(out,{recursive:true});await page.locator('#fieldRoster').screenshot({path:path.join(out,'field-roster.png')});
await page.locator('#fieldRoster [data-fr-id=a] [data-fr-col=company]').dblclick();await page.locator('#workerProfileSnapshot[open]').waitFor();assert.match(await page.locator('#workerProfileSnapshot').innerText(),/Henry Adams/);await page.locator('.worker-profile-close').click();
await page.locator('#fieldRoster [data-fr-id=a] .fr-person').focus();await page.keyboard.press('Enter');await page.locator('#workerProfileSnapshot[open]').waitFor();await page.keyboard.press('Escape');
await page.locator('#fieldRoster input[type=search]').fill('Jane');assert.equal(await page.locator('#fieldRoster [data-fr-id]').count(),1);await page.locator('#fieldRoster input[type=search]').fill('');
await page.locator('#fieldRoster [data-fr-id=a] [data-fr-action=in]').click();await page.waitForFunction(()=>!document.querySelector('#fieldRoster [data-fr-id=a] [data-fr-action=in]').disabled);assert.ok(actions.some(a=>a.path==='/api/checkins/a/heartbeat'&&a.method==='POST'));
fail=true;await page.locator('#fieldRoster [data-fr-id=b] [data-fr-action=out]').click();await page.waitForFunction(()=>document.querySelector('#fieldRoster [role=status]').textContent.includes('Action failed'));assert.equal(await page.locator('#fieldRoster [data-fr-id=b]').count(),1);
fail=false;await page.locator('#fieldRoster [data-fr-id=b] [data-fr-action=out]').click();await page.waitForFunction(()=>!document.querySelector('#fieldRoster [data-fr-id=b]'));
await page.locator('#fieldRoster select[aria-label=Presence]').selectOption('all');assert.equal(await page.locator('#fieldRoster [data-fr-id]').count(),4);
await page.locator('#fieldRoster [data-fr-id=c] [data-fr-action=return]').click();assert.equal(await page.locator('#siteWorkerName').inputValue(),'Morgan Lee');await page.locator('#siteWorkerCrewContact').check();await page.locator('#siteWorkerSubmit').click();await page.waitForFunction(()=>!document.querySelector('#siteWorkerDialog').open);assert.ok(actions.some(a=>a.name==='Morgan Lee'&&a.notes==='[Crew contact] '));
await page.locator('#fieldRoster [data-fr-id=p] [data-fr-action=accept]').click();await page.waitForFunction(()=>!!document.querySelector('#fieldRoster [data-fr-id=p] [data-fr-action=in]'));
await page.locator('#fieldRoster .fr-columns summary').click();await page.locator('#fieldRoster .fr-columns input[value=out]').uncheck();assert.equal(await page.locator('#fieldRoster thead [data-fr-col=out]').isVisible(),false);await page.locator('#fieldRoster .fr-columns summary').click();
failRead=true;await page.locator('#fieldRoster [data-fr-refresh]').click();await page.waitForFunction(()=>document.querySelector('#fieldRoster [role=status]').textContent.includes('stale'));assert.ok(await page.locator('#fieldRoster [data-fr-id=a] [data-fr-action=out]').isDisabled());failRead=false;await page.locator('#fieldRoster [data-fr-refresh]').click();await page.waitForFunction(()=>!document.querySelector('#fieldRoster [data-fr-id=a] [data-fr-action=out]').disabled);
await page.reload();await page.waitForFunction(()=>window.NorthstarModules?.registry.has('crew:field-roster'));await page.evaluate(()=>NorthstarModules.open('crew:field-roster'));await page.locator('#fieldRoster [data-fr-id=a]').waitFor();assert.equal(await page.locator('#fieldRoster thead [data-fr-col=out]').isVisible(),false);
for (const [area,count] of [['Fort Frances',4],['Kenora',3],['Iroquois',3],['Island',1],['Kap',4],['Quebec',5]]) {
  await page.locator(`[data-checkins-area="${area}"]`).click();
  assert.equal(await page.locator('.checkins-station').count(),count);
  assert.equal(await page.locator('#checkinsAreaTitle').textContent(),area);
  await page.locator('[data-open-module="crew:field-roster"]').click();
  assert.ok(await page.locator('#fieldRoster').isVisible());
}
await page.setViewportSize({width:700,height:800});await page.getByRole('button',{name:'Choose mobile module lineup',exact:true}).click();await page.locator('#nsPhonePicker input[value="crew:field-roster"]').check();await page.locator('#nsPhonePicker li').filter({has:page.locator('button[aria-label="View Active Workers"]')}).last().locator('button[aria-label="View Active Workers"]').click();await page.locator('#fieldRoster').waitFor({state:'visible'});assert.ok((await page.locator('#fieldRoster [data-fr-id=a]').boundingBox()).height<=31);await page.locator('#fieldRoster').screenshot({path:path.join(out,'field-roster-narrow.png')});
assert.deepEqual(errors,[]);fs.writeFileSync(path.join(out,'verification.json'),JSON.stringify({passed:true,checks:['module discovery and existing station module','all six area links and return to roster','one row per person <=31px','contact label','station grouping','search','double-click and keyboard profile','heartbeat','checkout success and failure','all visits','new visit with explicit crew contact','provisional acceptance','column persistence across reload','stale feed disables actions','narrow single-line rows'],errors},null,2));console.log('PASS: 15 roster browser checks; no page errors.');
}finally{await browser.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1});
