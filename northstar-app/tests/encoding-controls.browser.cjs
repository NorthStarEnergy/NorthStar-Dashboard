const {chromium}=require('playwright');
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),out=path.join(root,'outputs','encoding-controls');fs.mkdirSync(out,{recursive:true});
(async()=>{
 const server=http.createServer((req,res)=>{
  const pathname=new URL(req.url,'http://localhost').pathname;
  if(pathname.startsWith('/api/')){res.setHeader('Content-Type','application/json');return res.end(JSON.stringify(pathname==='/api/auth/session'?{required:false}:pathname==='/api/logbook'?[]:{}));}
  const file=path.resolve(root,'.'+pathname);
  if(!file.startsWith(root+path.sep)){res.writeHead(404);return res.end();}
  fs.readFile(file,(err,data)=>{res.writeHead(err?404:200,{'Content-Type':{'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8'}[path.extname(file)]||'application/octet-stream'});res.end(err?'':data);});
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const browser=await chromium.launch({channel:'msedge',headless:true});
 try{
  const page=await browser.newPage({viewport:{width:1500,height:980}});
  await page.goto(`http://127.0.0.1:${server.address().port}/northstar-clean.html`);
  await page.waitForFunction(()=>window.NorthstarModules?.registry?.size>0);
  await page.click('#sideNav [data-tab="operations"]');
  const toggle=page.locator('.ns-module-tree .ns-tree-toggle').first();
  const initial=await toggle.textContent();assert.ok(['▾','▸'].includes(initial));
  await toggle.click();assert.equal(await page.locator('.ns-module-tree .ns-tree-toggle').first().textContent(),initial==='▾'?'▸':'▾');
  await page.locator('.ns-module-tree .ns-tree-toggle').first().click();
  assert.equal(await page.locator('.ns-module-tree .ns-tree-toggle').first().textContent(),initial);
  assert.equal(await page.locator('.ns-module-theme-toggle').first().textContent(),'🖌');
  const broken=await page.evaluate(()=>[...document.querySelectorAll('.ns-module-tree,.ns-module-theme,.ns-field-tracker-popout')].filter(el=>/[ÂÃâð�]/.test(el.textContent)).map(el=>el.textContent.slice(0,100)));
  assert.deepEqual(broken,[]);
  await page.screenshot({path:path.join(out,'verified-controls.png')});
  console.log('PASS rendered tree arrows, collapse/expand, theme brush, no corrupted control text');
 }finally{await browser.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1;});
