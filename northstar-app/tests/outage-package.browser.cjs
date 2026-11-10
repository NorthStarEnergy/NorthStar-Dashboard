/* Exercise the signed-in UWPC desk with a disposable two-site outage. */
const assert = require('node:assert/strict');
const {spawn} = require('node:child_process');
const {once} = require('node:events');
const {createInterface} = require('node:readline');
const path = require('node:path');
const {chromium} = require('playwright');

async function verify() {
  const fixture = spawn('python', ['-u', 'tests/uwpc-desk-fixture.py'], {
    cwd:path.resolve(__dirname, '..'), windowsHide:true, stdio:['ignore', 'pipe', 'inherit']
  });
  let browser;
  try {
    const lines = createInterface({input:fixture.stdout});
    const port = await Promise.race([
      once(lines, 'line').then(([line]) => JSON.parse(line).port),
      once(fixture, 'exit').then(() => { throw Error('Fixture exited before startup'); })
    ]);
    const origin = 'http://127.0.0.1:' + port;
    browser = await chromium.launch({channel:'msedge', headless:true});
    const context = await browser.newContext();
    const login = async name => {
      const response = await context.request.post(origin + '/api/auth/login', {
        data:{username:name, password:'fixture-only-password'}
      });
      assert.equal(response.status(), 200);
    };
    await login('fixture_author');
    const page = await context.newPage();
    await page.route('**/api/**', route => {
      const pathname = new URL(route.request().url()).pathname;
      if (/^\/api\/(uwpc|auth|switching)/.test(pathname)) return route.continue();
      return route.fulfill({status:503, contentType:'application/json', body:'{}'});
    });
    await page.goto(origin + '/northstar-clean.html');
    await page.waitForFunction(() => window.NorthstarModules?.registry.has('outages:uwpc'));
    await page.evaluate(() => window.NorthstarModules.open('outages:uwpc'));
    await page.locator('#uwpcDeskStatus').filter({hasText:'Ready.'}).waitFor();
    await page.getByRole('button', {name:'New', exact:true}).click();
    await page.locator('#uwpcNewMenu button').filter({hasText:'PC17A'}).click();
    const form = page.locator('#uwpcRequestForm');
    for (const [name,value] of Object.entries({title:'Fixture multi-site outage', site:'North', outageId:'TEST-2',
      start:'2030-09-10T12:00', end:'2030-09-10T15:00', diagramRevision:'R1', affectedSites:'South'})) {
      await form.locator(`[name="${name}"]`).fill(value);
    }
    await form.locator('[data-plan-field=purpose]').fill('Synthetic package');
    await form.locator('[data-step-field=device]').first().fill('Fixture device');
    await form.locator('[data-step-field=operation]').first().fill('Fixture step');
    await form.getByRole('button', {name:'Submit draft form'}).click();
    await page.getByText('Sources and proposal generation', {exact:true}).click();
    await page.locator('#uwpcSourceUpload').setInputFiles({name:'drawing.txt',mimeType:'text/plain',buffer:Buffer.from('Fixture')});
    await page.getByRole('button', {name:'Attach', exact:true}).click();
    await page.locator('#uwpcDeskStatus').filter({hasText:'Source saved'}).waitFor();
    const routing = page.locator('#outageRouting');
    await routing.locator('[name=due]').fill('2030-09-10T10:00');
    await routing.locator('[name=checker]').selectOption('fixture_operator');
    await routing.locator('[name=area]').selectOption('fixture_area');
    for (const name of ['fixture_operator','fixture_relief']) await routing.locator(`[value="${name}"][name=scheduled]`).check();
    await routing.locator('[data-field-site=North]').selectOption('fixture_north');
    await routing.locator('[data-field-site=South]').selectOption('fixture_south');
    await routing.locator('[name=confirmed]').check();
    await routing.getByRole('button').click();
    await page.getByText('Outage package review · Awaiting signatures', {exact:true}).waitFor();
    for (const [name,count] of [['fixture_operator',2],['fixture_relief',1],['fixture_area',1],['fixture_north',1],['fixture_south',1]]) {
      await login(name);
      await page.evaluate(() => window.NorthStarUwpcDesk.refresh());
      await page.locator('#uwpcOperatorInbox [data-request]').click();
      for (let i=0; i<count; i++) {
        const task = page.locator('[data-task]').filter({has:page.locator('[data-action=review-sign]')}).first();
        await task.locator('[name=confirmed]').check();
        await task.getByRole('button', {name:'Sign revision 1'}).click();
        await page.waitForFunction(() => !document.getElementById('uwpcDesk').hasAttribute('aria-busy'));
      }
    }
    await page.getByText('Outage package review · Planning review complete', {exact:true}).waitFor();
    const url = await page.getByRole('link', {name:/Download package with review cover/}).getAttribute('href');
    const result = await page.evaluate(async url => {
      const response = await fetch(url, {credentials:'same-origin'});
      const bytes = new Uint8Array(await response.arrayBuffer());
      return [response.status, String.fromCharCode(...bytes.slice(0, 2))];
    }, url);
    assert.deepEqual(result, [200, 'PK']);
    console.log('Verified six named accounts, two stations, seven sign-offs, inbox routing and package download.');
  } finally {
    if (browser) await browser.close();
    fixture.kill();
  }
}
verify().catch(error => {console.error(error); process.exitCode = 1;});
