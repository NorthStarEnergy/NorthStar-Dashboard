/* Loads after the dashboard. A failure here cannot interrupt session or data boot. */
(() => {
  'use strict';
  if (/Electron/i.test(navigator.userAgent) || new URLSearchParams(location.search).get('nsToolbar') === 'off') return;

  function start() {
    const brand = document.querySelector('.app > aside .brand');
    if (!brand || document.getElementById('nsWebToolbar')) return;
    const bar = document.createElement('div');
    bar.id = 'nsWebToolbar';
    bar.setAttribute('role', 'toolbar');
    bar.setAttribute('aria-label', 'NorthStar application menu');
    bar.innerHTML = '<button class="ns-web-toolbar-menu" type="button" aria-label="Open application menu" aria-expanded="false" aria-controls="nsWebToolbarDropdown">☰</button>' +
      '<div class="ns-web-toolbar-dropdown" id="nsWebToolbarDropdown" hidden>' +
      '<button type="button" data-action="refresh">Refresh dashboard</button>' +
      '<button type="button" data-action="logout">Log out</button><hr>' +
      '<div class="ns-web-toolbar-group">Edit</div><button type="button" data-action="edit">Edit layout</button>' +
      '<div class="ns-web-toolbar-group">Teams</div><button type="button" data-action="teams">Open Teams in browser</button>' +
      '<div class="ns-web-toolbar-group">SharePoint / Files</div><button type="button" data-action="sharepoint">Open SharePoint in browser</button><hr>' +
      '<button type="button" data-action="control">Open Web Control Center</button>' +
      '<button type="button" data-action="fullscreen">Toggle fullscreen</button>' +
      '<button type="button" data-action="exit">Exit</button></div>';

    const counts = { critical: 0, alarm: 0, communication: 0, ai: 0 };
    const iconHosts = () => [
      document.querySelector('.app > aside .brand .northstar-ai-menu-toggle'),
      document.querySelector('.app > aside .brand .brand-home-control'),
      document.querySelector('#sideNav button[data-tab="assistant"]'),
    ].filter(host => host?.querySelector('img'));
    const badges = new Set();
    const attachBadges = () => {
      iconHosts().forEach(host => {
        if (host.querySelector(':scope > .ns-app-notification')) return;
        const badge = document.createElement('span');
        badge.className = 'ns-app-notification';
        badge.hidden = true;
        badge.setAttribute('aria-hidden', 'true');
        host.append(badge);
        badges.add(badge);
        const categories = ['critical', 'alarm', 'communication', 'ai'];
        const type = categories.find(name => counts[name] > 0);
        const total = categories.reduce((sum, name) => sum + counts[name], 0);
        badge.hidden = !total;
        badge.textContent = total > 99 ? '99+' : String(total);
        badge.dataset.type = type || '';
      });
    };
    const updateBadge = () => {
      const categories = ['critical', 'alarm', 'communication', 'ai'];
      const type = categories.find(name => counts[name] > 0);
      const total = categories.reduce((sum, name) => sum + counts[name], 0);
      attachBadges();
      badges.forEach(badge => {
        badge.hidden = !total;
        badge.textContent = total > 99 ? '99+' : String(total);
        badge.dataset.type = type || '';
      });
    };
    const addNotification = type => {
      if (!Object.hasOwn(counts, type)) return;
      counts[type]++;
      updateBadge();
    };
    const clearNotifications = () => { Object.keys(counts).forEach(type => { counts[type] = 0; }); updateBadge(); };
    window.northstarClearNotifications = clearNotifications;
    window.northstarNotify = addNotification;
    window.addEventListener('northstar:notification', event => addNotification(event.detail?.type));
    window.addEventListener('northstar-ai-answer', () => addNotification('ai'));
    window.addEventListener('northstar-ai-reminder', () => addNotification('ai'));
    window.addEventListener('northstar-ai-push', () => addNotification('ai'));
    window.addEventListener('northstar:alarms-updated', event => {
      const total = Number(event.detail?.count);
      if (Number.isFinite(total)) counts.alarm = Math.max(0, total);
      updateBadge();
    });

    const toggle = bar.querySelector('.ns-web-toolbar-menu');
    const menu = bar.querySelector('.ns-web-toolbar-dropdown');
    const close = () => { menu.hidden = true; toggle.setAttribute('aria-expanded', 'false'); };
    toggle.addEventListener('click', () => {
      menu.hidden = !menu.hidden;
      toggle.setAttribute('aria-expanded', String(!menu.hidden));
      if (!menu.hidden) menu.querySelector('button').focus();
    });
    bar.addEventListener('click', event => {
      const action = event.target.closest('[data-action]')?.dataset.action;
      if (!action) return;
      close();
      if (action === 'refresh') location.reload();
      else if (action === 'logout' || action === 'exit') {
        const signOut = document.querySelector('.operator-signout');
        if (signOut) signOut.click();
        else location.assign('/operator-login.html');
      } else if (action === 'edit') document.querySelector('.layout-edit-toggle')?.click();
      else if (action === 'teams') window.open('https://teams.microsoft.com/v2/', '_blank', 'noopener,noreferrer');
      else if (action === 'sharepoint') window.open('https://www.office.com/launch/sharepoint', '_blank', 'noopener,noreferrer');
      else if (action === 'control') window.open('/control-center.html', '_blank', 'noopener,noreferrer');
      else if (action === 'fullscreen') {
        const request = document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen();
        request?.catch(() => {});
      }
    });
    document.addEventListener('pointerdown', event => { if (!bar.contains(event.target)) close(); });
    document.addEventListener('keydown', event => { if (event.key === 'Escape' && !menu.hidden) { close(); toggle.focus(); } });
    brand.prepend(bar);
    document.body.classList.add('ns-web-toolbar');
    updateBadge();
    new MutationObserver(() => attachBadges()).observe(document.querySelector('#sideNav') || brand, { childList: true, subtree: true });
  }

  function load() {
    const stylesheet = document.createElement('link');
    stylesheet.rel = 'stylesheet';
    stylesheet.href = 'web-toolbar.css?v=build-v0.157';
    stylesheet.onload = start;
    stylesheet.onerror = () => stylesheet.remove();
    document.head.append(stylesheet);
  }
  if (window.northstarStylesReady) window.northstarStylesReady.then(load);
})();
