/* Explicit dashboard checkpoints: Ryan publishes; other accounts save locally. */
(() => {
  'use strict';
  const keys = ['northstarRestoredV1_northstarModuleLayout','northstarRestoredV1_northstarOverviewProfilesV2','northstarRestoredV1_northstarCanvasLayoutV1',
    'northstarRestoredV1_northstarStatusLayoutV1','northstarRestoredV1_northstarModuleWorkspaceV1','northstarRestoredV1_northstarAssetEditorV1',
    'northstarRestoredV1_northstarTabOrder','northstarRestoredV1_northstarClosedOverviewModules','northstarRestoredV1_northstarUiStyle','northstarRestoredV1_northstarFixedMarketBorderStyleV1'];
  const copy = value => JSON.parse(JSON.stringify(value));
  const read = key => localStorage.getItem(key);
  const capture = () => Object.fromEntries(keys.map(key => [key, read(key)]));
  let checkpoint, account, personalKey, saving = false;
  function status(message) {
    let node = document.getElementById('nsLayoutSaveStatus');
    if (!node) {
      node = document.createElement('div'); node.id = 'nsLayoutSaveStatus'; node.setAttribute('role','status');
      node.style.cssText = 'position:fixed;bottom:12px;right:16px;z-index:100000;background:#14242f;color:white;padding:8px 12px;border-radius:6px';
      document.body.append(node);
    }
    node.textContent = message;
  }
  function apply(values) {
    keys.forEach(key => {
      const value = values[key];
      for (const target of [key, key + 'Saved']) {
        if (value == null) localStorage.removeItem(target);
        else localStorage.setItem(target, value);
      }
    });
  }
  function baseline(d) {
    const values = Object.fromEntries(keys.map(key => [key, null]));
    const seed = {northstarRestoredV1_northstarModuleLayout:d.layout || {}, northstarRestoredV1_northstarStatusLayoutV1:d.statusLayout,
      northstarRestoredV1_northstarModuleWorkspaceV1:d.moduleWorkspace, northstarRestoredV1_northstarTabOrder:d.preferences?.tabOrder || [],
      northstarRestoredV1_northstarClosedOverviewModules:d.preferences?.closedOverview || []};
    Object.entries(seed).forEach(([key,value]) => { if (value != null) values[key] = JSON.stringify(value); });
    keys.forEach(key => { if (Object.hasOwn(d.layoutStorage || {}, key)) values[key] = d.layoutStorage[key]; });
    return values;
  }
  const isOwner = () => false; // Restored v1 saves only its isolated account checkpoint.
  async function save() {
    if (saving) return;
    saving = true;
    status('Saving layout…');
    const next = capture();
    try {
      if (!account?.authenticated || !account.username) throw new Error('Sign in before saving a layout.');
      if (isOwner()) {
        const json = key => JSON.parse(next[key] || 'null');
        const response = await fetch('/api/dashboard-layout-default', {method:'POST',
          headers:{'Content-Type':'application/json'}, body:JSON.stringify({
            layout:json('northstarRestoredV1_northstarModuleLayout') || {}, statusLayout:json('northstarRestoredV1_northstarStatusLayoutV1'),
            moduleWorkspace:json('northstarRestoredV1_northstarModuleWorkspaceV1'), layoutStorage:next,
            preferences:{tabOrder:json('northstarRestoredV1_northstarTabOrder') || [], closedOverview:json('northstarRestoredV1_northstarClosedOverviewModules') || []}
          })});
        const result = await response.json();
        if (!response.ok || !result.saved) throw new Error(result.error || 'Shared layout was not saved.');
      } else localStorage.setItem(personalKey, JSON.stringify(next));
      checkpoint = copy(next);
      keys.forEach(key => next[key] == null ? localStorage.removeItem(key+'Saved') : localStorage.setItem(key+'Saved',next[key]));
      window.dispatchEvent(new CustomEvent('northstar:layout-saved', {detail:{shared:isOwner()}}));
      status(isOwner() ? 'Shared layout saved for all clients.' : 'Layout saved for this account in this browser.');
    } catch (error) {
      keys.forEach(key => checkpoint[key] == null ? localStorage.removeItem(key+'Saved') : localStorage.setItem(key+'Saved',checkpoint[key]));
      alert('Layout save failed: ' + error.message + ' Your changes are still open; retry Save.');
      status('Save failed. Retry Save to keep these changes.');
      document.body.classList.add('layout-edit');
      document.querySelector('.layout-toolbar')?.classList.add('editing');
    } finally { saving = false; }
  }
  function bootstrap(d) {
    window.northstarLayoutReady = Promise.resolve(window.northstarOperatorSession).then(session => {
      account = session;
      // Preserve the old unscoped browser state without assigning it to another account.
      const backup = 'northstarRestoredV1_northstarLayoutLegacyBackupV1';
      if (!read(backup)) localStorage.setItem(backup, JSON.stringify(Object.fromEntries(keys.flatMap(key => [key,key+'Saved']).map(key => [key,read(key)]))));
      personalKey = 'northstarRestoredV1_northstarLayoutAccountV1:' + encodeURIComponent(String(account?.username || '').toLowerCase());
      let personal;
      try { personal = JSON.parse(read(personalKey) || 'null'); } catch {}
      checkpoint = baseline(d);
      if (!isOwner() && account?.authenticated && personal && typeof personal === 'object') {
        keys.forEach(key => { if (Object.hasOwn(personal,key)) checkpoint[key] = personal[key]; });
      }
      apply(checkpoint);
      const ready = () => {
        const order = JSON.parse(checkpoint.northstarRestoredV1_northstarTabOrder || '[]');
        const nav = document.getElementById('sideNav');
        if (nav) [...nav.querySelectorAll(':scope > [data-tab]')].sort((a,b) => {
          const rank = node => { const index = order.indexOf(node.dataset.tab); return index < 0 ? 999 : index; };
          return rank(a)-rank(b);
        }).forEach(button => nav.append(button));
        const theme = checkpoint.northstarRestoredV1_northstarUiStyle;
        if (theme && theme !== 'default') document.body.dataset.theme = theme;
        else if (theme === 'default') document.body.removeAttribute('data-theme');
      };
      if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded',ready,{once:true}); else ready();
    });
    return window.northstarLayoutReady;
  }
  document.addEventListener('click', event => {
    if (event.target.closest('.layout-reset')) {
      event.preventDefault(); event.stopImmediatePropagation();
      if (saving || !checkpoint || !confirm('Restore the most recently saved UI layout?')) return;
      apply(checkpoint); location.reload();
    } else if (event.target.closest('.layout-save')) {
      if (saving || !checkpoint) { event.preventDefault(); event.stopImmediatePropagation(); return; }
      // Geometry/asset listeners flush their state first; publish one complete checkpoint.
      setTimeout(save, 0);
    }
  }, true);
  window.NorthstarLayoutPersistence = {bootstrap, save, keys};
})();
