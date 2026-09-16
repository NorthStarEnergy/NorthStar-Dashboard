const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'northstar-clean.html'), 'utf8');
const script = fs.readFileSync(path.join(root, 'service-requests-workspace.js'), 'utf8');
const stylesheet = fs.readFileSync(path.join(root, 'service-requests-workspace.css'), 'utf8');

assert.ok(html.includes('id="service-requests" class="section"'));
assert.ok(html.includes('id="serviceRequestsWorkspace" data-module-id="service-requests-workspace"'));
assert.ok(html.includes('service-requests-workspace.js?v=20260915-service-requests-1'));
assert.ok(html.includes('service-requests-workspace.css?v=20260915-service-requests-1'));
assert.ok(html.includes("['service-requests','Service Requests']"));
assert.ok(script.includes('/api/service-requests/catalog'));
assert.ok(script.includes('/api/service-requests?${params}'));
assert.ok(script.includes('READ-ONLY MAXIMO SNAPSHOT'));
assert.ok(script.includes('No request is created, assigned, changed, or closed here.'));
assert.ok(!script.includes('data-module-id='), 'the Service Requests renderer does not split the page into child modules');
assert.ok(stylesheet.includes('.service-request-table'));
assert.ok(stylesheet.includes('.service-due.overdue'));
new vm.Script(script, { filename: 'service-requests-workspace.js' });

console.log('Service requests workspace source contract passed.');
