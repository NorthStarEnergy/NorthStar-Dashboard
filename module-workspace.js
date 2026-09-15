/* Module identity, navigation and presentation. Geometry lives in module-layout.js.
 * Keep feed-owned elements in place: hide ancestor siblings instead of moving or
 * cloning live controls. Full and compact presentations share one module record.
 */
window.NORTHSTAR_MODULE_WORKSPACE = true;
(() => {
  'use strict';
  const KEY = 'northstarModuleWorkspaceV1';
  const read = key => { try { const value = JSON.parse(localStorage.getItem(key) || '{}'); return value && typeof value === 'object' && !Array.isArray(value) ? value : {}; } catch { return {}; } };
  const state = Object.assign({sections:{}, modules:{}}, read(KEY));
  state.sections ||= {}; state.modules ||= {};
  const registry = new Map(), originals = new WeakMap(), masked = new Map(), presentationHidden = new WeakMap();
  const $ = (s, root = document) => root.querySelector(s);
  const $$ = (s, root = document) => [...root.querySelectorAll(s)];
  const esc = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const label = el => ($('h1,h2,h3,header strong', el)?.textContent || el.getAttribute('aria-label') || el.dataset.moduleId || el.id || 'Module').trim().replace(/[-_]/g,' ');
  let section = 'overview', active = '', shell, tree, tabs, toolbar, editor, frame = 0, painting = false;
  let editorDrafts = {};
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(state)); }
    catch { if (editor) $('.ns-editor-status', editor).textContent = 'Changes could not be saved in this browser.'; }
  }
  const pref = id => state.modules[id] ||= {full:{}, compact:{}};
  const view = (id, variant) => pref(id)[variant] ||= {};
  const sectionState = id => state.sections[id] ||= {tabs:[], active:'', landing:'', floating:false, boxes:{}};
  const name = m => pref(m.id).name || m.title;
  function register(id, title, owner, el, parent = '', compact = []) {
    if (!el) return;
    const old = registry.get(id);
    registry.set(id, {id,title,section:owner,el,parent,compact});
    el.dataset.nsModule = id;
    compact.forEach(node => node.dataset.nsCompact = id);
    if (old?.el !== el) applyPresentation(registry.get(id), 'full', el);
  }
  function discover() {
    $$('#weatherGridFull > .weather-card').forEach(el => {
      const key = el.dataset.moduleId;
      if (key) register('weather:'+key, key, 'weather', el, '', $$('#weatherStrip > .weather-card').filter(c => c.dataset.moduleId === key));
    });
    register('markets:IESO', 'IESO market data', 'markets', $('#marketDetail'), '', $$('#marketTopTiles [data-module-id="IESO"],#marketTopTiles > .ontario-market'));
    register('markets:comparison', 'Market comparison', 'markets', $('#overviewMarket'));
    $$('#outages [data-outage-pane]').forEach(el => {
      const key = el.dataset.outagePane;
      if (key === 'switching-plans') return;
      register('outages:'+key, {current:'Current outages',uwpc:'UWPC',reports:'Outage reports'}[key] || key, 'outages', el);
    });
    $$('#switching [data-module-id]').forEach(el => register('outages:'+el.dataset.moduleId, label(el), 'outages', el, 'outages:uwpc'));
    $$('.section').filter(el => !['overview','weather','markets','outages','switching','modules'].includes(el.id)).forEach(root => {
      if(root.id==='logbook' && $('.logbook-layout',root))$('.logbook-layout',root).hidden=false;
      const explicit = (root.id==='logbook'?$$('#eventRegister,.logbook-card,.logbook-report',root):root.id==='tools'?$$('.tool-grid,.workbench-card,#deviceLibrary,#overviewChat',root):$$('[data-module-id],.workbench-card',root)).filter(el=>el!==root && !el.dataset.nsCustom);
      const candidates = explicit.length?explicit:$$('.panel', root).filter(el => !el.dataset.nsCustom && (!el.parentElement.closest('.panel') || !root.contains(el.parentElement.closest('.panel'))));
      const currentIds = new Set();
      (candidates.length ? candidates : [root]).forEach((el, i) => {
        if (!el.id && !el.dataset.moduleId) el.dataset.moduleId = root.id+'-module-'+i;
        const id=root.id+':'+(el.dataset.moduleId || el.id);currentIds.add(id);
        register(id, label(el), root.id, el);
      });
      for(const [id,m] of registry)if(m.section===root.id && !pref(id).custom && !currentIds.has(id))registry.delete(id);
    });
    // Match existing overview cards to their full page. Their feed anchors stay intact.
    const aliases = [['#overviewStaffSummary','crew'],['#overviewFieldTracker','mobile'],['#overviewGeneratingStations','scada']];
    aliases.forEach(([selector, owner]) => {
      const m = [...registry.values()].find(m => m.section === owner), el = $(selector);
      if (m && el && !m.compact.includes(el)) { m.compact.push(el); el.dataset.nsCompact = m.id; }
    });
    register('markets:dispatch','APIROQ dispatch','markets',$('#dispatchDetail'),'',$$('#dispatchClient'));
    const events=[...registry.values()].find(m=>m.el.id==='eventRegister');
    if(events){events.compact=$$('#overviewEventsSummary');events.compact.forEach(el=>el.dataset.nsCompact=events.id);}
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
      if (!el) {
        el = document.createElement('article'); el.className = 'panel'; el.dataset.nsCustom = id; el.dataset.moduleId = id;
        const target = document.getElementById(p.section);
        if (!target) return;
        target.append(el);
      }
      register(id, p.name || 'Custom module', p.section, el, p.parent || '');
    });
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
  function text(el, value) { if (el.textContent !== value) el.textContent = value; }
  function applyPresentation(m, variant, el) {
    const p = view(m.id,variant);
    presentationHidden.get(el)?.forEach((prior,node)=>{if(prior.value)node.style.setProperty('display',prior.value,prior.priority);else node.style.removeProperty('display');});
    presentationHidden.delete(el);
    el.style.setProperty('--ns-accent', p.accent || '#63b8df');
    el.classList.toggle('ns-dense', p.density === 'compact');
    el.classList.toggle('ns-custom-content-only', !!p.customOnly);
    let custom = $(':scope > .ns-module-content',el);
    if (!custom) { custom = document.createElement('div'); custom.className='ns-module-content'; el.prepend(custom); }
    const content = `<div class="ns-module-caption">${esc(p.title || (variant==='compact' && ({overviewStaffSummary:'Field staff',overviewEventsSummary:'Events',overviewGeneratingStations:'Generating stations',overviewFieldTracker:'Field tracker',overviewChatSummary:'Chat'}[el.id])) || name(m))}</div>${p.notes ? `<p class="ns-module-notes">${esc(p.notes)}</p>` : ''}<div class="ns-content-blocks">${(p.blocks || []).map((block,i) => `<div class="ns-content-block"><span>${esc(block.label || '')}</span><strong data-ns-block="${i}">${esc(block.text || '')}</strong></div>`).join('')}</div>`;
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
    if (variant === 'compact' && !$(':scope > .ns-open-module',el)) {
      const open = document.createElement('button'); open.type='button'; open.className='ns-open-module'; open.textContent='Open ↗';
      open.onclick = event => {event.stopPropagation();openModule(m.id);}; el.append(open);
    }
    if(p.customOnly){
      const hidden=new Map();
      [...el.children].filter(node=>!node.matches('.ns-module-content,.ns-edit-module,.ns-open-module,.ns-window-controls,.canvas-move-handle,.canvas-resize-handle,script,style')).forEach(node=>{
        hidden.set(node,{value:node.style.getPropertyValue('display'),priority:node.style.getPropertyPriority('display')});node.style.setProperty('display','none','important');
      });
      presentationHidden.set(el,hidden);
    }
    if(variant==='compact')window.NorthstarOverview?.present(m,el,p);
    Object.entries(p.labels || {}).forEach(([selector,value]) => {
      try {
        const target=$(selector,el), nodes=target?[...target.childNodes].filter(node=>node.nodeType===3 && node.textContent.trim()):[];
        if(nodes.length){text(nodes[0],value);nodes.slice(1).forEach(node=>text(node,''));}
      } catch {}
    });
  }
  function clearMask() {
    masked.forEach((prior,el) => {if(prior.value)el.style.setProperty('display',prior.value,prior.priority);else el.style.removeProperty('display');});
    masked.clear();
    $$('.ns-module-hidden').forEach(el => el.classList.remove('ns-module-hidden'));
    $$('.ns-module-path').forEach(el => el.classList.remove('ns-module-path'));
    $$('.ns-module-window').forEach(el => {
      el.classList.remove('ns-module-window');
      if (originals.has(el)) el.setAttribute('style', originals.get(el));
    });
    $$('.ns-source-section').forEach(el => el.classList.remove('ns-source-section'));
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
    const enabled = !['overview','modules'].includes(section);
    shell.hidden = !enabled; document.body.classList.toggle('ns-in-section',enabled);
    const items = [...registry.values()].filter(m => m.section === section);
    if (!enabled || !items.length) {painting=false;return;}
    const s = sectionState(section);
    s.tabs = (s.tabs || []).filter(id => registry.has(id) && registry.get(id).section === section);
    const landing = items.find(m => m.id === s.landing)?.id || items[0].id;
    if (!s.tabs.length) s.tabs.push(landing);
    if (!s.tabs.includes(s.active)) s.active = s.tabs[0];
    active = s.active;
    const selected = (s.floating ? s.tabs : [active]).map(id => registry.get(id));
    const roots = new Map();
    selected.forEach(m => {const root=m.el.closest('.section'); if(root){if(!roots.has(root))roots.set(root,[]);roots.get(root).push(m.el);}});
    $$('.section').forEach(root => {
      root.classList.toggle('active',roots.has(root));
      if (roots.has(root)) {root.classList.add('ns-source-section');mask(root, roots.get(root));}
    });
    document.body.classList.toggle('ns-floating',!!s.floating);
    selected.forEach((m,i) => {
      const el=m.el; el.hidden=false;
      if (!originals.has(el)) originals.set(el,el.getAttribute('style') || '');
      el.classList.add('ns-module-window');
      el.style.setProperty('--ns-accent',view(m.id,'full').accent || '#63b8df');
      el.style.zIndex=m.id===active?'30':String(10+i);
      if (s.floating) {
        s.boxes ||= {};
        s.boxes[m.id] ||= {x:20+i*40,y:60+i*35,w:Math.max(280,Math.min(720,$('main').clientWidth-320)),h:520};
        drawBox(m,s.boxes[m.id]);
      } else {
        [['position','relative'],['left','auto'],['top','auto'],['width','100%'],['height','auto'],['min-width','0'],['min-height','calc(100vh - 180px)'],['max-width','none'],['overflow','auto']].forEach(([k,v])=>el.style.setProperty(k,v,'important'));
      }
      addWindowControls(m);
    });
    tree.replaceChildren();
    const head=document.createElement('h2');head.textContent=section.replace(/-/g,' ');tree.append(head);
    const build = (parent, host) => items.filter(m => (m.parent || '') === parent).forEach(m => {
      const children=items.some(child=>child.parent===m.id), row=document.createElement('div'); row.className='ns-tree-row';
      if (children) {
        const group=document.createElement('details');group.open=!(s.collapsed || []).includes(m.id);
        const summary=document.createElement('summary');summary.append(moduleButton(m));group.append(summary);
        const nested=document.createElement('div');nested.className='ns-tree-children';build(m.id,nested);group.append(nested);
        group.addEventListener('toggle',()=>{s.collapsed=(s.collapsed || []).filter(id=>id!==m.id);if(!group.open)s.collapsed.push(m.id);save();});host.append(group);
      } else {row.append(moduleButton(m));host.append(row);}
    });
    const moduleButton = m => {const b=document.createElement('button');b.type='button';b.textContent=name(m)+(m.id===landing?' ★':'');b.className=m.id===active?'active':'';b.dataset.openModule=m.id;b.setAttribute('aria-current',m.id===active?'page':'false');b.onclick=()=>openModule(m.id);return b;};
    build('',tree);
    tabs.innerHTML = s.tabs.map(id=>`<div class="ns-tab"><button type="button" role="tab" aria-selected="${id===active}" data-module-tab="${esc(id)}">${esc(name(registry.get(id)))}</button><button type="button" data-close-module="${esc(id)}" aria-label="Close ${esc(name(registry.get(id)))}">×</button></div>`).join('');
    $('[data-ns-action="float"]',toolbar).textContent=s.floating?'Maximize active module':'Arrange module windows';
    $('[data-ns-action="landing"]',toolbar).textContent=active===landing?'★ Landing module':'Set as landing module';
    $$('#sideNav [data-tab]').forEach(b=>b.classList.toggle('active',b.dataset.tab===section));
    painting=false;
  }
  function drawBox(m, box) {
    const el=m.el;
    const rail = innerWidth <= 850 ? 178 : 252;
    [['position','absolute'],['left',(box.x+rail)+'px'],['top',(box.y+104)+'px'],['width',box.w+'px'],['height',box.h+'px'],['padding-top','44px'],['min-width','0'],['min-height','0'],['max-width','none'],['max-height','none']].forEach(([k,v])=>el.style.setProperty(k,v,'important'));
    const s=sectionState(section), boxes=(s.tabs || []).map(id=>s.boxes?.[id]).filter(Boolean);
    shell.style.minHeight=Math.max(650,...boxes.map(b=>b.y+b.h+60))+'px';
  }
  function addWindowControls(m) {
    if ($(':scope > .ns-window-controls',m.el)) return;
    const bar=document.createElement('div');bar.className='ns-window-controls';
    for (const corner of ['move','se','sw','ne','nw']) {
      const b=document.createElement('button');b.type='button';b.dataset.corner=corner;b.className='ns-window-handle';
      b.textContent=corner==='move'?'⠿ Move':' ';b.setAttribute('aria-label',(corner==='move'?'Move':'Resize '+corner)+' '+name(m));bar.append(b);
      window.NorthstarWindowLayout.bind(m.el,b,corner,()=>sectionState(section).boxes[m.id],box=>{sectionState(section).boxes[m.id]=box;drawBox(m,box);},()=>{
        const s=sectionState(section);
        if(!s.floating){
          const rect=m.el.getBoundingClientRect();s.boxes ||= {};s.boxes[m.id]={x:0,y:0,w:Math.max(260,rect.width),h:Math.max(180,rect.height)};
          s.floating=true;paint();save();
        }
        return true;
      },save);
    }
    m.el.append(bar);
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
    const m=registry.get(id);if(!m)return;
    section=m.section;const s=sectionState(section);s.tabs ||= [];
    if(!s.tabs.includes(id))s.tabs.push(id);s.active=id;
    activateSource(m);paint();save();rememberSection(section);window.scrollTo(0,0);
  }
  function rememberSection(id) {
    const url = new URL(location.href);url.hash = id;
    if(url.href !== location.href)history.replaceState(history.state,'',url.href);
  }
  function enter(id) {
    rememberSection(id);
    section=id==='switching'?'outages':id;
    if (['overview','modules'].includes(section)) {clearMask();document.body.classList.remove('ns-in-section','ns-floating');shell.hidden=true;return;}
    discover();const s=sectionState(section), items=[...registry.values()].filter(m=>m.section===section);
    const landing=registry.get(s.landing)?.section===section?s.landing:items[0]?.id;
    const target=id==='switching'?(items.find(m=>m.parent==='outages:uwpc')?.id || landing):landing;
    if(target)openModule(target);
  }
  function fieldRows(m,variant) {
    const el=variant==='full'?m.el:m.compact[0];if(!el)return [];
    const directText=node=>[...node.childNodes].filter(child=>child.nodeType===3).map(child=>child.textContent).join('').trim();
    return $$('h2,h3,label,span,small,header strong,.node-name',el).filter(node=>directText(node) && !node.closest('.ns-module-content,.ns-window-controls') && !node.id && !node.matches('[data-ns-block]')).slice(0,100).map(node=>{
      const path=[];let current=node;
      while(current && current!==el){const siblings=[...current.parentElement.children].filter(n=>n.tagName===current.tagName);path.unshift(current.tagName.toLowerCase()+':nth-of-type('+(siblings.indexOf(current)+1)+')');current=current.parentElement;}
      return {selector:path.join(' > '),text:directText(node)};
    });
  }
  function openEditor(id, variant='full', keepDraft=false) {
    const m=registry.get(id);if(!m)return;
    if(!keepDraft)editorDrafts={};
    editor.dataset.module=id;editor.dataset.variant=variant;
    const p=editorDrafts[variant] || view(id,variant), form=$('form',editor);
    form.elements.moduleName.value=name(m);form.elements.variant.value=variant;form.elements.title.value=p.title || '';
    form.elements.notes.value=p.notes || '';form.elements.accent.value=p.accent || '#63b8df';form.elements.density.value=p.density || 'normal';
    form.elements.pin.checked=pref(id).overviewVisible !== false && (!!pref(id).pin || m.compact.length>0);
    form.elements.customOnly.checked=!!p.customOnly;
    $('.ns-field-list',editor).innerHTML=fieldRows(m,variant).map(row=>`<label>${esc(row.text)}<input data-label-selector="${esc(row.selector)}" value="${esc(p.labels?.[row.selector] ?? row.text)}"></label>`).join('') || '<p>No existing labels in this presentation. Add content blocks below.</p>';
    $('.ns-block-list',editor).replaceChildren();(p.blocks || []).forEach(block=>appendBlock(block));
    $('.ns-editor-status',editor).textContent='Saved on this browser. Data bindings stay linked to the source module.';
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
    editor.innerHTML=`<form><header><h2>Module editor</h2><button type="button" data-editor-close aria-label="Close editor">×</button></header><div class="ns-editor-grid"><label>Module name · linked across views<input name="moduleName" required maxlength="100"></label><label>Presentation<select name="variant"><option value="full">Section full page</option><option value="compact">Overview display</option></select></label><label>Presentation title<input name="title" maxlength="120"></label><label>Accent<input type="color" name="accent"></label><label>Spacing<select name="density"><option value="normal">Normal</option><option value="compact">Compact</option></select></label><label class="ns-check"><input type="checkbox" name="pin">Show on Overview</label></div><label>Content / notes<textarea name="notes" rows="3"></textarea></label><details><summary>Existing labels</summary><div class="ns-field-list"></div></details><h3>Content and data tags</h3><div class="ns-block-list"></div><button type="button" data-add-block>+ Add content</button><p class="ns-editor-status" role="status"></p><footer><button type="button" data-editor-close>Cancel</button><button type="submit">Save module</button></footer></form>`;
    document.body.append(editor);
    const customOnly=document.createElement('label');customOnly.className='ns-check';
    customOnly.innerHTML='<input type="checkbox" name="customOnly"> Display only my content and data blocks';
    $('.ns-editor-grid',editor).append(customOnly);
    $$('[data-editor-close]',editor).forEach(b=>b.onclick=()=>editor.close());
    $('[data-add-block]',editor).onclick=()=>appendBlock();
    const form=$('form',editor);
    const collect=()=>({title:form.elements.title.value,notes:form.elements.notes.value,accent:form.elements.accent.value,density:form.elements.density.value,customOnly:form.elements.customOnly.checked,
      labels:Object.fromEntries($$('[data-label-selector]',editor).map(input=>[input.dataset.labelSelector,input.value])),
      blocks:$$('.ns-block-editor',editor).map(row=>({label:$('[data-block-label]',row).value,source:$('[data-block-source]',row).value,text:$('[data-block-text]',row).value}))});
    form.elements.variant.onchange=()=>{
      const moduleName=form.elements.moduleName.value,pin=form.elements.pin.checked;
      editorDrafts[editor.dataset.variant]=collect();openEditor(editor.dataset.module,form.elements.variant.value,true);
      form.elements.moduleName.value=moduleName;form.elements.pin.checked=pin;
    };
    form.onsubmit=event=>{
      event.preventDefault();const id=editor.dataset.module, variant=editor.dataset.variant, p=view(id,variant);
      pref(id).name=form.elements.moduleName.value.trim();pref(id).pin=form.elements.pin.checked;pref(id).overviewVisible=form.elements.pin.checked;
      editorDrafts[variant]=collect();Object.entries(editorDrafts).forEach(([key,value])=>Object.assign(view(id,key),value));
      save();discover();paint();renderCatalog();editor.close();
    };
  }
  function renderCatalog() {
    const root=$('#modules');if(!root)return;
    let catalog=$('.ns-catalog',root);
    if(!catalog){root.replaceChildren();catalog=document.createElement('div');catalog.className='ns-catalog';root.append(catalog);}
    const owners=[...new Set([...registry.values()].map(m=>m.section))];
    catalog.innerHTML=`<h2>Modules</h2><p>Choose a module to edit its full page or Overview display.</p><div class="ns-create"><label>New module name<input id="nsNewName" maxlength="100"></label><label>Section<select id="nsNewSection">${owners.map(id=>`<option>${esc(id)}</option>`).join('')}</select></label><label>Parent module<select id="nsNewParent"><option value="">None</option></select></label><button type="button" id="nsCreateModule">Create module</button></div><div class="ns-catalog-list">${[...registry.values()].map(m=>`<article><div><small>${esc(m.section)}${m.parent?' / '+esc(name(registry.get(m.parent) || {id:m.parent,title:m.parent})):''}</small><h3>${esc(name(m))}</h3></div><button data-catalog-open="${esc(m.id)}">Open</button><button data-catalog-edit="${esc(m.id)}" data-variant="full">Edit full page</button><button data-catalog-edit="${esc(m.id)}" data-variant="compact">Edit Overview</button></article>`).join('')}</div>`;
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
  function init() {
    const main=$('main');if(!main)return;
    shell=document.createElement('div');shell.className='ns-section-shell';shell.hidden=true;
    shell.innerHTML='<aside class="ns-module-tree" aria-label="Section modules"></aside><div class="ns-section-top"><div class="ns-module-tabs" role="tablist" aria-label="Open module pages"></div><div class="ns-module-toolbar"><button data-ns-action="float" type="button">Arrange module windows</button><button data-ns-action="landing" type="button">Set as landing module</button><button data-ns-action="edit" type="button">Edit module</button></div></div>';
    main.prepend(shell);tree=$('.ns-module-tree',shell);tabs=$('.ns-module-tabs',shell);toolbar=$('.ns-module-toolbar',shell);
    createEditor();discover();renderCatalog();
    try{if(!localStorage.getItem(KEY+'Saved'))localStorage.setItem(KEY+'Saved',JSON.stringify(state));}catch{}
    window.addEventListener('resize',()=>paint());
    tabs.onclick=event=>{
      const open=event.target.closest('[data-module-tab]'),close=event.target.closest('[data-close-module]');
      if(open)openModule(open.dataset.moduleTab);
      if(close){const s=sectionState(section);s.tabs=s.tabs.filter(id=>id!==close.dataset.closeModule);if(s.active===close.dataset.closeModule)s.active=s.tabs.at(-1) || '';paint();save();}
    };
    toolbar.onclick=event=>{
      const action=event.target.dataset.nsAction,s=sectionState(section);
      if(action==='float'){s.floating=!s.floating;paint();save();}
      if(action==='landing'){s.landing=active;paint();save();}
      if(action==='edit')openEditor(active);
    };
    // Existing nav handlers still run their feed-specific entry actions.
    $$('#sideNav [data-tab]').forEach(b=>b.addEventListener('click',()=>enter(b.dataset.tab)));
    document.addEventListener('click',event=>{
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
    window.NorthstarModules={open:openModule,edit:openEditor,refresh:schedule,registry,state};
    const restoreSection=()=>{
      const id=location.hash.slice(1);
      const button=$$('#sideNav [data-tab]').find(b=>b.dataset.tab===id);
      if(button)button.click();
      else enter($('#sideNav [data-tab].active')?.dataset.tab || 'overview');
    };
    window.addEventListener('hashchange',restoreSection);
    restoreSection();
  }
  // After legacy DOMContentLoaded bootstraps have completed.
  const start=()=>{if(window.northstarStylesReady)window.northstarStylesReady.then(()=>setTimeout(init,0));else setTimeout(init,0);};
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start);else start();
})();
