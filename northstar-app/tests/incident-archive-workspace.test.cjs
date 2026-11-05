const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'northstar-clean.html'), 'utf8');
const script = fs.readFileSync(path.join(root, 'incident-archive-workspace.js'), 'utf8');
const stylesheet = fs.readFileSync(path.join(root, 'incident-archive-workspace.css'), 'utf8');

assert.ok(html.includes('data-outage-tab="incident-archive"'));
assert.ok(html.includes('data-outage-pane="incident-archive"'));
assert.ok(html.includes('id="incidentArchiveWorkspace"'));
assert.ok(html.includes('incident-archive-workspace.js?v=20260915-incident-archive-1'));
assert.ok(html.includes('incident-archive-workspace.css?v=20260915-incident-archive-1'));
assert.ok(script.includes('/api/incident-library/catalog'));
assert.ok(script.includes('/api/incident-library?${params}'));
assert.ok(script.includes('METADATA-ONLY REFERENCE'));
assert.ok(script.includes('without exposing the archived documents'));
assert.ok(!script.includes('fetch(\'/api/incident-library/'), 'the reference module has no document download endpoint');
assert.ok(stylesheet.includes('.incident-archive-table'));
assert.ok(stylesheet.includes('.incident-archive-source'));
new vm.Script(script, { filename: 'incident-archive-workspace.js' });

console.log('Incident archive workspace source contract passed.');
