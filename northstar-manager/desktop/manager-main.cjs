"use strict";
const { app, BrowserWindow, ipcMain, shell } = require("electron");
const { execFile } = require("node:child_process");
const { readFile } = require("node:fs/promises");
const path = require("node:path");
const { createDashboardWindow } = require("./dashboard-window.cjs");

let window;
let localDashboardWindow;
const LIVE_ORIGIN = "https://ops.northstarenergy.ca";
const LOCAL_DASHBOARD_URL = "https://ops.northstarenergy.ca/northstar-clean.html";
function projectRoot() {
  const configured = process.env.NORTHSTAR_PROJECT_ROOT || require("../package.json").northstarProjectRoot;
  return configured || path.resolve(__dirname, "..");
}
function powerShellPath() {
  return path.join(process.env.SystemRoot || process.env.windir || "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
}
function powershell(args = []) {
  return new Promise((resolve, reject) => {
    execFile(powerShellPath(), ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", path.join(projectRoot(), "..", "Manage-NorthStar.ps1"), ...args], { cwd: projectRoot(), windowsHide: true }, (error, stdout, stderr) => {
      if (error) reject(new Error(stderr.trim() || error.message)); else resolve(stdout.trim());
    });
  });
}
async function localStatus() {
  try {
    const response = await fetch("http://127.0.0.1:4180/api/health");
    const data = await response.json();
    const version = await readDashboardVersion();
    const healthy = response.ok && data?.database?.ok === true;
    return { ok: healthy, message: `Service: ${healthy ? "healthy" : "unhealthy"}\nDatabase: ${data?.database?.ok ? "healthy" : "unhealthy"}\nDashboard: ${version || "version unavailable"}\nManager: ${require("../package.json").version}` };
  } catch { return { ok: false, message: "STOPPED or unreachable" }; }
}
async function readDashboardVersion() {
  try { return (await readFile(path.join(projectRoot(), "BUILD-VERSION.txt"), "utf8")).split(/\r?\n/, 1)[0].trim(); }
  catch { return "version unavailable"; }
}
async function productionStatus() {
  try {
    const healthResponse = await fetch(`${LIVE_ORIGIN}/api/health`, { signal: AbortSignal.timeout(5000) });
    const health = await healthResponse.json();
    if (!healthResponse.ok) return { ok: false, message: `Service: HTTP ${healthResponse.status}` };
    let release = "requires operator sign-in";
    try {
      const releaseResponse = await fetch(`${LIVE_ORIGIN}/api/client-release`, { signal: AbortSignal.timeout(5000) });
      if (releaseResponse.ok) {
        const payload = await releaseResponse.json();
        release = payload?.dashboard?.version || "version unavailable";
      } else if (releaseResponse.status !== 401 && releaseResponse.status !== 403) {
        release = `check unavailable (HTTP ${releaseResponse.status})`;
      }
    } catch { release = "check unavailable"; }
    const healthy = health?.database?.ok === true;
    return { ok: healthy, message: `Service: ${healthy ? "healthy" : "unhealthy"}\nDatabase: ${health?.database?.ok ? "healthy" : "unhealthy"}\nDashboard: ${release}\nUpdates: checked after operator sign-in` };
  } catch { return { ok: false, message: "Service: unreachable" }; }
}
async function control(action, target) {
  if (target === "production") {
    if (action === "status" || action === "refresh") return productionStatus();
    if (action === "dashboard") { await shell.openExternal(`${LIVE_ORIGIN}/operator-login.html?managerLaunch=${Date.now()}`); return { ok: true, message: "Opened production dashboard sign-in." }; }
    return { ok: false, message: "Production lifecycle controls are not configured." };
  }
  if (action === "version") return { ok: true, message: require("../package.json").version };
  if (action === "status") return localStatus();
  if (action === "dashboard") {
    if (localDashboardWindow && !localDashboardWindow.isDestroyed()) {
      localDashboardWindow.focus();
      return { ok: true, message: "Focused local dashboard window." };
    }
    await waitForLocalDashboard();
    await openLocalDashboard();
    return { ok: true, message: "Opened local dashboard in NorthStar Manager." };
  }
  if (action === "launch" || action === "restart") {
    await powershell(["-Action", action]);
    await waitForLocalDashboard();
    await openLocalDashboard();
    return { ok: true, message: "NorthStar server is running on this PC." };
  }
  if (action === "stop") {
    await powershell(["-Action", "stop"]);
    return { ok: true, message: "NorthStar server stopped." };
  }
  if (action === "logs") {
    try { return { ok: true, message: (await readFile(path.join(projectRoot(), "data", "northstar-backend.out.log"), "utf8")).split(/\r?\n/).slice(-30).join("\n") || "No log output." }; }
    catch { return { ok: false, message: "Log file unavailable." }; }
  }
  return { ok: false, message: "Unknown control action." };
}
function openLocalDashboard() {
  if (localDashboardWindow && !localDashboardWindow.isDestroyed()) {
    localDashboardWindow.focus();
    return Promise.resolve();
  }
  localDashboardWindow = createDashboardWindow(LOCAL_DASHBOARD_URL);
  localDashboardWindow.on("closed", () => { localDashboardWindow = undefined; });
  return localDashboardWindow.dashboardReady.catch(error => {
    if (localDashboardWindow && !localDashboardWindow.isDestroyed()) localDashboardWindow.close();
    localDashboardWindow = undefined;
    throw new Error(`Could not load local dashboard at ${LOCAL_DASHBOARD_URL}: ${error.message}`);
  });
}
async function waitForLocalDashboard() {
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch("http://127.0.0.1:4180/api/health", { signal: AbortSignal.timeout(1500) });
      const health = await response.json();
      if (response.ok && health?.database?.ok === true) return;
    } catch { /* The backend may still be starting. */ }
    await new Promise(resolve => setTimeout(resolve, 400));
  }
  throw new Error("Local NorthStar did not become healthy. Check the local service logs.");
}
ipcMain.handle("northstar:control", (_event, request) => control(request?.action, request?.target));

function createManager() {
  window = new BrowserWindow({ width: 1100, height: 720, minWidth: 760, minHeight: 560, title: "NorthStar Manager", backgroundColor: "#091319", icon: path.join(__dirname, "manager.ico"), webPreferences: { preload: path.join(__dirname, "preload.cjs"), contextIsolation: true, nodeIntegration: false, sandbox: true } });
  window.loadFile(path.join(__dirname, "control-center.html"));
  window.on("closed", () => { window = undefined; });
}
app.whenReady().then(createManager);
app.on("window-all-closed", () => app.quit());
