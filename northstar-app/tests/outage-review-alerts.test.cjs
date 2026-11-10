const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const context = {window:{}};
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'outage-package-review.js'), 'utf8'), context);
const {alerts} = context.window.NorthStarOutageReview({});
const deadline = Date.parse('2030-10-10T12:00:00Z');
const row = {phase:'FUTURE', status:'PENDING_SIGNOFF', packageReview:{
  due:new Date(deadline).toISOString(), owner:'manager', area:'area', tasks:[
    {role:'field', site:'North', account:'north', signedAt:'2030-10-01T12:00:00Z'},
    {role:'field', site:'South', account:'south'}, {role:'operator', account:'operator'}]}};

test('due reminders and overdue escalation name the missing site and scheduled operator', () => {
  assert.match(alerts(row, 'south', deadline - 10000)[0], /Due within 24 hours.*South/);
  assert.equal(alerts(row, 'north', deadline).length, 0);
  assert.equal(alerts(row, 'area', deadline - 10000).length, 0);
  assert.equal(alerts(row, 'area', deadline).length, 1);
  assert.match(alerts(row, 'area', deadline)[0], /Overdue.*South/);
  assert.equal(alerts(row, 'manager', deadline).length, 2);
  assert.equal(alerts({...row, status:'SIGNED_OFF'}, 'manager', deadline).length, 0);
});

test('corrections reach the manager and the person who raised them; edits require reissue', () => {
  const issue = {id:'3', actor:'south'};
  assert.match(alerts({...row, reviewIssues:[issue]}, 'manager', deadline - 1)[0], /Respond to correction 3/);
  assert.match(alerts({...row, reviewIssues:[{...issue,answer:'Updated'}]}, 'south', deadline - 1)[0], /Confirm correction 3/);
  assert.match(alerts({...row, packageReview:null, lastReview:row.packageReview}, 'manager')[0], /Reissue/);
});
