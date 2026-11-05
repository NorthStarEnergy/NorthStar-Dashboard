/* Read-only details for a dashboard asset selected from the context menu. */
(() => {
  const ROOTS='.ns-status-module[data-status],[data-ns-compact],[data-ns-module],[data-layout-id],[data-overview-module],[data-module-id]';
  const EXCLUDE='#nsDashboardContextMenu,#nsAssetHistory,#nsAssetInspector,#nsAssetEditor,.layout-toolbar,nav,dialog,.ns-section-shell,.ns-window-controls,.ns-module-theme,.module-resize-handle,.canvas-resize-handle';
  const ownText=node=>[...node.childNodes].filter(child=>child.nodeType===Node.TEXT_NODE).map(child=>child.textContent).join('').trim();
  const readable=node=>(node?.innerText||node?.textContent||'').replace(/\s+/g,' ').trim().slice(0,240);
  const moduleName=root=>root?.getAttribute('aria-label')||root?.querySelector('h2,h3,.ns-module-caption')?.textContent?.trim()||root?.dataset.nsModule||root?.dataset.nsCompact||root?.dataset.status||root?.dataset.moduleId||root?.id||'Dashboard';
  const assetName=node=>node.getAttribute('aria-label')||node.getAttribute('alt')||node.getAttribute('title')||node.querySelector(':scope > small,:scope > label,:scope > h2,:scope > h3')?.textContent?.trim()||ownText(node)||node.dataset.assetId||node.dataset.nsAsset||node.id||node.localName;
  const resolve=target=>{
    if(!(target instanceof Element)||target.closest(EXCLUDE+',input,textarea,select,[contenteditable="true"]'))return null;
    if(!target.closest('main,#nsStatusBar'))return null;
    const root=target.closest(ROOTS);if(!root||root.matches('[hidden]'))return null;
    let node=target.closest('[data-ns-asset],[data-asset-id]');
    if(!node||!root.contains(node)){
      node=target.closest('img,svg,canvas,video,iframe,button,a,strong,b,span,small,label,p,h1,h2,h3,h4,h5,h6,em,output');
      if(!node||!root.contains(node)){
        const direct=ownText(target);
        node=direct&&direct.length<=120?target:null;
      }
    }
    if(!node||node===root)return null;
    const history=window.NorthstarAssetHistory?.resolve(target)||null;
    return {node,root,name:(history?.label||assetName(node)).slice(0,100),history};
  };
  const savedCustom=id=>{
    if(!id)return null;
    try{
      const roots=JSON.parse(localStorage.getItem('northstarRestoredV1_northstarAssetEditorV1')||'{}').roots||{};
      for(const record of Object.values(roots)){const asset=record.custom?.find(item=>item.id===id);if(asset)return asset;}
    }catch{}
    return null;
  };
  const typeOf=(node,custom,history)=>{
    if(custom)return custom.kind==='data'?'Live data asset':custom.kind==='image'?'Image':custom.kind==='heading'?'Heading':custom.kind==='text'?'Text':custom.kind||'Custom asset';
    if(history)return 'Numeric value';
    if(node.matches('img'))return 'Image';
    if(node.matches('svg,canvas'))return 'Chart or graphic';
    if(node.matches('button,a'))return 'Control or link';
    return 'Text or display asset';
  };
  const details=asset=>{
    const {node,root,history}=asset,custom=savedCustom(node.dataset.nsAsset);
    const box=node.getBoundingClientRect(),id=node.dataset.assetId||node.dataset.nsAsset||node.id||'Unassigned';
    const display=readable(node)||node.getAttribute('alt')||'No displayed text';
    const source=custom?.source?`Dashboard element #${custom.source}`:history?.source||'Current dashboard display';
    return {name:asset.name,type:typeOf(node,custom,history),module:moduleName(root),id,display,
      source,size:`${Math.round(box.width)} × ${Math.round(box.height)} px`,captured:new Date().toLocaleString(),
      binding:custom?.source||'',history};
  };
  const windowNode=()=>document.getElementById('nsAssetInspector');
  const close=()=>windowNode()?.remove();
  const open=asset=>{
    if(!asset?.node?.isConnected)return;
    close();const info=details(asset),panel=document.createElement('section');
    panel.id='nsAssetInspector';panel.setAttribute('role','dialog');panel.setAttribute('aria-labelledby','nsAssetInspectorTitle');
    panel.innerHTML='<header><div><small>ASSET DETAILS</small><h2 id="nsAssetInspectorTitle"></h2></div><button type="button" data-close aria-label="Close asset details">×</button></header><dl></dl><footer><button type="button" data-history hidden>View history</button></footer>';
    panel.querySelector('h2').textContent=info.name;
    const rows=[['Type',info.type],['Module',info.module],['Asset ID',info.id],['Displayed content',info.display],['Data source',info.source],['Rendered size',info.size],['Observed',info.captured]];
    if(info.binding)rows.splice(5,0,['Bound element',info.binding]);
    const list=panel.querySelector('dl');rows.forEach(([label,value])=>{const term=document.createElement('dt'),description=document.createElement('dd');term.textContent=label;description.textContent=value;list.append(term,description);});
    const historyButton=panel.querySelector('[data-history]');historyButton.hidden=!info.history;
    historyButton.onclick=()=>{if(info.history){close();window.NorthstarAssetHistory.open(info.history);}};
    panel.querySelector('[data-close]').onclick=close;
    document.body.append(panel);panel.querySelector('[data-close]').focus({preventScroll:true});
  };
  document.addEventListener('keydown',event=>{if(event.key==='Escape'&&windowNode())close();});
  window.NorthstarAssetInspector={resolve,open};
})();
