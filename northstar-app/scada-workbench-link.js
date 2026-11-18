/* Standalone workspaces belong in the main navigation, not only submenus. */
(() => {
  'use strict';
  const params = new URLSearchParams(location.search);
  if (params.has('nsModuleWindow') || params.has('nsStatusWindow')) return;

  function start(session) {
    const nav = document.getElementById('sideNav');
    if (!nav || !session) return;
    const operator = session.role === 'operator';
    const ryan = operator && String(session.username || '').toLowerCase() === 'ryan';
    const outages = operator || (session.required === false && !session.role);
    if (!outages && !ryan) return;

    const css = document.createElement('link');
    css.rel = 'stylesheet';
    css.href = '/main-app-links.css';
    document.head.append(css);

    function add(id, label, href, icon) {
      if (document.getElementById(id)) return;
      const link = document.createElement('a');
      link.id = id;
      link.className = 'ns-main-app-link';
      link.href = href;
      if (icon) {
        const image = document.createElement('img');
        image.src = icon;
        image.alt = '';
        image.width = 20;
        image.height = 20;
        link.append(image);
      }
      const text = document.createElement('span');
      text.textContent = label;
      link.append(text);
      nav.append(link);
    }

    function mount() {
      if (outages) add('ns-outage-manager-link', 'Outage Manager', '/outage-manager.html');
      if (ryan) add('ns-scada-bench-link', 'SCADA Bench', '/scada-workbench/', '/scada-bench-icon.png');
    }
    mount();
    new MutationObserver(mount).observe(nav, {childList: true});

    // Preserve the existing SCADA-panel entry point as well.
    const panel = document.querySelector('#scada .scada-panel');
    if (ryan && panel && !document.getElementById('scada-workbench-link')) {
      const link = document.createElement('a');
      link.id = 'scada-workbench-link';
      link.className = 'primary-btn';
      link.href = '/scada-workbench/';
      link.textContent = 'OPEN SCADA BENCH';
      panel.append(link);
    }
  }

  Promise.resolve(window.northstarOperatorSession).then(session => {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => start(session), {once: true});
    } else start(session);
  });
})();
