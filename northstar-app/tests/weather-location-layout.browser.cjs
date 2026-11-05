const { chromium } = require('playwright');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const names = ['Iroquois Falls','Atikokan','Kapuskasing','Oshawa','Toronto','Fort Frances','Dokis FN','Kenora','Lachute','Lake Abitibi'];
const hours = Array.from({length: 30}, (_, i) => new Date(Date.now() + i * 3600000).toISOString());
const days = Array.from({length: 14}, (_, i) => new Date(Date.now() + i * 86400000).toISOString().slice(0, 10));
const stations = names.map(name => ({name, current: {temperature_2m: 12, weather_code: 2}, hourly: {time: hours, temperature_2m: hours.map(() => 12), apparent_temperature: hours.map(() => 11), weather_code: hours.map(() => 2), precipitation_probability: hours.map(() => 10), precipitation: hours.map(() => 0)}, daily: {time: days, temperature_2m_max: days.map(() => 15), temperature_2m_min: days.map(() => 5), weather_code: days.map(() => 2), precipitation_probability_max: days.map(() => 20), precipitation_sum: days.map(() => 0)}}));
(async () => {
  const server = http.createServer((req, res) => {
    const file = path.resolve(root, '.' + decodeURIComponent(new URL(req.url, 'http://localhost').pathname));
    if (!file.startsWith(root + path.sep) || !['.html', '.js', '.css'].includes(path.extname(file))) return res.writeHead(404).end();
    fs.readFile(file, (error, data) => { res.writeHead(error ? 404 : 200, {'Content-Type': {'.html':'text/html','.js':'text/javascript','.css':'text/css'}[path.extname(file)]}); res.end(error ? '' : data); });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({channel: 'msedge', headless: true});
  try {
    const page = await browser.newPage({viewport: {width: 1440, height: 900}});
    await page.route('**/api/**', route => route.fulfill({json: route.request().url().includes('/api/weather?') ? {stations, updated: new Date().toISOString(), source: 'fixture'} : {required: false}}));
    for (const name of names) {
      await page.goto(`http://127.0.0.1:${server.address().port}/weather-location.html?site=${encodeURIComponent(name)}`);
      await page.locator('.hour-card').first().waitFor();
      assert.match(await page.locator('#weatherSummary .current-condition .precip-accumulation').innerText(), /1d - .*mm\s+7d - .*mm/);
      assert.equal(await page.locator('.hour-card .precip-accumulation').count(), 0);
      assert.ok(parseFloat(await page.locator('.hourly-grid').evaluate(element => getComputedStyle(element).columnGap)) <= 2);
      const urls = await page.locator('.weather-source-links a').evaluateAll(links => links.map(link => link.href));
      assert.equal(urls.length, 3);
      assert.match(urls[0], /theweathernetwork\.com\/en\/city\/ca\//);
      assert.match(urls[1], /weather\.gc\.ca\/en\/location\/index\.html\?coords=/);
      assert.match(urls[2], /accuweather\.com\/en\/ca\/.+\/weather-forecast\//);
      assert.equal(await page.locator('.day-card').count(), 14);
      const size = await page.evaluate(() => ({back: getComputedStyle(document.querySelector('.weather-back')).fontSize, select: document.querySelector('#locationSelect select').getBoundingClientRect().width, hour: document.querySelector('.hour-card').getBoundingClientRect().height, day: document.querySelector('.day-card').getBoundingClientRect().height}));
      assert.ok(parseFloat(size.back) >= 14);
      assert.ok(size.select < 220, `${name} selector should fit the longest label: ${size.select}`);
      assert.ok(size.hour < 170, `Hourly tile too tall: ${size.hour}`);
      assert.ok(size.day < 170, `Daily tile too tall: ${size.day}`);
    }
    console.log('PASS: ten station pages have location links, compact forecast tiles, and a content-width selector.');
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });
