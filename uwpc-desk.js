(() => {
  'use strict';
  const api = '/api/uwpc/requests';
  const labels = {REQUEST_GUARANTEE:'Request supporting guarantee', PROVIDE_GUARANTEE:'Provide supporting guarantee', SWITCHING_PLAN:'Switching plan'};
  const status = value => String(value || '').replaceAll('_', ' ');
  const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const when = value => value ? new Date(value).toLocaleString() : 'Not scheduled';
  let root, current = null, records = [], operators = [], actor = '', busy = false, dirty = false, legacy = [], legacyError = '';
  const $ = id => document.getElementById(id);
  async function request(url, method = 'GET', body) {
    const response = await fetch(url, {method, credentials:'same-origin', cache:'no-store',
      ...(body ? {headers:{'Content-Type':'application/json'}, body:JSON.stringify(body)} : {})});
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);
    return data;
  }
  function notice(text, error = false) {
    $('uwpcDeskStatus').textContent = text;
    $('uwpcDeskStatus').classList.toggle('error', error);
  }
  async function run(work) {
    if (busy) return;
    busy = true; root.setAttribute('aria-busy','true');
    root.querySelectorAll('button').forEach(b => {b.dataset.wasDisabled = String(b.disabled); b.disabled = true;});
    try { await work(); } catch (error) { notice(error.message, true); }
    finally {
      busy = false; root.removeAttribute('aria-busy');
      root.querySelectorAll('button[data-was-disabled]').forEach(b => {b.disabled = b.dataset.wasDisabled === 'true'; delete b.dataset.wasDisabled;});
    }
  }
  function rows(items) {
    if (!items.length) return '<p class="uwpc-empty">No records in this list.</p>';
    return `<div class="uwpc-table-wrap"><table><thead><tr><th>Request / plan</th><th>Site / equipment</th><th>Schedule</th><th>Status</th><th></th></tr></thead><tbody>${items.map(r => `<tr>
      <td><strong>${esc(r.title)}</strong><small>${esc(labels[r.kind])}</small></td>
      <td>${esc(r.site)}<small>${esc(r.asset)}</small></td><td>${esc(when(r.start))}<small>${r.end ? esc(when(r.end)) : ''}</small></td>
      <td><span class="uwpc-status-pill">${esc(status(r.status))}</span><small>${esc(status(r.phase))}</small></td>
      <td><button type="button" data-request="${esc(r.id)}">Open</button></td></tr>`).join('')}</tbody></table></div>`;
  }
  function drawLists() {
    $('uwpcActivePlans').innerHTML = rows(records.filter(r => !['COMPLETED','CANCELLED'].includes(r.phase)));
    $('uwpcPastPlans').innerHTML = rows(records.filter(r => ['COMPLETED','CANCELLED'].includes(r.phase)));
    const inbox = records.filter(r => r.status === 'PENDING_SIGNOFF' && r.review?.operators.includes(actor) && !r.review.decisions.some(d => d.actor === actor));
    $('uwpcOperatorInbox').innerHTML = rows(inbox);
    $('uwpcInboxCount').textContent = String(inbox.length);
    const badge = $('uwpcGlobalInbox');
    if (badge) {badge.hidden = !inbox.length; badge.textContent = `UWPC sign-off (${inbox.length})`;}
    $('uwpcLegacyPlans').innerHTML = legacyError ? `<p class="error">${esc(legacyError)}</p>` : legacy.length ? legacy.map(r => `<p><button type="button" data-legacy="${esc(r.id)}">${esc(r.packageName || r.id)}</button> · ${esc(r.site)} · ${esc(r.status)}</p>`).join('') : '<p class="uwpc-empty">No legacy draft plans.</p>';
  }
  async function refresh() {
    const data = await request(api);
    records = data.requests; operators = data.operators; actor = data.actor;
    drawLists();
    $('uwpcAuthorityRecords').innerHTML = (data.correspondence || []).map(e => `<article class="uwpc-history"><strong>${esc(status(e.detail.direction))} · ${esc(e.detail.authority)}</strong><small>${esc(when(e.detail.occurredAt))} · ${esc(e.detail.reference)} · ${esc(e.actor)}</small><p>${esc(e.detail.message)}</p><button type="button" data-request="${esc(e.request_id)}">Open linked request</button></article>`).join('') || '<p class="uwpc-empty">No authority correspondence recorded.</p>';
  }
  function dateValue(value) {
    if (!value) return '';
    const date = new Date(value);
    return new Date(date - date.getTimezoneOffset() * 60000).toISOString().slice(0,16);
  }
  function input(name, label, type = 'text', value = '') {
    return `<label>${label}<input name="${name}" type="${type}" value="${esc(value)}" ${['title','site'].includes(name) ? 'required' : ''}></label>`;
  }
  function show(record) {
    current = record;
    dirty = false;
    const r = record || {kind:'REQUEST_GUARANTEE', template:'pc2-sg', phase:'FUTURE', sources:[]};
    const review = r.review;
    const canSign = r.status === 'PENDING_SIGNOFF' && review?.operators.includes(actor) && !review.decisions.some(d => d.actor === actor);
    $('uwpcEditor').hidden = false;
    $('uwpcEditor').innerHTML = `<div class="uwpc-head"><div><small>${r.id ? esc(r.id) + ' · revision ' + r.version : 'NEW REQUEST'}</small><h3>${r.id ? esc(r.title) : 'Create a UWPC request'}</h3></div><button type="button" data-action="close">Close</button></div>
      <form id="uwpcRequestForm"><div class="uwpc-fields">
      ${input('title','Request title','text',r.title)}${input('site','Station / site','text',r.site)}${input('asset','Equipment / circuit','text',r.asset)}
      <label>Request type<select name="kind">${Object.entries(labels).map(([v,l]) => `<option value="${v}" ${v===r.kind?'selected':''}>${l}</option>`).join('')}</select></label>
      <label>UWPC form<select name="template">${['pc10c-sg','pc17b-sg','pc2-sg','pc17a'].map(v => `<option value="${v}" ${v===r.template?'selected':''}>${v.toUpperCase()}</option>`).join('')}</select></label>
      ${input('authority','Controlling authority','text',r.authority)}${input('reference','Authority / permit reference','text',r.reference)}${input('diagramRevision','Circuit diagram revision','text',r.diagramRevision)}
      ${input('start','Planned start (local time)','datetime-local',dateValue(r.start))}${input('end','Planned end (local time)','datetime-local',dateValue(r.end))}
      <label class="uwpc-wide">Request / work scope<textarea name="scope" rows="4" required>${esc(r.scope)}</textarea></label></div>
      <div class="uwpc-actions"><button type="submit">${r.id ? 'Save revised request' : 'Create request'}</button><small>Revising content clears the current proposal and sign-off. Earlier versions remain in history.</small></div></form>
      ${r.id ? `<section><h4>Circuit diagram and supporting sources</h4><p>PDF, image, JSON or text. Up to 10 MB each / 20 MB total. Generation sends these selected sources to NorthStar’s configured OpenAI service.</p>
      <div class="uwpc-actions"><label>File purpose<select id="uwpcSourceKind"><option value="diagram">Circuit diagram</option><option value="source">Procedure / supporting request</option></select></label><input id="uwpcSourceUpload" type="file" accept=".pdf,.png,.jpg,.jpeg,.webp,.json,.txt" aria-label="Attach source"><button type="button" data-action="upload">Attach</button></div>
      <ul>${r.sources.map(s => `<li><a href="${api}/${encodeURIComponent(r.id)}/sources/${encodeURIComponent(s.id)}" target="_blank" rel="noopener">${esc(s.name)}</a> · ${esc(s.kind)} <button type="button" data-remove-source="${esc(s.id)}">Remove from revision</button></li>`).join('')}</ul>
      <button type="button" data-action="generate">Generate proposal from diagram</button></section>
      <section><h4>Generated document · ${esc(status(r.status))}</h4>${r.generation ? `<pre class="uwpc-document">${esc(r.generation.text)}</pre><p class="uwpc-digest">Document SHA-256: ${esc(r.generation.digest)}</p><button type="button" data-action="download">Download document and review record</button>` : '<p class="uwpc-empty">Attach the diagram and generate a proposal for review.</p>'}</section>
      ${r.generation ? `<section><h4>Operator sign-off</h4><p>All selected operators must endorse this exact revision. Sign-off records document review; operational authorization remains with the controlling authority.</p>
      <div class="uwpc-operators">${operators.map(o => `<label><input type="checkbox" name="uwpcReviewer" value="${esc(o)}"> ${esc(o)}</label>`).join('') || '<p>No operator directory configured.</p>'}</div>
      <button type="button" data-action="route" ${['PENDING_SIGNOFF','SIGNED_OFF'].includes(r.status)?'disabled':''}>Send to operator inbox</button>
      ${review ? `<p>Sent by ${esc(review.requestedBy)} · ${esc(when(review.requestedAt))} · Assigned: ${review.operators.map(esc).join(', ')}</p>${review.decisions.map(d => `<p><strong>${esc(d.actor)} — ${esc(status(d.decision))}</strong> · ${esc(when(d.at))}<br>${esc(d.comment)}</p>`).join('')}` : ''}
      ${canSign ? `<label>Review comments<textarea id="uwpcDecisionComment" rows="3"></textarea></label><label class="uwpc-check"><input id="uwpcReviewed" type="checkbox"> I reviewed this document, circuit diagram, references and unresolved conditions.</label><div class="uwpc-actions"><button type="button" data-action="approve">Sign off as ${esc(actor)}</button><button type="button" data-action="return">Return for changes</button></div>` : ''}</section>` : ''}
      <section><h4>Plan lifecycle</h4><div class="uwpc-actions"><label>State<select id="uwpcPlanPhase">${['FUTURE','ACTIVE','COMPLETED','CANCELLED'].map(v => `<option ${r.phase===v?'selected':''}>${v}</option>`).join('')}</select></label><button type="button" data-action="phase">Update lifecycle</button></div></section>
      <section><h4>Requests to and from controlling authorities</h4><form id="uwpcCorrespondenceForm"><div class="uwpc-fields"><label>Direction<select name="direction"><option value="TO_AUTHORITY">To authority</option><option value="FROM_AUTHORITY">From authority</option></select></label>${input('authority','Authority','text',r.authority)}${input('reference','Correspondence reference')}${input('occurredAt','Correspondence time','datetime-local',dateValue(new Date().toISOString()))}<label class="uwpc-wide">Request / response<textarea name="message" rows="3" required></textarea></label></div><button type="submit">Record correspondence</button><small>Records an exchange; does not send an external message.</small></form>
      ${(r.events || []).filter(e=>e.event==='correspondence').map(e=>`<article class="uwpc-history"><strong>${esc(status(e.detail.direction))} · ${esc(e.detail.authority)}</strong><small>${esc(when(e.detail.occurredAt))} · ${esc(e.detail.reference)} · recorded by ${esc(e.actor)}</small><p>${esc(e.detail.message)}</p></article>`).join('') || '<p class="uwpc-empty">No correspondence recorded.</p>'}</section>
      <details><summary>Revision and sign-off history</summary>${(r.events || []).map(e => `<article class="uwpc-history"><strong>${esc(status(e.event))}</strong> · ${esc(e.actor)} · ${esc(when(e.at))}${['generated','signoff'].includes(e.event) ? `<details><summary>Recorded document / decision</summary><pre class="uwpc-document">${esc(JSON.stringify(e.detail,null,2))}</pre></details>` : ''}</article>`).join('')}</details>` : ''}`;
    $('uwpcRequestForm').addEventListener('submit', e => {e.preventDefault(); void run(save);});
    $('uwpcRequestForm').addEventListener('input', () => {dirty=true;});
    $('uwpcRequestForm').addEventListener('change', () => {dirty=true;});
    $('uwpcRequestForm').elements.kind.addEventListener('change', e => {
      const select = $('uwpcRequestForm').elements.template;
      if(e.target.value==='SWITCHING_PLAN')select.value='pc17a'; else if(select.value==='pc17a')select.value='pc2-sg';
    });
    $('uwpcCorrespondenceForm')?.addEventListener('submit', e => {e.preventDefault(); void run(async()=>{
      const data = Object.fromEntries(new FormData(e.target));
      data.occurredAt = data.occurredAt ? new Date(data.occurredAt).toISOString() : '';
      await change('correspondence',data); notice('Authority correspondence recorded.');
    });});
  }
  async function save() {
    const form = $('uwpcRequestForm'); if (!form.reportValidity())return;
    const data = Object.fromEntries(new FormData(form));
    ['start','end'].forEach(k=>{data[k]=data[k]?new Date(data[k]).toISOString():'';});
    const result = await request(current ? `${api}/${current.id}/save` : api, 'POST', {...data,...(current?{version:current.version}:{})});
    show(result); await refresh(); notice('Request saved. Attach its circuit diagram to generate the proposal.');
  }
  async function change(action, data={}) {
    if(dirty)throw new Error('Save the edited request before continuing; saving starts a new review revision.');
    const result = await request(`${api}/${current.id}/${action}`, 'POST', {version:current.version,...data});
    show(result); await refresh();
  }
  async function open(ident) {
    if(dirty)throw new Error('Save your edited request before opening another record.');
    show(await request(`${api}/${encodeURIComponent(ident)}`));
    $('uwpcEditor').scrollIntoView({block:'start',behavior:'smooth'});
  }
  async function act(action) {
    if(dirty && action!=='refresh')throw new Error('Save the edited request before continuing.');
    if (action==='close') {current=null; $('uwpcEditor').hidden=true;return;}
    if (action==='new') {show(null); $('uwpcEditor').scrollIntoView({block:'start'}); $('uwpcRequestForm').elements.title.focus(); return;}
    if (action==='refresh') {await refresh();notice('UWPC records refreshed.');return;}
    if (!current)return;
    if (action==='generate') {notice('Reading the circuit diagram and generating a review proposal…');await change('generate');notice('Proposal generated. Review it, then select operators and send it to their inbox.');}
    if (action==='route') {await change('route',{operators:[...root.querySelectorAll('[name="uwpcReviewer"]:checked')].map(i=>i.value)});notice('Delivered to the selected NorthStar operator inboxes.');}
    if (action==='approve'||action==='return') {
      await change('signoff',{decision:action==='approve'?'APPROVE':'RETURN', comment:$('uwpcDecisionComment').value,
        confirmed:$('uwpcReviewed').checked, digest:current.generation.digest});notice('Your review decision was recorded against this document revision.');
    }
    if (action==='phase') {await change('phase',{phase:$('uwpcPlanPhase').value});notice('Plan lifecycle updated.');}
    if (action==='upload') {
      const file = $('uwpcSourceUpload').files[0]; if(!file)throw new Error('Choose a diagram or source file first.');
      const response=await fetch(`${api}/${current.id}/sources?kind=${$('uwpcSourceKind').value}&version=${current.version}`,{method:'POST',credentials:'same-origin',headers:{'Content-Type':file.type||'application/octet-stream','X-Northstar-Filename':encodeURIComponent(file.name)},body:file});
      const data=await response.json(); if(!response.ok)throw new Error(data.error || 'Upload failed');show(data);await refresh();notice('Source saved with this request.');
    }
    if (action==='download') {
      const blob=new Blob([JSON.stringify(current,null,2)],{type:'application/json'}), url=URL.createObjectURL(blob), a=document.createElement('a');
      a.href=url;a.download=`${current.id}-review.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
    }
  }
  function bind() {
    const workspace=document.querySelector('#switching .switching-workspace');if(!workspace)return;
    const details=document.createElement('details');details.id='uwpcLegacyTools';details.innerHTML='<summary>Drawing board, UWPC form library and legacy review tools</summary><div class="uwpc-legacy-body"></div>';
    [...workspace.children].forEach(node=>details.lastElementChild.append(node));
    workspace.append(details);
    root=document.createElement('div');root.id='uwpcDesk';root.className='uwpc-desk';
    root.innerHTML=`<header class="uwpc-head"><div><small>WORK PROTECTION</small><h2>UWPC</h2><p>Switching plans, supporting guarantees and operator sign-off.</p></div><div class="uwpc-actions"><button type="button" data-action="refresh">Refresh</button><button type="button" data-action="new" class="uwpc-new">+ New</button></div></header>
      <p id="uwpcDeskStatus" role="status" aria-live="polite">Loading UWPC records…</p>
      <section class="uwpc-inbox"><h3>Operator inbox <span id="uwpcInboxCount">0</span></h3><div id="uwpcOperatorInbox"></div></section>
      <section id="uwpcEditor" hidden></section>
      <section><h3>Active / future switching plans and requests</h3><div id="uwpcActivePlans"></div></section>
      <section><h3>Past switching plans and requests</h3><div id="uwpcPastPlans"></div></section>
      <section><h3>Requests to and from controlling authorities</h3><div id="uwpcAuthorityRecords"></div></section>
      <details><summary>Existing switching drafts · lifecycle not yet classified</summary><div id="uwpcLegacyPlans"></div></details>`;
    workspace.prepend(root);
    root.addEventListener('click', e=>{
      const button=e.target.closest('button');if(!button)return;
      if(button.dataset.request)void run(()=>open(button.dataset.request));
      else if(button.dataset.removeSource)void run(()=>change('remove-source',{sourceId:button.dataset.removeSource}));
      else if(button.dataset.legacy) {details.open=true;window.NorthStarSwitching?.loadDraft?.(button.dataset.legacy);details.scrollIntoView();}
      else if(button.dataset.action)void run(()=>act(button.dataset.action));
    });
    const inboxButton=document.createElement('button');inboxButton.id='uwpcGlobalInbox';inboxButton.type='button';inboxButton.hidden=true;
    inboxButton.onclick=()=>{window.NorthstarModules?.open('outages:uwpc');$('uwpcOperatorInbox').scrollIntoView();};document.body.append(inboxButton);
    void run(async()=>{await refresh();notice('Ready. Create a request or open a plan.');});
    void request('/api/switching/drafts?limit=500').then(data=>{legacy=Array.isArray(data)?data:[];drawLists();}).catch(error=>{legacyError=error.message;drawLists();});
    // Inbox delivery is durable server state. Poll only while the operator dashboard is open.
    setInterval(()=>{if(!document.hidden&&!busy)void refresh().catch(e=>notice(`Inbox refresh failed: ${e.message}`,true));},30000);
    window.NorthStarUwpcDesk={open:id=>run(()=>open(id)),refresh};
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',bind);else bind();
})();
