const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

test('ieso-time formats America/Toronto clocks without AM/PM and builds HE stamps', () => {
  const context = { window: {}, Date, Intl, Number, String, Object };
  vm.runInNewContext(
    fs.readFileSync(path.join(__dirname, '..', 'ieso-time.js'), 'utf8'),
    context,
    { filename: 'ieso-time.js' }
  );
  const ieso = context.window.NorthstarIesoTime;
  assert.equal(ieso.TZ, 'America/Toronto');

  // 2026-09-18 21:46:30 America/Toronto = 2026-09-19 01:46:30Z (EDT, UTC-4)
  const sample = new Date('2026-09-19T01:46:30.000Z');
  assert.equal(ieso.clock(sample), '21:46');
  assert.equal(ieso.clock(sample, true), '21:46:30');
  assert.equal(ieso.hourEnding(sample), '22');
  assert.equal(ieso.heStamp(sample), '[HE 22 - 21:46]');
  assert.equal(ieso.dateTime(sample), '2026-09-18 21:46');
  assert.ok(!/AM|PM/i.test(ieso.shortDateTime(sample)));

  // Hour 23 → HE 24
  const late = new Date('2026-09-19T03:15:00.000Z'); // 23:15 EDT
  assert.equal(ieso.clock(late), '23:15');
  assert.equal(ieso.hourEnding(late), '24');
  assert.equal(ieso.heStamp(late), '[HE 24 - 23:15]');

  // Hour 00 → HE 01
  const early = new Date('2026-09-18T04:05:00.000Z'); // 00:05 EDT
  assert.equal(ieso.clock(early), '00:05');
  assert.equal(ieso.hourEnding(early), '01');
});

test('dashboard wires Event log HE clock and IESO time helper', () => {
  const root = path.join(__dirname, '..');
  const html = fs.readFileSync(path.join(root, 'northstar-clean.html'), 'utf8');
  const chrome = fs.readFileSync(path.join(root, 'dashboard-chrome.js'), 'utf8');
  assert.ok(html.includes('ieso-time.js?v=20260918-ieso-1'));
  assert.ok(chrome.includes('data-he-clock'));
  assert.ok(chrome.includes('heStamp'));
  assert.ok(chrome.includes("Event log ${label}"));
  assert.ok(!chrome.includes("toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})"));
});
