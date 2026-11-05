/* Visual module designer. Feed nodes stay in place and keep their live values.
 * Geometry belongs to NorthstarAssetLayout in v1-baseline-module-layout.js.
 * Preferences are local to this browser, with an explicit Saved checkpoint.
 */
(() => {
  'use strict';
  const KEY=new URLSearchParams(location.search).get('nsStatusWindow')==='1' && !new URLSearchParams(location.search).has('nsModuleWindow')?'northstarStatusWindowAssetsV1':'northstarRestoredV1_northstarAssetEditorV1', VERSION=1;
  const ROOTS='.ns-status-module[data-status],[data-ns-compact],[data-ns-module],[data-layout-id],[data-overview-module],[data-module-id],#overviewStaff #staffGroups > .staff-group[data-site]';
  const EXCLUDE='#nsAssetEditor,#nsAssetSelection,#nsSectionModuleMenu,dialog,nav,.layout-toolbar,.ns-section-shell,.ns-window-controls,.ns-module-theme,.ns-edit-module,.ns-open-module,.canvas-move-handle,.canvas-resize-handle,.module-resize-handle,.ns-window-handle,.ns-popout-edge,[data-status-layout-handle],script,style,link,option';
  const FIELDS={fontSize:'font-size',fontFamily:'font-family',fontStyle:'font-style',color:'color',background:'background-color',fontWeight:'font-weight',textAlign:'text-align',lineHeight:'line-height',radius:'border-radius',borderWidth:'border-width',borderStyle:'border-style',borderColor:'border-color',opacity:'opacity',z:'z-index',paddingTop:'padding-top',paddingRight:'padding-right',paddingBottom:'padding-bottom',paddingLeft:'padding-left'};
  const NUMBERS={x:[-20000,20000],y:[-20000,20000],w:[8,20000],h:[8,20000],fontSize:[6,200],lineHeight:[0.5,5],radius:[0,500],borderWidth:[0,100],opacity:[0,1],z:[-1,1000]};
  const copy=v=>JSON.parse(JSON.stringify(v)), $=(s,r=document)=>r.querySelector(s), $$=(s,r=document)=>[...r.querySelectorAll(s)];
  let state={version:VERSION,roots:{}}, panel, outline, selected=null, selectedMany=[], mode='modules', timer=0, dragging=false, undo=[], redo=[], originals=new Map(), originalText=new WeakMap(), lastRoots='', lastLayers='', storageError=false, wasEditing=false;
  const statusSizes=new Map();let statusReflowFrame=0,statusReflowTimer=0,statusResizeObserver=null;
  const resizableRoots=()=>$$(`${ROOTS}`).filter(root=>root.matches('.ns-status-module[data-status],.ns-module-window,[data-ns-module],[data-ns-compact],[data-canvas-module]'));
  const editing=()=>document.body.classList.contains('layout-edit');
  const active=()=>editing() && mode==='assets';
  let selectedModule=null, selectedModules=[];
  const moduleTargets=()=>selectedModules.length?selectedModules:(selectedModule?[selectedModule]:[]);
  function backgroundHit(node,root){
    return node===root || (!node.closest('[data-ns-asset],[data-asset-id],button,a,input,select,textarea,svg,canvas,img,video,iframe') && /^(DIV|SECTION|ARTICLE|MAIN|UL|OL)$/.test(node.tagName) && !directText(node));
  }
  function moduleHandle(root){
    return root.querySelector(':scope > .canvas-move-handle,:scope > .status-layout-move-handle,:scope > .ns-window-controls [data-corner="move"]') || window.NorthstarModules?.movementHandle(root);
  }
  function beginModule(event,root){
    select(root,null);selectedModule=root;draw();inspect();
    $('[data-selection-name]',panel).textContent='Module · '+rootName(root);
    status('Whole module selected. Drag the top-center move icon to move it.');
  }
  let dock=null, dockReady=false, suppressDockClick=false;
  function placeDesigner(){
    if(!panel || panel.hidden)return;
    const viewport=window.visualViewport;
    const left=(viewport?.offsetLeft || 0)+8, top=(viewport?.offsetTop || 0)+8;
    const right=left+(viewport?.width || innerWidth)-16, bottom=top+(viewport?.height || innerHeight)-16;
    if(!dockReady){
      dockReady=true;
      try{const saved=JSON.parse(localStorage.getItem(KEY+'Dock') || 'null');if(Number.isFinite(saved?.x)&&Number.isFinite(saved?.y))dock=saved;}catch{}
    }
    dock ||= {x:right-310,y:Math.min(top+78,bottom-40)};
    const collapsed=panel.classList.contains('ns-designer-collapsed');
    const set=(key,value)=>panel.style.setProperty(key,value,'important');
    set('right','auto');set('bottom','auto');set('width',collapsed?'auto':Math.min(310,right-left)+'px');set('height','auto');
    const buttonWidth=collapsed?panel.getBoundingClientRect().width:100,buttonHeight=collapsed?panel.getBoundingClientRect().height:38;
    dock.x=Math.max(left,Math.min(right-buttonWidth,dock.x));dock.y=Math.max(top,Math.min(bottom-buttonHeight,dock.y));
    let x=dock.x,y=dock.y;
    if(!collapsed){
      const width=Math.min(310,right-left),down=bottom-dock.y,up=dock.y+buttonHeight-top;
      const opensUp=down<Math.min(720,bottom-top) && up>down;
      const height=Math.min(720,opensUp?up:down);
      x=Math.max(left,Math.min(right-width,dock.x));
      y=opensUp?dock.y+buttonHeight-height:dock.y;
      set('height',height+'px');panel.dataset.opens=opensUp?'up':'down';
    }
    set('left',x+'px');set('top',y+'px');
  }
  function saveDock(){try{localStorage.setItem(KEY+'Dock',JSON.stringify(dock));}catch{}}
  function collapseDesigner(collapsed){
    panel.classList.toggle('ns-designer-collapsed',collapsed);
    const button=$('[data-action="collapse"]',panel);
    button.textContent=collapsed?'Designer +':'−';button.setAttribute('aria-label',collapsed?'Expand designer':'Collapse designer');button.setAttribute('aria-expanded',String(!collapsed));
    placeDesigner();draw();
  }
  function bindDesignerDrag(){
    const header=$('header',panel);header.tabIndex=0;header.title='Drag to move designer. Arrow keys move it when this header is focused.';
    header.setAttribute('aria-label','Move module designer');
    header.addEventListener('pointerdown',event=>{
      if(event.button!==0)return;
      const box=panel.getBoundingClientRect(),original={...dock},px=event.clientX,py=event.clientY;let moved=false;
      const move=e=>{
        if(!moved && Math.hypot(e.clientX-px,e.clientY-py)<4)return;
        if(!moved)header.setPointerCapture(event.pointerId);
        moved=true;const width=window.visualViewport?.width || innerWidth,height=window.visualViewport?.height || innerHeight;
        const x=Math.max(8,Math.min(width-box.width-8,box.x+e.clientX-px)),y=Math.max(8,Math.min(height-box.height-8,box.y+e.clientY-py));
        panel.style.setProperty('left',x+'px','important');panel.style.setProperty('top',y+'px','important');dock={x,y};
      };
      const finish=e=>{
        window.removeEventListener('pointermove',move);['pointerup','pointercancel','lostpointercapture'].forEach(t=>window.removeEventListener(t,finish));
        if(header.hasPointerCapture(event.pointerId))header.releasePointerCapture(event.pointerId);
        if(e.type!=='pointerup'){dock=original;placeDesigner();}
        else if(moved){saveDock();suppressDockClick=true;setTimeout(()=>suppressDockClick=false,0);}
      };
      window.addEventListener('pointermove',move);['pointerup','pointercancel','lostpointercapture'].forEach(t=>window.addEventListener(t,finish));
    });
    header.addEventListener('keydown',event=>{
      if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key))return;
      event.preventDefault();event.stopPropagation();const step=event.shiftKey?20:5;
      dock.x+=event.key==='ArrowLeft'?-step:event.key==='ArrowRight'?step:0;
      dock.y+=event.key==='ArrowUp'?-step:event.key==='ArrowDown'?step:0;placeDesigner();saveDock();
    });
  }
  const own=(o,k)=>Object.prototype.hasOwnProperty.call(o,k);
  const directText=el=>[...el.childNodes].filter(n=>n.nodeType===3).map(n=>n.textContent).join(' ').trim();
  const visible=el=>!!el?.isConnected && !!el.getClientRects().length && getComputedStyle(el).visibility!=='hidden';
  function status(message) { if(panel)$('[data-designer-status]',panel).textContent=message; }
  function read() {
    try {
      if(KEY==='northstarStatusWindowAssetsV1' && !localStorage.getItem(KEY)){
        const standard=JSON.parse(localStorage.getItem('northstarRestoredV1_northstarAssetEditorV1')||'null');
        if(standard?.roots)localStorage.setItem(KEY,JSON.stringify({version:VERSION,roots:Object.fromEntries(Object.entries(standard.roots).filter(([name])=>name.startsWith('fixed:')))}));
      }
      const value=JSON.parse(localStorage.getItem(KEY)||'null');if(value?.version===VERSION && value.roots && typeof value.roots==='object' && !Array.isArray(value.roots))state=value;}
    catch {storageError=true;}
    // An older Old Woman Falls edit pushed the card's title and readings
    // outside its frame. Retain appearance edits and future asset movement.
    const repair=data=>{
      const record=data?.roots?.['overview:site:old-woman-falls'];
      if(!record || data.oldWomanContentRepairV1)return false;
      for(const asset of Object.values(record.assets || {})){delete asset.x;delete asset.y;}
      data.oldWomanContentRepairV1=true;
      return true;
    };
    const repairStaffLeftInset=data=>{
      if(!data || data.staffLeftInsetRepairV1)return false;
      const assets=data.roots?.['overview:Fort Frances']?.assets || {};
      for(const selector of ['h3','div.contractor-heading','div.staff-row.contractor > span:nth-child(1)','div.staff-row:nth-child(2) > span:nth-child(1)']){
        if(assets[selector])assets[selector].x=0;
      }
      data.staffLeftInsetRepairV1=true;
      return true;
    };
    const repairStaffRightInset=data=>{
      if(!data || data.staffRightInsetRepairV1)return false;
      const assets=data.roots?.['overview:Fort Frances']?.assets || {};
      if(assets.h3)assets.h3.w=368;
      if(assets['h3 > button.station-quick-add'])Object.assign(assets['h3 > button.station-quick-add'],{x:0,w:24});
      if(assets['div.staff-row.contractor'])assets['div.staff-row.contractor'].w=368;
      data.staffRightInsetRepairV1=true;
      return true;
    };
    const repairStaffHeaderGeometry=data=>{
      if(!data)return false;
      let changed=false;
      for(const [key,record] of Object.entries(data.roots || {})){
        if(!key.endsWith(':overviewStaff'))continue;
        for(const [selector,asset] of Object.entries(record.assets || {})){
          if(selector.endsWith('#openCrewFromOverview') || selector.endsWith('#staffHeading'))continue;
          if(!/staff-panel-head|staffHeading|staff-heading-line|staff-panel-actions/.test(selector))continue;
          for(const field of ['x','y','w','h'])if(own(asset,field)){delete asset[field];changed=true;}
        }
      }
      return changed;
    };
    const repairCrewGeometry=data=>{
      if(!data || data.crewResponsiveGeometryV1)return false;
      const assets=data.roots?.['fixed:crew']?.assets || {};
      for(const [selector,asset] of Object.entries(assets)){
        if(!/ns-crew-tracker|ns-crew-sites|ns-status-site|ns-crew-summary/.test(selector))continue;
        for(const field of ['x','y','w','h'])delete asset[field];
      }
      data.crewResponsiveGeometryV1=true;
      return true;
    };
    // Retire offsets that fought the centered fixed-strip layout; retain appearance and frame geometry.
    const repairFixedStrip=data=>{
      if(!data || data.fixedStripAlignmentV1)return false;
      for(const key of ['fixed:dispatch','fixed:markets']){
        for(const asset of Object.values(data.roots?.[key]?.assets || {})){
          for(const field of ['x','y','w','h'])delete asset[field];
        }
      }
      for(const [selector,asset] of Object.entries(data.roots?.['fixed:crew']?.assets || {})){
        if(selector.includes('ns-crew-summary'))for(const field of ['x','y','w','h'])delete asset[field];
      }
      data.fixedStripAlignmentV1=true;
      return true;
    };
    try {
      const repairedActiveStrip=repairFixedStrip(state);
      const repairedActiveOldWoman=repair(state);
      const repairedActiveStaff=repairStaffLeftInset(state);
      const repairedActiveStaffRight=repairStaffRightInset(state);
      const repairedActiveStaffHeader=repairStaffHeaderGeometry(state);
      const repairedActiveCrew=repairCrewGeometry(state);
      const repairedActive=repairedActiveStrip||repairedActiveOldWoman||repairedActiveStaff||repairedActiveStaffRight||repairedActiveStaffHeader||repairedActiveCrew;
      if(repairedActive)localStorage.setItem(KEY,JSON.stringify(state));
      const saved=JSON.parse(localStorage.getItem(KEY+'Saved')||'null');
      const repairedSavedStrip=repairFixedStrip(saved);
      const repairedSavedOldWoman=repair(saved);
      const repairedSavedStaff=repairStaffLeftInset(saved);
      const repairedSavedStaffRight=repairStaffRightInset(saved);
      const repairedSavedStaffHeader=repairStaffHeaderGeometry(saved);
      const repairedSavedCrew=repairCrewGeometry(saved);
      const repairedSaved=repairedSavedStrip||repairedSavedOldWoman||repairedSavedStaff||repairedSavedStaffRight||repairedSavedStaffHeader||repairedSavedCrew;
      if(repairedSaved)localStorage.setItem(KEY+'Saved',JSON.stringify(saved));
    } catch {storageError=true;}
  }
  function persist(checkpoint=false) {
    try {const value=JSON.stringify(state),changed=localStorage.getItem(KEY)!==value;localStorage.setItem(KEY,value);if(changed && KEY==='northstarStatusWindowAssetsV1')window.dispatchEvent(new Event('northstar:status-window-dirty'));if(checkpoint)localStorage.setItem(KEY+'Saved',JSON.stringify(state));storageError=false;status(checkpoint?'Saved checkpoint on this browser.':'Draft saved on this browser. SAVE sets the reset checkpoint.');return true;}
    catch {storageError=true;status('Could not save: browser storage is unavailable or full. Keep this page open.');return false;}
  }
  function rememberStatusSizes(){
    resizableRoots().forEach(root=>{const box=root.getBoundingClientRect();if(box.width>0 && box.height>0)statusSizes.set(root,{w:box.width,h:box.height});});
  }
  function reflowStatusAssets(){
    statusReflowFrame=0;let changed=false;
    resizableRoots().forEach(root=>{
      const box=root.getBoundingClientRect(),prior=statusSizes.get(root);statusSizes.set(root,{w:box.width,h:box.height});
      if(!prior || prior.w<=0 || prior.h<=0 || box.width<=0 || box.height<=0 || (Math.abs(box.width-prior.w)<0.5 && Math.abs(box.height-prior.h)<0.5))return;
      const rec=record(root);if(assetSizing(root,rec)==='fixed')return;
      const sx=box.width/prior.w,sy=box.height/prior.h;
      const scale=asset=>{
        if(!asset)return;
        for(const [key,ratio] of [['x',sx],['y',sy],['w',sx],['h',sy]])if(own(asset,key) && Number.isFinite(Number(asset[key]))){asset[key]=Math.max(['w','h'].includes(key)?8:-20000,Math.min(20000,Number(asset[key])*ratio));changed=true;}
      };
      Object.values(rec?.assets || {}).forEach(scale);(rec?.custom || []).forEach(scale);
    });
    if(!changed)return;
    restoreStyles();apply();clearTimeout(statusReflowTimer);statusReflowTimer=setTimeout(()=>persist(),180);
  }
  function scheduleStatusReflow(){if(!statusReflowFrame)statusReflowFrame=requestAnimationFrame(reflowStatusAssets);}
  function remember(){undo.push(copy(state));if(undo.length>60)undo.shift();redo=[];}
  function rootKey(root) {
    const anchor=root.id || root.dataset.moduleId || root.dataset.layoutId || root.dataset.site || '';
    if(root.matches('.ns-status-module'))return 'fixed:'+root.dataset.status;
    if(root.dataset.nsCompact)return 'compact:'+root.dataset.nsCompact+':'+anchor;
    if(root.dataset.nsModule)return 'full:'+root.dataset.nsModule;
    const scope=root.closest('.section')?.id || (root.closest('#nsStatusBar')?'fixed':'overview');
    return scope+':'+anchor;
  }
  // Existing Dispatch layouts predate the sizing control. Treat them as fixed
  // until an operator explicitly opts into Dynamic, so a frame resize cannot
  // silently rewrite their manually placed assets.
  function assetSizing(root,rec=root?record(root):null){
    return rec?.sizing || (root?.matches('.ns-status-module[data-status="dispatch"]')?'fixed':'dynamic');
  }
  function rootFor(node) {
    if(!(node instanceof Element) || node.closest(EXCLUDE))return null;
    return node.closest(ROOTS);
  }
  function insideModule(node,root){
    if(!node || !root || node===root || !root.contains(node))return node===root;
    const a=node.getBoundingClientRect(),b=root.getBoundingClientRect();
    return a.left>=b.left-0.5 && a.top>=b.top-0.5 && a.right<=b.right+0.5 && a.bottom<=b.bottom+0.5;
  }
  function roots(){return $$(ROOTS).filter(el=>!el.closest(EXCLUDE) && (el.id || el.dataset.nsModule || el.dataset.nsCompact || el.dataset.moduleId || el.dataset.layoutId || el.dataset.status || el.dataset.site));}
  function rootName(root){return (root.querySelector('h2,h3,.ns-module-caption')?.textContent || root.getAttribute('aria-label') || root.dataset.status || root.dataset.moduleId || root.id || 'Module').trim().slice(0,90);}
  function record(root,create=false){const key=rootKey(root);if(create)state.roots[key] ||= {assets:{},custom:[]};return state.roots[key];}
  // Keyed ancestors keep overrides attached to a station/row, even after reorder.
  // Structural fallback deliberately does not use changing readings as identity.
  function segment(el) {
    if(el.id)return '#'+CSS.escape(el.id);
    for(const attr of ['data-asset-id','data-site','data-unit','data-station','data-node','data-key','data-id','data-module-id','data-ns-block','name']){
      if(el.hasAttribute(attr))return el.localName+'['+attr+'="'+CSS.escape(el.getAttribute(attr))+'"]';
    }
    const classes=[...el.classList].filter(c=>!/^ns-asset-|^(active|selected|open|closed|loading|online|offline|red|green|yellow|warning|error)$/.test(c));
    const base=el.localName+classes.map(c=>'.'+CSS.escape(c)).join('');
    const siblings=[...el.parentElement.children].filter(n=>n.matches(base));
    // :nth-child is only needed for unkeyed identical siblings.
    return siblings.length>1?base+':nth-child('+([...el.parentElement.children].indexOf(el)+1)+')':base;
  }
  function selector(root,node){const parts=[];while(node && node!==root){parts.unshift(segment(node));node=node.parentElement;}return parts.join(' > ');}
  function find(root,key){try{return root.querySelector(':scope > '+key);}catch{return null;}}
  function assetNode(node,root){
    if(node===root)return null;
    if(node.closest('.ns-asset-layer'))return node.closest('[data-ns-asset]');
    const group=node.closest('[data-asset-id]');
    if(group && root.contains(group) && group.dataset.assetChildren!=='independent')return group;
    const graphic=node.closest('svg,canvas,iframe,video,img');
    return graphic && root.contains(graphic)?graphic:node;
  }
  function assetName(node){return (node.id==='staffHeading'?'Workers On-Site summary':node.getAttribute('aria-label') || node.getAttribute('alt') || directText(node) || node.id || node.localName+' '+[...node.classList].slice(0,2).join(' ')).trim().slice(0,90);}
  function current(){if(!selected)return null;const rec=record(selected.root,true);return selected.custom?rec.custom.find(a=>a.id===selected.key):rec.assets[selected.key] || {};}
  function resolve(){if(!selected)return null;const root=roots().find(r=>rootKey(r)===selected.rootId);if(!root){selected=null;return null;}selected.root=root;selected.node=selected.custom?root.querySelector('[data-ns-asset="'+CSS.escape(selected.key)+'"]'):find(root,selected.key);if(!dragging && selected.node && !selected.node.dataset.assetId && !insideModule(selected.node,root)){selected=null;lastLayers='';renderLayers();return null;}return selected.node;}
  function setStyles(node,styles){
    let prior=originals.get(node);if(!prior){prior=new Map();originals.set(node,prior);}
    for(const [name,value] of Object.entries(styles)){
      if(!prior.has(name))prior.set(name,[node.style.getPropertyValue(name),node.style.getPropertyPriority(name)]);
      if(node.style.getPropertyValue(name)!==String(value) || node.style.getPropertyPriority(name)!=='important')node.style.setProperty(name,value,'important');
    }
  }
  function restoreStyles(){
    for(const [node,properties] of originals){if(!node.isConnected){originals.delete(node);continue;}for(const [name,[value,priority]] of properties){if(value)node.style.setProperty(name,value,priority);else node.style.removeProperty(name);}}
    originals.clear();
  }
  function styleAsset(node,rec,custom=false){
    // Chat uses responsive flow; saved dashboard asset boxes must not position its contents.
    if(node.closest("#assistantWorkspace"))return;
    if(!custom && node.closest('#overviewStaff') && node.matches('.staff-panel-head,.staff-heading-line,.staff-panel-actions')){
      rec={...rec};for(const field of ['x','y','w','h'])delete rec[field];
    }
    const styles=window.NorthstarAssetLayout.styles(rec,custom,node);
    // Retain the legacy SVG's neutral position; its stable stack wrapper is the
    // independently movable White Otter generation asset.
    if(node.matches('svg.gs-generator') && node.closest('.gs-card[data-module-id="site:white-otter-rapids"]'))styles.translate='0 0';
    // The compact Overview market chart must always use its card's available width.
    // A saved fixed canvas width otherwise creates horizontal page overflow.
    if(node.matches('#overviewMarketMini canvas'))Object.assign(styles,{width:'100%','min-width':'0','max-width':'100%',translate:'0 0'});
    for(const [key,css] of Object.entries(FIELDS))if(own(rec,key))styles[css]=String(rec[key])+(['fontSize','radius','borderWidth','paddingTop','paddingRight','paddingBottom','paddingLeft'].includes(key)?'px':'');
    // Compact Weather readings need the full text width, even with older saved asset widths.
    if(node.matches('#weatherStrip > .weather-card > .weather-extra-line, #weatherStrip > .weather-card > .weather-current > b, #weatherStrip > .weather-card > .weather-current > span'))Object.assign(styles,{width:'100%','min-width':'max-content','max-width':'none'});
    if(!custom && own(rec,'z') && getComputedStyle(node).position==='static')styles.position='relative';
    if(rec.hidden)styles.display='none';
    if(!custom && own(rec,'text'))setDirectText(node,rec.text);
    // Keep compact Check Ins totals aligned despite older saved drag offsets.
    if(!custom && node.closest('#crew .checkins-summary'))Object.assign(styles,{translate:'none',transform:'none',position:'static',width:'auto',height:'auto','min-width':'0','min-height':'0',margin:'0'});
    setStyles(node,styles);
  }
  function setDirectText(node,value){
    const nodes=[...node.childNodes].filter(n=>n.nodeType===3);
    if(!nodes.length)return;
    if(!originalText.has(node))originalText.set(node,nodes.map(n=>n.textContent));
    if(nodes[0].textContent!==value)nodes[0].textContent=value;
    nodes.slice(1).forEach(n=>{if(n.textContent)n.textContent='';});
  }
  function restoreDirectText(node){
    const values=originalText.get(node),nodes=[...node.childNodes].filter(n=>n.nodeType===3);
    if(!values || !nodes.length)return;
    nodes.forEach((n,index)=>n.textContent=values[index] || '');originalText.delete(node);
  }
  function safeImage(src){try{const url=new URL(src,location.href);return ['https:','http:'].includes(url.protocol)?url.href:'';}catch{return '';}}
  function text(node,value){if(node.textContent!==value)node.textContent=value;}
  function renderCustom(root,rec){
    let layer=root.querySelector(':scope > .ns-asset-layer');
    if(!rec?.custom?.length){layer?.remove();return;}
    if(getComputedStyle(root).position==='static')setStyles(root,{position:'relative'});
    if(!layer){layer=document.createElement('div');layer.className='ns-asset-layer';root.append(layer);}
    const ids=new Set(rec.custom.map(a=>a.id));
    [...layer.children].forEach(n=>{if(!ids.has(n.dataset.nsAsset))n.remove();});
    rec.custom.forEach(asset=>{
      let node=layer.querySelector('[data-ns-asset="'+CSS.escape(asset.id)+'"]');
      if(!node){node=document.createElement(asset.kind==='image'?'img':'div');node.dataset.nsAsset=asset.id;node.className='ns-asset-custom ns-asset-'+asset.kind;layer.append(node);}
      if(asset.kind==='image'){
        const src=safeImage(asset.src||'');if(src && node.getAttribute('src')!==src)node.setAttribute('src',src);else if(!src)node.removeAttribute('src');
        node.alt=asset.text || 'Custom image';
      }else if(asset.kind==='data'){
        const source=document.getElementById(asset.source||'');
        const value=source && !source.closest('.ns-asset-layer,#nsAssetEditor,dialog')?source.textContent.trim():'Source unavailable';
        text(node,(asset.text?asset.text+'\n':'')+(value || 'Awaiting data'));
      }else text(node,['shape','divider'].includes(asset.kind)?'':asset.text || '');
      styleAsset(node,asset,true);
    });
  }
  function apply(){
    for(const root of roots()){
      const rec=record(root);
      if(rec?.modulePadding){for(const side of ['top','right','bottom','left'])if(Number.isFinite(Number(rec.modulePadding[side])))setStyles(root,{['padding-'+side]:Math.max(0,Number(rec.modulePadding[side]))+'px'});}
      renderCustom(root,rec);
      if(rec?.assets)for(const [key,override] of Object.entries(rec.assets)){const node=find(root,key);if(node && !node.closest(EXCLUDE))styleAsset(node,override);}
      const id=root.dataset.nsModule || root.dataset.nsCompact;
      const variant=root.dataset.nsCompact?'compact':'full';
      root.classList.toggle('ns-asset-canvas',!!window.NorthstarModules?.state.modules[id]?.[variant]?.assetCanvas);
    }
    if(editing()){renderRoots();renderLayers();draw();}
  }
  function schedule(){if(!timer)timer=setTimeout(()=>{timer=0;if(!dragging)apply();},120);}
  function select(root,node){
    const content=panel && $('[name="content"]',panel);if(content===document.activeElement)content.blur();
    selectedModule=null;selectedModules=[];selectedMany=[];if(outline)delete outline.dataset.multiple;
    selected=node?{root,rootId:rootKey(root),node,custom:!!node.dataset.nsAsset,key:node.dataset.nsAsset || selector(root,node)}:null;
    panel.dataset.root=rootKey(root);lastLayers='';renderRoots();renderLayers();syncAssetSizing(root);const assetsPanel=$('[data-assets-panel]',panel);if(assetsPanel)assetsPanel.open=true;inspect();draw();
  }
  function syncAssetSizing(root=chosenRoot()){const control=panel?.querySelector('[name="assetSizing"]');if(control)control.value=assetSizing(root);}
  function editText(node){
    if(!node || !directText(node) || node.matches('input,textarea,select,[contenteditable="true"]'))return;
    const original=node.textContent, before=copy(state), prior=originals.get(node);if(prior)restoreStyles();
    node.setAttribute('contenteditable','plaintext-only');node.focus();
    const range=document.createRange();range.selectNodeContents(node);const selection=window.getSelection();selection.removeAllRanges();selection.addRange(range);
    status('Edit the text in place. Press Enter to save, or Escape to cancel.');
    const finish=save=>{
      if(!node.isConnected)return;
      node.removeAttribute('contenteditable');node.removeEventListener('keydown',key,true);node.removeEventListener('blur',blur);
      if(!save){node.textContent=original;apply();return;}
      if(node.textContent===original){apply();return;}
      undo.push(before);if(undo.length>60)undo.shift();redo=[];
      const root=rootFor(node),key=node.dataset.nsAsset,rec=record(root,true);
      if(key){const asset=rec.custom.find(a=>a.id===key);if(asset)asset.text=node.textContent;}
      else{const assetKey=selector(root,node);rec.assets[assetKey] ||= {};rec.assets[assetKey].text=node.textContent;}
      persist();apply();select(root,node);
    };
    const key=e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();finish(true);}else if(e.key==='Escape'){e.preventDefault();finish(false);}};
    const blur=()=>finish(true);node.addEventListener('keydown',key,true);node.addEventListener('blur',blur,{once:true});
  }
  function moveMany(dx,dy){
    if(!selectedMany.length)return;
    const before=copy(state),step=$('[name="snap"]',panel).checked?5:1,root=selectedMany[0].node.closest(ROOTS);
    selectedMany.forEach(item=>{
      const node=item.node,custom=!!node.dataset.nsAsset,key=node.dataset.nsAsset||selector(root,node),rec=record(root,true),asset=custom?rec.custom.find(a=>a.id===key):(rec.assets[key] ||= {});
      if(!asset)return;
      const box=window.NorthstarAssetLayout.box(node,asset),next=window.NorthstarAssetLayout.change(box,'move',dx*step,dy*step);
      Object.assign(asset,{x:next.x,y:next.y});styleAsset(node,asset,custom);
    });
    undo.push(before);if(undo.length>60)undo.shift();redo=[];persist();apply();draw();
  }
  function centerAssets(axis){
    const items=selectedMany.length?selectedMany.map(item=>({node:item.node})):selected?.node?[{node:selected.node}]:[];
    if(!items.length){status('Select an asset first.');return;}
    const before=copy(state),groups=new Map();
    items.forEach(item=>{const root=item.node.closest(ROOTS);if(root){if(!groups.has(root))groups.set(root,[]);groups.get(root).push(item.node);}});
    groups.forEach((nodes,root)=>{
      const boxes=nodes.map(node=>node.getBoundingClientRect()),rootBox=root.getBoundingClientRect();
      const start=Math.min(...boxes.map(box=>axis==='y'?box.top:box.left)),end=Math.max(...boxes.map(box=>axis==='y'?box.bottom:box.right));
      const delta=(axis==='y'?rootBox.top+rootBox.height/2:rootBox.left+rootBox.width/2)-(start+end)/2;
      nodes.forEach((node,index)=>{
        const custom=!!node.dataset.nsAsset,key=node.dataset.nsAsset||selector(root,node),rec=record(root,true),asset=custom?rec.custom.find(a=>a.id===key):(rec.assets[key] ||= {});if(!asset)return;
        const box=boxes[index],layout=window.NorthstarAssetLayout.box(node,asset),css=getComputedStyle(node),scale=axis==='y'?box.height/(parseFloat(css.height)||box.height)||1:box.width/(parseFloat(css.width)||box.width)||1;
        asset[axis]=Math.round((layout[axis]+delta/scale)*100)/100;styleAsset(node,asset,custom);
      });
    });
    undo.push(before);if(undo.length>60)undo.shift();redo=[];persist();apply();inspect();draw();
    status((items.length>1?items.length+' assets':'Asset')+(axis==='y'?' centered north to south.':' centered east to west.'));
  }
  function beginMany(event){
    const items=selectedMany.slice();if(!items.length)return;
    const before=copy(state),startX=event.clientX,startY=event.clientY;let changed=false;
    const originalsByItem=items.map(item=>{const root=item.node.closest(ROOTS),custom=!!item.node.dataset.nsAsset,key=item.node.dataset.nsAsset||selector(root,item.node),asset=custom?record(root,true).custom.find(a=>a.id===key):(record(root,true).assets[key] ||= {});return {item,custom,asset,box:window.NorthstarAssetLayout.box(item.node,asset)};});
    dragging=true;
    const move=e=>{const dx=e.clientX-startX,dy=e.clientY-startY;if(!changed&&Math.hypot(dx,dy)<3)return;changed=true;originalsByItem.forEach(({item,custom,asset,box})=>{const next=window.NorthstarAssetLayout.change(box,'move',dx,dy,$('[name="snap"]',panel).checked?5:1);Object.assign(asset,{x:next.x,y:next.y});styleAsset(item.node,asset,custom);});draw();};
    const finish=e=>{window.removeEventListener('pointermove',move,true);window.removeEventListener('pointerup',finish,true);window.removeEventListener('pointercancel',finish,true);dragging=false;if(e.type!=='pointerup'){state=before;restoreStyles();apply();}else if(changed){undo.push(before);if(undo.length>60)undo.shift();redo=[];persist();apply();}draw();};
    window.addEventListener('pointermove',move,true);window.addEventListener('pointerup',finish,true);window.addEventListener('pointercancel',finish,true);
  }
  function chosenRoot(){return selected?.root || roots().find(r=>rootKey(r)===panel.dataset.root);}
  function draw(){
    if(!selectedMany.length)delete outline.dataset.multiple;
    if(selectedMany.length){
      const boxes=selectedMany.map(item=>item.node.getBoundingClientRect());
      const left=Math.min(...boxes.map(b=>b.left)),top=Math.min(...boxes.map(b=>b.top)),right=Math.max(...boxes.map(b=>b.right)),bottom=Math.max(...boxes.map(b=>b.bottom));
      outline.dataset.wholeModule='false';outline.dataset.multiple='true';outline.hidden=!active() || panel.classList.contains('ns-designer-collapsed');
      if(!outline.hidden)Object.assign(outline.style,{left:left+'px',top:top+'px',width:(right-left)+'px',height:(bottom-top)+'px'});
      $('[data-selection-label]',outline).textContent=selectedMany.length+' assets selected';return;
    }
    outline.dataset.wholeModule=String(!!selectedModule);
    delete outline.dataset.multiple;
    if(selectedModule){
      if(!editing() || panel.classList.contains('ns-designer-collapsed') || !visible(selectedModule)){outline.hidden=true;return;}
      const box=selectedModule.getBoundingClientRect();outline.hidden=false;
      Object.assign(outline.style,{left:box.x+'px',top:box.y+'px',width:box.width+'px',height:box.height+'px'});
      $('[data-selection-label]',outline).textContent=selectedModules.length>1?selectedModules.length+' modules selected':'Module · '+rootName(selectedModule);return;
    }
    if(!active() || panel.classList.contains('ns-designer-collapsed') || !resolve() || !visible(selected.node)){outline.hidden=true;return;}
    const b=selected.node.getBoundingClientRect();outline.hidden=false;
    Object.assign(outline.style,{left:b.x+'px',top:b.y+'px',width:b.width+'px',height:b.height+'px'});
    $('[data-selection-label]',outline).textContent=assetName(selected.node).slice(0,45);
  }
  function mutate(patch){
    const targets=selectedMany.length?selectedMany.map(item=>{
      const root=item.node.closest(ROOTS),key=item.node.dataset.nsAsset || selector(root,item.node);
      return {root,node:item.node,key,custom:!!item.node.dataset.nsAsset};
    }):selected?[selected]:[];
    if(!targets.length)return;
    remember();targets.forEach(item=>{
      const rec=record(item.root,true),asset=item.custom?rec.custom.find(a=>a.id===item.key):(rec.assets[item.key] ||= {});
      if(asset)Object.assign(asset,patch);
    });
    restoreStyles();apply();persist();inspect();
  }
  function fitModuleToAssets(){
    const root=chosenRoot();if(!root){status('Choose a module first.');return;}
    const assets=candidates(root).filter(node=>visible(node));
    if(!assets.length){status('This module has no visible assets to fit.');return;}
    const padding={};
    for(const side of ['left','right','top','bottom']){
      const input=$('[name="fitPadding'+side[0].toUpperCase()+side.slice(1)+'"]',panel),value=Number(input.value);
      if(!input.value.trim() || !Number.isFinite(value) || value<0 || value>2000){status('Enter '+side+' padding from 0 to 2000 px.');input.focus();return;}
      padding[side]=value;
    }
    const rects=assets.map(node=>node.getBoundingClientRect());
    const left=Math.min(...rects.map(r=>r.left))-padding.left,top=Math.min(...rects.map(r=>r.top))-padding.top;
    const right=Math.max(...rects.map(r=>r.right))+padding.right,bottom=Math.max(...rects.map(r=>r.bottom))+padding.bottom;
    // The fitted bounds are the minimum frame. Do not reintroduce an arbitrary
    // designer floor here: zero padding must allow a frame as small as its assets.
    const width=Math.max(1,Math.ceil(right-left)),height=Math.max(1,Math.ceil(bottom-top));
    const id=root.dataset.nsModule || root.dataset.nsCompact,variant=root.dataset.nsCompact?'compact':'full';
    remember();
    if(root.matches('.ns-status-module[data-status]') || root.dataset.canvasModule){
      const geometry=window.NorthstarModuleGeometry;
      if(!geometry?.fit(root,{x:left,y:top,w:width,h:height})){status('This module frame could not be resized.');return;}
    }else if(id && window.NorthstarModules?.state?.modules?.[id]){
      const modules=window.NorthstarModules,meta=modules.state.modules[id];
      if(!modules.fitSize?.(id,variant,width,height)){status('This section module frame could not be resized.');return;}
    }else{
      const key='northstarRestoredV1_northstarCanvasLayoutV1',layoutId=root.id || root.dataset.moduleId || root.dataset.layoutId;let positions={};try{positions=JSON.parse(localStorage.getItem(key)||'{}')||{};}catch{}
      const position=positions[layoutId];
      if(!position){status('This module does not have a saved resizable frame.');return;}
      const containerRect=root.closest('main')?.getBoundingClientRect();
      position.x=Math.max(0,left-(containerRect?.left || 0));position.y=Math.max(0,top-(containerRect?.top || 0));position.w=width;position.h=height;
      localStorage.setItem(key,JSON.stringify(positions));
      const profileKey='northstarRestoredV1_northstarOverviewProfilesV2';let profiles={};try{profiles=JSON.parse(localStorage.getItem(profileKey)||'{}')||{};}catch{}
      Object.values(profiles).forEach(profile=>{if(profile?.positions?.[layoutId])profile.positions[layoutId]={...position};});
      localStorage.setItem(profileKey,JSON.stringify(profiles));
      try{localStorage.setItem(key+'Saved',JSON.stringify(positions));localStorage.setItem(profileKey+'Saved',JSON.stringify(profiles));}catch{}
      window.dispatchEvent(new Event('resize'));
    }
    persist();apply();status('Module border fitted to visible assets.');
  }
  function setModuleSize(){
    const targets=moduleTargets();if(!targets.length){status('Choose a module first.');return;}
    const width=Number($('[name="moduleWidth"]',panel).value),height=Number($('[name="moduleHeight"]',panel).value);
    if(!Number.isFinite(width)||width<1||width>5000||!Number.isFinite(height)||height<1||height>5000){status('Enter a width and height from 1–5000 px.');return;}
    const failed=[];
    targets.forEach(root=>{const rect=root.getBoundingClientRect(),id=root.dataset.nsModule || root.dataset.nsCompact,variant=root.dataset.nsCompact?'compact':'full';
      if(window.NorthstarModuleGeometry?.fit(root,{x:rect.left,y:rect.top,w:width,h:height}))return;
      if(id && window.NorthstarModules?.fitSize?.(id,variant,width,height))return;
      root.style.setProperty('width',width+'px','important');root.style.setProperty('height',height+'px','important');
      root.style.setProperty('--ns-section-module-width',width+'px');root.style.setProperty('--ns-section-module-height',height+'px');
      failed.push(root);
    });
    persist();apply();inspect();status('Module size applied to '+targets.length+' module'+(targets.length===1?'':'s')+'.');
  }
  function setAssetSize(){
    if(!selected?.node){status('Select one asset first.');return;}
    const width=Number($('[name="assetWidth"]',panel).value),height=Number($('[name="assetHeight"]',panel).value);
    if(!Number.isFinite(width)||width<8||width>20000||!Number.isFinite(height)||height<8||height>20000){status('Enter an asset width and height from 8–20000 px.');return;}
    mutate({w:width,h:height});status('Asset size saved.');
  }
  function inspect(){
    const node=resolve(), area=$('[data-inspector]',panel);area.hidden=!node && !selectedMany.length;
    $('[data-selection-name]',panel).textContent=selectedMany.length?selectedMany.length+' assets selected':node?assetName(node):selectedModules.length>1?selectedModules.length+' modules selected':selectedModule?'Module · '+rootName(selectedModule):'Select an asset on the dashboard';
    const paddingPanel=$('[data-module-padding]',panel);paddingPanel.hidden=!selectedModule;
    if(selectedModule){const padding=record(selectedModule)?.modulePadding || {};for(const side of ['top','right','bottom','left'])$('[name="modulePadding'+side[0].toUpperCase()+side.slice(1)+'"]',panel).value=padding[side] ?? Math.round(parseFloat(getComputedStyle(selectedModule).getPropertyValue('padding-'+side))||0);}
    const moduleRoot=selectedModule || chosenRoot();
    const deleteModule=$('[data-action="delete-overview-module"]',panel);
    deleteModule.hidden=!moduleRoot?.matches('[data-canvas-module]');
    if(moduleRoot){const box=moduleRoot.getBoundingClientRect();$('[name="moduleWidth"]',panel).value=Math.round(box.width);$('[name="moduleHeight"]',panel).value=Math.round(box.height);}
    if(!node)return;
    const rec=current(), css=getComputedStyle(node), box=window.NorthstarAssetLayout.box(node,rec);
    $('[name="assetWidth"]',panel).value=Math.round(box.w);
    $('[name="assetHeight"]',panel).value=Math.round(box.h);
    for(const side of ['Top','Right','Bottom','Left']){
      const key='padding'+side;
      $('[name="'+key+'"]',panel).value=rec[key] ?? Math.round(parseFloat(css.getPropertyValue('padding-'+side.toLowerCase()))||0);
    }
    for(const name of Object.keys(NUMBERS)){
      const control=panel.querySelector('[name="'+name+'"]');
      const value=rec[name] ?? box[name] ?? (name==='fontSize'?parseFloat(css.fontSize):name==='lineHeight'?1.2:name==='radius'?parseFloat(css.borderRadius):name==='borderWidth'?parseFloat(css.borderTopWidth):name==='opacity'?css.opacity:name==='z'?0:'');
      control.value=Math.round(Number(value)*100)/100;
    }
    ['color','background','borderColor'].forEach(name=>{
      const cssValue=name==='color'?css.color:name==='background'?css.backgroundColor:css.borderTopColor;
      panel.querySelector('[name="'+name+'"]').value=rec[name] || cssValue;
      const rgb=(rec[name] || cssValue).match(/[\d.]+/g);
      if(rgb?.length>=3)panel.querySelector('[data-color-picker="'+name+'"]').value='#'+rgb.slice(0,3).map(v=>Math.round(Number(v)).toString(16).padStart(2,'0')).join('');
    });
    $('[name="fontFamily"]',panel).value=rec.fontFamily || 'system-ui';
    $('[name="fontStyle"]',panel).value=rec.fontStyle || css.fontStyle;
    $('[name="fontWeight"]',panel).value=rec.fontWeight || (Number(css.fontWeight)>=600?'700':'400');
    $('[name="textAlign"]',panel).value=rec.textAlign || css.textAlign.replace('start','left').replace('end','right');
    $('[name="borderStyle"]',panel).value=rec.borderStyle || css.borderTopStyle;
    $('[name="hidden"]',panel).checked=!!rec.hidden;
    const textEditable=selected.custom || directText(node) || own(rec,'text');
    $('[data-custom-fields]',panel).hidden=!textEditable;
    $('[data-source-field]',panel).hidden=!selected.custom || rec.kind!=='data';
    $('[data-image-field]',panel).hidden=!selected.custom || rec.kind!=='image';
    $('[name="content"]',panel).value=own(rec,'text')?rec.text:(selected.custom?'':directText(node));
    $('[name="image"]',panel).value=rec.src || '';
    $('[data-action="duplicate"]',panel).disabled=!selected.custom;
    $('[data-action="delete"]',panel).disabled=!selected.custom;
    const moduleId=selected.root.dataset.nsModule;
    $('[data-action="delete-module"]',panel).hidden=!moduleId || !window.NorthstarModules?.state?.modules?.[moduleId]?.custom;
    $('[data-action="parent"]',panel).disabled=selected.custom || node.parentElement===selected.root;
    if(selected.custom && rec.kind==='data')sources(rec.source);
    $('[data-live-note]',panel).textContent=selected.custom?'Custom content. Layout applies to this presentation.':textEditable?'Text changes apply to this presentation and are saved in this browser.':'Source content stays live; this asset has no editable text.';
  }
  function renderRoots(){
    const all=roots().filter(visible), signature=all.map(r=>rootKey(r)+'|'+rootName(r)).join('\n');
    const picker=$('[name="root"]',panel);
    if(signature!==lastRoots){lastRoots=signature;picker.replaceChildren(new Option('Choose a visible module',''));all.forEach(r=>picker.add(new Option((rootKey(r).startsWith('fixed:')?'Fixed · ':rootKey(r).startsWith('compact:')?'Overview · ':'')+rootName(r),rootKey(r))));}
    picker.value=selected?.rootId || panel.dataset.root || '';syncAssetSizing(all.find(r=>rootKey(r)===picker.value));
  }
  function candidates(root){
    const saved=record(root)?.assets || {};
    const visualContainer=node=>{
      if(node.matches('table,thead,tbody,tfoot,tr,th,td,figure'))return true;
      const css=getComputedStyle(node);
      return node.children.length>0 && (parseFloat(css.borderTopWidth)>0 || parseFloat(css.borderRightWidth)>0 || css.backgroundColor!=='rgba(0, 0, 0, 0)' || !!node.querySelector(':scope > canvas,:scope > svg'));
    };
    return $$('*',root).filter(node=>!node.closest(EXCLUDE) && !node.matches('.ns-asset-layer') && rootFor(node)===root && (!node.closest('svg') || node.matches('svg')) && (node.dataset.nsAsset || node.dataset.assetId || directText(node) || own(saved[selector(root,node)] || {},'text') || node.matches('img,svg,canvas,iframe,video,input,select,textarea') || visualContainer(node)));
  }
  function renderLayers(){
    const root=chosenRoot(), list=$('[data-layers]',panel), all=root?candidates(root):[];
    const signature=(root?rootKey(root):'')+'|'+all.map(n=>(n.dataset.nsAsset||selector(root,n))+':'+assetName(n)).join('|');
    if(signature!==lastLayers){lastLayers=signature;list.replaceChildren();all.slice(0,400).forEach(node=>{const b=document.createElement('button');b.type='button';b.textContent=assetName(node);b.dataset.assetKey=node.dataset.nsAsset || selector(root,node);b.onclick=()=>select(root,node);list.append(b);});}
    $$('button',list).forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.assetKey===selected?.key)));
    $('[data-layer-count]',panel).textContent=all.length>400?'Assets (first 400; click any asset on the page)':'Assets ('+all.length+')';
  }
  function sources(value=''){
    const picker=$('[name="source"]',panel);picker.replaceChildren(new Option('Select a live value',''));
    $$('[id]').filter(n=>!n.children.length && n.textContent.trim() && !n.closest(EXCLUDE+',.ns-asset-layer,.ns-module-content') && /^(B|STRONG|SPAN|OUTPUT|DIV|TD)$/.test(n.tagName)).forEach(n=>picker.add(new Option((assetName(n)+' · '+n.id).slice(0,110),n.id)));
    if(value && ![...picker.options].some(o=>o.value===value))picker.add(new Option(value+' (unavailable)',value));picker.value=value;
  }
  function add(kind){
    const root=chosenRoot();if(!root){status('Select a module first, or create a new module.');return;}
    remember();const rec=record(root,true), count=rec.custom.length;
    const asset={id:crypto.randomUUID(),kind,x:16+count%6*12,y:36+count%6*28,w:kind==='divider'?220:180,h:kind==='divider'?3:kind==='shape'?80:60,
      text:kind==='heading'?'New heading':kind==='text'?'Your text':kind==='data'?'Live value':kind==='image'?'Image':'',fontSize:kind==='heading'?24:14,color:'#e8f0f5',z:1};
    if(['shape','divider'].includes(kind))asset.background='#477d98';
    rec.custom.push(asset);apply();select(root,root.querySelector('[data-ns-asset="'+asset.id+'"]'));persist();
  }
  function history(back){
    const from=back?undo:redo,to=back?redo:undo;if(!from.length)return;
    to.push(copy(state));state=from.pop();restoreStyles();apply();persist();inspect();
  }
  function resetAsset(){if(!selected)return;remember();const rec=record(selected.root,true);if(selected.custom){const a=current();Object.keys(FIELDS).concat('hidden').forEach(k=>delete a[k]);}else{restoreDirectText(selected.node);delete rec.assets[selected.key];}restoreStyles();apply();persist();inspect();}
  function joinGroupChildren(root,group){
    const rec=record(root,true);let changed=false;
    for(const [key,asset] of Object.entries(rec.assets)){
      const node=find(root,key);if(!node || node===group || !group.contains(node))continue;
      if(own(asset,'x')){delete asset.x;changed=true;}if(own(asset,'y')){delete asset.y;changed=true;}
    }
    if(changed){restoreStyles();apply();status('Grouped labels rejoined and will move with '+assetName(group)+'.');}
  }
  function begin(event,corner='move'){
    if(event.button!==0 || !selected?.node)return;
    const startNode=selected.node, before=copy(state), rec=current(), original=window.NorthstarAssetLayout.box(startNode,rec);
    const computed=getComputedStyle(startNode), rect=startNode.getBoundingClientRect();
    const scaleX=rect.width/(parseFloat(computed.width)||rect.width)||1,scaleY=rect.height/(parseFloat(computed.height)||rect.height)||1;
    const px=event.clientX,py=event.clientY;let changed=false;
    dragging=true;
    const move=e=>{
      if(!changed && Math.hypot(e.clientX-px,e.clientY-py)<3)return;
      if(!changed && startNode.dataset.assetId && startNode.dataset.assetChildren!=='independent')joinGroupChildren(selected.root,startNode);
      changed=true;
      const next=window.NorthstarAssetLayout.change(original,corner,(e.clientX-px)/scaleX,(e.clientY-py)/scaleY,$('[name="snap"]',panel).checked?5:1);
      const target=record(selected.root,true), asset=selected.custom?current():(target.assets[selected.key] ||= {});
      Object.assign(asset,corner==='move'?{x:next.x,y:next.y}:next);styleAsset(startNode,asset,selected.custom);draw();
    };
    const finish=e=>{
      window.removeEventListener('pointermove',move,true);window.removeEventListener('pointerup',finish,true);window.removeEventListener('pointercancel',finish,true);window.removeEventListener('blur',cancel);
      dragging=false;
      if(e.type!=='pointerup'){state=before;restoreStyles();apply();}
      else if(changed){undo.push(before);if(undo.length>60)undo.shift();redo=[];persist();apply();}
      inspect();
    };
    const cancel=()=>finish({type:'pointercancel'});
    window.addEventListener('pointermove',move,true);window.addEventListener('pointerup',finish,true);window.addEventListener('pointercancel',finish,true);window.addEventListener('blur',cancel);
  }
  function syncMode(){
    const isEditing=editing();
    if(isEditing && !wasEditing){mode='modules';selected=null;selectedMany=[];selectedModule=null;selectedModules=[];if(panel)$('[name="mode"]',panel).value=mode;}
    if(!isEditing){selected=null;selectedMany=[];selectedModule=null;selectedModules=[];}
    wasEditing=isEditing;
    panel.hidden=!isEditing;if(document.body.classList.contains('ns-asset-editing')!==active())document.body.classList.toggle('ns-asset-editing',active());
    if(!isEditing){outline.hidden=true;return;}placeDesigner();apply();inspect();
    if(storageError)status('Browser storage is unavailable. Changes may not survive a reload.');
  }
  function createUI(){
    panel=document.createElement('div');panel.id='nsAssetEditor';panel.hidden=true;panel.setAttribute('role','region');panel.setAttribute('aria-label','Module designer');
    panel.innerHTML=`<header><div><strong>MODULE DESIGNER</strong><small>Saved on this browser</small></div><button type="button" data-action="collapse" aria-label="Collapse designer">−</button></header>
      <div class="ns-designer-body"><div class="ns-designer-row"><label>Edit<select name="mode"><option value="modules">Whole modules</option><option value="assets">Assets inside modules</option></select></label><label class="ns-designer-check"><input name="snap" type="checkbox" checked>Snap 5px</label></div>
      <div class="ns-designer-actions"><button type="button" data-action="undo">Undo</button><button type="button" data-action="redo">Redo</button><button type="button" data-action="checkpoint">Save</button></div>
      <details><summary>Create a module</summary><label>Name<input name="newName" placeholder="My module" maxlength="100"></label><label>Section<select name="newSection"></select></label><button type="button" data-action="create">Create blank module</button></details>
      <label>Module<select name="root"></select></label><label>Asset sizing<select name="assetSizing"><option value="dynamic">Dynamic · resize with module</option><option value="fixed">Fixed · keep asset size</option></select></label><div class="ns-designer-fit" aria-label="Fit border padding"><button type="button" data-action="fit">Fit border to assets</button>${[['Left','L'],['Right','R'],['Top','T'],['Bottom','B']].map(([side,short])=>`<label title="${side} padding in pixels">${short}<input type="number" name="fitPadding${side}" aria-label="${side} padding in pixels" min="0" max="2000" step="1" value="12"></label>`).join('')}</div><div class="ns-designer-actions"><button type="button" data-action="rebuild-weather">Rebuild selected weather tile</button><button type="button" data-action="settings">Open module data editor</button><button type="button" data-action="delete-overview-module" hidden>Delete module</button></div>
      <section data-module-padding hidden><h3>Module padding (px)</h3><div class="ns-designer-fit" aria-label="Module padding">${[['Top','T'],['Right','R'],['Bottom','B'],['Left','L']].map(([side,short])=>`<label title="${side} module padding in pixels">${short}<input type="number" name="modulePadding${side}" aria-label="${side} module padding in pixels" min="0" max="2000" step="1"></label>`).join('')}</div></section>
      <div class="ns-designer-add" aria-label="Add asset">${['heading','text','data','image','shape','divider'].map(k=>`<button type="button" data-add="${k}">+ ${k==='data'?'Live value':k[0].toUpperCase()+k.slice(1)}</button>`).join('')}</div>
      <details data-assets-panel open><summary data-layer-count>Assets</summary><div data-layers></div></details>
      <h3 data-selection-name>Select an asset on the dashboard</h3><section data-inspector hidden>
      <div class="ns-designer-actions"><button type="button" data-action="parent">Select parent</button><button type="button" data-action="restore">Reset asset</button></div>
      <div class="ns-designer-actions" aria-label="Center assets inside module"><button type="button" data-action="center-ns" title="Equal space above and below">Center north–south</button><button type="button" data-action="center-ew" title="Equal space left and right">Center east–west</button></div>
      <section data-asset-size><h3>Asset size (px)</h3><div class="ns-designer-grid"><label>Width<input name="assetWidth" type="number" min="8" max="20000" step="1"></label><label>Height<input name="assetHeight" type="number" min="8" max="20000" step="1"></label></div><button type="button" data-action="set-asset-size">Apply asset size</button></section>
      <section data-asset-padding><h3>Asset padding (px)</h3><div class="ns-designer-grid">${[['paddingTop','Top'],['paddingRight','Right'],['paddingBottom','Bottom'],['paddingLeft','Left']].map(([key,label])=>`<label>${label}<input name="${key}" type="number" min="0" max="2000" step="1"></label>`).join('')}</div></section>
      <div class="ns-designer-grid">${[['x','X offset'],['y','Y offset'],['w','Width'],['h','Height']].map(([k,label])=>`<label>${label}<input type="number" name="${k}" step="1" min="${NUMBERS[k][0]}" max="${NUMBERS[k][1]}"></label>`).join('')}</div>
      <div data-custom-fields><label>Text / label<textarea name="content" rows="2" maxlength="4000"></textarea></label><label data-source-field>Live source<select name="source"></select></label><label data-image-field>Image URL<input name="image" placeholder="https://… or /image.png"></label></div>
      <div class="ns-designer-grid"><label>Text size<input name="fontSize" type="number" min="6" max="200"></label><label>Weight<select name="fontWeight"><option value="400">Regular</option><option value="700">Bold</option></select></label><label>Text color<span class="ns-color-row"><input type="color" data-color-picker="color" aria-label="Choose text color"><input name="color" placeholder="#ffffff"></span></label><label>Background<span class="ns-color-row"><input type="color" data-color-picker="background" aria-label="Choose background color"><input name="background" placeholder="transparent"></span></label><label>Border width<input name="borderWidth" type="number" min="0" max="100" step="1"></label><label>Border style<select name="borderStyle"><option value="none">None</option><option value="solid">Solid</option><option value="dashed">Dashed</option><option value="dotted">Dotted</option><option value="double">Double</option></select></label><label>Border color<span class="ns-color-row"><input type="color" data-color-picker="borderColor" aria-label="Choose border color"><input name="borderColor" placeholder="#ffffff"></span></label><label>Font<select name="fontFamily"><option value="system-ui">System</option><option value="Arial">Arial</option><option value="Georgia">Georgia</option><option value="monospace">Monospace</option></select></label><label>Style<select name="fontStyle"><option value="normal">Normal</option><option value="italic">Italic</option></select></label><label>Align<select name="textAlign"><option value="left">Left</option><option value="center">Center</option><option value="right">Right</option></select></label><label>Line spacing<input name="lineHeight" type="number" min="0.5" max="5" step="0.1"></label><label>Corner radius<input name="radius" type="number" min="0" max="500"></label><label>Opacity<input name="opacity" type="number" min="0" max="1" step="0.1"></label><label>Layer<input name="z" type="number" min="-1" max="1000"></label><label class="ns-designer-check"><input name="hidden" type="checkbox">Hidden</label></div>
      <div class="ns-designer-actions"><button type="button" data-action="duplicate">Duplicate</button><button type="button" data-action="delete">Delete asset</button><button type="button" data-action="delete-module" hidden>Delete custom module</button></div><p data-live-note></p></section>
      <p class="ns-designer-help">Click and drag an asset. In asset mode, drag empty module space to box-select assets; drag an asset to move it. Drag its corner handles to resize. Escape deselects.</p><p data-designer-status role="status"></p></div>`;
    document.body.append(panel);
    const sizeSection=document.createElement('section');sizeSection.dataset.moduleSize='';sizeSection.innerHTML='<h3>Module size (px)</h3><div class="ns-designer-grid"><label>Width<input name="moduleWidth" type="number" min="1" max="5000" step="1"></label><label>Height<input name="moduleHeight" type="number" min="1" max="5000" step="1"></label></div><button type="button" data-action="set-module-size">Apply module size</button>';
    $('[data-module-padding]',panel).before(sizeSection);
    bindDesignerDrag();
    outline=document.createElement('div');outline.id='nsAssetSelection';outline.hidden=true;outline.tabIndex=-1;
    outline.innerHTML='<span data-selection-label></span>'+['nw','n','ne','e','se','s','sw','w'].map(c=>`<button type="button" data-asset-corner="${c}" aria-label="Resize asset ${c}" tabindex="0"></button>`).join('');document.body.append(outline);
    outline.addEventListener('pointerdown',e=>{const h=e.target.closest('[data-asset-corner]');if(h){e.preventDefault();e.stopPropagation();if(selectedMany.length)beginMany(e);else begin(e,h.dataset.assetCorner);}else if(selectedMany.length){e.preventDefault();e.stopPropagation();beginMany(e);}});
    panel.addEventListener('change',e=>{
      const c=e.target,k=c.name;
      if(c.dataset.colorPicker && selected){mutate({[c.dataset.colorPicker]:c.value});return;}
      if(k==='mode'){mode=c.value;selected=null;selectedModule=null;selectedModules=[];syncMode();return;}
      if(k==='root'){const root=roots().find(r=>rootKey(r)===c.value);if(root)select(root,null);return;}
      if(k==='assetSizing'){
        const root=chosenRoot();if(!root)return;
        remember();const rec=record(root,true);rec.sizing=c.value==='fixed'?'fixed':'dynamic';
        if(rec.sizing==='fixed'){
          rec.assets ||= {};
          candidates(root).filter(visible).forEach(node=>{
            const key=node.dataset.nsAsset || selector(root,node),asset=rec.assets[key] ||= {},box=node.getBoundingClientRect();
            if(!own(asset,'w'))asset.w=Math.max(1,Math.round(box.width));
            if(!own(asset,'h'))asset.h=Math.max(1,Math.round(box.height));
          });
          apply();
        }
        rememberStatusSizes();persist();status('Asset sizing set to '+(c.value==='fixed'?'Fixed. Asset dimensions are held at their current pixel size.':'Dynamic. Asset positions and dimensions scale with the module.'));return;
      }
      if(k==='moduleWidth' || k==='moduleHeight' || k==='assetWidth' || k==='assetHeight')return;
      if(k.startsWith('modulePadding')){
        const targets=moduleTargets();if(!targets.length)return;
        const side=k.slice('modulePadding'.length).toLowerCase(),value=Number(c.value);
        if(!c.value.trim() || !Number.isFinite(value) || value<0 || value>2000){status('Enter module padding from 0 to 2000 px.');inspect();return;}
        remember();targets.forEach(root=>{const rec=record(root,true);rec.modulePadding ||= {};rec.modulePadding[side]=value;});apply();persist();inspect();status('Padding applied to '+targets.length+' module'+(targets.length===1?'':'s')+'.');return;
      }
      if(k==='snap' || k==='newName' || k==='newSection')return;
      if(k.startsWith('modulePadding'))return;
      if(['paddingTop','paddingRight','paddingBottom','paddingLeft'].includes(k)){
        const value=Number(c.value);
        if(!c.value.trim() || !Number.isFinite(value) || value<0 || value>2000){status('Enter asset padding from 0 to 2000 px.');inspect();return;}
        mutate({[k]:value});return;
      }
      if(NUMBERS[k]){const value=Number(c.value),[min,max]=NUMBERS[k];if(!c.value.trim() || !Number.isFinite(value) || value<min || value>max){status('Enter a value between '+min+' and '+max+'.');inspect();return;}mutate({[k]:value});}
      else if(k==='color' || k==='background' || k==='borderColor'){if(CSS.supports('color',c.value))mutate({[k]:c.value});else status('Enter a valid color, such as #ffffff.');}
      else if(['fontWeight','textAlign','fontFamily','fontStyle','borderStyle'].includes(k))mutate({[k]:c.value});
      else if(k==='hidden')mutate({hidden:c.checked});
      else if(k==='content' && (selected.custom || directText(selected.node) || own(current(),'text')))mutate({text:c.value});
      else if(selected.custom && k==='source')mutate({source:c.value});
      else if(selected.custom && k==='image'){if(!c.value || safeImage(c.value))mutate({src:c.value});else status('Use an HTTP(S) image URL or a local image path.');}
    });
    panel.addEventListener('click',e=>{
      if(suppressDockClick){e.preventDefault();e.stopPropagation();return;}
      const addButton=e.target.closest('[data-add]');if(addButton){add(addButton.dataset.add);return;}
      const action=e.target.closest('[data-action]')?.dataset.action;
      if(action==='collapse')collapseDesigner(!panel.classList.contains('ns-designer-collapsed'));
      if(action==='undo')history(true);if(action==='redo')history(false);if(action==='checkpoint'){const save=$('.layout-save');if(save)save.click();else persist(true);}
      if(action==='restore')resetAsset();
      if(action==='center-ns')centerAssets('y');
      if(action==='center-ew')centerAssets('x');
      if(action==='fit')fitModuleToAssets();
      if(action==='set-module-size')setModuleSize();
      if(action==='set-asset-size')setAssetSize();
      if(action==='rebuild-weather'){
        const root=chosenRoot();
        if(!root?.matches('#weatherStrip > .weather-card')){status('Select an Overview weather tile first.');return;}
        remember();delete state.roots[rootKey(root)];selected=null;selectedMany=[];selectedModule=null;restoreStyles();apply();
        window.dispatchEvent(new CustomEvent('northstar:rebuild-overview-weather',{detail:{root}}));
        renderRoots();renderLayers();inspect();persist();status('Weather tile rebuilt with the standard frame and source content.');
      }
      if(action==='parent' && selected?.node.parentElement!==selected?.root)select(selected.root,selected.node.parentElement);
      if(action==='settings'){const r=chosenRoot(),id=r?.dataset.nsModule || r?.dataset.nsCompact;if(id)window.NorthstarModules?.edit(id,r.dataset.nsCompact?'compact':'full');else status('Use asset controls for this fixed module.');}
      if(action==='delete-overview-module'){
        const root=selectedModule || chosenRoot();
        if(!root?.matches('[data-canvas-module]')){status('Select an Overview module first.');return;}
        document.dispatchEvent(new CustomEvent('northstar:remove-overview-module',{detail:{module:root}}));
        selected=null;selectedMany=[];selectedModule=null;selectedModules=[];panel.dataset.root='';renderRoots();renderLayers();inspect();draw();status('Module removed from Overview. Use Restore removed to bring it back.');
      }
      if(action==='create'){
        const input=$('[name="newName"]',panel),title=input.value.trim();if(!title){input.focus();return;}
        const m=window.NorthstarModules?.createCanvas(title,$('[name="newSection"]',panel).value);if(m){mode='assets';$('[name="mode"]',panel).value=mode;select(m.el,null);syncMode();status('Blank module created. Add assets; its Overview presentation is separate.');}
      }
      if(action==='duplicate' && selected?.custom){remember();const a={...copy(current()),id:crypto.randomUUID()};a.x+=12;a.y+=12;record(selected.root,true).custom.push(a);apply();select(selected.root,selected.root.querySelector('[data-ns-asset="'+a.id+'"]'));persist();}
      if(action==='delete' && selected?.custom){remember();const rec=record(selected.root,true);rec.custom=rec.custom.filter(a=>a.id!==selected.key);selected=null;restoreStyles();apply();inspect();persist();}
      if(action==='delete-module' && selected?.root?.dataset.nsModule){const id=selected.root.dataset.nsModule;if(window.NorthstarModules?.deleteCanvas(id)){selected=null;selectedMany=[];selectedModule=null;panel.dataset.root='';restoreStyles();lastRoots='';lastLayers='';apply();inspect();status('Custom module deleted.');}}
    });
    window.addEventListener('pointerdown',e=>{
      if(!editing() || e.button!==0 || e.target.closest(EXCLUDE))return;
      const root=rootFor(e.target);if(!root)return;
      e.preventDefault();e.stopImmediatePropagation();
      if(mode==='modules'){
        if(panel.contains(document.activeElement))document.activeElement.blur();
        if(e.shiftKey){
          const index=selectedModules.indexOf(root);
          if(index>=0)selectedModules.splice(index,1);else selectedModules.push(root);
          selectedModule=selectedModules[0] || null;selected=null;selectedMany=[];panel.dataset.root=selectedModule?rootKey(selectedModule):'';
          renderRoots();renderLayers();inspect();draw();status(selectedModules.length?selectedModules.length+' modules selected. Set a size or padding to apply it to all.':'Module selection cleared.');return;
        }
        // Selecting module content never starts a module drag.
        if(selectedModule===root && selectedModules.length===1){beginModule(e,root);return;}
        if(selectedModules.length>1 && selectedModules.includes(root)){status(selectedModules.length+' modules selected. Set a size or padding to apply it to all.');return;}
        selected=null;selectedMany=[];selectedModule=root;selectedModules=[root];panel.dataset.root=rootKey(root);renderRoots();renderLayers();inspect();draw();
        status('Module selected. Shift-click more modules, then set size or padding to apply it to all.');return;
      }
      if(backgroundHit(e.target,root)){
        const startX=e.clientX,startY=e.clientY,box=document.createElement('div');box.className='ns-asset-marquee';document.body.append(box);selected=null;selectedMany=[];selectedModule=null;panel.dataset.root=rootKey(root);outline.hidden=true;inspect();
        let rect={left:startX,top:startY,right:startX,bottom:startY};
        const move=ev=>{rect={left:Math.min(startX,ev.clientX),top:Math.min(startY,ev.clientY),right:Math.max(startX,ev.clientX),bottom:Math.max(startY,ev.clientY)};Object.assign(box.style,{left:rect.left+'px',top:rect.top+'px',width:(rect.right-rect.left)+'px',height:(rect.bottom-rect.top)+'px'});};
        const finish=ev=>{window.removeEventListener('pointermove',move,true);window.removeEventListener('pointerup',finish,true);window.removeEventListener('pointercancel',finish,true);box.remove();if(ev.type!=='pointerup')return;
          const hits=candidates(root).filter(n=>visible(n)).filter(n=>{const b=n.getBoundingClientRect();return b.width>0&&b.height>0&&b.left<rect.right&&b.right>rect.left&&b.top<rect.bottom&&b.bottom>rect.top;});
          if(hits.length===1)select(root,hits[0]);else if(hits.length>1){selectedMany=hits.map(node=>({node,key:node.dataset.nsAsset||selector(root,node)}));panel.dataset.root=rootKey(root);renderRoots();renderLayers();inspect();draw();status(hits.length+' assets selected.');}else beginModule(e,root);
        };
        window.addEventListener('pointermove',move,true);window.addEventListener('pointerup',finish,true);window.addEventListener('pointercancel',finish,true);return;
      }
      const node=assetNode(e.target,root);
      if(node && !insideModule(node,root)){selected=null;selectedModule=null;inspect();draw();return;}
      if(e.shiftKey && node){
        if(!selectedMany.length && selected?.root===root && selected.node!==node)selectedMany=[{node:selected.node,key:selected.key}];
        const existing=selectedMany.findIndex(item=>item.node===node);
        if(existing>=0)selectedMany.splice(existing,1);else selectedMany.push({node,key:node.dataset.nsAsset||selector(root,node)});
        if(selectedMany.length===1)selected=selectedMany[0].node===node?{root,rootId:rootKey(root),node,custom:!!node.dataset.nsAsset,key:node.dataset.nsAsset||selector(root,node)}:{root:rootFor(selectedMany[0].node),rootId:rootKey(rootFor(selectedMany[0].node)),node:selectedMany[0].node,custom:!!selectedMany[0].node.dataset.nsAsset,key:selectedMany[0].node.dataset.nsAsset||selector(rootFor(selectedMany[0].node),selectedMany[0].node)};
        else if(selectedMany.length>1){const first=selectedMany[0],firstRoot=rootFor(first.node);selected={root:firstRoot,rootId:rootKey(firstRoot),node:first.node,custom:!!first.node.dataset.nsAsset,key:first.node.dataset.nsAsset||selector(firstRoot,first.node)};}
        else selected=null;
        selectedModule=null;selectedModules=[];panel.dataset.root=rootKey(root);renderRoots();renderLayers();inspect();draw();
        status(selectedMany.length?selectedMany.length+' assets selected. Changes apply to all selected assets.':'Asset selection cleared.');
        return;
      }
      if(e.detail===2 && node && directText(node)){select(root,node);editText(node);return;}
      if(selectedMany.length && node && selectedMany.some(item=>item.node===node)){beginMany(e);return;}
      select(root,node);if(node){outline.focus({preventScroll:true});begin(e);}
    },true);
    window.addEventListener('click',e=>{
      if(editing() && e.target.closest('.overview-add-module')){
        e.preventDefault();e.stopImmediatePropagation();collapseDesigner(false);$('details',panel).open=true;$('[name="newName"]',panel).focus();
      }
    },true);
    for(const type of ['click','dblclick','submit'])window.addEventListener(type,e=>{
      if(active() && !e.target.closest('.ns-module-theme') && rootFor(e.target)){e.preventDefault();e.stopImmediatePropagation();}
    },true);
    window.addEventListener('keydown',e=>{
      if(!editing())return;
      if((e.ctrlKey || e.metaKey) && e.key.toLowerCase()==='s'){
        e.preventDefault();e.stopImmediatePropagation();mode=mode==='modules'?'assets':'modules';selected=null;selectedModule=null;$('[name="mode"]',panel).value=mode;syncMode();return;
      }
      if(!editing())return;
      if(panel.contains(e.target) || e.target.closest('.ns-module-theme'))return;
      if(e.target.closest('input,select,textarea,dialog,[contenteditable="true"]')){
        if(rootFor(e.target) && e.key!=='Tab'){e.preventDefault();e.stopImmediatePropagation();}
        return;
      }
      if((e.ctrlKey || e.metaKey) && ['z','y'].includes(e.key.toLowerCase())){e.preventDefault();history(e.key.toLowerCase()==='z'&&!e.shiftKey);return;}
      if(e.key==='Escape'){selected=null;selectedMany=[];selectedModule=null;selectedModules=[];inspect();draw();return;}
      if(e.key==='Delete' || e.key==='Backspace'){
        if(selectedMany.length){e.preventDefault();e.stopImmediatePropagation();const root=selectedMany[0].node.closest(ROOTS),rec=record(root,true);remember();selectedMany.forEach(item=>{const node=item.node,key=node.dataset.nsAsset||selector(root,node);if(node.dataset.nsAsset)rec.custom=rec.custom.filter(asset=>asset.id!==key);else{rec.assets[key] ||= {};rec.assets[key].hidden=true;}});selectedMany=[];selected=null;restoreStyles();apply();inspect();persist();status('Selected assets deleted or hidden.');return;}
        if(selected){e.preventDefault();e.stopImmediatePropagation();const rec=record(selected.root,true);remember();if(selected.custom)rec.custom=rec.custom.filter(asset=>asset.id!==selected.key);else{rec.assets[selected.key] ||= {};rec.assets[selected.key].hidden=true;}selected=null;restoreStyles();apply();inspect();persist();status('Asset deleted or hidden.');return;}
      }
      if(selectedModule && ['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key)){
        e.preventDefault();e.stopImmediatePropagation();
        let target=selectedModule,handle=moduleHandle(target);
        while(!handle){target=target.parentElement?.closest(ROOTS);if(!target)break;handle=moduleHandle(target);}
        const dx=e.key==='ArrowLeft'?-1:e.key==='ArrowRight'?1:0,dy=e.key==='ArrowUp'?-1:e.key==='ArrowDown'?1:0;
        if(handle && window.NorthstarWindowLayout?.nudge(handle,dx,dy)){selectedModule=target;draw();}
        else status('This container has no movable module frame.');
      }else if(selectedMany.length && ['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key)){
        e.preventDefault();e.stopImmediatePropagation();const step=e.shiftKey?10:1,dx=e.key==='ArrowLeft'?-step:e.key==='ArrowRight'?step:0,dy=e.key==='ArrowUp'?-step:e.key==='ArrowDown'?step:0;moveMany(dx,dy);
      }else if(selected && ['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key)){
        e.preventDefault();e.stopImmediatePropagation();const step=e.shiftKey?10:1,dx=e.key==='ArrowLeft'?-step:e.key==='ArrowRight'?step:0,dy=e.key==='ArrowUp'?-step:e.key==='ArrowDown'?step:0;
        const next=window.NorthstarAssetLayout.change(window.NorthstarAssetLayout.box(selected.node,current()),e.target.dataset.assetCorner || 'move',dx,dy);mutate(e.target.dataset.assetCorner?next:{x:next.x,y:next.y});
      }else if(rootFor(e.target) && ['Enter',' '].includes(e.key)){e.preventDefault();e.stopImmediatePropagation();}
    },true);
    window.addEventListener('scroll',draw,true);window.addEventListener('resize',draw);
    window.addEventListener('pointermove',()=>{if(selectedModule)requestAnimationFrame(draw);});
    window.addEventListener('resize',placeDesigner);window.visualViewport?.addEventListener('resize',placeDesigner);window.visualViewport?.addEventListener('scroll',placeDesigner);
    const modeObserver=new MutationObserver(syncMode);modeObserver.observe(document.body,{attributes:true,attributeFilter:['class']});
    $('.layout-save')?.addEventListener('click',()=>persist(true));
    const owners=$$('.section[id]').filter(n=>!['overview','modules','scada','flows','training','field-operations','unit-cycling','service-requests'].includes(n.id));
    owners.forEach(n=>$('[name="newSection"]',panel).add(new Option(n.id==='switching'?'Engineering':n.id.charAt(0).toUpperCase()+n.id.slice(1),n.id)));
    $('[name="newSection"]',panel).value='tools';
  }
  function init(){
    if(!window.NorthstarAssetLayout)return;
    read();createUI();
    try{if(!localStorage.getItem(KEY+'Saved'))localStorage.setItem(KEY+'Saved',JSON.stringify(state));}catch{storageError=true;}
    window.NorthstarAssetEditor={
      active,
      refresh:schedule,
      checkpoint:()=>persist(true),
      refreshNow:()=>{if(!dragging)apply();}
    };
    const observer=new MutationObserver(records=>{
      const changed=records.some(r=>!r.target.closest?.('#nsAssetEditor,#nsAssetSelection,.ns-asset-layer') && [...r.addedNodes,...r.removedNodes].some(n=>n.nodeType!==1 || !n.matches?.('.ns-asset-layer')));
      if(!changed)return;
      // Feed renderers replace whole assets with their source markup. Reapply
      // overrides in this mutation checkpoint so the source frame never paints.
      if(!dragging)apply();else schedule();
    });
    observer.observe(document.body,{childList:true,characterData:true,subtree:true});
    // Avoid periodic reapplying saved styles while the asset editor is open;
    // live DOM changes are already picked up by the observer below.
    setInterval(()=>{if(document.visibilityState==='visible' && !dragging && !active())apply();},1500);
    syncMode();apply();rememberStatusSizes();window.addEventListener('northstar:status-layout-change',scheduleStatusReflow);
    statusResizeObserver=new ResizeObserver(entries=>{entries.forEach(({target})=>{if(!statusSizes.has(target)){const box=target.getBoundingClientRect();if(box.width>0&&box.height>0)statusSizes.set(target,{w:box.width,h:box.height});}});scheduleStatusReflow();});resizableRoots().forEach(root=>statusResizeObserver.observe(root));
    const observeResizableRoots=new MutationObserver(()=>resizableRoots().forEach(root=>{if(!statusSizes.has(root)){const box=root.getBoundingClientRect();if(box.width>0&&box.height>0)statusSizes.set(root,{w:box.width,h:box.height});statusResizeObserver.observe(root);}}));observeResizableRoots.observe(document.body,{childList:true,subtree:true});
  }
  const start=()=>Promise.resolve(window.northstarLayoutReady).then(()=>setTimeout(init,0));
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start);else start();
})();
