"use strict";

const { app, BaseWindow, BrowserWindow, WebContentsView, Menu, shell, ipcMain } = require("electron");
const { execFile } = require("node:child_process");
const { TeamsPane, isTeamsUrl } = require("./teams-pane.cjs");
const { SharePointPane } = require("./sharepoint-pane.cjs");

const path = require("path");

const APP_NAME = "NorthStar Control Room";
const LIVE_ORIGIN = "https://ops.northstarenergy.ca";
const LIVE_URL = `${LIVE_ORIGIN}/northstar-clean.html`;
const WINDOW_OPTIONS = {
  icon: path.join(__dirname, "northstar.ico"),
  width: 1440,
  height: 960,
  minWidth: 1024,
  minHeight: 700,
  show: false,
  backgroundColor: "#091319",
};

let mainWindow;
let dashboard;
let teams;
let sharepoint;
let controlCenter;
let isQuitting = false;
ipcMain.handle('northstar:module-window', (event, action) => {
  const url=new URL(event.sender.getURL());
  if (!isLiveUrl(url.href) || !url.searchParams.has('nsModuleWindow')) return false;
  const win=BrowserWindow.fromWebContents(event.sender);if(!win)return false;
  if(action==='minimize')win.minimize();
  else if(action==='maximize'){if(win.isMaximized())win.unmaximize();else win.maximize();}
  else if(action==='close')win.close();
  else return false;
  return true;
});

function createWindow() {
  mainWindow = new BaseWindow(WINDOW_OPTIONS);
  dashboard = new WebContentsView({ webPreferences: {
    contextIsolation: true, nodeIntegration: false, sandbox: true,
  } });
  mainWindow.contentView.addChildView(dashboard);
  teams = new TeamsPane(mainWindow, dashboard);
  sharepoint = new SharePointPane(mainWindow, dashboard);
  dashboard.webContents.setWindowOpenHandler(({ url }) => {
    if (isTeamsUrl(url)) { teams.open(url); return { action: "deny" }; }
    if (isLiveUrl(url)) return { action: "allow", overrideBrowserWindowOptions: {
      resizable: true, minimizable: true, maximizable: true,
      webPreferences: { preload: path.join(__dirname, 'module-window-preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true },
    } };
    openExternalLink(url);
    return { action: "deny" };
  });
  dashboard.webContents.on("will-navigate", (event, url) => {
    const allowed = isLiveUrl(url);
    if (!allowed) {
      event.preventDefault();
      if (isTeamsUrl(url)) teams.open(url);
      else openExternalLink(url);
    }
  });
  dashboard.webContents.on("page-title-updated", (_event, title) => mainWindow?.setTitle(title));
  mainWindow.on("resize", () => { teams.layout(); sharepoint.layout(); });
  mainWindow.on("closed", () => {
    teams.destroy();
    sharepoint.destroy();
    dashboard.webContents.close();
    mainWindow = dashboard = teams = undefined;
  });
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: "\u2630", submenu: [
      { label: "Refresh Dashboard", accelerator: "CmdOrCtrl+R", click: () => dashboard.webContents.reloadIgnoringCache() },
      { label: "Full Screen", role: "togglefullscreen" },
      { label: "Build View", submenu: [
        ...["v1", "v2"].map(label => ({ label, click: () => { void dashboard.webContents.executeJavaScript(`window.NorthStarBuildView?.set(${JSON.stringify(label)})`).catch(() => {}); } })),
      ] },
      { label: "Station Display", submenu: [
        ...["Graphical", "List"].map(label => ({ label, click: () => { void dashboard.webContents.executeJavaScript(`window.NorthStarStationDisplay?.set(${JSON.stringify(label.toLowerCase())})`).catch(() => {}); } })),
      ] },
      { label: "Edit Layout", click: () => { void dashboard.webContents.executeJavaScript("document.querySelector('.layout-edit-toggle')?.click()").catch(() => {}); } },
      { label: "Account Settings", click: () => { void dashboard.webContents.executeJavaScript("document.querySelector('#sideNav [data-tab=account]')?.click()").catch(() => {}); } },
      { label: "Exit", role: "quit" },
    ] },
  ]));
  teams.layout();
  mainWindow.show();
  return mainWindow;
}

function projectRoot() { return process.env.NORTHSTAR_PROJECT_ROOT || require("../package.json").northstarProjectRoot || path.resolve(__dirname, ".."); }
function powerShellPath() { return path.join(process.env.SystemRoot || process.env.windir || "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe"); }
function powershell(args = []) {
  return new Promise((resolve, reject) => {
    execFile(powerShellPath(), ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", path.join(projectRoot(), "start-northstar.ps1"), ...args], { cwd: projectRoot(), windowsHide: true }, (error, stdout, stderr) => {
      if (error) reject(new Error(stderr.trim() || error.message)); else resolve(stdout.trim());
    });
  });
}
async function localStatus() { try { const response = await fetch("http://127.0.0.1:4180/api/health"); const data = await response.json(); return { ok: response.ok && data?.database?.ok === true, message: response.ok ? `RUNNING\nDatabase: ${data?.database?.ok ? "healthy" : "unhealthy"}` : "Backend unavailable" }; } catch { return { ok: false, message: "STOPPED or unreachable" }; } }
async function control(action, target) {
  if (target === "production") { if (action === "dashboard") { openExternalLink(LIVE_URL); return { ok: true, message: "Opened production dashboard." }; } if (action === "status" || action === "refresh") { try { const response = await fetch(`${LIVE_ORIGIN}/api/health`); return { ok: response.ok, message: response.ok ? "Production dashboard is reachable." : `Production returned HTTP ${response.status}.` }; } catch { return { ok: false, message: "Production dashboard is unreachable." }; } } return { ok: false, message: "Production management agent is not installed." }; }
  if (action === "status") return localStatus();
  if (action === "dashboard") { openExternalLink("http://localhost:4180/northstar-clean.html"); return { ok: true, message: "Opened local dashboard." }; }
  if (action === "launch" || action === "restart") { if (action === "restart") await control("stop", "local"); await powershell(["-LocalOnly", "-DemoLogin", "-NoBrowser"]); return { ok: true, message: "Local NorthStar launch requested." }; }
  if (action === "stop") { await new Promise((resolve, reject) => execFile(powerShellPath(), ["-NoProfile", "-Command", "Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match 'ieso_backend\\.py' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }"], { windowsHide: true }, error => error ? reject(error) : resolve())); return { ok: true, message: "Local NorthStar stopped." }; }
  if (action === "logs") { const log = path.join(projectRoot(), "data", "northstar-backend.out.log"); const { readFile } = require("node:fs/promises"); try { return { ok: true, message: (await readFile(log, "utf8")).split(/\r?\n/).slice(-30).join("\n") || "No log output." }; } catch { return { ok: false, message: "Log file unavailable." }; } }
  return { ok: false, message: "Unknown control action." };
}
function openControlCenter() { if (controlCenter && !controlCenter.isDestroyed()) { controlCenter.focus(); return; } controlCenter = new BrowserWindow({ width: 1100, height: 720, minWidth: 760, minHeight: 560, title: "NorthStar Control Center", backgroundColor: "#091319", webPreferences: { preload: path.join(__dirname, "preload.cjs"), contextIsolation: true, nodeIntegration: false, sandbox: true } }); controlCenter.loadFile(path.join(__dirname, "control-center.html")); controlCenter.on("closed", () => { controlCenter = undefined; }); }
ipcMain.handle("northstar:control", (_event, request) => control(request?.action, request?.target));

function isLiveUrl(value) {
  try { return new URL(value).origin === LIVE_ORIGIN; } catch { return false; }
}

function openExternalLink(value) {
  try {
    if (["https:", "http:", "mailto:"].includes(new URL(value).protocol)) void shell.openExternal(value);
  } catch { /* Ignore malformed links. */ }
}

async function loadDashboard() {
  await dashboard.webContents.session.clearCache();
  await dashboard.webContents.loadURL(LIVE_URL);
}

function showStartupFailure(error) {
  const detail = error instanceof Error ? error.message : String(error);
  if (!mainWindow) createWindow();
  void dashboard.webContents.loadFile(path.join(__dirname, "error.html"), { query: { detail } });
}

app.whenReady().then(async () => {
  app.setName(APP_NAME);
  try {

    createWindow();
    await loadDashboard();
  } catch (error) {
    showStartupFailure(error);
  }
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
app.on("before-quit", () => {
  isQuitting = true;
});
app.on("activate", () => {
  if (!mainWindow && !isQuitting) {
    createWindow();
    void loadDashboard().catch(showStartupFailure);
  }
});
