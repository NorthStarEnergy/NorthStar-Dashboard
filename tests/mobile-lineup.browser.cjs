const {chromium}=require('playwright');
const http=require('node:http'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),base=process.env.NORTHSTAR_BASE_ROOT||root;
const owned=new Set(['operator-mobile.html','operator-mobile.js','operator-mobile.css','mobile-lineup.js','mobile-lineup.css']);
(async()=>{
  const server=http.createServer((req,res)=>{
    const name=decodeURIComponent(new URL(req.url,'http://localhost').pathname).slice(1);
    const dir=owned.has(name)?root:base,target=path.resolve(dir,name);
    if(!target.startsWith(dir+path.sep)||!['.html','.js','.css','.svg','.png','.ico','.webmanifest'].includes(path.extname(target))){res.writeHead(404).end();return;}
    fs.readFile(target,(err,data)=>{
      if(name==='northstar-clean.html'&&base!==root&&!err&&!data.toString().includes('mobile-lineup.js'))data=Buffer.from(data.toString().replace('</body>','<link rel="stylesheet" href="mobile-lineup.css"><script src="mobile-lineup.js" defer></script></body>'));
      res.writeHead(err?404:200,{'Content-Type':{'.html':'text/html','.js':'text/javascript','.css':'text/css'}[path.extname(target)]||'application/octet-stream'});res.end(err?'':data);
    });
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const browser=await chromium.launch({channel:'msedge',headless:true});
  const origin=`http://127.0.0.1:${server.address().port}`,out=path.join(root,'outputs/mobile-lineup');fs.mkdirSync(out,{recursive:true});
  const results=[];
  async function swipe(page, x1, y1, x2, y2) {
    const cdp=await page.context().newCDPSession(page);
    await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:x1,y:y1}]});
    for(let i=1;i<=8;i++){await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:x1+(x2-x1)*i/8,y:y1+(y2-y1)*i/8}]});await page.waitForTimeout(25);}
    await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await cdp.detach();
  }
  try{
    for(const width of (process.env.MOBILE_TEST_SURFACE==='dashboard'?[]:[320,390,768])){
      const page=await browser.newPage({viewport:{width,height:844},hasTouch:true});
      const errors=[];page.on('pageerror',e=>errors.push(e.message));
      await page.route('**/api/**',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(new URL(route.request().url()).pathname==='/api/auth/session'?{required:false}:[])}));
      await page.goto(origin+'/operator-mobile.html');
      await page.locator('#openModules').click();
      for(const id of ['workers','outages','alerts'])await page.locator(`input[value="${id}"]`).check();
      await page.locator('#doneModules').click();
      assert.equal(await page.locator('.category-page').count(),3);
      await page.locator('#nextCategory').click();
      await page.waitForFunction(()=>document.querySelector('#lineupPosition').textContent.startsWith('Operations'));
      await page.getByRole('button',{name:'Next Operations module',exact:true}).click();
      assert.equal(await page.locator('[data-module-panel="outages"]').evaluate(el=>el.inert),false);
      const track=page.locator('[data-category="Operations"] .category-track');
      await track.focus();await track.press('ArrowLeft');
      assert.equal(await page.locator('[data-module-panel="workers"]').evaluate(el=>el.inert),false);
      const tb=await track.boundingBox();
      await swipe(page,tb.x+tb.width*.8,tb.y+80,tb.x+tb.width*.2,tb.y+80);
      await page.waitForFunction(()=>!document.querySelector('[data-module-panel="outages"]').inert);
      await page.waitForFunction(()=>{const t=document.querySelector('[data-category="Operations"] .category-track');return Math.abs(t.scrollLeft-t.clientWidth)<2;});
      await page.waitForTimeout(200);
      await swipe(page,tb.x+tb.width/2,tb.y+tb.height*.9,tb.x+tb.width/2,tb.y+tb.height*.1);
      await page.waitForFunction(()=>document.querySelector('#lineupPosition').textContent.startsWith('Market'));
      await page.locator('#openModules').click();
      await page.getByRole('button',{name:'Move Control-room status down',exact:true}).click();
      await page.locator('#doneModules').click();await page.reload();
      assert.equal(await page.locator('.category-page').first().getAttribute('data-category'),'Operations');
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
      await page.locator('#openModules').click();
      for(const id of ['overview','outages','alerts'])await page.locator(`input[value="${id}"]`).uncheck();
      assert.equal(await page.locator('input[value="workers"]').isDisabled(),true);
      await page.locator('#doneModules').click();
      await page.screenshot({path:path.join(out,`companion-${width}.png`)});
      assert.deepEqual(errors,[]);results.push(`Companion ${width}: selection, category paging, native horizontal/vertical touch paging, keyboard, order/reload, last-module guard, no overflow/errors`);
      await page.close();
    }
    const page=await browser.newPage({viewport:{width:390,height:844},hasTouch:true});
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.route('**/api/**',route=>{
      const p=new URL(route.request().url()).pathname;
      const data=p==='/api/auth/session'?{required:false}:p==='/api/weather'?{stations:[]}:p==='/api/market-prices'?{nodes:{},ontario:{}}:{};
      return route.fulfill({status:['/api/auth/session','/api/weather','/api/market-prices'].includes(p)?200:503,contentType:'application/json',body:JSON.stringify(data)});
    });
    console.log('Dashboard: load latest root');
    await page.goto(origin+'/northstar-clean.html');
    await page.locator('#nsPhoneLineup').waitFor({state:'visible'});
    await page.waitForFunction(()=>document.querySelector('.ns-phone-module'));
    await page.getByRole('button',{name:'Choose mobile module lineup',exact:true}).click();
    const inventory=await page.evaluate(()=>[...NorthstarModules.registry.values()].filter(m=>m.section!=='overview').map(m=>({id:m.id,section:m.section})));
    const ops=inventory.filter(m=>m.section==='operations').slice(0,2);
    assert.equal(ops.length,2);
    for(const m of ops)await page.locator(`#nsPhonePicker input[value="${m.id}"]`).check();
    const first=page.locator('#nsPhonePicker ol li button').filter({hasText:/Operations/i}).first();
    await page.locator('#nsPhonePicker ol li button').first().click();
    await page.evaluate(id=>NorthstarModules.open(id),ops[0].id);
    // Navigate via the menu so its one-module mask follows the existing workspace.
    await page.getByRole('button',{name:'Choose mobile module lineup',exact:true}).click();
    await page.locator('#nsPhonePicker ol li').filter({hasText:await page.evaluate(id=>NorthstarModules.registry.get(id).title,ops[0].id)}).first().locator('button').first().click();
    console.log('Dashboard: selected station module');
    const before=await page.locator('.ns-phone-module').getAttribute('data-ns-module');
    await page.getByRole('button',{name:'Next module',exact:true}).click();
    const after=await page.locator('.ns-phone-module').getAttribute('data-ns-module');assert.notEqual(after,before);
    console.log('Dashboard: test swipe');
    const swipeBox=await page.locator('.app > main').boundingBox();
    await swipe(page,70,swipeBox.y+3,310,swipeBox.y+3);
    await page.waitForFunction(id=>document.querySelector('.ns-phone-module')?.dataset.nsModule===id,before);
    await page.waitForTimeout(450);
    await page.evaluate(()=>{for(const el of document.querySelectorAll('main, main *'))if(el.scrollHeight>el.clientHeight)el.scrollTop=el.scrollHeight;});
    for(const [dx,dy] of [[180,0],[0,100]]) {
      await page.locator('#priceGraph').evaluate((canvas,{dx,dy})=>{
        const first=new Touch({identifier:1,target:canvas,clientX:240,clientY:240});
        const last=new Touch({identifier:1,target:canvas,clientX:240-dx,clientY:240-dy});
        canvas.dispatchEvent(new TouchEvent('touchstart',{bubbles:true,touches:[first],changedTouches:[first]}));
        canvas.dispatchEvent(new TouchEvent('touchend',{bubbles:true,touches:[],changedTouches:[last]}));
      },{dx,dy});
      assert.equal(await page.locator('.ns-phone-module').getAttribute('data-ns-module'),before,'Existing chart canvas touch events must not navigate modules');
    }
    console.log('Dashboard: test wheel');
    const mainBox=await page.locator('.app > main').boundingBox();
    await page.mouse.move(mainBox.x+2,mainBox.y+mainBox.height/2);await page.mouse.wheel(0,150);
    await page.waitForFunction(id=>document.querySelector('.ns-phone-module')?.dataset.nsModule!==id,before);
    assert.equal(await page.locator('.ns-phone-module').count(),1);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    await page.screenshot({path:path.join(out,'dashboard-390.png')});
    await page.reload();await page.locator('#nsPhoneLineup').waitFor({state:'visible'});
    assert.equal(await page.evaluate(id=>JSON.parse(localStorage.getItem('northstar.phone.lineup.v1')).includes(id),ops[1].id),true);
    console.log('Dashboard: test latest check-in areas');
    if(await page.evaluate(()=>Boolean(window.NorthstarCheckins))) {
      await page.getByRole('button',{name:'Choose mobile module lineup',exact:true}).click();
      assert.equal(await page.locator('.ns-phone-checkin-areas button').count(),7);
      await page.getByRole('button',{name:'Close mobile module menu',exact:true}).click();
      for(const [area,count] of [['Fort Frances',4],['Kenora',3],['Iroquois',3],['Island',1],['Kap',4],['Quebec',5]]) {
        await page.getByRole('button',{name:'Choose mobile module lineup',exact:true}).click();
        await page.getByRole('button',{name:'View check-ins: '+area,exact:true}).click();
        assert.equal(await page.locator('.checkins-station').count(),count,area+' station count');
      }
      await page.getByRole('button',{name:'Choose mobile module lineup',exact:true}).click();
      await page.getByRole('button',{name:'View check-ins: Island',exact:true}).click();
      await page.waitForFunction(()=>document.querySelector('#checkinsAreaTitle').textContent==='Island');
      assert.equal(await page.locator('.checkins-station').count(),1);
      console.log('Dashboard: open station detail');
      await page.locator('.checkins-station').click();
      await page.locator('.checkins-site-details [data-checkins-detail]').click();
      await page.locator('#siteCrewWorkspace').waitFor({state:'visible'});
      console.log('Dashboard: close station detail');
      await page.locator('#siteCrewClose').click();
      await page.locator('.checkins-station').waitFor({state:'visible'});
      results.push('Latest check-ins: all six existing areas plus All stations retained in mobile menu; counts 4/3/3/1/4/5 and station detail/back passed');
    }
    await page.setViewportSize({width:320,height:740});
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    await page.screenshot({path:path.join(out,'dashboard-320.png')});
    await page.setViewportSize({width:1440,height:980});
    await page.waitForFunction(()=>!document.body.classList.contains('ns-phone-lineup'));
    assert.equal(await page.locator('.ns-phone-module').count(),0);
    assert.equal(await page.locator('#nsPhoneLineup').isVisible(),false);
    assert.deepEqual(errors,[]);
    await page.setViewportSize({width:390,height:844});
    await page.goto(origin+'/northstar-clean.html?nsStatusWindow=1');
    await page.waitForFunction(()=>window.NorthstarModules?.registry.size>0);
    await page.waitForTimeout(250);
    assert.equal(await page.locator('#nsPhoneLineup').count(),0,'Dedicated fixed-dashboard popout must not create phone navigation');
    assert.equal(await page.locator('.ns-phone-module').count(),0,'Dedicated popout must not mask a registry module');
    assert.equal(await page.evaluate(()=>document.body.classList.contains('ns-phone-lineup')),false);
    assert.equal(await page.evaluate(()=>document.body.classList.contains('ns-station-popout')),true);
    assert.deepEqual(errors,[]);
    await page.screenshot({path:path.join(out,'status-popout-390.png')});
    results.push('390px nsStatusWindow=1: no mobile lineup, module mask or phone-mode class');
    results.push(`Dashboard: ${inventory.length} registry modules; menu, touch swipe, canvas gesture isolation, wheel category navigation, persistence, no overflow, desktop restoration; page errors: ${JSON.stringify(errors)}`);
    fs.writeFileSync(path.join(out,'browser-results.json'),JSON.stringify({results,errors},null,2));console.log(results.join('\n'));
  } finally {await browser.close();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});
