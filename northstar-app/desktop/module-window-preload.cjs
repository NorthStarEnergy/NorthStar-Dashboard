'use strict';
const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('northstarModuleWindow',{
  control:action=>ipcRenderer.invoke('northstar:module-window',action),
});
