const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

test('local dashboard opens in a native Manager window and reuses it', async () => {
  const source = fs.readFileSync(path.join(__dirname, '../desktop/manager-main.cjs'), 'utf8');
  const windows = [], handlers = {}, external = [];
  const launches = [];
  class BrowserWindow {
    constructor(options) { this.options = options; this.events = {}; this.focused = false; windows.push(this); }
    loadFile(file) { this.file = file; }
    loadURL(url) { this.url = url; return Promise.resolve(); }
    on(name, callback) { this.events[name] = callback; }
    focus() { this.focused = true; }
    isDestroyed() { return false; }
  }
  const electron = {
    app: { whenReady: () => ({ then: callback => callback() }), on() {} },
    BrowserWindow,
    ipcMain: { handle: (channel, callback) => { handlers[channel] = callback; } },
    shell: { openExternal: url => external.push(url) },
  };
  vm.runInNewContext(source, {
    require: name => name === './dashboard-window.cjs' ? {createDashboardWindow:url=>{const win=new BrowserWindow({webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false}});win.dashboardReady=win.loadURL(url);return win;}} : name === 'electron' ? electron : name === '../package.json' ? { version: '1.0.5' } : name === 'node:child_process' ? {execFile:(file,args,options,done)=>{launches.push({file,args,options});done(null,'fixture launch','');}} : require(name),
    __dirname: path.join(__dirname, '../desktop'), process, fetch: async url => {
      if (url === 'http://127.0.0.1:4180/api/health') return { ok: true, json: async () => ({ database: { ok: true } }) };
      throw new Error(`Unexpected fetch ${url}`);
    }, URL, AbortSignal, Date, setTimeout,
  });
  const control = handlers['northstar:control'];
  const first = await control(null, { action: 'launch', target: 'local' });
  assert.equal(first.ok, true);
  assert.match(first.message, /opened in the Manager app/i);
  assert.equal(windows.length, 2); // Manager home plus local dashboard
  assert.equal(windows[1].url, 'http://127.0.0.1:4180/northstar-clean.html');
  assert.equal(windows[1].options.webPreferences.sandbox, true);
  assert.equal(windows[1].options.webPreferences.contextIsolation, true);
  assert.equal(windows[1].options.webPreferences.nodeIntegration, false);
  await control(null, { action: 'dashboard', target: 'local' });
  assert.equal(windows.length, 2);
  assert.equal(windows[1].focused, true);
  assert.deepEqual(external, []);
  assert.equal(launches.length,1);
  assert.ok(launches[0].args.includes("-LocalOnly"));
  assert.ok(launches[0].args.includes("-NoBrowser"));
  assert.equal(launches[0].options.windowsHide,true);
});
