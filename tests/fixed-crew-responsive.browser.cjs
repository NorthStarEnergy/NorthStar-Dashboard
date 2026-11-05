const {chromium}=require('playwright');
const http=require('node:http'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..');
(async()=>{
  const server=http.createServer((req,res)=>{
    const file=path.resolve(root,'.'+new URL(req.url,'http://localhost').pathname);
    if(!file.startsWith(root+path.sep)||!['.html','.js','.css','.svg','.png','.ico'].includes(path.extname(file))){res.writeHead(404);return res.end();}
    fs.readFile(file,(err,data)=>{res.writeHead(err?404:200,{'Content-Type':{'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml'}[path.extname(file)]||'application/octet-stream'});res.end(err?'':data);});
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const browser=await chromium.launch({channel:'msedge',headless:true});
  try{
    const page=await browser.newPage({viewport:{width:1500,height:900}});
    await page.addInitScript(()=>{window.northstarLayoutReady=Promise.resolve();localStorage.setItem('northstarAssetEditorV1',JSON.stringify({version:1,roots:{'fixed:crew':{assets:{'div.ns-crew-tracker > div.ns-crew-sites':{x:15,y:-5,w:335,h:93,color:'#abcdef'},'div.ns-crew-tracker > div.ns-crew-sites > button.ns-status-site':{x:15,y:-5}}}}}));});
    const now=new Date().toISOString();
    await page.route('**/api/**',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(new URL(route.request().url()).pathname==='/api/checkins'?[{id:'solo',name:'Test Worker',site:'Twin Falls',alone:true,status:'on-site',lastHeard:now,checkedIn:now}]:{required:false,items:[],stations:[],nodes:{}})}));
    await page.goto(`http://127.0.0.1:${server.address().port}/northstar-clean.html#overview`);
    await page.locator('#nsStatusBar [data-crew-code="TW"]').waitFor();
    const result=await page.evaluate(()=>{
      const root=document.querySelector('#nsStatusBar [data-status="crew"]');
      root.style.setProperty('width','700px','important');root.style.setProperty('height','220px','important');
      const sites=root.querySelector('.ns-crew-sites'),badge=sites.querySelector('[data-crew-code="TW"]');
      const a=sites.getBoundingClientRect(),b=badge.getBoundingClientRect();
      return {gridWidth:a.width,gridHeight:a.height,badgeWidth:b.width,badgeHeight:b.height,inside:b.left>=a.left&&b.top>=a.top&&b.right<=a.right&&b.bottom<=a.bottom};
    });
    assert.ok(result.gridWidth>600 && result.gridHeight>150,result);
    assert.ok(result.badgeWidth>100 && result.badgeHeight>35 && result.inside,result);
    console.log('Fixed crew responsive layout passed.');
  }finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});
