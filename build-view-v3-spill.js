/* V3-only source qualification for the existing mock spill inventory. */
(() => {
  'use strict';
  const roots = ['spillRaftLake', 'spillNamakanLake', 'spillSluiceGates'];
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  let scheduled = false;

  function render() {
    if (!document.body.classList.contains('ns-build-v3')) return;
    for (const id of roots) {
      const root = document.getElementById(id);
      if (!root) continue;
      let strip = root.querySelector('.bv3-spill-source');
      if (!strip) {
        strip = document.createElement('div');
        strip.className = 'bv3-spill-source';
        strip.setAttribute('aria-label', 'Qualified water readings');
        root.querySelector('.spill-summary')?.after(strip);
      }
      const deviceId = root.querySelector('[data-spill-device]')?.dataset.spillDevice || '';
      // The existing gate inventory carries the canonical station ID. Lake
      // mocks do not, and public lake gauges are not plant-headwater bindings.
      const match = /^(site:[a-z0-9-]+):gate:\d+$/.exec(deviceId);
      const model = match ? window.NorthStarGeneratingStations?.telemetry(match[1]) : null;
      const reading = model?.reading?.('Headwater level', 'm');
      const hw = !model?.baseline && typeof reading?.numericValue === 'number' && Number.isFinite(reading.numericValue) ? reading.numericValue : null;
      const time = reading?.observedAt && Number.isFinite(Date.parse(reading.observedAt)) ? new Date(reading.observedAt).toLocaleTimeString('en-CA', {timeZone:'America/Toronto',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}) + ' ET' : '';
      const source = hw === null ? 'No qualified plant headwater binding' : `${reading.tagName || 'Headwater level'} · ${time} · quality ${reading.sourceQuality}`;
      const markup = `<div><span>Plant headwater</span><strong>${hw === null ? 'Unavailable' : hw.toFixed(3) + ' m'}</strong></div><div><span>Measured bay flow</span><strong>Unavailable</strong></div><p title="${esc(source)}">${esc(source)}. Bay flow and water height are not inferred from log count; a reviewed bay binding or calibrated rating curve is required.</p>`;
      if (strip.innerHTML !== markup) strip.innerHTML = markup;
      for (const device of root.querySelectorAll('[data-spill-device]')) {
        let marker = device.querySelector('.bv3-spill-bay-source');
        if (!marker) {
          marker = document.createElement('p'); marker.className = 'bv3-spill-bay-source';
          device.querySelector('.spill-readings')?.after(marker);
        }
        const text = 'Bay flow unavailable · mock position';
        if (marker.textContent !== text) marker.textContent = text;
      }
    }
  }

  function schedule() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => { scheduled = false; render(); });
  }

  function init() {
    const style = document.createElement('style');
    style.id = 'bv3SpillQualifiedStyle';
    style.textContent = '.bv3-spill-source,.bv3-spill-bay-source{display:none}body.ns-build-v3 .bv3-spill-source{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px 16px;margin:10px 0 14px;padding:10px 12px;border:1px solid var(--line,#30434e);border-radius:4px}body.ns-build-v3 .bv3-spill-source>div{display:flex;align-items:center;gap:9px;min-width:0;white-space:nowrap}body.ns-build-v3 .bv3-spill-source span{font-size:10px;color:var(--muted,#a7bac6)}body.ns-build-v3 .bv3-spill-source strong{font-size:12px;overflow:hidden;text-overflow:ellipsis}body.ns-build-v3 .bv3-spill-source p{grid-column:1/-1;margin:0;color:var(--muted,#a7bac6);font-size:10px;line-height:1.5}body.ns-build-v3 .bv3-spill-bay-source{display:block;margin:8px 0 0;color:var(--muted,#a7bac6);font-size:10px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}@media(max-width:760px){body.ns-build-v3 .bv3-spill-source{grid-template-columns:minmax(0,1fr)}}';
    document.head.append(style);
    const main = document.querySelector('main');
    if (main) new MutationObserver(schedule).observe(main, {childList:true,subtree:true});
    new MutationObserver(schedule).observe(document.body, {attributes:true,attributeFilter:['class']});
    window.addEventListener('northstar:feed-update', schedule);
    window.addEventListener('northstar:build-view-change', schedule);
    setInterval(() => { if (!document.hidden) schedule(); }, 30000);
    window.NorthStarBuildV3Spill = {refresh:schedule};
    schedule();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, {once:true}); else init();
})();
