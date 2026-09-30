const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

function setup() {
  const views = [], external = [];
  class View {
    constructor(options) {
      this.options = options;
      this.events = {};
      this.webContents = {
        setWindowOpenHandler: fn => { this.open = fn; },
        on: (name, fn) => { this.events[name] = fn; },
        loadURL: async url => { this.url = url; },
        loadFile: async file => { this.file = file; this.url = 'file://' + file; },
        getURL: () => this.url,
        getUserAgent: () => 'Mozilla/5.0 Chrome/150.0.0.0 Electron/44.4.3 Safari/537.36',
        setUserAgent: value => { this.userAgent = value; },
        close: () => { this.closed = true; },
        focus: () => { this.focused = true; },
        isDestroyed: () => Boolean(this.closed),
        reload: () => { this.reloaded = true; },
        session: {
          setUserAgent: value => { this.userAgent = value; },
          setPermissionCheckHandler: fn => { this.permissionCheck = fn; },
          setPermissionRequestHandler: fn => { this.permissionRequest = fn; },
        },
      };
      views.push(this);
    }
    setBounds(bounds) { this.bounds = bounds; }
    setVisible(value) { this.visible = value; }
  }
  const electron = {
    WebContentsView: View,
    shell: { openExternal: url => external.push(url) },
    dialog: { showMessageBox: async () => ({ response: 0 }) },
  };
  const mod = { exports: {} };
  const desktop = path.join(__dirname, '../desktop');
  vm.runInNewContext(fs.readFileSync(path.join(desktop, 'teams-pane.cjs'), 'utf8'), {
    require: name => name === 'electron' ? electron : require(name), module: mod, __dirname: desktop, URL,
  });
  const window = { size: [1440, 920], getContentSize() { return this.size; }, contentView: { addChildView() {} } };
  const dashboard = new View({});
  const pane = new mod.exports.TeamsPane(window, dashboard);
  return { views, external, window, dashboard, pane, ...mod.exports };
}

test('Teams loads only when requested and remains isolated from dashboard and native APIs', () => {
  const { pane, views } = setup();
  assert.equal(views.length, 1);
  pane.open();
  const prefs = views[1].options.webPreferences;
  assert.equal(views[1].url, 'https://teams.microsoft.com/v2/');
  assert.equal(prefs.partition, 'persist:northstar-teams');
  assert.equal(prefs.sandbox, true);
  assert.equal(prefs.contextIsolation, true);
  assert.equal(prefs.nodeIntegration, false);
  assert.equal(prefs.preload, undefined);
  assert.equal(views[1].userAgent, 'Mozilla/5.0 Chrome/150.0.0.0 Safari/537.36');
});

test('resize, expand and hide retain Teams session and restore dashboard space', () => {
  const { pane, views, window, dashboard } = setup();
  pane.open();
  const teams = views[1];
  assert.equal(dashboard.bounds.width + teams.bounds.width, 1440);
  assert.equal(teams.bounds.x, dashboard.bounds.width);
  window.size = [1024, 680];
  pane.layout();
  assert.equal(dashboard.bounds.width + teams.bounds.width, 1024);
  pane.open(undefined, true);
  assert.equal(dashboard.visible, false);
  assert.equal(teams.bounds.width, 1024);
  pane.hide();
  assert.equal(dashboard.visible, true);
  assert.equal(dashboard.bounds.width, 1024);
  assert.equal(teams.visible, false);
  pane.open();
  assert.equal(views.length, 2);
  assert.equal(teams.visible, true);
  pane.destroy();
  assert.equal(teams.closed, true);
});

test('Microsoft sign-in popups stay isolated; external links and forged Teams origins cannot gain app access', () => {
  const { pane, views, external, isTeamsUrl } = setup();
  pane.open();
  const teams = views[1];
  for (const url of ['https://login.microsoftonline.com/common/oauth2/v2.0/authorize', 'about:blank']) {
    const popup = teams.open({ url });
    assert.equal(popup.action, 'allow');
    assert.equal(popup.overrideBrowserWindowOptions.webPreferences.sandbox, true);
  }
  assert.equal(teams.open({ url: 'https://example.com/' }).action, 'deny');
  assert.equal(external[0], 'https://example.com/');
  for (const url of ['https://teams.microsoft.com.evil.test/', 'http://teams.microsoft.com/', 'https://fake@teams.microsoft.com/', 'https://teams.microsoft.com:8080/', 'javascript:alert(1)']) {
    assert.equal(isTeamsUrl(url), false);
  }
  let blocked = false;
  teams.events['will-redirect']({ preventDefault: () => { blocked = true; } }, 'file:///C:/secret.txt');
  assert.equal(blocked, true);
  assert.equal(external.length, 1);
});

test('unapproved device permissions stay denied and a failed load can be retried', async () => {
  const { pane, views } = setup();
  pane.open();
  const teams = views[1];
  let allowed = true;
  await teams.permissionRequest(teams.webContents, 'geolocation', value => { allowed = value; }, {});
  assert.equal(allowed, false);
  await teams.permissionRequest(teams.webContents, 'media', value => { allowed = value; }, {});
  assert.equal(allowed, false);
  assert.equal(teams.permissionCheck(null, 'media', 'https://example.com/'), false);
  teams.events['did-fail-load']({}, -105, 'offline', 'https://teams.microsoft.com/v2/', true);
  assert.equal(path.basename(teams.file), 'teams-error.html');
  pane.reload();
  assert.equal(teams.url, 'https://teams.microsoft.com/v2/');
});
