const {chromium} = require('playwright');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');

(async () => {
  const server = http.createServer((req, res) => {
    const file = path.resolve(root, '.' + new URL(req.url, 'http://localhost').pathname);
    if (!file.startsWith(root + path.sep) || !['.html', '.js', '.css', '.svg', '.png', '.ico'].includes(path.extname(file))) {
      res.writeHead(404); return res.end();
    }
    fs.readFile(file, (error, data) => {
      res.writeHead(error ? 404 : 200, {'Content-Type': {'.html':'text/html','.js':'text/javascript','.css':'text/css'}[path.extname(file)] || 'application/octet-stream'});
      res.end(error ? '' : data);
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({channel:'msedge', headless:true}).catch(() => chromium.launch({headless:true}));
  try {
    const page = await browser.newPage({viewport:{width:1440, height:900}});
    await page.route('**/api/**', route => route.fulfill({status:200, contentType:'application/json', body:JSON.stringify(route.request().url().includes('/api/auth/session') ? {required:true, authenticated:true, username:'preference-test', role:'operator'} : {})}));
    await page.goto(`http://127.0.0.1:${server.address().port}/northstar-clean.html`);
    await page.locator('#sideNav [data-tab="account"] .nav-icon').waitFor();
    await page.locator('#sideNav [data-tab="account"]').click();
    assert.equal(await page.locator('#accountUsername').textContent(), 'preference-test');
    assert.equal(await page.locator('#account').isVisible(), true);
    assert.equal(await page.locator('#accountHoverPreviews').isChecked(), true);
    await page.screenshot({path:path.join(root, 'outputs', 'account-settings-preview.png')});
    await page.locator('#accountHoverPreviews').uncheck();
    assert.equal(await page.evaluate(() => NorthstarHoverPreviewsEnabled()), false);
    assert.equal(await page.evaluate(() => localStorage.getItem('northstarHoverPreviews:preference-test')), 'false');
    await page.reload();
    await page.locator('#sideNav [data-tab="account"]').click();
    assert.equal(await page.locator('#accountHoverPreviews').isChecked(), false);
    await page.evaluate(() => {
      const tile = document.createElement('div');
      tile.id = 'preferenceTestTile'; tile.textContent = 'Preview target';
      tile.style.cssText = 'width:180px;height:60px;margin:20px;background:#234';
      document.querySelector('#account .account-settings').append(tile);
      NorthstarModulePreview.bind(tile, {title:()=>'Test preview', source:()=>tile, open:()=>{}});
    });
    await page.locator('#preferenceTestTile').hover();
    await page.waitForTimeout(850);
    assert.equal(await page.locator('#nsModulePreview').isVisible(), false);
    await page.locator('#accountHoverPreviews').check();
    assert.equal(await page.evaluate(() => NorthstarHoverPreviewsEnabled()), true);
    await page.mouse.move(1, 1);
    await page.locator('#preferenceTestTile').hover();
    await page.waitForTimeout(850);
    assert.equal(await page.locator('#nsModulePreview').isVisible(), true);
    await page.locator('#accountHoverPreviews').uncheck();
    assert.equal(await page.locator('#nsModulePreview').isVisible(), false);
    console.log('Account settings navigation and hover preference persistence passed');
  } finally {
    await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
