(() => {
  const status = document.querySelector('#mobileFeedStatus');
  const summary = document.querySelector('#mobileSummary');
  const workers = document.querySelector('#mobileWorkers');
  const overviewSummary = document.querySelector('#overviewTrackerSummary');
  const overviewWorkers = document.querySelector('#overviewTrackerWorkers');
  if (!status || !summary || !workers) return;

  const esc = value => String(value ?? '').replace(/[<>&"]/g, char => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[char]));
  const time = value => value ? new Date(value).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }) : '—';
  const hasGps = row => Number.isFinite(Number(row.latitude)) && Number.isFinite(Number(row.longitude)) && !(Number(row.latitude) === 0 && Number(row.longitude) === 0);
  const location = row => hasGps(row)
    ? `<a target="_blank" rel="noopener" href="https://maps.google.com/?q=${Number(row.latitude)},${Number(row.longitude)}">${Number(row.latitude).toFixed(5)}, ${Number(row.longitude).toFixed(5)} ↗</a>`
    : '<span class="muted-note">NO CONSENTED GPS</span>';

  function renderOverview(active, gps, help, overdue) {
    if (!overviewSummary || !overviewWorkers) return;
    overviewSummary.innerHTML = `<div><span>ACTIVE</span><b>${active.length}</b></div><div><span>GPS</span><b>${gps}/${active.length || 0}</b></div><div><span>HELP</span><b class="${help ? 'alert' : ''}">${help}</b></div><div><span>OVERDUE</span><b class="${overdue ? 'alert' : ''}">${overdue}</b></div>`;
    const ordered = [...active].sort((a, b) => Number(Boolean(b.needsHelp)) - Number(Boolean(a.needsHelp)) || Number(Boolean(b.overdue)) - Number(Boolean(a.overdue)));
    overviewWorkers.innerHTML = ordered.length ? ordered.slice(0, 6).map(row => {
      const alert = row.needsHelp || row.overdue;
      const state = row.needsHelp ? 'NEEDS HELP' : row.overdue ? 'OVERDUE' : String(row.status || 'ACTIVE').toUpperCase();
      return `<article class="overview-tracker-worker ${alert ? 'alert' : ''}"><strong>${esc(row.name)}</strong><em>${state}</em><small>${esc(row.site)} · LAST ${time(row.lastHeard)} · ${location(row)}</small></article>`;
    }).join('') : '<div class="muted-note">NO ACTIVE FIELD DEVICES</div>';
  }

  function render(rows) {
    const active = rows.filter(row => row.status !== 'checked-out');
    const gps = active.filter(hasGps).length;
    const help = active.filter(row => row.needsHelp).length;
    const overdue = active.filter(row => row.overdue).length;
    renderOverview(active, gps, help, overdue);
    summary.innerHTML = `<div><span>ACTIVE DEVICES</span><b>${active.length}</b></div><div><span>GPS SHARING</span><b>${gps}/${active.length || 0}</b></div><div><span>HELP</span><b class="${help ? 'mobile-danger' : ''}">${help}</b></div><div><span>OVERDUE</span><b class="${overdue ? 'mobile-danger' : ''}">${overdue}</b></div>`;
    workers.innerHTML = active.length ? active.map(row => `<article class="mobile-worker ${row.needsHelp || row.overdue ? 'mobile-worker-alert' : ''}"><div class="mobile-worker-head"><div><strong>${esc(row.name)}</strong><small>${esc(row.kind || 'Worker')} · ${esc(row.company || 'NorthStar')} · ${esc(row.site)}</small></div><b>${row.needsHelp ? 'NEEDS HELP' : row.overdue ? 'OVERDUE' : String(row.status || 'ACTIVE').toUpperCase()}</b></div><div class="mobile-worker-grid"><span><label>LAST HEARTBEAT</label>${time(row.lastHeard)}</span><span><label>GPS LOCATION</label>${location(row)}</span><span><label>SESSION</label>${row.expectedMinutes ? `${row.expectedMinutes} MIN EXPECTED` : 'NO DEADLINE'}</span><span><label>HELP STATE</label>${esc(row.helpState || 'NONE').toUpperCase()}</span></div><button class="mobile-history" data-history="${esc(row.id)}">VIEW RECENT HISTORY</button><div class="mobile-history-output" data-history-output="${esc(row.id)}" hidden></div></article>`).join('') : '<div class="muted-note">NO ACTIVE MOBILE WORKERS</div>';
    workers.querySelectorAll('[data-history]').forEach(button => button.onclick = async () => {
      const output = workers.querySelector(`[data-history-output="${button.dataset.history}"]`);
      button.disabled = true;
      try {
        const response = await fetch(`/api/checkins/history?id=${encodeURIComponent(button.dataset.history)}&limit=8`);
        const history = await response.json();
        output.hidden = false;
        output.innerHTML = (Array.isArray(history) ? history : []).map(item => `<div>${time(item.at || item.timestamp)} · ${esc(item.event || item.type || 'EVENT')} · ${esc(item.details || '')}</div>`).join('') || 'NO RECENT HISTORY';
      } catch { output.hidden = false; output.textContent = 'HISTORY UNAVAILABLE'; }
      button.disabled = false;
    });
  }

  async function load() {
    try {
      const response = await fetch('/api/checkins?ts=' + Date.now(), { cache: 'no-store' });
      if (!response.ok) throw new Error('HTTP ' + response.status);
      render(await response.json());
      status.textContent = 'LIVE · REFRESH 30 SEC';
    } catch (error) {
      if (overviewWorkers) overviewWorkers.innerHTML = `<div class="muted-note">Field tracker unavailable: ${esc(error.message)}</div>`;
      status.textContent = 'FEED ERROR';
      workers.innerHTML = `<div class="muted-note">Mobile feed unavailable — ${esc(error.message)}</div>`;
    }
  }

  const style = document.createElement('style');
  style.textContent = '.mobile-summary{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin:14px 0}.mobile-summary>div,.mobile-capabilities>div{background:#0b161d;border:1px solid #2d4652;border-radius:5px;padding:10px}.mobile-summary span,.mobile-capabilities b,.mobile-worker-grid label{display:block;color:#7faabd;font:calc(8px * var(--ns-font-scale, 1)) monospace;letter-spacing:.6px}.mobile-summary b{display:block;color:#65c6a3;font:700 calc(20px * var(--ns-font-scale, 1)) monospace;margin-top:4px}.mobile-summary .mobile-danger,.mobile-worker-alert .mobile-worker-head>b{color:#ff766d}.mobile-workers{display:grid;gap:8px}.mobile-worker{background:#101c25;border:1px solid #2d4652;border-radius:6px;padding:11px}.mobile-worker-alert{border-color:#b54c4c;box-shadow:0 0 0 1px #b54c4c44}.mobile-worker-head{display:flex;justify-content:space-between;gap:12px}.mobile-worker-head strong{display:block;color:#fff;font:700 calc(14px * var(--ns-font-scale, 1)) monospace}.mobile-worker-head small{display:block;color:#8fa5ae;font:calc(9px * var(--ns-font-scale, 1)) monospace;margin-top:3px}.mobile-worker-head>b{color:#65c6a3;font:700 calc(9px * var(--ns-font-scale, 1)) monospace}.mobile-worker-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-top:12px}.mobile-worker-grid span{color:#d6e6ed;font:calc(10px * var(--ns-font-scale, 1)) monospace}.mobile-worker-grid label{margin-bottom:4px}.mobile-worker-grid a{color:#e6b85c}.mobile-history{margin-top:10px;background:#172a34;border:1px solid #39505b;color:#d6e6ed;border-radius:4px;padding:6px 8px;font:calc(9px * var(--ns-font-scale, 1)) monospace}.mobile-history-output{margin-top:8px;padding-top:8px;border-top:1px solid #2d4652;color:#9cb2bb;font:calc(9px * var(--ns-font-scale, 1))/1.6 monospace}.mobile-capabilities{display:grid;gap:7px}.mobile-capabilities span{display:block;color:#d6e6ed;font:calc(10px * var(--ns-font-scale, 1)) monospace;margin-top:4px}.mobile-checkin-link{display:inline-block;margin-top:12px;text-decoration:none}@media(max-width:700px){.mobile-summary{grid-template-columns:repeat(2,1fr)}.mobile-worker-grid{grid-template-columns:repeat(2,1fr)}.mobile-worker-head{align-items:flex-start;flex-direction:column;gap:5px}}';
  document.head.append(style);
  load();
  setInterval(load, 30000);
})();
