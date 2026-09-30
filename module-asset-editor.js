/* Visual module designer. Feed nodes stay in place and keep their live values.
 * Geometry belongs to NorthstarAssetLayout in module-layout.js.
 * Preferences are local to this browser, with an explicit Saved checkpoint.
 */
(() => {
  'use strict';
  const KEY='northstarAssetEditorV1', VERSION=1;
  const ROOTS='.ns-status-module[data-status],[data-ns-compact],[data-ns-module],[data-layout-id],[data-overview-module],[data-module-id]';
  const EXCLUDE='#nsAssetEditor,#nsAssetSelection,#nsSectionModuleMenu,dialog,nav,.layout-toolbar,.ns-section-shell,.ns-window-controls,.ns-module-theme,.ns-edit-module,.ns-open-module,.canvas-move-handle,.canvas-resize-handle,.module-resize-handle,.ns-window-handle,.ns-popout-edge,[data-status-layout-handle],script,style,link,option';
  const FIELDS={fontSize:'font-size',fontFamily:'font-family',fontStyle:'font-style',color:'color',background:'background-color',fontWeight:'font-weight',textAlign:'text-align',lineHeight:'line-height',radius:'border-radius',opacity:'opacity',z:'z-index'};
  const NUMBERS={x:[-20000,20000],y:[-20000,20000],w:[8,20000],h:[8,20000],fontSize:[6,200],lineHeight:[0.5,5],radius:[0,500],opacity:[0,1],z:[-1,1000]};
  const copy=v=>JSON.parse(JSON.stringify(v)), $=(s,r=document)=>r.querySelector(s), $$=(s,r=document)=>[...r.querySelectorAll(s)];
  let state={version:VERSION,roots:{}}, panel, outline, selected=null, selectedMany=[], mode='modules', timer=0, dragging=false, undo=[], redo=[], originals=new Map(), lastRoots='', lastLayers='', storageError=false, wasEditing=false;
  const editing=()=>document.body.classList.contains('layout-edit');
  const active=()=>editing() && mode==='assets';
  let selectedModule=null;
  function backgroundHit(node,root){
    return node===root || (!node.closest('[data-ns-asset],button,a,input,select,textarea,svg,canvas,img,video,iframe') && /^(DIV|SECTION|ARTICLE|MAIN|UL|OL)$/.test(node.tagName) && !directText(node));
  }
  function moduleHandle(root){
    return root.querySelector(':scope > .canvas-move-handle,:scope > .status-layout-move-handle,:scope > .ns-window-controls [data-corner="move"]') || window.NorthstarModules?.movementHandle(root);
  }
  function beginModule(event,root){
    select(root,null);selectedModule=root;draw();
    $('[data-selection-name]',panel).textContent='Module · '+rootName(root);
    status('Whole module selected. Drag empty space or use arrow keys to move it 1 unit.');
    const x=event.clientX,y=event.clientY;
    const clear=()=>{window.removeEventListener('pointermove',move,true);window.removeEventListener('pointerup',clear,true);window.removeEventListener('pointercancel',clear,true);};
    const move=e=>{
      if(Math.hypot(e.clientX-x,e.clientY-y)<4)return;
      clear();let target=root,handle=moduleHandle(target);
      while(!handle){target=target.parentElement?.closest(ROOTS);if(!target)break;handle=moduleHandle(target);}
      if(!handle){status('This container has no movable module frame.');return;}
      selectedModule=target;
      // Hand the active pointer to the existing geometry owner and persistence.
      handle.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,cancelable:true,pointerId:event.pointerId,pointerType:event.pointerType,button:0,buttons:1,clientX:x,clientY:y}));
      handle.dispatchEvent(new PointerEvent('pointermove',{bubbles:true,pointerId:event.pointerId,buttons:1,clientX:e.clientX,clientY:e.clientY}));
      draw();
    };
    window.addEventListener('pointermove',move,true);window.addEventListener('pointerup',clear,true);window.addEventListener('pointercancel',clear,true);
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
    try {const value=JSON.parse(localStorage.getItem(KEY)||'null');if(value?.version===VERSION && value.roots && typeof value.roots==='object' && !Array.isArray(value.roots))state=value;}
    catch {storageError=true;}
  }
  function persist(checkpoint=false) {
    try {localStorage.setItem(KEY,JSON.stringify(state));if(checkpoint)localStorage.setItem(KEY+'Saved',JSON.stringify(state));storageError=false;status(checkpoint?'Saved checkpoint on this browser.':'Draft saved on this browser. SAVE sets the reset checkpoint.');return true;}
    catch {storageError=true;status('Could not save: browser storage is unavailable or full. Keep this page open.');return false;}
  }
  function remember(){undo.push(copy(state));if(undo.length>60)undo.shift();redo=[];}
  function rootKey(root) {
    const anchor=root.id || root.dataset.moduleId || root.dataset.layoutId || '';
    if(root.matches('.ns-status-module'))return 'fixed:'+root.dataset.status;
    if(root.dataset.nsCompact)return 'compact:'+root.dataset.nsCompact+':'+anchor;
    if(root.dataset.nsModule)return 'full:'+root.dataset.nsModule;
    const scope=root.closest('.section')?.id || (root.closest('#nsStatusBar')?'fixed':'overview');
    return scope+':'+anchor;
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
  function roots(){return $$(ROOTS).filter(el=>!el.closest(EXCLUDE) && (el.id || el.dataset.nsModule || el.dataset.nsCompact || el.dataset.moduleId || el.dataset.layoutId || el.dataset.status));}
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
    const graphic=node.closest('svg,canvas,iframe,video,img');
    return graphic && root.contains(graphic)?graphic:node;
  }
  function assetName(node){return (node.getAttribute('aria-label') || node.getAttribute('alt') || directText(node) || node.id || node.localName+' '+[...node.classList].slice(0,2).join(' ')).trim().slice(0,90);}
  function current(){if(!selected)return null;const rec=record(selected.root,true);return selected.custom?rec.custom.find(a=>a.id===selected.key):rec.assets[selected.key] || {};}
  function resolve(){if(!selected)return null;const root=roots().find(r=>rootKey(r)===selected.rootId);if(!root){selected=null;return null;}selected.root=root;selected.node=selected.custom?root.querySelector('[data-ns-asset="'+CSS.escape(selected.key)+'"]'):find(root,selected.key);if(!dragging && selected.node && !insideModule(selected.node,root)){selected=null;lastLayers='';renderLayers();return null;}return selected.node;}
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
    const styles=window.NorthstarAssetLayout.styles(rec,custom,node);
    for(const [key,css] of Object.entries(FIELDS))if(own(rec,key))styles[css]=String(rec[key])+(['fontSize','radius'].includes(key)?'px':'');
    if(!custom && own(rec,'z') && getComputedStyle(node).position==='static')styles.position='relative';
    if(rec.hidden)styles.display='none';
    setStyles(node,styles);
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
    if(node && !insideModule(node,root)){selected=null;selectedModule=null;panel.dataset.root=rootKey(root);lastLayers='';renderLayers();inspect();draw();return;}
    selectedModule=null;selectedMany=[];if(outline)delete outline.dataset.multiple;
    selected=node?{root,rootId:rootKey(root),node,custom:!!node.dataset.nsAsset,key:node.dataset.nsAsset || selector(root,node)}:null;
    panel.dataset.root=rootKey(root);lastLayers='';renderRoots();renderLayers();inspect();draw();
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
      if(!active() || panel.classList.contains('ns-designer-collapsed') || !visible(selectedModule)){outline.hidden=true;return;}
      const box=selectedModule.getBoundingClientRect();outline.hidden=false;
      Object.assign(outline.style,{left:box.x+'px',top:box.y+'px',width:box.width+'px',height:box.height+'px'});
      $('[data-selection-label]',outline).textContent='Module · '+rootName(selectedModule);return;
    }
    if(!active() || panel.classList.contains('ns-designer-collapsed') || !resolve() || !visible(selected.node)){outline.hidden=true;return;}
    const b=selected.node.getBoundingClientRect();outline.hidden=false;
    Object.assign(outline.style,{left:b.x+'px',top:b.y+'px',width:b.width+'px',height:b.height+'px'});
    $('[data-selection-label]',outline).textContent=assetName(selected.node).slice(0,45);
  }
  function mutate(patch){
    if(!selected)return;
    remember();const rec=record(selected.root,true);
    const asset=selected.custom?current():(rec.assets[selected.key] ||= {});
    Object.assign(asset,patch);restoreStyles();apply();persist();inspect();
  }
  function fitModuleToAssets(){
    const root=chosenRoot();if(!root){status('Choose a module first.');return;}
    const assets=candidates(root).filter(node=>visible(node) && getComputedStyle(node).position!=='absolute' && node!==root);
    if(!assets.length){status('This module has no visible assets to fit.');return;}
    const rootBox=root.getBoundingClientRect(),rects=assets.map(node=>node.getBoundingClientRect());
    const padding=12,left=Math.min(...rects.map(r=>r.left))-padding,top=Math.min(...rects.map(r=>r.top))-padding;
    const right=Math.max(...rects.map(r=>r.right))+padding,bottom=Math.max(...rects.map(r=>r.bottom))+padding;
    const width=Math.max(40,Math.ceil(right-left)),height=Math.max(40,Math.ceil(bottom-top));
    const id=root.dataset.nsModule || root.dataset.nsCompact,variant=root.dataset.nsCompact?'compact':'full';
    remember();
    if(root.matches('.ns-status-module[data-status]') || root.dataset.canvasModule){
      const geometry=window.NorthstarModuleGeometry;
      if(!geometry?.fit(root,{x:left,y:top,w:width,h:height})){status('This module frame could not be resized.');return;}
    }else if(id && window.NorthstarModules?.state?.modules?.[id]){
      const modules=window.NorthstarModules,meta=modules.state.modules[id];
      if(!modules.fitSize?.(id,variant,width,height)){status('This section module frame could not be resized.');return;}
    }else{
      const key='northstarCanvasLayoutV1',layoutId=root.id || root.dataset.moduleId || root.dataset.layoutId;let positions={};try{positions=JSON.parse(localStorage.getItem(key)||'{}')||{};}catch{}
      const position=positions[layoutId];
      if(!position){status('This module does not have a saved resizable frame.');return;}
      const containerRect=root.closest('main')?.getBoundingClientRect();
      position.x=Math.max(0,left-(containerRect?.left || 0));position.y=Math.max(0,top-(containerRect?.top || 0));position.w=width;position.h=height;
      localStorage.setItem(key,JSON.stringify(positions));
      const profileKey='northstarOverviewProfilesV2';let profiles={};try{profiles=JSON.parse(localStorage.getItem(profileKey)||'{}')||{};}catch{}
      Object.values(profiles).forEach(profile=>{if(profile?.positions?.[layoutId])profile.positions[layoutId]={...position};});
      localStorage.setItem(profileKey,JSON.stringify(profiles));
      try{localStorage.setItem(key+'Saved',JSON.stringify(positions));localStorage.setItem(profileKey+'Saved',JSON.stringify(profiles));}catch{}
      window.dispatchEvent(new Event('resize'));
    }
    persist();apply();status('Module border fitted to visible assets with 12px padding.');
  }
  function inspect(){
    const node=resolve(), area=$('[data-inspector]',panel);area.hidden=!node && !selectedMany.length;
    $('[data-selection-name]',panel).textContent=selectedMany.length?selectedMany.length+' assets selected':node?assetName(node):selectedModule?'Module · '+rootName(selectedModule):'Select an asset on the dashboard';
    if(!node)return;
    const rec=current(), css=getComputedStyle(node), box=window.NorthstarAssetLayout.box(node,rec);
    for(const name of Object.keys(NUMBERS)){
      const control=panel.querySelector('[name="'+name+'"]');
      const value=rec[name] ?? box[name] ?? (name==='fontSize'?parseFloat(css.fontSize):name==='lineHeight'?1.2:name==='radius'?parseFloat(css.borderRadius):name==='opacity'?css.opacity:name==='z'?0:'');
      control.value=Math.round(Number(value)*100)/100;
    }
    ['color','background'].forEach(name=>{
      panel.querySelector('[name="'+name+'"]').value=rec[name] || (name==='color'?css.color:css.backgroundColor);
      const rgb=(name==='color'?css.color:css.backgroundColor).match(/[\d.]+/g);
      if(rgb?.length>=3)panel.querySelector('[data-color-picker="'+name+'"]').value='#'+rgb.slice(0,3).map(v=>Math.round(Number(v)).toString(16).padStart(2,'0')).join('');
    });
    $('[name="fontFamily"]',panel).value=rec.fontFamily || 'system-ui';
    $('[name="fontStyle"]',panel).value=rec.fontStyle || css.fontStyle;
    $('[name="fontWeight"]',panel).value=rec.fontWeight || (Number(css.fontWeight)>=600?'700':'400');
    $('[name="textAlign"]',panel).value=rec.textAlign || css.textAlign.replace('start','left').replace('end','right');
    $('[name="hidden"]',panel).checked=!!rec.hidden;
    $('[data-custom-fields]',panel).hidden=!selected.custom;
    $('[data-source-field]',panel).hidden=!selected.custom || rec.kind!=='data';
    $('[data-image-field]',panel).hidden=!selected.custom || rec.kind!=='image';
    $('[name="content"]',panel).value=rec.text || '';
    $('[name="image"]',panel).value=rec.src || '';
    $('[data-action="duplicate"]',panel).disabled=!selected.custom;
    $('[data-action="delete"]',panel).disabled=!selected.custom;
    $('[data-action="parent"]',panel).disabled=selected.custom || node.parentElement===selected.root;
    if(selected.custom && rec.kind==='data')sources(rec.source);
    $('[data-live-note]',panel).textContent=selected.custom?'Custom content. Layout applies to this presentation.':'Source content stays live. Change its appearance here; use module settings to edit built-in labels.';
  }
  function renderRoots(){
    const all=roots().filter(visible), signature=all.map(r=>rootKey(r)+'|'+rootName(r)).join('\n');
    const picker=$('[name="root"]',panel);
    if(signature!==lastRoots){lastRoots=signature;picker.replaceChildren(new Option('Choose a visible module',''));all.forEach(r=>picker.add(new Option((rootKey(r).startsWith('fixed:')?'Fixed · ':rootKey(r).startsWith('compact:')?'Overview · ':'')+rootName(r),rootKey(r))));}
    picker.value=selected?.rootId || panel.dataset.root || '';
  }
  function candidates(root){return $$('*',root).filter(node=>!node.closest(EXCLUDE) && !node.matches('.ns-asset-layer') && rootFor(node)===root && insideModule(node,root) && (!node.closest('svg') || node.matches('svg')) && (node.dataset.nsAsset || directText(node) || node.matches('img,svg,canvas,iframe,video,input,select,textarea')));}
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
  function resetAsset(){if(!selected)return;remember();const rec=record(selected.root,true);if(selected.custom){const a=current();Object.keys(FIELDS).concat('hidden').forEach(k=>delete a[k]);}else delete rec.assets[selected.key];restoreStyles();apply();persist();inspect();}
  function begin(event,corner='move'){
    if(event.button!==0 || !selected?.node)return;
    const startNode=selected.node, before=copy(state), rec=current(), original=window.NorthstarAssetLayout.box(startNode,rec);
    const computed=getComputedStyle(startNode), rect=startNode.getBoundingClientRect();
    const scaleX=rect.width/(parseFloat(computed.width)||rect.width)||1,scaleY=rect.height/(parseFloat(computed.height)||rect.height)||1;
    const px=event.clientX,py=event.clientY;let changed=false;
    dragging=true;
    const move=e=>{
      if(!changed && Math.hypot(e.clientX-px,e.clientY-py)<3)return;
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
    if(isEditing && !wasEditing){mode='modules';selected=null;selectedMany=[];selectedModule=null;if(panel)$('[name="mode"]',panel).value=mode;}
    if(!isEditing){selected=null;selectedMany=[];selectedModule=null;}
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
      <label>Module<select name="root"></select></label><div class="ns-designer-actions"><button type="button" data-action="fit">Fit border to assets</button><button type="button" data-action="settings">Module data editor / other presentation</button></div>
      <div class="ns-designer-add" aria-label="Add asset">${['heading','text','data','image','shape','divider'].map(k=>`<button type="button" data-add="${k}">+ ${k==='data'?'Live value':k[0].toUpperCase()+k.slice(1)}</button>`).join('')}</div>
      <details><summary data-layer-count>Assets</summary><div data-layers></div></details>
      <h3 data-selection-name>Select an asset on the dashboard</h3><section data-inspector hidden>
      <div class="ns-designer-actions"><button type="button" data-action="parent">Select parent</button><button type="button" data-action="restore">Reset asset</button></div>
      <div class="ns-designer-grid">${[['x','X offset'],['y','Y offset'],['w','Width'],['h','Height']].map(([k,label])=>`<label>${label}<input type="number" name="${k}" step="1" min="${NUMBERS[k][0]}" max="${NUMBERS[k][1]}"></label>`).join('')}</div>
      <div data-custom-fields><label>Text / label<textarea name="content" rows="2" maxlength="4000"></textarea></label><label data-source-field>Live source<select name="source"></select></label><label data-image-field>Image URL<input name="image" placeholder="https://… or /image.png"></label></div>
      <div class="ns-designer-grid"><label>Text size<input name="fontSize" type="number" min="6" max="200"></label><label>Weight<select name="fontWeight"><option value="400">Regular</option><option value="700">Bold</option></select></label><label>Text color<span class="ns-color-row"><input type="color" data-color-picker="color" aria-label="Choose text color"><input name="color" placeholder="#ffffff"></span></label><label>Background<span class="ns-color-row"><input type="color" data-color-picker="background" aria-label="Choose background color"><input name="background" placeholder="transparent"></span></label><label>Font<select name="fontFamily"><option value="system-ui">System</option><option value="Arial">Arial</option><option value="Georgia">Georgia</option><option value="monospace">Monospace</option></select></label><label>Style<select name="fontStyle"><option value="normal">Normal</option><option value="italic">Italic</option></select></label><label>Align<select name="textAlign"><option value="left">Left</option><option value="center">Center</option><option value="right">Right</option></select></label><label>Line spacing<input name="lineHeight" type="number" min="0.5" max="5" step="0.1"></label><label>Corner radius<input name="radius" type="number" min="0" max="500"></label><label>Opacity<input name="opacity" type="number" min="0" max="1" step="0.1"></label><label>Layer<input name="z" type="number" min="-1" max="1000"></label><label class="ns-designer-check"><input name="hidden" type="checkbox">Hidden</label></div>
      <div class="ns-designer-actions"><button type="button" data-action="duplicate">Duplicate</button><button type="button" data-action="delete">Delete custom asset</button></div><p data-live-note></p></section>
      <p class="ns-designer-help">Click and drag an asset. In asset mode, drag empty module space to box-select assets; drag an asset to move it. Drag its corner handles to resize. Escape deselects.</p><p data-designer-status role="status"></p></div>`;
    document.body.append(panel);
    bindDesignerDrag();
    outline=document.createElement('div');outline.id='nsAssetSelection';outline.hidden=true;outline.tabIndex=-1;
    outline.innerHTML='<span data-selection-label></span>'+['nw','n','ne','e','se','s','sw','w'].map(c=>`<button type="button" data-asset-corner="${c}" aria-label="Resize asset ${c}" tabindex="0"></button>`).join('');document.body.append(outline);
    outline.addEventListener('pointerdown',e=>{const h=e.target.closest('[data-asset-corner]');if(h){e.preventDefault();e.stopPropagation();begin(e,h.dataset.assetCorner);}});
    panel.addEventListener('change',e=>{
      const c=e.target,k=c.name;
      if(c.dataset.colorPicker && selected){mutate({[c.dataset.colorPicker]:c.value});return;}
      if(k==='mode'){mode=c.value;selected=null;selectedModule=null;syncMode();return;}
      if(k==='root'){const root=roots().find(r=>rootKey(r)===c.value);if(root)select(root,null);return;}
      if(k==='snap' || k==='newName' || k==='newSection' || !selected)return;
      if(NUMBERS[k]){const value=Number(c.value),[min,max]=NUMBERS[k];if(!c.value.trim() || !Number.isFinite(value) || value<min || value>max){status('Enter a value between '+min+' and '+max+'.');inspect();return;}mutate({[k]:value});}
      else if(k==='color' || k==='background'){if(CSS.supports('color',c.value))mutate({[k]:c.value});else status('Enter a valid color, such as #ffffff.');}
      else if(['fontWeight','textAlign','fontFamily','fontStyle'].includes(k))mutate({[k]:c.value});
      else if(k==='hidden')mutate({hidden:c.checked});
      else if(selected.custom && k==='content')mutate({text:c.value});
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
      if(action==='fit')fitModuleToAssets();
      if(action==='parent' && selected?.node.parentElement!==selected?.root)select(selected.root,selected.node.parentElement);
      if(action==='settings'){const r=chosenRoot(),id=r?.dataset.nsModule || r?.dataset.nsCompact;if(id)window.NorthstarModules?.edit(id,r.dataset.nsCompact?'compact':'full');else status('Use asset controls for this fixed module.');}
      if(action==='create'){
        const input=$('[name="newName"]',panel),title=input.value.trim();if(!title){input.focus();return;}
        const m=window.NorthstarModules?.createCanvas(title,$('[name="newSection"]',panel).value);if(m){mode='assets';$('[name="mode"]',panel).value=mode;select(m.el,null);syncMode();status('Blank module created. Add assets; its Overview presentation is separate.');}
      }
      if(action==='duplicate' && selected?.custom){remember();const a={...copy(current()),id:crypto.randomUUID()};a.x+=12;a.y+=12;record(selected.root,true).custom.push(a);apply();select(selected.root,selected.root.querySelector('[data-ns-asset="'+a.id+'"]'));persist();}
      if(action==='delete' && selected?.custom){remember();const rec=record(selected.root,true);rec.custom=rec.custom.filter(a=>a.id!==selected.key);selected=null;restoreStyles();apply();inspect();persist();}
    });
    window.addEventListener('pointerdown',e=>{
      if(!active() || e.button!==0 || e.target.closest(EXCLUDE))return;
      const root=rootFor(e.target);if(!root)return;
      e.preventDefault();e.stopImmediatePropagation();
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
      select(root,node);if(node){outline.focus({preventScroll:true});begin(e);}
    },true);
    window.addEventListener('click',e=>{
      if(editing() && e.target.closest('.overview-add-module')){
        e.preventDefault();e.stopImmediatePropagation();collapseDesigner(false);$('details',panel).open=true;$('[name="newName"]',panel).focus();
      }
    },true);
    for(const type of ['click','dblclick','contextmenu','submit'])window.addEventListener(type,e=>{
      if(active() && rootFor(e.target)){e.preventDefault();e.stopImmediatePropagation();}
    },true);
    window.addEventListener('keydown',e=>{
      if(!editing())return;
      if((e.ctrlKey || e.metaKey) && e.key.toLowerCase()==='s'){
        e.preventDefault();e.stopImmediatePropagation();mode=mode==='modules'?'assets':'modules';selected=null;selectedModule=null;$('[name="mode"]',panel).value=mode;syncMode();return;
      }
      if(!active())return;
      if(panel.contains(e.target))return;
      if(e.target.closest('input,select,textarea,dialog,[contenteditable="true"]')){
        if(rootFor(e.target) && e.key!=='Tab'){e.preventDefault();e.stopImmediatePropagation();}
        return;
      }
      if((e.ctrlKey || e.metaKey) && ['z','y'].includes(e.key.toLowerCase())){e.preventDefault();history(e.key.toLowerCase()==='z'&&!e.shiftKey);return;}
      if(e.key==='Escape'){selected=null;selectedMany=[];selectedModule=null;inspect();draw();return;}
      if(selectedModule && ['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key)){
        e.preventDefault();e.stopImmediatePropagation();
        let target=selectedModule,handle=moduleHandle(target);
        while(!handle){target=target.parentElement?.closest(ROOTS);if(!target)break;handle=moduleHandle(target);}
        const dx=e.key==='ArrowLeft'?-1:e.key==='ArrowRight'?1:0,dy=e.key==='ArrowUp'?-1:e.key==='ArrowDown'?1:0;
        if(handle && window.NorthstarWindowLayout?.nudge(handle,dx,dy)){selectedModule=target;draw();}
        else status('This container has no movable module frame.');
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
    window.NorthstarAssetEditor={active,refresh:schedule};
    const observer=new MutationObserver(records=>{if(records.some(r=>!r.target.closest?.('#nsAssetEditor,#nsAssetSelection,.ns-asset-layer') && [...r.addedNodes,...r.removedNodes].some(n=>n.nodeType!==1 || !n.matches?.('.ns-asset-layer'))))schedule();});
    observer.observe(document.body,{childList:true,characterData:true,subtree:true});
    setInterval(()=>{if(document.visibilityState==='visible' && !dragging)apply();},1500);
    syncMode();apply();
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>setTimeout(init,0));else setTimeout(init,0);
})();
