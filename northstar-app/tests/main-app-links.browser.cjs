const {chromium}=require('playwright');
const http=require('node:http'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..');
(async()=>{
  const server=http.createServer((req,res)=>{
    const pathname=new URL(req.url,'http://localhost').pathname;
    if(['/outage-manager.html','/scada-workbench/'].includes(pathname)){
      res.writeHead(200,{'Content-Type':'text/html'});res.end('<h1>Workspace destination fixture</h1>');return;
    }
    const target=path.resolve(root,'.'+decodeURIComponent(pathname));
    if(!target.startsWith(root+path.sep)||!['.html','.js','.css','.svg','.png','.ico'].includes(path.extname(target))){res.writeHead(404);res.end();return;}
    fs.readFile(target,(error,data)=>{
      res.writeHead(error?404:200,{'Content-Type':{'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png','.svg':'image/svg+xml'}[path.extname(target)]||'application/octet-stream'});
      res.end(error?'':data);
    });
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const browser=await chromium.launch({channel:'msedge',headless:true});
  const origin='http://127.0.0.1:'+server.address().port;
  try{
    for(const shell of ['northstar-v1.html?buildView=v1','northstar-clean.html?buildView=v3']){
      for(const [username,role,expected] of [['Ryan','operator',2],['other','operator',1],['visitor','site_viewer',0]]){
        const page=await browser.newPage({viewport:{width:1366,height:768}});
        await page.route('**/api/**',route=>{
          const p=new URL(route.request().url()).pathname;
          const data=p==='/api/auth/session'?{required:true,authenticated:true,username,role}:p==='/api/weather'?{stations:[]}:p==='/api/market-prices'?{nodes:{},ontario:{}}:{};
          return route.fulfill({status:['/api/auth/session','/api/weather','/api/market-prices'].includes(p)?200:503,contentType:'application/json',body:JSON.stringify(data)});
        });
        await page.goto(origin+'/'+shell);
        await page.waitForFunction(()=>window.NorthstarModules?.registry.size>10);
        assert.equal(await page.locator('#sideNav > .ns-main-app-link').count(),expected);
        if(expected){
          const outage=page.locator('#ns-outage-manager-link');
          assert.ok(await outage.isVisible());
          assert.equal(await outage.getAttribute('href'),'/outage-manager.html');
          await outage.focus();await page.keyboard.press('Enter');
          await page.waitForURL(origin+'/outage-manager.html');
          await page.goBack();await outage.waitFor();
          await page.locator('#sideNav [data-tab=outages]').click();
          assert.equal(await page.locator('#sideNav > .ns-main-app-link').count(),expected);
          await page.setViewportSize({width:390,height:844});
          // NorthStar's existing phone layout hides the entire desktop rail.
          assert.equal(await page.locator('#sideNav > .ns-main-app-link').count(),expected);
          await page.setViewportSize({width:1366,height:768});
          await outage.waitFor({state:'visible'});
        }
        if(expected===2){
          const scada=page.locator('#ns-scada-bench-link');
          assert.ok(await scada.locator('img').evaluate(img=>img.complete&&img.naturalWidth>0));
          await scada.click();await page.waitForURL(origin+'/scada-workbench/');
        }
        await page.close();
      }
    }
    console.log('Passed: both dashboard shells, Ryan/operator/viewer visibility, keyboard and pointer navigation, resize persistence, icon loading, no duplicate links.');
  }finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});
