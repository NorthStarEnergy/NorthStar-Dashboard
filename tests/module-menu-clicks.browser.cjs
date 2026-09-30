/* Focused menu regression: real pointer clicks while live content refreshes. */
const {chromium}=require('playwright');
const http=require('node:http'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..');
(async()=>{
  const server=http.createServer((req,res)=>{
    const target=path.resolve(root,'.'+decodeURIComponent(new URL(req.url,'http://localhost').pathname));
    if(!target.startsWith(root+path.sep)||!['.html','.js','.css','.svg','.png','.ico'].includes(path.extname(target))){res.writeHead(404);res.end();return;}
    fs.readFile(target,(err,data)=>{res.writeHead(err?404:200,{'Content-Type':{'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml'}[path.extname(target)]||'application/octet-stream'});res.end(err?'':data);});
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const browser=await chromium.launch({channel:'msedge',headless:true});
  const page=await browser.newPage({viewport:{width:1500,height:980}});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>localStorage.setItem('northstarModuleWorkspaceV1',JSON.stringify({sections:{},modules:{'custom:menu-click-child':{custom:true,name:'Nested menu check',section:'tools',parent:'tools:tools-module-1',full:{customOnly:true,assetCanvas:true},compact:{customOnly:true,assetCanvas:true}}}})));
  await page.route('**/api/**',route=>{
    const p=new URL(route.request().url()).pathname;
    const data=p==='/api/auth/session'?{required:false}:p==='/api/weather'?{stations:[]}:p==='/api/market-prices'?{nodes:{},ontario:{}}:{};
    return route.fulfill({status:['/api/auth/session','/api/weather','/api/market-prices'].includes(p)?200:503,contentType:'application/json',body:JSON.stringify(data)});
  });
  try{
    await page.goto(`http://127.0.0.1:${server.address().port}/northstar-clean.html`);
    await page.waitForFunction(()=>window.NorthstarModules?.registry.size>10);
    await page.locator('#sideNav [data-tab="tools"]').click();
    const button=page.locator('#nsSectionModuleMenu [data-open-module="tools:tools-module-1"]');
    await button.waitFor({state:'visible'});
    const original=await button.elementHandle();
    const box=await page.evaluate(()=>{const b=document.querySelector('#nsSectionModuleMenu [data-open-module="tools:tools-module-1"]'),r=b.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height};});
    await page.evaluate(()=>{
      const feed=document.createElement('span');feed.id='menuClickTestFeed';document.querySelector('main').append(feed);
      window.menuClickTestTimer=setInterval(()=>feed.textContent=String(Date.now()),20);
    });
    await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();
    await page.waitForTimeout(150);
    assert.equal(await original.evaluate(b=>b.isConnected),true,'Live updates must retain the pressed submenu button');
    await page.mouse.up();
    await page.waitForFunction(()=>NorthstarModules.state.sections.tools.active==='tools:tools-module-1');
    assert.equal(await button.getAttribute('aria-current'),'page');
    await page.evaluate(()=>clearInterval(window.menuClickTestTimer));
    const toggle=page.locator('#nsSectionModuleMenu .ns-tree-toggle');
    const controlledId=await toggle.getAttribute('aria-controls');
    await toggle.click();
    assert.equal(await page.evaluate(id=>document.getElementById(id).hidden,controlledId),true,'Nested groups collapse');
    await toggle.click();
    assert.equal(await page.evaluate(id=>document.getElementById(id).hidden,controlledId),false,'Nested groups expand');
    await page.locator('#nsSectionModuleMenu [data-open-module="custom:menu-click-child"]').click();
    assert.equal(await page.locator('#nsSectionModuleMenu [data-open-module="custom:menu-click-child"]').getAttribute('aria-current'),'page');
    for(const section of ['weather','markets','switching','outages','logbook','tools']){
      await page.locator(`#sideNav [data-tab="${section}"]`).click();
      const menu=page.locator('#nsSectionModuleMenu');
      if(!await menu.isVisible())await page.locator(`#sideNav [data-tab="${section}"]`).click();
      const entries=await menu.locator('[data-open-module]').evaluateAll(bs=>bs.map(b=>b.dataset.openModule));
      assert.ok(entries.length,`${section} has submenu modules`);
      for(const id of entries){
        await menu.locator(`[data-open-module="${id}"]`).click();
        assert.equal(await menu.locator(`[data-open-module="${id}"]`).getAttribute('aria-current'),'page',`${id} opens from the tree`);
      }
    }
    await page.evaluate(()=>document.body.classList.add('layout-edit'));
    await page.locator('#nsAssetEditor [name="mode"]').selectOption('assets');
    await page.waitForFunction(()=>NorthstarAssetEditor.active());
    await page.locator('#nsSectionModuleMenu [data-open-module="tools:device-library"]').click();
    assert.equal(await page.locator('#deviceLibrary').isVisible(),true,'Submenu navigation works during asset editing');
    await page.locator('#nsSectionModuleMenu [data-open-module="tools:tools-module-1"]').press('Enter');
    assert.equal(await button.getAttribute('aria-current'),'page','Keyboard submenu navigation works during asset editing');
    await page.evaluate(()=>document.body.classList.remove('layout-edit'));
    await page.locator('#sideNav [data-tab="overview"]').click();
    assert.equal(await page.locator('#nsSectionModuleMenu').count(),0,'Overview removes the submenu');
    assert.deepEqual(errors,[]);
    console.log('Menu clicks passed: live updates, six section trees, nested groups, keyboard, asset editing, and Overview.');
  }finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
})().catch(e=>{console.error(e);process.exitCode=1;});
