/* Read-only browser verification for the Overview Field Tracker swap lifecycle. */
const {chromium}=require('playwright');
const http=require('node:http'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..');
(async()=>{
 const server=http.createServer((req,res)=>{
  const file=path.resolve(root,'.'+new URL(req.url,'http://localhost').pathname);
  if(!file.startsWith(root+path.sep)||!['.html','.js','.css','.svg','.png','.ico'].includes(path.extname(file))){res.writeHead(404);return res.end();}
  fs.readFile(file,(error,data)=>{res.writeHead(error?404:200,{'Content-Type':{'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml'}[path.extname(file)]||'application/octet-stream'});res.end(error?'':data);});
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const browser=await chromium.launch({channel:'msedge',headless:true});
 const page=await browser.newPage({viewport:{width:1440,height:1000}});
 await page.context().route('**/api/**',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(new URL(route.request().url()).pathname==='/api/auth/session'?{required:false}:{items:[],stations:[]})}));
 try{
  await page.goto(`http://127.0.0.1:${server.address().port}/northstar-clean.html?nsDevelopment=overview`);
  await page.waitForSelector('#overviewFieldTracker .ns-field-tracker-popout:visible');
  const opened=page.waitForEvent('popup');
  await page.locator('#overviewFieldTracker .ns-field-tracker-popout').click();
  const popup=await opened;
  try{await popup.waitForSelector('body.ns-module-popout',{timeout:10000});}
  catch(error){console.error({url:popup.url(),bodyClass:await popup.locator('body').getAttribute('class'),title:await popup.title()});throw error;}
  assert.equal(await page.locator('body.ns-field-tracker-popped').count(),1);
  assert.equal(await page.locator('#overviewFieldTracker:visible').count(),0);
  assert.equal(await page.locator('#eventsCard:visible').count(),1);
  assert.equal(await page.locator('#eventsCard').getAttribute('data-field-tracker-replacement'),'1');
  await popup.close();
  await page.waitForFunction(()=>!document.body.classList.contains('ns-field-tracker-popped'));
  assert.equal(await page.locator('#overviewFieldTracker:visible').count(),1);
  assert.equal(await page.locator('#eventsCard').getAttribute('data-field-tracker-replacement'),null);
  console.log('Field Tracker browser checks passed: pop-out, Event Log replacement, close restore.');
 }finally{await browser.close();server.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
