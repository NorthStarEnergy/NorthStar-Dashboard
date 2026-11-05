"use strict";

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("northstarDesktop", {
  configureOperator: (credentials) => ipcRenderer.invoke("northstar:setup", credentials),
  control: (action, target) => ipcRenderer.invoke("northstar:control", { action, target }),
});
