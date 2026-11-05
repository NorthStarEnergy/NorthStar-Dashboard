const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'northstar-clean.html'), 'utf8');
const script = fs.readFileSync(path.join(root, 'unit-cycling-workspace.js'), 'utf8');
const stylesheet = fs.readFileSync(path.join(root, 'unit-cycling-workspace.css'), 'utf8');

assert.ok(html.includes('id="unit-cycling" class="section"'));
assert.ok(html.includes('id="unitCyclingWorkspace" data-module-id="unit-cycling-workspace"'));
assert.ok(html.includes('unit-cycling-workspace.js?v=20260915-unit-cycling-1'));
assert.ok(html.includes('unit-cycling-workspace.css?v=20260915-unit-cycling-1'));
assert.ok(html.includes("['unit-cycling','Unit Cycling']"));
assert.ok(script.includes("/api/unit-cycling"));
assert.ok(script.includes('APPEND-ONLY OPERATOR RECORD'));
assert.ok(script.includes('this workspace never sends commands to a unit, SCADA, or plant equipment'));
assert.ok(stylesheet.includes('.unit-cycling-ledger'));
new vm.Script(script, { filename: 'unit-cycling-workspace.js' });

console.log('Unit cycling workspace source contract passed.');
