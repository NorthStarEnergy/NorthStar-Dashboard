const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'northstar-clean.html'), 'utf8');
const dataScript = fs.readFileSync(path.join(root, 'dashboard-build-data.js'), 'utf8');
const uiScript = fs.readFileSync(path.join(root, 'dashboard-build.js'), 'utf8');
const stylesheet = fs.readFileSync(path.join(root, 'dashboard-build.css'), 'utf8');
const context = { window: {} };

vm.runInNewContext(dataScript, context, { filename: 'dashboard-build-data.js' });
const build = context.window.NORTHSTAR_BUILD_DATA;

assert.ok(html.includes('dashboard-build-data.js?v=20260915-build-history-1'));
assert.ok(html.includes('dashboard-build.js?v=20260916-ai-icon-1'));
assert.ok(html.includes('dashboard-build.css?v=20260916-ai-icon-1'));
assert.equal(build.current.version, 'v0.48');
assert.equal(build.history[0].version, build.current.version);
assert.equal(build.history[0].published, build.current.published);
assert.ok(build.history.length >= 2);
for (const entry of build.history) {
  assert.match(entry.version, /^v\d+\.\d+$/);
  assert.match(entry.published, /^\d{4}-\d{2}-\d{2}$/);
  assert.ok(entry.summary.length > 0 && entry.summary.length <= 160 && !/[\r\n]/.test(entry.summary));
}
assert.ok(uiScript.includes('const overview ='));
assert.ok(uiScript.includes("className = 'brand-home-control'"));
assert.ok(uiScript.includes("brand.querySelector(':scope > small')?.remove()"));
assert.ok(uiScript.includes("icon.className = 'northstar-ai-icon'"));
assert.ok(uiScript.includes("icon.src = 'northstar-symbol-transparent.png'"));
assert.ok(uiScript.includes("window.addEventListener('northstar-ai-thinking'"));
assert.ok(uiScript.includes("assistantControl.setAttribute('aria-label', 'Open NorthStar AI')"));
assert.ok(uiScript.includes('showModal()'));
assert.ok(uiScript.includes('badge.dataset.buildDate'));
assert.ok(stylesheet.includes('.northstar-build-history'));
assert.ok(stylesheet.includes('.brand-home'));
assert.ok(stylesheet.includes('.brand-home-control'));
assert.ok(stylesheet.includes('northstar-ai-thinking-spin'));
new vm.Script(uiScript, { filename: 'dashboard-build.js' });

console.log('Dashboard build UI source contract passed.');
