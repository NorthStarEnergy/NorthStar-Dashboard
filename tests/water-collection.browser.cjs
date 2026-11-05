'use strict';
const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
(async()=>{
 const base=process.env.NORTHSTAR_DATA_TEST_URL;assert(base&&process.env.NORTHSTAR_DATA_TEST_COOKIE,'Use the disposable integration harness');
 const browser=await chromium.launch({headless:true,...(process.env.CI?{}:{channel:'msedge'})});
 try{
  const context=await browser.newContext({viewport:{width:1440,height:1050}});
  const raw=process.env.NORTHSTAR_DATA_TEST_COOKIE,i=raw.indexOf('=');
  await context.addCookies([{name:raw.slice(0,i),value:raw.slice(i+1),url:base,httpOnly:true,sameSite:'Lax'}]);
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(base+'/water-collection.html');await page.locator('#connection.ready').waitFor();
  assert.equal(await page.locator('.source-card').count(),3);
  assert.equal(await page.locator('#observationCount').textContent(),'0');
  const out=process.env.NORTHSTAR_WATER_SCREENSHOTS;
  if(out){fs.mkdirSync(out,{recursive:true});await page.screenshot({path:path.join(out,'water-collection-desktop.png'),fullPage:true});}
  await page.setViewportSize({width:390,height:844});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Mobile overflow');
  if(out)await page.screenshot({path:path.join(out,'water-collection-mobile.png'),fullPage:true});
  await page.setViewportSize({width:1440,height:1050});
  const card=page.locator('#source-wsc');
  await card.locator('[name=interval]').fill('60');await card.locator('[name=enabled]').uncheck();await card.locator('[type=submit]').click();
  await page.locator('#notice').filter({hasText:'Schedule saved'}).waitFor();
  assert.equal(await card.locator('[name=enabled]').isChecked(),false);
  await card.locator('[data-collect]').click();await page.locator('#notice').filter({hasText:'Collection queued'}).waitFor();
  await page.locator('[data-tab=runs]').click();await page.locator('.collection-run').filter({hasText:'completed'}).waitFor({timeout:15000});
  await page.locator('[data-tab=observations]').click();await page.locator('#observations tbody tr').waitFor();
  assert.equal(await page.locator('#observations tbody tr').count(),1);
  await page.locator('#observations tbody tr').click();await page.locator('#observationHistory').filter({hasText:'Revision 1'}).waitFor();
  await page.locator('#closeHistory').click();
  await page.locator('#metricFilter').selectOption('discharge');await page.locator('#applyFilters').click();await page.locator('#emptyObservations').waitFor();
  await page.locator('#clearFilters').click();await page.locator('#observations tbody tr').waitFor();
  const download=page.waitForEvent('download');await page.locator('#exportPage').click();assert.match((await download).suggestedFilename(),/northstar-public-water-page-1.csv/);
  await page.reload();await page.locator('#connection.ready').waitFor();assert.equal(await page.locator('#source-wsc [name=interval]').inputValue(),'60');assert.equal(await page.locator('#source-wsc [name=enabled]').isChecked(),false);
  assert.equal(await page.locator('#observationCount').textContent(),'1');assert.deepEqual(errors,[]);
  console.log('Water collection rendered controls passed: providers, desktop/mobile, schedule persistence, paused on-demand run, history, filters, CSV and revisions.');
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
