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
    const page = await context.newPage();
    await page.route('**/api/**', route => {
      const pathname = new URL(route.request().url()).pathname;
      if (/^\/api\/(uwpc|auth|switching|outages)/.test(pathname)) return route.continue();
      return route.fulfill({status:503, contentType:'application/json', body:'{}'});
    });
    const shell = process.env.OUTAGE_TEST_SHELL || '/northstar-clean.html';
    const menu = page.locator('#sideNav [data-tab="outages"]');
    async function chooseOutageModule(id) {
      const choice = page.locator(`#sideNav [data-open-module="${id}"]:visible, #sideNav [data-v3-destination="${id}"]:visible`);
      if (!await choice.count()) await menu.click();
      await choice.click();
    }
    await login('Ryan');
    const library = new URL(shell,origin);
    library.searchParams.set('nsLibrary','1');
    library.hash = 'tools';
    await page.goto(library.href);
    await page.locator('body.ns-library-shell').waitFor({state:'attached'});
    await page.waitForFunction(() => window.NorthstarModules?.registry.has('outages:uwpc'));
    await chooseOutageModule('outages:current');
    await page.locator('#outageList').waitFor();
    await chooseOutageModule('outages:uwpc');
    await page.getByRole('link',{name:'Open practice outage'}).waitFor();
    await login('fixture_author');
    await page.goto(origin + shell);
    const oid = await page.evaluate(async () => {
      const r = await fetch('/api/outages', {method:'POST', headers:{'Content-Type':'application/json'},
        body:JSON.stringify({type:'Planned',title:'Fixture multi-site outage',site:'North',details:'Synthetic request'})});
      return (await r.json()).id;
    });
    assert.ok(oid);
    await page.reload();
    await page.waitForFunction(() => window.NorthstarModules?.registry.has('outages:uwpc'));
    await chooseOutageModule('outages:current');
    const planSelector = `[data-outage-package="${oid}"]`;
    if (await page.locator('body.ns-build-v3').count()) {
      await page.locator('#outageList .outage-item').filter({has:page.locator(planSelector)}).locator('strong').click();
      await page.locator('dialog[open]').locator(planSelector).click();
    } else {
      await page.locator(planSelector).click();
    }
    const form = page.locator('#uwpcRequestForm');
    assert.equal(await form.locator('[name=outageId]').inputValue(), oid);
    for (const [name,value] of Object.entries({title:'Fixture multi-site outage', site:'North',
      start:'2030-09-10T12:00', end:'2030-09-10T15:00', diagramRevision:'R1', affectedSites:'South'})) {
      await form.locator(`[name="${name}"]`).fill(value);
    }
    await form.locator('[data-plan-field=purpose]').fill('Synthetic package');
    await form.locator('[data-step-field=device]').first().fill('Fixture device');
    await form.locator('[data-step-field=operation]').first().fill('Fixture step');
    await form.getByRole('button', {name:'Save changes'}).click();
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
    const url = await page.getByRole('link', {name:'Download final copy',exact:true}).getAttribute('href');
    const result = await page.evaluate(async url => {
      const response = await fetch(url, {credentials:'same-origin'});
      const bytes = new Uint8Array(await response.arrayBuffer());
      return [response.status, String.fromCharCode(...bytes.slice(0, 2))];
    }, url);
    assert.deepEqual(result, [200, 'PK']);
    const act = async name => {
      await page.getByRole('button', {name,exact:true}).click();
      await page.waitForFunction(() => !document.getElementById('uwpcDesk').hasAttribute('aria-busy'));
    };
    await act('Acknowledge receipt');
    await login('fixture_operator');
    await page.evaluate(() => window.NorthStarUwpcDesk.refresh());
    await page.locator('#uwpcOperatorInbox [data-request]').click();
    await act('Open switching log');
    const log = page.getByRole('group',{name:'Record switching activity'});
    await log.locator('[name=step]').selectOption('1');
    await log.locator('[name=text]').fill('Fixture activity recorded.');
    await act('Save log entry');
    await page.getByRole('group',{name:'Finish outage'}).locator('[name=text]').fill('Fixture completed.');
    await act('Finish and close outage');
    await page.getByLabel('Follow-up note').fill('Fixture closeout note.');
    await act('Save closeout note');
    await page.getByText('Fixture closeout note.',{exact:true}).waitFor();
    const closed = await page.evaluate(async id => (await (await fetch('/api/outages')).json()).find(o => o.id === id).status, oid);
    assert.equal(closed, 'Closed');
    await page.goto(origin + '/outage-practice.html');
    await page.locator('#uwpcDeskStatus').filter({hasText:'Avery Brooks'}).waitFor();
    const exercise = page.locator('#outageRouting');
    assert.equal(await exercise.locator('[name=checker]').inputValue(), 'Morgan Ellis');
    assert.equal(await exercise.locator('[data-field-site=South]').inputValue(), 'Taylor Reed');
    await exercise.locator('[name=confirmed]').check();
    await exercise.getByRole('button').click();
    await page.getByText('Outage package review · Awaiting signatures', {exact:true}).waitFor();
    await page.locator('#outagePracticeActor').selectOption('Morgan Ellis');
    await page.locator('[data-action=review-sign]').first().waitFor();
    const isolated = await page.evaluate(async () => {
      const records = await (await fetch('/api/uwpc/requests')).json();
      const rehearsal = await (await fetch('/api/uwpc/requests/practice/Morgan%20Ellis')).json();
      return {live:records.requests.some(r => r.practice), practice:rehearsal.requests.length,
        other: (await fetch('/api/uwpc/requests/practice/Morgan%20Ellis/' + records.requests[0].id)).status};
    });
    assert.deepEqual(isolated, {live:false,practice:1,other:404});
    console.log('Verified registered request through approval, final-copy delivery, electronic switching log, linked closure and saved notes.');
  } finally {
    if (browser) await browser.close();
    fixture.kill();
  }
}
verify().catch(error => {console.error(error); process.exitCode = 1;});
