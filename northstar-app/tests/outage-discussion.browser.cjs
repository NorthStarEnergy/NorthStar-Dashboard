const {spawn} = require('node:child_process');
const {once} = require('node:events');
const {createInterface} = require('node:readline');
const assert = require('node:assert/strict');
const {chromium} = require('playwright');

async function verify() {
  const server = spawn('python',['-u','tests/uwpc-desk-fixture.py'],{
    cwd:require('node:path').resolve(__dirname,'..'), windowsHide:true,
    env:{...process.env,OUTAGE_MANAGER_FIXTURE:'1'},stdio:['ignore','pipe','inherit']
  });
  let browser;
  try {
    const [line] = await once(createInterface({input:server.stdout}),'line');
    const origin = 'http://127.0.0.1:'+JSON.parse(line).port;
    browser = await chromium.launch({channel:'msedge',headless:true});
    const ctx = await browser.newContext();
    const api = origin+'/api/uwpc/requests/manager';
    const page = await ctx.newPage();
    await page.goto(origin+'/outage-manager.html');
    assert.equal((await ctx.request.get(api+'/discussion?id=test')).status(),401);
    await page.locator('#username').fill('fixture_author');
    await page.locator('#password').fill('fixture-only-password');
    await page.locator('button[type=submit]').click();
    await page.locator('tbody tr').first().waitFor();
    async function call(url,data) {
      return page.evaluate(async ({url,data})=>{
        const response=await fetch(url,data?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)}:{});
        return {status:response.status,body:await response.json()};
      },{url,data});
    }
    const request = {
      get:async url=>({json:async ()=>(await call(url)).body}),
      post:async (url,{data})=>{const result=await call(url,data);return {status:()=>result.status};}
    };
    const {rows} = await (await request.get(api+'/register')).json();
    const url = api+'/discussion?id='+rows[0].id;
    const other = api+'/discussion?id='+rows[1].id;
    await page.goto(origin+'/outage-manager-package.html?section=overview&outage='+rows[0].id);
    const panel = page.locator('.outage-discussion');
    await panel.locator('summary').first().click();
    async function post(kind,body) {
      await panel.getByLabel('Post type').selectOption(kind);
      await panel.getByLabel('Discussion message').fill(body);
      await panel.getByRole('button',{name:'Post',exact:true}).click();
    }
    await post('question','Which shift owns the follow-up?');
    await panel.getByRole('button',{name:'Reply',exact:true}).click();
    await post('answer','Night shift');
    await panel.getByText('Answered',{exact:true}).waitFor();
    await panel.getByLabel('Filter discussion').selectOption('open');
    await panel.getByText('No threads in this view.').waitFor();
    await page.reload();
    await panel.locator('summary').first().click();
    await panel.getByText('Answered',{exact:true}).click();
    await panel.getByText('Night shift',{exact:true}).waitFor();
    const link=await panel.getByRole('link',{name:'Thread link'}).getAttribute('href');
    const relief=await browser.newContext();
    const incoming=await relief.newPage();
    await incoming.goto(origin+'/outage-manager.html');
    await incoming.locator('#username').fill('fixture_relief');
    await incoming.locator('#password').fill('fixture-only-password');
    await incoming.locator('button[type=submit]').click();
    await incoming.locator('tbody tr').first().waitFor();
    await incoming.goto(page.url());
    const discussion=incoming.locator('.outage-discussion');
    await discussion.locator('summary').first().click();
    await discussion.getByText('● Answered',{exact:true}).waitFor();
    await incoming.goto(link);
    await discussion.getByText('Night shift',{exact:true}).waitFor();
    await discussion.getByText('Answered',{exact:true}).waitFor();
    await relief.close();
    await page.setViewportSize({width:375,height:800});
    assert.ok(await panel.evaluate(el=>el.scrollWidth<=el.clientWidth+1));
    const {posts} = await (await request.get(url)).json();
    assert.equal((await request.post(url,{data:posts[0]})).status(),201);
    assert.equal((await (await request.get(url)).json()).posts.length,2);
    assert.equal((await (await request.get(other)).json()).posts.length,0);
    assert.equal((await request.post(other,{data:posts[1]})).status(),404);
    console.log('Outage discussion browser and API checks passed.');
  } finally { await browser?.close(); server.kill(); }
}
verify().catch(error=>{console.error(error);process.exitCode=1;});
