/* Dashboard-owned context menu. Keeps browser editing menus on form fields. */
(() => {
  const menuId='nsDashboardContextMenu';
  const nav=[['overview','Overview'],['logbook','Event log'],['markets','Markets'],['weather','Weather'],['tools','Tools']];
  const interactive=target=>target.closest('input,textarea,select,[contenteditable="true"],a[href],button,[role="button"]');
  const close=()=>document.getElementById(menuId)?.remove();
  const openSection=id=>{
    close();
    if(window.NorthstarModules?.open)window.NorthstarModules.open(id);
    else document.querySelector(`#sideNav [data-tab="${CSS.escape(id)}"]`)?.click();
  };
  const editLayout=()=>{close();document.querySelector('.layout-edit-toggle')?.click();};
  const reload=()=>{close();location.reload();};
  const copyLink=async()=>{
    close();
    try{await navigator.clipboard.writeText(location.href);}catch{window.prompt('Copy dashboard link:',location.href);}
  };
  const position=(menu,x,y)=>{
    document.body.append(menu);
    const box=menu.getBoundingClientRect();
    menu.style.left=Math.max(8,Math.min(x,innerWidth-box.width-8))+'px';
    menu.style.top=Math.max(8,Math.min(y,innerHeight-box.height-8))+'px';
  };
  const show=event=>{
    if(event.defaultPrevented)return;
    const asset=window.NorthstarAssetInspector?.resolve(event.target);
    const value=window.NorthstarAssetHistory?.resolve(event.target);
    if(!asset && interactive(event.target))return;
    event.preventDefault();close();
    const editing=document.body.classList.contains('layout-edit');
    const menu=document.createElement('menu');
    menu.id=menuId;menu.className='ns-dashboard-context-menu';menu.setAttribute('aria-label','Dashboard menu');
    menu.innerHTML=`<li class="ns-context-title">${asset?'ASSET ACTIONS':'NORTHSTAR DASHBOARD'}</li>${asset?'<li><button type="button" data-inspect>Inspect asset</button></li>':''}${value?'<li><button type="button" data-history>View history</button></li>':''}${asset?'<li class="ns-context-separator" role="separator"></li>':''}${nav.map(([id,label])=>`<li><button type="button" data-section="${id}">${label}</button></li>`).join('')}<li class="ns-context-separator" role="separator"></li><li><button type="button" data-edit>${editing?'Finish layout editing':'Edit layout'}</button></li><li><button type="button" data-style>Appearance</button></li><li class="ns-context-separator" role="separator"></li><li><button type="button" data-copy>Copy dashboard link</button></li><li><button type="button" data-reload>Reload dashboard</button></li>`;
    menu.querySelector('[data-inspect]')?.addEventListener('click',()=>{close();window.NorthstarAssetInspector.open(asset);});
    menu.querySelector('[data-history]')?.addEventListener('click',()=>{close();window.NorthstarAssetHistory.open(value);});
    menu.querySelectorAll('[data-section]').forEach(button=>button.addEventListener('click',()=>openSection(button.dataset.section)));
    menu.querySelector('[data-edit]').addEventListener('click',editLayout);
    menu.querySelector('[data-style]').addEventListener('click',()=>{close();document.querySelector('.layout-style-toggle')?.click();});
    menu.querySelector('[data-copy]').addEventListener('click',copyLink);
    menu.querySelector('[data-reload]').addEventListener('click',reload);
    position(menu,event.clientX,event.clientY);
  };
  document.addEventListener('contextmenu',show,true);
  document.addEventListener('pointerdown',event=>{if(!event.target.closest('#'+menuId))close();},true);
  document.addEventListener('keydown',event=>{if(event.key==='Escape')close();});
})();
