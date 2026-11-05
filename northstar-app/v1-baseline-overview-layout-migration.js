/* Migrate only the overlapping main-page layouts; keep other workspace preferences. */
(() => {
  if (window.NorthstarLayoutPersistence) return; // The account checkpoint is already authoritative.
  const version = '20260911-flow-1';
  try {
    if (localStorage.getItem('northstarOverviewLayoutVersion') === version) return;
    for (const key of ['northstarRestoredV1_northstarModuleLayout', 'northstarRestoredV1_northstarModuleLayoutSaved']) {
      const raw = localStorage.getItem(key);
      if (raw) localStorage.setItem(key + ':before-flow-1', raw);
      let layout;
      try { layout = JSON.parse(raw || '{}'); } catch { layout = {}; }
      if (!layout || Array.isArray(layout) || typeof layout !== 'object') layout = {};
      for (const zone of ['overview', 'command', 'marketTop', 'weatherStrip', 'staff']) {
        layout[zone] = { order: [], size: {}, position: {} };
      }
      localStorage.setItem(key, JSON.stringify(layout));
    }
    for (const key of ['northstarRestoredV1_northstarClosedOverviewModules', 'northstarRestoredV1_northstarClosedOverviewModulesSaved']) {
      let closed;
      try { closed = JSON.parse(localStorage.getItem(key) || '[]'); } catch { closed = []; }
      localStorage.setItem(key, JSON.stringify((Array.isArray(closed) ? closed : [])
        .filter(id => !['overview-staff', 'overview-field-tracker'].includes(id))));
    }
    localStorage.setItem('northstarOverviewLayoutVersion', version);
  } catch { /* The responsive defaults also work when browser storage is unavailable. */ }
})();
