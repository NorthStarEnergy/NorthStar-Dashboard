(() => {
  const ROOMS = [
    { id: 'general', label: 'General' },
    { id: 'operations', label: 'Operations' },
    { id: 'field', label: 'Field' },
    { id: 'contractors', label: 'Contractors' },
    { id: 'management', label: 'Management' },
  ];

  const state = {
    roomId: 'general',
    messages: [],
    since: '',
    status: null,
    timer: null,
    posting: false,
  };

  function esc(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function formatTime(iso) {
    if (!iso) return '';
    try {
      return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    } catch {
      return iso;
    }
  }

  function ensureCard() {
    const root = document.querySelector('#overviewModules');
    if (!root || document.querySelector('#overviewChat')) return document.querySelector('#overviewChat');
    const card = document.createElement('section');
    card.className = 'panel chat-panel';
    card.id = 'overviewChat';
    card.dataset.overviewModule = '';
    card.dataset.moduleId = 'overview-chat';
    card.innerHTML = `
      <div class="chat-shell">
        <div class="chat-head">
          <div>
            <label>OPERATOR LIVE CHAT · SOURCE-TAGGED</label>
            <h2>Control Room Chat</h2>
          </div>
          <div class="chat-head-actions">
            <span class="chat-bridge-status" id="chatBridgeStatus">TEAMS OFF</span>
            <button type="button" id="chatPullTeams" title="Pull Teams messages into this room feed">PULL TEAMS</button>
          </div>
        </div>
        <div class="chat-rooms" id="chatRooms" role="tablist" aria-label="Chat rooms"></div>
        <div class="chat-messages" id="chatMessages" aria-live="polite"></div>
        <form class="chat-compose" id="chatCompose">
          <textarea id="chatInput" maxlength="4000" placeholder="Message this room…" required></textarea>
          <div class="chat-compose-actions">
            <label><input type="checkbox" id="chatPostToTeams"> Also post to Teams</label>
            <button class="primary" type="submit">SEND</button>
          </div>
        </form>
      </div>`;
    const staff = document.querySelector('#overviewStaff');
    if (staff) root.insertBefore(card, staff);
    else root.appendChild(card);
    return card;
  }

  function renderRooms() {
    const host = document.querySelector('#chatRooms');
    if (!host) return;
    host.innerHTML = ROOMS.map((room) => (
      `<button type="button" role="tab" data-room="${room.id}" class="${room.id === state.roomId ? 'active' : ''}" aria-selected="${room.id === state.roomId}">${esc(room.label)}</button>`
    )).join('');
  }

  function renderMessages() {
    const host = document.querySelector('#chatMessages');
    if (!host) return;
    if (!state.messages.length) {
      host.innerHTML = '<div class="chat-empty">No messages in this room yet. Posts from NorthStar and Teams appear here with source tags.</div>';
      return;
    }
    host.innerHTML = state.messages.map((message) => `
      <article class="chat-message" data-message-id="${esc(message.id)}">
        <div class="chat-message-meta">
          <span class="chat-source ${esc(message.source)}">${esc(message.source)}</span>
          <span class="chat-author">${esc(message.author)}</span>
          <span>${esc(formatTime(message.createdAt))}</span>
        </div>
        <div class="chat-body">${esc(message.body)}</div>
      </article>`).join('');
    host.scrollTop = host.scrollHeight;
  }

  function renderBridgeStatus() {
    const el = document.querySelector('#chatBridgeStatus');
    if (!el || !state.status) return;
    const mode = state.status.teams?.mode || 'off';
    el.className = `chat-bridge-status ${mode}`;
    if (mode === 'live') {
      el.textContent = state.status.teams.canPull || state.status.teams.canPost
        ? 'TEAMS LIVE'
        : 'TEAMS LIVE · NEEDS URL';
    } else if (mode === 'shadow') {
      el.textContent = 'TEAMS SHADOW';
    } else {
      el.textContent = 'TEAMS OFF';
    }
  }

  async function api(path, options = {}) {
    const response = await fetch(path, {
      cache: 'no-store',
      headers: options.body ? { 'Content-Type': 'application/json' } : undefined,
      ...options,
    });
    const text = await response.text();
    let body = null;
    try { body = text ? JSON.parse(text) : null; } catch { body = { error: text }; }
    if (!response.ok) {
      throw new Error(body?.error || `HTTP ${response.status}`);
    }
    return body;
  }

  async function loadStatus() {
    try {
      state.status = await api('/api/chat/status');
      renderBridgeStatus();
    } catch {
      /* gate or offline — leave prior status */
    }
  }

  async function loadMessages({ incremental = false } = {}) {
    const query = new URLSearchParams({ room: state.roomId, limit: '150' });
    if (incremental && state.since) query.set('since', state.since);
    try {
      const payload = await api(`/api/chat/messages?${query}`);
      const next = payload.messages || [];
      if (incremental && state.since) {
        if (next.length) {
          const seen = new Set(state.messages.map((item) => item.id));
          for (const message of next) {
            if (!seen.has(message.id)) state.messages.push(message);
          }
        }
      } else {
        state.messages = next;
      }
      if (state.messages.length) {
        state.since = state.messages[state.messages.length - 1].createdAt;
      }
      renderMessages();
    } catch (error) {
      const host = document.querySelector('#chatMessages');
      if (host && !state.messages.length) {
        host.innerHTML = `<div class="chat-empty">${esc(error.message || 'Chat unavailable')}</div>`;
      }
    }
  }

  async function sendMessage(event) {
    event.preventDefault();
    if (state.posting) return;
    const input = document.querySelector('#chatInput');
    const postToTeams = document.querySelector('#chatPostToTeams')?.checked;
    const body = input?.value?.trim() || '';
    if (!body) return;
    state.posting = true;
    try {
      const created = await api('/api/chat/messages', {
        method: 'POST',
        body: JSON.stringify({
          room: state.roomId,
          body,
          postToTeams: Boolean(postToTeams),
        }),
      });
      state.messages.push(created);
      state.since = created.createdAt;
      if (input) input.value = '';
      renderMessages();
    } catch (error) {
      window.alert(`Chat send failed: ${error.message}`);
    } finally {
      state.posting = false;
    }
  }

  async function pullTeams() {
    try {
      const result = await api('/api/chat/teams/pull', { method: 'POST', body: '{}' });
      if (result.status === 'disabled' || result.status === 'shadow' || result.status === 'misconfigured') {
        window.alert(result.detail || `Teams pull status: ${result.status}`);
      }
      await loadMessages();
      await loadStatus();
    } catch (error) {
      window.alert(`Teams pull failed: ${error.message}`);
    }
  }

  function bind() {
    document.querySelector('#chatRooms')?.addEventListener('click', async (event) => {
      const button = event.target.closest('[data-room]');
      if (!button) return;
      state.roomId = button.dataset.room;
      state.messages = [];
      state.since = '';
      renderRooms();
      renderMessages();
      await loadMessages();
    });
    document.querySelector('#chatCompose')?.addEventListener('submit', sendMessage);
    document.querySelector('#chatPullTeams')?.addEventListener('click', pullTeams);
    document.querySelector('#chatInput')?.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        document.querySelector('#chatCompose')?.requestSubmit();
      }
    });
  }

  function startPolling() {
    if (state.timer) window.clearInterval(state.timer);
    state.timer = window.setInterval(() => {
      if (document.hidden) return;
      loadMessages({ incremental: true });
    }, 4000);
  }

  async function init() {
    ensureCard();
    renderRooms();
    renderMessages();
    bind();
    await loadStatus();
    await loadMessages();
    startPolling();
  }

  window.NorthStarChat = { init, loadMessages, state };
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
