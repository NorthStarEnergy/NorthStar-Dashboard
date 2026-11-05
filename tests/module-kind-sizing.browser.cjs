const { chromium } = require('playwright');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const captured = JSON.parse(fs.readFileSync(path.join(root, 'data', 'dashboard-layout-default.json'), 'utf8'));
const positions = captured.layout.overview.position;

(async () => {
  const server = http.createServer((req, res) => {
    const pathname = new URL(req.url, 'http://localhost').pathname;
    if (pathname.startsWith('/api/')) {
      const body = pathname === '/api/auth/session' ? { required: false }
        : pathname === '/api/weather' ? { stations: Object.keys(positions).filter(key => key.startsWith('canvas:weather:')).map(key => ({ name: key.slice(15), current: {}, hourly: {} })) }
        : pathname === '/api/scada' ? { feeds: [], readings: [] }
        : pathname === '/api/checkins' ? []
        : pathname === '/api/events/register' ? { items: [], nextCursor: null }
        : {};
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify(body));
    }
    const file = path.resolve(root, '.' + pathname);
    if (!file.startsWith(root + path.sep)) { res.writeHead(404); return res.end(); }
    fs.readFile(file, (error, data) => { res.writeHead(error ? 404 : 200); res.end(error ? '' : data); });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  try {
    await page.addInitScript(seed => {
      const saved = structuredClone(seed);
      Object.values(saved).forEach(box => { if (box.stationFormatVersion) box.stationFormatVersion = 8; });
      localStorage.northstarCanvasLayoutV1 = JSON.stringify(saved);
      localStorage.northstarOverviewProfilesV2 = JSON.stringify({ desktop: { positions: saved, width: 1200, automatic: false, weatherAtikokanSize: true, weatherHeaderRow: 6 } });
      localStorage.northstarOverviewWeatherDensityVersion = '4';
    }, positions);
    await page.goto(`http://127.0.0.1:${server.address().port}/northstar-clean.html`);
    await page.waitForFunction(() => {
      const saved = JSON.parse(localStorage.northstarCanvasLayoutV1 || '{}');
      const weather = Object.entries(saved).filter(([key]) => key.startsWith('canvas:weather:'));
      const stations = Object.entries(saved).filter(([key]) => key.startsWith('canvas:stations:'));
      return weather.length >= 8 && stations.length >= 18
        && weather.every(([, box]) => box.w === 85 && box.h === 130)
        && stations.every(([, box]) => box.w === 106 && box.h === 79);
    });
    const result = await page.evaluate(() => {
      const saved = JSON.parse(localStorage.northstarCanvasLayoutV1);
      return {
        weather: Object.values(saved).filter((_, index) => Object.keys(saved)[index].startsWith('canvas:weather:')).map(box => [box.w, box.h]),
        stations: Object.values(saved).filter((_, index) => Object.keys(saved)[index].startsWith('canvas:stations:')).map(box => [box.w, box.h]),
      };
    });
    assert.ok(result.weather.every(size => size[0] === 85 && size[1] === 130));
    assert.ok(result.stations.every(size => size[0] === 106 && size[1] === 79));
    console.log(`Matched ${result.weather.length} weather modules and ${result.stations.length} station modules.`);
  } finally {
    await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
