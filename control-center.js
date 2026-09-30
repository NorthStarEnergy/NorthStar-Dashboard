(() => {
  const $ = id => document.getElementById(id);
  const labels = { launch: 'Launch', restart: 'Restart', stop: 'Stop', update: 'Update', backup: 'Backup', rollback: 'Rollback' };
  const capabilityNames = ['status', 'launch', 'restart', 'stop', 'backup', 'update', 'rollback'];
  const targetLabel = target => target === 'production' ? 'Production' : 'Local';
  function paintTarget(target, payload) {
    const state = $(target + 'State'); const details = $(target + 'Details');
    const healthy = Boolean(payload?.health?.status === 'healthy' || payload?.health?.database?.ok);
    state.textContent = healthy ? 'HEALTHY' : 'UNAVAILABLE'; state.className = 'state ' + (healthy ? 'ok' : 'bad');
    const health = payload?.health || {}; details.innerHTML = [['SERVICE', health.status || 'unavailable'], ['API', payload?.apiVersion || 'unknown'], ['AGENT', payload?.managementAgent?.state || 'unknown']].map(([k,v]) => `<div><dt>${k}</dt><dd>${String(v)}</dd></div>`).join('');
    if (target === 'local') paintCapabilities(payload?.capabilities || {});
  }
  function paintCapabilities(capabilities) { $('capabilityGrid').innerHTML = capabilityNames.map(name => { const enabled = Boolean(capabilities[name]); return `<div class="capability ${enabled ? '' : 'disabled'}"><strong>${name === 'status' ? 'STATUS' : labels[name].toUpperCase()}</strong><span>${enabled ? 'Available' : 'Not enabled'}</span></div>`; }).join(''); }
  async function load(target) { try { const response = await fetch('/api/control-center/status?target=' + encodeURIComponent(target), { credentials: 'same-origin', cache: 'no-store' }); const payload = await response.json(); if (response.status === 401 || payload.loginRequired) { $('sessionState').textContent = 'SIGN-IN REQUIRED'; $('sessionState').className = 'pill bad'; $('notice').hidden = false; $('notice').textContent = 'Sign in through the NorthStar operator login before using Control Center.'; return; } if (!response.ok) throw Error(payload.error || `HTTP ${response.status}`); paintTarget(target, payload); $('sessionState').textContent = 'AUTHENTICATED'; $('sessionState').className = 'pill ok'; } catch (error) { $(target + 'State').textContent = 'UNAVAILABLE'; $(target + 'State').className = 'state bad'; $(target + 'Details').innerHTML = `<div><dt>ERROR</dt><dd>${error.message}</dd></div>`; } }
  function refresh() { load('local'); load('production'); }
  $('refreshButton').onclick = refresh; document.querySelectorAll('[data-action="refresh"]').forEach(button => button.onclick = () => load(button.dataset.target)); refresh(); setInterval(refresh, 30000);
})();
