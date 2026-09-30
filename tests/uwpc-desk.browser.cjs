/* End-to-end: real fixture DB/auth/API, mocked inference only; no live operational writes. */
const {chromium}=require('playwright');
const {spawn}=require('node:child_process');
const path=require('node:path'),fs=require('node:fs'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..');
(async()=>{
 const child=spawn('python',['-u','tests/uwpc-desk-fixture.py'],{cwd:root,windowsHide:true,stdio:['ignore','pipe','pipe']});
 let browser;
 try {
  const port=await new Promise((resolve,reject)=>{let output='';const timer=setTimeout(()=>reject(Error('Fixture startup timed out')),20000);child.stdout.on('data',chunk=>{output+=chunk;const match=output.match(/\{"port": (\d+)\}/);if(match){clearTimeout(timer);resolve(Number(match[1]));}});child.on('exit',code=>reject(Error('Fixture exited '+code)));});
  const origin=`http://127.0.0.1:${port}`;
  browser=await chromium.launch({channel:'msedge',headless:true});
  const author=await browser.newContext({viewport:{width:1500,height:1000}}),reviewer=await browser.newContext({viewport:{width:1500,height:1000}});
  for(const [context,user] of [[author,'fixture_author'],[reviewer,'fixture_operator']]) {
   const login=await context.request.post(origin+'/api/auth/login',{data:{username:user,password:'fixture-only-password'}});assert.equal(login.status(),200);
   // No unrelated upstream feeds; UWPC/auth/switching routes use the real fixture server.
   await context.route('**/api/**',route=>{
    const p=new URL(route.request().url()).pathname;
    if(p.startsWith('/api/uwpc')||p.startsWith('/api/auth')||p.startsWith('/api/switching'))return route.continue();
    return route.fulfill({status:503,contentType:'application/json',body:'{"error":"unrelated test feed"}'});
   });
  }
  const page=await author.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(origin+'/northstar-clean.html');
  await page.waitForFunction(()=>window.NorthstarModules?.registry.has('outages:uwpc'));
  await page.evaluate(()=>window.NorthstarModules.open('outages:uwpc'));
  await page.locator('#uwpcDeskStatus').filter({hasText:'Ready.'}).waitFor();
  assert.equal(await page.evaluate(()=>[...window.NorthstarModules.registry.keys()].filter(x=>x.startsWith('outages:switching-')).length),0);
  await page.getByRole('button',{name:'+ New',exact:true}).click();
  for(const [name,value] of Object.entries({title:'Fixture supporting guarantee',site:'Test station',asset:'F1',diagramRevision:'TEST-1',scope:'Request review of the fixture feeder diagram',authority:'Fixture authority'}))await page.locator(`#uwpcRequestForm [name="${name}"]`).fill(value);
  await page.getByRole('button',{name:'Create request',exact:true}).click();
  await page.locator('#uwpcDeskStatus').filter({hasText:'Request saved.'}).waitFor();
  await page.locator('#uwpcSourceUpload').setInputFiles({name:'fixture.json',mimeType:'application/json',buffer:Buffer.from('{"symbols":[{"id":"F1","type":"feeder"}]}')});
  await page.getByRole('button',{name:'Attach',exact:true}).click();
  await page.locator('#uwpcDeskStatus').filter({hasText:'Source saved'}).waitFor();
  await page.getByRole('button',{name:'Generate proposal from diagram'}).click();
  await page.locator('#uwpcDeskStatus').filter({hasText:'Proposal generated'}).waitFor();
  await page.locator('[name="uwpcReviewer"][value="fixture_operator"]').check();
  await page.getByRole('button',{name:'Send to operator inbox'}).click();
  await page.locator('#uwpcDeskStatus').filter({hasText:'Delivered'}).waitFor();
  const review=await reviewer.newPage();await review.goto(origin+'/northstar-clean.html');
  await review.waitForFunction(()=>window.NorthstarModules?.registry.has('outages:uwpc'));
  await review.evaluate(()=>window.NorthstarModules.open('outages:uwpc'));
  await review.locator('#uwpcOperatorInbox button').first().click();
  await review.locator('#uwpcDecisionComment').fill('Synthetic fixture reviewed against attached revision.');
  await review.locator('#uwpcReviewed').check();
  await review.getByRole('button',{name:'Sign off as fixture_operator'}).click();
  await review.locator('#uwpcDeskStatus').filter({hasText:'review decision was recorded'}).waitFor();
  assert.equal(await review.locator('#uwpcInboxCount').innerText(),'0');
  await review.locator('#uwpcPlanPhase').selectOption('ACTIVE');await review.getByRole('button',{name:'Update lifecycle'}).click();
  await review.locator('#uwpcDeskStatus').filter({hasText:'lifecycle updated'}).waitFor();
  await review.locator('#uwpcPlanPhase').selectOption('COMPLETED');await review.getByRole('button',{name:'Update lifecycle'}).click();
  await review.locator('#uwpcPastPlans').filter({hasText:'Fixture supporting guarantee'}).waitFor();
  await review.locator('#uwpcCorrespondenceForm [name="message"]').fill('Fixture authority response recorded.');
  await review.getByRole('button',{name:'Record correspondence'}).click();
  await review.locator('#uwpcAuthorityRecords').filter({hasText:'Fixture authority response'}).waitFor();
  const output=path.join(root,'outputs','UWPC');fs.mkdirSync(output,{recursive:true});
  await review.getByRole('button',{name:'Close',exact:true}).click();
  await review.evaluate(()=>{window.scrollTo(0,0);document.querySelectorAll('*').forEach(e=>{if(e.scrollTop)e.scrollTop=0;});});
  await review.screenshot({path:path.join(output,'uwpc-fixture-desktop.png'),fullPage:false});
  await review.setViewportSize({width:390,height:844});
  const overflow=await review.locator('#uwpcDesk').evaluate(e=>e.scrollWidth>e.clientWidth+2);
  assert.equal(overflow,false,'UWPC module must fit its mobile container');
  await review.screenshot({path:path.join(output,'uwpc-fixture-mobile.png'),fullPage:false});
  await review.reload();await review.waitForFunction(()=>window.NorthstarModules?.registry.has('outages:uwpc'));await review.evaluate(()=>window.NorthstarModules.open('outages:uwpc'));
  await review.locator('#uwpcPastPlans').filter({hasText:'Fixture supporting guarantee'}).waitFor();
  console.log(JSON.stringify({result:'PASS: create, attach, generate, route, separate-operator sign-off, lifecycle, correspondence, reload',pageErrors:errors}));
 } finally {if(browser)await browser.close();child.kill();}
})().catch(e=>{console.error(e);process.exitCode=1;});
