const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'northstar-clean.html'), 'utf8');
assert.ok(html.includes('id="deviceLibrary"'));
assert.ok(html.includes('id="openDeviceLibrary"'));
assert.ok(html.includes('device-library.js?v=20260913-5'));
assert.ok(html.includes('device-library.css?v=20260913-5'));
assert.ok(html.includes('northstar-sites.js?v=20260914-2'));
assert.ok(html.includes('outages-workspace.js?v=7'));
const libraryJs = fs.readFileSync(path.join(root, 'device-library.js'), 'utf8');
assert.ok(libraryJs.includes('/api/maximo/station'));
assert.ok(libraryJs.includes('Operations, Equipment, Data, Notes, and Reports'));
assert.ok(libraryJs.includes("menuKey === 'maximo-database'"));
assert.ok(html.includes('id="tools"'));
new vm.Script(fs.readFileSync(path.join(root, 'device-library.js'), 'utf8'), { filename: 'device-library.js' });
new vm.Script(fs.readFileSync(path.join(root, 'northstar-sites.js'), 'utf8'), { filename: 'northstar-sites.js' });
fs.readFileSync(path.join(root, 'device-library.css'), 'utf8');

function element() {
  const children = new Map();
  const node = {
    dataset: {},
    listeners: {},
    hidden: false,
    value: '',
    textContent: '',
    _html: '',
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    setAttribute() {},
    focus() {},
    scrollIntoView() {},
    addEventListener(name, fn) { this.listeners[name] = fn; },
    click() {
      this.listeners.click?.({
        target: this,
        preventDefault() {},
        closest(sel) { return sel === '.dl-node' || sel === '#dlNoteForm' ? this : null; },
      });
    },
    querySelector(sel) {
      const id = String(sel).startsWith('#') ? String(sel).slice(1) : '';
      if (id && children.has(id)) return children.get(id);
      return null;
    },
    querySelectorAll() { return []; },
    closest(sel) { return sel === '.dl-node' ? this : null; },
    get innerHTML() { return this._html; },
    set innerHTML(value) {
      this._html = String(value);
      for (const match of String(value).matchAll(/id="([^"]+)"/g)) {
        if (!children.has(match[1])) children.set(match[1], element());
      }
    },
  };
  return node;
}

const host = element();
const pending = [];
const document = {
  readyState: 'complete',
  querySelector(sel) {
    if (sel === '#deviceLibrary') return host;
    if (sel === '#openDeviceLibrary') return element();
    if (String(sel).startsWith('[data-tab=')) return { click() {} };
    return null;
  },
  addEventListener() {},
};
const context = {
  document,
  window: { location: {} },
  URLSearchParams,
  Date,
  JSON,
  Error,
  CSS: { escape: value => String(value) },
  fetch(url, options) {
    return new Promise(resolve => pending.push({ url: String(url), options, resolve }));
  },
};
vm.createContext(context);
vm.runInContext(fs.readFileSync(path.join(root, 'device-library.js'), 'utf8'), context);

const flush = () => new Promise(resolve => setImmediate(resolve));
const answer = (request, value, status = 200) => request.resolve({
  ok: status < 400,
  status,
  json: async () => value,
});

(async () => {
  const treeReq = pending.shift();
  assert.equal(treeReq.url, '/api/library');
  answer(treeReq, {
    company: 'NorthStar Energy',
    note: 'Reference library only. Records do not command equipment or acknowledge alarms.',
    counts: { areas: 1, sites: 1, devices: 1 },
    tree: {
      id: 'company:northstar',
      name: 'NorthStar Energy',
      kind: 'company',
      children: [{
        id: 'area:northeast',
        name: 'Northeast Ontario',
        kind: 'area',
        children: [{
          id: 'site:iroquois-falls-gs',
          name: '<script>xss</script>',
          kind: 'site',
          children: [{
            id: 'folder:site:iroquois-falls-gs:powerhouse',
            name: 'Powerhouse',
            kind: 'folder',
            children: [{
              id: 'device:1',
              name: 'Unit 1 Generator',
              kind: 'device',
            }],
          }],
        }],
      }],
    },
  });
  await flush();
  const itemReq = pending.shift();
  assert.match(itemReq.url, /\/api\/library\/item\?id=company%3Anorthstar/);
  answer(itemReq, {
    id: 'company:northstar',
    kind: 'company',
    name: 'NorthStar Energy',
    description: 'Company device repository.',
    note: 'Reference record only. Notes do not acknowledge or clear alarms.',
    notes: [{
      id: 'libnote_1',
      eventId: 'libnote_1',
      href: 'event-detail.html?id=libnote_1',
      text: 'Nameplate checked',
      createdAt: '2026-09-13T12:00:00Z',
      actorId: 'operator',
    }],
    events: [{
      eventId: 'outage-1',
      href: 'event-detail.html?id=outage-1',
      summary: 'Twin Falls: opened',
      occurredAt: '2026-09-13T12:00:00Z',
      category: 'outage',
      severity: 'warning',
    }],
    contents: [{ id: 'area:northeast', name: 'Northeast Ontario', kind: 'area' }],
  });
  await flush();

  const treeHtml = host.querySelector('#dlTree').innerHTML;
  assert.ok(treeHtml.includes('dl-sunflower'), 'folder rows use sunflower glyphs');
  assert.ok(treeHtml.includes('NorthStar Energy'));
  assert.ok(treeHtml.includes('Northeast Ontario'));
  assert.ok(treeHtml.includes('&lt;script&gt;xss&lt;/script&gt;'));
  assert.ok(!treeHtml.includes('<script>xss</script>'));
  assert.ok(host.innerHTML.includes('dl-tree'));
  assert.ok(host.querySelector('#dlCaution').textContent.includes('acknowledge'));

  const detail = host.querySelector('#dlDetail').innerHTML;
  assert.ok(detail.includes('ADD NOTE'));
  assert.ok(detail.includes('do not acknowledge'));
  assert.ok(detail.includes('Event reports'));
  assert.ok(detail.includes('href="event-detail.html?id=libnote_1"'));
  assert.ok(detail.includes('href="event-detail.html?id=outage-1"'));
  assert.ok(detail.includes('Open event report'));

  console.log('Device library UI: Tools module, sunflower tree, and escaped names passed.');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
