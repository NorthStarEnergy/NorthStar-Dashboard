(() => {
  const MODEL_PREF_KEY = 'northstar-ai-model-default-v2';
  const REASONING_PREF_KEY = 'northstar-ai-reasoning-default-v2';
  const MODEL_LABELS = {
    'gpt-6-astra': 'GPT-6 Astra · Highest capability',
    'gpt-6-sol': 'GPT-6 Sol · Balanced',
    'gpt-6-luna': 'GPT-6 Luna · Efficient',
    'gpt-5.4': 'GPT-5.4 · Full model',
    'gpt-5.4-mini': 'GPT-5.4 mini · Default',
    'gpt-5.4-nano': 'GPT-5.4 nano · Fast',
  };
  const REASONING_LABELS = {
    none: 'None · Fastest', low: 'Low', medium: 'Medium · Standard',
    high: 'High', xhigh: 'Extra high', max: 'Maximum',
  };
  const SECTION_SCOPES = {
    overview: 'dashboard',
    events: 'events',
    markets: 'market',
    outages: 'outages',
    logbook: 'logbook',
    crew: 'site',
    switching: 'site',
    voice: 'general',
    scada: 'general',
    assistant: 'dashboard',
    weather: 'general',
    mobile: 'site',
    'field-operations': 'site',
  };

  const PROMPTS = {
    events: [
      'Summarize the most recent alarms in the event stream.',
      'What operational changes happened in the last few hours?',
      'Find events mentioning APIROQ or market activity.',
      'List safety-related or elevated-severity events.',
    ],
    market: [
      'Summarize current real-time and day-ahead prices.',
      'Which nodes look most active right now?',
      'Are any price alerts currently open?',
    ],
    outages: [
      'Summarize all open outages.',
      'Which sites currently have degraded equipment?',
    ],
    logbook: [
      'Summarize the latest operator logbook entries.',
      'What shift handoff notes were recorded recently?',
    ],
    site: [
      'Give me a site operations snapshot from outages and recent events.',
      'What changed recently across outages and logbook entries?',
    ],
    dashboard: [
      'Search all available dashboard records for the latest operational concerns.',
      'Find engineering references relevant to relay protection and reliability.',
      'What shift summaries, incident reports, or procedures match this question?',
    ],
    general: [
      'Give me an operational health snapshot.',
      'What should I review first on this dashboard?',
    ],
  };

  function esc(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  let answerDetailsSequence = 0;

  function renderMarkdown(text) {
    const inline = value => esc(value)
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/(^|[\s(])\*([^*]+)\*(?=$|[\s).,!?:;])/g, '$1<em>$2</em>');
    const rows = String(text == null ? '' : text).replace(/\r/g, '').split('\n');
    const html = [];
    let paragraph = [];
    let list = '';
    const closeList = () => {
      if (list) html.push(`</${list}>`);
      list = '';
    };
    const flushParagraph = () => {
      if (paragraph.length) html.push(`<p>${inline(paragraph.join(' '))}</p>`);
      paragraph = [];
    };
    for (const row of rows) {
      const heading = row.match(/^\s{0,3}(#{1,3})\s+(.+)$/);
      const item = row.match(/^\s*(?:[-*+]\s+|\d+[.)]\s+)(.+)$/);
      if (!row.trim()) {
        flushParagraph();
        closeList();
      } else if (heading) {
        flushParagraph();
        closeList();
        const level = Math.min(4, heading[1].length + 1);
        html.push(`<h${level}>${inline(heading[2])}</h${level}>`);
      } else if (item) {
        flushParagraph();
        const nextList = /^\s*\d+[.)]\s+/.test(row) ? 'ol' : 'ul';
        if (list && list !== nextList) closeList();
        if (!list) {
          list = nextList;
          html.push(`<${list}>`);
        }
        html.push(`<li>${inline(item[1])}</li>`);
      } else {
        closeList();
        paragraph.push(row.trim());
      }
    }
    flushParagraph();
    closeList();
    return `<div class="ai-answer-content">${html.join('')}</div>`;
  }

  function renderAnswer(text, citations = [], meta = '', reviewLabel = 'Reviewed answer') {
    const raw = String(text == null ? '' : text).replace(/\r/g, '');
    const detailsMarker = /\n{2}\[MORE_DETAILS\]\s*\n/i;
    const markedDetails = raw.match(detailsMarker);
    let answerText = raw;
    let detailsText = '';
    if (markedDetails) {
      answerText = raw.slice(0, markedDetails.index).trim();
      detailsText = raw.slice(markedDetails.index + markedDetails[0].length).trim();
    } else {
      const paragraphBreak = raw.match(/\n\s*\n/);
      if (paragraphBreak) {
        answerText = raw.slice(0, paragraphBreak.index).trim();
        detailsText = raw.slice(paragraphBreak.index + paragraphBreak[0].length).trim();
      }
    }
    const answerHtml = renderMarkdown(answerText);
    if (!detailsText && !citations.length) {
      return `<div class="ai-reviewed-answer"><div class="ai-reviewed-label">${esc(reviewLabel)}</div>${answerHtml}${meta}</div>`;
    }
    const detailParts = [];
    if (detailsText) detailParts.push(renderMarkdown(detailsText));
    if (citations.length) {
      detailParts.push(`<div class="ai-assistant-citations"><strong>SOURCES</strong>${citations.map(citationMarkup).join('')}</div>`);
    }
    if (meta) detailParts.push(meta);
    const detailsId = `ai-answer-details-${++answerDetailsSequence}`;
    return `<div class="ai-reviewed-answer"><div class="ai-reviewed-label">${esc(reviewLabel)}</div>${answerHtml}<button class="ai-answer-more" type="button" data-ai-answer-toggle aria-expanded="false" aria-controls="${detailsId}">More details</button><div class="ai-answer-details" id="${detailsId}" hidden>${detailParts.join('')}</div></div>`;
  }

  function bindAnswerControls(root) {
    root?.querySelectorAll('[data-ai-answer-toggle]:not([data-bound])').forEach(button => {
      button.dataset.bound = '1';
      button.addEventListener('click', () => {
        const details = document.getElementById(button.getAttribute('aria-controls'));
        if (!details) return;
        const expanded = button.getAttribute('aria-expanded') !== 'true';
        button.setAttribute('aria-expanded', String(expanded));
        details.hidden = !expanded;
        button.textContent = expanded ? 'Hide details' : 'More details';
      });
    });
    root?.querySelectorAll('[data-ai-feedback]:not([data-bound])').forEach(button => {
      button.dataset.bound = '1';
      button.addEventListener('click', async () => {
        const messageId = button.getAttribute('data-message-id');
        const rating = button.getAttribute('data-ai-feedback');
        if (!messageId || !rating) return;
        const correction = rating === 'helpful'
          ? ''
          : String(window.prompt('Optional: what should NorthStar improve or correct?', '') || '').trim();
        const group = button.closest('.ai-answer-feedback');
        group?.querySelectorAll('button').forEach(item => { item.disabled = true; });
        try {
          const response = await fetch('/api/ai/messages/' + encodeURIComponent(messageId) + '/feedback', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ rating, correction }),
          });
          if (!response.ok) throw new Error('feedback could not be saved');
          if (group) group.innerHTML = '<span>Feedback recorded</span>';
        } catch (error) {
          group?.querySelectorAll('button').forEach(item => { item.disabled = false; });
          if (group) group.setAttribute('data-error', error.message);
        }
      });
    });
  }

  function setAssistantThinking(active) {
    window.dispatchEvent(new CustomEvent('northstar-ai-thinking', { detail: { active } }));
  }

  function activeSection() {
    return document.querySelector('.section.active')?.id || 'assistant';
  }

  function defaultScope(section = activeSection()) {
    return SECTION_SCOPES[section] || 'general';
  }

  function citationMarkup(item) {
    const label = item.title || item.id || item.source || 'Source';
    let link = '';
    try {
      const url = new URL(item.href, location.href);
      if (item.href && url.origin === location.origin) link = url.pathname + url.search + url.hash;
      else if (item.source_kind === 'web' && url.protocol === 'https:') link = url.href;
    } catch { /* invalid source link */ }
    const detail = [item.authorityStatus, item.revision && 'Rev ' + item.revision, item.page && 'Page ' + item.page, item.recorded_at].filter(Boolean).join(' · ');
    return `<div>${link ? `<a href="${esc(link)}" target="_blank" rel="noopener">${esc(label)}</a>` : esc(label)}${detail ? `<small>${esc(detail)}</small>` : ''}</div>`;
  }

  function savedModel() {
    try { return window.localStorage.getItem(MODEL_PREF_KEY) || ''; } catch { return ''; }
  }

  function savedReasoningEffort() {
    try { return window.localStorage.getItem(REASONING_PREF_KEY) || ''; } catch { return ''; }
  }

  function setSavedModel(model) {
    try { window.localStorage.setItem(MODEL_PREF_KEY, model); } catch { /* preference storage is optional */ }
    window.dispatchEvent(new CustomEvent('northstar-ai-model-change', { detail: { model } }));
  }

  function setSavedReasoningEffort(reasoningEffort) {
    try { window.localStorage.setItem(REASONING_PREF_KEY, reasoningEffort); } catch { /* preference storage is optional */ }
    window.dispatchEvent(new CustomEvent('northstar-ai-reasoning-change', { detail: { reasoningEffort } }));
  }

  function populateModelSelect(select, status, preferredModel = '') {
    if (!select) return '';
    const models = Array.isArray(status.models) ? status.models.map(String) : [];
    const engine = String(status.engine || '').toLowerCase();
    const selected = models.includes(preferredModel)
      ? preferredModel
      : (models.includes(status.defaultModel) ? status.defaultModel : (models[0] || ''));
    select.innerHTML = models.length
      ? models.map(model => `<option value="${esc(model)}">${esc(MODEL_LABELS[model] || model)}</option>`).join('')
      : '<option value="">No enabled models</option>';
    select.disabled = engine !== 'openai' || !models.length;
    if (selected) select.value = selected;
    return selected;
  }

  function populateReasoningSelect(select, status, model, preferredEffort = '') {
    if (!select) return '';
    const efforts = status.reasoningEfforts?.[model] || [];
    const engine = String(status.engine || '').toLowerCase();
    const selected = efforts.includes(preferredEffort)
      ? preferredEffort
      : (efforts.includes(status.defaultReasoningEffort) ? status.defaultReasoningEffort : (efforts[0] || ''));
    select.innerHTML = efforts.length
      ? efforts.map(effort => `<option value="${esc(effort)}">${esc(REASONING_LABELS[effort] || effort)}</option>`).join('')
      : '<option value="">Reasoning depth unavailable</option>';
    select.disabled = engine !== 'openai' || !efforts.length;
    if (selected) select.value = selected;
    return selected;
  }

  function eventFilterValue() {
    const active = document.querySelector('#eventFilters .events-filter.active');
    const query = document.querySelector('#eventQuery')?.value?.trim() || '';
    const filter = active?.dataset?.eventFilter || 'all';
    return [filter !== 'all' ? `category:${filter}` : '', query].filter(Boolean).join(' ');
  }

  class AssistantPanel {
    constructor(root, options = {}) {
      this.root = root;
      this.options = options;
      this.scope = options.scope || defaultScope(options.section);
      this.section = options.section || activeSection();
      this.model = savedModel();
      this.reasoningEffort = savedReasoningEffort();
      this.aiStatus = null;
      this.settingsSaveQueue = Promise.resolve();
      this.busy = false;
      this.requestController = null;
      this.requestGeneration = 0;
      this.conversationId = null;
      this.projectId = null;
      this.workspace = { account: '', projects: [], conversations: [] };
      this.render();
      this.bind();
      if (options.initialPrompt) {
        this.ask(options.initialPrompt);
      }
    }

    render() {
      const compact = Boolean(this.options.compact);
      this.root.innerHTML = compact
        ? `<div class="ai-assistant-inline">
            <div class="ai-assistant-inline-head">
              <strong>SECTION ASSISTANT · ${esc(this.section.toUpperCase())}</strong>
              <span class="ai-assistant-badge">RETRIEVED SUMMARY</span>
            </div>
            <div class="ai-assistant-log" data-ai-log></div>
            <div class="ai-assistant-compose">
              <input data-ai-input type="text" placeholder="Ask about this section…" aria-label="Ask the section assistant">
              <button type="button" data-ai-send>ASK</button>
            </div>
          </div>`
        : `<div class="ai-assistant-shell">
            <div class="ai-assistant-layout">
              <aside class="ai-assistant-sidebar">
                <button type="button" class="ai-assistant-new" data-ai-new>＋ New chat</button>
                <label class="ai-assistant-section-label">Chats</label>
                <div class="ai-assistant-history" data-ai-history></div>
                <details class="ai-assistant-sidebar-group"><summary>Projects</summary>
                <button type="button" class="ai-assistant-new-project" data-ai-new-project>＋ New project</button>
                <div class="ai-assistant-projects" data-ai-projects></div>
                </details>
                <details class="ai-assistant-sidebar-group"><summary>Archived chats</summary>
                <div class="ai-assistant-archived" data-ai-archived></div>
                </details>
              </aside>
              <section class="ai-assistant-panel">
                <div class="ai-assistant-conversation-head">
                  <div class="ai-assistant-conversation-title"><span data-ai-active-title>NEW CHAT</span><span data-ai-active-project></span></div>
                  <details class="ai-assistant-settings-drawer"><summary>Chat settings</summary><div class="ai-assistant-settings" aria-label="Chat settings">
                    <a class="ai-assistant-library-link" href="knowledge-library.html">Knowledge library</a><span class="ai-assistant-badge" data-ai-engine>Connecting</span>
                    <label>PLANT<select data-ai-site aria-label="Knowledge plant"><option value="">All permitted plants</option></select></label><label>SOURCES<select data-ai-reference aria-label="Source mode"><option value="current">Current sources and records</option><option value="reference">Reviewed reference only</option></select></label><label>MODEL<select class="ai-assistant-model-select" data-ai-model aria-label="Model"><option value="">Loading enabled models…</option></select></label>
                    <label>REASONING DEPTH<select class="ai-assistant-model-select" data-ai-effort aria-label="Reasoning depth"><option value="">Loading options…</option></select></label>
                  </div></details>
                </div>
                <div class="ai-assistant-log" data-ai-log>
                  <div class="ai-assistant-msg system">Ask about events, outages, market prices, or the operational snapshot.</div>
                </div>
                <div class="ai-assistant-compose">
                  <input data-ai-input type="text" placeholder="Ask AGENT…" aria-label="Ask AGENT">
                  <button type="button" data-ai-send>SEND</button>
                </div>
              </section>
            </div>
          </div>`;
      this.menuNode = this.root.querySelector('.ai-assistant-sidebar');
      this.logNode = this.root.querySelector('[data-ai-log]');
      this.inputNode = this.root.querySelector('[data-ai-input]');
      this.sendNode = this.root.querySelector('[data-ai-send]');
      if (!compact) {
        const shell = this.root.querySelector('.ai-assistant-shell');
        const fit = () => {
          if (!shell.getClientRects().length) return;
          const viewport = window.visualViewport;
          const bottom = viewport ? viewport.height + viewport.offsetTop : window.innerHeight;
          const height = Math.max(180, Math.min(640, bottom - Math.max(0, shell.getBoundingClientRect().top) - 18));
          shell.style.setProperty('--ai-workspace-height', `${Math.floor(height)}px`);
        };
        const scheduleFit = () => { cancelAnimationFrame(this.fitFrame); this.fitFrame = requestAnimationFrame(fit); };
        this.resizeObserver = new ResizeObserver(scheduleFit);
        this.resizeObserver.observe(this.root);
        this.resizeObserver.observe(document.body);
        window.addEventListener('resize', scheduleFit);
        window.addEventListener('scroll', scheduleFit, true);
        window.visualViewport?.addEventListener('resize', scheduleFit);
        scheduleFit();
      }
      this.renderScopes();
      this.renderWorkspace();
      this.loadStatus();
      fetch('/api/ai/knowledge').then(r => r.ok ? r.json() : Promise.reject()).then(data => {
        const select = this.root.querySelector('[data-ai-site]');
        if (select) select.innerHTML += (data.sites || []).map(site => `<option value="${esc(site.id)}">${esc(site.name)}</option>`).join('');
      }).catch(() => {});
      this.loadWorkspace();
    }

    bind() {
      this.menuNode?.addEventListener('click', event => {
        const button = event.target.closest?.('[data-ai-new]');
        if (!button || !this.menuNode.contains(button)) return;
        event.preventDefault();
        this.startNewChat();
      }, true);
      this.sendNode?.addEventListener('click', () => this.ask());
      this.inputNode?.addEventListener('keydown', event => {
        if (event.key === 'Enter') {
          event.preventDefault();
          this.ask();
        }
      });
      this.root.querySelector('[data-ai-scopes]')?.addEventListener('click', event => {
        const button = event.target.closest('button[data-scope]');
        if (!button) return;
        this.scope = button.dataset.scope || 'general';
        this.renderScopes();
      });
      this.root.querySelector('[data-ai-model]')?.addEventListener('change', event => {
        this.model = event.target.value;
        this.reasoningEffort = populateReasoningSelect(
          this.root.querySelector('[data-ai-effort]'), this.aiStatus || {}, this.model, this.reasoningEffort
        );
        setSavedModel(this.model);
        if (this.reasoningEffort) setSavedReasoningEffort(this.reasoningEffort);
        this.saveConversationSettings();
      });
      this.root.querySelector('[data-ai-effort]')?.addEventListener('change', event => {
        this.reasoningEffort = event.target.value;
        setSavedReasoningEffort(this.reasoningEffort);
        this.saveConversationSettings();
      });
      this.root.querySelector('[data-ai-new-project]')?.addEventListener('click', () => this.createProject());
      this.root.querySelector('[data-ai-history]')?.addEventListener('click', event => {
        const archive = event.target.closest('button[data-ai-archive]');
        if (archive) {
          this.setConversationArchived(archive.dataset.conversation, true);
          return;
        }
        const button = event.target.closest('button[data-conversation]');
        if (button) this.openConversation(button.dataset.conversation);
      });
      this.root.querySelector('[data-ai-archived]')?.addEventListener('click', event => {
        const restore = event.target.closest('button[data-ai-restore]');
        if (restore) this.setConversationArchived(restore.dataset.conversation, false);
      });
      this.root.querySelector('[data-ai-projects]')?.addEventListener('click', event => {
        const button = event.target.closest('button[data-project]');
        if (!button) return;
        this.projectId = button.dataset.project || null;
        this.renderWorkspace();
      });
    }

    renderScopes() {
      const node = this.menuNode?.querySelector('[data-ai-scopes]');
      if (!node) return;
      const scopes = ['dashboard', 'events', 'general', 'market', 'outages', 'logbook', 'site'];
      node.innerHTML = scopes.map(scope => `<button type="button" data-scope="${scope}" class="${scope === this.scope ? 'active' : ''}">${scope.toUpperCase()}</button>`).join('');
    }

    renderWorkspace() {
      const projectNode = this.menuNode?.querySelector('[data-ai-projects]');
      if (projectNode) {
        const buttons = this.workspace.projects.map(project => `<button type="button" data-project="${esc(project.id)}" class="${project.id === this.projectId ? 'active' : ''}">▣ ${esc(project.name)}</button>`);
        projectNode.innerHTML = buttons.join('');
      }
      const historyNode = this.menuNode?.querySelector('[data-ai-history]');
      if (historyNode) {
        const chats = this.workspace.conversations.filter(item => !item.archived && (!this.projectId || item.projectId === this.projectId));
        historyNode.innerHTML = chats.length
          ? chats.map(item => `<div class="ai-assistant-chat-row"><button type="button" data-conversation="${esc(item.id)}" title="${esc(item.title)}" class="ai-assistant-chat ${item.id === this.conversationId ? 'active' : ''}">${esc(item.title)}</button><button type="button" data-ai-archive data-conversation="${esc(item.id)}" class="ai-assistant-archive-action" aria-label="Archive ${esc(item.title)}" title="Archive chat">↓</button></div>`).join('')
          : '<div class="ai-assistant-history-empty">No saved chats yet.</div>';
      }
      const archivedNode = this.menuNode?.querySelector('[data-ai-archived]');
      if (archivedNode) {
        const archived = this.workspace.conversations.filter(item => item.archived);
        archivedNode.innerHTML = archived.length
          ? archived.map(item => `<div class="ai-assistant-chat-row"><button type="button" data-conversation="${esc(item.id)}" title="${esc(item.title)}" class="ai-assistant-chat">${esc(item.title)}</button><button type="button" data-ai-restore data-conversation="${esc(item.id)}" class="ai-assistant-archive-action" aria-label="Restore ${esc(item.title)}" title="Restore chat">↩</button></div>`).join('')
          : '<div class="ai-assistant-history-empty">No archived chats.</div>';
      }
      const activeTitle = this.root.querySelector('[data-ai-active-title]');
      const active = this.workspace.conversations.find(item => item.id === this.conversationId);
      if (activeTitle) {
        activeTitle.textContent = active?.title || 'New chat';
        activeTitle.title = activeTitle.textContent;
      }
      const activeProject = this.root.querySelector('[data-ai-active-project]');
      const project = this.workspace.projects.find(item => item.id === (active?.projectId || this.projectId));
      if (activeProject) activeProject.textContent = project ? `PROJECT · ${project.name}` : '';
    }

    async setConversationArchived(id, archived) {
      if (!id) return;
      const response = await fetch('/api/ai/conversations/' + encodeURIComponent(id) + '/archive', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ archived }),
      });
      if (!response.ok) return;
      if (archived && this.conversationId === id) {
        this.conversationId = null;
        this.logNode.innerHTML = '<div class="ai-assistant-msg system">Chat archived. Start a new chat or restore it from Archived Chats.</div>';
      }
      await this.loadWorkspace();
    }

    async loadWorkspace() {
      if (this.options.compact) return;
      try {
        const response = await fetch('/api/ai/workspace?ts=' + Date.now(), { cache: 'no-store' });
        if (!response.ok) throw new Error('workspace unavailable');
        this.workspace = await response.json();
        this.renderWorkspace();
      } catch {
        this.renderWorkspace();
      }
    }

    startNewChat() {
      window.NorthstarModules?.open?.('assistant:assistant');
      this.requestGeneration += 1;
      this.requestController?.abort();
      this.requestController = null;
      this.busy = false;
      setAssistantThinking(false);
      if (this.sendNode) this.sendNode.disabled = false;
      this.conversationId = null;
      this.model = savedModel() || this.aiStatus?.defaultModel || this.model;
      this.reasoningEffort = savedReasoningEffort() || this.aiStatus?.defaultReasoningEffort || 'medium';
      this.updateSettingsControls();
      this.logNode.innerHTML = '<div class="ai-assistant-msg system">New chat ready. Ask about operator-visible records; citations are required.</div>';
      this.renderWorkspace();
      this.inputNode?.focus();
    }

    async createProject() {
      const name = window.prompt('Project name');
      if (!name?.trim()) return;
      const response = await fetch('/api/ai/projects', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: name.trim() }),
      });
      if (!response.ok) return;
      const project = await response.json();
      this.projectId = project.id;
      await this.loadWorkspace();
    }

    async openConversation(id) {
      if (!id || this.busy) return;
      const response = await fetch('/api/ai/conversations/' + encodeURIComponent(id), { cache: 'no-store' });
      if (!response.ok) return;
      const conversation = await response.json();
      window.NorthstarModules?.open?.('assistant:assistant');
      this.conversationId = conversation.id;
      this.projectId = conversation.projectId || null;
      this.scope = conversation.scope || this.scope;
      const lastAssistant = [...(conversation.messages || [])].reverse().find(message => message.role === 'assistant');
      const plant = this.root.querySelector('[data-ai-site]');
      if (plant) plant.value = lastAssistant?.metadata?.siteId || '';
      const reference = this.root.querySelector('[data-ai-reference]');
      if (reference) reference.value = lastAssistant?.metadata?.referenceMode ? 'reference' : 'current';
      this.model = conversation.settings?.model || lastAssistant?.metadata?.model || lastAssistant?.metadata?.model_version || this.aiStatus?.defaultModel || savedModel();
      this.reasoningEffort = conversation.settings?.reasoningEffort || lastAssistant?.metadata?.reasoning_effort || this.aiStatus?.defaultReasoningEffort || savedReasoningEffort() || 'medium';
      this.updateSettingsControls();
      this.logNode.innerHTML = '';
      (conversation.messages || []).forEach(message => {
        if (message.role === 'assistant') this.appendAnswer({ answer: message.content, messageId: message.id, ...(message.metadata || {}) });
        else this.appendMessage(message.role, message.content);
      });
      this.renderScopes();
      this.renderWorkspace();
    }

    async loadStatus() {
      const badge = this.root.querySelector('[data-ai-engine]');
      if (!badge) return;
      try {
        const response = await fetch('/api/ai/status?ts=' + Date.now());
        if (!response.ok) throw new Error('status unavailable');
        const status = await response.json();
        this.aiStatus = status;
        const sourceCount = Number(status.knowledge?.totalRecords || 0);
        badge.innerHTML = `<i></i>${esc(String(status.engine || 'summary').toUpperCase())} · ${sourceCount || '—'} SOURCES`;
        this.updateSettingsControls();
      } catch {
        badge.innerHTML = '<i></i>UNAVAILABLE';
      }
    }

    updateSettingsControls() {
      if (!this.aiStatus) return;
      this.model = populateModelSelect(this.root.querySelector('[data-ai-model]'), this.aiStatus, this.model || savedModel());
      this.reasoningEffort = populateReasoningSelect(
        this.root.querySelector('[data-ai-effort]'), this.aiStatus, this.model,
        this.reasoningEffort || savedReasoningEffort()
      );
    }

    saveConversationSettings() {
      if (!this.conversationId || !this.model || !this.reasoningEffort) return;
      const conversationId = this.conversationId;
      const settings = { model: this.model, reasoningEffort: this.reasoningEffort };
      this.settingsSaveQueue = this.settingsSaveQueue.catch(() => {}).then(() => fetch(
        '/api/ai/conversations/' + encodeURIComponent(conversationId) + '/settings',
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(settings) }
      )).then(response => {
        if (!response.ok) throw new Error('settings could not be saved');
      }).catch(() => {});
    }

    appendMessage(kind, text, meta = '', formatted = false, citations = [], reviewLabel = 'Reviewed answer') {
      if (!this.logNode) return;
      this.logNode.insertAdjacentHTML(
        'beforeend',
        `<div class="ai-assistant-msg ${kind}">${formatted ? renderAnswer(text, citations, meta, reviewLabel) : esc(text)}${formatted ? '' : meta}</div>`
      );
      bindAnswerControls(this.logNode);
      this.logNode.scrollTop = this.logNode.scrollHeight;
    }

  appendAnswer(payload) {
      const citations = Array.isArray(payload.citations) ? payload.citations : [];
      const feedback = payload.messageId
        ? `<div class="ai-answer-feedback" aria-label="Rate this answer"><span>Was this useful?</span><button type="button" data-ai-feedback="helpful" data-message-id="${esc(payload.messageId)}">Helpful</button><button type="button" data-ai-feedback="incorrect" data-message-id="${esc(payload.messageId)}">Incorrect</button><button type="button" data-ai-feedback="missing_source" data-message-id="${esc(payload.messageId)}">Missing source</button><button type="button" data-ai-feedback="stale_source" data-message-id="${esc(payload.messageId)}">Stale source</button><button type="button" data-ai-feedback="unsafe" data-message-id="${esc(payload.messageId)}">Unsafe</button></div>`
        : '';
      const meta = `<div class="ai-assistant-meta"><span>${esc(payload.label || 'Assistant')}</span><span>${esc(payload.uncertainty || 'unknown').toUpperCase()}</span><span>${esc(payload.model_version || 'engine')}</span></div>${feedback}`;
      const reviewLabel = payload.label === 'Model-assisted synthesis'
        ? 'Reviewed answer'
        : (payload.label || 'AI answer');
      this.appendMessage('assistant', payload.answer || 'No response.', meta, true, citations, reviewLabel);
    }

    async ask(prompt = '') {
      const question = String(prompt || this.inputNode?.value || '').trim();
      if (!question || this.busy) return;
      if (!this.options.compact) window.NorthstarModules?.open?.('assistant:assistant');
      const generation = ++this.requestGeneration;
      const controller = new AbortController();
      this.requestController = controller;
      this.busy = true;
      setAssistantThinking(true);
      if (this.sendNode) this.sendNode.disabled = true;
      this.appendMessage('user', question);
      if (this.inputNode) this.inputNode.value = '';
      try {
        const response = await fetch('/api/ai/query', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            question,
            conversationId: this.conversationId,
            projectId: this.projectId,
            context_scope: this.scope,
            siteId: this.root.querySelector('[data-ai-site]')?.value || '',
            referenceMode: this.root.querySelector('[data-ai-reference]')?.value === 'reference',
            section: this.section,
            model: this.model,
            reasoning_effort: this.reasoningEffort,
            event_filter: this.scope === 'events' ? eventFilterValue() : '',
            response_profile: 'balanced',
          }),
          signal: controller.signal,
        });
        const payload = await response.json();
        if (generation !== this.requestGeneration) return;
        this.conversationId = payload.conversationId || this.conversationId;
        if (!response.ok) {
          const detail = payload.detail || payload.error || 'Assistant unavailable';
          this.appendMessage('system', detail);
          if (this.conversationId) await this.loadWorkspace();
          return;
        }
        this.appendAnswer(payload);
        window.dispatchEvent(new CustomEvent('northstar-ai-answer'));
        await this.loadWorkspace();
      } catch (error) {
        if (generation === this.requestGeneration && error.name !== 'AbortError') {
          this.appendMessage('system', 'Assistant request failed: ' + error.message);
        }
      } finally {
        if (generation === this.requestGeneration) {
          this.busy = false;
          this.requestController = null;
          setAssistantThinking(false);
          if (this.sendNode) this.sendNode.disabled = false;
        }
      }
    }
  }

  function mountAssistantTab() {
    const section = document.querySelector('#assistant');
    if (!section || section.dataset.aiMounted === '1') return;
    section.dataset.aiMounted = '1';
    section.innerHTML = '<div id="assistantWorkspace"></div>';
    new AssistantPanel(document.querySelector('#assistantWorkspace'), { section: 'assistant' });
  }

  function mountEventsAssistant() {
    const card = document.querySelector('#eventsCard');
    if (!card || card.querySelector('[data-events-assistant]')) return;
    const host = document.createElement('div');
    host.dataset.eventsAssistant = '1';
    host.className = 'ai-assistant-inline-host';
    const stream = card.querySelector('.events-stream');
    if (stream) {
      stream.insertAdjacentElement('afterend', host);
    } else {
      card.append(host);
    }
    const head = card.querySelector('.events-head');
    if (head && !head.querySelector('[data-open-events-assistant]')) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'ai-assistant-launcher';
      button.dataset.openEventsAssistant = '1';
      button.textContent = 'ASK AI';
      head.append(button);
      button.addEventListener('click', () => {
        host.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        host.querySelector('[data-ai-input]')?.focus();
      });
    }
    new AssistantPanel(host, { compact: true, section: 'events', scope: 'events' });
  }

  function openDialog(prompt = '', section = activeSection()) {
    const dialog = document.querySelector('#aiDialog');
    if (!dialog) return;
    dialog.showModal();
    const statusNode = dialog.querySelector('#aiDialogStatus');
    if (statusNode) {
      statusNode.textContent = 'CHECKING CONNECTION…';
      fetch('/api/ai/status?ts=' + Date.now())
        .then(response => response.ok ? response.json() : Promise.reject(response.status))
        .then(status => {
          dialog.aiStatus = status;
          populateModelSelect(dialog.querySelector('#aiModel'), status, savedModel());
          const model = dialog.querySelector('#aiModel')?.value || status.defaultModel;
          populateReasoningSelect(dialog.querySelector('#aiEffort'), status, model, savedReasoningEffort());
          const engine = String(status.engine || 'none').toUpperCase();
          const sourceCount = Number(status.knowledge?.totalRecords || 0);
          statusNode.textContent = engine === 'NONE' ? 'AI DISABLED' : `${engine} · ACTIVE · ${sourceCount || '—'} SOURCES`;
        })
        .catch(status => {
          statusNode.textContent = Number(status) === 401 || Number(status) === 403
            ? 'SIGN IN REQUIRED'
            : 'AI UNAVAILABLE';
        });
    }
    if (!dialog.dataset.aiBound) {
      dialog.dataset.aiBound = '1';
      const log = dialog.querySelector('#chatLog');
      const input = dialog.querySelector('#chatInput');
      const send = dialog.querySelector('#chatSend');
      const state = {
        scope: defaultScope(section),
        section,
        busy: false,
      };
      const append = (kind, text, meta = '', formatted = false, citations = [], reviewLabel = 'Reviewed answer') => {
        log.insertAdjacentHTML('beforeend', `<div class="chat-msg ${kind}">${formatted ? renderAnswer(text, citations, meta, reviewLabel) : esc(text) + meta}</div>`);
        bindAnswerControls(log);
        log.scrollTop = log.scrollHeight;
      };
      const ask = async (questionText = '') => {
        const question = String(questionText || input.value || '').trim();
        if (!question || state.busy) return;
        state.busy = true;
        setAssistantThinking(true);
        send.disabled = true;
        append('user', question);
        input.value = '';
        try {
          const response = await fetch('/api/ai/query', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              question,
              context_scope: state.scope,
              section: state.section,
              event_filter: state.scope === 'events' ? eventFilterValue() : '',
              model: dialog.querySelector('#aiModel')?.value || '',
              reasoning_effort: dialog.querySelector('#aiEffort')?.value || 'medium',
              response_profile: 'balanced',
            }),
          });
          const payload = await response.json();
          if (!response.ok) {
            append('system', payload.detail || payload.error || 'Assistant unavailable');
            return;
          }
          const meta = `<div class="ai-assistant-meta"><span>${esc(payload.label || 'Assistant')}</span><span>${esc(payload.uncertainty || 'unknown').toUpperCase()}</span></div>` +
            (payload.model_version ? `<div class="ai-assistant-meta"><span>${esc(payload.model_version)}</span></div>` : '');
          const reviewLabel = payload.label === 'Model-assisted synthesis'
            ? 'Reviewed answer'
            : (payload.label || 'AI answer');
          append('assistant', payload.answer || 'No response.', meta, true, Array.isArray(payload.citations) ? payload.citations : [], reviewLabel);
          window.dispatchEvent(new CustomEvent('northstar-ai-answer'));
        } catch (error) {
          append('system', 'Assistant request failed: ' + error.message);
        } finally {
          state.busy = false;
          setAssistantThinking(false);
          send.disabled = false;
        }
      };
      send.onclick = () => ask();
      input.onkeydown = event => {
        if (event.key === 'Enter') {
          event.preventDefault();
          ask();
        }
      };
      dialog.querySelector('#aiModel')?.addEventListener('change', event => {
        setSavedModel(event.target.value);
        const effort = populateReasoningSelect(
          dialog.querySelector('#aiEffort'), dialog.aiStatus || {}, event.target.value, savedReasoningEffort()
        );
        if (effort) setSavedReasoningEffort(effort);
      });
      dialog.querySelector('#aiEffort')?.addEventListener('change', event => setSavedReasoningEffort(event.target.value));
      window.addEventListener('northstar-ai-model-change', event => {
        const select = dialog.querySelector('#aiModel');
        if (select && [...select.options].some(option => option.value === event.detail?.model)) {
          select.value = event.detail.model;
          const effort = populateReasoningSelect(
            dialog.querySelector('#aiEffort'), dialog.aiStatus || {}, select.value, savedReasoningEffort()
          );
          if (effort) setSavedReasoningEffort(effort);
        }
      });
      window.addEventListener('northstar-ai-reasoning-change', event => {
        const select = dialog.querySelector('#aiEffort');
        if (select && [...select.options].some(option => option.value === event.detail?.reasoningEffort)) {
          select.value = event.detail.reasoningEffort;
        }
      });
      window.NorthStarAI = window.NorthStarAI || {};
      window.NorthStarAI.dialogAsk = ask;
      window.NorthStarAI.setDialogContext = (nextSection = activeSection()) => {
        state.section = nextSection;
        state.scope = defaultScope(nextSection);
      };
    }
    window.NorthStarAI?.setDialogContext?.(section);
    if (prompt) {
      window.NorthStarAI?.dialogAsk?.(prompt);
    } else {
      dialog.querySelector('#chatInput')?.focus();
    }
  }

  function bindSectionLaunchers() {
    document.querySelectorAll('[data-tab]').forEach(tab => {
      tab.addEventListener('click', () => {
        const section = tab.dataset.tab;
        if (section === 'assistant') mountAssistantTab();
        if (section === 'overview' || section === 'events') {
          setTimeout(mountEventsAssistant, 0);
        }
      });
    });
  }

  window.NorthStarAI = {
    open(prompt = '', section = activeSection()) {
      openDialog(prompt, section);
    },
    ask(question, options = {}) {
      const scope = options.scope || defaultScope(options.section || activeSection());
      setAssistantThinking(true);
      return fetch('/api/ai/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question,
          context_scope: scope,
          section: options.section || activeSection(),
          event_filter: options.eventFilter || '',
        }),
      }).then(response => response.json().then(body => ({ ok: response.ok, body }))).finally(() => setAssistantThinking(false));
    },
    defaultScope,
    mountEventsAssistant,
  };

  document.addEventListener('DOMContentLoaded', () => {
    document.addEventListener('click', event => {
      const tab = event.target.closest('[data-tab]');
      if (tab) document.body.classList.toggle('ai-workspace-open', tab.dataset.tab === 'assistant');
    });
    mountAssistantTab();
    mountEventsAssistant();
    bindSectionLaunchers();
    window.openAI = (prompt = '') => openDialog(prompt, activeSection());
  });
})();
