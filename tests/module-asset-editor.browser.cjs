/* Real Chromium interaction tests. Fixtures never call live operational APIs. */
const {chromium}=require('playwright');
const http=require('node:http'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..');
const fixture=`<!doctype html><html><head><link rel="stylesheet" href="module-asset-editor.css"><style>
body{background:#10202c;color:white;font:16px Arial;margin:30px}article{position:relative;width:650px;height:230px;border:1px solid #aaa;padding:15px;margin:15px}button{padding:8px}#fixed{height:100px}span{display:inline-block}.layout-toolbar{position:fixed;bottom:5px;right:5px}.section{margin:0}#source{font-size:20px}
</style></head><body><article id="fixed" class="ns-status-module" data-status="fixture"><span id="fixedValue">Fixed value</span></article>
<main><section id="tools" class="section"><article id="full" data-ns-module="tools:fixture"><h2>Fixture module</h2><div data-site="A"><span class="reading">12 MW</span></div><div data-site="B"><span class="reading">34 MW</span></div><strong id="source">42 MW</strong><button id="action">Operational action</button></article></section><article id="compact" data-ns-compact="tools:fixture"><span id="compactValue">Compact value</span></article></main>
<div class="layout-toolbar"><button class="layout-edit-toggle">EDIT</button><button class="layout-save">SAVE</button></div>
<script>window.calls=0;document.querySelector('#action').onclick=()=>calls++;document.querySelector('.layout-edit-toggle').onclick=()=>document.body.classList.toggle('layout-edit');document.querySelector('.layout-save').onclick=()=>document.body.classList.remove('layout-edit');</script>
<script src="module-layout.js"></script><script src="module-asset-editor.js"></script></body></html>`;
(async()=>{
 const server=http.createServer((req,res)=>{
  const pathname=new URL(req.url,'http://local').pathname;
  if(pathname==='/fixture.html'){res.writeHead(200,{'Content-Type':'text/html'});res.end(fixture);return;}
  const target=path.resolve(root,'.'+decodeURIComponent(pathname));
  if(!target.startsWith(root+path.sep)||!['.html','.js','.css','.svg','.png','.ico'].includes(path.extname(target))){res.writeHead(404);res.end();return;}
  fs.readFile(target,(err,data)=>{res.writeHead(err?404:200,{'Content-Type':{'.html':'text/html','.js':'text/javascript','.css':'text/css'}[path.extname(target)]||'application/octet-stream'});res.end(err?'':data);});
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const browser=await chromium.launch({channel:'msedge',headless:true});
 const page=await browser.newPage({viewport:{width:1500,height:1100}}),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 const url=`http://127.0.0.1:${server.address().port}`;
 const edit=async()=>{await page.click('.layout-edit-toggle');await page.waitForSelector('#nsAssetEditor:visible');};
 const field=async(name,value)=>{await page.locator('#nsAssetEditor [name="'+name+'"]').fill(String(value));await page.locator('#nsAssetEditor [name="'+name+'"]').dispatchEvent('change');};
 const style=async(selector,name)=>page.locator(selector).evaluate((n,k)=>getComputedStyle(n)[k],name);
 const drag=async(locator,dx,dy)=>{const b=await locator.boundingBox();assert.ok(b);await page.mouse.move(b.x+b.width/2,b.y+b.height/2);await page.mouse.down();await page.mouse.move(b.x+b.width/2+dx,b.y+b.height/2+dy,{steps:5});await page.mouse.up();};
 try{
  await page.goto(url+'/fixture.html');await edit();
  await page.click('#source');await field('fontSize',32);await field('color','#ffcc00');
  assert.equal(await style('#source','fontSize'),'32px');assert.equal(await style('#source','color'),'rgb(255, 204, 0)');
  await page.click('#nsAssetEditor [data-action="collapse"]');
  assert.equal(await page.locator('#nsAssetSelection').isVisible(),false,'minimize hides the selection frame and resize handles');
  await page.evaluate(()=>{window.dispatchEvent(new Event('resize'));NorthstarAssetEditor.refresh();});
  await page.waitForTimeout(1700);
  assert.equal(await page.locator('#nsAssetSelection').isVisible(),false,'refresh cannot restore minimized selection chrome');
  const minimized=await page.locator('#nsAssetEditor').boundingBox();
  assert.ok(minimized.height<60 && minimized.width<150,'minimized panel occupies only a small restore button');
  await drag(page.locator('#nsAssetEditor [data-action="collapse"]'),200,900);
  assert.equal(await page.locator('#nsAssetEditor').evaluate(n=>n.classList.contains('ns-designer-collapsed')),true,'dragging restore button does not expand it');
  const movedDock=await page.locator('#nsAssetEditor').boundingBox();
  assert.ok(movedDock.y>minimized.y+500,'minimized designer can move down the screen');
  assert.equal(await page.evaluate(({x,y})=>!!document.elementFromPoint(x+20,y+15)?.closest('#nsAssetEditor'),minimized),false,'no invisible editor remains at its previous location');
  await page.click('#nsAssetEditor [data-action="collapse"]');
  assert.equal(await page.locator('#nsAssetEditor').getAttribute('data-opens'),'up','designer near the bottom expands upward');
  let floating=await page.locator('#nsAssetEditor').boundingBox();
  assert.ok(floating.x>=0 && floating.x+floating.width<=1500 && floating.y>=0 && floating.y+floating.height<=1100,'expanded designer stays on screen');
  await drag(page.locator('#nsAssetEditor header'),-250,-200);
  const movedExpanded=await page.locator('#nsAssetEditor').boundingBox();
  assert.ok(movedExpanded.x<floating.x-150,'expanded designer header is draggable');
  await page.setViewportSize({width:900,height:700});
  floating=await page.locator('#nsAssetEditor').boundingBox();
  assert.ok(floating.x>=0 && floating.x+floating.width<=900 && floating.y>=0 && floating.y+floating.height<=700,'viewport resize keeps the whole popup reachable');
  await page.setViewportSize({width:1500,height:1100});
  await page.click('#nsAssetEditor [data-action="collapse"]');
  await drag(page.locator('#nsAssetEditor [data-action="collapse"]'),900,-1000);
  await page.click('#nsAssetEditor [data-action="collapse"]');
  assert.equal(await page.locator('#nsAssetEditor').getAttribute('data-opens'),'down','designer near the top expands downward');
  assert.equal(await page.locator('#nsAssetSelection').isVisible(),true,'expanding restores selection without losing edits');
  await drag(page.locator('#source'),30,20);assert.equal(await style('#source','translate'),'30px 20px');
  await page.keyboard.press('ArrowRight');assert.equal(await style('#source','translate'),'31px 20px');
  const cancelBox=await page.locator('#source').boundingBox();
  await page.mouse.move(cancelBox.x+5,cancelBox.y+5);await page.mouse.down();await page.mouse.move(cancelBox.x+60,cancelBox.y+40);
  await page.evaluate(()=>window.dispatchEvent(new PointerEvent('pointercancel')));await page.mouse.up();
  assert.equal(await style('#source','translate'),'31px 20px','cancelled drag restores original geometry');
  await drag(page.locator('#nsAssetSelection [data-asset-corner="se"]'),30,20);
  assert.ok(parseFloat(await style('#source','width'))>100,'asset resizes individually');
  await page.click('#action');assert.equal(await page.evaluate(()=>calls),0,'editing suppresses operational click');
  await page.click('#full [data-site="B"] .reading');await field('color','#00ff00');
  await page.evaluate(()=>{document.querySelector('#full [data-site="A"]').before(document.querySelector('#full [data-site="B"]'));document.querySelector('#full [data-site="B"]').innerHTML='<span class="reading">55 MW</span>';});
  await page.waitForFunction(()=>getComputedStyle(document.querySelector('[data-site="B"] .reading')).color==='rgb(0, 255, 0)');
  assert.equal(await style('[data-site="A"] .reading','color'),'rgb(255, 255, 255)','override follows keyed row, not slot');
  const aBox=await page.locator('[data-site="A"] .reading').boundingBox(),bBox=await page.locator('[data-site="B"] .reading').boundingBox();
  await page.mouse.move(aBox.x-4,aBox.y-4);await page.mouse.down();await page.mouse.move(bBox.x+bBox.width+4,bBox.y+bBox.height+4,{steps:4});await page.mouse.up();
  assert.equal(await page.locator('#nsAssetSelection [data-selection-label]').innerText(),'2 assets selected','drag marquee selects every intersected asset');
  assert.equal(await page.locator('#nsAssetEditor [data-selection-name]').innerText(),'2 assets selected');await page.keyboard.press('Escape');
  await page.click('#fixedValue');await field('fontSize',25);
  await page.click('#compactValue');await field('fontSize',22);
  await page.click('#nsAssetEditor [data-action="checkpoint"]');
  await page.reload();await edit();
  assert.equal(await style('#fixedValue','fontSize'),'25px');assert.equal(await style('#compactValue','fontSize'),'22px');assert.equal(await style('#source','fontSize'),'32px');
  await page.click('#source');await page.click('#nsAssetEditor [data-add="text"]');
  await field('content','My custom text');await field('x',180);await field('y',140);
  assert.equal(await page.locator('#full .ns-asset-text').innerText(),'My custom text');
  await page.click('#nsAssetEditor [data-action="duplicate"]');assert.equal(await page.locator('#full .ns-asset-text').count(),2);
  await page.click('#nsAssetEditor [data-action="undo"]');assert.equal(await page.locator('#full .ns-asset-text').count(),1);
  await page.click('#nsAssetEditor [data-action="redo"]');assert.equal(await page.locator('#full .ns-asset-text').count(),2);
  await page.click('#nsAssetEditor [data-action="delete"]');assert.equal(await page.locator('#full .ns-asset-text').count(),1);
  await page.click('#nsAssetEditor [data-add="data"]');await page.selectOption('#nsAssetEditor [name="source"]','source');
  await page.evaluate(()=>document.querySelector('#source').textContent='77 MW');
  await page.waitForFunction(()=>document.querySelector('.ns-asset-data').textContent.includes('77 MW'));
  await page.reload();await edit();assert.equal(await page.locator('.ns-asset-text').innerText(),'My custom text');
  await page.click('#source');await page.click('#nsAssetEditor [data-action="restore"]');assert.equal(await style('#source','fontSize'),'20px');
  await page.click('.layout-save');await page.click('#action');assert.equal(await page.evaluate(()=>calls),1,'normal interactions restored after edit');
  assert.deepEqual(errors,[]);
  console.log('PASS: asset selection, drag, keyboard, resize, style, action suppression, keyed feed replacement, fixed/full/compact persistence, undo/redo, custom assets, live binding, reset.');

  // Integrate with the actual dashboard shell and existing module registry.
  await page.route('**/api/**',route=>{
   const p=new URL(route.request().url()).pathname;
   const data=p==='/api/auth/session'?{required:false}:p==='/api/weather'?{stations:[]}:p==='/api/market-prices'?{nodes:{},ontario:{}}:{};
   return route.fulfill({status:['/api/auth/session','/api/weather','/api/market-prices'].includes(p)?200:503,contentType:'application/json',body:JSON.stringify(data)});
  });
  await page.goto(url+'/northstar-clean.html');await page.waitForFunction(()=>!!window.NorthstarModules?.createCanvas && !!window.NorthstarAssetEditor);
  await edit();
  const fixedTitle=page.locator('#nsStatusBar [data-status="events"] .ns-status-title');
  await fixedTitle.click({position:{x:8,y:8}});await field('fontSize',19);
  assert.equal(await fixedTitle.evaluate(n=>getComputedStyle(n).fontSize),'19px','actual fixed-header title is editable');
  const fixedModule=page.locator('#nsStatusBar [data-status="dispatch"]'),fixedBefore=await fixedModule.boundingBox();
  await page.mouse.move(fixedBefore.x+fixedBefore.width/2,fixedBefore.y+fixedBefore.height/2);await page.mouse.down();
  await page.mouse.move(fixedBefore.x+fixedBefore.width/2-25,fixedBefore.y+fixedBefore.height/2+10,{steps:5});await page.mouse.up();
  assert.ok((await fixedModule.boundingBox()).x<fixedBefore.x-10,'blank space moves the entire fixed module in Assets mode');
  assert.equal(await page.locator('#nsAssetSelection').getAttribute('data-whole-module'),'true');
  await page.selectOption('#nsAssetEditor [name="mode"]','modules');
  assert.equal(await page.evaluate(()=>NorthstarAssetEditor.active()),false,'module mode yields to existing module geometry');
  await page.selectOption('#nsAssetEditor [name="mode"]','assets');
  await page.locator('#nsAssetEditor details').first().locator('summary').click();
  await page.fill('#nsAssetEditor [name="newName"]','Designer test module');await page.click('#nsAssetEditor [data-action="create"]');
  await page.click('#nsAssetEditor [data-add="heading"]');await field('content','My dashboard');
  assert.equal(await page.locator('.ns-asset-heading:visible').innerText(),'My dashboard');
  const fullModule=page.locator('[data-ns-custom].ns-module-window:visible'),fullBefore=await fullModule.boundingBox();
  await page.mouse.move(fullBefore.x+450,fullBefore.y+180);await page.mouse.down();
  await page.mouse.move(fullBefore.x+420,fullBefore.y+150,{steps:5});await page.mouse.up();
  assert.ok((await fullModule.boundingBox()).x<fullBefore.x-15,'blank space detaches and moves the whole section module');
  assert.equal(await fullModule.evaluate(n=>n.classList.contains('ns-detached-window')),true);
  const customId=await fullModule.getAttribute('data-ns-module');
  await page.click('#sideNav [data-tab="overview"]');
  const overviewModule=page.locator('[data-ns-compact="'+customId+'"]');await overviewModule.scrollIntoViewIfNeeded();
  const overviewBefore=await overviewModule.boundingBox();
  await page.mouse.move(overviewBefore.x+overviewBefore.width/2,overviewBefore.y+overviewBefore.height-40);await page.mouse.down();
  await page.mouse.move(overviewBefore.x+overviewBefore.width/2+40,overviewBefore.y+overviewBefore.height-20,{steps:5});await page.mouse.up();
  assert.ok((await overviewModule.boundingBox()).x>overviewBefore.x+10,'blank space moves the entire overview module');
  await page.evaluate(id=>NorthstarModules.open(id),customId);
  await page.screenshot({path:path.join(root,'outputs','module-asset-editor.png')});
  await page.click('.layout-save');await page.reload();await page.waitForFunction(()=>!!window.NorthstarModules);
  assert.ok(await page.evaluate(()=>Object.values(NorthstarModules.state.modules).some(m=>m.name==='Designer test module')));
  await page.evaluate(()=>NorthstarModules.open(Object.keys(NorthstarModules.state.modules).find(id=>NorthstarModules.state.modules[id].name==='Designer test module')));
  assert.equal(await page.locator('.ns-asset-heading:visible').innerText(),'My dashboard');
  await edit();await page.click('.ns-asset-heading:visible');await field('fontSize',36);
  page.once('dialog',dialog=>dialog.accept());await page.click('.layout-reset');await page.waitForFunction(()=>!!window.NorthstarModules);
  await page.evaluate(()=>NorthstarModules.open(Object.keys(NorthstarModules.state.modules).find(id=>NorthstarModules.state.modules[id].name==='Designer test module')));
  await page.waitForSelector('.ns-asset-heading:visible');
  assert.equal(await style('.ns-asset-heading:visible','fontSize'),'24px','global reset restores the saved asset checkpoint');
  await edit();await page.click('#nsAssetEditor [data-action="collapse"]');
  const shellDock=await page.locator('#nsAssetEditor').boundingBox();
  await drag(page.locator('#nsAssetEditor [data-action="collapse"]'),-120,100);
  assert.ok((await page.locator('#nsAssetEditor').boundingBox()).x<shellDock.x-100,'real-shell minimized designer moves');
  await page.click('#nsAssetEditor [data-action="collapse"]');
  const shellPopup=await page.locator('#nsAssetEditor').boundingBox();
  assert.ok(shellPopup.x>=0 && shellPopup.y>=0 && shellPopup.x+shellPopup.width<=1500 && shellPopup.y+shellPopup.height<=1100);
  await page.screenshot({path:path.join(root,'outputs','designer-floating.png')});
  assert.deepEqual(errors,[]);console.log('PASS: actual shell EDIT integration, blank module creation, asset addition and saved reload.');
 }finally{await browser.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1;});
