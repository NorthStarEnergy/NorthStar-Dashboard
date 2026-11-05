const {chromium}=require('playwright');
const assert=require('node:assert/strict'),http=require('node:http'),fs=require('node:fs'),path=require('node:path');
const root=process.env.NORTHSTAR_TEST_ROOT || path.resolve(__dirname,'..');
const overlay=process.env.NORTHSTAR_TEST_OVERLAY;
const now=Date.now(),stamp=delta=>new Date(now+delta).toISOString();
const outages=[
 {id:'active',asset:'Unit 1',site:'Twin Falls',status:'Open',openedAt:stamp(-3600000),eventId:'active-report'},
 {id:'future',asset:'Device 2',site:'Island Falls',status:'Open',openedAt:stamp(86400000),type:'Planned'},
 {id:'planned-active',asset:'Unit 3',status:'Open',openedAt:stamp(-3600000),type:'Planned'},
 {id:'closed',asset:'Unit 4',status:'Closed',openedAt:stamp(-86400000),closedAt:stamp(-3600000)},
 {id:'cancelled',asset:'Device 5',status:'Cancelled',openedAt:stamp(86400000),closedAt:stamp(-3600000)},
 {id:'completed',asset:'Unit 6',status:'Completed',openedAt:stamp(-86400000),closedAt:stamp(-3600000)}
];
(async()=>{
 const server=http.createServer((req,res)=>{
  const pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
  if(pathname.startsWith('/api/')){
   const body=pathname==='/api/auth/session'?{required:false}:pathname==='/api/profile/station-popup'?{useSaved:false,savedSize:null}:pathname==='/api/outages'?outages:pathname==='/api/events/register'?{items:[{eventId:'activity-report',occurredAt:stamp(-10000),summary:'Unit inspection recorded',site:'Twin Falls'}]}:pathname==='/api/logbook'?[]:{};
   res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify(body));return;
  }
  const selected=overlay&&['/generating-stations.js','/generating-station-cards.css'].includes(pathname)?overlay:root;
  const target=path.resolve(selected,'.'+pathname);
  if(!target.startsWith(selected+path.sep)){res.writeHead(404);res.end();return;}
  fs.readFile(target,(error,data)=>{res.writeHead(error?404:200,{'Content-Type':{'.html':'text/html','.js':'text/javascript','.css':'text/css'}[path.extname(target)]||'application/octet-stream'});res.end(error?'':data);});
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const browser=await chromium.launch({channel:'msedge',headless:true});
 try {
  const page=await browser.newPage({viewport:{width:1600,height:1000}}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.goto(`http://127.0.0.1:${server.address().port}/northstar-clean.html`);
  await page.waitForFunction(()=>window.NorthstarModules?.registry?.has('operations:sites'));
  await page.click('#sideNav [data-tab="operations"]');
  await page.waitForSelector('#operationsSites:visible');
  assert.equal(await page.locator('#operationsSites .gs-operations-card').count(),18);
  const layout=await page.locator('.gs-operations-layout').evaluate(el=>{const a=el.children[0].getBoundingClientRect(),b=el.children[1].getBoundingClientRect();return {left:a.width,right:b.width,ax:a.x,bx:b.x};});
  assert.ok(Math.abs(layout.left-layout.right)<2 && layout.bx>layout.ax);
  assert.ok((await page.locator('.gs-operations-card').first().boundingBox()).height>=160);
  assert.equal(await page.locator('.gs-operations-card .gs-output').first().textContent(),await page.locator('#overviewGeneratingStations .gs-output').first().textContent());
  assert.match(await page.locator('.gs-activity-list').innerText(),/Unit inspection recorded/);
  assert.equal(await page.locator('.gs-activity-list a').getAttribute('href'),'event-detail.html?id=activity-report');
  assert.equal(await page.locator('.gs-outages-list article').count(),3);
  assert.match(await page.locator('.gs-outage-upcoming').innerText(),/Upcoming/);
  await page.click('[data-operations-outages="active"]');assert.equal(await page.locator('.gs-outages-list article').count(),2);
  assert.match(await page.locator('.gs-outages-list').innerText(),/Unit 3/);
  assert.doesNotMatch(await page.locator('.gs-outages-list').innerText(),/Device 2/);
  await page.click('[data-operations-outages="past"]');assert.equal(await page.locator('.gs-outages-list article').count(),3);
  assert.match(await page.locator('.gs-outages-list').innerText(),/Cancelled/);
  await page.locator('.gs-operations-card').first().click();await page.waitForSelector('#operationsSite-twin-falls:visible');
  await page.evaluate(()=>window.NorthstarModules.open('operations:sites'));
  await page.reload();await page.waitForSelector('#operationsSites:visible');
  await page.click('[data-operations-outages="all"]');
  if(process.env.NORTHSTAR_SCREENSHOT)await page.screenshot({path:process.env.NORTHSTAR_SCREENSHOT});
  await page.setViewportSize({width:760,height:1000});
  assert.equal(await page.locator('.gs-operations-layout').evaluate(el=>getComputedStyle(el).gridTemplateColumns.split(' ').length),1);
  assert.ok(await page.locator('#operationsSites').evaluate(el=>el.scrollWidth<=el.clientWidth+2));
  assert.equal(errors.filter(e=>/generating|operations|outagePhase/i.test(e)).length,0,errors.join('\n'));
  console.log('PASS: 18 shared station cards, equal columns, activity report, All/Active/Past lifecycle including future cancellation and current planned outage, station navigation, reload and responsive layout.');
 }finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
})().catch(e=>{console.error(e);process.exitCode=1;});
