(() => {
  const state = { status: null, bound: false };

  function esc(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function ensureWorkspace() {
    const tools = document.querySelector('#tools');
    if (!tools) return null;
    const host = tools.querySelector(':scope > .panel') || tools;
    let root = document.querySelector('#outlookWorkspace');
    if (root) return root;
    root = document.createElement('section');
    root.id = 'outlookWorkspace';
    root.className = 'panel outlook-workspace';
    root.dataset.moduleId = 'outlook-workspace';
    root.innerHTML = `
      <div class="outlook-shell">
        <header class="outlook-head">
          <div>
            <label>MICROSOFT OUTLOOK · OPERATOR COMMUNICATIONS</label>
            <h2>Outlook Desk</h2>
            <p>Prepare a reviewed email draft without sending it from NorthStar.</p>
          </div>
          <div class="outlook-head-actions">
            <span class="outlook-status" id="outlookStatus" aria-live="polite">CHECKING CONNECTION</span>
            <a class="outlook-open" href="https://outlook.office.com/mail/" target="_blank" rel="noopener noreferrer">OPEN OUTLOOK ↗</a>
          </div>
        </header>
        <div class="outlook-content">
          <form class="outlook-draft" id="outlookDraftForm">
            <div class="outlook-draft-head">
              <div>
                <label>OUTLOOK DRAFT</label>
                <h3>Compose for operator review</h3>
              </div>
              <button id="outlookClearDraft" type="button" class="outlook-secondary">CLEAR</button>
            </div>
            <label>TO<input id="outlookRecipient" name="to" autocomplete="email" placeholder="Operator, shift team, or distribution list"></label>
            <label>SUBJECT<input id="outlookSubject" name="subject" maxlength="240" placeholder="Operational update"></label>
            <label>MESSAGE<textarea id="outlookBody" name="body" maxlength="1800" placeholder="Context, decisions, conditions, actions, and follow-up."></textarea></label>
            <div class="outlook-draft-actions">
              <span id="outlookDraftNotice" class="outlook-notice">The dashboard does not send or retain this draft.</span>
              <button type="submit" class="primary-btn">OPEN REVIEW DRAFT</button>
            </div>
          </form>
          <aside class="outlook-connection" aria-labelledby="outlookConnectionHeading">
            <div class="outlook-connection-head">
              <div>
                <label>MAILBOX CONNECTION</label>
                <h3 id="outlookConnectionHeading">Connection status</h3>
              </div>
              <button id="outlookRefresh" type="button" class="outlook-secondary">REFRESH</button>
            </div>
            <p id="outlookConnectionDetail">Checking the operator-only connection status…</p>
            <dl class="outlook-capabilities">
              <div><dt>MAILBOX SYNC</dt><dd id="outlookSync">NOT ENABLED</dd></div>
              <div><dt>LAST SUCCESSFUL SYNC</dt><dd id="outlookLastSync">—</dd></div>
            </dl>
            <p class="outlook-guardrail">Inbox access, background sync, and delivery are disabled until an approved Microsoft Graph source is authorized.</p>
          </aside>
        </div>
      </div>`;
    host.appendChild(root);
    return root;
  }

  function statusText(status) {
    const labels = {
      not_configured: 'NOT CONFIGURED',
      draft_only: 'DRAFT ONLY',
      awaiting_authorization: 'AWAITING AUTHORIZATION',
    };
    return labels[status?.state] || 'STATUS UNAVAILABLE';
  }

  function renderStatus(status) {
    state.status = status || null;
    const chip = document.querySelector('#outlookStatus');
    const detail = document.querySelector('#outlookConnectionDetail');
    const sync = document.querySelector('#outlookSync');
    const lastSync = document.querySelector('#outlookLastSync');
    if (chip) {
      chip.className = `outlook-status ${status?.state || 'unavailable'}`;
      chip.textContent = statusText(status);
    }
    if (detail) detail.textContent = status?.detail || 'Connection status is unavailable.';
    if (sync) sync.textContent = status?.canSync ? 'AVAILABLE' : 'NOT ENABLED';
    if (lastSync) lastSync.textContent = status?.lastSuccessfulSync || '—';
  }

  async function loadStatus() {
    try {
      const response = await fetch('/api/microsoft/outlook/status', { cache: 'no-store' });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.error || `HTTP ${response.status}`);
      renderStatus(payload);
    } catch {
      renderStatus(null);
    }
  }

  function clearDraft() {
    document.querySelector('#outlookDraftForm')?.reset();
    const notice = document.querySelector('#outlookDraftNotice');
    if (notice) notice.textContent = 'The dashboard does not send or retain this draft.';
  }

  function openDraft(event) {
    event.preventDefault();
    const recipient = document.querySelector('#outlookRecipient')?.value.trim() || '';
    const subject = document.querySelector('#outlookSubject')?.value.trim() || '';
    const body = document.querySelector('#outlookBody')?.value.trim() || '';
    const notice = document.querySelector('#outlookDraftNotice');
    if (!recipient) {
      if (notice) notice.textContent = 'Enter at least one recipient before opening a draft.';
      document.querySelector('#outlookRecipient')?.focus();
      return;
    }
    const query = new URLSearchParams();
    if (subject) query.set('subject', subject);
    if (body) query.set('body', body);
    if (notice) notice.textContent = 'Opening a draft in your configured mail app for review.';
    window.location.assign(`mailto:${encodeURIComponent(recipient)}${query.size ? `?${query}` : ''}`);
  }

  function openWorkspace(event) {
    event.preventDefault();
    document.querySelector('[data-tab="tools"]')?.click();
    window.setTimeout(() => {
      window.NorthstarModules?.open('tools:outlook-workspace');
      const root = document.querySelector('#outlookWorkspace');
      root?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      root?.querySelector('#outlookRecipient')?.focus({ preventScroll: true });
    }, 80);
  }

  function bind() {
    if (state.bound) return;
    state.bound = true;
    document.querySelector('#outlookDraftForm')?.addEventListener('submit', openDraft);
    document.querySelector('#outlookClearDraft')?.addEventListener('click', clearDraft);
    document.querySelector('#outlookRefresh')?.addEventListener('click', loadStatus);
    document.querySelector('.app-launcher.outlook')?.addEventListener('click', openWorkspace);
  }

  async function init() {
    if (!ensureWorkspace()) return;
    bind();
    renderStatus({ state: 'not_configured', detail: 'Checking the operator-only connection status…', canSync: false });
    await loadStatus();
  }

  window.NorthStarOutlook = { init, loadStatus, state, esc };
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
