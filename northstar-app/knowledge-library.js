(() => {
  'use strict';
  const $ = selector => document.querySelector(selector);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  let sources = [], selected = new URLSearchParams(location.search).get('source') || '', statuses = [];
  const notice = (text, error = false) => { $('#notice').textContent = text; $('#notice').classList.toggle('error', error); };
  async function api(path, payload) {
    const response = await fetch(path, payload ? {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)} : {cache:'no-store'});
    const data = await response.json(); if (!response.ok) throw new Error(data.error || 'Request failed'); return data;
  }
  function render() {
    const filter = $('#filter').value.toLowerCase(), status = $('#status').value;
    const rows = sources.filter(s => (!status || s.status === status) && [s.title,s.revision,s.owner,s.source_key].join(' ').toLowerCase().includes(filter));
    $('#count').textContent = `(${rows.length})`;
    $('#sources').innerHTML = rows.map(s => `<button class="source" data-source="${esc(s.id)}" aria-current="${s.id === selected}"><strong>${esc(s.title)}</strong><span class="badge">${esc(s.status)}${s.status === 'CURRENT_CONTROLLED' && !s.aiEligible ? ' · Dates/approval not eligible' : ''}</span><small>${esc(s.siteName)} · Rev ${esc(s.revision || 'Unverified')}</small></button>`).join('') || '<p>No sources match this filter.</p>';
  }
  async function load() {
    const data = await api('/api/ai/knowledge?siteId=' + encodeURIComponent($('#plant').value));
    sources = data.sources; statuses = data.statuses;
    if ($('#plant').options.length === 1) {
      const options = data.sites.map(s => `<option value="${esc(s.id)}">${esc(s.name)}</option>`).join('');
      $('#plant').insertAdjacentHTML('beforeend',options); $('#uploadPlant').insertAdjacentHTML('beforeend',options);
      $('#status').insertAdjacentHTML('beforeend',statuses.map(s => `<option>${esc(s)}</option>`).join(''));
    }
    render(); notice(`${data.status.currentSources} current source(s) eligible for AI. ${data.status.passages} indexed passages. Recorded facts are queried when needed.`);
  }
  function originalLink(href) { try { const url = new URL(href, location.href); return url.origin === location.origin ? url.pathname + url.search : ''; } catch { return ''; } }
  async function open(id) {
    const source = await api('/api/ai/knowledge/sources/' + encodeURIComponent(id)); selected = id; render();
    history.replaceState(null,'','?source=' + encodeURIComponent(id) + location.hash);
    const metadata = {Plant:source.siteName,Status:source.status,Revision:source.revision,Owner:source.owner,'Effective from':source.effective_from,'Expires':source.effective_to,'Review due':source.review_due,'Approved by':source.approved_by,'Approved at':source.approved_at,'Document identity':source.source_key,Integrity:source.integrity,SHA256:source.sha256};
    const file = originalLink(source.fileHref);
    $('#detail').innerHTML = `<h2>${esc(source.title)}</h2>${file ? `<a href="${esc(file)}" target="_blank" rel="noopener">Open original document</a>` : ''}<dl>${Object.entries(metadata).map(([k,v]) => `<dt>${esc(k)}</dt><dd>${esc(v || 'Not recorded')}</dd>`).join('')}</dl>` +
      (source.status === 'LEGACY_REFERENCE' ? '<p>Legacy reference: obtain a separately controlled current document before it can support AI answers.</p>' : `<details><summary>Record human review</summary><form class="review" id="review"><div class="fields"><label>Status<select name="status">${statuses.filter(s => s !== 'LEGACY_REFERENCE').map(s => `<option ${s === source.status ? 'selected' : ''}>${esc(s)}</option>`).join('')}</select></label><label>Owner<input name="owner" value="${esc(source.owner)}"></label><label>Revision<input name="revision" required readonly value="${esc(source.revision)}"></label>${['effective_from','effective_to','review_due'].map(f => `<label>${esc(f.replaceAll('_',' '))}<input name="${f}" type="date" value="${esc((source[f] || '').slice(0,10))}"></label>`).join('')}</div><label>Review reason<textarea name="reason" required maxlength="1000"></textarea></label><label class="confirm"><input name="confirmed" type="checkbox">I have verified the original, owner, revision, dates, and current controlled status.</label><button>Record review</button></form></details>`) +
      `<h3>Review history</h3>${source.reviews.map(r => `<p>${esc(r.at)} · ${esc(r.actor)} · ${esc(r.status)}<small>${esc(r.reason)}</small></p>`).join('') || '<p>No review recorded.</p>'}<h3>Indexed passages</h3>${source.passages.map(p => `<article class="passage" id="passage-${p.ordinal}"><h4>${esc(p.section)} · ${p.ordinal}</h4><pre>${esc(p.text)}</pre></article>`).join('') || '<p>Not indexed for AI.</p>'}`;
    $('#review')?.addEventListener('submit', e => action(e, async form => { const payload = Object.fromEntries(new FormData(form)); payload.confirmed = form.elements.confirmed.checked; payload.expectedStatus = source.status; await api(source.href + '/review',payload); await load(); await open(id); notice('Human review recorded. Eligibility also depends on current effective and review dates.'); }));
    if (location.hash) document.getElementById(location.hash.slice(1))?.scrollIntoView();
  }
  async function action(event, work) { event.preventDefault(); const form = event.currentTarget, button = form.querySelector('button'); button.disabled = true; try { await work(form); } catch(e) { notice(e.message,true); } finally { button.disabled = false; } }
  $('#upload').addEventListener('submit', e => action(e, async form => {
    const file = form.elements.file.files[0]; if (!file || file.size > 5*1024*1024) throw new Error('Choose a document no larger than 5 MB.');
    const contentBase64 = await new Promise((resolve,reject) => {const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(',')[1]); reader.onerror = reject; reader.readAsDataURL(file);});
    const payload = Object.fromEntries(new FormData(form)); delete payload.file;
    const source = await api('/api/ai/knowledge/upload',{...payload,filename:file.name,contentBase64}); form.reset(); await load(); await open(source.id); notice('Uploaded. Pending sources are excluded from AI until reviewed.');
  }));
  $('#sources').addEventListener('click', e => {const button = e.target.closest('[data-source]'); if (button) open(button.dataset.source).catch(e => notice(e.message,true));});
  $('#refresh').addEventListener('click', () => load().catch(e => notice(e.message,true)));
  $('#plant').addEventListener('change', () => {selected = ''; $('#detail').innerHTML = '<h2>Select a source</h2>'; load().catch(e => notice(e.message,true));});
  for (const id of ['filter','status']) $('#' + id).addEventListener('input',render);
  load().then(async () => {
    const record = new URLSearchParams(location.search).get('record');
    if (record) {
      const parts = record.split('/');
      if (parts.length !== 2) throw new Error('Invalid recorded source link');
      const evidence = await api('/api/ai/knowledge/records/' + parts.map(encodeURIComponent).join('/'));
      $('#detail').innerHTML = `<h2>${esc(evidence.title)}</h2><p>${esc(evidence.authorityStatus)} · Recorded ${esc(evidence.recorded_at || 'date unknown')}<br>Retrieved ${esc(evidence.retrieved_at)}</p><p>Recorded facts describe observations; they are not current procedure authority or live telemetry.</p><pre>${esc(evidence.excerpt)}</pre><small>${esc(evidence.source)}</small>`;
    } else if (selected) await open(selected);
  }).catch(e => notice(e.message,true));
})();
