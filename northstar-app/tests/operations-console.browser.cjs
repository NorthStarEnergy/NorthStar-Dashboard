const {chromium}=require('playwright');
const {spawn}=require('node:child_process');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),out=path.join(root,'outputs','operations-console');
fs.mkdirSync(out,{recursive:true});
const fixture=fs.mkdtempSync(path.join(out,'fixture-'));
const server=spawn('python',['-u','-c',`import os
import northstar_store as s
s.init_db()
import ieso_backend as b
b.OPERATOR_GATE='off'
b.CHECKIN_ORIGIN=''
server=b.NorthstarHTTPServer(('127.0.0.1',0), b.Handler)
print('READY:'+str(server.server_port),flush=True)
server.serve_forever()`],{cwd:root,env:{...process.env,NORTHSTAR_DB:path.join(fixture,'test.db')}});
let errors='';server.stderr.on('data',b=>errors+=b.toString());
async function stub(context){await context.route('**/api/**',route=>{
 const p=new URL(route.request().url()).pathname;
 if(p.startsWith('/api/console/'))return route.continue();
 return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(p==='/api/auth/session'?{required:false}:{items:[],stations:[]})});
});}
(async()=>{
 let browser;
 try{
  const port=await new Promise((resolve,reject)=>{let buf='';const timeout=setTimeout(()=>reject(Error('Fixture not ready: '+errors)),20000);server.stdout.on('data',b=>{buf+=b;const match=buf.match(/READY:(\d+)/);if(match){clearTimeout(timeout);resolve(match[1]);}});server.on('exit',()=>reject(Error(errors)));});
  browser=await chromium.launch({channel:'msedge',headless:true});
  const a=await browser.newContext({viewport:{width:1440,height:1000}}),b=await browser.newContext({viewport:{width:1440,height:1000}});
  await stub(a);await stub(b);
  const page=await a.newPage(),second=await b.newPage();
  page.setDefaultTimeout(15000);second.setDefaultTimeout(15000);
  const runtimeErrors=[];page.on('pageerror',e=>{if(/operations-console/.test(e.stack||''))runtimeErrors.push(e.message);});
  const url=`http://127.0.0.1:${port}/northstar-clean.html?nsDevelopment=overview`;
  await page.goto(url);console.log('fixture loaded');await page.waitForFunction(()=>window.NorthstarModules?.registry.has('logbook:operationsConsole'));
  await page.getByRole('button',{name:'Operations',exact:true}).click();
  await page.locator('[data-open-module="operations:tasks"]').click();
  await page.locator('#operationsTasks [data-oc-filter=tasks][aria-pressed=true]').waitFor({state:'visible'});
  assert.equal(await page.locator('#operationsTasks [data-oc-status]').isVisible(),true);
  await page.screenshot({path:path.join(out,'tasks-menu-fixture.png')});
  await page.evaluate(()=>NorthstarModules.open('logbook:operationsConsole'));
  const full=page.locator('#operationsConsole');
  await full.locator('[data-oc-create]').waitFor({state:'visible'});
  await page.waitForFunction(()=>!document.querySelector('#operationsConsole [data-oc-create]').disabled);
  await full.locator('[data-oc-create]').click();
  await page.getByLabel('Title',{exact:true}).fill('Console fixture task');
  await page.locator('#operationsConsoleDialog').getByLabel('Station',{exact:true}).selectOption('site:iroquois-falls');
  await page.locator('#operationsConsoleDialog button[type=submit]').click();
  await page.waitForSelector('#operationsConsoleDialog',{state:'detached'});
  await full.locator('[data-oc-filter=tasks]').click();
  await full.locator('[data-oc-list] .oc-row').filter({hasText:'Console fixture task'}).waitFor();
  await second.goto(url);await second.waitForFunction(()=>window.NorthstarModules?.registry.has('logbook:operationsConsole'));
  await second.evaluate(()=>NorthstarModules.open('logbook:operationsConsole'));
  await second.waitForFunction(()=>document.querySelector('#operationsConsole [data-oc-health]').textContent.startsWith('Updated'));
  await second.locator('#operationsConsole [data-oc-filter=tasks]').click();
  await second.locator('#operationsConsole [data-oc-list] .oc-row').filter({hasText:'Console fixture task'}).waitFor();
  await page.reload();await page.waitForFunction(()=>window.NorthstarModules?.registry.has('logbook:operationsConsole'));
  await page.evaluate(()=>NorthstarModules.open('logbook:operationsConsole'));
  await page.waitForFunction(()=>document.querySelector('#operationsConsole [data-oc-health]').textContent.startsWith('Updated'));
  await full.locator('[data-oc-filter=tasks]').click();
  await full.locator('[data-oc-list] .oc-row').filter({hasText:'Console fixture task'}).click();
  await page.getByRole('button',{name:'Complete',exact:true}).click();
  await page.getByRole('button',{name:'Confirm complete',exact:true}).click();
  await page.waitForSelector('#operationsConsoleDialog',{state:'detached'});
  await second.locator('#operationsConsole [data-oc-list] .oc-row').filter({hasText:'Console fixture task'}).waitFor({state:'detached',timeout:15000});
  const split=await full.locator('.oc-body').evaluate(el=>{const a=el.querySelector('aside');return a.getBoundingClientRect().width/el.getBoundingClientRect().width;});
  assert.ok(split>=.15&&split<=.20, 'Feed fraction '+split);
  await full.locator('[data-oc-toggle]').click();assert.equal(await full.locator('aside').isVisible(),false);
  await full.locator('[data-oc-toggle]').click();
  await full.locator('[data-oc-filter=all]').click();
  await page.screenshot({path:path.join(out,'console-full-fixture.png')});
  await page.getByRole('button',{name:'Overview',exact:true}).click();
  if(await page.locator('#overviewFieldTracker .ns-field-tracker-popout').isVisible()){
   const opened=page.waitForEvent('popup');await page.locator('#overviewFieldTracker .ns-field-tracker-popout').click();const popup=await opened;
   await page.locator('#overviewOperationsConsole').waitFor({state:'visible'});
   assert.equal(await page.locator('#overviewFieldTracker').isVisible(),false);
   await popup.close();await page.locator('#overviewOperationsConsole').waitFor({state:'hidden'});
   assert.equal(await page.locator('#overviewFieldTracker').isVisible(),true);
  }
  const trackerBox=await page.locator('#overviewStaff').boundingBox();
  const fixedOpened=page.waitForEvent('popup');await page.getByRole('button',{name:'Open fixed dashboard in a full-screen window',exact:true}).click();const fixed=await fixedOpened;
  await page.locator('#overviewOperationsConsole').waitFor({state:'visible'});
  assert.equal(await page.locator('#overviewStaff').isVisible(),false);
  await page.waitForFunction(()=>document.querySelector('#overviewOperationsConsole .oc-toolbar').getBoundingClientRect().top>=document.querySelector('#nsStatusBar').getBoundingClientRect().bottom);
  const compactTop=await page.locator('#overviewOperationsConsole .oc-toolbar').boundingBox();
  const statusBox=await page.locator('#nsStatusBar').boundingBox();
  const replacementBox=await page.locator('#overviewOperationsConsole').boundingBox();
  console.log({trackerBox,replacementBox});
  assert.ok(Math.abs(replacementBox.width-trackerBox.width)<2,'Replacement preserves tracker width');
  assert.ok(Math.abs(replacementBox.y-trackerBox.y)<2,'Replacement preserves tracker position');
  assert.ok(compactTop.y>=statusBox.y+statusBox.height,'Console controls must sit below fixed status');
  await page.screenshot({path:path.join(out,'console-overview-fixture.png')});
  await fixed.close();await page.locator('#overviewOperationsConsole').waitFor({state:'hidden'});
  await page.evaluate(()=>NorthstarModules.open('logbook:operationsConsole'));
  await page.setViewportSize({width:390,height:844});
  assert.equal(await full.locator('aside').isVisible(),false);
  await full.locator('[data-oc-create]').click();assert.equal(await page.locator('#operationsConsoleDialog').isVisible(),true);
  await page.getByRole('button',{name:'Close console dialog',exact:true}).click();
  assert.deepEqual(runtimeErrors,[]);
  console.log('PASS: real SQLite creation/reload, separate-session sync/completion, 82/18 split, feed toggle, fixed worker popout/restore, mobile create and no console JS errors.');
 }finally{if(browser)await browser.close();server.kill();}
})().catch(e=>{console.error(e);process.exitCode=1;});
