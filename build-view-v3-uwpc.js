/* NorthStar v3: authored training examples. No operational records or commands. */
(() => {
  'use strict';
  const SOURCES = [
    { id: 'code', title: '2024 Utility Work Protection Code', url: 'https://drive.google.com/file/d/119Kd70qZMt7d0umMfT_x5XOa4-520kFb/view?usp=drivesdk', note: 'Hydro One / IHSA book supplied in Drive; instrument rules and section references. Read 27 Oct 2026.' },
    { id: 'oto', title: 'Completed PC17A example · FL.On.rev.2024-05', url: 'https://drive.google.com/file/d/1Uh2Z7rGuc7Wp9TW2XlYn6Vv0iQ1LKky0/view?usp=drivesdk', note: 'Used for the order-column structure and the concept of a job needing guarantees at both ends. Its real devices, people and operating sequence are not reused.' },
    { id: 'water', title: 'Surface Water and Underwater Work · Rev 4', url: 'https://drive.google.com/file/d/1RC9P11fO2zuiSYnxLrA2TYBqBZtKrZqE/view?usp=drivesdk', note: 'FLC-1.1-A-04, issued 21 Mar 2025; sections 2 and 5 inform the water-work hold points.' }
  ];
  const NOT_ISSUED = 'Not issued / accepted / released';
  const UNKNOWN = 'SITE REVIEW REQUIRED';
  const commonFields = (ref, asset, scope, type) => [
    ['Application', `${ref}-PC1 · fictional completed application`],
    ['Station / site', 'Cedar Training Model · fictional; no live site ID'],
    ['Equipment / asset', asset],
    ['Requested work protection', type],
    ['Applicant', 'Training Applicant A · fictional role'],
    ['Proposed Holder / work group', 'Training Holder H · one fictional work group'],
    ['Controlling Authority', 'Training Control Desk C · fictional role'],
    ['Work period', 'Exercise Day 1 · 08:00–16:00 · America/Toronto'],
    ['Work description', scope],
    ['Operational status', NOT_ISSUED]
  ];
  const order = (device, operation, detail, place = '—', remove = '—', lock = '—') => ({ device, operation, detail, place, remove, lock, orderedBy: 'Not ordered', completedBy: 'Not performed' });
  const EXAMPLES = [
    {
      id: 'single-device', reference: 'TRN-001', title: 'Single-device motor inspection', kind: 'Electrical maintenance', forms: 'PC10A', orderTitle: 'PC10A switching-order study', instrumentId: 'pc10a', sourceIds: ['code'],
      premise: 'A fictional bench model has one motor and exactly one guaranteed isolating device, SIM-DS-01. It has one work group, no supporting guarantee and no other supply. These are exercise assumptions, not statements about any NorthStar plant.',
      fields: commonFields('TRN-001', 'SIM-M-01 motor / SIM-DS-01 isolator', 'Inspect the motor terminal enclosure on a de-energized training model. No energized test or rotation is included.', 'PC10A Self-Administered Work Permit'),
      companion: [['PC10A draft reference', 'TRN-001-PC10A'], ['Guaranteed device', 'SIM-DS-01 · OPEN is the proposed exercise position'], ['Tag / lock plan', 'SIM-PC10A-001 / SIM-LK-001 · illustrative identifiers only'], ['Supporting guarantees', 'None; the one-device/no-supporting-guarantee restriction is an exercise prerequisite'], ['Tests', 'None requested'], ['Hazards outside the guarantee', 'Adjacent live equipment, stored energy and hidden feeds must be assessed; none is asserted absent at a real site'], ['Temporary de-energizing measures', 'Not specified: qualified site review must determine what is required and when'], ['Holder acceptance / surrender', NOT_ISSUED]],
      orders: [
        order('SIM-DS-01', 'Identify the device against the exercise drawing', 'Match the proposed one-device boundary to the work scope. A real job requires the current approved drawing and an actual field identification; a label match in this example proves nothing.'),
        order('SIM-DS-01', 'Draft: open, check position, lock and identify', 'Illustrates a proposed isolation entry. The competent preparer must supply the approved operating and proving method; hidden contacts, secondary supplies and stored energy are unresolved for a real job.', 'SIM-PC10A-001', '—', 'SIM-LK-001'),
        order('TRN-001-PC10A', 'Hold point: establish conditions and Holder acceptance', 'The 2024 Code separates establishing the guarantee from accepting the Work Permit. Temporary de-energizing measures belong after acceptance where required; this example records neither acceptance nor field verification.'),
        order('SIM-M-01', 'Hold point: required de-energizing and safe-work checks', 'The site-specific procedure, verification method, residual-energy controls and actual observations must be supplied before work. No voltage, grounding requirement or test result is invented.'),
        order('TRN-001-PC10A', 'Return plan: surrender, report status, obtain return approval', 'Study the administrative return path in 3.051. Equipment operations and tag removal must be recorded on an independently reviewed site-specific return order; this row is not an instruction to energize.')
      ],
      rules: [['3.002', 'PC10A is limited to one guaranteed device and one work group; it cannot use a Supporting Guarantee.'], ['3.011; 3.021', 'Acceptance and the hazards outside the guarantee are separate considerations.'], ['3.051; 7.020', 'Surrender and temporary de-energizing have their own requirements; neither is inferred from this draft.']],
      missing: ['Current approved equipment drawing and every actual source of energy', 'Device identification, approved isolation/proving procedure and any de-energizing requirements', 'Actual qualified roles, permission, observations, acceptance and return-to-service records']
    },
    {
      id: 'sluice-actuator', reference: 'TRN-002', title: 'Sluice actuator seal replacement', kind: 'Hydro / mechanical', forms: 'PC17B', orderTitle: 'PC17B switching-order study', instrumentId: 'pc17b', sourceIds: ['code', 'water'],
      premise: 'The fictional model has an electric hydraulic pump, pressure supply and return paths, and a gravity-loaded gate. Four proposed guaranteed devices make independent preparation and checking part of this exercise. The safe-work boundary and actual devices remain a site engineering question.',
      fields: commonFields('TRN-002', 'SIM-GATE-A actuator / SIM-HPU-A hydraulic unit', 'Replace actuator seals from the dry service platform. No gate movement, waterway entry or diving is included.', 'PC17B Self-Administered Work Permit'),
      companion: [['PC17B draft reference', 'TRN-002-PC17B · isolation study'], ['Proposed guaranteed devices', 'SIM-DS-A; SIM-SUP-A; SIM-RET-A; SIM-BLOCK-A · illustrative only'], ['Preparation / independent check', 'Training Preparer P / Training Checker Q · review not performed'], ['Requested condition', 'Electrical isolation, hydraulic isolation and a verified mechanically restrained condition'], ['Stored energy', 'Hydraulic accumulators, trapped pressure and gravitational load require a site-specific method'], ['Water constraints', 'Control Desk must establish plant/water constraints and whether this work can proceed'], ['Supporting guarantees / tests', 'None in this exercise; reassess if the actual boundary involves another authority'], ['Holder acceptance / surrender', NOT_ISSUED]],
      orders: [
        order('Work boundary', 'Hold point: validate all energy paths and water constraints', 'The exercise cannot establish safety from a single gate symbol. Confirm electric, pressure, gravity and water influences using the actual drawings and procedures. Do not enter waterways under this example.'),
        order('SIM-DS-A', 'Proposed entry: isolate hydraulic power-unit electrical supply', 'The exact approved operation and proving method must be inserted by qualified site staff. This entry reserves the electrical supply boundary in the form.', 'SIM-PC3-201', '—', 'SIM-LK-201'),
        order('SIM-SUP-A / SIM-RET-A', 'HOLD: supply and return isolation sequence is unresolved', 'No generic close-valve order is provided. Trapped pressure, bypasses, accumulators and device design determine the approved order. Each actual operation must be a separate numbered row when sequence matters.', 'SIM-PC3-202 / 203', '—', UNKNOWN),
        order('SIM-BLOCK-A', 'HOLD: establish engineered restraint and verify stored energy', 'The restraint rating, placement, gate condition and pressure-relief method need engineering/site evidence. No block size, pressure target or safe water level is assumed.', 'SIM-PC3-204', '—', UNKNOWN),
        order('TRN-002-PC17B', 'Hold point: complete guarantee, check hazards and acceptance', 'Independent preparation/checking is required for this four-guaranteed-device exercise. Acceptance and any additional de-energizing must follow the applicable Code and site procedures; they have not occurred.'),
        order('Return to service', 'HOLD: separate reviewed restoration order required', 'Gate movement and restoring hydraulic energy can change water flow. Confirm people, tools, restraints, work protection and water constraints through the actual controlling process before any restoration.')
      ],
      rules: [['4.002; 4.011–4.014', 'PC17B supports multiple guaranteed devices; this four-device exercise needs independent preparation and checking.'], ['4.031; 7.000–7.020', 'Residual mechanical energy and hazards outside the guarantee need explicit treatment.'], ['FLC-1.1-A-04 §§2, 5', 'Waterway work requires coordination with the System Shift Coordinator; work cannot proceed when required flow and water-management conditions cannot be met.']],
      missing: ['Hydraulic schematic, accumulator arrangement, gate loads and engineered blocking method', 'Actual guaranteed devices, proven positions, sequence, inspection criteria and residual-energy method', 'Current water conditions, approved operating limits and any waterway-specific work plan']
    },
    {
      id: 'line-guarantees', reference: 'TRN-003', title: 'Line maintenance with two supporting guarantees', kind: 'Multi-authority work', forms: 'PC1 · PC2 · PC17A', orderTitle: 'PC17A order package study', instrumentId: 'pc2', sourceIds: ['code', 'oto'],
      premise: 'A fictional line section SIM-LINE-1 runs between East Training Station and West Training Station. Different authorities control the two ends. This studies the documentation relationships seen in the supplied completed PC17A, without copying its real equipment or sequence.',
      fields: commonFields('TRN-003', 'SIM-LINE-1 · span between training stations East and West', 'Replace a damaged line insulator on the isolated work section. No live-line work or energized tests are requested.', 'PC2 Issued Work Permit supported by two guarantees'),
      companion: [['PC2 / PC17A draft references', 'TRN-003-PC2 / TRN-003-OTO-E + TRN-003-OTO-W · page counts pending'], ['Coordinating Issuing Authority', 'Training Issuer I · fictional role; has not issued a permit'], ['East-end guarantee request', 'TRN-003-SG-E · requested, not received'], ['West-end guarantee request', 'TRN-003-SG-W · requested, not received'], ['Guarantee recipient / use', 'Training Issuer I · each accepted guarantee allocated to this one proposed work permit'], ['Isolation vs working clearance', 'Worked-on line section and any neighbouring circuit needing clearance must be listed separately'], ['De-energizing / induced energy', 'Grounding/bonding design and neighbouring energized circuits require site-specific review'], ['Permit safety precautions', 'Identify hazards not eliminated, any additional de-energizing, and verified limits of each guarantee'], ['Acceptance / termination', NOT_ISSUED]],
      orders: [
        order('TRN-003-PC1', 'Document exact work limits, equipment, tests and hazards', 'A descriptive scope is filled above. Actual installed nomenclature, physical limits and hazard controls must be verified before the application is usable.'),
        order('TRN-003-SG-E / SG-W', 'HOLD: obtain and verify both guarantee boundaries', 'The coordinating authority must obtain the necessary guarantees from the other controlling authorities. A request or a displayed status is not an issued guarantee.'),
        order('East-end devices', 'HOLD: attach independently prepared and checked end order', 'The actual switching devices, sequence, tag/lock numbers, current network configuration and field checkbacks belong on TRN-003-OTO-E. They are intentionally unresolved here.', UNKNOWN, '—', UNKNOWN),
        order('West-end devices', 'HOLD: attach independently prepared and checked end order', 'TRN-003-OTO-W must establish the agreed boundary under its own authority. Do not copy an order from another line or an earlier outage.', UNKNOWN, '—', UNKNOWN),
        order('TRN-003-PC2', 'Hold point: reconcile guarantees, hazards and permit conditions', 'Confirm all PC1/OTO references and page counts. If all required isolation is provided by guarantees, the qualified Establishing Authority must determine whether the Code’s no-additional-isolation provision actually applies.'),
        order('Work area', 'Hold point: acceptance then required temporary de-energizing', 'Any required temporary grounds/de-energizing are determined by the Holder’s approved procedure after acceptance and before work. No ground locations or safe approach distances are generated here.'),
        order('Return package', 'HOLD: coordinate surrender, termination and guarantee release', 'The supported work permit must be surrendered/terminated before a supporting guarantee is surrendered. The responsible authorities must verify dependencies and the separately reviewed restoration sequence.')
      ],
      rules: [['5.014; 5.031–5.037', 'Coordinate authorities, independently prepare/check the PC2/PC17A, and preserve all document references.'], ['6.003; 6.010; 6.040', 'A Holder uses a Supporting Guarantee for one Work Permit or one Supporting Guarantee at a time; dependencies matter at surrender.'], ['7.020', 'Temporary de-energizing is a defined Holder responsibility after acceptance/issuance and before work.']],
      missing: ['Current line diagram, exact work section, induced/backfeed hazards and actual authority boundaries', 'Approved end orders, verified supporting guarantees, field observations and grounding/bonding procedure', 'Neighbouring circuit status, work-clearance requirements and reviewed restoration sequence']
    },
    {
      id: 'controlled-test', reference: 'TRN-004', title: 'Controlled actuator test under a PC2', kind: 'Testing', forms: 'PC14 · PC15', orderTitle: 'PC14 order-to-operate study', instrumentId: 'pc2', sourceIds: ['code'],
      premise: 'A fictional accepted PC2 is assumed solely for studying a proposed test request. One actuator device would need operation while its PC3 remains associated with it. No actual permit is accepted, no test is authorized, and no device can be operated from this module.',
      fields: commonFields('TRN-004', 'SIM-ACT-01 actuator / SIM-DEV-T1 proposed test device', 'Request one controlled travel test after maintenance, within a defined guarded exercise area. No repeated cycling is requested.', 'PC14 test condition associated with a PC2 Work Permit'),
      companion: [['Associated work permit', 'TRN-004-PC2 · assumed exercise prerequisite, not a live permit'], ['PC14 draft reference', 'TRN-004-PC14'], ['Requested test condition', 'One supervised actuator operation; exact travel, energy and position limits remain unresolved'], ['Guaranteed device / PC3 reference', 'SIM-DEV-T1 / SIM-PC3-401 · illustrative identifiers'], ['Test tag proposal', 'SIM-PC15-401 (TT) together with the PC3 tag'], ['Affected Holders', 'Training Holder H and every other affected Holder must be identified and involved'], ['OTO method', 'PC14 integrated OTO study, maximum ten operations; no separate PC17A is combined with this OTO'], ['Multiple operations', 'Not requested; any change requires the applicable test-condition process'], ['Test authorization / acceptance', 'Not authorized / not accepted'], ['Return to pretest state', 'Required reviewed order and verified condition not yet supplied']],
      orders: [
        order('TRN-004-PC14', 'HOLD: evaluate test hazards and affected work protection', 'Testing cannot operate a device guaranteed for another Work Permit or energize equipment isolated for another Work Permit. Resolve conflicts, limits, fitness for test and all affected Holders before authorization.'),
        order('SIM-DEV-T1', 'Draft: apply the identified PC15 with the PC3 tag', 'This is a proposed form entry only. Applying a PC15 changes the device’s guaranteed status. Required authorization, independent preparation/checking and a complete safe test procedure must exist before an actual operation.', 'SIM-PC15-401 (TT)'),
        order('SIM-ACT-01', 'HOLD: insert approved test operation and acceptance criteria', 'The direction, travel, energy limits, guarding, communication and abort criteria must come from the equipment-specific procedure. This example cannot supply them.'),
        order('SIM-DEV-T1', 'HOLD: restore and verify the approved pretest condition', 'The reviewed return order must identify the worker-safe position and verification. Tag removal alone does not prove that the pretest condition has been restored.'),
        order('SIM-DEV-T1', 'Draft: remove test tag only through the approved return process', 'Record the actual return from test, inform the necessary parties and re-establish required de-energization before work resumes. No test-tag removal or completion is recorded by this example.', '—', 'SIM-PC15-401 (TT)')
      ],
      rules: [['5.111–5.113', 'A PC14 manages the hazardous test condition; a PC15 is placed with the PC3 when the guaranteed device must be operated.'], ['5.121–5.123', 'Independent preparation/checking and the affected Holders’ authorization/acceptance are part of the test process.'], ['5.121; 7.002', 'An integrated PC14 OTO is limited to ten operations and cannot be combined with a separate PC17A OTO; required de-energization must be re-established after re-energization.']],
      missing: ['Actual accepted permit, affected Holders and current dependencies', 'Equipment-specific test limits, hazards, supervision, communications and abort criteria', 'Approved test/return orders, actual authorizations and verified pretest condition']
    }
  ];
  const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  const freeze = value => { if (value && typeof value === 'object' && !Object.isFrozen(value)) { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };
  freeze(EXAMPLES); freeze(SOURCES);
  const find = id => EXAMPLES.find(example => example.id === id);
  const fieldMarkup = fields => `<dl class="v3-uwpc-fields">${fields.map(([label, value]) => `<div><dt>${escape(label)}</dt><dd>${escape(value)}</dd></div>`).join('')}</dl>`;
  const sourceMarkup = example => example.sourceIds.map(id => SOURCES.find(source => source.id === id)).filter(Boolean).map(source => `<li><a href="${escape(source.url)}" target="_blank" rel="noopener noreferrer">${escape(source.title)} ↗</a><p>${escape(source.note)}</p></li>`).join('');
  function detailMarkup(example, printable = false) {
    return `<article class="v3-uwpc-detail" data-example-id="${escape(example.id)}">
      <div class="v3-uwpc-detail-head"><div><p class="v3-uwpc-eyebrow">${escape(example.reference)} · ${escape(example.forms)}</p><h3>${escape(example.title)}</h3></div><span class="v3-uwpc-badge">Training only</span></div>
      <p class="v3-uwpc-notice"><strong>Fictional training draft — not a Work Permit or an executable switching order.</strong> No operations, authorization, acceptance or release are recorded. The filled fields show form intent; unresolved site-specific details are explicit hold points.</p>
      <p class="v3-uwpc-premise">${escape(example.premise)}</p>
      <section><h4>Application example</h4>${fieldMarkup(example.fields)}</section>
      <section><h4>${escape(example.forms)} · companion record</h4>${fieldMarkup(example.companion)}</section>
      <section><h4>${escape(example.orderTitle)}</h4><p class="v3-uwpc-hint">Each row is one draft entry.${printable ? '' : ' Select a row for the full rationale and missing evidence.'} Ordered/completed columns remain unexecuted.</p>
      <div class="v3-uwpc-table-wrap"><table class="v3-uwpc-orders"><thead><tr><th scope="col">Seq.</th><th scope="col">Device / record</th><th scope="col">Proposed entry</th><th scope="col">Place tag</th><th scope="col">Remove tag</th><th scope="col">Lock</th><th scope="col">Ordered by</th><th scope="col">Completed by</th></tr></thead><tbody>${example.orders.map((row, index) => `<tr><td>${index + 1}</td><td title="${escape(row.device)}">${escape(row.device)}</td><td>${printable ? escape(row.operation) : `<button type="button" class="v3-uwpc-order-open" data-order-index="${index}" aria-label="Open entry ${index + 1}: ${escape(row.operation)}" title="${escape(row.operation)}">${escape(row.operation)}</button>`}</td><td title="${escape(row.place)}">${escape(row.place)}</td><td title="${escape(row.remove)}">${escape(row.remove)}</td><td title="${escape(row.lock)}">${escape(row.lock)}</td><td>${escape(row.orderedBy)}</td><td>${escape(row.completedBy)}</td></tr>${printable ? `<tr class="v3-uwpc-print-rationale"><td></td><td colspan="7">${escape(row.detail)}</td></tr>` : ''}`).join('')}</tbody></table></div>
      ${printable ? '' : '<div class="v3-uwpc-entry-detail" hidden tabindex="-1" role="region" aria-label="Switching entry details"></div>'}</section>
      <section><h4>What the qualified site review still needs</h4><ul class="v3-uwpc-missing">${example.missing.map(item => `<li>${escape(item)}</li>`).join('')}</ul></section>
      <section><h4>Why this example uses these forms</h4><dl class="v3-uwpc-rules">${example.rules.map(([reference, rule]) => `<div><dt>${escape(reference)}</dt><dd>${escape(rule)}</dd></div>`).join('')}</dl></section>
      <section><h4>Source documents</h4><ul class="v3-uwpc-sources">${sourceMarkup(example)}</ul><p class="v3-uwpc-hint">Based on the supplied 2024 edition and documents read 27 Oct 2026. These original NorthStar study sheets do not reproduce the official form artwork or verify current site procedures.</p></section>
    </article>`;
  }
  function printableHtml(id) {
    const example = find(id);
    if (!example) throw new Error('Unknown UWPC training example');
    return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(example.reference)} — fictional UWPC training</title><style>body{font:14px/1.5 Arial,sans-serif;max-width:1100px;margin:28px auto;padding:0 20px;color:#15232a}h3{font-size:25px;margin:6px 0}h4{margin:24px 0 8px;border-bottom:1px solid #bfcad0;padding-bottom:5px}p{margin:6px 0 12px}.v3-uwpc-notice{border:2px solid #956415;padding:12px;background:#fff7e9}.v3-uwpc-badge,.v3-uwpc-eyebrow{font-weight:bold;color:#795108}.v3-uwpc-fields{display:grid;grid-template-columns:1fr 1fr;gap:8px 24px}.v3-uwpc-fields div{break-inside:avoid;border-bottom:1px solid #d7dfe3;padding:6px 0}dt{font-weight:bold}dd{margin:3px 0}.v3-uwpc-orders{border-collapse:collapse;width:100%;font-size:11px;table-layout:fixed}.v3-uwpc-orders th,.v3-uwpc-orders td{border:1px solid #a5b2b9;padding:6px;overflow-wrap:anywhere;text-align:left}.v3-uwpc-orders th:first-child{width:28px}.v3-uwpc-orders th:nth-child(3){width:24%}.v3-uwpc-print-rationale td{background:#f3f6f7;font-size:11px}.v3-uwpc-rules>div{margin:8px 0}.v3-uwpc-sources li{margin:8px 0}a{color:#185a81}section{break-inside:auto}tr{break-inside:avoid}@media print{body{margin:0;padding:0;font-size:10pt}.v3-uwpc-fields{gap:5px 16px}a{color:inherit}.v3-uwpc-notice{background:white}h4{break-after:avoid}}</style></head><body>${detailMarkup(example, true)}<footer>Fictional training only · ${escape(example.reference)} · No operational release</footer></body></html>`;
  }
  function download(id) {
    const example = find(id);
    if (!example) return;
    const url = URL.createObjectURL(new Blob([printableHtml(id)], { type: 'text/html;charset=utf-8' }));
    const link = document.createElement('a'); link.href = url; link.download = `${example.reference}-fictional-UWPC-training.html`;
    document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function mount(host, options = {}) {
    if (typeof host === 'string') host = document.querySelector(host);
    if (!host || typeof host.replaceChildren !== 'function') throw new TypeError('A host element is required');
    const root = document.createElement('section'); root.className = 'v3-uwpc'; root.setAttribute('aria-label', 'UWPC training examples');
    host.replaceChildren(root);
    let activeId = '';
    function showList(focusId) {
      activeId = '';
      root.innerHTML = `<header class="v3-uwpc-header"><div><h2>Training examples</h2><p>Filled applications and switching-order studies from your Drive references.</p></div><span class="v3-uwpc-badge">4 examples</span></header><p class="v3-uwpc-intro">Fictional equipment and roles. Open an example to review the form, proposed entries, hold points and source references.</p><div class="v3-uwpc-list" role="list">${EXAMPLES.map(example => `<div role="listitem"><button type="button" class="v3-uwpc-example-row" data-open-example="${escape(example.id)}"><span class="v3-uwpc-ref">${escape(example.reference)}</span><strong title="${escape(example.title)}">${escape(example.title)}</strong><span class="v3-uwpc-kind">${escape(example.kind)}</span><span class="v3-uwpc-forms">${escape(example.forms)}</span><span aria-hidden="true">→</span></button></div>`).join('')}</div><p class="v3-uwpc-footer">Read-only study sheets · no changes to saved requests or work-protection records.</p>`;
      if (focusId) root.querySelector(`[data-open-example="${focusId}"]`)?.focus();
    }
    function openExample(id, shouldFocus = true) {
      const example = find(id); if (!example) return false; activeId = id;
      root.innerHTML = `<div class="v3-uwpc-toolbar"><button type="button" data-examples-back>← Examples</button><span>${escape(example.kind)}</span><button type="button" data-example-download>Save printable example</button></div>${detailMarkup(example)}`;
      if (shouldFocus) { const heading = root.querySelector('h3'); heading.tabIndex = -1; heading.focus(); }
      options.onOpen?.(id);
      return true;
    }
    function onClick(event) {
      const target = event.target.closest('button'); if (!target || !root.contains(target)) return;
      if (target.dataset.openExample) { openExample(target.dataset.openExample); return; }
      if (target.hasAttribute('data-examples-back')) { const previous = activeId; showList(previous); return; }
      if (target.hasAttribute('data-example-download')) { download(activeId); return; }
      if (target.hasAttribute('data-close-entry')) {
        const panel = root.querySelector('.v3-uwpc-entry-detail'); const index = panel.dataset.index;
        panel.hidden = true; root.querySelector(`[data-order-index="${index}"]`)?.focus(); return;
      }
      if (target.hasAttribute('data-order-index')) {
        const example = find(activeId); const index = Number(target.dataset.orderIndex); const row = example?.orders[index]; if (!row) return;
        const panel = root.querySelector('.v3-uwpc-entry-detail'); panel.hidden = false; panel.dataset.index = String(index);
        panel.innerHTML = `<header><h5>Entry ${index + 1} · ${escape(row.device)}</h5><button type="button" data-close-entry aria-label="Close entry detail">×</button></header><p><strong>${escape(row.operation)}</strong></p><p>${escape(row.detail)}</p>${fieldMarkup([['Place tag / remove tag', `${row.place} / ${row.remove}`], ['Lock', row.lock], ['Ordered by', row.orderedBy], ['Completed by', row.completedBy]])}`;
        panel.focus(); panel.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      }
    }
    root.addEventListener('click', onClick); showList();
    if (options.exampleId) openExample(options.exampleId, false);
    return { openExample, showList, destroy() { root.removeEventListener('click', onClick); root.remove(); } };
  }
  window.NorthstarBuildV3Uwpc = Object.freeze({ mount, examples: EXAMPLES, sources: SOURCES, getExample: find, printableHtml, version: '2026-10-27.1' });
})();
