const { chromium } = require(process.env.NORTHSTAR_PLAYWRIGHT_MODULE || 'playwright');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch({channel:'msedge',headless:true});
 try {
  for(const width of [1440,390]){
   const page=await browser.newPage({viewport:{width,height:900}});let state='ready',posts=0,fail=false;
   await page.route('http://research.test/**',async route=>{
    const url=new URL(route.request().url());let data;
    if(url.pathname==='/api/daily-report/refresh'){posts++;if(fail)return route.fulfill({status:400,json:{error:'Please wait two minutes between refreshes'}});state='running';data={id:'a'.repeat(32),state};}
    else if(url.pathname==='/api/daily-report/status')data={configured:true,runs:[{id:'a'.repeat(32),state,day:'2026-10-19'}]};
    else if(url.pathname==='/api/daily-report/run')data={captures:Array.from({length:13},()=>({status:'captured'}))};
    else return route.fulfill({contentType:'text/html',body:'<html><body class="research-standalone"><main data-research-root></main></body></html>'});
    return route.fulfill({json:data});
   });
   await page.goto('http://research.test/');
   await page.addStyleTag({path:'research-workspace.css'});
   await page.addScriptTag({path:'research/catalog.js'});
   await page.addScriptTag({path:'research-workspace.js'});
   const button=page.locator('[data-report-capture]'),status=page.locator('[data-report-status]');
   await page.waitForFunction(()=>document.querySelector('[data-report-status]').textContent.includes('13/13'));
   await button.click();assert.equal(posts,1);assert.equal(await button.isDisabled(),true);
   state='partial';await page.waitForFunction(()=>document.querySelector('[data-report-status]').textContent.includes('13/13'));
   assert.equal(await button.isDisabled(),false);
   fail=true;await button.click();await page.waitForFunction(()=>document.querySelector('[data-report-status]').textContent.includes('two minutes'));
   assert.equal(await button.isDisabled(),false);assert.equal(posts,2);
   assert.equal(await page.locator('.research-report-actions a').getAttribute('href'),'daily-report-automation.html');
   const bounds=await button.boundingBox();assert(bounds.width>100&&bounds.height>=44&&bounds.x>=0&&bounds.x+bounds.width<=width);
   assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
   await page.screenshot({path:path.join('outputs/research-report-button-20261019',`research-${width}.png`),fullPage:true});
   await page.close();
  }
  console.log('PASS: desktop/mobile button, one POST per click, busy state, completion, provider cooldown error, results link, no horizontal overflow. Fixture API only.');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
