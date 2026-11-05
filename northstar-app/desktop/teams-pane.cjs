"use strict";

const { WebContentsView, dialog, shell } = require("electron");
const path = require("node:path");

const HOME = "https://teams.microsoft.com/v2/";
const TEAMS_HOSTS = new Set(["teams.microsoft.com", "teams.cloud.microsoft", "teams.live.com"]);
const AUTH_HOSTS = new Set(["login.microsoftonline.com", "login.microsoft.com", "login.live.com", "account.live.com", "login.windows.net"]);

function allowedHost(value, hosts) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password && !url.port && hosts.has(url.hostname);
  } catch { return false; }
}

function isTeamsUrl(value) { return allowedHost(value, TEAMS_HOSTS); }
function isTeamsNavigation(value) { return isTeamsUrl(value) || allowedHost(value, AUTH_HOSTS); }
function openExternal(value) {
  try {
    if (["https:", "http:", "mailto:"].includes(new URL(value).protocol)) void shell.openExternal(value);
  } catch { /* Ignore invalid links and executable protocols. */ }
}

class TeamsPane {
  constructor(window, dashboard) {
    this.window = window;
    this.dashboard = dashboard;
    this.view = null;
    this.visible = false;
    this.expanded = false;
    this.popups = new Set();
    this.permissions = new Set();
  }

  create() {
    this.view = new WebContentsView({ webPreferences: {
      contextIsolation: true, nodeIntegration: false, sandbox: true,
      partition: "persist:northstar-teams",
    } });
    this.window.contentView.addChildView(this.view);
    const contents = this.view.webContents;
    // Teams treats the Electron token as its retired classic desktop client.
    // Keep the actual Chromium version and use the web client in this session.
    const webAgent = contents.getUserAgent().replace(/\sElectron\/\S+/g, "");
    contents.session.setUserAgent(webAgent);
    contents.setUserAgent(webAgent);
    contents.session.setPermissionCheckHandler((_wc, permission, origin) =>
      isTeamsUrl(origin) && this.permissions.has(permission));
    contents.session.setPermissionRequestHandler(async (wc, permission, callback, details) => {
      if (!wc || !isTeamsUrl(wc.getURL()) || !isTeamsUrl(details.requestingUrl || wc.getURL()) ||
          !["media", "notifications", "clipboard-sanitized-write"].includes(permission)) return callback(false);
      if (permission === "clipboard-sanitized-write" || this.permissions.has(permission)) return callback(true);
      const purpose = permission === "media" ? "your camera and microphone" : "desktop notifications";
      try {
        const result = await dialog.showMessageBox(this.window, {
          type: "question", title: "Microsoft Teams", message: `Allow Teams to use ${purpose}?`,
          buttons: ["Not now", "Allow"], defaultId: 0, cancelId: 0,
        });
        if (result.response === 1) this.permissions.add(permission);
        callback(result.response === 1);
      } catch { callback(false); }
    });
    this.guard(contents);
    contents.on("did-fail-load", (_event, code, _description, url, isMainFrame) => {
      if (isMainFrame && code !== -3 && isTeamsNavigation(url)) this.showError();
    });
    contents.on("render-process-gone", () => this.showError());
  }

  guard(contents) {
    const guard = (event, url) => {
      if (isTeamsNavigation(url)) return;
      event.preventDefault();
      openExternal(url);
    };
    contents.on("will-navigate", guard);
    contents.on("will-redirect", guard);
    contents.setWindowOpenHandler(({ url }) => {
      if (url === "about:blank" || isTeamsNavigation(url)) return { action: "allow", overrideBrowserWindowOptions: {
        parent: this.window, width: 1000, height: 800, autoHideMenuBar: true,
        webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, partition: "persist:northstar-teams" },
      } };
      openExternal(url);
      return { action: "deny" };
    });
    contents.on("did-create-window", child => {
      this.popups.add(child);
      this.guard(child.webContents);
      child.on("closed", () => this.popups.delete(child));
    });
  }

  open(url, expanded = false) {
    if (url && !isTeamsUrl(url)) return;
    const fresh = !this.view;
    if (fresh) this.create();
    this.visible = true;
    this.expanded = expanded;
    this.layout();
    if (fresh || url) void this.view.webContents.loadURL(url || HOME).catch(() => this.showError());
    this.view.webContents.focus();
  }

  hide() {
    this.visible = false;
    this.layout();
    this.dashboard.webContents.focus();
  }

  reload() {
    if (!this.view) return this.open();
    if (isTeamsNavigation(this.view.webContents.getURL())) this.view.webContents.reload();
    else void this.view.webContents.loadURL(HOME).catch(() => this.showError());
  }

  layout() {
    const [width, height] = this.window.getContentSize();
    const teamsWidth = !this.visible ? 0 : this.expanded ? width : Math.min(width, Math.max(480, Math.round(width * 0.44)));
    const dashboardWidth = width - teamsWidth;
    this.dashboard.setVisible(dashboardWidth > 0);
    this.dashboard.setBounds({ x: 0, y: 0, width: Math.max(1, dashboardWidth), height });
    if (this.view) {
      this.view.setVisible(this.visible);
      this.view.setBounds({ x: dashboardWidth, y: 0, width: Math.max(1, teamsWidth), height });
    }
  }

  showError() {
    if (this.view && !this.view.webContents.isDestroyed()) {
      void this.view.webContents.loadFile(path.join(__dirname, "teams-error.html")).catch(() => {});
    }
  }

  destroy() {
    for (const child of this.popups) if (!child.isDestroyed()) child.destroy();
    this.popups.clear();
    if (this.view && !this.view.webContents.isDestroyed()) this.view.webContents.close();
    this.view = null;
    this.permissions.clear();
  }
}

module.exports = { TeamsPane, isTeamsUrl, isTeamsNavigation };
