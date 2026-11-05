const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'northstar-clean.html'), 'utf8');
const dataScript = fs.readFileSync(path.join(root, 'dashboard-build-data.js'), 'utf8');
const releaseUpdater = fs.readFileSync(path.join(root, 'client-release-update.js'), 'utf8');
const uiScript = fs.readFileSync(path.join(root, 'dashboard-build.js'), 'utf8');
const stylesheet = fs.readFileSync(path.join(root, 'dashboard-build.css'), 'utf8');
const layoutScript = fs.readFileSync(path.join(root, 'module-layout.js'), 'utf8');
const chromeScript = fs.readFileSync(path.join(root, 'dashboard-chrome.js'), 'utf8');
const polish = fs.readFileSync(path.join(root, 'dashboard-polish.css'), 'utf8');
const context = { window: {} };

vm.runInNewContext(dataScript, context, { filename: 'dashboard-build-data.js' });
const build = context.window.NORTHSTAR_BUILD_DATA;

assert.ok(html.includes(`dashboard-build-data.js?v=build-${build.current.version}`));
assert.ok(!html.includes("client-release-update.js"), "optional release updater is not boot-loaded");
assert.ok(html.includes(`dashboard-build.js?v=build-${build.current.version}`));
assert.ok(html.includes(`dashboard-build.css?v=build-${build.current.version}`));
assert.equal(build.history[0].version, build.current.version);
assert.equal(build.history[0].published, build.current.published);
assert.ok(build.history.length >= 2);
for (const entry of build.history) {
  assert.match(entry.version, /^v\d+\.\d+(?: \d{10})?$/);
  assert.match(entry.published, /^\d{4}-\d{2}-\d{2}$/);
  assert.ok(entry.summary.length > 0 && entry.summary.length <= 160 && !/[\r\n]/.test(entry.summary));
}
assert.ok(uiScript.includes('const overview ='));
assert.ok(uiScript.includes("className = 'brand-home-control'"));
assert.ok(uiScript.includes("brand.querySelector(':scope > small')?.remove()"));
assert.ok(uiScript.includes("icon.className = 'northstar-ai-icon'"));
assert.ok(uiScript.includes("icon.src = 'northstar-agent-icon.png'"));
assert.ok(uiScript.includes("window.addEventListener('northstar-ai-thinking'"));
assert.ok(uiScript.includes("assistantControl.setAttribute('aria-label', 'Open AGENT')"));
assert.ok(uiScript.includes("window.dispatchEvent(new Event('northstar:assistant-opened'))"));
assert.ok(uiScript.includes('showModal()'));
assert.ok(uiScript.includes('badge.dataset.buildDate'));
assert.ok(stylesheet.includes('.northstar-build-history'));
assert.ok(stylesheet.includes('.brand-home'));
assert.ok(stylesheet.includes('.brand-home-control'));
assert.ok(stylesheet.includes('northstar-ai-thinking-spin'));
assert.ok(layoutScript.includes('northstarStatusLayoutV1'));
assert.ok(layoutScript.includes('Resize fixed dashboard height'));
assert.ok(chromeScript.includes('northstar:status-layout-change'));
assert.ok(polish.includes('margin-top:var(--ns-status-height,88px)'));
assert.ok(releaseUpdater.includes("'/api/client-release'"));
assert.ok(releaseUpdater.includes("'northstar-client-update'"));
assert.ok(releaseUpdater.includes('window.location.replace'));
new vm.Script(uiScript, { filename: 'dashboard-build.js' });
new vm.Script(releaseUpdater, { filename: 'client-release-update.js' });

console.log('Dashboard build UI source contract passed.');
