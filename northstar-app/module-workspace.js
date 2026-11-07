/* Module identity, navigation and presentation. Geometry lives in module-layout.js.
 * Keep feed-owned elements in place: hide ancestor siblings instead of moving or
 * cloning live controls. Full and compact presentations share one module record.
 */
window.NORTHSTAR_MODULE_WORKSPACE = true;
Promise.all([window.northstarLayoutReady, window.northstarOperatorSession]).then(() => {
  'use strict';
  const KEY = 'northstarModuleWorkspaceV1';
  const detachedId = new URLSearchParams(location.search).get('nsModuleWindow');
  const read = key => { try { const value = JSON.parse(localStorage.getItem(key) || '{}'); return value && typeof value === 'object' && !Array.isArray(value) ? value : {}; } catch { return {}; } };
  const savedState = read(KEY);
  const sharedState = window.NORTHSTAR_LAYOUT_DEFAULT?.moduleWorkspace;
  const initialState = Object.keys(savedState.sections || {}).length || Object.keys(savedState.modules || {}).length ? savedState : sharedState || savedState;
  const state = Object.assign({sections:{}, modules:{}}, initialState);
  state.sections ||= {}; state.modules ||= {};
  if (sharedState && initialState === sharedState) { try { localStorage.setItem(KEY, JSON.stringify(sharedState)); } catch {} }
  let publishTimer = 0;
  function publishWorkspace() {
    if (window.NorthstarLayoutPersistence || detachedId || !window.northstarOperatorSession) return;
    clearTimeout(publishTimer);
    publishTimer = setTimeout(() => {
      Promise.resolve(window.northstarOperatorSession).then(account => {
        const owner = window.NORTHSTAR_LAYOUT_DEFAULT?.moduleWorkspaceOwner;
        if (!owner || String(account?.username || '').toLowerCase() !== String(owner).toLowerCase()) return;
        return fetch('/api/dashboard-layout-default', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ moduleWorkspace: state }),
        });
      }).catch(() => {});
    }, 400);
  }
  const registry = new Map(), originals = new WeakMap(), masked = new Map(), presentationHidden = new WeakMap();
  const $ = (s, root = document) => root.querySelector(s);
  const $$ = (s, root = document) => [...root.querySelectorAll(s)];
  const esc = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const label = el => {
    const heading=$('h1,h2,h3,header strong',el)?.cloneNode(true);
    heading?.querySelectorAll('.ns-tools-toggle').forEach(node=>node.remove());
    return (heading?.textContent || el.getAttribute('aria-label') || el.dataset.moduleId || el.id || 'Module').trim().replace(/[-_]/g,' ');
  };
  let section = 'overview', active = '', shell, tree, editor, frame = 0, painting = false, sectionMenuOpen = false, treeSignature = '';
  let editorDrafts = {};
  function save() {
    if (detachedId) return; // A display window must not overwrite the main workspace.
    try { localStorage.setItem(KEY, JSON.stringify(state)); publishWorkspace(); }
    catch { if (editor) $('.ns-editor-status', editor).textContent = 'Changes could not be saved in this browser.'; }
  }
  const pref = id => state.modules[id] ||= {full:{}, compact:{}};
  const themes = ['default','shopify','arctic','signal','midnight','forest','violet','graphite','contrast','stallion'];
  const themeNames = {default:'NORTHSTAR DEFAULT',shopify:'SHOPIFY DARK',arctic:'ARCTIC BLUE',signal:'SIGNAL ORANGE',midnight:'MIDNIGHT STEEL',forest:'FOREST OPS',violet:'VIOLET NIGHT',graphite:'GRAPHITE',contrast:'HIGH CONTRAST',stallion:'STALLION TRIAL'};
  const view = (id, variant) => pref(id)[variant] ||= {};
  const sectionState = id => state.sections[id] ||= {tabs:[], active:'', landing:'', floating:false, boxes:{}};
  const name = m => pref(m.id).name || m.title;
  const mergedSections = {
    ...(window.NORTHSTAR_PLATFORM_DEMO ? {} : {flows:'tools'}),
    modules:'tools',training:'tools',scada:'switching',
    'field-operations':'operations','unit-cycling':'operations','service-requests':'operations'
  };
  const ownerSection = id => mergedSections[id] || id;
  const sectionTitle = id => ({switching:'Engineering',logbook:'Events',tools:'Tools',files:'Files',crew:'Crew check-ins',mobile:'Field tracker',operations:'Operations'}[id] || id.replace(/-/g,' '));
  const belongs = (m,owner) => m && (m.section===owner || (owner==='switching' && (m.id==='outages:uwpc' || m.parent==='outages:uwpc')));
  const demoToolIds = new Set(['outages:uwpc','tools:schematic-builder','tools:data-connections']);
  const demoModuleAllowed = m => {
    if (!m) return false;
    if (m.section === 'operations') return m.id === 'operations:sites' || m.id === 'operations:dispatch' || m.id === 'operations:tasks' || m.id === 'operations:research' || m.id === 'operations:spill' || m.id.startsWith('operations:spill:') || m.id.startsWith('operations:site:');
    if (m.section === 'tools') return demoToolIds.has(m.id);
    return !['switching','outages','games'].includes(m.section);
  };
  function restrictedInSession(m) {
    if (window.NORTHSTAR_PLATFORM_DEMO) return !demoModuleAllowed(m);
    if (!window.NORTHSTAR_RYAN_VIEW) return false;
    if (belongs(m, 'switching') || m?.id === 'training:switching-simulator') return false;
    return !demoModuleAllowed(m);
  }
  const sectionItems = owner => [...registry.values()]
    .filter(m=>belongs(m,owner))
    .filter(m=>!window.NORTHSTAR_PLATFORM_DEMO || demoModuleAllowed(m))
    .sort((a,b)=>Number(a.sourceSection!==owner)-Number(b.sourceSection!==owner));
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
    if (weatherRoot) {
      const names = typeof places !== 'undefined' ? places.map(p => p[0]) : [];
      names.forEach(title => {
        const id = 'weather:location:' + title.toLowerCase().replace(/[^a-z0-9]+/g, '-');
        let el = document.getElementById(id);
        if (!el) {
          el = document.createElement('div'); el.id = id; el.className = 'weather-location-module'; el.hidden = true;
          const frame = document.createElement('iframe'); frame.title = title + ' weather and river data';
          frame.dataset.locationSrc = 'weather-location.html?v=20261002-3&site=' + encodeURIComponent(title) + '&embedded=1';
          el.append(frame); weatherRoot.closest('.section').append(el);
        }
        register(id, title, 'weather', el, 'weather:locations');
      });
      const weather = sectionState('weather');
      if (!weather.weatherRowsLandingV2) {
        weather.landing = 'weather:locations';
        weather.active = 'weather:locations';
        weather.tabs = ['weather:locations'];
        weather.weatherRowsLandingV2 = true;
        save();
      }
      if (!weatherRoot.dataset.locationNavigation) {
        weatherRoot.dataset.locationNavigation = 'true';
        const openLocation = event => {
          if (document.body.classList.contains('layout-edit') || (event.type === 'keydown' && !['Enter',' '].includes(event.key))) return;
          const card = event.target.closest('.weather-card,.weather-module-card'); if (!card) return;
          const control = event.target.closest('button,a,input,select');
          if (control && !control.matches('[data-weather],.weather-module-card')) return;
          const title = card.dataset.moduleId || card.dataset.weather;
          const id = 'weather:location:' + (title || '').toLowerCase().replace(/[^a-z0-9]+/g, '-');
          if (!registry.has(id)) return;
          event.preventDefault(); event.stopImmediatePropagation(); openModule(id);
        };
        weatherRoot.addEventListener('click', openLocation, true);
        weatherRoot.addEventListener('keydown', openLocation, true);
      }
    }
    const sitesRoot = $('#operationsSites');
    if (sitesRoot) {
      register('operations:sites', 'Sites', 'operations', sitesRoot);
      register('operations:spill', 'Spill', 'operations', $('#spillHome'));
      register('operations:spill:raft-lake', 'Raft Lake', 'operations', $('#spillRaftLake'), 'operations:spill');
      register('operations:spill:namakan-lake', 'Namakan Lake', 'operations', $('#spillNamakanLake'), 'operations:spill');
      register('operations:spill:sluice-gates', 'Sluice Gates', 'operations', $('#spillSluiceGates'), 'operations:spill');
      $$('.gs-site-page', sitesRoot.closest('.section')).forEach(el => {
        const site = window.NorthStarSites?.resolve(el.dataset.siteId);
        if (site) register('operations:site:' + site.id.replace(/^site:/,''), site.name, 'operations', el, 'operations:sites');
      });
    }
    register('markets:live', 'Live', 'markets', $('#marketLive'), '', $$('#marketTopTiles > [data-module-id],#dispatchClient'));
    let dispatchDetail = $('#dispatchDetail');
    if (!dispatchDetail) {
      dispatchDetail = document.createElement('article');
      dispatchDetail.id = 'dispatchDetail'; dispatchDetail.className = 'panel dispatch-workspace';
      dispatchDetail.dataset.moduleId = 'dispatch'; dispatchDetail.setAttribute('aria-label', 'APIROQ Dispatch');
      (document.querySelector('#operations-sites') || document.querySelector('#operations .ns-section-content, #operations .section-content, #operations'))?.append(dispatchDetail);
    }
    register('operations:dispatch', 'Dispatch', 'operations', dispatchDetail);
    register('operations:tasks', 'Tasks', 'operations', $('#operationsTasks'));
    register('operations:research', 'Research', 'operations', $('#operationsResearch'));
    register('markets:alarms', 'Alarms', 'markets', $('#marketAlarms'));
    register('markets:historical', 'Historical', 'markets', $('#overviewMarket'));
    const markets = sectionState('markets');
    if (!markets.liveHistorical) {
      markets.tabs = ['markets:live']; markets.active = markets.landing = 'markets:live';
      markets.detached = []; markets.floating = false; markets.liveHistorical = true;
    }
    $$('#outages [data-outage-pane]').forEach(el => {
      const key = el.dataset.outagePane;
      if (key === 'switching-plans' || key === 'uwpc') return;
      register('outages:'+key, {current:'Current outages',uwpc:'UWPC',reports:'Outage reports'}[key] || key, 'outages', el);
    });
    $$('.section').filter(el => !['overview','weather','markets','outages','switching','modules','operations-sites'].includes(el.id)).forEach(root => {
      if(root.id==='logbook' && $('.logbook-layout',root))$('.logbook-layout',root).hidden=false;
      if(root.id==='tools')$$('.workbench-card',root).forEach(card=>{if($('h3',card)?.textContent.trim().toLowerCase()==='data connections')card.dataset.moduleId='data-connections';});
      const explicit = (root.id==='logbook'?$$('#eventLogs,#eventRegister,#operationsConsole',root):root.id==='tools'?$$('.tool-grid,.workbench-card,#deviceLibrary,#overviewChat,#outlookWorkspace',root):$$('[data-module-id],.workbench-card',root)).filter(el=>el!==root && !el.dataset.nsCustom);
      const candidates = explicit.length?explicit:$$('.panel', root).filter(el => !el.dataset.nsCustom && (!el.parentElement.closest('.panel') || !root.contains(el.parentElement.closest('.panel'))));
      const currentIds = new Set();
      (candidates.length ? candidates : [root]).forEach((el, i) => {
        if (!el.id && !el.dataset.moduleId) el.dataset.moduleId = root.id+'-module-'+i;
        const id=root.id+':'+(el.dataset.moduleId || el.id);currentIds.add(id);
        register(id, ({eventLogs:'Logs',eventRegister:'Historical',operationsConsole:'Console'}[el.id]) || ({flows:'Flows',training:'Training'}[root.id]) || label(el), root.id, el);
      });
      for(const [id,m] of registry)if(m.sourceSection===root.id && !pref(id).custom && !currentIds.has(id))registry.delete(id);
    });
    // UWPC is owned by Tools in demo mode but its source remains under Switching.
    // Register it after source-root discovery so Tools does not discard the cross-section entry.
    register('outages:uwpc', 'UWPC', window.NORTHSTAR_PLATFORM_DEMO ? 'tools' : 'outages', $('#switching .switching-workspace'));
    if ($('#eventLogs')) {
      const eventsSection=sectionState('logbook');
      if (!eventsSection.logsHistoricalV1) {
        eventsSection.tabs=['logbook:eventLogs','logbook:eventRegister'];
        eventsSection.active=eventsSection.landing='logbook:eventLogs';
        eventsSection.logsHistoricalV1=true;
        save();
      }
    }
    // Match existing overview cards to their full page. Their feed anchors stay intact.
    const aliases = [['#overviewStaff','crew'],['#overviewStaffSummary','crew'],['#overviewFieldTracker','mobile'],['#overviewGeneratingStations','scada']];
    aliases.forEach(([selector, owner]) => {
      // Station summaries are available through Sites even when SCADA is restricted.
      const m = selector === '#overviewGeneratingStations' && window.NORTHSTAR_PLATFORM_DEMO
        ? registry.get('operations:sites')
        : [...registry.values()].find(m => m.sourceSection === owner);
      const el = $(selector);
      if (m && el && !m.compact.includes(el)) { m.compact.push(el); el.dataset.nsCompact = m.id; }
    });
    const events=[...registry.values()].find(m=>m.el.id==='eventRegister');
    if(events){events.compact=$$('#overviewEventsSummary,#overviewQuickLog');events.compact.forEach(el=>el.dataset.nsCompact=events.id);}
    const chat=[...registry.values()].find(m=>m.el.id==='overviewChat');
    if(chat){chat.compact=$$('#overviewChatSummary');chat.compact.forEach(el=>el.dataset.nsCompact=chat.id);}
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
    register('tools:schematic-builder','Schematic builder','tools',$('#oneLineEditor'));

    for (const [id,m] of registry) if (!m.el.isConnected) registry.delete(id);
    for (const m of registry.values()) {
      if(restrictedInSession(m)) {
        m.el.hidden=true;
        m.compact.forEach(el=>{el.hidden=true;el.style.setProperty('display','none','important');});
        $(`[data-ns-pin="${CSS.escape(m.id)}"]`)?.remove();
        continue;
      }
      const p = pref(m.id);
      if (m.id === 'tools:overview-chat') {
        $(`[data-ns-pin="${CSS.escape(m.id)}"]`)?.remove();
        m.compact = m.compact.filter(el => el.id !== 'overviewChatSummary' && el.dataset.nsPin !== m.id);
      }
      if (p.pin && m.id !== 'tools:overview-chat' && !m.compact.length) {
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
    // Keep options stable while feed refreshes run, including between pointerdown and click.
    if (!themeMenu.childElementCount) themeMenu.innerHTML = themes.map(theme=>`<button type="button" role="menuitemradio" data-module-theme="${theme}">${themeNames[theme]}</button>`).join('');
    themeMenu.setAttribute('popover','auto');
    const themeToggle = $('.ns-module-theme-toggle',themeControl);
    themeToggle.setAttribute('aria-haspopup','menu');
    themeMenu.ontoggle = () => themeToggle.setAttribute('aria-expanded',String(themeMenu.matches(':popover-open')));
    themeToggle.onclick = event => {
      event.stopPropagation();
      if (themeMenu.matches(':popover-open')) {themeMenu.hidePopover();return;}
      themeMenu.showPopover();
      const anchor=themeToggle.getBoundingClientRect(), box=themeMenu.getBoundingClientRect();
      themeMenu.style.setProperty('left',Math.max(8,Math.min(anchor.left,innerWidth-box.width-8))+'px','important');
      themeMenu.style.setProperty('top',Math.max(8,Math.min(anchor.bottom+4,innerHeight-box.height-8))+'px','important');
    };
    $$('[data-module-theme]',themeMenu).forEach(button=>{
      button.setAttribute('aria-checked',String(button.dataset.moduleTheme===chosenTheme));
      button.onclick=event=>{
        event.stopPropagation();pref(m.id).theme=button.dataset.moduleTheme;save();themeMenu.hidePopover();
        applyPresentation(m,'full',m.el);
        m.compact.forEach(node=>applyPresentation(m,'compact',node));
      };
    });
    $(':scope > .ns-open-module',el)?.remove();
    if (variant === 'compact' && el.classList.contains('weather-card')) {
      window.NorthstarModulePreview?.bindWeatherForecast(el, el.dataset.moduleId);
    } else if (variant === 'compact' && el.id !== 'overviewStaff') window.NorthstarModulePreview?.bind(el, {
      hover: m.sourceSection !== 'crew',
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
  // Keep native controls in place: feed selectors, form ownership and listeners
  // must survive disclosure and repeated module rendering.
  const toolsOpen = new Set();
  const secondaryTools = [
    '.er-filters', '.er-views', '.er-heading p', '.er-control-note', '.er-sources',
    '.mt-controls', '.mt-selectors', '.mt-help', '.market-history-pull',
    '.graph-head .node-buttons', '.graph-head .market-alert-launch',
    '.el-history-title', '.el-report',
    '.field-filter-row', '.service-request-controls', '.incident-archive-controls',
    '.switching-library-filters', '.uwpc-template-filters', '.dl-maximo-controls',
    '.one-line-toolbar', '.one-line-server-bar', '.one-line-extra', '.one-line-head p',
    '.logbook-toolbar', '.report-actions',
    '.weather-daily-controls', '.weather-daily-toolbar', '.lamination-controls',
    '.voice-filter-row', '.chat-head-actions', '.outlook-head-actions',
    '.engineering-sitemap-actions input', '.switching-actions .secondary-btn',
    '.flows-hero-actions button', '.flows-archive-actions a', '.water-ops-actions button',
    '.daily-ops-actions .secondary-btn', '.er-heading #erRefresh',
    '.outage-register-head .muted-note', '.outage-register-head label', '.staff-panel-head > div > label',
    '.staff-panel-head > div > p', '.dl-head p', '.chat-head p',
    '.ng-game > .ng-toolbar', '.ng-note', '.uwpc-head [data-action="refresh"]',
    '.outage-legend', '#outageCurrentView > .panel:has(#outageForm)',
    '[data-ns-secondary-tools]'
  ].join(',');
  function compactTools(m) {
    const el=m.el;
    const groups=$$(secondaryTools,el).filter(node=>!node.closest('dialog,[role="dialog"],.ns-module-content') && node.closest('.ns-module-window')===el);
    const schematicMenu=m.id==='tools:schematic-builder'?$('.one-line-tools',el):null;
    let toggle=$$('.ns-tools-toggle',el).find(node=>node.closest('.ns-module-window')===el);
    if(!groups.length){toggle?.remove();return;}
    groups.forEach(node=>node.classList.add('ns-secondary-tools'));
    if(!toggle){
      toggle=document.createElement('button');toggle.type='button';toggle.className='ns-tools-toggle';
      toggle.onclick=()=>{if(toolsOpen.has(m.id))toolsOpen.delete(m.id);else toolsOpen.add(m.id);compactTools(m);};
    }
    const heading=schematicMenu ? $(':scope > h3',schematicMenu) :
      $$('.er-heading,.oc-toolbar,.ai-assistant-conversation-head,h1,h2,h3',el).find(node=>
        node.getClientRects().length && node.closest('.ns-module-window')===el &&
        !node.closest(secondaryTools+',dialog,[role="dialog"],.ns-module-content,.ns-window-controls,.ns-section-shell'));
    // Feed-owned title text may be replaced on refresh. Use its existing row instead.
    const host=heading?.id && heading.parentElement!==el ? heading.parentElement : heading;
    $$('.ns-tools-host',el).filter(node=>node!==host&&node.closest('.ns-module-window')===el).forEach(node=>node.classList.remove('ns-tools-host'));
    if(host){
      host.classList.add('ns-tools-host');
      if(toggle.parentElement!==host)host.append(toggle);
    } else {
      // No native heading: share the first content row without an extra block row.
      if(toggle.parentElement!==el)el.prepend(toggle);
    }
    const open=toolsOpen.has(m.id);
    el.classList.toggle('ns-tools-collapsed',!open);
    toggle.setAttribute('aria-expanded',String(open));
    toggle.setAttribute('aria-label',(open?'Hide':'Show')+' tools and filters for '+name(m));
    const label=open?'Toolbar \u25b4':'Toolbar \u25be';
    if(toggle.textContent!==label)toggle.textContent=label;
  }
  function paint() {
    if (!shell || painting) return;
    painting = true;
    clearMask();
    const enabled = section !== 'overview';
    shell.hidden = !enabled; document.body.classList.toggle('ns-in-section',enabled);
    document.body.classList.toggle('ns-games-menu',section==='games');
    const items = sectionItems(section);
    if (!enabled || !items.length) {sectionMenuOpen=false;tree.hidden=true;tree.remove();$$('#sideNav [data-tab]').forEach(b=>{b.removeAttribute('aria-controls');b.removeAttribute('aria-expanded');});painting=false;return;}
    const s = sectionState(section);
    if (section === 'tools' && sectionState('tools').active === 'tools:schematic-builder') {
      for (let el = $('#oneLineEditor')?.parentElement; el && !el.classList.contains('section'); el = el.parentElement) {
        if (el.tagName === 'DETAILS') el.open = true;
      }
    }
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
      const locationFrame = el.querySelector('iframe[data-location-src]');
      if (locationFrame && !locationFrame.hasAttribute('src')) locationFrame.src = locationFrame.dataset.locationSrc;
      if (!originals.has(el)) originals.set(el,el.getAttribute('style') || '');
      el.classList.add('ns-module-window');
      el.dataset.nsTheme = themes.includes(pref(m.id).theme) ? pref(m.id).theme : '';
      el.style.setProperty('--ns-accent',view(m.id,'full').accent || '#63b8df');
      el.style.zIndex=m.id===active?'30':String(10+i);
      if(!el.classList.contains('ns-popout-frame')) [['position','relative'],['left','auto'],['top','auto'],['width','100%'],['height','auto'],['min-width','0'],['min-height','0'],['max-width','none'],['overflow','auto']].forEach(([k,v])=>el.style.setProperty(k,v,'important'));
      const savedBox=sectionState(ownerSection(m.section)).boxes?.[m.id];
      if(savedBox && !el.classList.contains('ns-popout-frame')){
        el.style.setProperty('--ns-section-module-width',savedBox.w+'px');el.style.setProperty('--ns-section-module-height',savedBox.h+'px');
        el.style.setProperty('width',savedBox.w+'px','important');el.style.setProperty('height',savedBox.h+'px','important');
      }
      // Docked modules scroll with the page; saved window bounds
      // remain available for editing and detached windows.
      if(!s.floating && !detachedId && !el.classList.contains('ns-popout-frame') && !(s.detached || []).includes(m.id) && !document.body.classList.contains('layout-edit')){
        if(m.sourceSection==='crew')el.style.setProperty('width','100%','important');
        el.style.setProperty('max-width','100%','important');
        el.style.setProperty('height','auto','important');
        el.style.setProperty('overflow','visible','important');
      }
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
        const toggle=document.createElement('button');toggle.type='button';toggle.className='ns-tree-toggle';toggle.textContent=open?'\u25be':'\u25b8';toggle.setAttribute('aria-label',(open?'Collapse ':'Expand ')+name(m));toggle.setAttribute('aria-expanded',String(open));toggle.setAttribute('aria-controls','ns-tree-children-'+m.id);
        toggle.onclick=()=>{state.treeOpen ||= {};state.treeOpen[groupKey]=!open;save();paint();};
        row.append(toggle,moduleButton(m));group.append(row);
        const nested=document.createElement('div');nested.className='ns-tree-children';nested.id='ns-tree-children-'+m.id;nested.hidden=!open;build(m.id,nested,depth+1);group.append(nested);host.append(group);
      }else{row.append(moduleButton(m));host.append(row);}
    });
    const moduleButton = m => {const b=document.createElement('button');b.type='button';b.textContent=name(m);b.className=m.id===active?'active':'';if(window.NORTHSTAR_RYAN_VIEW&&restrictedInSession(m))b.classList.add('ns-demo-restricted');b.dataset.openModule=m.id;b.setAttribute('aria-label',name(m));b.setAttribute('aria-current',m.id===active?'page':'false');b.onclick=()=>{if(m.sourceSection==='crew')window.NorthstarCheckins?.select('All stations');openModule(m.id);};return b;};
    build('',tree);
    if(section==='games'){
      const links=document.createElement('div');links.className='ns-games-menu-links';links.setAttribute('aria-label','NorthStar games');
      links.innerHTML='<div class="ns-tree-row" data-depth="0"><a class="ns-game-menu-link" href="https://games.northstarenergy.ca/" target="_blank" rel="noopener noreferrer">All games</a></div><div class="ns-tree-row" data-depth="0"><a class="ns-game-menu-link" href="https://games.northstarenergy.ca/poker.html" target="_blank" rel="noopener noreferrer">Poker</a></div><div class="ns-tree-row" data-depth="0"><a class="ns-game-menu-link" href="https://games.northstarenergy.ca/blackjack.html" target="_blank" rel="noopener noreferrer">Blackjack</a></div><div class="ns-tree-row" data-depth="0"><a class="ns-game-menu-link" href="https://games.northstarenergy.ca/classics.html#chess" target="_blank" rel="noopener noreferrer">Chess</a></div><div class="ns-tree-row" data-depth="0"><a class="ns-game-menu-link" href="https://games.northstarenergy.ca/classics.html#euchre" target="_blank" rel="noopener noreferrer">Euchre</a></div>';
      tree.prepend(links);
    }
    }
    if(section==='crew')window.NorthstarCheckins?.mountMenu(tree,items.find(m=>m.sourceSection==='crew'));
    $$('[data-open-module]',tree).forEach(b=>{const selected=b.dataset.openModule===active;b.classList.toggle('active',selected);b.setAttribute('aria-current',selected?'page':'false');});
    const tabHost=active?registry.get(active).el:$('main');
    if(shell.parentElement!==tabHost)tabHost.prepend(shell);
    shell.classList.toggle('ns-empty-dock',!active);
    selected.filter(m=>s.detached.includes(m.id)).forEach(m=>configureDetached(m,s));
    $$('#sideNav [data-tab]').forEach(b=>b.classList.toggle('active',b.dataset.tab===section));
    selected.forEach(compactTools);
    painting=false;
  }
  function bindSectionResize(m,el,owner) {
    let controls=$(':scope > .ns-window-controls',el);
    if(!controls){controls=document.createElement('div');controls.className='ns-window-controls';el.append(controls);}
    if(controls.dataset.sectionResize==='1')return;
    controls.dataset.sectionResize='1';
    ['n','e','s','w','nw','ne','sw','se'].forEach(corner=>{
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
      },()=>document.body.classList.contains('layout-edit') && document.body.classList.contains('ns-in-section') && !document.body.classList.contains('ns-floating') && el.isConnected,event=>{
        const s=sectionState(owner);const box=s.boxes[m.id];
        if(event?.type==='pointerup' && box){el.style.setProperty('--ns-section-module-width',box.w+'px');el.style.setProperty('--ns-section-module-height',box.h+'px');}
        save();
      });
    });
  }
  function inDashboardHeader(event) {
    const dock=$('#nsStatusBar');if(!dock)return false;
    const rect=dock.getBoundingClientRect();
    return event.clientX>=rect.left && event.clientX<=rect.right && event.clientY>=rect.top && event.clientY<=rect.bottom;
  }
  function configureDetached(m,s) {
    const el=m.el,owner=section;el.classList.add('ns-detached-window');s.boxes ||= {};
    s.boxes[m.id] ||= {x:80,y:100,w:640,h:480};
    const set=box=>{
      s.boxes[m.id]=box;
      [['position','fixed'],['left',box.x+'px'],['top',box.y+'px'],['width',box.w+'px'],['height',box.h+'px'],['min-height','0'],['z-index','850']].forEach(([key,value])=>el.style.setProperty(key,value,'important'));
    };
    set(s.boxes[m.id]);
    let controls=$(':scope > .ns-window-controls',el);
    if(!controls){controls=document.createElement('div');controls.className='ns-window-controls';el.append(controls);}
    let toolbar=$(':scope > .ns-detached-toolbar',controls);
    if(!toolbar){
      // Replace the former visible corner buttons with one compact, full-width drag bar.
      controls.replaceChildren();
      toolbar=document.createElement('div');toolbar.className='ns-detached-toolbar';toolbar.textContent=name(m);
      toolbar.setAttribute('role','button');toolbar.tabIndex=0;
      toolbar.setAttribute('aria-label','Move '+name(m)+'; drop on the fixed dashboard header to dock');
      controls.append(toolbar);
    }
    if(controls.dataset.detachedBound==='1')return;
    controls.dataset.detachedBound='1';
    const commit=event=>{
      const current=sectionState(owner);
      if(event?.type==='pointerup' && inDashboardHeader(event)){
        current.detached=current.detached.filter(id=>id!==m.id);current.active=m.id;paint();
      }
      save();
    };
    window.NorthstarWindowLayout.bind(el,toolbar,'move',()=>sectionState(owner).boxes[m.id],box=>{
      sectionState(owner).boxes[m.id]=box;set(box);
    },()=>el.classList.contains('ns-detached-window'),commit);
    ['n','e','s','w','nw','ne','sw','se'].forEach(edge=>{
      const handle=document.createElement('button');handle.type='button';handle.className='ns-detached-edge';handle.dataset.edge=edge;
      handle.setAttribute('aria-label','Resize '+name(m)+' from the '+edge.toUpperCase()+' edge');controls.append(handle);
      window.NorthstarWindowLayout.bind(el,handle,edge,()=>sectionState(owner).boxes[m.id],box=>{
        sectionState(owner).boxes[m.id]=box;set(box);
      },()=>el.classList.contains('ns-detached-window'),()=>save());
    });
  }
  function activateSource(m) {
    const root=m.el.closest('.section');
    $$('.section').forEach(el=>el.classList.toggle('active',el===root));
    $('.page-header')?.classList.add('section-header-hidden');
    if (m.id === 'markets:live') window.NorthstarMarketModules?.renderLive();
    if (m.id === 'markets:historical') window.NorthstarMarketModules?.renderHistorical();
    const pane=m.el.dataset.outagePane;
    if (pane) $(`[data-outage-tab="${CSS.escape(pane)}"]`)?.click();
  }
  function openModule(id) {
    if(id === "operations:research"){const b=new URLSearchParams(location.search).get("buildView")||(location.pathname.includes("northstar-v1")?"v1":"v3");location.assign("library.html?build="+encodeURIComponent(b)+"&type=Research");return;}
    if (id === 'markets:comparison') id = 'markets:historical';
    if (id.startsWith('markets:') && !registry.has(id)) {
      if (id !== 'markets:dispatch') window.NorthstarMarketModules?.selectLive(id.slice(8));
      id = 'markets:live';
    }
    if (/^outages:(switching-|one-line-editor|engineering-sitemap)/.test(id)) {
      const legacy = $('#uwpcLegacyTools'); if (legacy) legacy.open = true;
      id = 'outages:uwpc';
    }
    const m=registry.get(id);if(!m)return;
    if(restrictedInSession(m))return;
    if (id.startsWith('operations:site:')) {
      window.dispatchEvent(new CustomEvent('northstar:site-page-open', {detail:{siteId:'site:' + id.slice('operations:site:'.length)}}));
    }
    if(!belongs(m,section))section=m.section;sectionMenuOpen=section!=='overview';const s=sectionState(section);s.tabs ||= [];
    if(!s.tabs.includes(id))s.tabs.push(id);s.detached=(s.detached||[]).filter(openId=>openId!==id);s.active=id;
    if (id === 'operations:tasks') window.NorthstarOperationsConsole?.showTasks();
    activateSource(m);paint();save();rememberSection(section);window.scrollTo(0,0);
  }
  function popOutModule(id) {
    const m=registry.get(id);if(!m)return null;
    if(restrictedInSession(m))return null;
    const url=new URL(location.href);
    url.searchParams.delete('nsStatusWindow');
    url.searchParams.set('nsModuleWindow',id);
    url.hash=m.section;
    const name='northstar-module-'+id.replace(/[^a-z0-9_-]/gi,'-');
    const popupSize=m.sourceSection==='crew'?`popup=yes,left=0,top=0,width=${screen.availWidth||innerWidth},height=${screen.availHeight||innerHeight},resizable=yes,scrollbars=yes`:'popup=yes,width=1200,height=850,resizable=yes,scrollbars=yes';
    const popup=window.open(url.href,name,popupSize);
    if(!popup)window.alert('Allow pop-up windows for NorthStar, then try again.');
    return popup || null;
  }
  function bindOverviewFieldTrackerPopout() {
    const tracker=$('#overviewFieldTracker'),events=$('#eventsCard');
    const module=[...registry.values()].find(m=>m.compact.includes(tracker));
    if(!tracker||!events||!module||tracker.dataset.fieldPopoutBound==='1')return;
    tracker.dataset.fieldPopoutBound='1';
    const button=document.createElement('button');button.type='button';button.className='ns-field-tracker-popout';
    button.textContent='↗';button.title='Pop out Field Tracker';button.setAttribute('aria-label','Pop out Field Tracker to another screen');
    tracker.append(button);
    let popup=null,watch=0,eventAnchor=null,eventStyle='',eventHidden=false,trackerDisplay='',trackerDisplayPriority='';
    const geometry=['position','left','top','right','bottom','width','height','min-width','min-height','max-width','max-height','transform','translate','z-index','grid-column','grid-row','margin'];
    const restore=()=>{
      if(watch){clearInterval(watch);watch=0;}
      document.body.classList.remove('ns-field-tracker-popped');
      tracker.classList.remove('ns-field-tracker-away');
      if(trackerDisplay)tracker.style.setProperty('display',trackerDisplay,trackerDisplayPriority);else tracker.style.removeProperty('display');
      events.removeAttribute('data-field-tracker-replacement');
      if(eventStyle)events.setAttribute('style',eventStyle);else events.removeAttribute('style');
      events.hidden=eventHidden;
      if(eventAnchor?.isConnected)eventAnchor.replaceWith(events);
      eventAnchor=null;popup=null;
    };
    button.addEventListener('click',()=>{
      if(popup&&!popup.closed){popup.focus();return;}
      popup=popOutModule(module.id);if(!popup)return;
      if(window.NorthstarOperationsConsole?.replaceTracker){window.NorthstarOperationsConsole.replaceTracker(tracker,popup);return;}
      eventAnchor=document.createComment('northstar-event-log-home');events.before(eventAnchor);
      eventStyle=events.getAttribute('style')||'';eventHidden=events.hidden;
      trackerDisplay=tracker.style.getPropertyValue('display');trackerDisplayPriority=tracker.style.getPropertyPriority('display');
      geometry.forEach(property=>{
        const value=tracker.style.getPropertyValue(property),priority=tracker.style.getPropertyPriority(property);
        if(value)events.style.setProperty(property,value,priority);
      });
      events.hidden=false;events.style.setProperty('display','block','important');events.dataset.fieldTrackerReplacement='1';
      tracker.before(events);tracker.classList.add('ns-field-tracker-away');document.body.classList.add('ns-field-tracker-popped');
      tracker.style.setProperty('display','none','important');
      watch=setInterval(()=>{if(!popup||popup.closed)restore();},300);
    });
    addEventListener('pagehide',()=>{if(watch)clearInterval(watch);});
  }
  function showModulePopout(id) {
    const m=registry.get(id);if(!m)return;
    if(restrictedInSession(m))return;
    if (id.startsWith('operations:site:')) {
      window.dispatchEvent(new CustomEvent('northstar:site-page-open', {detail:{siteId:'site:' + id.slice('operations:site:'.length)}}));
    }
    section=m.section;sectionMenuOpen=false;
    const s=sectionState(section);s.tabs ||= [];
    s.tabs=[id];s.active=id;s.floating=false;s.detached=[];
    document.body.classList.add('ns-module-popout');
    if(m.sourceSection==='crew')document.body.classList.add('ns-crew-popout');
    activateSource(m);paint();
    document.title=name(m)+' \u00b7 NorthStar';
    if(document.querySelector('.ns-popout-toolbar'))return;
    const toolbar=document.createElement('div');toolbar.className='ns-popout-toolbar';
    toolbar.setAttribute('role','toolbar');toolbar.setAttribute('aria-label','Module window');
    toolbar.innerHTML=`<strong>${esc(name(m))}</strong><button type="button" data-window-action="minimize" aria-label="Minimize">&#8722;</button><button type="button" data-window-action="maximize" aria-label="Maximize">&#9633;</button><button type="button" data-window-action="close" aria-label="Close">&#215;</button>`;
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
    let frame=m.el;frame.classList.add('ns-popout-frame');
    let box=m.sourceSection==='crew'?{x:0,y:40,w:innerWidth,h:Math.max(120,innerHeight-40)}:{x:8,y:48,w:Math.max(240,innerWidth-16),h:Math.max(120,innerHeight-56)};
    let restoreBox, preferredBox=null;
    const fit=()=>m.sourceSection==='crew'?{x:0,y:40,w:innerWidth,h:Math.max(120,innerHeight-40)}:{x:8,y:48,w:Math.max(240,innerWidth-16),h:Math.max(120,innerHeight-56)};
    const set=value=>{box=value;Object.entries({left:box.x+'px',top:box.y+'px',width:box.w+'px',height:box.h+'px'}).forEach(([key,value])=>frame.style.setProperty(key,value,'important'));};set(box);
    const resizeHandles=[];
    ['n','e','s','w','nw','ne','sw','se'].forEach(edge=>{
      const handle=document.createElement('button');handle.type='button';handle.className='ns-popout-edge';handle.dataset.edge=edge;handle.setAttribute('aria-label','Resize '+edge.toUpperCase());frame.append(handle);resizeHandles.push(handle);
      window.NorthstarWindowLayout.bind(frame,handle,edge,()=>box,set,()=>!document.body.matches('.ns-popout-minimized,.ns-popout-maximized'),()=>{preferredBox={...box};});
    });
    // Station feed renders replace the article contents; keep its window controls.
    new MutationObserver(()=>{
      const current=document.getElementById(frame.id);
      if(current && current!==frame){frame=current;frame.classList.add('ns-popout-frame');set(box);}
      resizeHandles.forEach(handle=>{if(handle.parentNode!==frame)frame.append(handle);});
    }).observe($('main'),{childList:true,subtree:true});
    window.addEventListener('resize',()=>{
      if(!innerWidth || !innerHeight)return;
      if(document.body.classList.contains('ns-popout-maximized'))set({x:0,y:40,w:innerWidth,h:innerHeight-40});
      else if(!preferredBox)set(fit());
      else set({...preferredBox,x:Math.min(preferredBox.x,Math.max(0,innerWidth-240)),y:48,w:Math.max(240,Math.min(preferredBox.w,innerWidth-16)),h:Math.max(120,Math.min(preferredBox.h,innerHeight-56))});
    });
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
      const detail=document.createElement('small');detail.textContent=part.kind==='image'?'Image path and description':part.label+(part.live?' Â· connected':'');
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
    const box=pref(id).boxes?.[variant] || sectionState(ownerSection(m.section)).boxes?.[id];
    const sizeTarget=variant==='compact' ? (m.compact?.[0] || m.el) : m.el;
    const rect=sizeTarget.getBoundingClientRect();
    form.elements.moduleWidth.value=Math.round(box?.w || rect.width || m.el.offsetWidth || 0);
    form.elements.moduleHeight.value=Math.round(box?.h || rect.height || m.el.offsetHeight || 0);
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
    editor.innerHTML=`<form><header><div><h2>Module editor</h2><label class="ns-module-picker">Selected module<select name="modulePicker" aria-label="Select module"></select></label></div><button type="button" data-editor-close aria-label="Close editor">×</button></header><div class="ns-editor-grid"><label>Module name Â· linked across views<input name="moduleName" required maxlength="100"></label><label>Presentation<select name="variant"><option value="full">Section full page</option><option value="compact">Overview display</option></select></label><label>Presentation title<input name="title" maxlength="120"></label><label>Accent<input type="color" name="accent"></label><label>Spacing<select name="density"><option value="normal">Normal</option><option value="compact">Compact</option></select></label><label class="ns-check"><input type="checkbox" name="pin">Show on Overview</label></div><section class="ns-module-size"><h3>Module size</h3><div class="ns-editor-grid"><label>Width (px)<input name="moduleWidth" type="number" min="160" max="5000" step="1"></label><label>Height (px)<input name="moduleHeight" type="number" min="80" max="5000" step="1"></label></div></section><label>Content / notes<textarea name="notes" rows="3"></textarea></label><section class="ns-custom-placement" data-custom-placement hidden><h3>Module location</h3><div class="ns-editor-grid"><label>Section<select name="moduleSection"></select></label><label>Parent module<select name="moduleParent"></select></label></div></section><details><summary data-editor-parts-summary>Editable parts</summary><p class="ns-editor-help">Edit every visible label, text value, control label, input hint, and image in this presentation. Use Restore to return a part to its source content.</p><div class="ns-editor-part-list ns-field-list"></div></details><h3>Content and data tags</h3><div class="ns-block-list"></div><button type="button" data-add-block>+ Add content</button><p class="ns-editor-status" role="status"></p><footer><button type="button" data-editor-close>Cancel</button><button type="submit">Save module</button></footer></form>`;
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
      const width=Math.max(160,Math.min(5000,Number(form.elements.moduleWidth.value)||0)),height=Math.max(80,Math.min(5000,Number(form.elements.moduleHeight.value)||0));
      if(width&&height){pref(id).boxes ||= {};pref(id).boxes[variant]={w:width,h:height};window.NorthstarModules?.fitSize(id,variant,width,height);}
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
    shell.replaceChildren();
    tree=document.createElement('div');tree.id='nsSectionModuleMenu';tree.className='ns-module-tree';tree.setAttribute('role','group');tree.setAttribute('aria-label','Section modules');tree.hidden=true;
    main.prepend(shell);
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
    // Existing nav handlers still run their feed-specific entry actions.
    $$('#sideNav [data-tab]').forEach(b=>b.addEventListener('click',()=>{
      const id=b.dataset.tab;
      const nextSection=ownerSection(id);
      if(nextSection===section&&nextSection!=='overview'){
        sectionMenuOpen=nextSection==='games'||!sectionMenuOpen;
        const s=sectionState(section);s.menuCollapsed=false;paint();save();return;
      }
      sectionMenuOpen=nextSection!=='overview';
      enter(id);const s=sectionState(section);s.menuCollapsed=false;paint();save();
    }));
    document.addEventListener('click',event=>{
      if(window.NorthstarAssetEditor?.active())return;
      if(document.querySelector('#nsAssetEditor:not([hidden])'))return;
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
      if(variant==='compact'){
        const targets=module.compact?.length ? module.compact : [el];
        targets.forEach(target=>{target.style.setProperty('width',width+'px','important');target.style.setProperty('height',height+'px','important');});
        save();return true;
      }
      if(el.classList.contains('ns-detached-window')){
        section.boxes ||= {};const box=section.boxes[id] || {x:80,y:100,w:el.getBoundingClientRect().width,h:el.getBoundingClientRect().height};
        section.boxes[id]={...box,w:width,h:height};el.style.setProperty('width',width+'px','important');el.style.setProperty('height',height+'px','important');
      }else{
        section.boxes ||= {};const box=section.boxes[id] || {x:0,y:0,w:el.getBoundingClientRect().width,h:el.getBoundingClientRect().height};
        section.boxes[id]={...box,w:width,h:height};
        el.style.setProperty('--ns-section-module-width',width+'px');el.style.setProperty('--ns-section-module-height',height+'px');
        el.style.setProperty('width',width+'px','important');el.style.setProperty('height',height+'px','important');
      }
      save();return true;
    };
    window.NorthstarModules={open:openModule,popOut:popOutModule,edit:openEditor,refresh:schedule,registry,state,createCanvas,deleteCanvas,movementHandle,fitSize,canOpen:id=>registry.has(id)&&!restrictedInSession(registry.get(id))};
    const restoreSection=()=>{
      const id=location.hash.slice(1);
      const button=$$('#sideNav [data-tab]').find(b=>b.dataset.tab===ownerSection(id));
      if(button)button.click();
      else enter($('#sideNav [data-tab].active')?.dataset.tab || 'overview');
    };
    window.addEventListener('hashchange',restoreSection);
    if(detachedId)showModulePopout(detachedId);
    else {restoreSection();bindOverviewFieldTrackerPopout();}
  }
  // After legacy DOMContentLoaded bootstraps have completed.
  const start=()=>{
    const session = window.northstarOperatorSession;
    const ready = session ? Promise.race([Promise.resolve(session), new Promise(resolve => setTimeout(() => resolve(null), 1200))]) : Promise.resolve(null);
    ready.catch(() => null).then(account => {
      const owner = window.NORTHSTAR_LAYOUT_DEFAULT?.moduleWorkspaceOwner;
      const shared = window.NORTHSTAR_LAYOUT_DEFAULT?.moduleWorkspace;
      if (!window.NorthstarLayoutPersistence && !detachedId && shared && owner && String(account?.username || '').toLowerCase() === String(owner).toLowerCase()) {
        Object.keys(state).forEach(key => delete state[key]);
        Object.assign(state, shared);
        try { localStorage.setItem(KEY, JSON.stringify(state)); } catch {}
      }
      if(window.northstarStylesReady)window.northstarStylesReady.then(()=>setTimeout(init,0));else setTimeout(init,0);
    });
  };
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start);else start();
});
