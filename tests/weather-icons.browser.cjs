const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

(async () => {
  const root = path.resolve(__dirname, '..');
  const out = path.join(root, 'outputs', 'Overview Weather');
  fs.mkdirSync(out, { recursive: true });
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 360, height: 240 } });
    await page.setContent('<style>body{margin:20px;background:#071017;color:#fff}.weather-card{width:104px;height:188px;padding:8px;border:1px solid #29414d;border-radius:12px;background:#101d25;text-align:center;font-family:Arial}.weather-icon{height:36px;margin:8px 0;font-size:32px;line-height:36px}.weather-current b{display:block;font-size:30px}.weather-current span{font-size:14px;color:#9aaab4}.weather-cloud-icon{display:inline-block;vertical-align:middle}</style><article class="weather-card"><strong>OSHAWA</strong><div class="weather-icon" id="icon"></div><div class="weather-current"><b>18°</b><span>CLOUDY</span></div></article>');
    await page.addScriptTag({ path: path.join(root, 'weather-icons.js') });
    await page.locator('#icon').evaluate(el => { el.innerHTML = NorthstarWeatherIcon(3, 1); });
    const geometry = await page.locator('.weather-card').evaluate(card => {
      const icon = card.querySelector('.weather-icon').getBoundingClientRect();
      const temperature = card.querySelector('.weather-current b').getBoundingClientRect();
      const svg = card.querySelector('svg').getBoundingClientRect();
      return { iconBottom: icon.bottom, temperatureTop: temperature.top, svgTop: svg.top, svgBottom: svg.bottom, iconTop: icon.top };
    });
    assert.ok(geometry.svgTop >= geometry.iconTop && geometry.svgBottom <= geometry.iconBottom, 'Cloud stays inside its icon row');
    assert.ok(geometry.iconBottom <= geometry.temperatureTop, 'Cloud does not overlap the temperature row');
    await page.screenshot({ path: path.join(out, 'cloud-graphic-render.png') });
    console.log('weather cloud browser check passed');
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
