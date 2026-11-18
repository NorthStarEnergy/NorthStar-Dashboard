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
      const link = document.createElement('button');
      link.type = 'button';
      link.id = id;
      link.className = 'ns-main-app-link';
      link.title = label;
      link.setAttribute('aria-label', label);
      link.dataset.destination = href;
      link.addEventListener('click', () => location.assign(href));
      if (icon) {
        const image = document.createElement('img');
        image.src = icon;
        image.alt = '';
        image.className = 'nav-icon';
        image.width = 17;
        image.height = 17;
        link.append(image);
      } else {
        const image = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        image.setAttribute('viewBox', '0 0 24 24');
        image.setAttribute('width', '17');
        image.setAttribute('height', '17');
        image.setAttribute('fill', 'none');
        image.setAttribute('stroke', 'currentColor');
        image.setAttribute('aria-hidden', 'true');
        image.classList.add('nav-icon');
        const line = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        line.setAttribute('d', 'M13 2 4 14h7l-1 8 10-12h-7Z');
        image.append(line);
        link.append(image);
      }
      const text = document.createElement('span');
      text.className = 'nav-label';
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
