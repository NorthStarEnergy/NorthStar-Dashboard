const assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const {once}=require('node:events');
const {createInterface}=require('node:readline');
const fs=require('node:fs');
const path=require('node:path');
const {chromium}=require('playwright');

async function check() {
  const root=path.resolve(__dirname,'..');
  const server=spawn('python',['-u','tests/uwpc-desk-fixture.py'],{cwd:root,windowsHide:true,env:{...process.env,OUTAGE_MANAGER_FIXTURE:'1'},stdio:['ignore','pipe','inherit']});
  let browser;
  try {
    const lines=createInterface({input:server.stdout});
    const port=await Promise.race([once(lines,'line').then(([l])=>JSON.parse(l).port),once(server,'exit').then(()=>{throw Error('Fixture exited');})]);
    const origin='http://127.0.0.1:'+port;
    browser=await chromium.launch({channel:'msedge',headless:true});
    const context=await browser.newContext({viewport:{width:1440,height:900}});
    const page=await context.newPage();
    await page.route('**/api/**',route=>{
      const pathname=new URL(route.request().url()).pathname;
      if (/^\/api\/(auth|uwpc|switching|outages|sites)/.test(pathname)) return route.continue();
      return route.fulfill({status:503,contentType:'application/json',body:'{}'});
    });
    assert.equal((await context.request.get(origin+'/api/uwpc/requests/manager/register')).status(),401);
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.goto(origin+'/outage-manager.html');
    assert.equal(await page.locator('input[type=password]').count(),1);
    await page.locator('#username').fill('fixture_author');
    await page.locator('#password').fill('fixture-only-password');
    await page.locator('button[type=submit]').click();
    await page.getByRole('button',{name:'Unit 2 stator inspection'}).waitFor();
    for(const shell of ['/northstar-v1.html?buildView=v1','/northstar-clean.html?buildView=v3']){
      await page.goto(origin+shell);
      await page.waitForFunction(()=>window.NorthstarModules?.registry.has('outages:uwpc'));
      await page.locator('#sideNav [data-tab=outages]').click();
      await page.locator('#sideNav a[href="/outage-manager.html"]:visible').first().click();
      await page.getByRole('button',{name:'Unit 2 stator inspection'}).waitFor();
    }
    assert.equal(await page.locator('tbody tr').count(),3);
    const out=path.join(root,'outputs','outage-manager-qa');fs.mkdirSync(out,{recursive:true});
    await page.screenshot({path:path.join(out,'home.png')});
    await page.getByRole('button',{name:/^Past/}).click();
    await page.getByRole('button',{name:'Completed valve inspection'}).waitFor();
    await page.getByRole('button',{name:/^Upcoming/}).click();
    await page.getByRole('searchbox',{name:'Search outages'}).fill('feeder');
    await page.waitForFunction(()=>document.querySelectorAll('tbody tr').length===1 && document.querySelector('tbody')?.textContent.includes('Feeder protection'));
    await page.getByRole('link',{name:'New',exact:true}).click();
    await page.screenshot({path:path.join(out,'new.png')});
    await page.getByLabel('Outage name').fill('West bay inspection');
    await page.getByLabel('Primary site').fill('Norman');
    await page.getByLabel('Equipment',{exact:true}).fill('West bay');
    await page.getByLabel('Start',{exact:true}).fill('2030-09-18T07:00');
    await page.getByLabel('End',{exact:true}).fill('2030-09-18T17:00');
    await page.getByLabel('Work scope').fill('Review the west bay references.');
    await page.getByLabel('Review trigger').selectOption('manager designation');
    await page.getByRole('button',{name:'Create outage'}).click();
    await page.locator('dialog[open] h3').filter({hasText:'West bay inspection'}).waitFor();
    await page.locator('dialog[open]').getByRole('link',{name:'West bay inspection'}).click();
    await page.locator('#uwpcRequestForm [name=title]').waitFor();
    assert.equal(await page.locator('#uwpcRequestForm [name=title]').inputValue(),'West bay inspection');
    assert.equal(await page.getByRole('link',{name:'Open practice outage'}).count(),0);
    await page.getByRole('link',{name:'My reviews'}).click();
    await page.getByText('You have no outstanding reviews.').waitFor();
    if(process.env.OUTAGE_MANAGER_FIXTURE_BOOK){
      await page.getByRole('link',{name:'UWPC library',exact:true}).click();
      await page.getByRole('searchbox',{name:'Search the manual'}).fill('supporting guarantee');
      await page.locator('#contents a strong').first().waitFor();
      await page.getByLabel('Reading format').selectOption('text');
      await page.locator('#contents a').first().click();
      await page.locator('.pageText p').waitFor();
      assert.ok((await page.locator('.pageText p').innerText()).length>20);
      await page.getByRole('button',{name:'Forms & tags'}).click();
      const pc2=page.locator('.formref').filter({has:page.getByText('PC2',{exact:true})});
      const link=await pc2.getByRole('link',{name:'PDF',exact:true}).getAttribute('href');
      assert.equal(await page.evaluate(async u=>{const r=await fetch(u);return (await r.arrayBuffer()).byteLength>1000 && r.headers.get('content-type')==='application/pdf';},link),true);
      await page.getByRole('button',{name:'Practice questions'}).click();
      await page.getByText('How many devices can a PC10A work permit guarantee?').click();
      assert.ok(await page.locator('details[open] a').isVisible());
    }
    await page.setViewportSize({width:390,height:844});
    await page.getByRole('link',{name:'Home',exact:true}).click();
    await page.getByRole('button',{name:'West bay inspection'}).waitFor();
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    assert.deepEqual(errors,[]);
    console.log('Outage Manager register, creation, package, inbox, library and mobile checks passed.');
  }finally{if(browser)await browser.close();server.kill();}
}
check().catch(e=>{console.error(e);process.exitCode=1;});
