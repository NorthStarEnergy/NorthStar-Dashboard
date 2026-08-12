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
    asset: '',
    canonicalAssetId: '',
    topologySnapshotId: '',
    topologyRevision: '',
    revision: '',
    ruleSet: '',
    authorityProcedureId: '',
    authorityProcedureRevision: '',
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
      asset: state.asset,
      canonicalAssetId: state.canonicalAssetId,
      topologySnapshotId: state.topologySnapshotId,
      topologyRevision: state.topologyRevision,
      revision: state.revision,
      ruleSet: state.ruleSet,
      authorityProcedureId: state.authorityProcedureId,
      authorityProcedureRevision: state.authorityProcedureRevision,
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
    ['packageName', 'site', 'asset', 'canonicalAssetId', 'topologySnapshotId', 'topologyRevision', 'revision', 'ruleSet', 'authorityProcedureId', 'authorityProcedureRevision', 'qualificationEvidenceRef', 'sourceManifestDigest', 'scope', 'reviewerName', 'reviewerRole', 'reviewComments'].forEach(key => {
      if (typeof record[key] === 'string') state[key] = record[key];
    });
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
    if (!selectedFiles.length) selectedFiles = state.diagrams.map(file => ({ ...file }));
    if (!selectedRuleFiles.length) selectedRuleFiles = state.ruleSources.map(file => ({ ...file }));
  }

  async function persistServer() {
    syncDiagramRecords(); syncRuleRecords();
    await refreshSourceManifestDigest();
    const path = state.id ? `/api/switching/drafts/${encodeURIComponent(state.id)}` : '/api/switching/drafts';
    const record = await serverRequest(path, 'POST', serverPayload());
    applyServerRecord(record);
    write(false);
    renderFields();
    return record;
  }

  function collectFields() {
    state.packageName = $('wpPackageName').value.trim();
    state.site = $('wpSite').value.trim();
    state.asset = $('wpAsset').value.trim();
    state.canonicalAssetId = $('wpCanonicalAssetId').value.trim();
    state.topologySnapshotId = $('wpTopologySnapshotId').value.trim();
    state.topologyRevision = $('wpTopologyRevision').value.trim();
    state.revision = $('wpDiagramRevision').value.trim();
    state.ruleSet = $('wpRuleSet').value.trim();
    state.authorityProcedureId = $('wpAuthorityProcedureId').value.trim();
    state.authorityProcedureRevision = $('wpAuthorityProcedureRevision').value.trim();
    state.qualificationEvidenceRef = $('wpQualificationEvidenceRef').value.trim();
    state.scope = $('wpWorkScope').value.trim();
    state.reviewerName = $('wpReviewerName').value.trim();
    state.reviewerRole = $('wpReviewerRole').value.trim();
    state.reviewComments = $('wpReviewComments').value.trim();
  }

  function syncDiagramRecords() {
    state.diagrams = selectedFiles.map(file => ({ name: file.name, size: file.size, type: file.type, lastModified: file.lastModified }));
  }

  function syncRuleRecords() {
    state.ruleSources = selectedRuleFiles.map(file => ({ name: file.name, size: file.size, type: file.type, lastModified: file.lastModified }));
  }

  async function refreshSourceManifestDigest() {
    const manifest = JSON.stringify({
      diagrams: [...state.diagrams].sort((a, b) => `${a.name}:${a.lastModified}`.localeCompare(`${b.name}:${b.lastModified}`)),
      ruleSources: [...state.ruleSources].sort((a, b) => `${a.name}:${a.lastModified}`.localeCompare(`${b.name}:${b.lastModified}`))
    });
    if (!window.crypto?.subtle || !window.TextEncoder) { state.sourceManifestDigest = ''; return; }
    const bytes = await window.crypto.subtle.digest('SHA-256', new TextEncoder().encode(manifest));
    state.sourceManifestDigest = [...new Uint8Array(bytes)].map(byte => byte.toString(16).padStart(2, '0')).join('');
  }

  function addAudit(message) {
    state.audit.unshift({ at: new Date().toISOString(), message });
    state.audit = state.audit.slice(0, 30);
  }

  function renderFiles() {
    const list = $('wpFileList');
    list.replaceChildren();
    const records = selectedFiles.length ? selectedFiles : state.diagrams;
    if (!records.length) { list.innerHTML = '<div class="switching-empty">No source diagrams attached.</div>'; return; }
    records.forEach((file, index) => {
      const row = document.createElement('div'); row.className = 'switching-file';
      const name = document.createElement('strong'); name.textContent = file.name;
      const meta = document.createElement('small'); meta.textContent = `${file.type || 'file'} · ${fileSize(file.size || 0)}`;
      row.append(name, meta);
      if (file.url) { const open = document.createElement('a'); open.href = file.url; open.target = '_blank'; open.rel = 'noopener'; open.textContent = 'OPEN'; row.append(open); }
      const remove = document.createElement('button'); remove.type = 'button'; remove.textContent = 'REMOVE'; remove.title = 'Remove source file';
      remove.addEventListener('click', () => {
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
      const meta = document.createElement('small'); meta.textContent = `${file.type || 'file'} · ${fileSize(file.size || 0)}`;
      row.append(name, meta);
      if (file.url) { const open = document.createElement('a'); open.href = file.url; open.target = '_blank'; open.rel = 'noopener'; open.textContent = 'OPEN'; row.append(open); }
      const remove = document.createElement('button'); remove.type = 'button'; remove.textContent = 'REMOVE'; remove.title = 'Remove governing source';
      remove.addEventListener('click', () => {
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
    $('wpSite').value = state.site;
    $('wpAsset').value = state.asset;
    $('wpCanonicalAssetId').value = state.canonicalAssetId;
    $('wpTopologySnapshotId').value = state.topologySnapshotId;
    $('wpTopologyRevision').value = state.topologyRevision;
    $('wpDiagramRevision').value = state.revision;
    $('wpRuleSet').value = state.ruleSet;
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
    $('wpFormStatus').textContent = state.packageName ? `${state.diagrams.length} diagram(s) · ${state.ruleSources.length} governing source(s) · source-derived fields remain subject to qualified review.` : 'Create a package after attaching the current source diagrams. The fields below are intentionally blank until a qualified reviewer verifies the source.';
    $('wpRecordReview').disabled = state.status !== 'READY FOR QUALIFIED REVIEW';
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
    if (!state.packageName || !state.site || !state.asset || !state.revision || !state.ruleSet || !state.scope || !(selectedFiles.length || state.diagrams.length)) {
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
    if (!state.ruleSet) missing.push('UWPC/EUSR rule set');
    if (!state.authorityProcedureId) missing.push('authority procedure ID');
    if (!state.authorityProcedureRevision) missing.push('authority procedure revision');
    if (!state.qualificationEvidenceRef) missing.push('qualification evidence reference');
    if (!state.sourceManifestDigest) missing.push('source manifest digest');
    if (!state.scope) missing.push('scope');
    if (!(selectedFiles.length || state.diagrams.length)) missing.push('source diagram');
    if (!(selectedRuleFiles.length || state.ruleSources.length)) missing.push('governing rule/procedure source');
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

  function exportLocalRecord() {
    collectFields(); syncDiagramRecords(); syncRuleRecords(); addAudit('Local draft record exported without file contents.'); write(); renderFields();
    const payload = { ...state, exportedAt: new Date().toISOString(), fileContents: 'not included; source files remain local to the browser' };
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
    state.schema = 1; state.version = 0; state.status = 'DRAFT'; state.storage = 'LOCAL'; state.serverUpdatedAt = '';
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

  function bind() {
    read(); renderFields(); void hydrateServer();
    $('wpAddDiagram').onclick = () => $('wpDiagramFiles').click();
    $('wpDiagramFiles').onchange = event => {
      const rejected = [];
      [...event.target.files].forEach(file => {
        if (file.size > MAX_FILE_BYTES) { rejected.push(`${file.name} exceeds 25 MB`); return; }
        selectedFiles.push({ name: file.name, size: file.size, type: file.type, lastModified: file.lastModified, url: URL.createObjectURL(file) });
      });
      renderFiles(); $('wpIntakeStatus').textContent = rejected.length ? rejected.join(' · ') : `${selectedFiles.length} diagram(s) selected locally.`; event.target.value = '';
    };
    $('wpAddSource').onclick = () => $('wpSourceFiles').click();
    $('wpSourceFiles').onchange = event => {
      const rejected = [];
      [...event.target.files].forEach(file => {
        if (file.size > MAX_FILE_BYTES) { rejected.push(`${file.name} exceeds 25 MB`); return; }
        selectedRuleFiles.push({ name: file.name, size: file.size, type: file.type, lastModified: file.lastModified, url: URL.createObjectURL(file) });
      });
      renderRuleFiles(); $('wpIntakeStatus').textContent = rejected.length ? rejected.join(' · ') : `${selectedRuleFiles.length} governing source(s) selected locally.`; event.target.value = '';
    };
    $('wpCreateDraft').onclick = createDraft; $('wpSaveDraft').onclick = () => saveDraft(); $('wpReadyReview').onclick = readyForReview; $('wpRecordReview').onclick = recordReview; $('wpPrintPacket').onclick = printPacket; $('wpExportDraft').onclick = exportLocalRecord; $('wpNewDraft').onclick = newDraft;
    [['wpAddIsolation', 'isolation'], ['wpAddSequence', 'sequence'], ['wpAddVerification', 'verification'], ['wpAddPermission', 'permission'], ['wpAddRestoration', 'restoration']].forEach(([id, kind]) => $(id).onclick = () => { state[kind].push({ first: '', second: '' }); renderRows(kind); write(); });
    document.querySelectorAll('[data-approval-check]').forEach(check => check.addEventListener('change', () => { state.checks[check.dataset.approvalCheck] = check.checked; write(); }));
    document.querySelectorAll('#switching input:not([type="file"]),#switching textarea').forEach(input => input.addEventListener('input', () => { collectFields(); write(); }));
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bind);
  else bind();
})();
