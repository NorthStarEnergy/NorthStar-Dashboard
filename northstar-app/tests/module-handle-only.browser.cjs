/* Real Chromium interaction tests. Fixtures never call live operational APIs. */
const {chromium}=require('playwright');
const http=require('node:http'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..');
const fixture=`<!doctype html><html><head><link rel="stylesheet" href="module-asset-editor.css"><style>
body{background:#10202c;color:white;font:16px Arial;margin:30px}article{position:relative;width:650px;height:230px;border:1px solid #aaa;padding:15px;margin:15px}button{padding:8px}#fixed{height:100px}span{display:inline-block}.layout-toolbar{position:fixed;bottom:5px;right:5px}.section{margin:0}#source{font-size:20px}.graph-frame{border:2px solid #789;background:#1b3445;padding:4px}.graph-frame canvas{width:120px;height:20px}.fixture-table{border-collapse:collapse}.fixture-table td{border:1px solid #aaa;padding:2px}
</style></head><body><article id="fixed" class="ns-status-module" data-status="fixture"><span id="fixedValue">Fixed value</span></article>
<main><section id="tools" class="section"><article id="full" data-ns-module="tools:fixture"><h2>Fixture module</h2><div data-site="A"><span class="reading">12 MW</span></div><div data-site="B"><span class="reading">34 MW</span></div><strong id="source">42 MW</strong><button id="action">Operational action</button><div class="graph-frame"><canvas id="fixtureGraph"></canvas></div><table class="fixture-table"><tbody><tr><td>Row value</td></tr></tbody></table></article></section><article id="compact" data-ns-compact="tools:fixture"><span id="compactValue">Compact value</span></article></main>
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
 const edit=async()=>{await page.click('.layout-edit-toggle');await page.waitForSelector('#nsAssetEditor:visible');await page.selectOption('#nsAssetEditor [name="mode"]','assets');};
 const field=async(name,value)=>{await page.locator('#nsAssetEditor [name="'+name+'"]').fill(String(value));await page.locator('#nsAssetEditor [name="'+name+'"]').dispatchEvent('change');};
 const style=async(selector,name)=>page.locator(selector).evaluate((n,k)=>getComputedStyle(n)[k],name);
 const drag=async(locator,dx,dy)=>{const b=await locator.boundingBox();assert.ok(b);await page.mouse.move(b.x+b.width/2,b.y+b.height/2);await page.mouse.down();await page.mouse.move(b.x+b.width/2+dx,b.y+b.height/2+dy,{steps:5});await page.mouse.up();};
 try{
  await page.goto(url+'/fixture.html');await edit();
  await page.evaluate(()=>{
   const root=document.querySelector('#full'),handle=document.createElement('button');
   handle.className='canvas-move-handle';handle.textContent='Move';handle.style.cssText='position:absolute;top:0;left:50%;z-index:9999';root.append(handle);
   root.style.position='relative';root.style.left='0px';root.style.top='0px';
   window.frameBox={x:0,y:0,w:650,h:230};NorthstarWindowLayout.bind(root,handle,'move',()=>window.frameBox,box=>{window.frameBox=box;root.style.left=box.x+'px';root.style.top=box.y+'px';},()=>document.body.classList.contains('layout-edit'),()=>{});
  });
  const position=()=>page.evaluate(()=>window.frameBox);
  await page.selectOption('#nsAssetEditor [name="mode"]','modules');
  await page.click('#source');const before=await position();
  await drag(page.locator('#source'),40,25);
  assert.deepEqual(await position(),before,'selected module content must not move its frame');
  await page.selectOption('#nsAssetEditor [name="mode"]','assets');
  const b=await page.locator('#full').boundingBox();
  await page.mouse.click(b.x+b.width-30,b.y+b.height-30);
  await page.mouse.move(b.x+b.width-70,b.y+b.height-65,{steps:5});
  assert.deepEqual(await position(),before,'empty selection must not arm a drag after pointerup');
  await drag(page.locator('#source'),15,10);
  assert.deepEqual(await position(),before,'asset dragging must not move its module');
  await page.keyboard.press('Escape');
  await drag(page.locator('#full > .canvas-move-handle'),40,25);
  assert.notDeepEqual(await position(),before,'explicit move handle must still move the module');
  assert.deepEqual(errors,[]);console.log('PASS: module content, empty selection, and asset drags leave frame fixed; move handle works.');
 }finally{await browser.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1;});