/* Focused coverage: live feed replacements must not paint source asset values. */
const {chromium}=require('playwright');
const http=require('node:http'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..');
const fixture=`<!doctype html><html><head><style>body{margin:30px}article{position:relative;width:400px;height:120px}.layout-toolbar{position:fixed;right:5px;bottom:5px}</style></head><body class="layout-edit"><article id="fixed" class="ns-status-module" data-status="fixture"><span id="fixedValue">Old label</span></article><div class="layout-toolbar"><button class="layout-edit-toggle">EDIT</button><button class="layout-save">SAVE</button></div><script>localStorage.setItem('northstarAssetEditorV1',JSON.stringify({version:1,roots:{'fixed:fixture':{assets:{'#fixedValue':{text:'New label',x:24,w:160}}}}}));</script><script src="module-layout.js"></script><script src="module-asset-editor.js"></script></body></html>`;
(async()=>{
 const server=http.createServer((req,res)=>{const pathname=new URL(req.url,'http://local').pathname;if(pathname==='/fixture.html'){res.writeHead(200,{'Content-Type':'text/html'});res.end(fixture);return;}const target=path.resolve(root,'.'+decodeURIComponent(pathname));if(!target.startsWith(root+path.sep)||!['.js','.css'].includes(path.extname(target))){res.writeHead(404);res.end();return;}fs.readFile(target,(error,data)=>{res.writeHead(error?404:200,{'Content-Type':path.extname(target)==='.js'?'text/javascript':'text/css'});res.end(error?'':data);});});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const browser=await chromium.launch({channel:'msedge',headless:true});
 try{
  const page=await browser.newPage();await page.goto(`http://127.0.0.1:${server.address().port}/fixture.html`);await page.waitForFunction(()=>window.NorthstarAssetEditor);
  const firstFeedFrame=await page.evaluate(()=>new Promise(resolve=>{document.querySelector('#fixed').innerHTML='<span id="fixedValue">Old label</span>';requestAnimationFrame(()=>{const node=document.querySelector('#fixedValue');resolve({text:node.textContent,translate:getComputedStyle(node).translate,width:getComputedStyle(node).width});});}));
  assert.deepEqual(firstFeedFrame,{text:'New label',translate:'24px',width:'160px'});
  console.log('PASS: live feed replacement keeps edited text, position, and size on its first paint.');
 }finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});
