const {chromium}=require('playwright');
const {spawn}=require('node:child_process');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),output=path.join(root,'outputs','uwpc-ai-intake');
(async()=>{
 const child=spawn('python',['-u','tests/uwpc-desk-fixture.py'],{cwd:root,windowsHide:true,stdio:['ignore','pipe','pipe'],env:{...process.env,TEMP:output,TMP:output}});
 let browser;
 try {
  const port=await new Promise((resolve,reject)=>{let log='';const timer=setTimeout(()=>reject(Error('Fixture timeout')),20000);child.stdout.on('data',b=>{log+=b;const m=log.match(/\{"port": (\d+)\}/);if(m){clearTimeout(timer);resolve(m[1]);}});child.on('exit',c=>{clearTimeout(timer);reject(Error('Fixture exit '+c));});child.stderr.on('data',()=>{});});
  const origin=`http://127.0.0.1:${port}`;
  browser=await chromium.launch({channel:'msedge',headless:true});
  const context=await browser.newContext({viewport:{width:1200,height:1000}});
  assert.equal((await context.request.post(origin+'/api/auth/login',{data:{username:'fixture_author',password:'fixture-only-password'}})).status(),200);
  const page=await context.newPage();
  await page.route('**/intake-test',r=>r.fulfill({contentType:'text/html',body:'<html><head><meta charset="utf-8"><link rel="stylesheet" href="/uwpc-desk.css"></head><body style="margin:0;background:#0d1720"><section id="switching"><div class="switching-workspace"></div></section><script src="/outage-package-review.js"></script><script src="/uwpc-desk.js"></script></body></html>'}));
  await page.goto(origin+'/intake-test');
  await page.locator('#uwpcDeskStatus').filter({hasText:'Ready.'}).waitFor();
  await page.locator('#uwpcIntakeForm [name=site]').fill('Synthetic station');
  await page.locator('#uwpcIntakeForm [name=scope]').fill('Prepare a draft plan and identify equipment for lockout review. Synthetic fixture only.');
  await page.locator('#uwpcIntakeForm [name=diagramRevision]').fill('TEST-1');
  await page.locator('#uwpcIntakeDiagram').setInputFiles({name:'fixture.txt',mimeType:'text/plain',buffer:Buffer.from('Synthetic drawing F1. No real equipment.')});
  await page.screenshot({path:path.join(output,'input-desktop.png'),fullPage:true});
  await page.getByRole('button',{name:'Analyze request',exact:true}).click();
  if(process.env.UWPC_TEST_MISSING_EVIDENCE){
    await page.locator('#uwpcDeskStatus').filter({hasText:'Evidence review required'}).waitFor();
    assert.match(await page.locator('#uwpcEditor').innerText(),/NOT ASSESSED/);
    assert.match(await page.locator('#uwpcEditor').innerText(),/Current reviewed UWPC Code/);
    assert.equal(await page.getByRole('button',{name:'Send to operator inbox'}).count(),0);
    await page.screenshot({path:path.join(root,'outputs','uwpc-evidence','evidence-hold.png'),fullPage:true});
    console.log('PASS: missing controlled evidence visibly blocks analysis and sign-off; no model call.');
    return;
  }
  await page.locator('#uwpcDeskStatus').filter({hasText:'AI draft ready'}).waitFor();
  assert.match(await page.locator('.uwpc-generated').innerText(),/SYNTHETIC TEST ONLY/);
  assert.equal(await page.getByRole('button',{name:'Send to operator inbox'}).count(),0);
  const rows=await page.evaluate(async()=> (await fetch('/api/uwpc/requests')).json());
  assert.equal(rows.requests?.length,1,JSON.stringify(rows));assert.equal(rows.requests[0].template,'pc17a');
  await page.getByRole('button',{name:'Close',exact:true}).click();
  await page.setViewportSize({width:390,height:844});
  await page.screenshot({path:path.join(output,'input-mobile.png'),fullPage:true});
  assert.equal(await page.locator('#uwpcDesk').evaluate(e=>e.scrollWidth>e.clientWidth+2),false);
  await page.locator('#uwpcIntakeForm [name=site]').fill('Synthetic station');
  await page.locator('#uwpcIntakeForm [name=scope]').fill('Missing drawing test.');
  await page.getByRole('button',{name:'Analyze request',exact:true}).click();
  await page.locator('#uwpcDeskStatus').filter({hasText:'Request saved. Attach a drawing'}).waitFor();
  await page.getByRole('button',{name:'Close',exact:true}).click();
  await page.locator('#uwpcIntakeForm [name=site]').fill('Synthetic station');
  await page.locator('#uwpcIntakeForm [name=scope]').fill('Generation failure recovery test.');
  await page.locator('#uwpcIntakeForm [name=diagramRevision]').fill('TEST-1');
  await page.locator('#uwpcIntakeDiagram').setInputFiles({name:'fixture.txt',mimeType:'text/plain',buffer:Buffer.from('Fixture')});
  await page.route('**/generate',r=>r.fulfill({status:503,contentType:'application/json',body:'{"error":"Synthetic inference unavailable"}'}));
  await page.getByRole('button',{name:'Analyze request',exact:true}).click();
  await page.locator('#uwpcDeskStatus').filter({hasText:'Continue in the saved package below'}).waitFor();
  assert.equal(await page.locator('#uwpcEditor').isVisible(),true);
  assert.equal(await page.getByRole('button',{name:'Analyze request',exact:true}).isEnabled(),true);
  console.log('PASS: real authenticated intake/create/upload/generate path (mock inference), missing drawing, failure recovery, mobile layout.');
 } finally {if(browser)await browser.close();child.kill();}
})().catch(e=>{console.error(e);process.exitCode=1;});
