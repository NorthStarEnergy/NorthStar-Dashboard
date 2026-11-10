/* Role-aware dashboard filtering. Server authorization remains authoritative. */
(() => {
  'use strict';
  const unavailableTabs = new Set(['switching', 'outages', 'games']);
  const partialTabs = new Set(['operations', 'tools']);

  function markNavigation(session) {
    const demo = session?.role === 'platform_demo';
    const ryan = session?.role === 'operator' && String(session.username || '').toLowerCase() === 'ryan';
    document.querySelectorAll('#sideNav [data-tab]').forEach(button => {
      const unavailable = unavailableTabs.has(button.dataset.tab);
      button.hidden = demo && unavailable;
      button.classList.toggle('ns-demo-restricted', ryan && button.dataset.tab === 'games');
      button.classList.toggle('ns-demo-partial', ryan && partialTabs.has(button.dataset.tab));
    });
    const development = document.getElementById('nsDevelopmentFolder');
    if (development) {
      development.hidden = demo;
      development.classList.toggle('ns-demo-restricted', ryan);
    }
    if (demo) document.querySelectorAll('#outages,#games').forEach(section => { section.hidden = true; });
    if (demo && unavailableTabs.has(location.hash.slice(1))) history.replaceState(history.state, '', '#overview');
  }

  function ensureDemoUwpc(session) {
    if (session?.role !== 'platform_demo') return;
    const tree = document.getElementById('nsSectionModuleMenu');
    if (!tree || !/tools/i.test(tree.getAttribute('aria-label') || '') || tree.querySelector('[data-demo-uwpc]')) return;
    const row = document.createElement('div');
    row.className = 'ns-tree-row';
    row.dataset.depth = '0';
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.demoUwpc = 'true';
    button.textContent = 'UWPC';
    button.onclick = () => {
      const module = window.NorthstarModules?.registry?.get('outages:uwpc');
      if (module) { window.NorthstarModules.open('outages:uwpc'); return; }
      document.querySelectorAll('.section').forEach(section => section.classList.remove('active'));
      document.getElementById('switching')?.classList.add('active');
      const workspace = document.querySelector('#switching .switching-workspace');
      if (workspace) workspace.hidden = false;
      document.querySelectorAll('#sideNav [data-tab]').forEach(item => item.classList.toggle('active', item.dataset.tab === 'tools'));
      tree.querySelectorAll('button').forEach(item => item.classList.toggle('active', item === button));
      document.querySelector('.page-header')?.classList.add('section-header-hidden');
    };
    row.append(button);
    tree.prepend(row);
  }

  Promise.resolve(window.northstarOperatorSession).then(session => {
    markNavigation(session);
    ensureDemoUwpc(session);
    const nav = document.getElementById('sideNav');
    if (nav) new MutationObserver(() => { markNavigation(session); ensureDemoUwpc(session); }).observe(nav, {childList:true, subtree:true});
    document.addEventListener('click', event => {
      if (session?.role !== 'platform_demo') return;
      const button = event.target.closest('#sideNav [data-tab]');
      if (!button || !unavailableTabs.has(button.dataset.tab)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
    }, true);
  }).catch(() => {});
})();
