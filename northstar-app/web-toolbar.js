/* Loads after the dashboard. A failure here cannot interrupt session or data boot. */
(() => {
  'use strict';
  const detached = new URLSearchParams(location.search).get('nsStatusWindow') === '1';
  if (/Electron/i.test(navigator.userAgent) && !detached || new URLSearchParams(location.search).get('nsToolbar') === 'off') return;

  function start() {
    const brand = document.querySelector(detached ? '#nsStationWindow' : '.app > aside .brand');
    if (!brand || document.getElementById('nsWebToolbar')) return;
    const bar = document.createElement('div');
    bar.id = 'nsWebToolbar';
    bar.setAttribute('role', 'toolbar');
    bar.setAttribute('aria-label', 'NorthStar application menu');
    bar.innerHTML = '<button class="ns-web-toolbar-menu" type="button" aria-label="Open application menu" aria-expanded="false" aria-controls="nsWebToolbarDropdown">☰</button>' +
      '<div class="ns-web-toolbar-dropdown" id="nsWebToolbarDropdown" hidden>' +
      '<button type="button" data-action="refresh">Refresh Dashboard</button>' +
      '<button type="button" data-action="fullscreen">Full Screen</button>' +
      '<button type="button" data-action="build-view" aria-expanded="false" aria-controls="nsBuildViewOptions">Build View ▸</button>' +
      '<div id="nsBuildViewOptions" role="group" aria-label="Build View" hidden><button type="button" data-build-view="v1" aria-pressed="true">v1</button><button type="button" data-build-view="v2" aria-pressed="false">v2</button></div>' +
      '<button type="button" data-action="station-display" aria-expanded="false" aria-controls="nsStationDisplayOptions">Station Display ▸</button>' +
      '<div id="nsStationDisplayOptions" role="group" aria-label="Station Display" hidden><button type="button" data-station-display="graphical" aria-pressed="true">Graphical</button><button type="button" data-station-display="list" aria-pressed="false">List</button></div>' +
      '<button type="button" data-action="edit">Edit Layout</button>' +
      '<button type="button" data-action="account">Account Settings</button>' +
      '<button type="button" data-action="exit">Exit</button></div>';

    const counts = { critical: 0, alarm: 0, communication: 0, ai: 0 };
    const iconHosts = () => [
      document.querySelector('.app > aside .brand .northstar-ai-menu-toggle'),
      document.querySelector('.app > aside .brand .brand-home-control'),
    ].filter(host => host?.querySelector('img'));
    const badges = new Set();
    const attachBadges = () => {
      iconHosts().forEach(host => {
        if (host.querySelector(':scope > .ns-app-notification')) return;
        const badge = document.createElement('span');
        badge.className = 'ns-app-notification';
        const countLabel = document.createElement('span');
        countLabel.className = 'ns-app-notification-count';
        badge.append(countLabel);
        badge.hidden = true;
        badge.setAttribute('aria-hidden', 'true');
        host.append(badge);
        badges.add(badge);
        const categories = ['critical', 'alarm', 'communication', 'ai'];
        const type = categories.find(name => counts[name] > 0);
        const total = categories.reduce((sum, name) => sum + counts[name], 0);
        badge.hidden = !total;
        countLabel.textContent = total > 99 ? '99+' : String(total);
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
        badge.querySelector('.ns-app-notification-count').textContent = total > 99 ? '99+' : String(total);
        badge.dataset.type = type || '';
      });
    };
    const addNotification = type => {
      if (!Object.hasOwn(counts, type)) return;
      counts[type]++;
      updateBadge();
    };
    const clearAiNotifications = () => { counts.ai = 0; updateBadge(); };
    const clearNotifications = () => { Object.keys(counts).forEach(type => { counts[type] = 0; }); updateBadge(); };
    window.northstarClearAiNotifications = clearAiNotifications;
    window.northstarClearNotifications = clearNotifications;
    window.northstarNotify = addNotification;
    window.addEventListener('northstar:notification', event => addNotification(event.detail?.type));
    window.addEventListener('northstar-ai-answer', () => addNotification('ai'));
    window.addEventListener('northstar-ai-reminder', () => addNotification('ai'));
    window.addEventListener('northstar-ai-push', () => addNotification('ai'));
    window.addEventListener('northstar:assistant-opened', clearAiNotifications);
    window.addEventListener('northstar:alarms-updated', event => {
      const total = Number(event.detail?.count);
      if (Number.isFinite(total)) counts.alarm = Math.max(0, total);
      updateBadge();
    });

    const toggle = bar.querySelector('.ns-web-toolbar-menu');
    const menu = bar.querySelector('.ns-web-toolbar-dropdown');
    const stationOptions = bar.querySelector('#nsStationDisplayOptions');
    const stationToggle = bar.querySelector('[data-action="station-display"]');
    const buildOptions = bar.querySelector('#nsBuildViewOptions');
    const buildToggle = bar.querySelector('[data-action="build-view"]');
    const syncBuild = () => bar.querySelectorAll('[data-build-view]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.buildView === (window.NorthStarBuildView?.get() || 'v1'))));
    window.addEventListener('northstar:build-view-change', syncBuild);
    syncBuild();
    const syncStationDisplay = () => bar.querySelectorAll('[data-station-display]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.stationDisplay === (window.NorthStarStationDisplay?.get() || 'graphical'))));
    window.addEventListener('northstar:station-display-change', syncStationDisplay);
    syncStationDisplay();
    const close = () => { menu.hidden = true; toggle.setAttribute('aria-expanded', 'false'); stationOptions.hidden = true; stationToggle.setAttribute('aria-expanded', 'false'); buildOptions.hidden = true; buildToggle.setAttribute('aria-expanded', 'false'); };
    toggle.addEventListener('click', () => {
      menu.hidden = !menu.hidden;
      toggle.setAttribute('aria-expanded', String(!menu.hidden));
      if (!menu.hidden) menu.querySelector('button').focus();
    });
    bar.addEventListener('click', event => {
      const build = event.target.closest('button[data-build-view]')?.dataset.buildView;
      if (build) { window.NorthStarBuildView?.set(build); syncBuild(); close(); toggle.focus(); return; }
      const choice = event.target.closest('button[data-station-display]')?.dataset.stationDisplay;
      if (choice) { window.NorthStarStationDisplay?.set(choice); syncStationDisplay(); close(); toggle.focus(); return; }
      const action = event.target.closest('[data-action]')?.dataset.action;
      if (action === 'build-view') { buildOptions.hidden = !buildOptions.hidden; buildToggle.setAttribute('aria-expanded', String(!buildOptions.hidden)); if (!buildOptions.hidden) buildOptions.querySelector('button').focus(); return; }
      if (action === 'station-display') { stationOptions.hidden = !stationOptions.hidden; stationToggle.setAttribute('aria-expanded', String(!stationOptions.hidden)); if (!stationOptions.hidden) stationOptions.querySelector('button').focus(); return; }
      if (!action) return;
      close();
      if (action === 'refresh') location.reload();
      else if (action === 'account') {
        if (detached) {
          try { if (window.opener && !window.opener.closed) { window.opener.document.querySelector('#sideNav [data-tab="account"]')?.click(); window.opener.focus(); return; } } catch {}
          location.assign('/northstar-clean.html#account');
        } else document.querySelector('#sideNav [data-tab="account"]')?.click();
      }
      else if (action === 'exit' && detached) window.close();
      else if (action === 'logout' || action === 'exit') {
        const signOut = document.querySelector('.operator-signout');
        if (signOut) signOut.click();
        else location.assign('/operator-login.html');
      } else if (action === 'edit') document.querySelector('.layout-edit-toggle')?.click();
      else if (action === 'control') window.open('/control-center.html', '_blank', 'noopener,noreferrer');
      else if (action === 'fullscreen') {
        const request = document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen();
        request?.catch(() => {});
      }
    });
    document.addEventListener('pointerdown', event => { if (!bar.contains(event.target)) close(); });
    document.addEventListener('keydown', event => { if (event.key === 'Escape' && !menu.hidden) { close(); toggle.focus(); } });
    brand.prepend(bar);
    if (detached) { const monitor = document.createElement('script'); monitor.src = 'status-simple.js?v=20261030'; document.head.append(monitor); }
    document.body.classList.add('ns-web-toolbar');
    updateBadge();
    new MutationObserver(() => attachBadges()).observe(document.querySelector('#sideNav') || brand, { childList: true, subtree: true });
  }

  function load() {
    const stylesheet = document.createElement('link');
    stylesheet.rel = 'stylesheet';
    stylesheet.href = 'web-toolbar.css?v=build-v0.239';
    stylesheet.onload = start;
    stylesheet.onerror = () => stylesheet.remove();
    document.head.append(stylesheet);
  }
  if (window.northstarStylesReady) window.northstarStylesReady.then(load);
})();
