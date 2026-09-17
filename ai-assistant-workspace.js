(() => {
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

  function setAssistantThinking(active) {
    window.dispatchEvent(new CustomEvent('northstar-ai-thinking', { detail: { active } }));
  }

  function activeSection() {
    return document.querySelector('.section.active')?.id || 'assistant';
  }

  function defaultScope(section = activeSection()) {
    return SECTION_SCOPES[section] || 'general';
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
      this.busy = false;
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
            <div class="ai-assistant-banner">
              <div>
                <label>OPERATIONS ASSISTANT</label>
                <h2>NorthStar AI</h2>
                <p class="muted-note">Section-aware answers from operator-visible records. Citations are required; nothing is invented.</p>
              </div>
              <span class="ai-assistant-badge" data-ai-engine>LOADING</span>
            </div>
            <div class="ai-assistant-layout">
              <aside class="ai-assistant-sidebar">
                <label>CONTEXT SCOPE</label>
                <div class="ai-assistant-scope" data-ai-scopes></div>
                <label>SUGGESTED PROMPTS</label>
                <div class="ai-assistant-prompts" data-ai-prompts></div>
              </aside>
              <section class="ai-assistant-panel">
                <div class="ai-assistant-log" data-ai-log>
                  <div class="ai-assistant-msg system">Ask about events, outages, market prices, or the operational snapshot. Answers stay within the selected scope.</div>
                </div>
                <div class="ai-assistant-compose">
                  <input data-ai-input type="text" placeholder="Ask NorthStar AI…" aria-label="Ask NorthStar AI">
                  <button type="button" data-ai-send>SEND</button>
                </div>
              </section>
            </div>
          </div>`;
      this.logNode = this.root.querySelector('[data-ai-log]');
      this.inputNode = this.root.querySelector('[data-ai-input]');
      this.sendNode = this.root.querySelector('[data-ai-send]');
      this.renderScopes();
      this.renderPrompts();
      this.loadStatus();
    }

    bind() {
      this.sendNode?.addEventListener('click', () => this.ask());
      this.inputNode?.addEventListener('keydown', event => {
        if (event.key === 'Enter') {
          event.preventDefault();
          this.ask();
        }
      });
      this.root.querySelector('[data-ai-prompts]')?.addEventListener('click', event => {
        const button = event.target.closest('button[data-prompt]');
        if (!button) return;
        this.ask(button.dataset.prompt || '');
      });
      this.root.querySelector('[data-ai-scopes]')?.addEventListener('click', event => {
        const button = event.target.closest('button[data-scope]');
        if (!button) return;
        this.scope = button.dataset.scope || 'general';
        this.renderScopes();
        this.renderPrompts();
      });
    }

    renderScopes() {
      const node = this.root.querySelector('[data-ai-scopes]');
      if (!node) return;
      const scopes = ['dashboard', 'events', 'general', 'market', 'outages', 'logbook', 'site'];
      node.innerHTML = scopes.map(scope => `<button type="button" data-scope="${scope}" class="${scope === this.scope ? 'active' : ''}">${scope.toUpperCase()}</button>`).join('');
    }

    renderPrompts() {
      const node = this.root.querySelector('[data-ai-prompts]');
      if (!node) return;
      const prompts = PROMPTS[this.scope] || PROMPTS.general;
      node.innerHTML = prompts.map(prompt => `<button type="button" data-prompt="${esc(prompt)}">${esc(prompt)}</button>`).join('');
    }

    async loadStatus() {
      const badge = this.root.querySelector('[data-ai-engine]');
      if (!badge) return;
      try {
        const response = await fetch('/api/ai/status?ts=' + Date.now());
        if (!response.ok) throw new Error('status unavailable');
        const status = await response.json();
        const sourceCount = Number(status.knowledge?.totalRecords || 0);
        badge.textContent = `${String(status.engine || 'summary').toUpperCase()} · ${sourceCount || '—'} SOURCES`;
      } catch {
        badge.textContent = 'UNAVAILABLE';
      }
    }

    appendMessage(kind, text, meta = '') {
      if (!this.logNode) return;
      this.logNode.insertAdjacentHTML(
        'beforeend',
        `<div class="ai-assistant-msg ${kind}">${esc(text)}${meta}</div>`
      );
      this.logNode.scrollTop = this.logNode.scrollHeight;
    }

  appendAnswer(payload) {
      const citations = Array.isArray(payload.citations) ? payload.citations : [];
      const citationHtml = citations.length
        ? `<div class="ai-assistant-citations"><strong>CITATIONS</strong>${citations.slice(0, 6).map(item => `<div>${esc(item.id || item.source || 'source')}</div>`).join('')}</div>`
        : '';
      const meta = `<div class="ai-assistant-meta"><span>${esc(payload.label || 'Assistant')}</span><span>${esc(payload.uncertainty || 'unknown').toUpperCase()}</span><span>${esc(payload.model_version || 'engine')}</span></div>${citationHtml}`;
      this.appendMessage('assistant', payload.answer || 'No response.', meta);
    }

    async ask(prompt = '') {
      const question = String(prompt || this.inputNode?.value || '').trim();
      if (!question || this.busy) return;
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
            context_scope: this.scope,
            section: this.section,
            event_filter: this.scope === 'events' ? eventFilterValue() : '',
            response_profile: 'balanced',
          }),
        });
        const payload = await response.json();
        if (!response.ok) {
          const detail = payload.detail || payload.error || 'Assistant unavailable';
          this.appendMessage('system', detail);
          return;
        }
        this.appendAnswer(payload);
      } catch (error) {
        this.appendMessage('system', 'Assistant request failed: ' + error.message);
      } finally {
        this.busy = false;
        setAssistantThinking(false);
        if (this.sendNode) this.sendNode.disabled = false;
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
      const append = (kind, text, meta = '') => {
        log.insertAdjacentHTML('beforeend', `<div class="chat-msg ${kind}">${esc(text)}${meta}</div>`);
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
              response_profile: dialog.querySelector('#aiSpeed')?.value || 'balanced',
            }),
          });
          const payload = await response.json();
          if (!response.ok) {
            append('system', payload.detail || payload.error || 'Assistant unavailable');
            return;
          }
          const citations = Array.isArray(payload.citations) ? payload.citations : [];
          const meta = `<div class="ai-assistant-meta"><span>${esc(payload.label || 'Assistant')}</span><span>${esc(payload.uncertainty || 'unknown').toUpperCase()}</span></div>` +
            (citations.length ? `<div class="ai-assistant-citations"><strong>CITATIONS</strong>${citations.slice(0, 4).map(item => `<div>${esc(item.id || item.source || 'source')}</div>`).join('')}</div>` : '');
          append('assistant', payload.answer || 'No response.', meta);
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
    mountAssistantTab();
    mountEventsAssistant();
    bindSectionLaunchers();
    window.openAI = (prompt = '') => openDialog(prompt, activeSection());
  });
})();
