"use strict";

const { WebContentsView, shell } = require("electron");

const HOME = "https://www.office.com/launch/sharepoint";
const AUTH_HOSTS = new Set(["login.microsoftonline.com", "login.microsoft.com", "login.windows.net"]);

function isSharePointUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password && !url.port &&
      (url.hostname === "office.com" || url.hostname.endsWith(".office.com") || url.hostname.endsWith(".sharepoint.com"));
  } catch { return false; }
}
function isAllowedNavigation(value) {
  try {
    const url = new URL(value);
    return isSharePointUrl(value) || (url.protocol === "https:" && AUTH_HOSTS.has(url.hostname));
  } catch { return false; }
}
function openExternal(value) {
  try { if (["https:", "http:", "mailto:"].includes(new URL(value).protocol)) void shell.openExternal(value); } catch {}
}

class SharePointPane {
  constructor(window, dashboard) { this.window = window; this.dashboard = dashboard; this.view = null; this.visible = false; this.expanded = false; }
  create() {
    this.view = new WebContentsView({ webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, partition: "persist:northstar-sharepoint" } });
    this.window.contentView.addChildView(this.view);
    const contents = this.view.webContents;
    contents.on("will-navigate", (event, url) => { if (!isAllowedNavigation(url)) { event.preventDefault(); openExternal(url); } });
    contents.setWindowOpenHandler(({ url }) => isAllowedNavigation(url) ? { action: "allow" } : (openExternal(url), { action: "deny" }));
  }
  open(expanded = true) { if (!this.view) this.create(); this.visible = true; this.expanded = expanded; this.layout(); if (this.view.webContents.getURL() !== HOME) void this.view.webContents.loadURL(HOME); this.view.webContents.focus(); }
  hide() { this.visible = false; this.layout(); this.dashboard.webContents.focus(); }
  layout() { const [width, height] = this.window.getContentSize(); const paneWidth = !this.visible ? 0 : this.expanded ? width : Math.min(width, Math.max(480, Math.round(width * .44))); this.dashboard.setVisible(paneWidth < width); this.dashboard.setBounds({ x: 0, y: 0, width: Math.max(1, width - paneWidth), height }); if (this.view) { this.view.setVisible(this.visible); this.view.setBounds({ x: width - paneWidth, y: 0, width: Math.max(1, paneWidth), height }); } }
  destroy() { if (this.view && !this.view.webContents.isDestroyed()) this.view.webContents.close(); this.view = null; }
}

module.exports = { SharePointPane };
