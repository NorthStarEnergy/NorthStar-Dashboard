const assert=require('node:assert/strict');
const path=require('node:path');
const {chromium}=require('playwright');

(async()=>{
  const browser=await chromium.launch({channel:'msedge',headless:true}).catch(()=>chromium.launch({headless:true}));
  try{
    const page=await browser.newPage({viewport:{width:1100,height:800}});
    const now=Date.now();
    await page.setContent('<div id="nsStatusBar"><section class="ns-status-module" data-status="dispatch"><span data-asset-id="output-value"><small>Output</small><strong>41.5</strong></span></section></div><main><section class="section active" id="overview"><div data-module-id="custom:meter"><small>Flow</small><strong>12.0 MW</strong><p data-asset-id="note">Operator note</p></div></section></main>');
    await page.evaluate(now=>{
      window.NorthstarOverview={feeds:{dispatch:{data:{outputMw:41.5,dispatchMw:42,history:[{time:new Date(now-3600000).toISOString(),outputMw:40,dispatchMw:42},{time:new Date(now).toISOString(),outputMw:41.5,dispatchMw:42}]}}}};
    },now);
    await page.addScriptTag({path:path.join(__dirname,'..','dashboard-asset-history.js')});
    await page.addScriptTag({path:path.join(__dirname,'..','dashboard-asset-inspector.js')});
    await page.addScriptTag({path:path.join(__dirname,'..','dashboard-context-menu.js')});
    await page.locator('[data-asset-id="output-value"] strong').click({button:'right'});
    await page.locator('#nsDashboardContextMenu [data-inspect]').click();
    await page.locator('#nsAssetInspector').waitFor();
    assert.match(await page.locator('#nsAssetInspector h2').textContent(),/Output/);
    assert.match(await page.locator('#nsAssetInspector dl').textContent(),/output-value/);
    assert.match(await page.locator('#nsAssetInspector dl').textContent(),/41.5/);
    await page.locator('#nsAssetInspector [data-history]').click();
    await page.locator('#nsAssetHistory').waitFor();
    assert.match(await page.locator('#nsAssetHistory h2').textContent(),/Output/);
    assert.match(await page.locator('#nsAssetHistory [data-count]').textContent(),/2 reading/);
    assert.equal(await page.locator('#nsAssetHistory svg path').count(),1);
    await page.locator('#nsAssetHistory [data-range="1"]').click();
    assert.equal(await page.locator('#nsAssetHistory [data-range="1"]').getAttribute('aria-pressed'),'true');
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#nsAssetHistory').count(),0);
    await page.locator('[data-module-id="custom:meter"] strong').click({button:'right'});
    await page.locator('#nsDashboardContextMenu [data-history]').click();
    assert.match(await page.locator('#nsAssetHistory [data-source]').textContent(),/this dashboard tab/);
    assert.match(await page.locator('#nsAssetHistory [data-count]').textContent(),/1 reading/);
    await page.locator('[data-module-id="custom:meter"] strong').evaluate(node=>{node.textContent='13.0 MW';window.dispatchEvent(new Event('northstar:feed-update'));});
    await page.waitForFunction(()=>document.querySelector('#nsAssetHistory [data-count]')?.textContent.includes('2 readings'));
    assert.match(await page.locator('#nsAssetHistory [data-current]').textContent(),/13/);
    await page.keyboard.press('Escape');
    await page.locator('[data-asset-id="note"]').click({button:'right'});
    assert.equal(await page.locator('#nsDashboardContextMenu [data-history]').count(),0);
    await page.locator('#nsDashboardContextMenu [data-inspect]').click();
    assert.match(await page.locator('#nsAssetInspector dl').textContent(),/Operator note/);
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#nsAssetInspector').count(),0);
    if(process.env.DASHBOARD_URL){
      const response=await page.goto(process.env.DASHBOARD_URL,{waitUntil:'domcontentloaded'});
      assert.equal(response.status(),200);
      await page.waitForFunction(()=>Boolean(window.NorthstarAssetHistory?.resolve));
      assert.equal(await page.locator('link[href*="dashboard-asset-history.css"]').count(),1);
      assert.equal(await page.locator('link[href*="dashboard-asset-inspector.css"]').count(),1);
      const liveAsset=page.locator('#nsStatusBar [data-asset-id="output-value"] strong');
      await liveAsset.waitFor({timeout:10000});
      await liveAsset.click({button:'right'});
      await page.locator('#nsDashboardContextMenu [data-inspect]').click();
      assert.match(await page.locator('#nsAssetInspector dl').textContent(),/output-value/);
    }
    console.log('Dashboard asset inspect and history right-click checks passed.');
    await page.close();
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
