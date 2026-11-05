(() => {
  const KEY = 'northstarSwitchingDraftV1';
  const MAX_FILE_BYTES = 25 * 1024 * 1024;
  const state = {
    schema: 1,
    id: '',
    version: 0,
    status: 'DRAFT',
    storage: 'LOCAL',
    serverUpdatedAt: '',
    packageName: '',
    site: '',
    siteId: '',
    asset: '',
    outageId: '',
    schematicId: '',
    schematicRevision: 0,
    symbolProfileApprovalRef: '',
    canonicalAssetId: '',
    topologySnapshotId: '',
    topologyRevision: '',
    revision: '',
    ruleSet: 'UWPC 2024',
    authorityProcedureId: 'uwpc-2024',
    authorityProcedureRevision: '2024',
    workProtectionId: '',
    workProtectionName: '',
    workProtectionSection: '',
    workProtectionTemplateId: '',
    templateFields: {},
    qualificationEvidenceRef: '',
    sourceManifestDigest: '',
    scope: '',
    diagrams: [],
    ruleSources: [],
    isolation: [],
    sequence: [],
    verification: [],
    permission: [],
    restoration: [],
    reviewerName: '',
    reviewerRole: '',
    reviewComments: '',
    checks: {},
    audit: [],
    savedAt: ''
  };
  let selectedFiles = [];
  let selectedRuleFiles = [];
  let outageRecords = [];
  let schematicRecords = [];

  function buildEngineeringHub() {
    const workspace = document.querySelector('#switching .switching-workspace');
    const banner = workspace?.querySelector('.switching-banner');
    if (!workspace || !banner || workspace.querySelector('.uwpc-request-desk')) return;

    const label = banner.querySelector('label');
    const title = banner.querySelector('h2');
    if (label) label.textContent = 'UWPC · WORK PROTECTION REQUEST DESK';
    if (title) title.textContent = 'Requests and Forms';
    const intro = document.createElement('p');
    intro.className = 'engineering-banner-copy';
    intro.textContent = 'Process saved requests, start a familiar PC1 application, or open the UWPC form library.';
    title?.after(intro);

    const desk = document.createElement('nav');
    desk.className = 'uwpc-request-desk';
    desk.setAttribute('aria-label', 'UWPC request desk');
    desk.innerHTML = `
      <button type="button" class="uwpc-desk-action" data-uwpc-target="#switchingLibrary"><span>PROCESS EXTERNAL REQUESTS</span><strong>Open the request inbox</strong><small>Continue a saved PC1 application through its draft and review record.</small><em>OPEN REQUESTS →</em></button>
      <button type="button" class="uwpc-desk-action" data-uwpc-target="#uwpcQuickStart"><span>CREATE A REQUEST</span><strong>Start a PC1 application</strong><small>Use the company form layout and save a NorthStar draft.</small><em>CREATE REQUEST →</em></button>
      <button type="button" class="uwpc-desk-action" data-uwpc-target="#switchingTemplates"><span>VIEW UWPC FORMS</span><strong>Open the form library</strong><small id="uwpcFormsSummary">PC1, permits, tags, and companion forms</small><em>VIEW FORMS →</em></button>`;
    desk.querySelectorAll('[data-uwpc-target]').forEach(button => {
      button.addEventListener('click', () => {
        const target = document.querySelector(button.dataset.uwpcTarget);
        target?.closest('details.uwpc-workflow-group')?.setAttribute('open', '');
        target?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    });
    const quickForm = workspace.querySelector('#uwpcQuickStart .switching-quick-form');
    const requestFiles = workspace.querySelector('#wpSourceFiles');
    if (quickForm && requestFiles) quickForm.append(requestFiles);

    const wrapWorkflow = (selector, id, heading, hint) => {
      const panel = workspace.querySelector(selector);
      if (!panel) return null;
      const group = document.createElement('details');
      group.className = 'uwpc-workflow-group';
      group.id = id;
      group.innerHTML = `<summary><span>${heading}</span><small>${hint}</small></summary><div class="uwpc-workflow-body"></div>`;
      panel.before(group);
      group.querySelector('.uwpc-workflow-body').append(panel);
      return group;
    };
    wrapWorkflow('#uwpcQuickStart', 'uwpc-workflow-create', 'Create a request', 'Start a company-layout PC1 application');
    wrapWorkflow('#switchingLibrary', 'uwpc-workflow-process', 'Process external requests', 'Open saved PC1 applications');
    const formsWorkflow = wrapWorkflow('#switchingTemplates', 'uwpc-workflow-forms', 'View UWPC forms', 'Browse PC1 and the form library');

    const development = document.createElement('details');
    development.className = 'uwpc-future-tools';
    development.innerHTML = '<summary><span>Other UWPC tools</span><small>Grouped for future development</small></summary><div class="uwpc-future-tools-body"></div>';
    const body = development.querySelector('.uwpc-future-tools-body');
    ['#oneLineEditor', '#engineeringSitemap', '#wpReadinessGuide', '#switchingGrid'].forEach(selector => {
      const module = workspace.querySelector(selector);
      if (module) body.append(module);
    });
    const notice = workspace.querySelector('.switching-notice');
    if (notice) notice.after(desk);
    else banner.after(desk);
    formsWorkflow?.after(development);
    if (!development.isConnected) workspace.append(development);

    document.addEventListener('click', event => {
      const trigger = event.target.closest('[data-open-module], [data-module-tab]');
      const moduleId = trigger?.dataset.openModule || trigger?.dataset.moduleTab;
      if (!moduleId) return;
      document.querySelector(`[data-ns-module="${CSS.escape(moduleId)}"]`)
        ?.closest('details.uwpc-future-tools, details.uwpc-workflow-group')?.setAttribute('open', '');
    }, true);
  }

  function renderEngineeringHub() {
    const diagrams = (selectedFiles.length || state.diagrams.length) + (state.schematicId ? 1 : 0);
    const sources = selectedRuleFiles.length || state.ruleSources.length;
    const sourceStatus = document.querySelector('#engineeringSourceStatus');
    const draftStatus = document.querySelector('#engineeringDraftStatus');
    const reviewStatus = document.querySelector('#engineeringReviewStatus');
    const formsSummary = document.querySelector('#uwpcFormsSummary');
    if (sourceStatus) sourceStatus.textContent = `${diagrams} diagram${diagrams === 1 ? '' : 's'} · ${sources} procedure source${sources === 1 ? '' : 's'}`;
    if (draftStatus) draftStatus.textContent = state.packageName ? `${state.packageName} · ${state.status}` : 'Draft not started';
    if (reviewStatus) reviewStatus.textContent = state.status === 'REVIEW RECORDED · NOT RELEASE' ? 'Review recorded · not release' : state.status === 'READY FOR QUALIFIED REVIEW' ? 'Ready for qualified review' : 'Not ready for review';
    if (formsSummary) formsSummary.textContent = `${uwpcTemplates().length || 15} UWPC draft forms`;
  }

  const $ = id => document.getElementById(id);
  const read = () => {
    try {
      const saved = JSON.parse(localStorage.getItem(KEY) || 'null');
      if (saved && saved.schema === 1) {
        Object.assign(state, saved);
        selectedFiles = Array.isArray(state.diagrams) ? state.diagrams.map(file => ({ ...file })) : [];
        selectedRuleFiles = Array.isArray(state.ruleSources) ? state.ruleSources.map(file => ({ ...file })) : [];
      }
    } catch { /* local storage is optional */ }
  };
  const write = (markUnsynced = true) => {
    if (markUnsynced && state.id && state.storage === 'SERVER') state.storage = 'UNSYNCED';
    state.savedAt = new Date().toISOString();
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* private mode or quota */ }
    renderControl();
  };
  const fileSize = bytes => bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  const displayTime = value => {
    if (!value) return 'NOT SAVED';
    return window.NorthstarIesoTime
      ? NorthstarIesoTime.dateTime(value)
      : new Date(value).toLocaleString([], { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: 'America/Toronto' });
  };
  const setNote = (message, tone = '') => { const node = $('wpReviewNote'); if (!node) return; node.textContent = message; node.className = `switching-review-note ${tone}`; };

  async function serverRequest(path, method = 'GET', payload) {
    const options = { method, headers: { Accept: 'application/json' } };
    if (payload !== undefined) {
      options.headers['Content-Type'] = 'application/json';
      options.body = JSON.stringify(payload);
    }
    const response = await fetch(path, options);
    let result = null;
    try { result = await response.json(); } catch { /* server may return an empty response */ }
    if (!response.ok) throw new Error(result?.error || `server returned ${response.status}`);
    return result;
  }

  function serverPayload() {
    return {
      packageName: state.packageName,
      site: state.site,
      siteId: state.siteId,
      asset: state.asset,
      outageId: state.outageId,
      schematicId: state.schematicId,
      schematicRevision: state.schematicRevision,
      symbolProfileApprovalRef: state.symbolProfileApprovalRef,
      canonicalAssetId: state.canonicalAssetId,
      topologySnapshotId: state.topologySnapshotId,
      topologyRevision: state.topologyRevision,
      revision: state.revision,
      ruleSet: state.ruleSet,
      authorityProcedureId: state.authorityProcedureId,
      authorityProcedureRevision: state.authorityProcedureRevision,
      workProtectionId: state.workProtectionId,
      workProtectionName: state.workProtectionName,
      workProtectionSection: state.workProtectionSection,
      workProtectionTemplateId: state.workProtectionTemplateId,
      templateFields: state.templateFields,
      qualificationEvidenceRef: state.qualificationEvidenceRef,
      sourceManifestDigest: state.sourceManifestDigest,
      scope: state.scope,
      diagrams: state.diagrams,
      ruleSources: state.ruleSources,
      isolation: state.isolation,
      sequence: state.sequence,
      verification: state.verification,
      permission: state.permission,
      restoration: state.restoration,
      reviewerName: state.reviewerName,
      reviewerRole: state.reviewerRole,
      reviewComments: state.reviewComments,
      checks: state.checks,
      version: state.id && state.version > 0 ? state.version : undefined
    };
  }

  function applyServerRecord(record) {
    if (!record) return;
    state.id = record.id || state.id;
    if (Number.isFinite(Number(record.version))) state.version = Number(record.version);
    state.status = record.status || state.status;
    state.serverUpdatedAt = record.updatedAt || state.serverUpdatedAt;
    state.savedAt = state.serverUpdatedAt || state.savedAt;
    state.storage = 'SERVER';
    ['packageName', 'site', 'siteId', 'asset', 'outageId', 'schematicId', 'symbolProfileApprovalRef', 'canonicalAssetId', 'topologySnapshotId', 'topologyRevision', 'revision', 'ruleSet', 'authorityProcedureId', 'authorityProcedureRevision', 'workProtectionId', 'workProtectionName', 'workProtectionSection', 'workProtectionTemplateId', 'qualificationEvidenceRef', 'sourceManifestDigest', 'scope', 'reviewerName', 'reviewerRole', 'reviewComments'].forEach(key => {
      if (typeof record[key] === 'string') state[key] = record[key];
    });
    state.schematicRevision = Number(record.schematicRevision) || 0;
    ['diagrams', 'ruleSources', 'isolation', 'sequence', 'verification', 'permission', 'restoration'].forEach(key => {
      if (Array.isArray(record[key])) state[key] = record[key];
    });
    if (record.templateFields && typeof record.templateFields === 'object') state.templateFields = record.templateFields;
    if (record.checks && typeof record.checks === 'object') state.checks = record.checks;
    if (Array.isArray(record.audit)) {
      state.audit = record.audit.map(entry => ({
        at: entry.at,
        message: `${entry.event || 'record event'}${entry.details ? ` - ${entry.details}` : ''}`
      }));
    }
    selectedFiles = state.diagrams.map(file => ({ ...file }));
    selectedRuleFiles = state.ruleSources.map(file => ({ ...file }));
  }

  async function persistServer() {
    syncDiagramRecords(); syncRuleRecords();
    await refreshSourceManifestDigest();
    const pending = [
      ...selectedFiles.filter(file => file.file && !file.attachmentId).map(file => ({ kind:'diagram', file:file.file, url:file.url })),
      ...selectedRuleFiles.filter(file => file.file && !file.attachmentId).map(file => ({ kind:'source', file:file.file, url:file.url }))
    ];
    const path = state.id ? `/api/switching/drafts/${encodeURIComponent(state.id)}` : '/api/switching/drafts';
    let record = await serverRequest(path, 'POST', serverPayload());
    applyServerRecord(record);
    for (let index = 0; index < pending.length; index += 1) {
      const upload = pending[index];
      try {
        const response = await fetch(`/api/switching/drafts/${encodeURIComponent(state.id)}/attachments?kind=${upload.kind}`, {
          method:'POST',
          headers:{ 'Content-Type':upload.file.type || 'application/octet-stream', 'X-Northstar-Filename':encodeURIComponent(upload.file.name) },
          body:upload.file
        });
        let uploaded = null;
        try { uploaded = await response.json(); } catch { /* response error handled below */ }
        if (!response.ok) throw new Error(uploaded?.error || `${upload.file.name} upload returned ${response.status}`);
        record = uploaded;
        applyServerRecord(record);
        if (upload.url) URL.revokeObjectURL(upload.url);
      } catch (error) {
        pending.slice(index).forEach(item => {
          const target = item.kind === 'diagram' ? selectedFiles : selectedRuleFiles;
          target.push({ name:item.file.name, size:item.file.size, type:item.file.type, lastModified:item.file.lastModified, url:item.url || URL.createObjectURL(item.file), file:item.file });
        });
        syncDiagramRecords(); syncRuleRecords(); renderFields();
        throw error;
      }
    }
    write(false);
    renderFields();
    await loadDraftLibrary();
    return record;
  }

  function collectFields() {
    state.packageName = $('wpPackageName').value.trim();
    const picked = window.NorthStarSites
      ? NorthStarSites.selected($('wpSite'))
      : { site: $('wpSite').value.trim(), siteId: $('wpSite').selectedOptions[0]?.dataset.siteId || '' };
    state.site = picked.site;
    state.siteId = picked.siteId || (window.NorthStarSites && NorthStarSites.resolve(picked.site)?.id) || '';
    state.asset = $('wpAsset').value.trim();
    state.outageId = $('wpOutageId').value;
    state.schematicId = $('wpSchematicId').value;
    state.schematicRevision = Number($('wpSchematicId').selectedOptions[0]?.dataset.revision) || 0;
    state.symbolProfileApprovalRef = $('wpSymbolProfileApprovalRef').value.trim();
    state.canonicalAssetId = $('wpCanonicalAssetId').value.trim();
    state.topologySnapshotId = $('wpTopologySnapshotId').value.trim();
    state.topologyRevision = $('wpTopologyRevision').value.trim();
    state.revision = $('wpDiagramRevision').value.trim();
    state.ruleSet = $('wpRuleSet').value.trim();
    state.workProtectionId = $('wpWorkProtection')?.value.trim() || '';
    const selectedInstrument = $('wpWorkProtection')?.selectedOptions?.[0];
    state.workProtectionName = selectedInstrument && state.workProtectionId ? selectedInstrument.textContent.split(' · ')[0] : '';
    state.workProtectionSection = selectedInstrument && selectedInstrument.textContent.includes(' · ') ? selectedInstrument.textContent.split(' · ').pop() : '';
    state.workProtectionTemplateId = $('wpTemplate')?.value.trim() || state.workProtectionTemplateId || '';
    const fields = {};
    document.querySelectorAll('[data-template-field]').forEach(input => {
      fields[input.dataset.templateField] = input.value.trim();
    });
    if (Object.keys(fields).length) state.templateFields = fields;
    state.authorityProcedureId = $('wpAuthorityProcedureId').value.trim();
    state.authorityProcedureRevision = $('wpAuthorityProcedureRevision').value.trim();
    if (state.ruleSet === 'UWPC 2024') {
      if (!state.authorityProcedureId) state.authorityProcedureId = 'uwpc-2024';
      if (!state.authorityProcedureRevision) state.authorityProcedureRevision = '2024';
    }
    state.qualificationEvidenceRef = $('wpQualificationEvidenceRef').value.trim();
    state.scope = $('wpWorkScope').value.trim();
    state.reviewerName = $('wpReviewerName').value.trim();
    state.reviewerRole = $('wpReviewerRole').value.trim();
    state.reviewComments = $('wpReviewComments').value.trim();
  }

  function syncDiagramRecords() {
    state.diagrams = selectedFiles.map(file => ({ attachmentId:file.attachmentId || '', name: file.name, size: file.size, type: file.type, lastModified: file.lastModified, sha256:file.sha256 || '', storage:file.attachmentId ? 'SERVER' : 'LOCAL' }));
  }

  function syncRuleRecords() {
    state.ruleSources = selectedRuleFiles.map(file => ({ attachmentId:file.attachmentId || '', name: file.name, size: file.size, type: file.type, lastModified: file.lastModified, sha256:file.sha256 || '', storage:file.attachmentId ? 'SERVER' : 'LOCAL' }));
  }

  async function refreshSourceManifestDigest() {
    const manifest = JSON.stringify({
      diagrams: [...state.diagrams].sort((a, b) => `${a.name}:${a.lastModified}`.localeCompare(`${b.name}:${b.lastModified}`)),
      ruleSources: [...state.ruleSources].sort((a, b) => `${a.name}:${a.lastModified}`.localeCompare(`${b.name}:${b.lastModified}`)),
      schematicId: state.schematicId,
      schematicRevision: state.schematicRevision
    });
    if (!window.crypto?.subtle || !window.TextEncoder) { state.sourceManifestDigest = ''; return; }
    const bytes = await window.crypto.subtle.digest('SHA-256', new TextEncoder().encode(manifest));
    state.sourceManifestDigest = [...new Uint8Array(bytes)].map(byte => byte.toString(16).padStart(2, '0')).join('');
  }

  function addAudit(message) {
    state.audit.unshift({ at: new Date().toISOString(), message });
    state.audit = state.audit.slice(0, 30);
  }

  function renderSourceSelectors() {
    const outageSelect = $('wpOutageId');
    const schematicSelect = $('wpSchematicId');
    if (outageSelect) {
      outageSelect.innerHTML = '<option value="">No linked outage</option>';
      outageRecords.forEach(outage => {
        const option = document.createElement('option');
        option.value = outage.id;
        option.textContent = `${outage.status === 'Open' ? 'OPEN' : outage.status} · ${outage.site || 'Unknown site'} · ${outage.asset || outage.title}`;
        outageSelect.append(option);
      });
      outageSelect.value = state.outageId;
    }
    if (schematicSelect) {
      schematicSelect.innerHTML = '<option value="">No server schematic</option>';
      schematicRecords.forEach(schematic => {
        const option = document.createElement('option');
        option.value = schematic.id;
        option.dataset.revision = schematic.revision;
        option.textContent = `${schematic.name} · REV ${schematic.revision} · ${schematic.symbolCount} symbols`;
        schematicSelect.append(option);
      });
      schematicSelect.value = state.schematicId;
    }
  }

  async function loadReferenceData() {
    try {
      const [outages, schematics] = await Promise.all([
        serverRequest('/api/outages'),
        serverRequest('/api/schematics')
      ]);
      outageRecords = Array.isArray(outages) ? outages : [];
      schematicRecords = Array.isArray(schematics) ? schematics : [];
      renderSourceSelectors();
    } catch (error) {
      setNote(`Reference records unavailable: ${error.message}.`, 'warn');
    }
  }

  async function loadDraftRecord(draftId) {
    try {
      const record = await serverRequest(`/api/switching/drafts/${encodeURIComponent(draftId)}`);
      applyServerRecord(record); write(false); renderFields();
      document.querySelector('#switchingTemplates')?.closest('details.uwpc-workflow-group')?.setAttribute('open', '');
      window.NorthstarModules?.open('outages:switching-templates');
      setNote(`Server draft ${record.id} loaded. Stored sources are available on any signed-in operator browser.`);
    } catch (error) {
      setNote(`Draft could not be loaded: ${error.message}.`, 'error');
    }
  }

  async function loadDraftLibrary() {
    const list = $('wpLibraryList');
    if (!list) return;
    list.innerHTML = '<div class="switching-empty">Loading PC1 request records…</div>';
    const params = new URLSearchParams();
    const query = $('wpLibrarySearch')?.value.trim();
    const status = $('wpLibraryStatus')?.value;
    if (query) params.set('q', query);
    if (status) params.set('status', status);
    try {
      const records = await serverRequest('/api/switching/drafts' + (params.size ? `?${params}` : ''));
      const requests = (Array.isArray(records) ? records : []).filter(record => (
        record.workProtectionTemplateId === 'pc1' || /^PC1\b/i.test(record.packageName || '')
      ));
      list.replaceChildren();
      if (!requests.length) { list.innerHTML = '<div class="switching-empty">No saved PC1 requests match this filter. Create a request to start a record.</div>'; return; }
      requests.forEach(record => {
        const row = document.createElement('div'); row.className = 'switching-library-row';
        const name = document.createElement('strong'); name.textContent = record.packageName || record.id;
        const asset = document.createElement('span'); asset.textContent = `${record.site || '—'} · ${record.asset || '—'}`;
        const stateLabel = document.createElement('small'); stateLabel.textContent = `${record.status} · ${displayTime(record.updatedAt)}`;
        const open = document.createElement('button'); open.type = 'button'; open.textContent = 'OPEN'; open.onclick = () => loadDraftRecord(record.id);
        row.append(name, asset, stateLabel, open); list.append(row);
      });
    } catch (error) {
      list.innerHTML = `<div class="switching-empty">PC1 request records unavailable: ${String(error.message || error).replace(/[<>&]/g, '')}</div>`;
    }
  }

  function prefillOutage(outageOrId) {
    const outage = typeof outageOrId === 'string' ? outageRecords.find(item => item.id === outageOrId) : outageOrId;
    if (!outage) return false;
    state.outageId = outage.id;
    state.site = outage.site || state.site;
    state.siteId = outage.siteId || (window.NorthStarSites && NorthStarSites.resolve(state.site)?.id) || state.siteId || '';
    state.asset = outage.asset || outage.title || state.asset;
    if (!state.packageName) state.packageName = `${state.asset || 'Asset'} outage switching review`;
    if (!state.scope) state.scope = `Prepare a controlled switching review package for outage ${outage.id}: ${outage.title || state.asset}.`;
    write(); renderFields();
    document.querySelector("[data-module-id='switching-intake']")?.scrollIntoView({ behavior:'smooth', block:'start' });
    return true;
  }

  async function attachSchematic(schematic) {
    if (!schematic?.id) throw new Error('Save the schematic to the server first.');
    if (state.status === 'REVIEW RECORDED · NOT RELEASE') throw new Error('Reviewed packages are immutable; start a new revision.');
    if (!schematicRecords.some(item => item.id === schematic.id)) schematicRecords.unshift(schematic);
    state.schematicId = schematic.id;
    state.schematicRevision = Number(schematic.revision) || 0;
    state.symbolProfileApprovalRef = schematic.standardApprovalRef || state.symbolProfileApprovalRef;
    if (schematic.outageId && !state.outageId) state.outageId = schematic.outageId;
    await refreshSourceManifestDigest();
    renderSourceSelectors(); renderFields(); write();
    if (state.id) await saveDraft('Server schematic attached.');
    else setNote('Server schematic selected. Create the switching package to retain the link.');
    return true;
  }

  window.NorthStarSwitching = {
    loadDraft: loadDraftRecord,
    attachSchematic,
    prefillOutage,
    currentDraft: () => ({ id:state.id, status:state.status, schematicId:state.schematicId })
  };

  function renderFiles() {
    const list = $('wpFileList');
    list.replaceChildren();
    const records = selectedFiles.length ? selectedFiles : state.diagrams;
    if (!records.length) { list.innerHTML = '<div class="switching-empty">No source diagrams attached.</div>'; return; }
    records.forEach((file, index) => {
      const row = document.createElement('div'); row.className = 'switching-file';
      const name = document.createElement('strong'); name.textContent = file.name;
      const meta = document.createElement('small'); meta.textContent = `${file.type || 'file'} · ${fileSize(file.size || 0)} · ${file.attachmentId ? 'SERVER' : file.file ? 'PENDING UPLOAD' : 'LOCAL METADATA ONLY'}`;
      row.append(name, meta);
      if (file.url || file.attachmentId) { const open = document.createElement('a'); open.href = file.url || `/api/switching/drafts/${encodeURIComponent(state.id)}/attachments/${encodeURIComponent(file.attachmentId)}`; open.target = '_blank'; open.rel = 'noopener'; open.textContent = 'OPEN'; row.append(open); }
      const remove = document.createElement('button'); remove.type = 'button'; remove.textContent = 'REMOVE'; remove.title = 'Remove source file';
      remove.addEventListener('click', async () => {
        if (file.attachmentId && state.id) {
          try {
            const record = await serverRequest(`/api/switching/drafts/${encodeURIComponent(state.id)}/attachments/${encodeURIComponent(file.attachmentId)}`, 'DELETE');
            applyServerRecord(record); write(false); renderFields(); await loadDraftLibrary(); return;
          } catch (error) { setNote(`Stored source could not be removed: ${error.message}.`, 'error'); return; }
        }
        const removed = selectedFiles.splice(index, 1)[0];
        if (removed?.url) URL.revokeObjectURL(removed.url);
        syncDiagramRecords();
        renderFiles(); renderControl(); write();
      });
      row.append(remove); list.append(row);
    });
    $('wpFileCount').textContent = String(records.length);
  }

  function renderRuleFiles() {
    const list = $('wpRuleFileList');
    list.replaceChildren();
    const records = selectedRuleFiles.length ? selectedRuleFiles : state.ruleSources;
    if (!records.length) { list.innerHTML = '<div class="switching-empty">No governing sources attached.</div>'; return; }
    records.forEach((file, index) => {
      const row = document.createElement('div'); row.className = 'switching-file';
      const name = document.createElement('strong'); name.textContent = file.name;
      const meta = document.createElement('small'); meta.textContent = `${file.type || 'file'} · ${fileSize(file.size || 0)} · ${file.attachmentId ? 'SERVER' : file.file ? 'PENDING UPLOAD' : 'LOCAL METADATA ONLY'}`;
      row.append(name, meta);
      if (file.url || file.attachmentId) { const open = document.createElement('a'); open.href = file.url || `/api/switching/drafts/${encodeURIComponent(state.id)}/attachments/${encodeURIComponent(file.attachmentId)}`; open.target = '_blank'; open.rel = 'noopener'; open.textContent = 'OPEN'; row.append(open); }
      const remove = document.createElement('button'); remove.type = 'button'; remove.textContent = 'REMOVE'; remove.title = 'Remove governing source';
      remove.addEventListener('click', async () => {
        if (file.attachmentId && state.id) {
          try {
            const record = await serverRequest(`/api/switching/drafts/${encodeURIComponent(state.id)}/attachments/${encodeURIComponent(file.attachmentId)}`, 'DELETE');
            applyServerRecord(record); write(false); renderFields(); await loadDraftLibrary(); return;
          } catch (error) { setNote(`Stored source could not be removed: ${error.message}.`, 'error'); return; }
        }
        const removed = selectedRuleFiles.splice(index, 1)[0];
        if (removed?.url) URL.revokeObjectURL(removed.url);
        syncRuleRecords();
        renderRuleFiles(); renderControl(); write();
      });
      row.append(remove); list.append(row);
    });
    $('wpRuleFileCount').textContent = String(records.length);
  }

  const rowConfig = {
    isolation: ['Device / point ID', 'Required isolation or condition'],
    sequence: ['Step reference', 'Source-derived step / checkback'],
    verification: ['Verification item', 'Evidence / responsible role'],
    permission: ['Permission / boundary item', 'Evidence / controlling role'],
    restoration: ['Closeout item', 'Evidence / responsible role']
  };

  function renderRows(kind) {
    const list = $(`wp${kind[0].toUpperCase()}${kind.slice(1)}Rows`);
    list.replaceChildren();
    const rows = state[kind];
    if (!rows.length) { list.innerHTML = '<div class="switching-empty">No review items entered.</div>'; return; }
    rows.forEach((item, index) => {
      const row = document.createElement('div'); row.className = 'switching-row';
      const number = document.createElement('span'); number.className = 'switching-row-number'; number.textContent = `${index + 1}.`;
      const first = document.createElement('input'); first.placeholder = rowConfig[kind][0]; first.value = item.first || '';
      const second = document.createElement('textarea'); second.rows = 1; second.placeholder = rowConfig[kind][1]; second.value = item.second || '';
      const remove = document.createElement('button'); remove.type = 'button'; remove.textContent = '×'; remove.title = 'Remove review row';
      first.addEventListener('input', () => { item.first = first.value; write(); });
      second.addEventListener('input', () => { item.second = second.value; write(); });
      remove.addEventListener('click', () => { state[kind].splice(index, 1); renderRows(kind); write(); });
      row.append(number, first, second, remove); list.append(row);
    });
  }

  function renderFields() {
    $('wpPackageName').value = state.packageName;
    const siteSelect = $('wpSite');
    if (siteSelect) {
      if (state.site && ![...siteSelect.options].some(option => option.value === state.site)) {
        siteSelect.add(new Option(state.site, state.site));
      }
      siteSelect.value = state.site;
      if (state.siteId && siteSelect.selectedOptions[0] && !siteSelect.selectedOptions[0].dataset.siteId) {
        siteSelect.selectedOptions[0].dataset.siteId = state.siteId;
      }
    }
    $('wpAsset').value = state.asset;
    renderSourceSelectors();
    $('wpOutageId').value = state.outageId;
    $('wpSchematicId').value = state.schematicId;
    $('wpSymbolProfileApprovalRef').value = state.symbolProfileApprovalRef;
    $('wpCanonicalAssetId').value = state.canonicalAssetId;
    $('wpTopologySnapshotId').value = state.topologySnapshotId;
    $('wpTopologyRevision').value = state.topologyRevision;
    $('wpDiagramRevision').value = state.revision;
    const ruleSet = $('wpRuleSet');
    if (ruleSet) {
      if (state.ruleSet && ![...ruleSet.options].some(option => option.value === state.ruleSet)) {
        ruleSet.add(new Option(state.ruleSet, state.ruleSet));
      }
      ruleSet.value = state.ruleSet || 'UWPC 2024';
    }
    if ($('wpWorkProtection')) $('wpWorkProtection').value = state.workProtectionId;
    renderTemplateOptions();
    if ($('wpTemplate')) $('wpTemplate').value = state.workProtectionTemplateId;
    renderTemplates();
    $('wpAuthorityProcedureId').value = state.authorityProcedureId;
    $('wpAuthorityProcedureRevision').value = state.authorityProcedureRevision;
    $('wpQualificationEvidenceRef').value = state.qualificationEvidenceRef;
    $('wpWorkScope').value = state.scope;
    $('wpReviewerName').value = state.reviewerName;
    $('wpReviewerRole').value = state.reviewerRole;
    $('wpReviewComments').value = state.reviewComments;
    document.querySelectorAll('[data-approval-check]').forEach(check => { check.checked = Boolean(state.checks[check.dataset.approvalCheck]); });
    renderRows('isolation'); renderRows('sequence'); renderRows('verification'); renderRows('permission'); renderRows('restoration'); renderFiles(); renderRuleFiles();
    $('wpFormTitle').textContent = state.packageName || 'No draft package created';
    $('wpStatePill').textContent = state.status;
    $('wpControlStatus').textContent = state.status;
    $('wpReviewPill').textContent = state.status === 'REVIEW RECORDED · NOT RELEASE' ? 'RECORDED' : state.status === 'READY FOR QUALIFIED REVIEW' ? 'READY' : 'NOT READY';
    $('wpReviewPill').className = `switching-state-pill ${state.status === 'REVIEW RECORDED · NOT RELEASE' ? 'reviewed' : state.status === 'READY FOR QUALIFIED REVIEW' ? 'ready' : ''}`;
    const instrumentNote = state.workProtectionName ? ` · ${state.workProtectionName} (${state.workProtectionSection || 'UWPC'})` : '';
    $('wpFormStatus').textContent = state.packageName ? `${state.diagrams.length} uploaded diagram(s) · ${state.schematicId ? `server schematic rev ${state.schematicRevision} · ` : ''}${state.ruleSources.length} supporting/source file(s)${instrumentNote} · source-derived fields remain subject to qualified review.` : 'Create a draft first, then attach source material as available. Select the applicable instrument before qualified review.';
    const immutable = state.status === 'REVIEW RECORDED · NOT RELEASE';
    document.querySelectorAll("[data-module-id='switching-intake'] input,[data-module-id='switching-intake'] textarea,[data-module-id='switching-intake'] select,[data-module-id='switching-intake'] button,[data-module-id='switching-form'] input,[data-module-id='switching-form'] textarea,[data-module-id='switching-form'] button,[data-module-id='switching-approval'] input,[data-module-id='switching-approval'] textarea,[data-module-id='switching-approval'] button").forEach(control => { control.disabled = immutable; });
    $('wpRecordReview').disabled = state.status !== 'READY FOR QUALIFIED REVIEW';
    $('wpDownloadBundle').disabled = !state.id || state.storage !== 'SERVER';
    $('wpCloneRevision').disabled = !state.id || state.storage !== 'SERVER';
    renderQuickStart();
    renderReadinessGuide();
    renderEngineeringHub();
    renderAudit();
  }

  function renderAudit() {
    const node = $('wpAuditLog'); node.replaceChildren();
    if (!state.audit.length) { node.innerHTML = '<div class="switching-empty">No audit entries yet.</div>'; return; }
    state.audit.forEach(entry => { const row = document.createElement('div'); row.className = 'switching-audit-entry'; const time = document.createElement('time'); time.textContent = displayTime(entry.at); const message = document.createElement('span'); message.textContent = entry.message; row.append(time, message); node.append(row); });
  }

  function renderControl() {
    $('wpFileCount').textContent = String(selectedFiles.length || state.diagrams.length);
    $('wpRuleFileCount').textContent = String(selectedRuleFiles.length || state.ruleSources.length);
    $('wpLastSaved').textContent = displayTime(state.serverUpdatedAt || state.savedAt);
    const storage = $('wpStorageState');
    if (storage) {
      const label = state.storage === 'SERVER' ? 'SERVER RECORD' : state.storage === 'UNSYNCED' ? 'UNSYNCED EDITS' : 'BROWSER LOCAL';
      storage.textContent = label;
      storage.className = `switching-module-state ${state.storage === 'SERVER' ? 'synced' : state.storage === 'UNSYNCED' ? 'unsynced' : ''}`;
    }
    renderReadinessGuide();
    renderEngineeringHub();
    renderAudit();
  }

  function retainLocalDraft(message, error) {
    state.storage = state.id ? 'UNSYNCED' : 'LOCAL';
    addAudit(`${message} ${error ? `- ${error.message}` : ''}`.trim());
    write(false); renderFields();
  }

  async function saveDraft(message = 'Draft saved.') {
    collectFields(); syncDiagramRecords(); syncRuleRecords();
    try {
      const record = await persistServer();
      $('wpIntakeStatus').textContent = `${message} SERVER RECORD ${record.id}.`;
      setNote('Draft saved to the operator record. It remains a draft until a qualified-person review is recorded.');
    } catch (error) {
      retainLocalDraft('Server sync unavailable; local draft retained.', error);
      $('wpIntakeStatus').textContent = `${message} LOCAL ONLY - server sync unavailable.`;
      setNote('Local draft retained, but no operator record was written. Do not use this browser copy as a release record.', 'warn');
    }
  }

  async function createDraft() {
    collectFields();
    if (!state.packageName || !state.site || !state.asset || !state.revision || !state.ruleSet || !state.scope || !(selectedFiles.length || state.diagrams.length || state.schematicId)) {
      $('wpIntakeStatus').textContent = 'PACKAGE, SITE, ASSET, REVISION, RULE SET, SCOPE, AND A SOURCE DIAGRAM ARE REQUIRED.'; return;
    }
    syncDiagramRecords(); syncRuleRecords(); state.status = 'DRAFT';
    try {
      const record = await persistServer();
      $('wpIntakeStatus').textContent = `DRAFT PACKAGE CREATED - SERVER RECORD ${record.id}. ENTER SOURCE-DERIVED REVIEW ITEMS.`;
      setNote('Draft package created on the operator record. No switching sequence was generated automatically.');
    } catch (error) {
      retainLocalDraft('Draft initialized locally; server sync unavailable.', error);
      $('wpIntakeStatus').textContent = 'DRAFT PACKAGE CREATED LOCALLY - SERVER SYNC REQUIRED BEFORE REVIEW.';
      setNote('Draft exists only in this browser until the operator record can be reached.', 'warn');
    }
  }

  async function readyForReview() {
    collectFields();
    const missing = [];
    const incomplete = kind => !state[kind].length || state[kind].some(row => !String(row.first || '').trim() || !String(row.second || '').trim());
    if (!state.packageName) missing.push('package');
    if (!state.site) missing.push('site');
    if (!state.asset) missing.push('asset');
    if (!state.canonicalAssetId) missing.push('canonical asset ID');
    if (!state.topologySnapshotId) missing.push('topology snapshot ID');
    if (!state.topologyRevision) missing.push('topology revision');
    if (!state.revision) missing.push('diagram revision');
    if (!state.ruleSet) missing.push('UWPC 2024 rule set');
    if (!state.authorityProcedureId) missing.push('authority procedure ID');
    if (!state.authorityProcedureRevision) missing.push('authority procedure revision');
    if (state.ruleSet === 'UWPC 2024' && !state.workProtectionId) missing.push('UWPC work-protection instrument');
    if (!state.qualificationEvidenceRef) missing.push('qualification evidence reference');
    if (!state.sourceManifestDigest) missing.push('source manifest digest');
    if (!state.scope) missing.push('scope');
    if (!selectedFiles.some(file => file.attachmentId) && !state.schematicId) missing.push('server-stored source diagram or server schematic');
    if (!selectedRuleFiles.some(file => file.attachmentId) && !(state.ruleSet === 'UWPC 2024' && state.authorityProcedureId === 'uwpc-2024' && window.NorthStarUwpc?.bookAvailable)) missing.push('server-stored governing rule/procedure source or installed UWPC 2024 book');
    if (incomplete('isolation')) missing.push('complete isolation review rows');
    if (incomplete('sequence')) missing.push('complete sequence/checkback rows');
    if (incomplete('verification')) missing.push('complete verification rows');
    if (incomplete('permission')) missing.push('complete permission rows');
    if (incomplete('restoration')) missing.push('complete restoration rows');
    if (missing.length) { setNote(`Cannot mark ready. Missing: ${missing.join(', ')}.`, 'warn'); return; }
    syncDiagramRecords(); syncRuleRecords();
    try {
      if (!state.id || state.storage === 'UNSYNCED') await persistServer();
      const record = await serverRequest(`/api/switching/drafts/${encodeURIComponent(state.id)}/ready`, 'POST', { version: state.version > 0 ? state.version : undefined });
      applyServerRecord(record); write(false); renderFields();
      setNote('READY FOR QUALIFIED REVIEW - verify every item against the current source and field condition.');
    } catch (error) {
      retainLocalDraft('Ready transition was not recorded; draft retained locally.', error);
      setNote(`Cannot mark ready: ${error.message}. No review gate was opened.`, 'error');
    }
  }

  async function recordReview() {
    collectFields();
    const checked = [...document.querySelectorAll('[data-approval-check]')].every(check => check.checked);
    if (state.status !== 'READY FOR QUALIFIED REVIEW') { setNote('Mark the package ready before recording a review.', 'warn'); return; }
    if (state.storage !== 'SERVER' || !state.id) { setNote('Synchronize the current draft and re-mark it ready before recording a review.', 'warn'); return; }
    if (!checked || !state.reviewerName || !state.reviewerRole || !state.reviewComments) { setNote('Complete every approval check, reviewer identity/role, and review comments.', 'error'); return; }
    state.checks = Object.fromEntries([...document.querySelectorAll('[data-approval-check]')].map(check => [check.dataset.approvalCheck, check.checked]));
    try {
      const record = await serverRequest(`/api/switching/drafts/${encodeURIComponent(state.id)}/review`, 'POST', {
        reviewerName: state.reviewerName,
        reviewerRole: state.reviewerRole,
        reviewComments: state.reviewComments,
        checks: state.checks,
        version: state.version > 0 ? state.version : undefined
      });
      applyServerRecord(record); write(false); renderFields();
      setNote('REVIEW RECORDED - NOT RELEASE. Utility release, authenticated sign-off, and final field confirmation are still required.');
    } catch (error) {
      retainLocalDraft('Review was not recorded; local edits retained.', error);
      setNote(`Review not recorded: ${error.message}.`, 'error');
    }
  }

  function downloadControlledBundle() {
    if (!state.id || state.storage !== 'SERVER') {
      setNote('Save the server draft before downloading a controlled bundle.', 'warn');
      return;
    }
    const link = document.createElement('a');
    link.href = `/api/switching/drafts/${encodeURIComponent(state.id)}/bundle`;
    link.download = '';
    document.body.append(link); link.click(); link.remove();
    setNote('Controlled bundle requested. It includes the server package, audit trail, hashes, review evidence, and stored sources; it is not an operational release.');
  }

  async function cloneServerRevision() {
    if (!state.id || state.storage !== 'SERVER') {
      setNote('Save the server draft before starting a server revision.', 'warn');
      return;
    }
    if (!confirm('Create a new server draft revision? Stored sources and work rows will be copied; diagram revision, qualification evidence, reviewer fields, and review checks will be cleared.')) return;
    try {
      const sourceId = state.id;
      const record = await serverRequest(`/api/switching/drafts/${encodeURIComponent(sourceId)}/clone`, 'POST', { version: state.version });
      applyServerRecord(record); write(false); renderFields(); await loadDraftLibrary();
      setNote(`New server revision ${record.id} created from ${sourceId}. Enter the new diagram revision and qualification evidence before review.`);
      $('wpIntakeStatus').textContent = `REVISION DRAFT CREATED - SERVER RECORD ${record.id}.`;
    } catch (error) {
      setNote(`Server revision was not created: ${error.message}.`, 'error');
    }
  }

  function exportLocalRecord() {
    collectFields(); syncDiagramRecords(); syncRuleRecords(); addAudit('Local draft record exported without file contents.'); write(); renderFields();
    const payload = { ...state, exportedAt: new Date().toISOString(), fileContents: 'not included; use the controlled server bundle for stored source bytes and review evidence' };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob); const link = document.createElement('a');
    const slug = (state.packageName || 'switching-draft').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    link.href = url; link.download = `northstar-${slug || 'switching-draft'}.json`; link.click(); URL.revokeObjectURL(url);
  }

  function printPacket() {
    collectFields(); syncDiagramRecords(); syncRuleRecords(); addAudit('Printable review packet opened locally.'); write(); renderFields(); window.print();
  }

  function newDraft() {
    if (!confirm('Start a new local draft? The current local draft will be cleared.')) return;
    resetDraftState();
    renderFields(); setNote('New local draft ready.'); $('wpIntakeStatus').textContent = '';
  }

  async function hydrateServer() {
    if (!state.id) return;
    try {
      const record = await serverRequest(`/api/switching/drafts/${encodeURIComponent(state.id)}`);
      applyServerRecord(record); write(false); renderFields();
      setNote('Operator record loaded. Local source files remain browser-local; only file metadata is synchronized.');
    } catch (error) {
      state.storage = 'UNSYNCED'; renderControl();
      setNote(`Operator record unavailable: ${error.message}. Local copy retained for recovery only.`, 'warn');
    }
  }

  function uwpcTemplates() {
    const records = window.NorthStarUwpc?.templates;
    return Array.isArray(records) ? records : [];
  }

  function currentTemplate() {
    return uwpcTemplates().find(row => row.id === state.workProtectionTemplateId) || null;
  }

  function hasFilledReviewRows() {
    return ['isolation', 'sequence', 'verification', 'permission', 'restoration'].some(kind => (
      (state[kind] || []).some(row => String(row.second || '').trim())
    ));
  }

  function renderTemplateOptions() {
    const select = $('wpTemplate');
    if (!select) return;
    const current = state.workProtectionTemplateId || select.value;
    const kind = $('wpTemplateKind')?.value || '';
    const rows = uwpcTemplates().filter(row => !kind || row.kind === kind);
    select.innerHTML = '<option value="">Select a NorthStar sheet</option>' + rows.map(row => (
      `<option value="${String(row.id).replace(/"/g, '')}">${String(row.form).replace(/[<>&]/g, '')} · ${String(row.title).replace(/[<>&]/g, '')}</option>`
    )).join('');
    if (current && [...select.options].some(option => option.value === current)) select.value = current;
  }

  function renderTemplates() {
    const gallery = $('wpTemplateGallery');
    const sheet = $('wpTemplateSheet');
    const status = $('wpTemplateState');
    const kind = $('wpTemplateKind')?.value || '';
    const rows = uwpcTemplates().filter(row => !kind || row.kind === kind);
    if (gallery) {
      gallery.innerHTML = rows.map(row => (
        `<button type="button" class="uwpc-template-card${row.id === state.workProtectionTemplateId ? ' active' : ''}" data-apply-template="${String(row.id).replace(/"/g, '')}">
          <span>${String(row.form).replace(/[<>&]/g, '')} · ${String(row.article).replace(/[<>&]/g, '')}</span>
          <strong>${String(row.title).replace(/[<>&]/g, '')}</strong>
          <small>${row.standalone ? 'STANDALONE SHEET' : 'COMPANION SHEET'} · ${String(row.kind).replace(/-/g, ' ')}</small>
          <small>${String(row.purpose).replace(/[<>&]/g, '')}</small>
        </button>`
      )).join('') || '<div class="switching-empty">No NorthStar templates in this filter.</div>';
      gallery.querySelectorAll('[data-apply-template]').forEach(button => {
        button.addEventListener('click', () => applyTemplate(button.dataset.applyTemplate));
      });
    }
    const selected = currentTemplate();
    if (status) status.textContent = selected ? `${selected.form} · ${selected.article}` : 'NO SHEET SELECTED';
    const hub = document.querySelector('#engineeringTemplateStatus');
    if (hub) hub.textContent = selected ? `${selected.form} selected` : `${uwpcTemplates().length || 15} NorthStar sheets`;
    if (!sheet) return;
    if (!selected) {
      sheet.innerHTML = '<div class="switching-empty">Select a NorthStar template to open its draft sheet.</div>';
      return;
    }
    const relatedButtons = (selected.related || []).map(id => {
      const other = uwpcTemplates().find(row => row.id === id);
      if (!other) return '';
      return `<button type="button" class="secondary-btn" data-apply-template="${String(other.id).replace(/"/g, '')}">OPEN ${String(other.form).replace(/[<>&]/g, '')} · ${String(other.article).replace(/[<>&]/g, '')}</button>`;
    }).join('');
    const fields = selected.fields || [];
    const reviewPreview = ['isolation', 'sequence', 'verification', 'permission', 'restoration'].map(kind => {
      const rows = selected.reviewRows?.[kind] || [];
      if (!rows.length) return '';
      return `<div class="uwpc-sheet-review"><strong>${kind.toUpperCase()} PROMPTS</strong><ol>${rows.map(row => `<li>${String(row.first || '').replace(/[<>&]/g, '')}</li>`).join('')}</ol></div>`;
    }).join('');
    if (selected.id === 'pc1') {
      const escape = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[character]);
      const companyField = (id, kind = 'text', className = '') => {
        const field = fields.find(item => item.id === id);
        if (!field) return '';
        const value = String(state.templateFields[id] || '');
        const common = `data-template-field="${escape(id)}"`;
        let control;
        if (kind === 'textarea') control = `<textarea ${common} rows="3">${escape(value)}</textarea>`;
        else if (kind === 'request') {
          const choices = ['PC2 Work Permit', 'Supporting Guarantee', 'Hold-off', 'Equipment Outage (Self Administered)', 'Equipment outage only (no Work Protection required)'];
          const selectedChoices = new Set(value.split(/\s*\|\s*/).filter(Boolean));
          control = `<input type="hidden" ${common} value="${escape(value)}"><div class="uwpc-company-request-options">${choices.map(choice => `<label><input type="checkbox" data-template-field-option="${escape(id)}" value="${escape(choice)}"${selectedChoices.has(choice) ? ' checked' : ''}><span>${escape(choice)}</span></label>`).join('')}</div>`;
        } else control = `<input type="${kind}" ${common} value="${escape(value)}" placeholder="${escape(field.hint || '')}">`;
        if (kind === 'request') return `<div class="uwpc-company-field ${className}"><span>${escape(field.label)}</span>${control}</div>`;
        return `<label class="uwpc-company-field ${className}"><span>${escape(field.label)}</span>${control}</label>`;
      };
      sheet.innerHTML = `
        <header class="uwpc-company-form-head"><div><label>FL.On COMPANY FORM LAYOUT · ${escape(selected.formRevision || '')}</label><h3>APPLICATION TO A CONTROLLING AUTHORITY</h3></div><b>PC1</b></header>
        <p class="uwpc-sheet-notice">${escape(selected.notice || '')}</p>
        <p class="muted-note">UWPC 2024 · section ${escape(selected.section)} · article ${escape(selected.article)}</p>
        <div class="uwpc-company-form" aria-label="PC1 company form layout">
          <div class="uwpc-company-row uwpc-company-identifiers">${companyField('serialNumber')}${companyField('station')}</div>
          <div class="uwpc-company-row uwpc-company-request">${companyField('controllingAuthority')}${companyField('requestType', 'request')}<div class="uwpc-company-costs">${companyField('recall')}${companyField('deferralCost')}${companyField('cancellationCosts')}</div></div>
          <div class="uwpc-company-row uwpc-company-dates">${companyField('startDate', 'date')}${companyField('startTime', 'time')}${companyField('endDate', 'date')}${companyField('endTime', 'time')}</div>
          <div class="uwpc-company-row uwpc-company-two-up">${companyField('workProtectionDescription', 'textarea')}${companyField('equipmentOutageDescription', 'textarea')}</div>
          <div class="uwpc-company-sections">${companyField('workDescription', 'textarea')}${companyField('tests', 'textarea')}${companyField('holdOffDescription', 'textarea')}${companyField('relayProtectionInformation', 'textarea')}</div>
          <div class="uwpc-company-row uwpc-company-applicant">${companyField('applicantName')}${companyField('applicantWorkGroup')}${companyField('applicantTelephone')}</div>
        <div class="uwpc-company-row uwpc-company-received">${companyField('receivedBy')}${companyField('receivedDate', 'date')}${companyField('receivedTime', 'time')}</div>
        <div class="uwpc-company-sections">${companyField('notes', 'textarea')}</div>
        </div>
        <div class="uwpc-company-attachments"><strong>RECEIVED / SUPPORTING DOCUMENTS</strong><div id="uwpcCompanyAttachments"></div></div>
        ${relatedButtons ? `<div class="uwpc-sheet-related"><span>Related UWPC forms</span>${relatedButtons}</div>` : ''}
        <div class="switching-actions"><button class="secondary-btn" type="button" id="wpPrintTemplate">PRINT THIS SHEET</button></div>`;
      const attachments = selectedRuleFiles.length ? selectedRuleFiles : state.ruleSources;
      const attachmentList = sheet.querySelector('#uwpcCompanyAttachments');
      if (!attachments.length) attachmentList.textContent = 'No supporting documents attached.';
      else attachments.forEach(file => {
        const row = document.createElement('div');
        row.className = 'uwpc-company-attachment';
        const name = document.createElement('span');
        name.textContent = file.name || 'Supporting document';
        row.append(name);
        const href = file.url || (file.attachmentId && state.id ? `/api/switching/drafts/${encodeURIComponent(state.id)}/attachments/${encodeURIComponent(file.attachmentId)}` : '');
        if (href) {
          const open = document.createElement('a');
          open.href = href; open.target = '_blank'; open.rel = 'noopener'; open.textContent = 'OPEN';
          row.append(open);
        } else {
          const stateLabel = document.createElement('small'); stateLabel.textContent = 'LOCAL ONLY'; row.append(stateLabel);
        }
        attachmentList.append(row);
      });
    } else sheet.innerHTML = `
      <header class="uwpc-sheet-head">
        <div><label>${selected.standalone ? 'STANDALONE NORTHSTAR SHEET' : 'COMPANION NORTHSTAR SHEET'}</label><h3>${String(selected.title).replace(/[<>&]/g, '')}</h3></div>
        <b>${String(selected.form).replace(/[<>&]/g, '')}</b>
      </header>
      <p class="uwpc-sheet-notice">${String(selected.notice || '').replace(/[<>&]/g, '')}</p>
      <p class="muted-note">Cites UWPC 2024 section ${String(selected.section).replace(/[<>&]/g, '')} · ${String(selected.article).replace(/[<>&]/g, '')}. Roles: ${selected.roles.map(role => String(role).replace(/[<>&]/g, '')).join(', ')}.</p>
      ${relatedButtons ? `<div class="uwpc-sheet-related"><span>Related NorthStar sheets</span>${relatedButtons}</div>` : ''}
      <div class="uwpc-sheet-fields">${fields.map(field => (
        `<label>${String(field.label).replace(/[<>&]/g, '')}${field.hint ? `<small>${String(field.hint).replace(/[<>&]/g, '')}</small>` : ''}<input data-template-field="${String(field.id).replace(/"/g, '')}" value="${String(state.templateFields[field.id] || '').replace(/"/g, '&quot;')}" placeholder="${String(field.hint || 'Enter from the approved source').replace(/"/g, '&quot;')}"></label>`
      )).join('')}</div>
      <div class="uwpc-sheet-reviews">${reviewPreview}</div>
      <div class="switching-actions"><button class="secondary-btn" type="button" id="wpSeedTemplateRows">SEED REVIEW PROMPTS</button><button class="secondary-btn" type="button" id="wpPrintTemplate">PRINT THIS SHEET</button></div>`;
    sheet.querySelectorAll('[data-template-field]').forEach(input => input.addEventListener('input', () => {
      state.templateFields[input.dataset.templateField] = input.value;
      write();
    }));
    sheet.querySelectorAll('[data-template-field-option]').forEach(input => input.addEventListener('change', () => {
      const fieldId = input.dataset.templateFieldOption;
      const values = [...sheet.querySelectorAll(`[data-template-field-option="${CSS.escape(fieldId)}"]:checked`)].map(option => option.value);
      const stored = sheet.querySelector(`[data-template-field="${CSS.escape(fieldId)}"]`);
      if (stored) { stored.value = values.join(' | '); stored.dispatchEvent(new Event('input', { bubbles: true })); }
    }));
    sheet.querySelectorAll('[data-apply-template]').forEach(button => {
      button.addEventListener('click', () => applyTemplate(button.dataset.applyTemplate));
    });
    $('wpSeedTemplateRows')?.addEventListener('click', () => applyTemplate(selected.id, { seedRows: true, force: true }));
    $('wpPrintTemplate')?.addEventListener('click', printPacket);
  }

  function quickTemplateHint() {
    const hint = $('wpQuickTemplateHint');
    const selected = uwpcTemplates().find(row => row.id === $('wpQuickTemplate')?.value);
    if (!hint) return;
    const related = (selected?.related || [])
      .map(id => uwpcTemplates().find(row => row.id === id)?.form)
      .filter(Boolean);
    hint.textContent = selected
      ? `${selected.form} · ${selected.title}. This opens a NorthStar draft sheet; it does not issue a permit or operating order.${selected.id === 'pc1' ? ' The PC1 page follows the supplied company form layout.' : ''}${selected.standalone ? '' : ' Select the applicable UWPC work-protection instrument before qualified review.'}${related.length ? ` Related draft sheets: ${related.join(', ')}.` : ''}`
      : 'Select a NorthStar sheet to begin.';
  }

  function readinessItems() {
    const incomplete = kind => !state[kind].length || state[kind].some(row => !String(row.first || '').trim() || !String(row.second || '').trim());
    const template = uwpcTemplates().find(row => row.id === state.workProtectionTemplateId);
    const contextMissing = [];
    if (!template) contextMissing.push('NorthStar sheet');
    if (!state.site) contextMissing.push('station / site');
    if (!state.asset) contextMissing.push('circuit / asset');
    if (!state.scope) contextMissing.push('brief purpose');

    const sourceMissing = [];
    const hasSource = selectedFiles.some(file => file.attachmentId) || state.diagrams.some(file => file.attachmentId) || Boolean(state.schematicId);
    if (!hasSource) sourceMissing.push('server-stored diagram or schematic');
    if (!state.canonicalAssetId) sourceMissing.push('canonical asset ID');
    if (!state.topologySnapshotId) sourceMissing.push('topology snapshot');
    if (!state.topologyRevision) sourceMissing.push('topology revision');
    if (!state.revision) sourceMissing.push('diagram revision');
    if (!state.sourceManifestDigest) sourceMissing.push('source manifest');

    const authorityMissing = [];
    const hasInstalledUwpcBook = state.ruleSet === 'UWPC 2024' && state.authorityProcedureId === 'uwpc-2024' && Boolean(window.NorthStarUwpc?.bookAvailable);
    const hasRuleSource = selectedRuleFiles.some(file => file.attachmentId) || state.ruleSources.some(file => file.attachmentId);
    if (!state.ruleSet) authorityMissing.push('rule set');
    if (!state.authorityProcedureId || !state.authorityProcedureRevision) authorityMissing.push('authority procedure');
    if (!hasRuleSource && !hasInstalledUwpcBook) authorityMissing.push('governing procedure source');
    if (state.ruleSet === 'UWPC 2024' && !state.workProtectionId) authorityMissing.push('UWPC work-protection instrument');

    const promptMissing = [
      ['isolation', 'isolation'],
      ['sequence', 'sequence / checkback'],
      ['verification', 'verification'],
      ['permission', 'permission'],
      ['restoration', 'restoration']
    ].filter(([kind]) => incomplete(kind)).map(([, label]) => label);

    return [
      { label: 'Draft context', ready: !contextMissing.length, detail: contextMissing.length ? `Add ${contextMissing.join(', ')}.` : `${template.form} · ${state.site} · ${state.asset}.`, target: 'draft form' },
      { label: 'Source identity', ready: !sourceMissing.length, detail: sourceMissing.length ? `Add ${sourceMissing.join(', ')}.` : 'Source package and traceable identity are recorded.', target: 'source package' },
      { label: 'UWPC authority', ready: !authorityMissing.length, detail: authorityMissing.length ? `Add ${authorityMissing.join(', ')}.` : 'Governing source and work-protection instrument are recorded.', target: 'source package' },
      { label: 'Source-derived review', ready: !promptMissing.length, detail: promptMissing.length ? `Complete ${promptMissing.join(', ')} review prompts from approved source.` : 'All five review areas have complete draft entries.', target: 'draft form' }
    ];
  }

  function renderReadinessGuide() {
    const list = $('wpReadinessList');
    const statePill = $('wpReadinessState');
    const lead = $('wpReadinessLead');
    if (!list || !statePill || !lead) return;
    const items = readinessItems();
    const complete = items.filter(item => item.ready).length;
    const readyForReview = complete === items.length;
    const reviewRecorded = state.status === 'REVIEW RECORDED · NOT RELEASE';
    const reviewReady = state.status === 'READY FOR QUALIFIED REVIEW';
    list.replaceChildren();
    items.forEach(item => {
      const row = document.createElement('li');
      row.className = `switching-readiness-item ${item.ready ? 'complete' : 'pending'}`;
      const badge = document.createElement('span');
      badge.textContent = item.ready ? 'DONE' : 'NEXT';
      const copy = document.createElement('div');
      const title = document.createElement('strong');
      title.textContent = item.label;
      const detail = document.createElement('small');
      detail.textContent = item.detail;
      copy.append(title, detail);
      const destination = document.createElement('em');
      destination.textContent = item.target.toUpperCase();
      row.append(badge, copy, destination);
      list.append(row);
    });
    if (reviewRecorded) {
      statePill.textContent = 'REVIEW RECORDED';
      statePill.className = 'switching-state-pill reviewed';
      lead.textContent = 'Review is recorded, not released. Utility release and final field confirmation remain outside this workspace.';
    } else if (reviewReady) {
      statePill.textContent = 'READY FOR REVIEW';
      statePill.className = 'switching-state-pill ready';
      lead.textContent = 'The existing qualified-person gate is open for review. This still does not release work or authorize an operation.';
    } else if (readyForReview) {
      statePill.textContent = 'READY TO MARK';
      statePill.className = 'switching-state-pill ready';
      lead.textContent = 'The draft has the visible prerequisites for the existing ready-for-review check. Use that gate only after verifying the current source and field condition.';
    } else {
      statePill.textContent = `DRAFT · ${complete}/${items.length}`;
      statePill.className = 'switching-state-pill';
      lead.textContent = 'Complete the next highlighted item from approved source material. This guide does not change the qualified-review gate.';
    }
  }

  function renderQuickStart() {
    const formSelect = $('wpQuickTemplate');
    const siteSelect = $('wpQuickSite');
    if (!formSelect || !siteSelect) return;
    const rows = uwpcTemplates();
    const currentTemplateId = formSelect.value || state.workProtectionTemplateId || 'pc1';
    const kindLabels = {
      'order-to-operate': 'Switching orders',
      'work-permit': 'Work permits',
      'supporting-guarantee': 'Supporting guarantees',
      application: 'Applications',
      test: 'Test records',
      'de-energizing': 'De-energizing',
      'isolation-tag': 'Isolation tags',
      'equipment-protection': 'Equipment protection'
    };
    const groups = new Map();
    rows.forEach(row => {
      const label = kindLabels[row.kind] || 'Other NorthStar sheets';
      if (!groups.has(label)) groups.set(label, []);
      groups.get(label).push(row);
    });
    formSelect.innerHTML = rows.length
      ? [...groups.entries()].map(([label, templates]) => `<optgroup label="${label}">${templates.map(row => `<option value="${String(row.id).replace(/"/g, '')}">${String(row.form).replace(/[<>&]/g, '')} · ${String(row.title).replace(/[<>&]/g, '')}</option>`).join('')}</optgroup>`).join('')
      : '<option value="">Loading NorthStar sheets…</option>';
    const preferredTemplate = rows.some(row => row.id === currentTemplateId)
      ? currentTemplateId
      : rows.find(row => row.id === 'pc1')?.id || rows.find(row => row.id === 'pc17a')?.id || '';
    formSelect.value = preferredTemplate;
    formSelect.disabled = !rows.length;
    if ($('wpQuickCreate')) $('wpQuickCreate').disabled = !rows.length;

    const currentSite = siteSelect.value || state.site;
    const intakeSite = $('wpSite');
    if (intakeSite) {
      siteSelect.innerHTML = intakeSite.innerHTML;
      if (state.site && ![...siteSelect.options].some(option => option.value === state.site)) {
        siteSelect.add(new Option(state.site, state.site));
      }
      siteSelect.value = currentSite || state.site;
    }
    const asset = $('wpQuickAsset');
    const purpose = $('wpQuickPurpose');
    const attachmentStatus = $('wpQuickAttachmentStatus');
    if (asset) asset.value = state.asset || asset.value;
    if (purpose) purpose.value = state.scope || purpose.value;
    if (attachmentStatus) {
      const attachmentCount = selectedRuleFiles.length || state.ruleSources.length;
      attachmentStatus.textContent = attachmentCount
        ? `${attachmentCount} supporting document(s) selected · included when the request draft is saved`
        : 'Optional · PDF, Word, Excel, or text · stored with the request draft';
    }
    quickTemplateHint();
  }

  function hasDraftContent() {
    return Boolean(state.id || state.packageName || state.asset || state.scope || state.workProtectionTemplateId || state.diagrams.length || state.ruleSources.length || hasFilledReviewRows());
  }

  function resetDraftState() {
    selectedFiles.forEach(file => file.url && URL.revokeObjectURL(file.url));
    Object.keys(state).forEach(key => { if (Array.isArray(state[key])) state[key] = []; else if (typeof state[key] === 'object' && state[key] !== null) state[key] = {}; else state[key] = ''; });
    state.schema = 1; state.version = 0; state.schematicRevision = 0; state.status = 'DRAFT'; state.storage = 'LOCAL'; state.serverUpdatedAt = '';
    state.ruleSet = 'UWPC 2024'; state.authorityProcedureId = 'uwpc-2024'; state.authorityProcedureRevision = '2024';
    selectedFiles = []; selectedRuleFiles = [];
    try { localStorage.removeItem(KEY); } catch { /* optional */ }
  }

  async function createQuickDraft() {
    const templateId = $('wpQuickTemplate')?.value;
    const siteSelect = $('wpQuickSite');
    const asset = $('wpQuickAsset')?.value.trim() || '';
    const purpose = $('wpQuickPurpose')?.value.trim() || '';
    const status = $('wpQuickStatus');
    const template = uwpcTemplates().find(row => row.id === templateId);
    if (!template || !siteSelect?.value || !asset || !purpose) {
      if (status) { status.textContent = 'Select a form and station, then enter the asset and a brief purpose.'; status.className = 'switching-quick-status warn'; }
      return;
    }
    if (hasDraftContent() && !confirm('Start a separate UWPC draft? Existing server records remain in the library, but unsaved browser edits in the current draft will be cleared.')) return;
    if (hasDraftContent()) resetDraftState();
    const picked = window.NorthStarSites
      ? NorthStarSites.selected(siteSelect)
      : { site: siteSelect.value.trim(), siteId: siteSelect.selectedOptions[0]?.dataset.siteId || '' };
    state.site = picked.site;
    state.siteId = picked.siteId || (window.NorthStarSites && NorthStarSites.resolve(picked.site)?.id) || '';
    state.asset = asset;
    state.scope = purpose;
    state.packageName = `${template.form} ${asset} draft`;
    if (!applyTemplate(templateId, { seedRows: true, force: true })) return;
    await saveDraft(`${template.form} draft created.`);
    if (status) {
      status.textContent = state.storage === 'SERVER'
        ? `${template.form} request draft saved. Complete the sheet below; any selected documents are stored with the request.`
        : `${template.form} draft is local only until the operator record can be reached.`;
      status.className = `switching-quick-status ${state.storage === 'SERVER' ? 'ok' : 'warn'}`;
    }
    document.querySelector('#wpTemplateSheet')?.closest('details.uwpc-workflow-group')?.setAttribute('open', '');
    window.NorthstarModules?.open('outages:switching-templates');
    document.querySelector('#wpTemplateSheet')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function applyTemplate(templateId, options = {}) {
    if (!templateId) {
      setNote('Select a NorthStar template first.', 'warn');
      return false;
    }
    const selected = uwpcTemplates().find(row => row.id === templateId);
    if (!selected) return false;
    if (state.status === 'REVIEW RECORDED · NOT RELEASE') {
      setNote('Reviewed packages are immutable; start a new revision before changing templates.', 'warn');
      return false;
    }
    const filled = hasFilledReviewRows();
    if (options.seedRows && filled && !options.force && !confirm('Replace draft review prompts with this NorthStar template? Filled answers in the second column will be cleared.')) {
      return false;
    }
    state.workProtectionTemplateId = selected.id;
    if (selected.standalone && selected.instrumentId) {
      state.workProtectionId = selected.instrumentId;
      const instrument = (window.NorthStarUwpc?.instruments || []).find(row => row.id === selected.instrumentId);
      state.workProtectionName = instrument?.name || selected.form;
      state.workProtectionSection = selected.article;
    }
    if (!state.packageName) state.packageName = `${selected.form} ${state.asset || state.site || 'work-protection'} draft`;
    if (options.seedRows || !filled) {
      const rows = selected.reviewRows || {};
      ['isolation', 'sequence', 'verification', 'permission', 'restoration'].forEach(kind => {
        if (Array.isArray(rows[kind]) && rows[kind].length) state[kind] = rows[kind].map(row => ({ first: row.first || '', second: '' }));
      });
    }
    const allowed = new Set((selected.fields || []).map(field => field.id));
    state.templateFields = Object.fromEntries(Object.entries(state.templateFields || {}).filter(([key]) => allowed.has(key)));
    if (state.site && !state.templateFields.station) state.templateFields.station = state.site;
    if (state.asset && !state.templateFields.asset) state.templateFields.asset = state.asset;
    if (selected.id === 'pc1' && state.asset && !state.templateFields.workProtectionDescription) state.templateFields.workProtectionDescription = state.asset;
    if (selected.id === 'pc1' && state.scope && !state.templateFields.workDescription) state.templateFields.workDescription = state.scope;
    addAudit(`NorthStar ${selected.form} template applied. Drafting only.`);
    write();
    renderFields();
    setNote(`${selected.form} NorthStar sheet is open. Fill it from the approved source. This is not a permit.`);
    $('wpIntakeStatus').textContent = `${selected.form} TEMPLATE APPLIED · DRAFTING ONLY.`;
    return true;
  }

  async function loadUwpc() {
    try {
      const record = await serverRequest('/api/uwpc');
      window.NorthStarUwpc = record;
      const select = $('wpWorkProtection');
      if (select && Array.isArray(record.instruments)) {
        const current = state.workProtectionId || select.value;
        select.innerHTML = '<option value="">Select Work Permit / tag</option>' + record.instruments.map(row => (
          `<option value="${String(row.id).replace(/"/g, '')}">${String(row.name).replace(/[<>&]/g, '')} · ${String(row.article).replace(/[<>&]/g, '')}</option>`
        )).join('');
        if (current) select.value = current;
      }
      renderTemplateOptions();
      renderTemplates();
    } catch {
      window.NorthStarUwpc = { bookAvailable: false, templates: [] };
    }
  }

  function bind() {
    buildEngineeringHub();
    read();
    if (!state.ruleSet) { state.ruleSet = 'UWPC 2024'; state.authorityProcedureId = state.authorityProcedureId || 'uwpc-2024'; state.authorityProcedureRevision = state.authorityProcedureRevision || '2024'; }
    renderFields();
    void loadUwpc().then(() => renderFields());
    void loadReferenceData().then(() => { renderFields(); void hydrateServer(); }); void loadDraftLibrary();
    $('wpAddDiagram').onclick = () => $('wpDiagramFiles').click();
    $('wpDiagramFiles').onchange = event => {
      const rejected = [];
      [...event.target.files].forEach(file => {
        if (file.size > MAX_FILE_BYTES) { rejected.push(`${file.name} exceeds 25 MB`); return; }
        selectedFiles.push({ name: file.name, size: file.size, type: file.type, lastModified: file.lastModified, url: URL.createObjectURL(file), file });
      });
      renderFiles(); $('wpIntakeStatus').textContent = rejected.length ? rejected.join(' · ') : `${selectedFiles.length} diagram(s) selected locally.`; event.target.value = '';
    };
    $('wpAddSource').onclick = () => $('wpSourceFiles').click();
    $('wpSourceFiles').onchange = event => {
      const rejected = [];
      [...event.target.files].forEach(file => {
        if (file.size > MAX_FILE_BYTES) { rejected.push(`${file.name} exceeds 25 MB`); return; }
        selectedRuleFiles.push({ name: file.name, size: file.size, type: file.type, lastModified: file.lastModified, url: URL.createObjectURL(file), file });
      });
      renderRuleFiles(); renderTemplates(); renderQuickStart(); $('wpIntakeStatus').textContent = rejected.length ? rejected.join(' · ') : `${selectedRuleFiles.length} supporting source(s) selected locally.`; event.target.value = '';
    };
    $('wpQuickAttachRequest')?.addEventListener('click', () => $('wpSourceFiles')?.click());
    $('wpCreateDraft').onclick = createDraft; $('wpSaveDraft').onclick = () => saveDraft(); $('wpApplyTemplate').onclick = () => applyTemplate($('wpTemplate').value || state.workProtectionTemplateId, { seedRows: true }); $('wpReadyReview').onclick = readyForReview; $('wpRecordReview').onclick = recordReview; $('wpDownloadBundle').onclick = downloadControlledBundle; $('wpCloneRevision').onclick = cloneServerRevision; $('wpPrintPacket').onclick = printPacket; $('wpExportDraft').onclick = exportLocalRecord; $('wpNewDraft').onclick = newDraft;
    $('wpQuickCreate')?.addEventListener('click', () => { void createQuickDraft(); });
    $('wpQuickTemplate')?.addEventListener('change', quickTemplateHint);
    document.querySelectorAll('[data-quick-template]').forEach(button => button.addEventListener('click', () => {
      const select = $('wpQuickTemplate');
      if (!select) return;
      select.value = button.dataset.quickTemplate;
      quickTemplateHint();
      $('wpQuickAsset')?.focus();
    }));
    document.querySelectorAll('[data-readiness-target]').forEach(button => button.addEventListener('click', () => {
      document.querySelector(button.dataset.readinessTarget)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }));
    $('wpTemplateKind')?.addEventListener('change', () => { renderTemplateOptions(); renderTemplates(); });
    $('wpTemplate')?.addEventListener('change', () => {
      if ($('wpTemplate').value) applyTemplate($('wpTemplate').value, { seedRows: !hasFilledReviewRows() });
    });
    $('wpWorkProtection')?.addEventListener('change', () => {
      const instrumentId = $('wpWorkProtection').value;
      const match = uwpcTemplates().find(row => row.standalone && row.instrumentId === instrumentId);
      if (match && !state.workProtectionTemplateId) applyTemplate(match.id, { seedRows: !hasFilledReviewRows() });
    });
    $('wpRefreshLibrary').onclick = loadDraftLibrary;
    $('wpLibraryStatus').onchange = loadDraftLibrary;
    let libraryTimer = null;
    $('wpLibrarySearch').oninput = () => { clearTimeout(libraryTimer); libraryTimer = setTimeout(loadDraftLibrary, 250); };
    $('wpOutageId').onchange = () => { const outage = outageRecords.find(item => item.id === $('wpOutageId').value); if (outage) prefillOutage(outage); else { state.outageId = ''; write(); } };
    $('wpSchematicId').onchange = () => { const schematic = schematicRecords.find(item => item.id === $('wpSchematicId').value); if (schematic) void attachSchematic(schematic); else { state.schematicId = ''; state.schematicRevision = 0; write(); renderFields(); } };
    document.addEventListener('northstar:schematics-changed', event => {
      const schematic = event.detail;
      const index = schematicRecords.findIndex(item => item.id === schematic?.id);
      if (schematic?.id && index >= 0) schematicRecords.splice(index, 1, schematic);
      else if (schematic?.id) schematicRecords.unshift(schematic);
      renderSourceSelectors();
    });
    [['wpAddIsolation', 'isolation'], ['wpAddSequence', 'sequence'], ['wpAddVerification', 'verification'], ['wpAddPermission', 'permission'], ['wpAddRestoration', 'restoration']].forEach(([id, kind]) => $(id).onclick = () => { state[kind].push({ first: '', second: '' }); renderRows(kind); write(); });
    document.querySelectorAll('[data-approval-check]').forEach(check => check.addEventListener('change', () => { state.checks[check.dataset.approvalCheck] = check.checked; write(); }));
    document.querySelectorAll('#switching input:not([type="file"]),#switching textarea').forEach(input => input.addEventListener('input', () => { collectFields(); write(); }));
    document.querySelectorAll('#switching select').forEach(input => input.addEventListener('change', () => { collectFields(); write(); renderFields(); }));
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bind);
  else bind();
})();
