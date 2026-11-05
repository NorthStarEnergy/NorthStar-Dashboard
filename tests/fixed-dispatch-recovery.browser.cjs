const {chromium}=require('playwright');
const http=require('node:http'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..');
const fixture=`<!doctype html><html><head><link rel="stylesheet" href="dashboard-polish.css"><script>window.NORTHSTAR_PERSISTENT_STATUS=true;window.NORTHSTAR_MODULE_WORKSPACE=true;</script><script src="dashboard-layout-default.js"></script><script src="module-layout.js" defer></script><script src="module-asset-editor.js" defer></script></head><body class="ns-has-status"><div id="nsStatusBar"><section class="ns-status-module" data-status="dispatch"><div class="ns-status-content"><div class="ns-status-title-row"><b class="ns-status-title" data-asset-id="dispatch-title">Dispatch · APIROQ</b><strong class="ns-dispatch-alert" data-asset-id="operating-reserve-status">OR ACTIVE · 10S</strong></div><div class="ns-dispatch-service-row"><span class="ns-dispatch-interval"><b>5 min</b></span><span class="ns-dispatch-connection is-simulated"><i></i></span></div><div class="ns-status-metrics ns-status-metrics-three ns-dispatch-metrics"><span data-asset-id="dispatch-value" class="ns-dispatch-value ns-dispatch-pending"><small>Dispatch</small><strong>25.0</strong></span><button class="ns-dispatch-accept">Accept</button><span data-asset-id="output-value"><small>Output</small><strong>24.5</strong></span></div><div class="ns-or-grid" data-asset-id="operating-reserve-values"><span data-asset-id="operating-reserve-10n" class="ns-or-item ns-or-standby"><small>10N</small><strong>2.0</strong></span><span data-asset-id="operating-reserve-10s" class="ns-or-item ns-or-activated"><small>10S</small><strong>8.0</strong></span><span data-asset-id="operating-reserve-30r" class="ns-or-item ns-or-standby"><small>30R</small><strong>0.0</strong></span><span data-asset-id="operating-reserve-total" class="ns-or-item ns-or-standby"><small>Total</small><strong>10.0</strong></span></div></div></section></div></body></html>`;
const staleLayout={profiles:{desktop:{height:113,modules:{crew:{x:2,y:0,w:342,h:112},events:{x:346,y:0,w:369,h:112},dispatch:{x:717,y:0,w:300,h:112},markets:{x:1019,y:1,w:300,h:112}}}}};
const assetKey=id=>`div.ns-status-content > div.ns-or-grid[data-asset-id="operating-reserve-values"] > span[data-asset-id="${id}"]`;
const placedAssets={version:1,roots:{'fixed:dispatch':{custom:[],assets:{
  [assetKey('operating-reserve-10n')]:{x:3,y:-2,w:28,h:20,color:'#a8d9f5'},
  [assetKey('operating-reserve-10s')]:{x:11,y:4,w:31,h:24,color:'#ffe1dd'},
  [assetKey('operating-reserve-30r')]:{x:-5,y:7,w:35,h:22,color:'#d0dbe2'},
  [assetKey('operating-reserve-total')]:{x:8,y:9,w:40,h:26,color:'#ffffff'},
}}}};
(async()=>{
 const server=http.createServer((req,res)=>{
  const pathname=new URL(req.url,'http://local').pathname;
  if(pathname==='/fixture.html'){res.writeHead(200,{'Content-Type':'text/html'});return res.end(fixture);}
  const target=path.resolve(root,'.'+decodeURIComponent(pathname));
  if(!target.startsWith(root+path.sep)||!['.js','.css'].includes(path.extname(target))){res.writeHead(404);return res.end();}
  fs.readFile(target,(error,data)=>{res.writeHead(error?404:200,{'Content-Type':path.extname(target)==='.css'?'text/css':'text/javascript'});res.end(error?'':data);});
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const browser=await chromium.launch({channel:'msedge',headless:true}).catch(()=>chromium.launch({headless:true}));
 const page=await browser.newPage({viewport:{width:1376,height:590}}),errors=[];
 page.on('pageerror',error=>errors.push(error.message));
 await page.addInitScript(({layout,assets})=>{
  localStorage.setItem('northstarStatusLayoutV1',JSON.stringify(layout));
  localStorage.setItem('northstarStatusLayoutV1Saved',JSON.stringify(layout));
  localStorage.setItem('northstarAssetEditorV1',JSON.stringify(assets));
  localStorage.setItem('northstarAssetEditorV1Saved',JSON.stringify(assets));
 },{layout:staleLayout,assets:placedAssets});
 try{
  await page.goto(`http://127.0.0.1:${server.address().port}/fixture.html`);
  await page.waitForFunction(()=>window.NorthstarAssetEditor && document.querySelector('#nsStatusBar [data-status=dispatch]'));
  const initial=await page.evaluate(()=>(
   {layout:JSON.parse(localStorage.getItem('northstarStatusLayoutV1')),savedLayout:JSON.parse(localStorage.getItem('northstarStatusLayoutV1Saved')),assets:JSON.parse(localStorage.getItem('northstarAssetEditorV1')),savedAssets:JSON.parse(localStorage.getItem('northstarAssetEditorV1Saved'))}
  ));
  assert.deepEqual(initial.layout.profiles.desktop.modules.dispatch,{x:717,y:0,w:167,h:112});
  assert.deepEqual(initial.layout.profiles.desktop.modules.markets,{x:886,y:1,w:300,h:112});
  assert.deepEqual(initial.savedLayout.profiles.desktop.modules.dispatch,{x:717,y:0,w:167,h:112});
  assert.deepEqual(initial.assets,placedAssets,'Dispatch keeps every saved asset geometry');
  assert.deepEqual(initial.savedAssets,placedAssets,'Dispatch reset checkpoint keeps every saved asset geometry');
  assert.deepEqual(await page.evaluate(()=>[...document.querySelectorAll('#nsStatusBar [data-status=dispatch] .ns-or-item')].map(node=>node.dataset.assetId)),['operating-reserve-10n','operating-reserve-10s','operating-reserve-30r','operating-reserve-total']);
  const before=await page.locator('#nsStatusBar [data-status=dispatch]').boundingBox();
  await page.evaluate(box=>NorthstarModuleGeometry.fit(document.querySelector('#nsStatusBar [data-status=dispatch]'),{x:box.x,y:box.y,w:box.width-20,h:box.height-10}),before);
  await page.waitForTimeout(260);
  const after=await page.evaluate(()=>(
   {assets:JSON.parse(localStorage.getItem('northstarAssetEditorV1')),savedAssets:JSON.parse(localStorage.getItem('northstarAssetEditorV1Saved'))}
  ));
  assert.deepEqual(after.assets,placedAssets,'a fixed Dispatch frame resize leaves every placed asset unchanged');
  assert.deepEqual(after.savedAssets,placedAssets,'a fixed Dispatch frame resize does not corrupt the reset checkpoint');
  const source=fs.readFileSync(path.join(root,'dashboard-chrome.js'),'utf8');
  assert.match(source,/item\.dataset\.assetId='operating-reserve-'\+label/,'live Dispatch assigns stable identities to all reserve tiles');
  assert.deepEqual(errors,[]);
  console.log('PASS: stale fixed frame migrates without moving or resizing user-placed Dispatch assets.');
 }finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});
