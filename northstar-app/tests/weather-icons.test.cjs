const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'weather-icons.js'), 'utf8');
const context = { window: {} };
vm.runInNewContext(source, context);

const icon = context.window.NorthstarWeatherIcon;
const condition = context.window.precipType;
for (const code of [3, 4, 69]) {
  const markup = icon(code, 1);
  assert.match(markup, /^<svg class="weather-cloud-icon"/);
  assert.match(markup, /width="1em" height="1em"/);
}
assert.match(icon(2, 0), /^<svg class="weather-cloud-icon"/);
assert.equal(icon(2, 1), '🌤️');
assert.equal(icon(0, 1), '☀️');
assert.equal(condition(95), 'Thunderstorms');
assert.equal(condition(3), 'Cloudy');

console.log('weather icon checks passed');
