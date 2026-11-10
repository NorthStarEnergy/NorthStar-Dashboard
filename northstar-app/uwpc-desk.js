(() => {
  'use strict';
  const practice = document.body.hasAttribute('data-outage-practice');
  const persona = new URLSearchParams(location.search).get('as') || 'Avery Brooks';
  const api = '/api/uwpc/requests' + (practice ? '/practice/' + encodeURIComponent(persona) : '');
  const labels = {REQUEST_GUARANTEE:'Request supporting guarantee', PROVIDE_GUARANTEE:'Provide supporting guarantee', SWITCHING_PLAN:'Switching plan'};
  const forms = [
    {template:'pc10c-sg', kind:'REQUEST_GUARANTEE', code:'PC10C', title:'Supporting Guarantee Request', detail:'Request work protection from a controlling authority.'},
    {template:'pc17b-sg', kind:'PROVIDE_GUARANTEE', code:'PC17B', title:'Supporting Guarantee', detail:'Prepare a guarantee proposal for qualified review.'},
    {template:'pc2-sg', kind:'PROVIDE_GUARANTEE', code:'PC2', title:'Issued Work Permit Support', detail:'Record supporting-guarantee information for a PC2 package.'},
    {template:'pc17a', kind:'SWITCHING_PLAN', code:'PC17A', title:'Switching Plan', detail:'Prepare a draft plan and equipment review from supplied evidence.'}
  ];
  const phaseLabels = {FUTURE:'Planned', ACTIVE:'On-going', COMPLETED:'Completed', CANCELLED:'Cancelled'};
  const status = value => String(value || '').replaceAll('_', ' ');
  const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const when = value => value ? new Date(value).toLocaleString([], {dateStyle:'medium', timeStyle:'short'}) : 'Not scheduled';
  let root, current = null, records = [], operators = [], actor = '', busy = false, dirty = false, legacy = [], legacyError = '';
  const $ = id => document.getElementById(id);
  const outage = window.NorthStarOutageReview({esc, when, dateValue, api});
  let roles = {};

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
    $('uwpcEditor').inert = true;
    root.querySelectorAll('button').forEach(button => {button.dataset.wasDisabled = String(button.disabled); button.disabled = true;});
    try { await work(); } catch (error) { notice(error.message, true); }
    finally {
      busy = false; root.removeAttribute('aria-busy');
      $('uwpcEditor').inert = false;
      root.querySelectorAll('button[data-was-disabled]').forEach(button => {button.disabled = button.dataset.wasDisabled === 'true'; delete button.dataset.wasDisabled;});
    }
  }

  function phase(record) { return phaseLabels[record.phase] || status(record.phase); }

  function feed(items, empty, inbox = false) {
    if (!items.length) return `<p class="uwpc-empty">${esc(empty)}</p>`;
    return `<div class="uwpc-feed">${items.map(record => `<button class="uwpc-feed-line" type="button" data-request="${esc(record.id)}">
      <span class="uwpc-phase uwpc-phase-${esc(String(record.phase || '').toLowerCase())}">${esc(phase(record))}</span>
      <span class="uwpc-feed-date">${esc(when(record.start))}</span>
      <strong>${esc(record.site || 'Station not entered')}</strong>
      <span class="uwpc-feed-id">${esc(record.outageId || record.reference || record.id)}</span>
      <span class="uwpc-feed-title">${esc(record.title)}</span>
      <span class="uwpc-feed-description">${esc(record.description || record.scope)}</span>
      <span class="uwpc-feed-notes">${esc((inbox && outage.alerts(record, actor).join(' · ')) || record.notes || status(record.status))}</span>
    </button>`).join('')}</div>`;
  }

  function setView(next) {
    if (next === 'new') {
      const menu = $('uwpcNewMenu');
      menu.hidden = !menu.hidden;
      $('uwpcNewButton').setAttribute('aria-expanded', String(!menu.hidden));
      return;
    }
    $('uwpcNewMenu').hidden = true;
    $('uwpcNewButton').setAttribute('aria-expanded','false');
    root.querySelectorAll('[data-view-panel]').forEach(panel => {panel.hidden = panel.dataset.viewPanel !== next;});
    root.querySelectorAll('.uwpc-nav>button').forEach(button => button.setAttribute('aria-selected', String(button.dataset.view === next)));
  }

  function drawLists() {
    const active = records.filter(record => ['ACTIVE','FUTURE','COMPLETED'].includes(record.phase));
    $('uwpcActivePlans').innerHTML = feed(active, 'No current UWPC plans or packages.');
    const inbox = records.filter(record => outage.alerts(record, actor).length || (record.status === 'PENDING_SIGNOFF' && record.review?.operators.includes(actor) && !record.review.decisions.some(decision => decision.actor === actor)));
    $('uwpcOperatorInbox').innerHTML = feed(inbox, 'No packages are waiting for your review.', true);
    $('uwpcInboxCount').textContent = String(inbox.length);
    const historical = records.filter(record => ['COMPLETED','CANCELLED'].includes(record.phase));
    $('uwpcPastPlans').innerHTML = feed(historical, 'No completed or cancelled packages.');
    const badge = $('uwpcGlobalInbox');
    if (badge) {badge.hidden = !inbox.length; badge.textContent = `UWPC sign-off (${inbox.length})`;}
    $('uwpcLegacyPlans').innerHTML = legacyError ? `<p class="error">${esc(legacyError)}</p>` : legacy.length ? legacy.map(record => `<p><button type="button" data-legacy="${esc(record.id)}">${esc(record.packageName || record.id)}</button><small>${esc(record.site)} · ${esc(record.status)}</small></p>`).join('') : '<p class="uwpc-empty">No unclassified legacy drafts.</p>';
  }

  async function refresh() {
    const data = await request(api);
    records = data.requests; operators = data.operators; actor = data.actor;
    roles = data.outageReviewRoles || {};
    drawLists();
    $('uwpcAuthorityRecords').innerHTML = (data.correspondence || []).map(entry => `<article class="uwpc-history"><strong>${esc(status(entry.detail.direction))} · ${esc(entry.detail.authority)}</strong><small>${esc(when(entry.detail.occurredAt))} · ${esc(entry.detail.reference)} · ${esc(entry.actor)}</small><p>${esc(entry.detail.message)}</p><button type="button" data-request="${esc(entry.request_id)}">Open linked package</button></article>`).join('') || '<p class="uwpc-empty">No authority correspondence recorded.</p>';
  }

  function dateValue(value) {
    if (!value) return '';
    const date = new Date(value);
    return new Date(date - date.getTimezoneOffset() * 60000).toISOString().slice(0,16);
  }

  function input(name, label, type = 'text', value = '', options = '') {
    return `<label><span>${label}</span><input name="${name}" type="${type}" value="${esc(value)}" ${options}></label>`;
  }

  function switchingRow(step, index) {
    return `<tr data-switching-step>
      <td class="uwpc-sequence-number">${index + 1}</td>
      ${['device','removeTag','operation','placeTag','lockNo','orderedBy','completedBy'].map(field => `<td><textarea rows="2" data-step-field="${field}" aria-label="Sequence ${index + 1} ${field}">${esc(step[field] || '')}</textarea></td>`).join('')}
    </tr>`;
  }

  function switchingRows(plan) {
    const rows = [...(plan.steps || [])];
    while (rows.length < 15) rows.push({});
    return rows.map(switchingRow).join('');
  }

  function switchingForm(r) {
    const plan = r.switchingPlan || {};
    return `<input type="hidden" name="kind" value="SWITCHING_PLAN"><input type="hidden" name="template" value="pc17a">
      <fieldset class="uwpc-plan-record"><legend>Plan record</legend><div class="uwpc-fields">
        ${input('title','Plan title','text',r.title,'required placeholder="Recognizable switching plan title"')}
        ${input('site','Station / site','text',r.site,'required placeholder="Station or facility"')}
        ${input('outageId','Outage ID','text',r.outageId,'placeholder="Linked outage ID"')}
        ${input('start','Planned start','datetime-local',dateValue(r.start))}${input('end','Planned end','datetime-local',dateValue(r.end))}
        ${input('authority','Controlling authority','text',r.authority)}${input('reference','Authority / permit reference','text',r.reference)}
        ${input('diagramRevision','Circuit diagram revision','text',r.diagramRevision,'placeholder="Drawing revision used for review"')}
      </div></fieldset>
      <section class="uwpc-pc17a" aria-label="PC17A Order to Operate">
        <header class="uwpc-pc17a-title"><div><strong>PC17A</strong><span>Order to Operate</span></div><h4>SWITCHING PLAN</h4><label><span>Serial No.</span><input data-plan-field="serialNo" value="${esc(plan.serialNo || '')}"></label></header>
        <div class="uwpc-pc17a-purpose"><label><span>Purpose of Order</span><textarea data-plan-field="purpose" rows="5" required>${esc(plan.purpose || r.scope || '')}</textarea></label><div><label><span>PC3 tag no. <small>(for use with PC14)</small></span><input data-plan-field="pc3TagNo" value="${esc(plan.pc3TagNo || '')}"></label><label class="uwpc-agent-copy"><input type="checkbox" data-plan-field="agentCopy" ${plan.agentCopy?'checked':''}> Agent's Copy</label></div></div>
        <div class="uwpc-switching-table-wrap"><table class="uwpc-switching-table"><thead><tr><th>Seq. No.</th><th>Device</th><th>Remove<br>Tag No.</th><th>Operation</th><th>Place<br>Tag No.</th><th>Lock No.</th><th>Ordered By</th><th>Completed By</th></tr></thead><tbody id="uwpcSwitchingRows">${switchingRows(plan)}</tbody></table></div>
        <button type="button" data-action="add-step">Add sequence line</button>
        <div class="uwpc-pc17a-signatures">
          <div><label><span>Prepared By</span><input data-plan-field="preparedBy" value="${esc(plan.preparedBy || '')}"></label><label><span>Date Time</span><input type="datetime-local" data-plan-field="preparedAt" value="${esc(dateValue(plan.preparedAt))}"></label></div>
          <div><label><span>Checked By</span><input data-plan-field="checkedBy" value="${esc(plan.checkedBy || '')}"></label><label><span>Date Time</span><input type="datetime-local" data-plan-field="checkedAt" value="${esc(dateValue(plan.checkedAt))}"></label></div>
          <div><label><span>All Sequences Completed By</span><input data-plan-field="completedBy" value="${esc(plan.completedBy || '')}"></label><label><span>Date Time</span><input type="datetime-local" data-plan-field="completedAt" value="${esc(dateValue(plan.completedAt))}"></label></div>
        </div>
        <label class="uwpc-pc17a-notes"><span>Notes</span><textarea name="notes" rows="4">${esc(r.notes)}</textarea></label>
      </section>`;
  }

  function standardForm(r) {
    return `<fieldset><legend>Package details</legend><div class="uwpc-fields">
      ${input('title','Package title','text',r.title,'required placeholder="Short, recognizable package name"')}
      ${input('site','Station / site','text',r.site,'required placeholder="Station or facility"')}
      ${input('outageId','Outage ID','text',r.outageId,'placeholder="Linked outage or event ID"')}
      <label><span>Request type</span><select name="kind">${Object.entries(labels).map(([value,label]) => `<option value="${value}" ${value===r.kind?'selected':''}>${label}</option>`).join('')}</select></label>
      <label><span>UWPC form</span><select name="template">${forms.map(form => `<option value="${form.template}" ${form.template===r.template?'selected':''}>${form.code} · ${form.title}</option>`).join('')}</select></label>
    </div></fieldset>
    <fieldset><legend>Schedule and authority</legend><div class="uwpc-fields">
      ${input('start','Planned start','datetime-local',dateValue(r.start))}${input('end','Planned end','datetime-local',dateValue(r.end))}
      ${input('authority','Controlling authority','text',r.authority)}${input('reference','Authority / permit reference','text',r.reference)}
      ${input('diagramRevision','Circuit diagram revision','text',r.diagramRevision,'placeholder="Required before proposal generation"')}
    </div></fieldset>
    <fieldset><legend>Work information</legend><div class="uwpc-fields">
      <label class="uwpc-wide"><span>Work description</span><textarea name="description" rows="3" placeholder="Concise description shown in the plan feed">${esc(r.description)}</textarea></label>
      <label class="uwpc-wide"><span>Request / work scope</span><textarea name="scope" rows="5" required placeholder="Define the requested work and boundaries without writing operating steps">${esc(r.scope)}</textarea></label>
      <label class="uwpc-wide"><span>Notes</span><textarea name="notes" rows="3" placeholder="Open questions, coordination notes, or other context">${esc(r.notes)}</textarea></label>
    </div></fieldset>`;
  }

  function exportPanel(record) {
    if (!record.id) return '';
    const base = `${api}/${encodeURIComponent(record.id)}/exports`;
    return `<section class="uwpc-export-panel" aria-label="Generated form files"><div class="uwpc-export-copy"><small>REVISION ${record.version}</small><h4>Review files ready</h4><p>Check the PDF, make corrections in this form, or continue editing in the Excel copy.</p><div class="uwpc-actions"><a class="uwpc-button uwpc-primary" href="${base}/pdf?v=${record.version}" target="_blank" rel="noopener">Open PDF</a><a class="uwpc-button" href="${base}/xlsx?v=${record.version}" download>Download editable Excel</a></div></div><iframe title="UWPC PDF preview" src="${base}/pdf?v=${record.version}"></iframe></section>`;
  }

  function show(record, seed = {}) {
    current = record;
    dirty = false;
    const r = record || {kind:seed.kind || 'REQUEST_GUARANTEE', template:seed.template || 'pc10c-sg', phase:'FUTURE', sources:[], title:'', site:'', outageId:'', description:'', scope:'', notes:'', authority:'', reference:'', diagramRevision:'', start:'', end:''};
    const review = r.review;
    const fullReview = r.reviewTrigger && r.reviewTrigger !== 'routine';
    const canSign = r.status === 'PENDING_SIGNOFF' && review?.operators.includes(actor) && !review.decisions.some(decision => decision.actor === actor);
    const chosen = forms.find(form => form.template === r.template) || forms[0];
    $('uwpcEditor').hidden = false;
    $('uwpcEditor').innerHTML = `<article class="uwpc-form-shell">
      <header class="uwpc-form-head"><div><small>${r.id ? `${esc(r.id)} · REVISION ${r.version}` : `NEW ${esc(chosen.code)} FORM`}</small><h3>${r.id ? esc(r.title) : esc(chosen.title)}</h3><p>Complete the known information. Missing operational facts remain unverified.</p></div><button type="button" data-action="cancel">Close</button></header>
      ${r.generation?.evidenceCheck ? `<section class="uwpc-inbox" aria-label="UWPC evidence checks"><h4>Code evidence · ${esc(status(r.generation.evidenceCheck.status))}</h4><p>References are checked against stored text. Interpretation and complete rule coverage require qualified review.</p>${r.generation.evidenceCheck.missing.map(item=>`<p>Missing: ${esc(item)}</p>`).join('')}${r.generation.evidenceCheck.errors.map(item=>`<p class="error">${esc(item)}</p>`).join('')}<a href="knowledge-library.html" target="_blank" rel="noopener">Review controlled sources</a><details><summary>Retrieved clauses and revisions</summary>${r.generation.controlledEvidence.passages.map(p=>`<p><a href="${esc(p.href)}" target="_blank" rel="noopener">${esc(p.title)} · revision ${esc(p.revision)} · ${p.page ? `PDF page ${esc(p.page)}` : esc(p.section)}</a><small>${esc(p.id)} · Clause mentions: ${esc(p.clauseMentions.join(', ') || 'None identified')}</small></p>`).join('') || '<p>No eligible controlled passages retrieved.</p>'}</details></section>` : ''}
      ${r.preparationMode === 'INTAKE' ? `${r.generation ? `<section class="uwpc-generated"><h4>${r.generation.model === "not-run-missing-controlled-evidence" ? "Evidence checklist · analysis paused" : "AI draft · qualified review required"}</h4><pre class="uwpc-document">${esc(r.generation.text)}</pre></section>` : '<p>Request saved. Add your evidence below to prepare an AI draft.</p>'}<details class="uwpc-intake-form"><summary>Complete and save the draft form</summary>` : ''}
      ${exportPanel(r)}
      <form id="uwpcRequestForm">
        ${r.template === 'pc17a' ? switchingForm(r) : standardForm(r)}
        ${outage.classification(r)}
        <footer class="uwpc-form-footer"><small>Saving creates a fresh PDF preview and editable Excel file for this revision.</small><div class="uwpc-actions"><button type="button" data-action="cancel">Cancel</button><button class="uwpc-primary" type="submit">${r.id ? 'Save changes' : 'Submit draft form'}</button></div></footer>
      </form>
      ${r.preparationMode === 'INTAKE' ? '</details>' : ''}
      ${r.id ? `<details class="uwpc-advanced"><summary>Sources and proposal generation</summary><div class="uwpc-advanced-body"><p>Attach the evidence used for this revision. Generation creates a review proposal, never an issued permit or release.</p>
        <div class="uwpc-actions"><label>File purpose<select id="uwpcSourceKind"><option value="diagram">Circuit diagram</option><option value="source">Procedure / supporting request</option></select></label><input id="uwpcSourceUpload" type="file" accept=".pdf,.png,.jpg,.jpeg,.webp,.json,.txt" aria-label="Attach source"><button type="button" data-action="upload">Attach</button></div>
        <ul>${r.sources.map(source => `<li><a href="${api}/${encodeURIComponent(r.id)}/sources/${encodeURIComponent(source.id)}" target="_blank" rel="noopener">${esc(source.name)}</a> · ${esc(source.kind)} <button type="button" data-remove-source="${esc(source.id)}">Remove</button></li>`).join('') || '<li>No sources attached.</li>'}</ul>
        <button type="button" data-action="generate">Generate review proposal</button>
        ${r.generation && r.preparationMode !== 'INTAKE' ? `<div class="uwpc-generated"><h4>Generated proposal · ${esc(status(r.status))}</h4><pre class="uwpc-document">${esc(r.generation.text)}</pre><p class="uwpc-digest">Document SHA-256: ${esc(r.generation.digest)}</p></div>` : ''}
      </div></details>
      ${!fullReview && r.generation && r.preparationMode !== 'INTAKE' ? `<details class="uwpc-advanced"><summary>Operator review and sign-off</summary><div class="uwpc-advanced-body"><p>All selected operators endorse this exact revision. Sign-off records review; operational authorization remains with the controlling authority.</p>
        <div class="uwpc-operators">${operators.map(operator => `<label><input type="checkbox" name="uwpcReviewer" value="${esc(operator)}"> ${esc(operator)}</label>`).join('') || '<p>No operator directory configured.</p>'}</div>
        <button type="button" data-action="route" ${['PENDING_SIGNOFF','SIGNED_OFF'].includes(r.status) || !r.generation.evidenceCheck?.canRoute ? 'disabled':''}>Send to operator inbox</button>
        ${review ? `<p>Sent by ${esc(review.requestedBy)} · ${esc(when(review.requestedAt))} · Assigned: ${review.operators.map(esc).join(', ')}</p>${review.decisions.map(decision => `<p><strong>${esc(decision.actor)} · ${esc(status(decision.decision))}</strong><br>${esc(decision.comment)}</p>`).join('')}` : ''}
        ${canSign ? `<label>Review comments<textarea id="uwpcDecisionComment" rows="3"></textarea></label><label class="uwpc-check"><input id="uwpcReviewed" type="checkbox"> I reviewed this document, diagram, references and unresolved conditions.</label><div class="uwpc-actions"><button type="button" data-action="approve">Sign off as ${esc(actor)}</button><button type="button" data-action="return">Return for changes</button></div>` : ''}
      </div></details>` : ''}
      <details class="uwpc-advanced"><summary>Lifecycle, correspondence and audit history</summary><div class="uwpc-advanced-body">
        <div class="uwpc-actions"><label>Plan status<select id="uwpcPlanPhase">${Object.entries(phaseLabels).map(([value,label]) => `<option value="${value}" ${r.phase===value?'selected':''}>${label}</option>`).join('')}</select></label><button type="button" data-action="phase">Update status</button></div>
        <form id="uwpcCorrespondenceForm"><h4>Authority correspondence</h4><div class="uwpc-fields"><label><span>Direction</span><select name="direction"><option value="TO_AUTHORITY">To authority</option><option value="FROM_AUTHORITY">From authority</option></select></label>${input('authority','Authority','text',r.authority)}${input('reference','Reference')}${input('occurredAt','Date and time','datetime-local',dateValue(new Date().toISOString()))}<label class="uwpc-wide"><span>Request / response</span><textarea name="message" rows="3" required></textarea></label></div><button type="submit">Record correspondence</button><small>Records an exchange; it does not send a message.</small></form>
        ${(r.events || []).map(entry => `<article class="uwpc-history"><strong>${esc(status(entry.event))}</strong><small>${esc(entry.actor)} · ${esc(when(entry.at))}</small>${entry.event.startsWith('review-') ? `<details><summary>Review record</summary><pre class="uwpc-document">${esc(JSON.stringify(entry.detail, null, 2))}</pre></details>` : ''}</article>`).join('') || '<p class="uwpc-empty">No audit events.</p>'}
      </div></details>` : ''}
    </article>`;
    $('uwpcEditor').querySelector('.uwpc-form-head').insertAdjacentHTML('afterend', outage.cover(r, roles, actor, operators));
    if (r.registerOutage) $('uwpcRequestForm').elements.outageId.readOnly = true;
    if (fullReview) $('uwpcPlanPhase').closest('.uwpc-actions').hidden = Boolean(r.switchLog || r.distribution);
    $('uwpcRequestForm').addEventListener('submit', event => {event.preventDefault(); void run(save);});
    $('uwpcRequestForm').addEventListener('input', () => {dirty=true;});
    $('uwpcRequestForm').addEventListener('change', () => {dirty=true;});
    $('uwpcRequestForm').elements.kind?.addEventListener('change', event => {
      const select = $('uwpcRequestForm').elements.template;
      if (event.target.value === 'SWITCHING_PLAN') select.value = 'pc17a'; else if (select.value === 'pc17a') select.value = 'pc10c-sg';
    });
    $('uwpcRequestForm').elements.template?.addEventListener('change', event => {
      $('uwpcRequestForm').elements.kind.value = event.target.value === 'pc17a' ? 'SWITCHING_PLAN' : forms.find(form => form.template === event.target.value)?.kind || 'REQUEST_GUARANTEE';
    });
    $('uwpcCorrespondenceForm')?.addEventListener('submit', event => {event.preventDefault(); void run(async() => {
      const data = Object.fromEntries(new FormData(event.target));
      data.occurredAt = data.occurredAt ? new Date(data.occurredAt).toISOString() : '';
      await change('correspondence',data); notice('Authority correspondence recorded.');
    });});
  }

  function showExample(index) {
    const form = forms[index] || forms[0];
    $('uwpcExampleDetail').innerHTML = `<article class="uwpc-example-sheet"><small>EXAMPLE · ${esc(form.code)}</small><h3>${esc(form.title)}</h3><dl><div><dt>Station</dt><dd>Example Station</dd></div><div><dt>Outage ID</dt><dd>OUT-EXAMPLE-001</dd></div><div><dt>Plan status</dt><dd>Planned</dd></div><div><dt>Work description</dt><dd>Example only - replace every field with verified package information.</dd></div><div><dt>Notes</dt><dd>Attach the current circuit diagram and identify its revision before generating a proposal.</dd></div></dl><p>This example is not saved and cannot be used as operational authority.</p></article>`;
  }

  async function save() {
    const form = $('uwpcRequestForm'); if (!form.reportValidity()) return;
    const data = Object.fromEntries(new FormData(form));
    data.affectedSites = String(data.affectedSites || '').split(/\r?\n/).map(site => site.trim()).filter(Boolean);
    ['start','end'].forEach(key => {data[key] = data[key] ? new Date(data[key]).toISOString() : '';});
    if (data.template === 'pc17a') {
      const plan = {};
      form.querySelectorAll('[data-plan-field]').forEach(control => {
        plan[control.dataset.planField] = control.type === 'checkbox' ? control.checked : control.value.trim();
      });
      ['preparedAt','checkedAt','completedAt'].forEach(key => {plan[key] = plan[key] ? new Date(plan[key]).toISOString() : '';});
      plan.steps = [...form.querySelectorAll('[data-switching-step]')].map(row => Object.fromEntries(
        [...row.querySelectorAll('[data-step-field]')].map(control => [control.dataset.stepField, control.value.trim()])
      )).filter(step => Object.values(step).some(Boolean));
      data.switchingPlan = plan;
      data.scope = plan.purpose;
      data.description = plan.purpose;
    }
    const result = await request(current ? `${api}/${current.id}/save` : api, 'POST', {...data,...(current ? {version:current.version} : {})});
    show(result); await refresh(); notice('Form saved. The PDF preview and editable Excel file are ready.');
  }

  async function change(action, data={}) {
    if (dirty) throw new Error('Save the edited form before continuing.');
    const result = await request(`${api}/${current.id}/${action}`, 'POST', {version:current.version,...data});
    show(result); await refresh();
  }

  async function open(ident) {
    if (dirty) throw new Error('Save or cancel the open form before opening another package.');
    const record = await request(`${api}/${encodeURIComponent(ident)}`);
    if (record.packageReview && operators.includes(actor) && !record.packageReview.viewed?.[actor]) {
      const viewed = await request(`${api}/${encodeURIComponent(ident)}/review-view`, 'POST', {version:record.version, digest:record.packageReview.digest});
      record.packageReview = viewed.packageReview;
    }
    show(record);
    $('uwpcEditor').scrollIntoView({block:'start',behavior:'smooth'});
  }

  async function intake(event) {
    event.preventDefault();
    const form = event.target;
    if (busy || !form.reportValidity()) return;
    await run(async () => {
      if (dirty) throw new Error('Save or cancel the open form before starting a request.');
      const data = Object.fromEntries(new FormData(form));
      const chosen = forms.find(item => item.template === data.template);
      const scope = data.scope.trim(), site = data.site.trim();
      if (!scope || !site) throw new Error('Enter a station and describe the request.');
      const files = [[$('uwpcIntakeDiagram').files[0], 'diagram'], ...[...$('uwpcIntakeSources').files].map(file => [file, 'source'])].filter(([file]) => file);
      if (files.length > 8 || files.some(([file]) => file.size > 10 * 1024 * 1024) || files.reduce((sum, [file]) => sum + file.size, 0) > 20 * 1024 * 1024) throw new Error('Use up to 8 files, 10 MB each and 20 MB total.');
      if (files.some(([file]) => !/\.(pdf|png|jpe?g|webp|json|txt)$/i.test(file.name))) throw new Error('Use PDF, image, JSON or text files.');
      let saved = false;
      [...form.elements].forEach(control => {control.disabled = true;});
      try {
        notice('Saving your request…');
        const row = await request(api, 'POST', {
          title:`${chosen.title} · ${site}`.slice(0,160), site, scope,
          description:scope.slice(0,2000), template:chosen.template, kind:chosen.kind,
          diagramRevision:data.diagramRevision.trim(), preparationMode:'INTAKE',
          ...(chosen.kind === 'SWITCHING_PLAN' ? {switchingPlan:{purpose:scope,steps:[]}} : {})
        });
        saved = true; show(row); form.reset();
        for (const [file, kind] of files) {
          notice(`Attaching ${file.name}…`);
          const response = await fetch(`${api}/${current.id}/sources?kind=${kind}&version=${current.version}`, {
            method:'POST', credentials:'same-origin', headers:{'Content-Type':file.type || 'application/octet-stream','X-Northstar-Filename':encodeURIComponent(file.name)}, body:file
          });
          const result = await response.json();
          if (!response.ok) throw new Error(result.error || 'Attachment failed');
          show(result);
        }
        await refresh();
        if (current.sources.some(source => source.kind === 'diagram') && current.diagramRevision) {
          notice('AI is analyzing your request and attached evidence…');
          await change('generate');
          notice(current.generation.evidenceCheck?.canRoute ? 'AI draft ready. Review the findings and complete the form before sign-off.' : 'Evidence review required. AI conclusions are withheld; complete the controlled-source checks.');
        } else {
          notice('Request saved. Attach a drawing and enter its revision below to run AI analysis.');
        }
      } catch (error) {
        if (saved) throw new Error(`Request saved as ${current.id}. ${error.message}. Continue in the saved package below.`);
        throw error;
      } finally {
        [...form.elements].forEach(control => {control.disabled = false;});
        if (saved) {
          const sources = $('uwpcEditor').querySelector('.uwpc-advanced');
          if (sources) sources.open = true;
          $('uwpcEditor').scrollIntoView({block:'start',behavior:'smooth'});
        }
      }
    });
  }

  async function act(action, button) {
    if (action === 'add-step') {
      const body = $('uwpcSwitchingRows');
      body.insertAdjacentHTML('beforeend', switchingRow({}, body.querySelectorAll('[data-switching-step]').length));
      dirty = true;
      body.lastElementChild.querySelector('[data-step-field]').focus();
      return;
    }
    if (dirty && action !== 'cancel') throw new Error('Save or cancel the edited form before continuing.');
    if (action === 'cancel') {current=null; dirty=false; $('uwpcEditor').hidden=true; $('uwpcEditor').innerHTML=''; return;}
    if (action === 'refresh') {await refresh(); notice('UWPC records refreshed.'); return;}
    if (!current) return;
    if (['distribute','final-receipt','log-open','log-entry','log-close','closeout-note'].includes(action)) {
      const fields = button.closest('fieldset');
      const occurred = fields?.querySelector('[name=occurredAt]')?.value;
      await change(action, {copyId:current.distribution?.id, site:fields?.querySelector('[name=site]')?.value,
        step:Number(fields?.querySelector('[name=step]')?.value) || null, occurredAt:occurred ? new Date(occurred).toISOString() : null,
        text:fields?.querySelector('[name=text]')?.value});
      notice(({distribute:'Final copy distributed.', 'final-receipt':'Receipt recorded.', 'log-open':'Switching log opened.',
        'log-entry':'Log entry saved.', 'log-close':'Outage closed.', 'closeout-note':'Closeout note saved.'})[action]);
      return;
    }
    if (action.startsWith('review-')) {
      const data = outage.actionData(action, button, current);
      if (data) {await change(action, data); notice(current.status === 'SIGNED_OFF' ? 'Planning review complete.' : 'Outage review updated.');}
      return;
    }
    if (action === 'generate') {notice('Reading the circuit diagram and generating a review proposal…'); await change('generate'); notice(current.generation.evidenceCheck?.canRoute ? 'Proposal generated for review.' : 'Evidence review required. AI conclusions are withheld.');}
    if (action === 'route') {await change('route',{operators:[...root.querySelectorAll('[name="uwpcReviewer"]:checked')].map(input => input.value)}); notice('Delivered to the selected NorthStar operator inboxes.');}
    if (action === 'approve' || action === 'return') {
      await change('signoff',{decision:action === 'approve' ? 'APPROVE' : 'RETURN', comment:$('uwpcDecisionComment').value, confirmed:$('uwpcReviewed').checked, digest:current.generation.digest});
      notice('Your review decision was recorded against this revision.');
    }
    if (action === 'phase') {await change('phase',{phase:$('uwpcPlanPhase').value}); notice('Plan status updated.');}
    if (action === 'upload') {
      const file = $('uwpcSourceUpload').files[0]; if (!file) throw new Error('Choose a diagram or source file first.');
      const response = await fetch(`${api}/${current.id}/sources?kind=${$('uwpcSourceKind').value}&version=${current.version}`,{method:'POST',credentials:'same-origin',headers:{'Content-Type':file.type||'application/octet-stream','X-Northstar-Filename':encodeURIComponent(file.name)},body:file});
      const data = await response.json(); if (!response.ok) throw new Error(data.error || 'Upload failed');
      show(data); await refresh(); notice('Source saved with this package.');
    }
  }

  function bind() {
    const workspace = document.querySelector('#switching .switching-workspace'); if (!workspace) return;
    const details = document.createElement('details'); details.id = 'uwpcLegacyTools'; details.innerHTML = '<summary>Advanced drawing board and legacy UWPC tools</summary><div class="uwpc-legacy-body"></div>';
    [...workspace.children].forEach(node => details.lastElementChild.append(node)); workspace.append(details);
    root = document.createElement('div'); root.id = 'uwpcDesk'; root.className = 'uwpc-desk';
    root.innerHTML = `<header class="uwpc-title"><div><small>WORK PROTECTION</small><h2>UWPC Builder</h2><p>Create, review and track draft work-protection packages.</p></div><button type="button" data-action="refresh">Refresh</button></header>
      <nav class="uwpc-nav" aria-label="UWPC builder views"><div class="uwpc-new-wrap"><button id="uwpcNewButton" type="button" data-view="new" aria-expanded="false">New</button><div id="uwpcNewMenu" class="uwpc-new-menu" hidden>${forms.map((form,index) => `<button type="button" data-new-form="${index}"><strong>${form.code} · ${esc(form.title)}</strong><small>${esc(form.detail)}</small></button>`).join('')}</div></div><button type="button" data-view="active" aria-selected="true">Active</button><button type="button" data-view="historical" aria-selected="false">Historical</button><button type="button" data-view="example" aria-selected="false">Example</button></nav>
      <p id="uwpcDeskStatus" role="status" aria-live="polite">Loading UWPC records…</p>
      <section class="uwpc-intake" aria-labelledby="uwpcIntakeTitle">
        <div><small>AI ASSISTANCE</small><h3 id="uwpcIntakeTitle">What work is being requested?</h3><p>Paste the request. Add the drawing and procedures you want AI to review.</p></div>
        <form id="uwpcIntakeForm">
          <label><span>Request</span><textarea name="scope" rows="4" maxlength="4000" required placeholder="Describe the work, equipment involved, requested protection and timing…"></textarea></label>
          <div class="uwpc-intake-grid"><label><span>Station / site</span><input name="site" maxlength="120" required placeholder="Station name"></label>
          <label><span>Prepare</span><select name="template"><option value="pc17a">Switching plan + lockout equipment review</option><option value="pc10c-sg">Supporting guarantee request</option><option value="pc17b-sg">Supporting guarantee draft</option><option value="pc2-sg">Work permit support</option></select></label></div>
          <div class="uwpc-intake-grid"><label><span>Drawing / schematic</span><input id="uwpcIntakeDiagram" type="file" accept=".pdf,.png,.jpg,.jpeg,.webp,.json,.txt"></label>
          <label><span>Drawing revision</span><input name="diagramRevision" maxlength="160" placeholder="Revision shown on the drawing"></label></div>
          <details><summary>Procedures and supporting documents</summary><label><span>Attach Code excerpts, procedures or existing work for review</span><input id="uwpcIntakeSources" type="file" multiple accept=".pdf,.png,.jpg,.jpeg,.webp,.json,.txt"></label><small>Up to 8 files total · 10 MB per file · 20 MB per request</small></details>
          <footer><small>AI drafts require qualified review. <a href="knowledge-library.html" target="_blank" rel="noopener">Manage controlled Code and procedure sources</a>. Without a drawing and revision, your request is saved for completion.</small><button class="uwpc-primary" type="submit">Analyze request</button></footer>
        </form>
      </section>
      <section id="uwpcEditor" class="uwpc-editor" hidden></section>
      <section data-view-panel="active" class="uwpc-view"><div class="uwpc-section-head"><div><small>CURRENT PLAN FEED</small><h3>Active packages</h3></div><p>On-going, planned and completed packages. Select any line to open the full form.</p></div><div class="uwpc-inbox"><h4>Waiting for your review <span id="uwpcInboxCount">0</span></h4><div id="uwpcOperatorInbox"></div></div><div id="uwpcActivePlans"></div></section>
      <section data-view-panel="historical" class="uwpc-view" hidden><div class="uwpc-section-head"><div><small>RECORD HISTORY</small><h3>Historical packages</h3></div><p>Completed, cancelled and authority correspondence records.</p></div><div id="uwpcPastPlans"></div><details><summary>Authority correspondence</summary><div id="uwpcAuthorityRecords"></div></details><details><summary>Unclassified legacy drafts</summary><div id="uwpcLegacyPlans"></div></details></section>
      <section data-view-panel="example" class="uwpc-view" hidden><div class="uwpc-section-head"><div><small>TRAINING REFERENCE</small><h3>Example forms</h3></div><p>Examples show presentation only and never create an operational record.</p></div><div class="uwpc-example-grid">${forms.map((form,index) => `<button type="button" data-example="${index}"><span>${form.code}</span><strong>${esc(form.title)}</strong><small>${esc(form.detail)}</small></button>`).join('')}</div><div id="uwpcExampleDetail"></div></section>`;
    workspace.prepend(root);
    if (practice) {
      details.hidden = true;
      root.querySelector('.uwpc-intake').hidden = true;
      root.querySelector('.uwpc-nav').hidden = true;
      root.querySelector('.uwpc-title').innerHTML = '<div><h2>Practice outage</h2><p>Switch between the assigned team members to review the same two-site exercise.</p></div><label>Practice as <select id="outagePracticeActor"></select></label>';
      $('outagePracticeActor').addEventListener('change', e => {
        location.search = new URLSearchParams({as:e.target.value});
      });
    } else {
      root.querySelector('.uwpc-title').insertAdjacentHTML('beforeend','<a class="uwpc-button" href="/outage-practice.html" target="_blank" rel="noopener">Open practice outage</a>');
    }
    $('uwpcIntakeForm').addEventListener('submit', intake);
    root.addEventListener('click', event => {
      if (busy) {event.preventDefault(); return;}
      const button = event.target.closest('button'); if (!button) return;
      if (button.dataset.view) setView(button.dataset.view);
      else if (button.dataset.newForm !== undefined) {const form=forms[Number(button.dataset.newForm)]; $('uwpcNewMenu').hidden=true; show(null,form); $('uwpcEditor').scrollIntoView({block:'start'}); $('uwpcRequestForm').elements.title.focus();}
      else if (button.dataset.example !== undefined) showExample(Number(button.dataset.example));
      else if (button.dataset.request) void run(() => open(button.dataset.request));
      else if (button.dataset.removeSource) void run(() => change('remove-source',{sourceId:button.dataset.removeSource}));
      else if (button.dataset.legacy) {details.open=true; window.NorthStarSwitching?.loadDraft?.(button.dataset.legacy); details.scrollIntoView();}
      else if (button.dataset.action) void run(() => act(button.dataset.action, button));
    });
    const inboxButton = document.createElement('button'); inboxButton.id='uwpcGlobalInbox'; inboxButton.type='button'; inboxButton.hidden=true;
    inboxButton.onclick=()=>{window.NorthstarModules?.open('outages:uwpc'); setView('active'); $('uwpcOperatorInbox').scrollIntoView();}; document.body.append(inboxButton);
    void run(async()=>{
      await refresh();
      if (practice) {
        const titles = {manager:'Control room manager',operator:'Scheduled SSC',checker:'Independent checker',area:'Area manager',field:'Field reviewer'};
        $('outagePracticeActor').innerHTML = operators.map(name => {
          const role = Object.keys(titles).filter(key => roles[key]?.includes(name)).map(key => titles[key]).join(' / ');
          return `<option value="${esc(name)}" ${actor === name ? 'selected' : ''}>${esc(name)} · ${esc(role)}</option>`;
        }).join('');
        const exercise = records[0] || await request(api, 'POST', {practiceSample:true});
        await open(exercise.id);
        notice('Practice team · ' + actor);
      } else notice('Ready. Choose New or open a package from the feed.');
    });
    if (!practice) void request('/api/switching/drafts?limit=500').then(data=>{legacy=Array.isArray(data)?data:[];drawLists();}).catch(error=>{legacyError=error.message;drawLists();});
    setInterval(()=>{if(!document.hidden&&!busy)void refresh().catch(error=>notice(`Inbox refresh failed: ${error.message}`,true));},30000);
    window.NorthStarUwpcDesk={open:id=>run(()=>open(id)),refresh, fromOutage:id=>run(async () => {
      if (dirty) throw new Error('Save or cancel the open form before opening another outage.');
      const row = await request(api, 'POST', {fromOutage:id});
      await refresh(); await open(row.id);
      notice('Opened the plan linked to the outage request.');
    })};
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded',bind); else bind();
})();
