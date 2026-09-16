const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'northstar-clean.html'), 'utf8');
const script = fs.readFileSync(path.join(root, 'flows-workspace.js'), 'utf8');
const stylesheet = fs.readFileSync(path.join(root, 'flows-workspace.css'), 'utf8');

assert.ok(html.includes('id="flowsWorkspace" data-module-id="flows-workspace"'));
assert.ok(html.includes('flows-workspace.js?v=20260915-water-log-3'));
assert.ok(html.includes('flows-workspace.css?v=20260915-water-log-3'));
const flowSection = html.match(/<section id="flows"[^>]*>[\s\S]*?<\/section>/)?.[0] || '';
assert.equal((flowSection.match(/data-module-id=/g) || []).length, 1, 'Flows remains one module page');
assert.ok(script.includes("/api/flows"));
assert.ok(script.includes('/api/daily-operations'));
assert.ok(script.includes('/api/water-observations'));
assert.ok(script.includes('IMMUTABLE SNAPSHOT'));
assert.ok(script.includes('APPEND-ONLY OBSERVATIONS'));
assert.ok(script.includes('they never operate gates, SCADA, or plant equipment'));
assert.ok(script.includes('async function refreshReports(preserveMessage = false)'));
assert.ok(script.includes('void refreshReports(true).then(() => render(root));'));
assert.ok(script.includes("not reported".toUpperCase()) || script.includes("NOT REPORTED"));
assert.ok(script.toLowerCase().includes('do not use this page to operate equipment'));
assert.ok(!script.includes('data-module-id='), 'the Flows renderer does not split the page into child modules');
assert.ok(stylesheet.includes('.flows-gauge-grid'));
assert.ok(stylesheet.includes('.water-ledger'));
new vm.Script(script, { filename: 'flows-workspace.js' });

console.log('Flows workspace source contract passed.');
