'use strict';
const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('northstarWindow',{openMenu:()=>ipcRenderer.send('northstar:dashboard-menu')});
