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
    requestId: 0,
    rendered: '',
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
      return window.NorthstarIesoTime
        ? NorthstarIesoTime.clock(iso, true)
        : new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23', timeZone: 'America/Toronto' });
    } catch {
      return iso;
    }
  }

  function ensureCard() {
    const root = document.querySelector('#tools');
    if (!root || document.querySelector('#overviewChat')) return document.querySelector('#overviewChat');
    const card = document.createElement('section');
    card.className = 'panel chat-panel';
    card.id = 'overviewChat';
    card.dataset.moduleId = 'overview-chat';
    card.innerHTML = `
      <div class="chat-shell">
        <div class="chat-head">
          <div>
            <label>TEAM CONVERSATION</label>
            <h2>NorthStar Chat</h2>
          </div>
          <div class="chat-head-actions">
            <button type="button" class="ns-avatar-profile-button" data-ns-avatar-picker aria-label="Choose your NorthStar avatar"><img data-ns-own-avatar src="/assets/avatars/classic/classic-00.png" width="34" height="23" alt=""><span>Avatar</span></button>
            <span class="chat-bridge-status" id="chatBridgeStatus">TEAMS OFF</span>
            <button type="button" id="chatPullTeams" title="Pull Teams messages into this room feed">PULL TEAMS</button>
          </div>
        </div>
        <div class="chat-rooms" id="chatRooms" role="tablist" aria-label="Chat rooms"></div>
        <div class="chat-messages" id="chatMessages" role="log" aria-label="Room messages" aria-live="polite" aria-relevant="additions"></div>
        <button type="button" id="chatNewMessages" hidden>New messages ↓</button>
        <p id="chatFeedback" class="chat-feedback" role="status" aria-live="polite"></p>
        <form class="chat-compose" id="chatCompose">
          <textarea id="operatorChatInput" aria-label="Message this room" maxlength="4000" placeholder="Message this room…" required></textarea>
          <div class="chat-compose-actions">
            <label><input type="checkbox" id="chatPostToTeams"> Also post to Teams</label>
            <button class="primary" type="submit">SEND</button>
          </div>
        </form>
      </div>`;
    root.appendChild(card);
    return card;
  }

  function renderRooms() {
    const host = document.querySelector('#chatRooms');
    if (!host) return;
    host.innerHTML = ROOMS.map((room) => (
      `<button type="button" role="tab" data-room="${room.id}" class="${room.id === state.roomId ? 'active' : ''}" aria-selected="${room.id === state.roomId}">${esc(room.label)}</button>`
    )).join('');
  }

  function renderMessages({ forceScroll = false } = {}) {
    const host = document.querySelector('#chatMessages');
    if (!host) return;
    const signature = JSON.stringify([state.roomId, state.messages]);
    if (signature === state.rendered && !forceScroll) return;
    const atBottom = host.scrollHeight - host.scrollTop - host.clientHeight < 60;
    const top = host.scrollTop;
    state.rendered = signature;
    if (!state.messages.length) {
      host.innerHTML = '<div class="chat-empty">Start the conversation. Messages are shared across NorthStar.</div>';
      document.querySelector('#chatNewMessages').hidden = true;
      return;
    }
    let priorDay = '';
    host.innerHTML = state.messages.map((message) => {
      const date = new Date(message.createdAt);
      const day = Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString(undefined, {year:'numeric',month:'short',day:'numeric',timeZone:'America/Toronto'});
      const divider = day && day !== priorDay ? `<div class="chat-day">${esc(day)}</div>` : '';
      priorDay = day;
      const image = window.NorthStarAvatars?.url(message.avatarId) || '/assets/avatars/classic/classic-00.png';
      const source = ['northstar','teams','system'].includes(message.source) ? message.source : 'system';
      return `${divider}<article class="chat-message" data-message-id="${esc(message.id)}">
        <img class="ns-chat-avatar" src="${image}" width="34" height="23" alt="">
        <div class="chat-message-content">
        <div class="chat-message-meta">
          <span class="chat-author">${esc(message.author)}</span>
          <time datetime="${esc(message.createdAt)}" title="${esc(day)}">${esc(formatTime(message.createdAt))}</time>
          <span class="chat-source ${source}">${esc(source)}</span>
        </div>
        <div class="chat-body">${esc(message.body)}</div>
        </div></article>`;
    }).join('');
    if (atBottom || forceScroll) { host.scrollTop = host.scrollHeight; document.querySelector('#chatNewMessages').hidden = true; }
    else { host.scrollTop = top; document.querySelector('#chatNewMessages').hidden = false; }
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

  async function loadMessages({ forceScroll = false } = {}) {
    const roomId = state.roomId, requestId = ++state.requestId;
    const query = new URLSearchParams({ room: roomId, limit: '150' });
    try {
      const payload = await api(`/api/chat/messages?${query}`);
      if (roomId !== state.roomId || requestId !== state.requestId) return;
      state.messages = payload.messages || [];
      renderMessages({forceScroll});
    } catch (error) {
      if (roomId !== state.roomId || requestId !== state.requestId) return;
      const host = document.querySelector('#chatMessages');
      if (host && !state.messages.length) {
        host.innerHTML = `<div class="chat-empty">${esc(error.message || 'Chat unavailable')}</div>`;
      }
    }
  }

  async function sendMessage(event) {
    event.preventDefault();
    if (state.posting) return;
    const input = document.querySelector('#operatorChatInput');
    const postToTeams = document.querySelector('#chatPostToTeams')?.checked;
    const body = input?.value?.trim() || '';
    if (!body) return;
    state.posting = true;
    const roomId = state.roomId;
    const submit = document.querySelector('#chatCompose button[type=submit]');
    submit.disabled = true;
    document.querySelector('#chatFeedback').textContent = 'Sending…';
    try {
      const created = await api('/api/chat/messages', {
        method: 'POST',
        body: JSON.stringify({
          room: roomId,
          body,
          postToTeams: Boolean(postToTeams),
        }),
      });
      if (input && input.value.trim() === body) input.value = '';
      document.querySelector('#chatFeedback').textContent = '';
      await loadMessages({forceScroll: roomId === state.roomId});
    } catch (error) {
      document.querySelector('#chatFeedback').textContent = `Message not sent: ${error.message}. Your draft is still here.`;
    } finally {
      state.posting = false;
      submit.disabled = false;
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
    document.querySelector('#chatNewMessages')?.addEventListener('click', () => renderMessages({forceScroll:true}));
    window.addEventListener('northstar:avatar-change', () => loadMessages());
    document.querySelector('#chatPullTeams')?.addEventListener('click', pullTeams);
    document.querySelector('#operatorChatInput')?.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
        event.preventDefault();
        document.querySelector('#chatCompose')?.requestSubmit();
      }
    });
  }

  function startPolling() {
    if (state.timer) window.clearInterval(state.timer);
    state.timer = window.setInterval(() => {
      if (document.hidden) return;
      loadMessages();
      window.NorthStarAvatars?.refresh().catch(() => {});
    }, 4000);
  }

  async function init() {
    if (document.querySelector('#overviewChat')) return;
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
