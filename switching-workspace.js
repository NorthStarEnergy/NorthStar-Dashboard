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
    if (!workspace || !banner || workspace.querySelector('.engineering-hub')) return;

    const label = banner.querySelector('label');
    const title = banner.querySelector('h2');
    if (label) label.textContent = 'ENGINEERING WORKSPACE · DRAWINGS / WORK PACKAGES / REVIEW';
    if (title) title.textContent = 'Engineering Drawings & Work Protection';
    const intro = document.createElement('p');
    intro.className = 'engineering-banner-copy';
    intro.textContent = 'Build one-line diagrams, assemble controlled source packages, document review checks, and retain a local or server-backed audit trail.';
    title?.after(intro);

    const hub = document.createElement('nav');
    hub.className = 'engineering-hub';
    hub.setAttribute('aria-label', 'Engineering workspace tools');
    hub.innerHTML = `
      <button type="button" data-engineering-target="#oneLineEditor"><span>DRAWING</span><strong>One-line editor</strong><small>Symbols, connections, labels, import and export</small><em>OPEN EDITOR →</em></button>
      <button type="button" data-engineering-target="[data-module-id='switching-intake']"><span>SOURCE CONTROL</span><strong>Diagram intake</strong><small id="engineeringSourceStatus">No source package loaded</small><em>OPEN INTAKE →</em></button>
      <button type="button" data-engineering-target="[data-module-id='switching-form']"><span>WORK PACKAGE</span><strong>Draft package</strong><small id="engineeringDraftStatus">Draft not started</small><em>OPEN PACKAGE →</em></button>
      <button type="button" data-engineering-target="[data-module-id='switching-approval']"><span>REVIEW</span><strong>Qualified-person gate</strong><small id="engineeringReviewStatus">Not ready for review</small><em>OPEN REVIEW →</em></button>`;
    hub.querySelectorAll('[data-engineering-target]').forEach(button => {
      button.addEventListener('click', () => {
        document.querySelector(button.dataset.engineeringTarget)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    });
    banner.after(hub);
  }

  function renderEngineeringHub() {
    const diagrams = (selectedFiles.length || state.diagrams.length) + (state.schematicId ? 1 : 0);
    const sources = selectedRuleFiles.length || state.ruleSources.length;
    const sourceStatus = document.querySelector('#engineeringSourceStatus');
    const draftStatus = document.querySelector('#engineeringDraftStatus');
    const reviewStatus = document.querySelector('#engineeringReviewStatus');
    if (sourceStatus) sourceStatus.textContent = `${diagrams} diagram${diagrams === 1 ? '' : 's'} · ${sources} procedure source${sources === 1 ? '' : 's'}`;
    if (draftStatus) draftStatus.textContent = state.packageName ? `${state.packageName} · ${state.status}` : 'Draft not started';
    if (reviewStatus) reviewStatus.textContent = state.status === 'REVIEW RECORDED · NOT RELEASE' ? 'Review recorded · not release' : state.status === 'READY FOR QUALIFIED REVIEW' ? 'Ready for qualified review' : 'Not ready for review';
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
  const displayTime = value => value ? new Date(value).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' }) : 'NOT SAVED';
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
    ['packageName', 'site', 'siteId', 'asset', 'outageId', 'schematicId', 'symbolProfileApprovalRef', 'canonicalAssetId', 'topologySnapshotId', 'topologyRevision', 'revision', 'ruleSet', 'authorityProcedureId', 'authorityProcedureRevision', 'workProtectionId', 'workProtectionName', 'workProtectionSection', 'qualificationEvidenceRef', 'sourceManifestDigest', 'scope', 'reviewerName', 'reviewerRole', 'reviewComments'].forEach(key => {
      if (typeof record[key] === 'string') state[key] = record[key];
    });
    state.schematicRevision = Number(record.schematicRevision) || 0;
    ['diagrams', 'ruleSources', 'isolation', 'sequence', 'verification', 'permission', 'restoration'].forEach(key => {
      if (Array.isArray(record[key])) state[key] = record[key];
    });
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
      setNote(`Server draft ${record.id} loaded. Stored sources are available on any signed-in operator browser.`);
    } catch (error) {
      setNote(`Draft could not be loaded: ${error.message}.`, 'error');
    }
  }

  async function loadDraftLibrary() {
    const list = $('wpLibraryList');
    if (!list) return;
    list.innerHTML = '<div class="switching-empty">Loading server drafts…</div>';
    const params = new URLSearchParams();
    const query = $('wpLibrarySearch')?.value.trim();
    const status = $('wpLibraryStatus')?.value;
    if (query) params.set('q', query);
    if (status) params.set('status', status);
    try {
      const records = await serverRequest('/api/switching/drafts' + (params.size ? `?${params}` : ''));
      list.replaceChildren();
      if (!records.length) { list.innerHTML = '<div class="switching-empty">No matching server drafts.</div>'; return; }
      records.forEach(record => {
        const row = document.createElement('div'); row.className = 'switching-library-row';
        const name = document.createElement('strong'); name.textContent = record.packageName || record.id;
        const asset = document.createElement('span'); asset.textContent = `${record.site || '—'} · ${record.asset || '—'}`;
        const stateLabel = document.createElement('small'); stateLabel.textContent = `${record.status} · ${displayTime(record.updatedAt)}`;
        const open = document.createElement('button'); open.type = 'button'; open.textContent = 'OPEN'; open.onclick = () => loadDraftRecord(record.id);
        row.append(name, asset, stateLabel, open); list.append(row);
      });
    } catch (error) {
      list.innerHTML = `<div class="switching-empty">Server library unavailable: ${String(error.message || error).replace(/[<>&]/g, '')}</div>`;
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
    $('wpFormStatus').textContent = state.packageName ? `${state.diagrams.length} uploaded diagram(s) · ${state.schematicId ? `server schematic rev ${state.schematicRevision} · ` : ''}${state.ruleSources.length} governing source(s)${instrumentNote} · source-derived fields remain subject to qualified review.` : 'Create a package after attaching the current source diagrams. Select the UWPC 2024 instrument. The fields below stay blank until a qualified reviewer verifies the source.';
    const immutable = state.status === 'REVIEW RECORDED · NOT RELEASE';
    document.querySelectorAll("[data-module-id='switching-intake'] input,[data-module-id='switching-intake'] textarea,[data-module-id='switching-intake'] select,[data-module-id='switching-intake'] button,[data-module-id='switching-form'] input,[data-module-id='switching-form'] textarea,[data-module-id='switching-form'] button,[data-module-id='switching-approval'] input,[data-module-id='switching-approval'] textarea,[data-module-id='switching-approval'] button").forEach(control => { control.disabled = immutable; });
    $('wpRecordReview').disabled = state.status !== 'READY FOR QUALIFIED REVIEW';
    $('wpDownloadBundle').disabled = !state.id || state.storage !== 'SERVER';
    $('wpCloneRevision').disabled = !state.id || state.storage !== 'SERVER';
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
    selectedFiles.forEach(file => file.url && URL.revokeObjectURL(file.url));
    Object.keys(state).forEach(key => { if (Array.isArray(state[key])) state[key] = []; else if (typeof state[key] === 'object' && state[key] !== null) state[key] = {}; else state[key] = ''; });
    state.schema = 1; state.version = 0; state.schematicRevision = 0; state.status = 'DRAFT'; state.storage = 'LOCAL'; state.serverUpdatedAt = '';
    state.ruleSet = 'UWPC 2024'; state.authorityProcedureId = 'uwpc-2024'; state.authorityProcedureRevision = '2024';
    try { localStorage.removeItem(KEY); } catch { /* optional */ }
    selectedFiles = []; selectedRuleFiles = []; renderFields(); setNote('New local draft ready.'); $('wpIntakeStatus').textContent = '';
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
    } catch {
      window.NorthStarUwpc = { bookAvailable: false };
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
      renderRuleFiles(); $('wpIntakeStatus').textContent = rejected.length ? rejected.join(' · ') : `${selectedRuleFiles.length} governing source(s) selected locally.`; event.target.value = '';
    };
    $('wpCreateDraft').onclick = createDraft; $('wpSaveDraft').onclick = () => saveDraft(); $('wpReadyReview').onclick = readyForReview; $('wpRecordReview').onclick = recordReview; $('wpDownloadBundle').onclick = downloadControlledBundle; $('wpCloneRevision').onclick = cloneServerRevision; $('wpPrintPacket').onclick = printPacket; $('wpExportDraft').onclick = exportLocalRecord; $('wpNewDraft').onclick = newDraft;
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
