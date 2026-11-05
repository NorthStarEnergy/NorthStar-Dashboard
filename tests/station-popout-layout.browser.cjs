/* Isolated fixture: current canonical dependencies + only the owned popout overlays. */
const {chromium}=require('playwright');
const http=require('node:http'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..');
const canonical=process.env.NORTHSTAR_CANONICAL_ROOT || root;
const owned=new Set(['dashboard-chrome.js','module-layout.js','module-asset-editor.js','station-popout.css']);
const output=path.join(root,'outputs','change-coordinator','fixed-popout-integration-20261013');fs.mkdirSync(output,{recursive:true});
(async()=>{
 const server=http.createServer((req,res)=>{
  const relative=decodeURIComponent(new URL(req.url,'http://localhost').pathname).slice(1),base=owned.has(relative)?root:canonical,file=path.resolve(base,relative);
  if(!file.startsWith(base+path.sep)||!['.html','.js','.css','.svg','.png','.ico'].includes(path.extname(file))){res.writeHead(404);return res.end();}
  fs.readFile(file,(error,data)=>{res.writeHead(error?404:200,{'Content-Type':{'.html':'text/html','.js':'text/javascript','.css':'text/css'}[path.extname(file)]||'application/octet-stream'});res.end(error?'':data);});
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const browser=await chromium.launch({channel:'msedge',headless:true});
 const page=await browser.newPage({viewport:{width:1920,height:1080}}),errors=[],posts=[];
 page.on('pageerror',error=>errors.push(error.message));
 const now=new Date().toISOString(),sites=['Twin Falls','Iroquois Falls','Iroquois Falls 230 kV','Island Falls','Old Woman Falls','White Otter Rapids','Camp Three Rapids','Big Beaver Falls','Calm Lake','Sturgeon Falls','Fort Frances','Fort Frances TS','Kenora','Norman','Okikendawt GS','Aiyers 1','Aiyers 2','Bird GS','Cogent','Cameron'];
 const rows=sites.map((site,i)=>({id:'fixture-'+i,name:'Fixture Worker '+i,site,status:'on-site',alone:true,checkedIn:now,lastHeard:now}));
 await page.context().route('**/api/**',route=>{
  const url=new URL(route.request().url()).pathname;
  if(route.request().method()==='POST')posts.push(url);
  const bodies={'/api/auth/session':{required:false},'/api/checkins':rows,'/api/sites':{sites:[]},'/api/profile/crew-layout':{positions:{}},'/api/weather':{stations:['Iroquois Falls','Atikokan','Kapuskasing'].map(name=>({name,current:{temperature_2m:18,weather_code:2},hourly:{time:[now],temperature_2m:[18],weather_code:[2]}}))},'/api/dispatch/apiroq':{outputMw:24.5,dispatchMw:25,healthy:true,updatedAt:now,reserveStandby:{tenS:1,tenN:2,thirtyR:3}},'/api/market-prices':{nodes:{}},'/api/scada':{feeds:[],readings:[]},'/api/events/register':{items:[],total:0},'/api/chat/messages':{messages:[]}};
  return route.fulfill({status:url in bodies?200:503,contentType:'application/json',body:JSON.stringify(bodies[url]||{})});
 });
 page.on('dialog',dialog=>dialog.accept());
 try{
  const url=`http://127.0.0.1:${server.address().port}/northstar-clean.html?nsStatusWindow=1#overview`;
  await page.addInitScript(rows=>window.__fixtureRows=rows,rows);
  await page.goto(url);await page.waitForSelector('#nsStatusWorkers #staffGroups > .staff-group');
  await page.waitForSelector('[data-fixed-visible]');
  await page.waitForFunction(()=>document.querySelectorAll('#staffGroups > .staff-group').length===20);
  const initial=await page.evaluate(()=>{
   const rect=id=>{const r=document.getElementById(id).getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height};};
   return {visible:[...document.querySelectorAll('#nsStatusBar>.ns-status-module')].filter(el=>getComputedStyle(el).display!=='none').map(el=>el.dataset.status),eventHeight:document.querySelector('#nsStatusBar [data-status=events]').getBoundingClientRect().height,bar:rect('nsStatusBar'),divider:rect('nsStationDivider'),staff:rect('overviewStaff'),activity:rect('nsFieldActivity'),groups:[...document.querySelectorAll('#staffGroups>.staff-group')].map(node=>({site:node.dataset.site,col:node.style.gridColumn,row:node.style.gridRow})),standard:localStorage.getItem('northstarStatusLayoutV1'),assets:localStorage.getItem('northstarAssetEditorV1')};
  });
  fs.writeFileSync(path.join(output,'initial.json'),JSON.stringify({...initial,standard:undefined,assets:undefined},null,2));
  await page.screenshot({path:path.join(output,'station-popout-preview.png')});
  assert.deepEqual(initial.visible,['events','dispatch','markets','weather','crew']);
  assert.ok(initial.eventHeight<=initial.bar.h*.51,'Event module starts at half header height');
  assert.equal(new Set(initial.groups.map(row=>row.col)).size,5);
  assert.equal(initial.groups.find(row=>row.site==='Twin Falls').col,'1');
  assert.equal(initial.groups.find(row=>row.site==='Old Woman Falls').col,'2');
  assert.equal(initial.groups.find(row=>row.site==='Calm Lake').col,'3');
  assert.equal(initial.groups.find(row=>row.site==='Kenora').col,'4');
  assert.equal(initial.groups.find(row=>row.site==='Aiyers 1').col,'5');
  assert.ok(initial.divider.y>=initial.bar.y+initial.bar.h-1);
  assert.ok(initial.activity.w<1920*.13,'Activity feed is half the former quarter-width');
  assert.ok(!(await page.locator('.layout-save').isVisible()),'Save hidden before edits');
  await page.waitForSelector('#weatherStrip>[data-weather-page=visible]');
  assert.equal(await page.locator('#weatherStrip>[data-weather-page=visible]').count(),3,'polished standard weather in popout');
  const person=page.locator('#staffGroups>.staff-group[data-site="Twin Falls"] [data-worker-profile]').first();
  await person.click();await page.waitForSelector('#workerProfileSnapshot[open]');
  assert.ok((await page.locator('#workerProfileSnapshot').innerText()).includes('Fixture Worker 0'));
  await page.keyboard.press('Escape');assert.ok(await person.evaluate(e=>e===document.activeElement));
  const standaloneEvent=page.waitForEvent('popup');
  await page.locator('#staffGroups>.staff-group[data-site="Twin Falls"] h3').click();
  const standalone=await standaloneEvent;await standalone.waitForLoadState();
  assert.equal(new URL(standalone.url()).searchParams.get('nsModuleWindow'),'operations:site:twin-falls','standalone station opens visible module window');
  await standalone.close();

  await page.locator('[data-toggle-fixed]').click();
  assert.ok(!(await page.locator('#nsStatusBar').isVisible()));assert.ok(await page.locator('.layout-save').isVisible());
  await page.locator('.layout-save').click();await page.reload();await page.waitForSelector('[data-fixed-visible]');
  assert.ok(!(await page.locator('#nsStatusBar').isVisible()),'Hidden dashboard survives Save/reload');
  await page.locator('[data-fixed-visible]').check();
  await page.locator('.layout-edit-toggle').click();
  await page.locator('.overview-edit-modules').click();assert.ok(await page.locator('#nsAssetEditor').isVisible());
  await page.locator('[data-view-width]').fill('2100');await page.locator('[data-view-width]').press('Tab');
  const handle=page.locator('#staffGroups>.staff-group[data-site="Twin Falls"] > [data-station-resize=e]');
  await handle.focus();await handle.press('ArrowRight');
  await page.locator('#nsStatusBar [data-status=dispatch] [data-corner=e]').focus();
  await page.locator('#nsStatusBar [data-status=dispatch] [data-corner=e]').press('ArrowRight');
  const before=await page.evaluate(()=>({view:document.getElementById('nsStatusWorkers').getBoundingClientRect().width,station:document.querySelector('[data-site="Twin Falls"]').getBoundingClientRect().width,dispatch:document.querySelector('#nsStatusBar [data-status=dispatch]').getBoundingClientRect().width}));
  assert.equal(before.view,2100);assert.ok(await page.locator('.layout-save').isVisible());
  await page.locator('.layout-save').click();await page.reload();await page.waitForSelector('[data-fixed-visible]');
  await page.waitForFunction(()=>document.querySelectorAll('#staffGroups > .staff-group').length===20);
  const after=await page.evaluate(()=>({view:document.getElementById('nsStatusWorkers').getBoundingClientRect().width,station:document.querySelector('[data-site="Twin Falls"]').getBoundingClientRect().width,dispatch:document.querySelector('#nsStatusBar [data-status=dispatch]').getBoundingClientRect().width,standard:localStorage.getItem('northstarStatusLayoutV1'),assets:localStorage.getItem('northstarAssetEditorV1')}));
  assert.equal(after.view,before.view);assert.equal(after.station,before.station);assert.equal(after.dispatch,before.dispatch);
  assert.equal(after.standard,initial.standard);assert.equal(after.assets,initial.assets);assert.ok(!posts.includes('/api/dashboard-layout-default'));
  await page.locator('.layout-edit-toggle').click();
  assert.ok(!(await page.locator('.layout-save').isVisible()),'Opening editor alone is not an edit');
  await page.locator('#nsAssetEditor [name=mode]').selectOption('assets');
  await page.locator('#staffGroups>.staff-group[data-site="Twin Falls"] h3').click();
  await page.locator('#nsAssetEditor [name=w]').fill('175');await page.locator('#nsAssetEditor [name=w]').press('Tab');
  assert.equal(await page.locator('#staffGroups>.staff-group[data-site="Twin Falls"] h3').evaluate(node=>Math.round(node.getBoundingClientRect().width)),175);
  assert.ok(await page.locator('.layout-save').isVisible(),'Asset edit exposes Save');
  await page.locator('.layout-save').click();await page.reload();await page.waitForSelector('#staffGroups>.staff-group[data-site="Twin Falls"] h3');
  assert.equal(await page.locator('#staffGroups>.staff-group[data-site="Twin Falls"] h3').evaluate(node=>Math.round(node.getBoundingClientRect().width)),175,'Asset width survives reload');
  // Feed replacement must retain station geometry and asset overrides.
  await page.evaluate(()=>renderStaff(window.__fixtureRows));
  await page.waitForFunction(()=>document.querySelector('#staffGroups>.staff-group[data-site="Twin Falls"] h3').getBoundingClientRect().width===175);

  await page.setViewportSize({width:390,height:844});await page.screenshot({path:path.join(output,'station-popout-mobile.png')});
  assert.ok(await page.locator('[data-toggle-fixed]').isVisible());
  await page.setViewportSize({width:1440,height:900});
  await page.evaluate(()=>['northstarStatusWindowViewV1','northstarStatusWindowViewV1Saved','northstarStatusWindowLayoutV1','northstarStatusWindowLayoutV1Saved','northstarStatusWindowAssetsV1','northstarStatusWindowAssetsV1Saved'].forEach(key=>localStorage.removeItem(key)));
  await page.reload();await page.waitForSelector('[data-fixed-visible]');await page.waitForFunction(()=>document.querySelectorAll('#staffGroups>.staff-group').length===20);
  const desktop=await page.evaluate(()=>[...document.querySelectorAll('#staffGroups>.staff-group')].filter(node=>node.style.gridRow==='1').map(node=>{const r=node.getBoundingClientRect();return {x:r.x,w:r.width};}).sort((a,b)=>a.x-b.x));
  assert.equal(desktop.length,5);assert.ok(desktop.every((r,i)=>!i||r.x>=desktop[i-1].x+desktop[i-1].w));
  assert.equal(await page.locator('#nsStatusBar [data-crew-site]').count(),20,'standard lone-worker station pills populated');
  const headingFit=await page.locator('#staffGroups>.staff-group>h3').evaluateAll(headings=>headings.map(heading=>{
    const box=heading.getBoundingClientRect(),card=heading.parentElement.getBoundingClientRect(),button=heading.querySelector('.station-quick-add').getBoundingClientRect();
    const glyphs=[...heading.childNodes].filter(n=>n.nodeType===Node.TEXT_NODE).flatMap(node=>{const range=document.createRange();range.selectNodeContents(node);return [...range.getClientRects()];});
    return {text:heading.textContent,inside:button.left>=card.left+4&&button.right<=card.right-4&&glyphs.every(r=>r.left>=card.left+4&&r.right<=card.right-4&&r.bottom<=box.bottom+1),overlap:glyphs.some(r=>Math.min(r.right,button.right)-Math.max(r.left,button.left)>0.5&&Math.min(r.bottom,button.bottom)-Math.max(r.top,button.top)>0.5)};
  }));
  assert.ok(headingFit.every(row=>row.inside&&!row.overlap),'all station titles fit without quick-add overlap');

  await page.screenshot({path:path.join(output,'station-popout-1440.png')});
  await page.goto(url.replace('?nsStatusWindow=1',''));await page.waitForSelector('#nsStatusBar [data-open-status-window]');
  assert.equal(await page.locator('#nsStationWindow').count(),0,'Overview is unchanged');
  const opened=page.waitForEvent('popup');await page.locator('#nsStatusBar [data-open-status-window]').first().click();const popup=await opened;
  assert.equal(new URL(popup.url()).searchParams.get('nsStatusWindow'),'1');
  await popup.waitForSelector('#staffGroups>.staff-group[data-site="Twin Falls"] h3');
  await popup.locator('#staffGroups>.staff-group[data-site="Twin Falls"] h3').click();
  await page.waitForFunction(()=>document.querySelector('#siteOverview .site-overview-title')?.textContent?.includes('Twin Falls') || [...document.querySelectorAll('h1,h2,h3')].some(e=>e.getClientRects().length&&e.textContent.includes('Twin Falls')));
  assert.ok(await page.locator('#operationsSite-twin-falls').isVisible(),'parent Operations visible');
  await popup.close();
  await page.locator('#sideNav [data-tab="overview"]').click();
  await page.locator('#nsStatusBar [data-crew-site="Twin Falls"]').click();
  assert.ok(await page.locator('#operationsSite-twin-falls').isVisible(),'fixed station pill opens Operations');

  fs.writeFileSync(path.join(output,'verification.json'),JSON.stringify({initial:{...initial,standard:undefined,assets:undefined},before,after:{...after,standard:undefined,assets:undefined},overviewUnchanged:true,assetWidth:175,feedReplacement:true,errors,posts},null,2));
  assert.deepEqual(errors,[]);
  console.log('PASS: five grouped columns, all standard modules, compact activity, editor, hide/show, dirty Save, width persistence and Overview isolation.');
 }catch(error){await page.screenshot({path:path.join(output,'failure.png')});console.error('Browser errors:',errors);console.error(await page.evaluate(()=>({classes:document.body.className,bar:document.getElementById('nsStatusBar')?.outerHTML.slice(0,600),layout:localStorage.getItem('northstarStatusWindowLayoutV1'),toolbar:document.querySelector('.layout-toolbar')?.outerHTML.slice(0,400)}))); throw error;}finally{await browser.close();server.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
