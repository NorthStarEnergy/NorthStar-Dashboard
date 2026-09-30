/* Isolated drawing/telemetry fixtures; no operational APIs or real equipment. */
const {chromium} = require('playwright');
const http=require('node:http'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..');
const html=fs.readFileSync(path.join(root,'northstar-clean.html'),'utf8');
const section=html.slice(html.indexOf('<section class="panel one-line-editor"'),html.indexOf('<section class="panel engineering-sitemap"'));
const fixture=`<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="one-line-editor.css"><link rel="stylesheet" href="one-line-technical.css"><link rel="stylesheet" href="station-builder.css"><style>body{background:#101a22;margin:10px}*{box-sizing:border-box}</style></head><body>${section}<script src="one-line-symbol-library.js"></script><script src="one-line-live.js"></script><script src="one-line-editor-ui.js"></script></body></html>`;
let stored,position=1,quality='Good',age=0,unavailable=false;
const server=http.createServer(async(req,res)=>{
  const url=new URL(req.url,'http://local');
  const json=data=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify(data));};
  if(url.pathname==='/fixture'){res.setHeader('Content-Type','text/html');res.end(fixture);return;}
  if(url.pathname==='/api/outages')return json([]);
  if(url.pathname==='/api/schematics'&&req.method==='GET')return json(stored?[stored]:[]);
  if(url.pathname.startsWith('/api/schematics')&&req.method==='POST'){
    let body='';for await(const chunk of req)body+=chunk;
    stored={...JSON.parse(body),id:'fixture-drawing',revision:(stored?.revision||0)+1};return json(stored);
  }
  if(url.pathname==='/api/schematics/fixture-drawing')return json(stored);
  if(url.pathname==='/api/scada/readings'){
    if(unavailable){res.writeHead(503);res.end();return;}
    return json(url.searchParams.getAll('tag').map(tagName=>({feedCode:'test',siteCode:'TEST',tagName,numericValue:tagName==='MW'?12.5:position,unit:tagName==='MW'?'MW':'',sourceQuality:quality,observedAt:new Date(Date.now()-age).toISOString()})));
  }
  const target=path.resolve(root,'.'+url.pathname);
  if(!target.startsWith(root+path.sep)||!['.js','.css'].includes(path.extname(target))){res.writeHead(404);res.end();return;}
  res.setHeader('Content-Type',target.endsWith('.js')?'text/javascript':'text/css');res.end(fs.readFileSync(target));
});
(async()=>{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const browser=await chromium.launch({channel:'msedge',headless:true});
  const page=await browser.newPage({viewport:{width:1600,height:1100}});const errors=[];
  page.on('pageerror',error=>errors.push(error.message));page.on('dialog',dialog=>dialog.accept());
  const field=async(selector,value)=>{await page.locator(selector).fill(String(value));await page.locator(selector).dispatchEvent('change');};
  try {
    await page.goto(`http://127.0.0.1:${server.address().port}/fixture`);
    assert.equal(await page.locator('#oneLineCanvas .node').count(),0,'fresh builder starts blank');
    await page.click('[data-symbol-type="breaker"]');
    await field('[data-equipment="assetTag"]','52-A');await field('[data-equipment="siteCode"]','TEST');
    await field('[data-equipment="voltage"]','115 kV');await field('#oneLineLabel','Main breaker');
    await field('[data-binding="status"][data-field="feedCode"]','test');await field('[data-binding="status"][data-field="tagName"]','52A');
    await page.click('#oneLineAddValue');
    await field('[data-binding="0"][data-field="feedCode"]','test');await field('[data-binding="0"][data-field="tagName"]','MW');await field('[data-binding="0"][data-field="label"]','Power');
    await page.click('#oneLineDuplicate');
    assert.equal(await page.locator('#oneLineCanvas .node').count(),2);
    assert.equal(await page.locator('[data-equipment="assetTag"]').inputValue(),'');
    assert.equal(await page.locator('[data-binding="status"][data-field="tagName"]').inputValue(),'');
    await page.click('#oneLineUndo');assert.equal(await page.locator('#oneLineCanvas .node').count(),1);
    await page.click('#oneLineRedo');assert.equal(await page.locator('#oneLineCanvas .node').count(),2);
    await page.click('#oneLineUndo');
    await page.click('#oneLineValidate');assert.match(await page.locator('#oneLineValidation').textContent(),/no connections/);await page.click('#oneLineCloseValidation');
    await field('#oneLineName','Fixture station');await page.click('#oneLineSaveServer');
    await page.waitForFunction(()=>document.querySelector('#oneLineStatus').textContent.includes('backed up centrally'));
    assert.equal(stored.record.symbols[0].assetTag,'52-A');assert.equal(stored.record.symbols[0].measurements[0].tagName,'MW');
    await page.click('#oneLineSave');await page.reload();
    assert.equal(await page.locator('#oneLineCanvas .node').count(),1);
    assert.equal(await page.locator('#oneLineName').inputValue(),'Fixture station');
    await page.click('#oneLineMode');await page.waitForSelector('.feedback-closed');
    assert.match(await page.locator('.dynamic-value').textContent(),/12.5 MW/);
    assert.equal(await page.locator('.one-line-inspector').isVisible(),false);
    const before=await page.locator('#oneLineCanvas .node').getAttribute('data-symbol-id');
    await page.locator('#oneLineCanvas .node').click();assert.equal(await page.locator('#oneLineCanvas .selected').count(),0,'display cannot edit');
    position=0;await page.click('#oneLineRefresh');await page.waitForSelector('.feedback-open');
    quality='Bad';await page.click('#oneLineRefresh');await page.waitForSelector('.feedback-unknown');assert.match(await page.locator('.operating-state').textContent(),/QUALITY/);
    quality='Good';age=3600000;await page.click('#oneLineRefresh');await page.waitForFunction(()=>document.querySelector('.operating-state').textContent==='STALE');
    unavailable=true;await page.click('#oneLineRefresh');await page.waitForFunction(()=>document.querySelector('.operating-state').textContent==='UNAVAILABLE');
    unavailable=false;age=0;position=1;await page.click('#oneLineRefresh');await page.waitForSelector('.feedback-closed');
    const downloadPromise=page.waitForEvent('download');await page.click('#oneLineSnapshot');
    const download=await downloadPromise;const exported=fs.readFileSync(await download.path(),'utf8');
    assert.match(exported,/SCADA SNAPSHOT/);assert.match(exported,/12.5 MW/);
    fs.mkdirSync(path.join(root,'outputs','station-builder'),{recursive:true});
    await page.screenshot({path:path.join(root,'outputs','station-builder','display-fixture.png'),fullPage:true});
    await page.click('#oneLineMode');
    await page.click('#oneLineCanvas .node');
    assert.equal(await page.locator('[data-equipment="assetTag"]').inputValue(),'52-A');
    await page.click('[data-symbol-type="bus"]');
    await page.click('[data-symbol-type="connect"]');
    await page.locator(`#oneLineCanvas .node[data-symbol-id="${before}"]`).click();
    await page.locator('#oneLineCanvas .node').last().click();
    assert.equal(await page.locator('#oneLineCanvas path.wire').count(),1);
    await page.selectOption('#oneLineZoom','1.5');assert.match(await page.locator('#oneLineCanvas').getAttribute('style'),/150%/);await page.selectOption('#oneLineZoom','1');
    await page.click('[data-align-connected="y"]');
    await page.click('.one-line-extra summary');
    const templatePromise=page.waitForEvent('download');await page.click('#oneLineTemplate');
    const templateDownload=await templatePromise;const template=JSON.parse(fs.readFileSync(await templateDownload.path(),'utf8'));
    assert.equal(template.symbols[0].assetTag,'');assert.equal(template.symbols[0].scada.tagName,'');assert.equal(template.symbols[0].measurements[0].tagName,'');
    await page.click('.one-line-extra summary');
    await page.screenshot({path:path.join(root,'outputs','station-builder','builder-fixture.png'),fullPage:true});
    await page.setViewportSize({width:800,height:1000});
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'fits narrow viewport');
    assert.deepEqual(errors,[]);
    console.log('PASS: blank drawing, equipment/bindings, server/local reload, numeric values, open/closed, quality, stale, unavailable, display lock, connections, responsive layout, undo/redo, duplication clears bindings, drawing checks, zoom, snapshot export.');
  } finally {await browser.close();server.close();}
})().catch(error=>{console.error(error);process.exitCode=1;server.close();});
