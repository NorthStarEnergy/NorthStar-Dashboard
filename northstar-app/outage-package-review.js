/* Shared by the current and baseline UWPC desks. The server authorizes every decision. */
window.NorthStarOutageReview = function ({esc, when, dateValue, api = '/api/uwpc/requests'}) {
  const reasons = ['routine', 'multi-site', 'crew dependency', 'non-routine switching or lockout', 'manager designation'];
  const names = {manager:'Control room manager', operator:'Scheduled SSC', checker:'Independent competent checker',
    area:'Area manager', field:'On-site field reviewer'};
  const attest = {manager:'I reviewed this revision and the assigned crews.',
    operator:'I checked the switching order, my assigned steps and shift handoffs.',
    checker:'I independently checked this revision against the applicable drawings and procedures.',
    area:'I checked the scope, work window and staffing for each affected site.',
    field:'I checked the equipment references, assigned work and handoffs for my site.'};

  function classification(row) {
    return `<fieldset><legend>Outage review requirements</legend><div class="uwpc-fields">
      <label>Review trigger<select name="reviewTrigger"><option value="">Select when classifying the outage</option>
      ${reasons.map(r => `<option value="${r}" ${r === row.reviewTrigger ? 'selected' : ''}>${esc(r[0].toUpperCase() + r.slice(1))}</option>`).join('')}</select></label>
      <label>Additional affected sites · one per line<textarea name="affectedSites" rows="2">${esc((row.affectedSites || []).filter(s => s !== row.site).join('\n'))}</textarea></label>
      </div><small>Multiple sites require full review. Attach the outage plan, switching order, drawings and applicable UWPC forms under Sources.</small></fieldset>`;
  }

  function options(accounts, selected) {
    return '<option value="">Choose account</option>' + (accounts || []).map(account =>
      `<option ${account === selected ? 'selected' : ''} value="${esc(account)}">${esc(account)}</option>`).join('');
  }

  function assignments(row, roles, actor, accounts) {
    if (row.phase !== 'FUTURE') return '';
    if (!roles.manager?.includes(actor)) {
      return `<p>${roles.manager?.length ? 'A control room manager opens or reissues the review.' : 'The workstation needs a named outage reviewer directory before review can open.'}</p>`;
    }
    const review = row.packageReview || row.lastReview || row.practiceAssignments || {};
    const tasks = review.tasks || [];
    const existing = (role, site = '') => tasks.find(t => t.role === role && t.site === site)?.account;
    return `<details class="uwpc-advanced" ${!review.number ? 'open' : ''}><summary>${review.number ? 'Reissue for a change of package or crew' : 'Assign the outage review'}</summary>
      <form id="outageRouting" class="uwpc-advanced-body"><div class="uwpc-fields">
      <label>Package preparer<select name="preparer" required>${options([...new Set([...roles.manager,...roles.operator])], review.preparer || row.createdBy)}</select></label>
      <label>Review deadline<input type="datetime-local" name="due" required value="${esc(dateValue(review.due))}"></label>
      <label>Independent competent checker<select name="checker" required>${options(roles.checker, existing('checker'))}</select></label>
      <label>Area manager<select name="area" required>${options(roles.area, existing('area'))}</select></label>
      </div><fieldset><legend>SSCs scheduled during the outage</legend><div class="uwpc-operators">
      ${roles.operator.map(name => `<label><input type="checkbox" name="scheduled" value="${esc(name)}" ${tasks.some(t => t.role === 'operator' && t.account === name) ? 'checked' : ''}> ${esc(name)}</label>`).join('')}</div></fieldset>
      <div class="uwpc-fields">${row.affectedSites.map(site => `<label>On-site reviewer · ${esc(site)}<select data-field-site="${esc(site)}" required>${options(roles.field, existing('field', site))}</select></label>`).join('')}</div>
      <details><summary>Additional final-copy recipients</summary><div class="uwpc-operators">${accounts.map(name =>
        `<label><input type="checkbox" name="copyTo" value="${esc(name)}" ${review.copyTo?.includes(name) ? 'checked' : ''}> ${esc(name)}</label>`).join('')}</div></details>
      ${row.reviewNumber ? '<label>Revision or crew changes<textarea name="summary" required></textarea></label>' : ''}
      <label class="uwpc-check"><input type="checkbox" name="confirmed" required> I approve this package for planning review and confirm these assignments against the outage schedule.</label>
      <button type="button" class="uwpc-primary" data-action="review-open">Sign and send revision ${Number(row.reviewNumber || 0) + 1} for review</button></form></details>`;
  }

  function alerts(row, actor, now = Date.now()) {
    const review = row.packageReview;
    if (row.distribution?.recipients.includes(actor) && !row.distribution.receipts[actor])
      return ['Final copy distributed · revision ' + row.distribution.revision];
    if (!review && row.lastReview?.owner === actor && row.phase === 'FUTURE') return ['Reissue the revised package'];
    if (!review || row.phase !== 'FUTURE' || row.status === 'SIGNED_OFF') return [];
    const outstanding = (row.reviewIssues || []).filter(i => !i.closedAt);
    const pending = review.tasks.filter(t => !t.signedAt);
    const due = Date.parse(review.due);
    const timing = now >= due ? 'Overdue' : due - now <= 86400000 ? 'Due within 24 hours' : 'Assigned';
    const taskName = t => names[t.role] + (t.site ? ' · ' + t.site : '') + ' · ' + t.account;
    const result = [];
    for (const issue of outstanding) {
      if (issue.answer && issue.actor === actor) result.push('Confirm correction ' + issue.id);
      if (!issue.answer && review.owner === actor) result.push('Respond to correction ' + issue.id);
    }
    for (const task of pending) {
      const escalation = now >= due && (review.owner === actor || (review.area === actor && task.role === 'field'));
      if (escalation || (!outstanding.length && task.account === actor)) result.push(timing + ' · ' + taskName(task));
    }
    return result;
  }

  function execution(row, roles, actor) {
    const review = row.packageReview;
    if (row.status !== 'SIGNED_OFF' || !review || row.phase === 'CANCELLED') return '';
    const delivery = row.distribution;
    if (!delivery) return review.owner === actor && ['FUTURE','ACTIVE'].includes(row.phase)
      ? '<button type="button" data-action="distribute">Distribute the approved final copy</button>' : '';
    const base = api + '/' + encodeURIComponent(row.id) + '/exports/';
    const tasks = review.tasks.filter(t => t.account === actor && roles[t.role]?.includes(actor));
    const lead = tasks.some(t => ['manager','operator'].includes(t.role));
    const recipient = delivery.recipients.includes(actor);
    const log = row.switchLog;
    const entry = item => `<li><strong>${esc(item.actor)}</strong> · ${esc(when(item.occurredAt || item.at))} ${esc(item.site || '')}
      ${item.step ? ` · Step ${item.step} · ${esc(item.device)}` : ''}<p>${esc(item.text)}</p></li>`;
    return `<section><h4>Final copy distributed</h4><p>Revision ${delivery.revision} · ${esc(when(delivery.at))}</p>
      ${recipient ? `<a class="uwpc-button" download href="${base}final?copy=${encodeURIComponent(delivery.id)}">Download final copy</a>
      ${delivery.receipts[actor] ? '' : '<button type="button" data-action="final-receipt">Acknowledge receipt</button>'}` : ''}
      <details><summary>Distribution record · ${Object.keys(delivery.receipts).length} of ${delivery.recipients.length} acknowledged</summary>
      ${delivery.recipients.map(name => `<p>${esc(name)} · ${delivery.receipts[name] ? esc(when(delivery.receipts[name])) : 'Delivered to inbox'}</p>`).join('')}</details></section>
      <section><h4>Electronic switching log</h4>
      ${!log ? (lead && row.phase === 'FUTURE' ? '<button type="button" data-action="log-open">Open switching log</button>' : '<p>Awaiting log opening.</p>') :
      `<p>Opened by ${esc(log.openedBy)} · ${esc(when(log.openedAt))}</p><ol>${log.entries.map(entry).join('')}</ol>
      ${row.phase === 'ACTIVE' && tasks.length ? `<fieldset><legend>Record switching activity</legend><label>Site<select name="site"><option value="">Control room</option>${row.affectedSites.map(s => `<option>${esc(s)}</option>`).join('')}</select></label>
        <label>Order step<select name="step"><option value="">General entry or handoff</option>${(row.switchingPlan?.steps || []).map((s,i) => `<option value="${i + 1}">${i + 1} · ${esc(s.device)} · ${esc(s.operation)}</option>`).join('')}</select></label>
        <label>Time of activity (defaults to time saved)<input name="occurredAt" type="datetime-local"></label>
        <label>Activity or handoff<textarea name="text" maxlength="4000"></textarea></label><button type="button" data-action="log-entry">Save log entry</button></fieldset>` : ''}
      ${row.phase === 'ACTIVE' && lead ? '<fieldset><legend>Finish outage</legend><label>Closing summary<textarea name="text" maxlength="4000"></textarea></label><button type="button" data-action="log-close">Finish and close outage</button></fieldset>' : ''}
      ${log.closure ? `<h4>Finished / closed</h4><ul>${entry(log.closure)}</ul><h4>Closeout notes</h4><ul>${log.notes.map(entry).join('')}</ul>
        ${tasks.length ? '<fieldset><label>Follow-up note<textarea name="text" maxlength="4000"></textarea></label><button type="button" data-action="closeout-note">Save closeout note</button></fieldset>' : ''}
        <a class="uwpc-button" download href="${base}package?v=${Number(row.version)}">Download closeout record and sources</a>` : ''}`}</section>`;
  }

  function cover(row, roles, actor, accounts = []) {
    if (!row.id || !row.reviewTrigger || row.reviewTrigger === 'routine') return '';
    const review = row.packageReview;
    const issues = row.reviewIssues || [];
    const openIssues = issues.some(i => !i.closedAt);
    const status = row.status === 'SIGNED_OFF' ? 'Planning review complete' : openIssues ? 'Review on hold' : review ? 'Awaiting signatures' : 'Awaiting manager review';
    return `<section class="uwpc-inbox" aria-label="Outage review cover"><h4>Outage package review · ${status}</h4>
      <p>${esc(row.reviewTrigger)} · ${row.affectedSites.map(esc).join(', ')}</p>
      ${review ? `<p>Review revision ${review.number} · Due ${esc(when(review.due))} · Prepared by ${esc(review.preparer)}</p>
      <p>${esc(review.summary)}</p><a class="uwpc-button" download href="${api}/${encodeURIComponent(row.id)}/exports/package?v=${Number(row.version)}">Download package with review cover and sources</a><div class="uwpc-switching-table-wrap"><table class="uwpc-switching-table"><thead><tr><th>Required review</th><th>Assigned to</th><th>Signature</th></tr></thead>
      <tbody>${review.tasks.map(t => `<tr><td>${esc(names[t.role])} ${esc(t.site)}</td><td>${esc(t.account)}</td><td>${t.signedAt ? esc(when(t.signedAt)) : (review.viewed?.[t.account] ? 'Viewed · signature pending' : 'Pending')}</td></tr>`).join('')}</tbody></table></div>
      ${row.phase === 'FUTURE' ? review.tasks.filter(t => t.account === actor && roles[t.role]?.includes(actor)).map(t =>
      `<fieldset data-task="${esc(t.id)}"><legend>${esc(names[t.role])} ${esc(t.site)}</legend>
      ${!t.signedAt && !openIssues ? `<label class="uwpc-check"><input type="checkbox" name="confirmed"> ${esc(attest[t.role])}</label><button type="button" data-action="review-sign">Sign revision ${review.number}</button>` : ''}
      <label>Correction to this revision<textarea name="comment" rows="2"></textarea></label><button type="button" data-action="review-return">Return for correction</button></fieldset>`).join('') : ''}` : ''}
      ${issues.map(i => `<article class="uwpc-history" data-issue="${esc(i.id)}"><strong>Correction ${esc(i.id)} · revision ${esc(i.revision)} · ${esc(i.actor)}</strong><p>${esc(i.comment)}</p>
        ${i.answer ? `<p>Manager response · ${esc(i.answer)}</p>` : ''}
        ${i.closedAt ? `<small>Confirmed ${esc(when(i.closedAt))}</small>` : review && review.owner === actor ? '<label>Manager response<textarea name="comment"></textarea></label><button type="button" data-action="review-answer">Send response</button>' : ''}
        ${!i.closedAt && i.answer && actor === i.actor && review ? '<button type="button" data-action="review-close">Confirm resolution</button>' : ''}</article>`).join('')}
      ${assignments(row, roles, actor, accounts)}${execution(row, roles, actor)}</section>`;
  }

  function actionData(action, button, row) {
    if (action === 'review-open') {
      const form = button.form;
      if (!form.reportValidity()) return null;
      const fields = new FormData(form);
      return {...Object.fromEntries(fields), due:new Date(fields.get('due')).toISOString(), confirmed:fields.has('confirmed'),
        operators:fields.getAll('scheduled'), copyTo:fields.getAll('copyTo'), field:Object.fromEntries([...form.querySelectorAll('[data-field-site]')].map(s => [s.dataset.fieldSite, s.value]))};
    }
    const block = button.closest('[data-task],[data-issue]');
    return {digest:row.packageReview.digest, task:block.dataset.task, issue:block.dataset.issue,
      comment:block.querySelector('[name=comment]')?.value, confirmed:block.querySelector('[name=confirmed]')?.checked === true};
  }
  return {classification, cover, alerts, actionData};
};
