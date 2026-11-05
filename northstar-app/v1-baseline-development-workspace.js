/* Preserve the pre-demo configuration before any layout defaults initialize. */
(() => {
  'use strict';
  const query = new URLSearchParams(location.search);
  const mode = ['overview', 'fixed'].includes(query.get('nsDevelopment')) ? query.get('nsDevelopment') : '';
  const detached = query.has('nsModuleWindow') || query.get('nsStatusWindow') === '1';
  window.NORTHSTAR_DEVELOPMENT_VIEW = mode;
  window.NORTHSTAR_DEMO_HOME = !!mode && !detached;
  document.documentElement.dataset.nsDevelopment = detached ? 'detached' : mode ? 'demo' : 'main';
  document.documentElement.dataset.nsDevelopmentFixed = String(!detached && mode === 'fixed');
  const snapshotKey = 'northstarDevelopmentSnapshot20260930';
  const keys = ['northstarRestoredV1_northstarModuleWorkspaceV1', 'northstarRestoredV1_northstarOverviewProfilesV2', 'northstarRestoredV1_northstarCanvasLayoutV1', 'northstarRestoredV1_northstarStatusLayoutV1', 'northstarRestoredV1_northstarModuleLayout', 'northstarRestoredV1_northstarTabOrder', 'northstarRestoredV1_northstarClosedOverviewModules', 'northstarRestoredV1_northstarAssetEditorV1', 'northstarRestoredV1_northstarAssetEditorV1Dock'];
  let snapshotError = false;
  try {
    if (!localStorage.getItem(snapshotKey)) {
      const preferences = {};
      keys.flatMap(key => [key, key + 'Saved']).forEach(key => { preferences[key] = localStorage.getItem(key); });
      localStorage.setItem(snapshotKey, JSON.stringify({capturedAt: new Date().toISOString(), sourceBuild: 'v0.151', preferences}));
    }
  } catch { snapshotError = true; }
  document.addEventListener('DOMContentLoaded', () => {
    if (detached) return;
    const nav = document.getElementById('sideNav');
    if (!nav) return;
    const folder = document.createElement('details');
    folder.id = 'nsDevelopmentFolder'; folder.open = !!mode;
    folder.innerHTML = '<summary><span class="nav-label">dev</span></summary><a data-development-view="overview">New Overview</a><a data-development-view="fixed">New fixed dashboard</a><button type="button" data-development-export>Download configuration snapshot</button>';
    folder.querySelectorAll('[data-development-view]').forEach(link => {
      const url = new URL(location.href);
      url.searchParams.set('nsDevelopment', link.dataset.developmentView); url.hash = 'overview';
      link.href = url.href;
      if (link.dataset.developmentView === mode) link.setAttribute('aria-current', 'page');
    });
    folder.querySelector('[data-development-export]').onclick = () => {
      const snapshot = localStorage.getItem(snapshotKey);
      if (!snapshot) { alert('Configuration snapshot is unavailable. Browser storage may be disabled.'); return; }
      const url = URL.createObjectURL(new Blob([snapshot], {type: 'application/json'}));
      const link = document.createElement('a'); link.href = url; link.download = 'northstar-development-configuration-20260930.json'; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    };
    if (snapshotError) folder.insertAdjacentHTML('beforeend', '<small>Browser configuration backup unavailable.</small>');
    nav.append(folder);
    // Leaving Development returns to the ordinary section without changing its handlers.
    nav.addEventListener('click', event => {
      const button = event.target.closest('[data-tab]');
      if (!mode || !button || !event.isTrusted) return;
      event.preventDefault(); event.stopImmediatePropagation();
      const url = new URL(location.href); url.searchParams.delete('nsDevelopment'); url.hash = button.dataset.tab;
      location.assign(url.href);
    }, true);
  });
})();
