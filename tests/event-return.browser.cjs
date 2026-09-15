/* Isolated read-only fixtures: never requests the operational backend. */
const {chromium}=require('playwright');
const http=require('node:http'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),out=path.join(root,'outputs','event-return-fix');
const html=fs.readFileSync(path.join(root,'northstar-clean.html'),'utf8').replace(/\r\n/g,'\n');
assert.equal(html.match(/<script id="dashboard-style-guard">\n([\s\S]*?)<\/script>/)[1],fs.readFileSync(path.join(root,'scripts/dashboard-style-guard.js'),'utf8').replace(/\r\n/g,'\n'));
assert.ok(html.trimEnd().endsWith('</body>\n</html>'));
(async()=>{
 let mode='normal';const failed=new Set(),errors=[],requests=[];
 const server=http.createServer((req,res)=>{
  const url=new URL(req.url,'http://localhost'),file=path.resolve(root,'.'+url.pathname);
  if(!file.startsWith(root+path.sep)||!['.html','.js','.css','.svg','.png','.ico'].includes(path.extname(file))){res.writeHead(404);return res.end();}
  if(mode==='scriptfail' && url.pathname==='/module-workspace.js'){res.writeHead(503,{'Content-Type':'text/javascript'});return res.end('');}
  if(path.extname(file)==='.css'&&((mode==='transient'&&!failed.has(url.pathname))||(mode==='persistent'&&url.pathname==='/dashboard-polish.css'))){
   failed.add(url.pathname);requests.push({path:url.pathname,status:503});res.writeHead(503,{'Content-Type':'text/plain'});return res.end('Injected stylesheet failure');
  }
  fs.readFile(file,(error,data)=>{res.writeHead(error?404:200,{'Content-Type':{'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml'}[path.extname(file)]||'application/octet-stream','Cache-Control':'no-store'});res.end(error?'':data);});
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const origin=`http://127.0.0.1:${server.address().port}`;
 const browser=await chromium.launch({channel:'msedge',headless:true});
 const page=await browser.newPage({viewport:{width:1440,height:960}});
 page.on('pageerror',e=>errors.push(e.message));
 const now=new Date().toISOString(),event={eventId:'return-fixture',summary:'Event return regression fixture',occurredAt:now,severity:'info',category:'test',source:'Isolated fixture',eventType:'test',payload:{}};
 const fixtures={
  '/api/auth/session':{required:false},'/api/checkins':[], '/api/alerts':[],
  '/api/weather':{stations:[]},'/api/market-prices':{updated:now,nodes:{APIROQ:{rt:42,da:37,history:[],operations:{rtTransfer:12,dayAhead:10}}},ontario:{demand:15000,forecastDemand:15500}},
  '/api/events/register':{items:[event],total:1,snapshot:1,nextCursor:null,fetchedAt:now},
  '/api/events/detail':{event,history:{items:[event],total:1,nextCursor:null}},
 };
 await page.route('**/*',route=>{
  const url=new URL(route.request().url());
  if(url.origin!==origin)return route.abort();
  if(url.pathname.startsWith('/api/'))return route.fulfill({status:fixtures[url.pathname]?200:503,contentType:'application/json',body:JSON.stringify(fixtures[url.pathname]||{})});
  return route.continue();
 });
 const ready=async()=>{await page.waitForFunction(()=>document.documentElement.dataset.nsStyles==='ready'&&!!window.NorthstarModules&&document.querySelector('#sideNav .nav-icon'),{},{timeout:30000});await page.waitForTimeout(180);};
 const report=async selector=>{await page.locator(selector).first().click();await page.waitForSelector('#report:visible');assert.equal(await page.locator('#title').innerText(),event.summary);};
 const checkEvents=async()=>{
  await ready();assert.equal(await page.locator('.ns-module-window:visible').count(),1);
  assert.equal(await page.locator('#eventRegister:visible').count(),1);
  assert.equal(await page.locator('#overview:visible').count(),0);
  assert.equal(await page.locator('#dispatchClient:visible').count(),0,'Overview dispatch card must not leak into Events');
  assert.equal(await page.locator('.ns-section-shell:visible').count(),1);
  assert.equal(await page.locator('#sideNav [data-tab="logbook"]').getAttribute('class'),'active');
  assert.equal(await page.locator('#sideNav .nav-icon').first().evaluate(e=>e.getBoundingClientRect().width),17);
 };
 fs.mkdirSync(out,{recursive:true});
 try{
  await page.goto(origin+'/northstar-clean.html');await ready();
  const saved=await page.evaluate(()=>JSON.stringify(JSON.parse(localStorage.northstarOverviewProfilesV2).desktop));
  await report('#overviewEventsSummary .ov-events a');await page.goBack();await ready();
  assert.equal(await page.locator('#overview:visible').count(),1);
  assert.equal(await page.evaluate(()=>JSON.stringify(JSON.parse(localStorage.northstarOverviewProfilesV2).desktop)),saved);
  await page.click('#sideNav [data-tab="logbook"]');await checkEvents();
  await report('#erRows .er-open');await page.goBack();await checkEvents();
  await report('#erRows .er-open');mode='transient';
  await page.click('nav a');await checkEvents();assert.ok(failed.size>20,'Injected failures cover the full stylesheet stack');
  assert.equal(await page.evaluate(()=>[...document.querySelectorAll('link[rel=stylesheet]')].every(l=>l.sheet.cssRules.length>0)),true);
  await page.screenshot({path:path.join(out,'events-return-recovered.png'),fullPage:false});
  mode='normal';await page.click('#sideNav [data-tab="overview"]');await page.waitForTimeout(250);
  assert.equal(await page.evaluate(()=>JSON.stringify(JSON.parse(localStorage.northstarOverviewProfilesV2).desktop)),saved);
  await page.screenshot({path:path.join(out,'overview-after-return.png'),fullPage:false});
  await report('#overviewEventsSummary .ov-events a');mode='persistent';await page.click('nav a');
  await page.waitForFunction(()=>document.documentElement.dataset.nsStyles==='failed');
  assert.equal(await page.evaluate(()=>!!window.NorthstarModules),false,'Viewer must not initialize with missing styles');
  assert.equal(await page.locator('.app').evaluate(e=>getComputedStyle(e).visibility),'hidden');
  assert.equal(await page.evaluate(()=>JSON.stringify(JSON.parse(localStorage.northstarOverviewProfilesV2).desktop)),saved,'Failed assets must not overwrite layout');
  await page.screenshot({path:path.join(out,'stylesheet-retry-state.png'),fullPage:false});
  mode='normal';await page.click('#nsStyleStatus button');await checkEvents();
  assert.equal(await page.evaluate(()=>JSON.stringify(JSON.parse(localStorage.northstarOverviewProfilesV2).desktop)),saved);
  mode='scriptfail';await page.reload();await page.waitForFunction(()=>document.documentElement.dataset.nsStyles==='failed');
  assert.equal(await page.evaluate(()=>!!window.NorthstarModules),false);
  assert.equal(await page.locator('.app').evaluate(e=>getComputedStyle(e).visibility),'hidden');
  assert.equal(await page.evaluate(()=>JSON.stringify(JSON.parse(localStorage.northstarOverviewProfilesV2).desktop)),saved);
  mode='normal';await page.click('#nsStyleStatus button');await checkEvents();
  assert.deepEqual(errors,[]);
  fs.writeFileSync(path.join(out,'browser-validation.json'),JSON.stringify({fixture:true,scenarios:['Overview event and browser Back','Events report and browser Back','Events return link with failed stylesheets','Persistent stylesheet failure preserves layout','Retry restores section without resetting layout'],failedStylesheets:[...failed],requests,pageErrors:errors},null,2));
  console.log('Event return browser checks passed: history, return link, stylesheet recovery, persistent failure, retry and saved layout preservation.');
 }finally{await browser.close();server.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
