"use strict";
const { BrowserWindow, WebContentsView, Menu, ipcMain, shell } = require('electron');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const HEIGHT = 36;
const shellFile = path.join(__dirname, 'dashboard-shell.html');
const shellUrl = pathToFileURL(shellFile).href;

function createDashboardWindow(url) {
  const win = new BrowserWindow({width:1440,height:960,minWidth:1024,minHeight:700,
    title:'NorthStar Control Room',backgroundColor:'#091319',icon:path.join(__dirname,'northstar.ico'),
    titleBarStyle:'hidden',titleBarOverlay:{color:'#101b23',symbolColor:'#e6f0f5',height:HEIGHT},
    webPreferences:{preload:path.join(__dirname,'dashboard-shell-preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true}});
  win.setMenu(null);
  const view = new WebContentsView({webPreferences:{contextIsolation:true,nodeIntegration:false,sandbox:true}});
  win.contentView.addChildView(view);
  win.dashboardView = view;
  const resize = () => {const [width,height]=win.getContentSize();view.setBounds({x:0,y:HEIGHT,width,height:Math.max(0,height-HEIGHT)});};
  win.on('resize',resize);resize();
  const trusted = () => {try{return new URL(view.webContents.getURL()).origin===new URL(url).origin;}catch{return false;}};
  const invoke = code => {if(trusted())void view.webContents.executeJavaScript(code).catch(()=>{});};
  const menu = Menu.buildFromTemplate([
    {label:'User profile',submenu:[{label:'Change avatar',click:()=>invoke("document.querySelector('.ns-shared-avatar')?.click()")}]},
    {label:'Chat',click:()=>invoke('window.NorthStarSharedChat?.open()')},
    {type:'separator'},
    {label:'Reload dashboard',accelerator:'CmdOrCtrl+R',click:()=>view.webContents.reload()},
    {label:'Edit',submenu:[{label:'Undo',accelerator:'CmdOrCtrl+Z',click:()=>view.webContents.undo()},{label:'Redo',accelerator:'CmdOrCtrl+Y',click:()=>view.webContents.redo()},{type:'separator'},{label:'Cut',accelerator:'CmdOrCtrl+X',click:()=>view.webContents.cut()},{label:'Copy',accelerator:'CmdOrCtrl+C',click:()=>view.webContents.copy()},{label:'Paste',accelerator:'CmdOrCtrl+V',click:()=>view.webContents.paste()},{label:'Select all',accelerator:'CmdOrCtrl+A',click:()=>view.webContents.selectAll()}]},
    {label:'View',submenu:[{label:'Zoom in',click:()=>view.webContents.setZoomLevel(Math.min(5,view.webContents.getZoomLevel()+.5))},{label:'Zoom out',click:()=>view.webContents.setZoomLevel(Math.max(-3,view.webContents.getZoomLevel()-.5))},{label:'Actual size',click:()=>view.webContents.setZoomLevel(0)},{label:'Full screen',accelerator:'F11',click:()=>win.setFullScreen(!win.isFullScreen())}]},
    {type:'separator'},
    {label:'Minimize',click:()=>win.minimize()},
    {label:'Maximize / Restore',click:()=>win.isMaximized()?win.unmaximize():win.maximize()},
    {label:'Close window',click:()=>win.close()}
  ]);
  const onMenu = event => {
    if(event.sender!==win.webContents || event.senderFrame!==win.webContents.mainFrame || event.senderFrame.url!==shellUrl)return;
    menu.popup({window:win,x:8,y:HEIGHT});
  };
  ipcMain.on('northstar:dashboard-menu',onMenu);
  view.webContents.on('did-finish-load',()=>{
    if(trusted())void view.webContents.insertCSS('body .app>aside .brand>.ns-account-menu{display:none!important} body .app>aside .brand.brand-home:has(>.ns-account-menu){grid-template-columns:26px minmax(0,1fr)!important}').catch(()=>{});
  });
  view.webContents.setWindowOpenHandler(({url:target})=>{if(/^https?:\/\//i.test(target))void shell.openExternal(target);return {action:'deny'};});
  view.webContents.on('before-input-event',(event,input)=>{
    if(input.type!=='keyDown')return;
    if((input.control||input.meta)&&input.key.toLowerCase()==='r'){event.preventDefault();view.webContents.reload();}
    if(input.key==='F11'){event.preventDefault();win.setFullScreen(!win.isFullScreen());}
    if(input.key==='Escape'&&win.isFullScreen()){event.preventDefault();win.setFullScreen(false);}
    if(input.key==='F10'){event.preventDefault();menu.popup({window:win,x:8,y:HEIGHT});}
  });
  win.on('closed',()=>{ipcMain.removeListener('northstar:dashboard-menu',onMenu);if(!view.webContents.isDestroyed())view.webContents.close();});
  win.dashboardReady=Promise.all([win.loadFile(shellFile),view.webContents.loadURL(url)]).then(()=>undefined);
  return win;
}
module.exports={createDashboardWindow};
