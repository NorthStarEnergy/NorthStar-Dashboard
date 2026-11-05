const {chromium}=require('C:/Users/User/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const fs=require('fs'),path=require('path'),assert=require('assert/strict');
(async()=>{
 const browser=await chromium.launch({channel:'msedge',headless:true});
 try{
  const page=await browser.newPage({viewport:{width:390,height:844},serviceWorkers:'block'});
  let record=null,posts=[],manualFail=false,helpFail=false,holdManual=false,finishManual=null;
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  const recordAt=(elapsed=0)=>{
   const now=Date.now(),last=now-elapsed*60000;
   return {...record,serverTime:new Date(now).toISOString(),lastHeard:new Date(last).toISOString(),lastSafetyCheckinAt:new Date(last).toISOString(),safetyDueAt:new Date(last+3600000).toISOString(),safetyReminderAt:new Date(last+3300000).toISOString()};
  };
  await page.route('**/*',async route=>{
   const url=new URL(route.request().url()),method=route.request().method();
   if(!url.pathname.startsWith('/api/'))return route.fulfill({contentType:'text/html',body:fs.readFileSync(path.join(__dirname,'../contractor-checkin.html'),'utf8')});
   let data=record,status=200;
   if(method==='POST')posts.push(url.pathname);
   if(url.pathname==='/api/checkin-tokens/resolve')data={site:'Kenora'};
   else if(url.pathname==='/api/checkins'&&method==='POST'){
    record={...route.request().postDataJSON(),id:'fixture-visit',safetyProtocol:1,status:'on-site',needsHelp:false,operatorCallingConfigured:false,operatorPhone:null};record=recordAt();data=record;status=201;
   }else if(url.pathname.endsWith('/safety-checkin')){
    if(manualFail){status=503;data={error:'offline'}}else{
     record=recordAt();data=record;
     if(holdManual){finishManual=()=>route.fulfill({status,json:data});return}
    }
   }else if(url.pathname.endsWith('/help')){
    if(helpFail){status=503;data={error:'offline'}}else{record={...record,needsHelp:true,helpState:'requested'};data=record}
   }else if(method==='DELETE'){record={...record,status:'checked-out'};data=record}
   return route.fulfill({status,json:data});
  });
  await page.clock.install();
  await page.goto('http://worker.fixture/contractor-checkin.html?token=fixture');
  await page.locator('#name').fill('Test Worker');await page.locator('#company').fill('Test Crew');await page.locator('#alone').check();await page.locator('#submit').click();
  await page.waitForFunction(()=>!document.querySelector('#safetyPanel').hidden);
  assert.equal(await page.locator('#safetyCheckin').isEnabled(),true);
  assert.equal(await page.locator('#operatorCall').getAttribute('href'),null);
  assert.equal(await page.locator('#operatorCall').getAttribute('aria-disabled'),'true');
  await page.evaluate(()=>{
   window.fixtureNotices=[];
   window.Notification=class{static permission='granted';static async requestPermission(){return 'granted'}constructor(title,options){window.fixtureNotices.push({title,options})}};
  });
  await page.evaluate(()=>clearInterval(watch));await page.clock.fastForward(55*60000);
  assert.equal(await page.locator('#safetyPanel').getAttribute('data-stage'),'1');
  assert.equal(await page.evaluate(()=>notificationStage),1);
  await page.waitForFunction(()=>window.fixtureNotices.length===1);
  await page.clock.fastForward(5*60000);
  assert.equal(await page.locator('#safetyPanel').getAttribute('data-stage'),'2');
  await page.waitForFunction(()=>window.fixtureNotices.length===2);
  assert.equal(await page.evaluate(()=>window.fixtureNotices[1].options.requireInteraction),true);
  assert(!posts.some(url=>url.endsWith('/heartbeat')),'No automatic heartbeat POSTs');
  // A failed confirmation must not reset the timer.
  manualFail=true;await page.locator('#safetyCheckin').click();
  await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('NOT CONFIRMED'));
  assert.equal(await page.locator('#safetyPanel').getAttribute('data-stage'),'2');
  manualFail=false;await page.locator('#safetyCheckin').click();
  await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('CONFIRMED BY SERVER'));
  assert.equal(await page.locator('#safetyPanel').getAttribute('data-stage'),'0');
  assert.equal(posts.filter(url=>url.endsWith('/safety-checkin')).length,2);
  // Resume after missed ticks catches the current deadline, without resetting it.
  record=recordAt(61);await page.evaluate(()=>refreshActive());
  assert.equal(await page.locator('#safetyPanel').getAttribute('data-stage'),'2');
  const key=await page.evaluate(()=>notificationKey);await page.reload();
  await page.waitForFunction(()=>!document.querySelector('#safetyPanel').hidden);
  assert.equal(await page.evaluate(()=>notificationKey),key);
  assert.equal(await page.evaluate(()=>notificationStage),2);
  // Configured flow opens a dialer and raises help; prevent actual external dialing in this test.
  await page.evaluate(()=>{
   active.operatorPhone='+14165550123';active.operatorCallingConfigured=true;renderActive();
   document.querySelector('#operatorCall').addEventListener('click',e=>e.preventDefault());
  });
  assert.equal(await page.locator('#operatorCall').getAttribute('href'),'tel:+14165550123');
  await page.locator('#operatorCall').click();
  await page.waitForFunction(()=>document.querySelector('#help').textContent==='HELP REQUEST SENT');
  assert((await page.locator('#callStatus').innerText()).includes('Connection is not verified'));
  record={...record,needsHelp:false,helpState:'none'};await page.evaluate(()=>refreshActive());
  // Help failure is visible; help and manual confirmation are independent.
  helpFail=true;await page.locator('#help').click();
  await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('HELP REQUEST FAILED'));
  helpFail=false;await page.locator('#help').click();
  await page.waitForFunction(()=>document.querySelector('#help').textContent==='HELP REQUEST SENT');
  await page.locator('#safetyCheckin').click();
  await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('CONFIRMED BY SERVER'));
  assert.equal(await page.locator('#help').innerText(),'HELP REQUEST SENT');
  await page.screenshot({path:path.join(__dirname,'worker-active.png'),fullPage:true});
  // A late manual response must not resurrect a checked-out visit.
  holdManual=true;await page.locator('#safetyCheckin').click();
  await page.waitForTimeout(100);assert(finishManual);
  await page.locator('#submit').click();await page.waitForFunction(()=>document.querySelector('#safetyPanel').hidden);
  await finishManual();await page.waitForTimeout(100);
  assert.equal(await page.locator('#submit').innerText(),'CHECK IN');
  assert.equal(await page.locator('#safetyPanel').isHidden(),true);
  assert.deepEqual(errors,[]);
  console.log('PASS: 55/60 deadlines, failed reset, successful reset, no background confirmations, resume/reload deduplication, dummy calling disabled, help failures and persistence, checkout race; no browser errors.');
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
