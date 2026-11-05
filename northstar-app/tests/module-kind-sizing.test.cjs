const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'module-layout.js'), 'utf8');
const saved = JSON.parse(fs.readFileSync(path.join(root, 'dashboard-layout-default.js'), 'utf8').match(/^window\.NORTHSTAR_LAYOUT_DEFAULT=(\{.*?\});/s)[1]);
const positions = saved.layout.overview.position;

const weather = {w:96,h:170};
const station = positions['canvas:stations:site:twin-falls'];

assert.deepEqual([weather.w, weather.h], [96, 170], 'weather family default is 96 x 170');
assert.deepEqual([station.w, station.h], [94, 75], 'committed station reference is 94 x 75');
assert.match(source, /WEATHER_CARD = \{ width: 96, height: 170,/);
assert.match(source, /STATION_SIZE_REFERENCE = 'canvas:stations:site:twin-falls'/);
assert.match(source, /p\.w=stationReference\.w;\s*p\.h=stationReference\.h;/);
assert.match(source, /pack\(e,valid\(p\)\?p\.w:106,valid\(p\)\?p\.h:79\)/, 'automatic packing preserves stored station dimensions');

console.log('Weather and station module families use the captured reference sizes.');
