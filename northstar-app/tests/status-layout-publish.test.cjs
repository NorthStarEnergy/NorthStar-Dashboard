const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

// Exercise the fixed-bar save with bootstrap data older than another tab's edits.
const source = fs.readFileSync(path.join(__dirname, '..', 'module-layout.js'), 'utf8');
const start = source.indexOf('    let publishTimer = 0;');
const end = source.indexOf('    const notify =', start);
assert.ok(start > 0 && end > start);
const requests = [], timers = [], stored = new Map();
const state = {profiles: {desktop: {height: 113, modules: {}}}};
const context = {
  detached:false, state, storageKey: 'northstarStatusLayoutV1', copy: value => structuredClone(value),
  localStorage: {setItem: (key, value) => stored.set(key, value)},
  window: {
    NORTHSTAR_LAYOUT_DEFAULT: {layout: {overview: {position: {weather: {w: 106}}}}, preferences: {closedOverview: ['old']}},
    clearTimeout() {}, setTimeout: callback => timers.push(callback),
  },
  fetch: (url, options) => {requests.push({url, body: JSON.parse(options.body)}); return Promise.resolve({ok: true});},
};
vm.runInNewContext(source.slice(start, end) + '\npersist();', context);
timers.at(-1)();
assert.deepEqual(JSON.parse(stored.get(context.storageKey)), state);
assert.equal(requests[0].url, '/api/dashboard-layout-default');
assert.deepEqual(requests[0].body, {statusLayout: state}, 'fixed-bar save must not republish stale Overview or preference data');
console.log('PASS: fixed-bar save publishes only its own state.');
