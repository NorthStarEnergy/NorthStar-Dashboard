const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
(async()=>{
 const browser=await chromium.launch({channel:'msedge',headless:true});
 try {
  const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  const records=Array.from({length:101},(_,i)=>({eventId:'e'+i,summary:'Record '+i,occurredAt:'2026-10-04T10:00:00Z',source:'logbook',payload:{},severity:'info'}));
  records.push({eventId:'scada',summary:'Late page SCADA',source:'scada',payload:{system:'S+'},severity:'critical'},
   {eventId:'ssc',summary:'SSC outage',source:'ssc',payload:{subcategory:'outage'},severity:'info'},
   {eventId:'phone',summary:'Call',source:'phone',payload:{},severity:'info'});
  await page.route('**/api/events/register?**',route=>{const offset=Number(new URL(route.request().url()).searchParams.get('cursor')||0);return route.fulfill({json:{items:records.slice(offset,offset+100),total:records.length,nextCursor:offset+100<records.length?String(offset+100):null,fetchedAt:'2026-10-04T10:00:00Z'}})});
  await page.goto('about:blank');
  await page.setContent('<section id="logbook" class="active"><div id="eventRegister"><button id="erWrite">Write</button><form id="erFilters"></form></div><div class="logbook-card"><div class="logbook-fields"><input id="logSubject"></div><div id="logList"></div></div><div class="logbook-report"></div></section>');
  await page.route('**/event-log-test',r=>r.fulfill({body:'<html></html>',contentType:'text/html'}));
  // Give relative API requests an origin without touching any live endpoint.
  await page.evaluate(()=>{const base=document.createElement('base');base.href='http://fixture.test/';document.head.append(base)});
  await page.addScriptTag({content:fs.readFileSync(path.join(__dirname,'../event-log-modules.js'),'utf8')});
  await page.waitForFunction(()=>document.querySelector('#elFreshness')?.textContent.startsWith('Updated'));
  assert.match(await page.locator('#elRowStatus').innerText(),/104 matching/);
  await page.locator('[data-el-category="SCADA"]').click();
  assert.equal(await page.locator('#elRows article').count(),1);
  await page.locator('[data-el-child="S+"]').click();assert.equal(await page.locator('#elRows article').count(),1);
  await page.locator('[data-el-child="WONDERWARE"]').click();assert.equal(await page.locator('#elRows article').count(),0);
  await page.locator('[data-el-category="SCADA"]').click();assert.equal(await page.locator('#elRows article').count(),1);
  await page.locator('[data-el-category="COMS"]').click();await page.locator('[data-el-child="PHONE"]').click();assert.equal(await page.locator('#elRows article').count(),1);
  await page.locator('[data-el-category="CRITICAL"]').click();assert.equal(await page.locator('#elRows article').count(),1);assert.equal(await page.locator('#elSubcategories').isVisible(),false);
  await page.locator('#elNew').click();assert.equal(await page.locator('dialog').isVisible(),true);await page.locator('#elClose').click();assert.equal(await page.locator('dialog').isVisible(),false);
  await page.locator('[data-el-category="ALL"]').click();assert.equal(await page.locator('#elRows article').count(),100);await page.locator('#elMore').click();assert.equal(await page.locator('#elRows article').count(),104);
  assert.deepEqual(errors,[]);console.log('PASS full-history filtering, parent/child reset, critical, modal, display paging');
 } finally {await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
