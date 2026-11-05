const {chromium}=require('playwright');
const assert=require('node:assert/strict'),path=require('node:path'),fs=require('node:fs');
const root=path.resolve(__dirname,'..');
(async()=>{
 const browser=await chromium.launch({channel:'msedge',headless:true});
 try {
  const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.setContent('<html><body style="background:#101c27;color:#eef6fc"><div id="overviewGeneratingStations"><div class="generating-stations-grid"></div></div><section id="scada"></section></body></html>');
  await page.addStyleTag({path:path.join(root,'generating-station-cards.css')});
  await page.evaluate(()=>{
   window.fetch=async()=>({ok:true,json:async()=>[]});
   window.NorthStarSites={stations:()=>[],resolve:code=>({id:code==='IS'?'site:iroquois-falls':'site:calm-lake'})};
   const readings=[];
   const point=(displayName,numericValue,unit='',textValue='',siteCode='IS')=>readings.push({displayName,numericValue,unit,textValue,siteCode,feedCode:'test',observedAt:new Date().toISOString(),sourceQuality:'good'});
   point('Plant output',9.3,'MW');point('Headwater level',215.781,'m');point('Tailwater level',197.182,'m');point('Plant flow',81.6,'m3/s');point('Spill flow',5,'m3/s');point('Outflow',86.6,'m3/s');point('Generator count',4);point('Generators running',1);point('Main breaker',null,'','closed');point('Line switch',null,'','open');
   for(let n=1;n<=4;n++){point(`Unit ${n} output`,n===2?9.3:0,'MW');point(`Unit ${n} flow`,n===2?81.6:0,'m3/s');point(`Unit ${n} operating percentage`,n===2?80:0,'%');point(`Unit ${n} breaker`,null,'',n===2?'closed':'open');}
   point('Sluice gate 2 state',null,'','open');point('Sluice gate 2 position',1.2,'m');point('Sluice gate 2 discharge',5,'m3/s');
   point('Plant output',123,'MW','','CL');
   window.NorthstarOverview={feeds:{scada:{checked:Date.now(),data:{feeds:[{feedCode:'test',status:'Current'}],readings}}}};
  });
  for(const file of ['hover-window.js','station-one-line.js','generating-stations.js'])await page.addScriptTag({path:path.join(root,file)});
  const card=page.locator('[data-module-id="site:iroquois-falls"]');
  await card.focus();
  const popup=page.locator('#generatingStationDetails');
  await popup.waitFor({state:'visible'});
  assert.equal(await popup.locator('#gs-detail-title').count(),1);
  assert.equal(await popup.locator('.gs-jump').count(),1);
  assert.ok(await popup.locator('.gs-station-heading').evaluate(e=>Math.abs(e.getBoundingClientRect().top-e.closest('.gs-sld-panel').getBoundingClientRect().top)<=8));
  assert.equal(await popup.locator('.gs-sld-unit').count(),4);
  assert.match(await popup.locator('.gs-station-totals').innerText(),/215.781/);
  assert.match(await popup.locator('.gs-station-totals').innerText(),/86.6/);
  assert.match(await popup.locator('.gs-sld').textContent(),/9.30 MW.*81.6 m³\/s.*80.0%/);
  assert.match(await popup.locator('.gs-sld').textContent(),/230 kV.*I93S.*Generator Bus.*12.5 kV/);
  assert.equal(await popup.locator('.gs-sld .gs-sld-device[data-state="open"]').count(),3);
  assert.equal(await popup.locator('.gs-sld-generator[data-state="generating"] .gs-sld-generator-symbol').first().evaluate(e=>getComputedStyle(e).stroke),'rgb(32, 187, 85)');
  assert.equal(await popup.locator('.gs-sld-generator[data-state="offline"] .gs-sld-generator-symbol').first().evaluate(e=>getComputedStyle(e).stroke),'rgb(240, 79, 85)');
  assert.equal(await popup.locator('.gs-sld-device[data-state="closed"] path, .gs-sld-device[data-state="closed"] rect').first().evaluate(e=>getComputedStyle(e).stroke),'rgb(32, 187, 85)');
  assert.equal(await popup.locator('.gs-sld-device[data-state="open"] path, .gs-sld-device[data-state="open"] rect').first().evaluate(e=>getComputedStyle(e).stroke),'rgb(240, 79, 85)');
  assert.equal(await popup.locator('.gs-station-totals tbody tr').count(),4);
  assert.doesNotMatch(await popup.locator('.gs-station-totals').innerText(),/123/);
  const out=path.join(root,'outputs','station-one-line');fs.mkdirSync(out,{recursive:true});
  await popup.screenshot({path:path.join(out,'station-hover-fixture.png')});
  await page.evaluate(()=>{NorthstarOverview.feeds.scada.data.stale=true;dispatchEvent(new Event('northstar:feed-update'));});
  assert.doesNotMatch(await popup.locator('.gs-station-totals').innerText(),/215.781|86.6/);
  assert.equal(await popup.locator('.gs-sld .gs-sld-device[data-state="open"],.gs-sld .gs-sld-device[data-state="closed"]').count(),9);
  await page.evaluate(()=>{const f=NorthstarOverview.feeds.scada;f.data.stale=false;f.data.readings.push({...f.data.readings.find(r=>r.displayName==='Plant output'&&r.siteCode==='IS')});dispatchEvent(new Event('northstar:feed-update'));});
  assert.match(await popup.locator('.gs-station-totals dd').first().innerText(),/—/);
  await page.keyboard.press('Escape');await page.locator('[data-module-id="site:calm-lake"]').focus();
  assert.match(await popup.locator('.gs-layout-note').textContent(),/Demo single-line/);
  assert.equal(await popup.locator('.gs-sld-unit').count(),2);
  assert.equal(await popup.locator('.gs-sld-device').count(),6);
  assert.match(await popup.locator('.gs-station-totals').innerText(),/123.00/);
  const expected={'site:calm-lake':2,'site:sturgeon-falls':2,'site:fort-frances':8,'site:kenora':6,'site:norman':5,'site:twin-falls':5,'site:island-falls':12,'site:iroquois-falls':4,'site:old-woman-falls':2,'site:white-otter-rapids':2,'site:camp-three-rapids':2,'site:big-beaver-falls':2,'site:mcdougal':3,'site:okikendawt-gs':2,'site:cogeneration-plant':3,'site:aiyers-1':2,'site:aiyers-2':2,'site:bird-gs':2,'site:cogent':2};
  assert.equal(await page.locator('.gs-card').count(),Object.keys(expected).length);
  for(const [site,count] of Object.entries(expected)){
   await page.keyboard.press('Escape');await page.locator(`[data-module-id="${site}"]`).focus();
   assert.equal(await popup.locator('.gs-sld-unit').count(),count,site);
   assert.equal(await popup.locator('.gs-sld-device').count(),count+(site==='site:iroquois-falls'?5:4),site);
   assert.match(await popup.locator('.gs-layout-note').textContent(),site==='site:iroquois-falls'?/Sketch layout/:/Demo single-line/,site);
  }
  await page.keyboard.press('Escape');await page.locator('[data-module-id="site:okikendawt-gs"]').focus();
  assert.match(await popup.locator('.gs-station-heading h2').innerText(),/Demo readings/i);
  assert.doesNotMatch(await popup.locator('.gs-station-totals').innerText(),/MW output\s+— MW/);
  assert.match(await popup.locator('.gs-sld').textContent(),/G1.*MW.*m³\/s.*%/);
  await popup.screenshot({path:path.join(out,'okikendawt-demo.png')});
  await page.keyboard.press('Escape');await page.locator('[data-module-id="site:cogeneration-plant"]').focus();
  assert.match(await popup.locator('.gs-station-totals').innerText(),/Headwater\s+N\/A/);
  assert.equal(await popup.locator('.gs-station-totals h3').count(),1);
  await page.setViewportSize({width:390,height:844});
  assert.ok(await popup.evaluate(e=>e.getBoundingClientRect().width<=innerWidth));
  assert.deepEqual(errors,[]);
  console.log('PASS: station isolation, symbols, unit metrics, totals, gates, stale and duplicate rejection, demo layouts from station unit counts, narrow viewport.');
 } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});

