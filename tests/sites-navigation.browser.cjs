const {chromium}=require('playwright');
const assert=require('node:assert/strict'),http=require('node:http'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..');
(async()=>{
 const server=http.createServer((req,res)=>{
  const pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
  if(pathname.startsWith('/api/')){
   const body=pathname==='/api/auth/session'?{required:false}:pathname==='/api/profile/station-popup'?{useSaved:false,savedSize:null}:pathname==='/api/logbook'?[]:pathname==='/api/sites'?{}:{};
   res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify(body));return;
  }
  const target=path.resolve(root,'.'+pathname);
  if(!target.startsWith(root+path.sep)){res.writeHead(404);res.end();return;}
  fs.readFile(target,(error,data)=>{res.writeHead(error?404:200,{'Content-Type':{'.html':'text/html','.js':'text/javascript','.css':'text/css'}[path.extname(target)]||'application/octet-stream'});res.end(error?'':data);});
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const browser=await chromium.launch({channel:'msedge',headless:true});
 try{
  const page=await browser.newPage({viewport:{width:1500,height:980}}),errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}/northstar-clean.html`);
  await page.waitForFunction(()=>window.NorthstarModules?.registry?.has('operations:site:twin-falls'));
  assert.equal(await page.locator('#sideNav [data-tab="operations"]').count(),1);
  await page.click('#sideNav [data-tab="operations"]');
  assert.equal(await page.locator('[data-open-module="operations:sites"]').count(),1);
  const siteButtons=page.locator('.ns-module-tree [data-open-module^="operations:site:"]');
  assert.equal(await siteButtons.count(),18);
  await page.click('[data-open-module="operations:site:twin-falls"]');
  await page.waitForFunction(()=>window.NorthstarModules.state.sections.operations.active==='operations:site:twin-falls');
  await page.waitForSelector('#operationsSite-twin-falls:visible');
  assert.match(await page.locator('#operationsSite-twin-falls').innerText(),/Twin Falls/i);
  await page.click('#sideNav [data-tab="overview"]');
  const card=page.locator('.gs-card[data-module-id="site:calm-lake"]');await card.click();
  await page.waitForSelector('#generatingStationDetails:visible');
  assert.equal(await page.locator('#generatingStationDetails [data-site-jump="site:calm-lake"]').count(),1);
  await page.click('#generatingStationDetails [data-site-jump="site:calm-lake"]');
  await page.waitForFunction(()=>window.NorthstarModules.state.sections.operations.active==='operations:site:calm-lake');
  await page.waitForSelector('#operationsSite-calm-lake:visible');
  await page.click('#sideNav [data-tab="overview"]');await card.hover();
  await page.waitForTimeout(800);
  assert.equal(await page.locator('#generatingStationDetails').isVisible(),false,'Station hover does not open plant details');
  await card.click();
  await page.waitForSelector('#generatingStationDetails:visible');
  assert.equal(errors.filter(message=>/operationsSite|operations:site|generatingStation/i.test(message)).length,0,errors.join('\n'));
  console.log('PASS Operations > Sites hierarchy, per-site tabs, card click and popup jump navigation');
 }finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});
