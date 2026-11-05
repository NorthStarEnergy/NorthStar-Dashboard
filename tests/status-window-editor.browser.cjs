/* Regression: popout editor controls must receive clicks above the fullscreen status panel. */
const {chromium}=require('playwright');
const http=require('node:http'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..');
(async()=>{
  const server=http.createServer((req,res)=>{
    const file=path.resolve(root,'.'+new URL(req.url,'http://localhost').pathname);
    if(!file.startsWith(root+path.sep)||!['.html','.js','.css','.svg','.png','.ico'].includes(path.extname(file))){res.writeHead(404);return res.end();}
    fs.readFile(file,(error,data)=>{res.writeHead(error?404:200,{'Content-Type':{'.html':'text/html','.js':'text/javascript','.css':'text/css'}[path.extname(file)]||'application/octet-stream'});res.end(error?'':data);});
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const browser=await chromium.launch({channel:'msedge',headless:true});
  const page=await browser.newPage({viewport:{width:1440,height:900}});
  
  const now=new Date().toISOString();
  await page.route('**/api/**',route=>{
    const url=new URL(route.request().url()).pathname;
    const body=url==='/api/auth/session'?{required:false}:url==='/api/checkins'?[{id:'worker-1',name:'Alex M.',site:'Island Falls',status:'on-site',checkedIn:now,lastHeard:now}]:{items:[],stations:[]};
    return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(body)});
  });
  try{
    await page.goto(`http://127.0.0.1:${server.address().port}/northstar-clean.html?nsStatusWindow=1#markets`);
    await page.waitForSelector('#nsStatusWorkers #overviewStaff');
    await page.locator('.layout-edit-toggle').click();
    assert.ok(await page.locator('.layout-save').isVisible(),'Save visible after opening editor');
    await page.locator('.overview-edit-modules').click();
    assert.ok(await page.locator('#nsAssetEditor').isVisible(),'Module editor visible');
    await page.waitForFunction(()=>document.querySelector('#staffGroups')?.textContent.includes('Alex M.'));
    const result=await page.evaluate(()=>{
      const rect=id=>{const b=document.getElementById(id).getBoundingClientRect();return {x:b.x,y:b.y,w:b.width,h:b.height};};
      return {visible:[...document.querySelectorAll('#nsStatusBar>.ns-status-module')].filter(el=>getComputedStyle(el).display!=='none').map(el=>el.dataset.status),staff:rect('overviewStaff'),tracker:rect('nsFieldActivity'),bar:rect('nsStatusBar'),workerParent:document.getElementById('overviewStaff').parentElement.id};
    });
    assert.deepEqual(result.visible,['events','dispatch','markets']);
    assert.equal(result.workerParent,'nsStatusWorkers');
    assert.ok(result.staff.y>=result.bar.y+100 && result.staff.y<=result.bar.y+120 && result.tracker.y===result.staff.y);
    assert.ok(result.staff.w>500 && result.tracker.w>=280);
    const preview=path.join(root,'outputs','fixed-dashboard-popout','status-window-editor-preview.png');
    fs.mkdirSync(path.dirname(preview),{recursive:true});
    await page.screenshot({path:preview});
    await page.setViewportSize({width:390,height:844});
    const mobile=await page.evaluate(()=>{
      const rect=id=>document.getElementById(id).getBoundingClientRect();
      return {events:rect('nsStatusBar').top,staff:rect('overviewStaff').top,tracker:rect('nsFieldActivity').top,workerWidth:rect('nsStatusWorkers').width,viewport:innerWidth};
    });
    assert.ok(mobile.tracker>mobile.staff && mobile.workerWidth<=mobile.viewport);
    await page.setViewportSize({width:1440,height:900});
    await page.goto(`http://127.0.0.1:${server.address().port}/northstar-clean.html`);
    await page.waitForSelector('#nsStatusBar [data-open-status-window]');
    await page.evaluate(()=>history.replaceState(null,'','/'));
    const opened=page.waitForEvent('popup');
    await page.locator('#nsStatusBar [data-open-status-window]').first().click();
    const popup=await opened;
    assert.equal(new URL(popup.url()).pathname,'/northstar-clean.html');
    assert.equal(new URL(popup.url()).searchParams.get('nsStatusWindow'),'1');
    await popup.close();
    console.log('Status popout editor and worker dashboard checks passed.');
  }finally{await browser.close();server.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
