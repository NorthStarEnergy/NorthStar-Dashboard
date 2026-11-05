const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

async function launch(fail = false) {
  const windows = [], views = [], external = [], events = {};
  let ready;
  class Window {
    constructor(options) {
      this.options = options;
      this.events = {};
      this.contentView = { addChildView() {} };
      windows.push(this);
    }
    show() {}
    setTitle() {}
    on(name, fn) { this.events[name] = fn; }
  }
  class View {
    constructor(options) {
      const window = windows[windows.length - 1];
      window.rendererOptions = options;
      this.webContents = {
        session:{clearCache:async()=>{}},
        setWindowOpenHandler: fn => { window.open = fn; },
        on: (name, fn) => { window.events[name] = fn; },
        loadURL: async url => { window.url = url; if (fail) throw new Error('offline'); },
        loadFile: async file => { window.file = file; },
        close() {},
      };
      views.push(this);
    }
  }
  const pane = {
    isTeamsUrl: () => false,
    TeamsPane: class { layout() {} destroy() {} },
  };
  const electron = {
    app: { isPackaged: false, setName() {}, on: (name, fn) => { events[name] = fn; },
      whenReady: () => ({ then: fn => { ready = fn(); } }) },
    BaseWindow: Window, BrowserWindow:Window, WebContentsView: View, ipcMain:{handle(){}},
    Menu: { setApplicationMenu() {}, buildFromTemplate: template => template },
    shell: { openExternal: url => external.push(url) },
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../desktop/main.cjs'), 'utf8'), {
    require: name => name === 'electron' ? electron : name === './teams-pane.cjs' ? pane : name === './sharepoint-pane.cjs' ? {SharePointPane:class{layout(){}destroy(){}hide(){}}} : name === 'node:child_process' ? {execFile(){throw Error('Unexpected process launch')}} : require(name),
    process: { platform: 'win32', resourcesPath: '/resources' },
    __dirname: path.join(__dirname, '../desktop'), URL, console,
  });
  await ready;
  return { windows, external, events };
}

test('launches live site without filesystem writes or a backend, with isolated renderer', async () => {
  const { windows } = await launch();
  assert.equal(windows[0].url, 'https://ops.northstarenergy.ca/northstar-clean.html');
  assert.equal(path.basename(windows[0].options.icon), 'northstar.ico');
  const prefs = windows[0].rendererOptions.webPreferences;
  assert.equal(prefs.sandbox, true);
  assert.equal(prefs.contextIsolation, true);
  assert.equal(prefs.nodeIntegration, false);
  assert.equal(prefs.preload, undefined);
});

test('keeps live links in app and blocks lookalike origins and executable schemes', async () => {
  const { windows: [window], external } = await launch();
  assert.equal(window.open({ url: 'https://ops.northstarenergy.ca/event-detail.html?id=1' }).action, 'allow');
  assert.equal(window.open({ url: 'https://ops.northstarenergy.ca.evil.test/' }).action, 'deny');
  assert.equal(window.open({ url: 'file:///C:/test.exe' }).action, 'deny');
  assert.equal(external.length, 1);
  let prevented = false;
  window.events['will-navigate']({ preventDefault: () => { prevented = true; } }, 'javascript:alert(1)');
  assert.equal(prevented, true);
  assert.equal(external.length, 1);
});

test('offline startup shows retry page and closing clears the window for reactivation', async () => {
  const { windows, events } = await launch(true);
  assert.equal(path.basename(windows[0].file), 'error.html');
  windows[0].events.closed();
  events.activate();
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(windows.length, 2);
  assert.equal(windows[1].url, 'https://ops.northstarenergy.ca/northstar-clean.html');
});
