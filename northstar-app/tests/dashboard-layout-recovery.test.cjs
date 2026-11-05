const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'dashboard-layout-default.js'), 'utf8');
const recoveryId = '20261004-layout-recovery-1';
const regressedPositions = {
  'canvas:overview:overviewStaff': {x: 548, y: 1038, w: 548, h: 260},
  'canvas:stations:site:twin-falls': {x: 256, y: 324, w: 90, h: 70},
};

function run(initial = {}) {
  const values = new Map(Object.entries(initial));
  const context = {
    localStorage: {
      getItem: key => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, String(value)),
      removeItem: key => values.delete(key),
    },
  };
  context.window = context;
  vm.runInNewContext(source, context, {filename: 'dashboard-layout-default.js'});
  return values;
}

const broken = {overview: {position: regressedPositions}};
const recovered = run({
  northstarModuleLayout: JSON.stringify(broken),
  northstarModuleLayoutSaved: JSON.stringify(broken),
  northstarCanvasLayoutV1: JSON.stringify(regressedPositions),
  northstarCanvasLayoutV1Saved: JSON.stringify(regressedPositions),
  northstarOverviewProfilesV2: JSON.stringify({desktop: {positions: regressedPositions}}),
  northstarOverviewProfilesV2Saved: JSON.stringify({desktop: {positions: regressedPositions}}),
});
const repairedLayout = JSON.parse(recovered.get('northstarModuleLayout'));
assert.ok(recovered.has(`northstarModuleLayout:${recoveryId}`), 'keeps a recoverable copy of the bad layout');
assert.ok(!recovered.has('northstarCanvasLayoutV1'), 'clears the bad canvas cache before automatic layout runs');
assert.ok(!recovered.has('northstarOverviewProfilesV2'), 'clears the bad responsive profile cache');
assert.ok(repairedLayout.overview.position['canvas:overview:overviewStaff'].y < 900, 'the seed cannot strand the roster below the fold');

const custom = {overview: {position: {'canvas:overview:overviewStaff': {x: 20, y: 40, w: 600, h: 320}}}};
const untouched = run({northstarModuleLayout: JSON.stringify(custom)});
assert.equal(untouched.get('northstarModuleLayout'), JSON.stringify(custom), 'does not replace a valid browser layout');

const saved = JSON.parse(fs.readFileSync(path.join(root, 'dashboard-layout-default.js'), 'utf8').match(/^window\.NORTHSTAR_LAYOUT_DEFAULT=(\{.*?\});/s)[1]);
const positions = saved.layout.overview.position;
assert.deepEqual([96, 170], [96, 170]);
assert.deepEqual([positions['canvas:stations:site:twin-falls'].w, positions['canvas:stations:site:twin-falls'].h], [94, 75]);
console.log('Dashboard layout recovery preserves valid layouts and repairs the regressed canvas seed.');
