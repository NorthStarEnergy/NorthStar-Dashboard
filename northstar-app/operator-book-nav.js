/* Operator log navigation shared by the dashboard presentations. */
(async () => {
  'use strict';
  const params = new URLSearchParams(location.search);
  const session = await window.northstarOperatorSession;
  if (!session || (session.required && session.role !== 'operator')) return;
  const nav = document.getElementById('sideNav');
  if (!nav || params.has('nsModuleWindow')) return;
  const build = params.get('buildView') || (location.pathname.includes('-v1') ? 'v1' : 'v3');
  const labels = {entry:'Log Book', general:'General', notes:'Notes', historical:'Historical'};
  const current = () => {
    const p = new URLSearchParams(location.search), view = p.get('logBook');
    return Object.hasOwn(labels, view) ? {view, item:p.get('noteItem')} : null;
  };
  const detached = params.has('nsStatusWindow');
  function route(view, item) {
    const u = new URL(location.href);
    u.searchParams.delete('nsStatusWindow');
    u.searchParams.set('logBook', view);
    if (item) u.searchParams.set('noteItem', item); else u.searchParams.delete('noteItem');
    return u;
  }
  let frame;
  function sync() {
    const state = current();
    document.body.classList.toggle('ns-book-open', Boolean(state));
    submenu.hidden = !state;
    entry.setAttribute('aria-expanded',String(!!state));
    for (const el of [entry,...submenu.children]) {
      if (el.dataset.bookPage === state?.view) el.setAttribute('aria-current','page');
      else el.removeAttribute('aria-current');
    }
    if (!state) {frame?.contentWindow.NorthstarOperatorBook?.layout.command('cancel');return;}
    if (!frame) {
      frame = document.createElement('iframe');
      frame.id = 'operatorBookFrame';frame.title = 'Operator Log Book';
      frame.src = 'operator-book.html?' + new URLSearchParams({build,view:state.view,item:state.item||''});
      document.querySelector('.app > main').append(frame);
    } else frame.contentWindow.NorthstarOperatorBook?.show(state.view,state.item);
  }
  function open(view='entry',item='') {
    const u = route(view,item);
    if (detached) {window.open(u.href,'_blank','noopener');return;}
    if (document.body.classList.contains('ns-library-shell') || document.body.classList.contains('ns-ai-mode')) {
      for (const k of ['nsLibrary','item','file','q','type']) u.searchParams.delete(k);
      u.hash='overview';location.assign(u.href);return;
    }
    if (location.href !== u.href) history.pushState(history.state,'',u);
    sync();
  }
  function leave() {
    if (!current()) return;
    const u = new URL(location.href);u.searchParams.delete('logBook');u.searchParams.delete('noteItem');
    history.pushState(history.state,'',u);sync();
  }
  let toggleText,toggleLabel,resetTitle;
  function editing(active) {
    document.body.classList.toggle('ns-book-editing',active);
    const toggle=document.querySelector('.layout-toolbar .layout-edit-toggle'), reset=document.querySelector('.layout-toolbar .layout-reset');
    if (active && toggle && toggleText===undefined) {
      toggleText=toggle.textContent;toggleLabel=toggle.getAttribute('aria-label');toggle.textContent='Cancel';toggle.setAttribute('aria-label','Cancel layout changes');
      if(reset){resetTitle=reset.title;reset.title='Restore the default panel positions';}
    } else if(!active && toggleText!==undefined) {
      toggle.textContent=toggleText;toggleText=undefined;
      if(toggleLabel===null)toggle.removeAttribute('aria-label');else toggle.setAttribute('aria-label',toggleLabel);
      if(reset)reset.title=resetTitle;
    }
  }
  window.NorthstarBookNav = {open,current,editing};
  window.addEventListener('click',e=>{
    if(!current() || detached)return;
    const b=e.target.closest('.layout-edit-toggle,.layout-toolbar .layout-save,.layout-toolbar .layout-reset,#nsWebToolbarDropdown [data-action="edit"]');
    if(!b)return;
    e.preventDefault();e.stopImmediatePropagation();
    if(b.closest('#nsWebToolbarDropdown')) document.querySelector('#nsWebToolbar .ns-web-toolbar-menu')?.click();
    frame?.contentWindow.NorthstarOperatorBook?.layout.command(b.matches('.layout-save')?'save':b.matches('.layout-reset')?'reset':'toggle');
  },true);
  document.addEventListener('click', e => {
    if (e.target.closest('[data-quick-log], [data-open-event-log]')) {
      e.preventDefault();e.stopImmediatePropagation();open();return;
    }
    if (detached) return;
    if (e.target.closest('.brand-home-control')) {
      e.preventDefault();e.stopImmediatePropagation();leave();nav.querySelector('[data-tab="overview"]')?.click();return;
    }
    if (e.target.closest('#sideNav [data-tab]') && e.isTrusted) leave();
  },true);
  if (detached) return;
  const paths = {
    book:'M3 4c4-1 6 0 9 2 3-2 5-3 9-2v15c-4-1-6 0-9 2-3-2-5-3-9-2z M12 6v15',
    library:'M3 4h4v16H3z M9 4h4v16H9z M15 5l4-1 3 15-4 1z',
    tools:'M3 8h18v12H3z M8 8V5h8v3 M3 13h18 M10 13v2h4v-2'
  };
  function labelButton(b,label,icon) {
    b.innerHTML='<svg class="nav-icon" aria-hidden="true" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="'+paths[icon]+'"/></svg><span class="nav-label">'+label+'</span>';
    b.title=label;b.setAttribute('aria-label',label);
  }
  function button(label,action) {
    const b=document.createElement('button');b.type='button';b.textContent=label;b.onclick=action;return b;
  }
  document.body.classList.add('ns-book-shell');
  const entry=button(labels.entry,()=>open());entry.dataset.bookPage='entry';labelButton(entry,labels.entry,'book');
  const submenu=document.createElement('div');submenu.id='operatorBookMenu';submenu.hidden=true;
  entry.setAttribute('aria-controls',submenu.id);
  for (const view of ['general','notes','historical']) {
    const b=button(labels[view],()=>open(view));b.dataset.bookPage=view;submenu.append(b);
  }
  const tools=button('Tools',()=>location.assign('library.html?type=Tools&build='+encodeURIComponent(build)));
  tools.id='operatorTools';labelButton(tools,'Tools','tools');
  const tab = name=>nav.querySelector('[data-tab="'+name+'"]');
  const library=tab('tools');
  function place() {
    const events=tab('logbook'), agent=tab('assistant');
    const tabs=[...nav.children].filter(el=>el.hasAttribute('data-tab'));
    if(events && agent && tabs[tabs.indexOf(events)+1]!==agent) events.after(agent);
    const crew=tab('crew');
    if (crew && (submenu.nextElementSibling!==crew || entry.nextElementSibling!==submenu)) crew.before(entry,submenu);
    if (library && library.nextElementSibling!==tools) library.after(tools);
  }
  place();new MutationObserver(place).observe(nav,{childList:true});
  function repairLibrary() {
    if (library && !library.querySelector('.nav-icon')) labelButton(library,'Library','library');
  }
  repairLibrary();
  if (library) new MutationObserver(repairLibrary).observe(library,{childList:true});
  function header() {
    const home=document.querySelector('.brand-home-control');
    if (home) {home.closest('.brand').id='nsOperatorBrand';home.title='Overview';home.setAttribute('aria-label','NorthStar Overview');}
    const dropdown=document.getElementById('nsWebToolbarDropdown');
    const version=document.querySelector('aside .dashboard-build-label');
    if (version && dropdown && !dropdown.querySelector('[data-book-version]')) {
      const b=button('Version '+version.textContent.trim(),()=>version.click());b.dataset.bookVersion='';dropdown.append(b);
    }
  }
  header();window.addEventListener('load',header,{once:true});
  new MutationObserver(header).observe(document.querySelector('aside .brand'),{childList:true,subtree:true});
  window.addEventListener('popstate',sync);
  sync();
})();
