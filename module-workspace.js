/* Module identity, navigation and presentation. Geometry lives in module-layout.js.
 * Keep feed-owned elements in place: hide ancestor siblings instead of moving or
 * cloning live controls. Full and compact presentations share one module record.
 */
window.NORTHSTAR_MODULE_WORKSPACE = true;
(() => {
  'use strict';
  const KEY = 'northstarModuleWorkspaceV1';
  const detachedId = new URLSearchParams(location.search).get('nsModuleWindow');
  const read = key => { try { const value = JSON.parse(localStorage.getItem(key) || '{}'); return value && typeof value === 'object' && !Array.isArray(value) ? value : {}; } catch { return {}; } };
  const state = Object.assign({sections:{}, modules:{}}, read(KEY));
  state.sections ||= {}; state.modules ||= {};
  const registry = new Map(), originals = new WeakMap(), masked = new Map(), presentationHidden = new WeakMap();
  const $ = (s, root = document) => root.querySelector(s);
  const $$ = (s, root = document) => [...root.querySelectorAll(s)];
  const esc = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const label = el => ($('h1,h2,h3,header strong', el)?.textContent || el.getAttribute('aria-label') || el.dataset.moduleId || el.id || 'Module').trim().replace(/[-_]/g,' ');
  let section = 'overview', active = '', shell, tree, tabs, editor, frame = 0, painting = false, sectionMenuOpen = false, treeSignature = '';
  let editorDrafts = {};
  function save() {
    if (detachedId) return; // A display window must not overwrite the main workspace.
    try { localStorage.setItem(KEY, JSON.stringify(state)); }
    catch { if (editor) $('.ns-editor-status', editor).textContent = 'Changes could not be saved in this browser.'; }
  }
  const pref = id => state.modules[id] ||= {full:{}, compact:{}};
  const themes = ['default','shopify','arctic','signal','midnight','forest','violet','graphite','contrast','stallion'];
  const themeNames = {default:'NORTHSTAR DEFAULT',shopify:'SHOPIFY DARK',arctic:'ARCTIC BLUE',signal:'SIGNAL ORANGE',midnight:'MIDNIGHT STEEL',forest:'FOREST OPS',violet:'VIOLET NIGHT',graphite:'GRAPHITE',contrast:'HIGH CONTRAST',stallion:'STALLION TRIAL'};
  const view = (id, variant) => pref(id)[variant] ||= {};
  const sectionState = id => state.sections[id] ||= {tabs:[], active:'', landing:'', floating:false, boxes:{}};
  const name = m => pref(m.id).name || m.title;
  const mergedSections = {flows:'tools',modules:'tools',training:'tools',scada:'switching','field-operations':'operations','unit-cycling':'operations','service-requests':'operations'};
  const ownerSection = id => mergedSections[id] || id;
  const sectionTitle = id => ({switching:'Engineering',logbook:'Events',tools:'Tools',files:'Files',crew:'Crew check-ins',mobile:'Field tracker',operations:'Operations'}[id] || id.replace(/-/g,' '));
  const belongs = (m,owner) => m && (m.section===owner || (owner==='switching' && (m.id==='outages:uwpc' || m.parent==='outages:uwpc')));
  const sectionItems = owner => [...registry.values()].filter(m=>belongs(m,owner)).sort((a,b)=>Number(a.sourceSection!==owner)-Number(b.sourceSection!==owner));
  function register(id, title, owner, el, parent = '', compact = []) {
    if (!el) return;
    const old = registry.get(id);
    registry.set(id, {id,title,section:ownerSection(owner),sourceSection:owner,el,parent,compact});
    el.dataset.nsModule = id;
    compact.forEach(node => node.dataset.nsCompact = id);
    if (old?.el !== el) applyPresentation(registry.get(id), 'full', el);
  }
  function discover() {
    const weatherRoot = $('#weatherGridFull');
    if (weatherRoot) register('weather:locations', 'Weather locations', 'weather', weatherRoot, '', $$('#weatherStrip > .weather-card'));
    register('markets:IESO', 'IESO market data', 'markets', $('#marketDetail'), '', $$('#marketTopTiles [data-module-id="IESO"],#marketTopTiles > .ontario-market'));
    register('markets:comparison', 'Market comparison', 'markets', $('#overviewMarket'));
    $$('#outages [data-outage-pane]').forEach(el => {
      const key = el.dataset.outagePane;
      if (key === 'switching-plans' || key === 'uwpc') return;
      register('outages:'+key, {current:'Current outages',uwpc:'UWPC',reports:'Outage reports'}[key] || key, 'outages', el);
    });
    register('outages:uwpc', 'UWPC', 'outages', $('#switching .switching-workspace'));
    $$('.section').filter(el => !['overview','weather','markets','outages','switching','modules'].includes(el.id)).forEach(root => {
      if(root.id==='logbook' && $('.logbook-layout',root))$('.logbook-layout',root).hidden=false;
      const explicit = (root.id==='logbook'?$$('#operationsConsole,#eventRegister,.logbook-card,.logbook-report',root):root.id==='tools'?$$('.tool-grid,.workbench-card,#deviceLibrary,#overviewChat,#outlookWorkspace',root):$$('[data-module-id],.workbench-card',root)).filter(el=>el!==root && !el.dataset.nsCustom);
      const candidates = explicit.length?explicit:$$('.panel', root).filter(el => !el.dataset.nsCustom && (!el.parentElement.closest('.panel') || !root.contains(el.parentElement.closest('.panel'))));
      const currentIds = new Set();
      (candidates.length ? candidates : [root]).forEach((el, i) => {
        if (!el.id && !el.dataset.moduleId) el.dataset.moduleId = root.id+'-module-'+i;
        const id=root.id+':'+(el.dataset.moduleId || el.id);currentIds.add(id);
        register(id, ({flows:'Flows',training:'Training'}[root.id]) || label(el), root.id, el);
      });
      for(const [id,m] of registry)if(m.sourceSection===root.id && !pref(id).custom && !currentIds.has(id))registry.delete(id);
    });
    // Match existing overview cards to their full page. Their feed anchors stay intact.
    const aliases = [['#overviewStaff','crew'],['#overviewStaffSummary','crew'],['#overviewFieldTracker','mobile'],['#overviewGeneratingStations','scada']];
    aliases.forEach(([selector, owner]) => {
      const m = [...registry.values()].find(m => m.sourceSection === owner), el = $(selector);
      if (m && el && !m.compact.includes(el)) { m.compact.push(el); el.dataset.nsCompact = m.id; }
    });
    register('markets:dispatch','APIROQ dispatch','markets',$('#dispatchDetail'),'',$$('#dispatchClient'));
    const events=[...registry.values()].find(m=>m.el.id==='eventRegister');
    if(events){events.compact=$$('#overviewEventsSummary,#overviewQuickLog');events.compact.forEach(el=>el.dataset.nsCompact=events.id);}
    const chat=[...registry.values()].find(m=>m.el.id==='overviewChat');
    if(chat){chat.compact=$$('#overviewChatSummary');chat.compact.forEach(el=>el.dataset.nsCompact=chat.id);}
    const market = window.NorthstarMarketModules;
    const marketData = market?.data();
    Object.entries(marketData?.nodes || {}).forEach(([key,data]) => {
      let full=key==='IESO'?$('#marketDetail'):document.getElementById('nsMarket-'+key);
      if(!full){full=document.createElement('article');full.className='panel';full.id='nsMarket-'+key;$('#markets').append(full);}
      const signature=JSON.stringify(data);
      if(full.dataset.marketSignature!==signature && !full.contains(document.activeElement)) {market.render(key,full);full.dataset.marketSignature=signature;}
      register('markets:'+key,key==='IESO'?'IESO market data':key+' market','markets',full,'',$$('#marketTopTiles > [data-module-id]').filter(el=>el.dataset.moduleId===key));
    });
    // New modules survive refresh and have separate full and overview renderings.
    Object.entries(state.modules).filter(([,p]) => p.custom).forEach(([id,p]) => {
      let el = $(`[data-ns-custom="${CSS.escape(id)}"]`);
      const target = document.getElementById(p.section);
      if (!target) return;
      if (!el) {
        el = document.createElement('article'); el.className = 'panel'; el.dataset.nsCustom = id; el.dataset.moduleId = id;
        target.append(el);
      } else if (el.parentElement !== target) target.append(el);
      register(id, p.name || 'Custom module', p.section, el, p.parent || '');
    });
    register('tools:module-editor','Modules','modules',$('#modules .ns-catalog'));
    for (const [id,m] of registry) if (!m.el.isConnected) registry.delete(id);
    for (const m of registry.values()) {
      const p = pref(m.id);
      if (p.pin && !m.compact.length) {
        let tile = $(`[data-ns-pin="${CSS.escape(m.id)}"]`);
        if (!tile) {
          tile = document.createElement('article'); tile.className = 'panel ns-summary'; tile.dataset.nsPin = m.id;
          tile.dataset.moduleId = 'summary:'+m.id; tile.setAttribute('data-overview-module','');
          $('#overviewModules')?.append(tile);
        }
        tile.dataset.nsCompact = m.id; m.compact.push(tile);
      }
      applyPresentation(m, 'full', m.el);
      m.compact.forEach(el => {el.hidden = p.overviewVisible === false;applyPresentation(m, 'compact', el);});
    }
  }
  const owns = (object, key) => Object.prototype.hasOwnProperty.call(object || {}, key);
  const editorExcluded = '.ns-module-content,.ns-window-controls,.ns-section-shell,.canvas-move-handle,.canvas-resize-handle,.ns-popout-edge,.ns-edit-module,.ns-open-module,script,style,link';
  function text(el, value) { if (el && el.textContent !== value) el.textContent = value; }
  function directText(node) {
    return [...node.childNodes].filter(child => child.nodeType === 3).map(child => child.textContent).join('').trim();
  }
  function directTextNodes(node) {
    return [...node.childNodes].filter(child => child.nodeType === 3 && child.textContent.trim());
  }
  function setDirectText(node, value) {
    const nodes = directTextNodes(node);
    if (!nodes.length) { node.append(document.createTextNode(value)); return; }
    text(nodes[0], value); nodes.slice(1).forEach(child => text(child, ''));
  }
  function editableSelector(root, node) {
    const path=[];let current=node;
    while(current && current!==root){
      const siblings=[...current.parentElement.children].filter(sibling=>sibling.tagName===current.tagName);
      path.unshift(current.tagName.toLowerCase()+':nth-of-type('+(siblings.indexOf(current)+1)+')');current=current.parentElement;
    }
    return path.join(' > ');
  }
  function editableParts(root) {
    if (!root) return [];
    const allowed='h1,h2,h3,h4,h5,h6,p,li,a,button,label,legend,span,small,strong,em,td,th,dt,dd,caption,summary,figcaption,option,output,div';
    const partName = node => ({A:'Link',BUTTON:'Button',H1:'Heading',H2:'Heading',H3:'Heading',H4:'Heading',H5:'Heading',H6:'Heading',LABEL:'Field label',LEGEND:'Field label',OUTPUT:'Value'}[node.tagName] || 'Text');
    const usable=node=>!node.closest(editorExcluded);
    const textParts=$$(allowed,root).filter(node=>usable(node) && directText(node)).map(node=>{
      const selector=editableSelector(root,node), value=directText(node);
      return {kind:'text',key:'text|'+selector,selector,value,label:partName(node),live:!!node.id || [...node.attributes].some(attr=>attr.name.startsWith('data-') && !attr.name.startsWith('data-ns-'))};
    });
    const placeholders=$$('[placeholder]',root).filter(usable).map(node=>{
      const selector=editableSelector(root,node);
      return {kind:'placeholder',key:'placeholder|'+selector,selector,value:node.getAttribute('placeholder') || '',label:'Input hint',live:false};
    });
    const images=$$('img',root).filter(usable).map(node=>{
      const selector=editableSelector(root,node);
      return {kind:'image',key:'image|'+selector,selector,src:node.getAttribute('src') || '',alt:node.getAttribute('alt') || '',label:'Image',live:false};
    });
    return [...textParts,...placeholders,...images];
  }
  function applyEditableOverrides(m, variant, root) {
    const p=view(m.id,variant);
    Object.entries(p.labels || {}).forEach(([selector,value])=>{
      try {const target=$(selector,root);if(target)setDirectText(target,value);} catch {}
    });
    Object.entries(p.elements || {}).forEach(([key,override])=>{
      const divider=key.indexOf('|');if(divider<1)return;
      const kind=key.slice(0,divider), selector=key.slice(divider+1);
      try {
        const target=$(selector,root);if(!target)return;
        if(kind==='text' && owns(override,'value'))setDirectText(target,override.value);
        if(kind==='placeholder' && owns(override,'value'))target.setAttribute('placeholder',override.value);
        if(kind==='image'){if(owns(override,'src'))target.setAttribute('src',override.src);if(owns(override,'alt'))target.setAttribute('alt',override.alt);}
      } catch {}
    });
  }
  function applyPresentation(m, variant, el) {
    const p = view(m.id,variant);
    presentationHidden.get(el)?.forEach((prior,node)=>{if(prior.value)node.style.setProperty('display',prior.value,prior.priority);else node.style.removeProperty('display');});
    presentationHidden.delete(el);
    el.style.setProperty('--ns-accent', p.accent || '#63b8df');
    el.dataset.nsTheme = themes.includes(pref(m.id).theme) ? pref(m.id).theme : '';
    el.classList.toggle('ns-dense', p.density === 'compact');
    el.classList.toggle('ns-custom-content-only', !!p.customOnly);
    let custom = $(':scope > .ns-module-content',el);
    if (!custom) { custom = document.createElement('div'); custom.className='ns-module-content'; el.prepend(custom); }
    const content = `<div class="ns-module-caption">${esc(p.title || (variant==='compact' && ({overviewStaffSummary:'WORKERS ON-SITE',overviewEventsSummary:'Events',overviewGeneratingStations:'Generating stations',overviewFieldTracker:'Field tracker',overviewChatSummary:'Chat'}[el.id])) || name(m))}</div>${p.notes ? `<p class="ns-module-notes">${esc(p.notes)}</p>` : ''}<div class="ns-content-blocks">${(p.blocks || []).map((block,i) => `<div class="ns-content-block"><span>${esc(block.label || '')}</span><strong data-ns-block="${i}">${esc(block.text || '')}</strong></div>`).join('')}</div>`;
    if (custom.dataset.template !== content) {custom.innerHTML = content; custom.dataset.template = content;}
    (p.blocks || []).forEach((block,i) => {
      if (block.source) {
        const source = document.getElementById(block.source);
        const value = source && !source.closest('.ns-module-content,#nsModuleEditor') ? source.textContent.trim() : 'Source unavailable';
        text($(`[data-ns-block="${i}"]`,custom), value || 'Awaiting data');
      }
    });
    let edit = $(':scope > .ns-edit-module',el);
    if (!edit) {
      edit = document.createElement('button'); edit.type='button'; edit.className='ns-edit-module'; edit.textContent='Edit module';
      edit.onclick = event => {event.stopPropagation();openEditor(m.id,variant);}; el.append(edit);
    }
    let themeControl = $(':scope > .ns-module-theme',el);
    if (!themeControl) {
      themeControl = document.createElement('div'); themeControl.className='ns-module-theme';
      themeControl.innerHTML='<button type="button" class="ns-module-theme-toggle" aria-label="Choose module theme" title="Choose module theme">🖌</button><div class="ns-module-theme-menu" role="menu" aria-label="Module theme"></div>';
      el.append(themeControl);
    }
    const themeMenu = $('.ns-module-theme-menu',themeControl);
    const chosenTheme = themes.includes(pref(m.id).theme) ? pref(m.id).theme : (document.body.dataset.theme || 'default');
    themeMenu.innerHTML = themes.map(theme=>`<button type="button" role="menuitemradio" aria-checked="${theme===chosenTheme}" data-module-theme="${theme}">${themeNames[theme]}</button>`).join('');
    $('.ns-module-theme-toggle',themeControl).onclick = event => {event.stopPropagation();themeControl.classList.toggle('open');};
    $$('[data-module-theme]',themeMenu).forEach(button=>button.onclick=event=>{event.stopPropagation();pref(m.id).theme=button.dataset.moduleTheme;save();applyPresentation(m,variant,el);themeControl.classList.remove('open');});
    $(':scope > .ns-open-module',el)?.remove();
    if (variant === 'compact') window.NorthstarModulePreview?.bind(el, {
      title: () => el.classList.contains('weather-card') ? el.dataset.moduleId + ' forecast' : name(registry.get(m.id) || m),
      source: () => el.classList.contains('weather-card') ? el.querySelector('.periods') || el : registry.get(m.id)?.el,
      open: () => {
        openModule(m.id);
        if (el.classList.contains('weather-card')) {
          const row = $$('#weatherGridFull .weather-location-row').find(row => row.textContent.includes(el.dataset.moduleId));
          row?.scrollIntoView({block:'center'}); row?.focus({preventScroll:true});
        }
      }
    });
    if(p.customOnly){
      const hidden=new Map();
      [...el.children].filter(node=>!node.matches('.ns-asset-layer,.ns-module-content,.ns-edit-module,.ns-module-theme,.ns-open-module,.ns-window-controls,.ns-section-shell,.canvas-move-handle,.canvas-resize-handle,.ns-popout-edge,script,style')).forEach(node=>{
        hidden.set(node,{value:node.style.getPropertyValue('display'),priority:node.style.getPropertyPriority('display')});node.style.setProperty('display','none','important');
      });
      presentationHidden.set(el,hidden);
    }
    if(variant==='compact')window.NorthstarOverview?.present(m,el,p);
    applyEditableOverrides(m,variant,el);
  }
  function clearMask() {
    masked.forEach((prior,el) => {if(prior.value)el.style.setProperty('display',prior.value,prior.priority);else el.style.removeProperty('display');});
    masked.clear();
    $$('.ns-module-hidden').forEach(el => el.classList.remove('ns-module-hidden'));
    $$('.ns-module-path').forEach(el => el.classList.remove('ns-module-path'));
    $$('.ns-module-window').forEach(el => {
      el.classList.remove('ns-module-window','ns-detached-window');
      if (originals.has(el) && !el.classList.contains('ns-popout-frame')) el.setAttribute('style', originals.get(el));
    });
    $$('.ns-source-section').forEach(el => el.classList.remove('ns-source-section','ns-detached-source'));
  }
  function mask(root, targets) {
    if (targets.includes(root)) return;
    const walk = node => {
      [...node.children].forEach(child => {
        if (child.matches('script,style,link,.ns-window-controls')) return;
        if (targets.includes(child)) return;
        masked.set(child,{value:child.style.getPropertyValue('display'),priority:child.style.getPropertyPriority('display')});
        if (targets.some(target => child.contains(target))) {child.classList.add('ns-module-path');child.style.setProperty('display','contents','important');walk(child);}
        else {child.classList.add('ns-module-hidden');child.style.setProperty('display','none','important');}
      });
    };
    walk(root);
  }
  function paint() {
    if (!shell || painting) return;
    painting = true;
    clearMask();
    const enabled = section !== 'overview';
    shell.hidden = !enabled; document.body.classList.toggle('ns-in-section',enabled);
    const items = sectionItems(section);
    if (!enabled || !items.length) {sectionMenuOpen=false;tree.hidden=true;tree.remove();$$('#sideNav [data-tab]').forEach(b=>{b.removeAttribute('aria-controls');b.removeAttribute('aria-expanded');});painting=false;return;}
    const s = sectionState(section);
    if(s.floating||s.menuCollapsed){s.floating=false;s.menuCollapsed=false;save();}
    document.body.classList.toggle('ns-menu-collapsed',!!s.menuCollapsed);
    tree.hidden=!sectionMenuOpen||!!s.menuCollapsed;
    tree.setAttribute('aria-label',sectionTitle(section)+' modules');
    const sectionButton=$$('#sideNav [data-tab]').find(b=>b.dataset.tab===section);
    $$('#sideNav [data-tab]').forEach(b=>{
      if(b===sectionButton){b.setAttribute('aria-controls','nsSectionModuleMenu');b.setAttribute('aria-expanded',String(!tree.hidden));}
      else{b.removeAttribute('aria-controls');b.removeAttribute('aria-expanded');}
    });
    if(sectionButton&&tree.previousElementSibling!==sectionButton)sectionButton.after(tree);
    s.tabs = (s.tabs || []).filter(id => belongs(registry.get(id),section));
    const landing = items.find(m => m.id === s.landing)?.id || items[0].id;
    if (!s.tabs.length) s.tabs.push(landing);
    if (!s.tabs.includes(s.active)) s.active = s.tabs[0];
    active = s.active;
    s.detached=(s.detached || []).filter(id=>s.tabs.includes(id));
    const docked=s.tabs.filter(id=>!s.detached.includes(id));
    if(!docked.includes(active))active=s.active=docked[0] || '';
    const selected = [...(active?[active]:[]),...s.detached].map(id => registry.get(id));
    const roots = new Map();
    selected.forEach(m => {const root=m.el.closest('.section'); if(root){if(!roots.has(root))roots.set(root,[]);roots.get(root).push(m.el);}});
    $$('.section').forEach(root => {
      root.classList.toggle('active',roots.has(root));
      if (roots.has(root)) {root.classList.add('ns-source-section');root.classList.toggle('ns-detached-source',!active || !root.contains(registry.get(active).el));mask(root, roots.get(root));}
    });
    document.body.classList.toggle('ns-floating',!!s.floating);
    selected.forEach((m,i) => {
      const el=m.el; el.hidden=false;
      if (!originals.has(el)) originals.set(el,el.getAttribute('style') || '');
      el.classList.add('ns-module-window');
      el.dataset.nsTheme = themes.includes(pref(m.id).theme) ? pref(m.id).theme : '';
      el.style.setProperty('--ns-accent',view(m.id,'full').accent || '#63b8df');
      el.style.zIndex=m.id===active?'30':String(10+i);
      if(!el.classList.contains('ns-popout-frame')) [['position','relative'],['left','auto'],['top','auto'],['width','100%'],['height','auto'],['min-width','0'],['min-height','0'],['max-width','none'],['overflow','auto']].forEach(([k,v])=>el.style.setProperty(k,v,'important'));
      if(!el.classList.contains('ns-popout-frame')) bindSectionResize(m,el,section);
    });
    // Feed refreshes repaint modules. Retain navigation nodes so a pressed or
    // focused button survives until its click or keyboard activation completes.
    const nextTreeSignature=JSON.stringify([section,items.map(m=>[m.id,m.parent || '',name(m),state.treeOpen?.[section+':'+m.id]!==false])]);
    if(nextTreeSignature!==treeSignature){
    treeSignature=nextTreeSignature;
    tree.replaceChildren();
    const build = (parent, host, depth=0) => items.filter(m => (m.parent || '') === parent).forEach(m => {
      const children=items.some(child=>(child.parent || '')===m.id);
      const row=document.createElement('div');row.className='ns-tree-row';row.dataset.depth=String(depth);
      if(children){
        const group=document.createElement('div');group.className='ns-tree-group';
        const groupKey=section+':'+m.id,open=state.treeOpen?.[groupKey]!==false;
        const toggle=document.createElement('button');toggle.type='button';toggle.className='ns-tree-toggle';toggle.textContent=open?'▾':'▸';toggle.setAttribute('aria-label',(open?'Collapse ':'Expand ')+name(m));toggle.setAttribute('aria-expanded',String(open));toggle.setAttribute('aria-controls','ns-tree-children-'+m.id);
        toggle.onclick=()=>{state.treeOpen ||= {};state.treeOpen[groupKey]=!open;save();paint();};
        row.append(toggle,moduleButton(m));group.append(row);
        const nested=document.createElement('div');nested.className='ns-tree-children';nested.id='ns-tree-children-'+m.id;nested.hidden=!open;build(m.id,nested,depth+1);group.append(nested);host.append(group);
      }else{row.append(moduleButton(m));host.append(row);}
    });
    const moduleButton = m => {const b=document.createElement('button');b.type='button';b.textContent=name(m);b.className=m.id===active?'active':'';b.dataset.openModule=m.id;b.setAttribute('aria-label',name(m));b.setAttribute('aria-current',m.id===active?'page':'false');b.onclick=()=>openModule(m.id);return b;};
    build('',tree);
    }
    $$('[data-open-module]',tree).forEach(b=>{const selected=b.dataset.openModule===active;b.classList.toggle('active',selected);b.setAttribute('aria-current',selected?'page':'false');});
    const tabHost=active?registry.get(active).el:$('main');
    if(shell.parentElement!==tabHost)tabHost.prepend(shell);
    shell.classList.toggle('ns-empty-dock',!active);
    selected.filter(m=>s.detached.includes(m.id)).forEach(m=>configureDetached(m,s));
    const tabMarkup = docked.map(id=>`<div class="ns-tab" data-tab-id="${esc(id)}"><button type="button" role="tab" aria-selected="${id===active}" data-module-tab="${esc(id)}">${esc(name(registry.get(id)))}</button><button type="button" data-close-module="${esc(id)}" aria-label="Close ${esc(name(registry.get(id)))}">×</button></div>`).join('');
    if(tabs.innerHTML!==tabMarkup)tabs.innerHTML=tabMarkup;
    $$('#sideNav [data-tab]').forEach(b=>b.classList.toggle('active',b.dataset.tab===section));
    painting=false;
  }
  function bindSectionResize(m,el,owner) {
    let controls=$(':scope > .ns-window-controls',el);
    if(!controls){controls=document.createElement('div');controls.className='ns-window-controls';el.append(controls);}
    if(controls.dataset.sectionResize==='1')return;
    controls.dataset.sectionResize='1';
    ['nw','ne','sw','se'].forEach(corner=>{
      const handle=document.createElement('button');handle.type='button';handle.className='ns-window-handle';handle.dataset.corner=corner;
      handle.setAttribute('aria-label','Resize '+name(m)+' '+corner.toUpperCase());
      handle.title='Resize module';controls.append(handle);
      window.NorthstarWindowLayout.bind(el,handle,corner,()=>{
        const box=sectionState(owner).boxes[m.id];
        const rect=el.getBoundingClientRect();
        return box || {x:0,y:0,w:rect.width,h:rect.height};
      },box=>{
        const s=sectionState(owner);s.boxes[m.id]=box;
        el.style.setProperty('--ns-section-module-width',box.w+'px');el.style.setProperty('--ns-section-module-height',box.h+'px');
      },()=>document.body.classList.contains('ns-in-section') && !document.body.classList.contains('ns-floating') && el.isConnected,event=>{
        const s=sectionState(owner);const box=s.boxes[m.id];
        if(event?.type==='pointerup' && box){el.style.setProperty('--ns-section-module-width',box.w+'px');el.style.setProperty('--ns-section-module-height',box.h+'px');}
        save();
      });
    });
  }
  function inTabRow(event) {
    const rect=tabs.getBoundingClientRect();
    return !shell.hidden && event.clientX>=rect.left && event.clientX<=rect.right && event.clientY>=rect.top && event.clientY<=rect.bottom;
  }
  function configureDetached(m,s) {
    const el=m.el,owner=section;el.classList.add('ns-detached-window');s.boxes ||= {};
    s.boxes[m.id] ||= {x:80,y:100,w:640,h:480};
    const set=box=>{
      s.boxes[m.id]=box;
      [['position','fixed'],['left',box.x+'px'],['top',box.y+'px'],['width',box.w+'px'],['height',box.h+'px'],['min-height','0'],['z-index','850']].forEach(([key,value])=>el.style.setProperty(key,value,'important'));
    };
    set(s.boxes[m.id]);
    if($(':scope > .ns-window-controls',el))return;
    const controls=document.createElement('div');controls.className='ns-window-controls';el.append(controls);
    ['move','nw','ne','sw','se'].forEach(corner=>{
      const handle=document.createElement('button');handle.type='button';handle.className='ns-window-handle';handle.dataset.corner=corner;
      handle.textContent=corner==='move'?name(m):'';
      handle.setAttribute('aria-label',corner==='move'?'Move '+name(m)+'; drag into tab row to dock':'Resize '+name(m)+' '+corner);
      controls.append(handle);
      window.NorthstarWindowLayout.bind(el,handle,corner,()=>sectionState(owner).boxes[m.id],box=>{
        sectionState(owner).boxes[m.id]=box;set(box);
      },()=>el.classList.contains('ns-detached-window'),event=>{
        const current=sectionState(owner);
        if(corner==='move' && event?.type==='pointerup' && inTabRow(event)){
          current.detached=current.detached.filter(id=>id!==m.id);current.active=m.id;paint();
        }
        save();
      });
    });
  }
  function activateSource(m) {
    const root=m.el.closest('.section');
    $$('.section').forEach(el=>el.classList.toggle('active',el===root));
    $('.page-header')?.classList.add('section-header-hidden');
    if (m.id.startsWith('markets:') && !['markets:comparison','markets:dispatch'].includes(m.id)) window.NorthstarMarketModules?.render(m.id.slice(8),m.el);
    const pane=m.el.dataset.outagePane;
    if (pane) $(`[data-outage-tab="${CSS.escape(pane)}"]`)?.click();
  }
  function openModule(id) {
    if (/^outages:(switching-|one-line-editor|engineering-sitemap)/.test(id)) {
      const legacy = $('#uwpcLegacyTools'); if (legacy) legacy.open = true;
      id = 'outages:uwpc';
    }
    const m=registry.get(id);if(!m)return;
    if(!belongs(m,section))section=m.section;sectionMenuOpen=section!=='overview';const s=sectionState(section);s.tabs ||= [];
    if(!s.tabs.includes(id))s.tabs.push(id);s.active=id;
    activateSource(m);paint();save();rememberSection(section);window.scrollTo(0,0);
  }
  function popOutModule(id) {
    const m=registry.get(id);if(!m)return;
    const url=new URL(location.href);
    url.searchParams.set('nsModuleWindow',id);
    url.hash=m.section;
    const name='northstar-module-'+id.replace(/[^a-z0-9_-]/gi,'-');
    const popup=window.open(url.href,name,'popup=yes,width=1200,height=850,resizable=yes,scrollbars=yes');
    if(!popup)window.alert('Allow pop-up windows for NorthStar, then try again.');
    else window.dispatchEvent(new CustomEvent('northstar:module-popout',{detail:{id,popup}}));
  }
  function showModulePopout(id) {
    const m=registry.get(id);if(!m)return;
    section=m.section;sectionMenuOpen=false;
    const s=sectionState(section);s.tabs ||= [];
    s.tabs=[id];s.active=id;s.floating=false;s.detached=[];
    document.body.classList.add('ns-module-popout');
    activateSource(m);paint();
    document.title=name(m)+' · NorthStar';
    if(document.querySelector('.ns-popout-toolbar'))return;
    const toolbar=document.createElement('div');toolbar.className='ns-popout-toolbar';
    toolbar.setAttribute('role','toolbar');toolbar.setAttribute('aria-label','Module window');
    toolbar.innerHTML=`<strong>${esc(name(m))}</strong><button type="button" data-window-action="minimize" aria-label="Minimize">−</button><button type="button" data-window-action="maximize" aria-label="Maximize">□</button><button type="button" data-window-action="close" aria-label="Close">×</button>`;
    document.body.append(toolbar);
    toolbar.addEventListener('click',event=>{
      const button=event.target.closest('[data-window-action]');if(!button)return;
      const action=button.dataset.windowAction;
      if(window.northstarModuleWindow){window.northstarModuleWindow.control(action);return;}
      if(action==='close'){window.close();return;}
      // Browsers do not expose native OS minimize; keep a visible restore control.
      const minimized=document.body.classList.toggle('ns-popout-minimized',action==='minimize' && !document.body.classList.contains('ns-popout-minimized'));
      toolbar.querySelector('[data-window-action="minimize"]').setAttribute('aria-label',minimized?'Restore':'Minimize');
      if(action==='maximize'){
        const maximized=document.body.classList.toggle('ns-popout-maximized');
        if(maximized){restoreBox={...box};set({x:0,y:40,w:innerWidth,h:innerHeight-40});}
        else if(restoreBox)set(restoreBox);
        button.setAttribute('aria-label',maximized?'Restore size':'Maximize');
      }
    });
    const frame=m.el;frame.classList.add('ns-popout-frame');
    let box={x:8,y:48,w:Math.max(240,innerWidth-16),h:Math.max(120,innerHeight-56)};
    let restoreBox;
    const set=value=>{box=value;Object.entries({left:box.x+'px',top:box.y+'px',width:box.w+'px',height:box.h+'px'}).forEach(([key,value])=>frame.style.setProperty(key,value,'important'));};set(box);
    ['n','e','s','w','nw','ne','sw','se'].forEach(edge=>{
      const handle=document.createElement('button');handle.type='button';handle.className='ns-popout-edge';handle.dataset.edge=edge;handle.setAttribute('aria-label','Resize '+edge.toUpperCase());frame.append(handle);
      window.NorthstarWindowLayout.bind(frame,handle,edge,()=>box,set,()=>!document.body.matches('.ns-popout-minimized,.ns-popout-maximized'),()=>{});
    });
    window.addEventListener('resize',()=>set(document.body.classList.contains('ns-popout-maximized')?{x:0,y:40,w:innerWidth,h:innerHeight-40}:{...box,x:Math.min(box.x,Math.max(0,innerWidth-240)),y:48,w:Math.max(240,Math.min(box.w,innerWidth-16)),h:Math.max(120,Math.min(box.h,innerHeight-56))}));
  }
  function rememberSection(id) {
    const url = new URL(location.href);url.hash = id;
    if(url.href !== location.href)history.replaceState(history.state,'',url.href);
  }
  function enter(id) {
    rememberSection(id);
    const nextSection=ownerSection(id);
    section=nextSection;
    if (section==='overview') {sectionMenuOpen=false;clearMask();tree.hidden=true;tree.remove();$('main').prepend(shell);document.body.classList.remove('ns-in-section','ns-floating','ns-menu-collapsed');shell.hidden=true;return;}
    discover();const s=sectionState(section), items=sectionItems(section);
    s.floating=false;
    const landing=belongs(registry.get(s.landing),section)?s.landing:items[0]?.id;
    const target=id==='modules'?'tools:module-editor':mergedSections[id]?(items.find(m=>m.sourceSection===id)?.id || landing):landing;
    if(target)openModule(target);
  }
  function renderEditorParts(m, variant, p) {
    const root=variant==='full'?m.el:m.compact[0], list=$('.ns-editor-part-list',editor);
    list.replaceChildren();
    const parts=editableParts(root), summary=$('[data-editor-parts-summary]',editor);
    summary.textContent=parts.length?'Editable parts ('+parts.length+')':'Editable parts';
    if(!parts.length){list.textContent='No editable text, controls, input hints, or images are available in this presentation yet.';return;}
    parts.forEach(part=>{
      const row=document.createElement('div');row.className='ns-editor-part';
      row.dataset.editorPartKey=part.key;row.dataset.editorPartKind=part.kind;row.dataset.editorLegacy=part.selector || '';
      const field=document.createElement('label');field.className='ns-editor-part-field';
      const meta=document.createElement('span');meta.className='ns-editor-part-meta';
      const name=document.createElement('strong');name.textContent=part.kind==='image'?'Image':part.value || part.label;
      const detail=document.createElement('small');detail.textContent=part.kind==='image'?'Image path and description':part.label+(part.live?' · connected':'');
      meta.append(name,detail);field.append(meta);
      const prior=p.elements?.[part.key] || {};
      if(part.kind==='image'){
        const fields=document.createElement('div');fields.className='ns-editor-image-fields';
        const src=document.createElement('input');src.type='text';src.setAttribute('aria-label','Image path');src.dataset.editorImageSrc='';src.value=owns(prior,'src')?prior.src:part.src;src.dataset.editorInitial=src.value;
        const alt=document.createElement('input');alt.type='text';alt.setAttribute('aria-label','Image description');alt.dataset.editorImageAlt='';alt.value=owns(prior,'alt')?prior.alt:part.alt;alt.dataset.editorInitial=alt.value;
        fields.append(src,alt);field.append(fields);
      }else{
        const value=owns(prior,'value')?prior.value:(owns(p.labels,part.selector)?p.labels[part.selector]:part.value);
        const control=document.createElement(value.length>120?'textarea':'input');if(control.tagName==='TEXTAREA')control.rows=2;else control.type='text';control.dataset.editorPartValue='';control.value=value;control.dataset.editorInitial=value;control.setAttribute('aria-label',part.label);
        field.append(control);
      }
      row.append(field);
      const restore=document.createElement('button');restore.type='button';restore.dataset.editorRestore='';restore.textContent='Restore';restore.setAttribute('aria-label','Restore '+part.label);
      restore.onclick=()=>{row.dataset.editorRestore='true';row.classList.add('ns-editor-part-restored');restore.textContent='Will restore';};row.append(restore);list.append(row);
    });
  }
  function renderCustomPlacement(m) {
    const placement=$('[data-custom-placement]',editor), form=$('form',editor), module=pref(m.id);
    placement.hidden=!module.custom;if(!module.custom)return;
    const sectionInput=form.elements.moduleSection,parentInput=form.elements.moduleParent;
    const owners=[...new Set([...registry.values()].map(item=>item.section))].sort((a,b)=>sectionTitle(a).localeCompare(sectionTitle(b)));
    sectionInput.innerHTML=owners.map(owner=>`<option value="${esc(owner)}">${esc(sectionTitle(owner))}</option>`).join('');
    sectionInput.value=module.section || m.section;
    let selectedParent=module.parent || '';
    const updateParents=()=>{
      parentInput.innerHTML='<option value="">No parent module</option>'+[...registry.values()].filter(item=>item.section===sectionInput.value && item.id!==m.id).sort((a,b)=>name(a).localeCompare(name(b))).map(item=>`<option value="${esc(item.id)}">${esc(name(item))}</option>`).join('');
      parentInput.value=selectedParent;
    };
    sectionInput.onchange=()=>{selectedParent='';updateParents();};updateParents();
  }
  function openEditor(id, variant='full', keepDraft=false) {
    const m=registry.get(id);if(!m)return;
    if(!keepDraft)editorDrafts={};
    editor.dataset.module=id;editor.dataset.variant=variant;
    const p=editorDrafts[variant] || view(id,variant), form=$('form',editor);
    form.elements.modulePicker.innerHTML=[...registry.values()].sort((a,b)=>(sectionTitle(a.section)+' '+name(a)).localeCompare(sectionTitle(b.section)+' '+name(b))).map(item=>`<option value="${esc(item.id)}">${esc(sectionTitle(item.section))} / ${esc(name(item))}</option>`).join('');
    form.elements.modulePicker.value=id;
    form.elements.moduleName.value=name(m);form.elements.variant.value=variant;form.elements.title.value=p.title || '';
    form.elements.notes.value=p.notes || '';form.elements.accent.value=p.accent || '#63b8df';form.elements.density.value=p.density || 'normal';
    form.elements.pin.checked=pref(id).overviewVisible !== false && (!!pref(id).pin || m.compact.length>0);
    form.elements.customOnly.checked=!!p.customOnly;
    renderEditorParts(m,variant,p);renderCustomPlacement(m);
    $('.ns-block-list',editor).replaceChildren();(p.blocks || []).forEach(block=>appendBlock(block));
    $('.ns-editor-status',editor).textContent='Text and images are saved with this presentation. Data blocks remain linked to their selected source.';
    if(!editor.open)editor.showModal();
  }
  function appendBlock(block={}) {
    const row=document.createElement('div');row.className='ns-block-editor';
    const sources=$$('[id]').filter(el=>!el.children.length && !el.closest('#nsModuleEditor,nav,.ns-section-shell,script,style') && /^(B|STRONG|SPAN|OUTPUT|DIV)$/.test(el.tagName)).map(el=>el.id);
    row.innerHTML=`<label>Label<input data-block-label value="${esc(block.label || '')}"></label><label>Data tag<select data-block-source><option value="">Text content</option>${[...new Set(sources.concat(block.source || []))].map(id=>`<option value="${esc(id)}">${esc(id)}</option>`).join('')}</select></label><label>Text<input data-block-text value="${esc(block.text || '')}"></label><button type="button" data-block-up aria-label="Move content up">↑</button><button type="button" data-block-remove aria-label="Remove content">×</button>`;
    $('[data-block-source]',row).value=block.source || '';
    $('[data-block-up]',row).onclick=()=>{if(row.previousElementSibling)row.previousElementSibling.before(row);};
    $('[data-block-remove]',row).onclick=()=>row.remove();$('.ns-block-list',editor).append(row);
  }
  function createEditor() {
    editor=document.createElement('dialog');editor.id='nsModuleEditor';
    editor.innerHTML=`<form><header><div><h2>Module editor</h2><label class="ns-module-picker">Selected module<select name="modulePicker" aria-label="Select module"></select></label></div><button type="button" data-editor-close aria-label="Close editor">×</button></header><div class="ns-editor-grid"><label>Module name · linked across views<input name="moduleName" required maxlength="100"></label><label>Presentation<select name="variant"><option value="full">Section full page</option><option value="compact">Overview display</option></select></label><label>Presentation title<input name="title" maxlength="120"></label><label>Accent<input type="color" name="accent"></label><label>Spacing<select name="density"><option value="normal">Normal</option><option value="compact">Compact</option></select></label><label class="ns-check"><input type="checkbox" name="pin">Show on Overview</label></div><label>Content / notes<textarea name="notes" rows="3"></textarea></label><section class="ns-custom-placement" data-custom-placement hidden><h3>Module location</h3><div class="ns-editor-grid"><label>Section<select name="moduleSection"></select></label><label>Parent module<select name="moduleParent"></select></label></div></section><details><summary data-editor-parts-summary>Editable parts</summary><p class="ns-editor-help">Edit every visible label, text value, control label, input hint, and image in this presentation. Use Restore to return a part to its source content.</p><div class="ns-editor-part-list ns-field-list"></div></details><h3>Content and data tags</h3><div class="ns-block-list"></div><button type="button" data-add-block>+ Add content</button><p class="ns-editor-status" role="status"></p><footer><button type="button" data-editor-close>Cancel</button><button type="submit">Save module</button></footer></form>`;
    document.body.append(editor);
    const customOnly=document.createElement('label');customOnly.className='ns-check';
    customOnly.innerHTML='<input type="checkbox" name="customOnly"> Display only my content and data blocks';
    $('.ns-editor-grid',editor).append(customOnly);
    $$('[data-editor-close]',editor).forEach(b=>b.onclick=()=>editor.close());
    $('[data-add-block]',editor).onclick=()=>appendBlock();
    const form=$('form',editor);
    const collect=()=>{
      const prior=editorDrafts[editor.dataset.variant] || view(editor.dataset.module,editor.dataset.variant);
      const labels={...(prior.labels || {})},elements=Object.fromEntries(Object.entries(prior.elements || {}).map(([key,value])=>[key,{...value}]));
      $$('.ns-editor-part',editor).forEach(row=>{
        const key=row.dataset.editorPartKey,legacy=row.dataset.editorLegacy;
        if(row.dataset.editorRestore==='true'){delete elements[key];if(legacy)delete labels[legacy];return;}
        if(row.dataset.editorPartKind==='image'){
          const src=$('[data-editor-image-src]',row),alt=$('[data-editor-image-alt]',row);
          if(src.value!==src.dataset.editorInitial || alt.value!==alt.dataset.editorInitial)elements[key]={...(elements[key] || {}),src:src.value,alt:alt.value};
        }else{
          const control=$('[data-editor-part-value]',row);
          if(control.value!==control.dataset.editorInitial)elements[key]={...(elements[key] || {}),value:control.value};
        }
      });
      return {title:form.elements.title.value,notes:form.elements.notes.value,accent:form.elements.accent.value,density:form.elements.density.value,customOnly:form.elements.customOnly.checked,labels,elements,
        blocks:$$('.ns-block-editor',editor).map(row=>({label:$('[data-block-label]',row).value,source:$('[data-block-source]',row).value,text:$('[data-block-text]',row).value}))};
    };
    form.elements.variant.onchange=()=>{
      const moduleName=form.elements.moduleName.value,pin=form.elements.pin.checked;
      editorDrafts[editor.dataset.variant]=collect();openEditor(editor.dataset.module,form.elements.variant.value,true);
      form.elements.moduleName.value=moduleName;form.elements.pin.checked=pin;
    };
    form.elements.modulePicker.onchange=()=>openEditor(form.elements.modulePicker.value,form.elements.variant.value);
    form.onsubmit=event=>{
      event.preventDefault();const id=editor.dataset.module, variant=editor.dataset.variant, p=view(id,variant);
      pref(id).name=form.elements.moduleName.value.trim();pref(id).pin=form.elements.pin.checked;pref(id).overviewVisible=form.elements.pin.checked;
      if(pref(id).custom){pref(id).section=form.elements.moduleSection.value;pref(id).parent=form.elements.moduleParent.value;}
      editorDrafts[variant]=collect();Object.entries(editorDrafts).forEach(([key,value])=>Object.assign(view(id,key),value));
      save();renderCatalog();discover();paint();editor.close();
    };
  }
  function renderCatalog() {
    const root=$('#modules');if(!root)return;
    let catalog=$('.ns-catalog',root);
    if(!catalog){root.replaceChildren();catalog=document.createElement('div');catalog.className='ns-catalog';root.append(catalog);}
    const owners=[...new Set([...registry.values()].map(m=>m.section))];
    catalog.innerHTML=`<h2>Modules</h2><p>Choose any module to edit its section page, Overview display, text, controls, images, and data tags.</p><div class="ns-create"><label>New module name<input id="nsNewName" maxlength="100"></label><label>Section<select id="nsNewSection">${owners.map(id=>`<option value="${esc(id)}">${esc(sectionTitle(id))}</option>`).join('')}</select></label><label>Parent module<select id="nsNewParent"><option value="">None</option></select></label><button type="button" id="nsCreateModule">Create module</button></div><div class="ns-catalog-list">${[...registry.values()].map(m=>`<article><div><small>${esc(sectionTitle(m.section))}${m.parent?' / '+esc(name(registry.get(m.parent) || {id:m.parent,title:m.parent})):''}</small><h3>${esc(name(m))}</h3></div><button data-catalog-open="${esc(m.id)}">Open</button><button data-catalog-edit="${esc(m.id)}" data-variant="full">Edit full page</button><button data-catalog-edit="${esc(m.id)}" data-variant="compact">Edit Overview</button></article>`).join('')}</div>`;
    const updateParents=()=>{$('#nsNewParent').innerHTML='<option value="">None</option>'+[...registry.values()].filter(m=>m.section===$('#nsNewSection').value).map(m=>`<option value="${esc(m.id)}">${esc(name(m))}</option>`).join('');};
    $('#nsNewSection').onchange=updateParents;updateParents();
    $('#nsCreateModule').onclick=()=>{
      const title=$('#nsNewName').value.trim();if(!title){$('#nsNewName').focus();return;}
      const id='custom:'+crypto.randomUUID();state.modules[id]={custom:true,name:title,section:$('#nsNewSection').value,parent:$('#nsNewParent').value,full:{},compact:{},pin:true};
      save();discover();renderCatalog();openEditor(id);
    };
    $$('[data-catalog-open]',catalog).forEach(b=>b.onclick=()=>openModule(b.dataset.catalogOpen));
    $$('[data-catalog-edit]',catalog).forEach(b=>b.onclick=()=>openEditor(b.dataset.catalogEdit,b.dataset.variant));
  }
  function ensureFilesSection(main) {
    if ($('#files')) return;
    const section=document.createElement('section');
    section.id='files';section.className='section';
    section.innerHTML='<div class="panel files-workspace" data-module-id="sharepoint-files"><label>CONTROLLED FILES</label><h2>Files</h2><p class="muted-note">SharePoint-backed reference files will appear here after the approved site and document library are connected.</p><div class="files-connection-status" role="status"><span>SHAREPOINT CONNECTION</span><strong>NOT CONNECTED</strong></div><div class="files-workspace-grid"><article><h3>Ready to connect</h3><p>Connection setup requires the SharePoint site, document library, and approved Microsoft identity configuration.</p></article><article><h3>Access scope</h3><p>Files are intended for read-only reference. This section does not grant control or operating authority.</p></article></div></div>';
    main.append(section);
  }
  function init() {
    const main=$('main');if(!main)return;
    ensureFilesSection(main);
    shell=document.createElement('div');shell.className='ns-section-shell';shell.hidden=true;
    shell.innerHTML='<div class="ns-section-top"><div class="ns-module-tabs" role="tablist" aria-label="Open module pages"></div></div>';
    tree=document.createElement('div');tree.id='nsSectionModuleMenu';tree.className='ns-module-tree';tree.setAttribute('role','group');tree.setAttribute('aria-label','Section modules');tree.hidden=true;
    main.prepend(shell);tabs=$('.ns-module-tabs',shell);
    createEditor();discover();renderCatalog();discover();
    // Keep legacy module IDs and source roots; merge only their navigation owners.
    if(!state.sectionMergeV1){
      Object.entries(mergedSections).forEach(([from,to])=>{
        const prior=state.sections[from];if(!prior)return;
        const target=sectionState(to);
        target.tabs=[...new Set([...(target.tabs || []),...(prior.tabs || [])])].filter(id=>belongs(registry.get(id),to));
        target.boxes={...(prior.boxes || {}),...(target.boxes || {})};
        if(!target.landing && belongs(registry.get(prior.landing),to))target.landing=prior.landing;
        if(!target.active && belongs(registry.get(prior.active),to))target.active=prior.active;
      });
      state.sectionMergeV1=true;save();
    }
    if(!state.sectionMergeV2){
      ['field-operations','unit-cycling','service-requests'].forEach(from=>{
        const prior=state.sections[from];if(!prior)return;
        const target=sectionState('operations');
        target.tabs=[...new Set([...(target.tabs || []),...(prior.tabs || [])])].filter(id=>belongs(registry.get(id),'operations'));
        target.boxes={...(prior.boxes || {}),...(target.boxes || {})};
        if(!target.landing&&belongs(registry.get(prior.landing),'operations'))target.landing=prior.landing;
        if(!target.active&&belongs(registry.get(prior.active),'operations'))target.active=prior.active;
      });
      state.sectionMergeV2=true;save();
    }
    $$('#sideNav [data-tab]').forEach(button=>{
      if(mergedSections[button.dataset.tab]){button.dataset.nsMerged='true';button.hidden=true;}
    });
    try{if(!localStorage.getItem(KEY+'Saved'))localStorage.setItem(KEY+'Saved',JSON.stringify(state));}catch{}
    window.addEventListener('resize',()=>paint());
    let suppressTabClick=false;
    tabs.addEventListener('pointerdown',event=>{
      const tab=event.target.closest('.ns-tab');
      if(!tab || event.button!==0 || event.target.closest('[data-close-module]'))return;
      event.preventDefault();
      const id=tab.dataset.tabId,x=event.clientX,y=event.clientY;
      let moved=false;
      tabs.setPointerCapture(event.pointerId);
      const move=e=>{if(Math.hypot(e.clientX-x,e.clientY-y)>6){moved=true;tab.classList.add('ns-tab-dragging');}};
      const finish=e=>{
        tabs.removeEventListener('pointermove',move);
        ['pointerup','pointercancel','lostpointercapture'].forEach(type=>tabs.removeEventListener(type,finish));
        if(tabs.hasPointerCapture(event.pointerId))tabs.releasePointerCapture(event.pointerId);
        tab.classList.remove('ns-tab-dragging');
        if(e.type!=='pointerup')return;
        if(!moved){openModule(id);return;}
        suppressTabClick=true;setTimeout(()=>suppressTabClick=false,0);
        const s=sectionState(section);
        if(inTabRow(e)){
          const target=[...tabs.children].find(node=>e.clientX<node.getBoundingClientRect().right);
          const order=s.tabs.filter(key=>key!==id),index=target?order.indexOf(target.dataset.tabId):-1;
          if(target?.dataset.tabId!==id){order.splice(index<0?order.length:index,0,id);s.tabs=order;}
        }else{
          s.detached ||= [];s.detached.push(id);s.boxes ||= {};
          s.boxes[id]={x:Math.max(0,e.clientX-80),y:Math.max(0,e.clientY-12),w:Math.min(680,innerWidth-24),h:Math.min(520,innerHeight-48)};
        }
        paint();save();
      };
      tabs.addEventListener('pointermove',move);
      ['pointerup','pointercancel','lostpointercapture'].forEach(type=>tabs.addEventListener(type,finish));
    });
    tabs.onclick=event=>{
      if(suppressTabClick){event.preventDefault();return;}
      const open=event.target.closest('[data-module-tab]'),close=event.target.closest('[data-close-module]');
      if(open)openModule(open.dataset.moduleTab);
      if(close){const s=sectionState(section);s.tabs=s.tabs.filter(id=>id!==close.dataset.closeModule);if(s.active===close.dataset.closeModule)s.active=s.tabs.at(-1) || '';paint();save();}
    };
    // Existing nav handlers still run their feed-specific entry actions.
    $$('#sideNav [data-tab]').forEach(b=>b.addEventListener('click',()=>{
      const id=b.dataset.tab;
      const nextSection=ownerSection(id);
      if(nextSection===section&&nextSection!=='overview'){
        sectionMenuOpen=!sectionMenuOpen;
        const s=sectionState(section);s.menuCollapsed=false;paint();save();return;
      }
      sectionMenuOpen=nextSection!=='overview';
      enter(id);const s=sectionState(section);s.menuCollapsed=false;paint();save();
    }));
    document.addEventListener('click',event=>{
      if(window.NorthstarAssetEditor?.active())return;
      if(!document.body.classList.contains('layout-edit') || event.target.closest('button,a,input,select,textarea,dialog,.ns-window-handle'))return;
      const el=event.target.closest('[data-ns-compact],[data-ns-module]');
      if(el){event.preventDefault();event.stopPropagation();openEditor(el.dataset.nsCompact || el.dataset.nsModule,el.dataset.nsCompact?'compact':'full');}
    },true);
    document.addEventListener('keydown',event=>{
      if(event.key==='Enter' && document.body.classList.contains('layout-edit') && event.target.matches('[data-ns-compact]')){
        event.preventDefault();openEditor(event.target.dataset.nsCompact,'compact');
      }
    });
    $('.layout-save')?.addEventListener('click',()=>{save();try{localStorage.setItem(KEY+'Saved',JSON.stringify(state));}catch{}});
    $('.overview-add-module')?.addEventListener('click',()=>$('#nsNewName')?.focus());
    const schedule=()=>{if(!frame)frame=requestAnimationFrame(()=>{frame=0;observer.disconnect();discover();paint();observer.observe(main,{subtree:true,childList:true});});};
    const observer=new MutationObserver(schedule);observer.observe(main,{subtree:true,childList:true});
    const createCanvas = (title, owner='tools') => {
      if(!title?.trim() || !document.getElementById(owner))return null;
      const id='custom:'+crypto.randomUUID();
      state.modules[id]={custom:true,name:title.trim().slice(0,100),section:owner,parent:'',pin:true,
        full:{customOnly:true,assetCanvas:true},compact:{customOnly:true,assetCanvas:true}};
      save();discover();renderCatalog();openModule(id);return registry.get(id);
    };
    const deleteCanvas = id => {
      const meta=state.modules[id];if(!meta?.custom || !registry.has(id))return false;
      const module=registry.get(id),owner=ownerSection(meta.section),section=sectionState(owner);
      const assetKey='northstarAssetEditorV1';let assets={};try{assets=JSON.parse(localStorage.getItem(assetKey)||'{}')||{};}catch{}
      if(assets.roots){delete assets.roots['full:'+id+':'];delete assets.roots['compact:'+id+':'];try{localStorage.setItem(assetKey,JSON.stringify(assets));}catch{}}
      delete state.modules[id];
      section.detached=(section.detached||[]).filter(value=>value!==id);if(section.boxes)delete section.boxes[id];
      module.el.remove();registry.delete(id);save();discover();renderCatalog();return true;
    };
    const movementHandle = el => {
      const m=registry.get(el.dataset.nsModule);
      if(!m || m.el!==el || !el.classList.contains('ns-module-window'))return null;
      const s=sectionState(section);
      if(!(s.detached || []).includes(m.id)){
        const box=el.getBoundingClientRect();
        s.detached ||= [];s.detached.push(m.id);s.boxes ||= {};
        s.boxes[m.id]={x:box.x,y:box.y,w:Math.min(box.width,innerWidth-16),h:Math.min(box.height,Math.max(100,innerHeight-box.y-16))};
        paint();save();
      }
      return el.querySelector(':scope > .ns-window-controls [data-corner="move"]');
    };
    const fitSize=(id,variant,width,height)=>{
      const module=registry.get(id);if(!module)return false;
      const owner=ownerSection(module.section),section=sectionState(owner),el=module.el;
      if(el.classList.contains('ns-detached-window')){
        section.boxes ||= {};const box=section.boxes[id] || {x:80,y:100,w:el.getBoundingClientRect().width,h:el.getBoundingClientRect().height};
        section.boxes[id]={...box,w:width,h:height};el.style.setProperty('width',width+'px','important');el.style.setProperty('height',height+'px','important');
      }else{
        const box=section.boxes?.[id];if(box){section.boxes[id]={...box,w:width,h:height};}
        el.style.setProperty('--ns-section-module-width',width+'px');el.style.setProperty('--ns-section-module-height',height+'px');
      }
      save();return true;
    };
    window.NorthstarModules={open:openModule,popOut:popOutModule,edit:openEditor,refresh:schedule,registry,state,createCanvas,deleteCanvas,movementHandle,fitSize};
    const restoreSection=()=>{
      const id=location.hash.slice(1);
      const button=$$('#sideNav [data-tab]').find(b=>b.dataset.tab===ownerSection(id));
      if(button)button.click();
      else enter($('#sideNav [data-tab].active')?.dataset.tab || 'overview');
    };
    window.addEventListener('hashchange',restoreSection);
    if(detachedId)showModulePopout(detachedId);
    else restoreSection();
  }
  // After legacy DOMContentLoaded bootstraps have completed.
  const start=()=>{if(window.northstarStylesReady)window.northstarStylesReady.then(()=>setTimeout(init,0));else setTimeout(init,0);};
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start);else start();
})();
