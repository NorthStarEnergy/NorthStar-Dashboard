/* Shared, session-local alarm interactions for dashboard and module windows. */
(() => {
  'use strict';

  const STORE = 'northstarAlarmInteractionStateV1';
  const CHANNEL = 'northstar-alarm-interactions';
  const CLICK_DELAY = 240;
  const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const text = item => item?.payload?.details || item?.payload?.detail || item?.payload?.text || item?.description || item?.message || 'No additional details supplied.';
  const stamp = value => {
    const date = value && new Date(value);
    return date && !Number.isNaN(date.valueOf()) ? date.toLocaleString('en-CA', {timeZone:'America/Toronto', year:'numeric', month:'short', day:'2-digit', hour:'2-digit', minute:'2-digit'}) + ' ET' : 'Time unavailable';
  };
  const identifier = value => String(value || '').trim();
  const unique = values => [...new Set((Array.isArray(values) ? values : []).map(identifier).filter(Boolean))];
  const isAlarm = item => {
    if (!item) return false;
    const category = String(item.category || '').toLowerCase();
    const type = String(item.eventType || '').toLowerCase();
    return category === 'alarm' || type.includes('alarm') || type.includes('help');
  };

  function read() {
    try {
      const saved = JSON.parse(sessionStorage.getItem(STORE) || '{}');
      return {acknowledged:unique(saved.acknowledged), cleared:unique(saved.cleared), pinned:unique(saved.pinned)};
    } catch {
      return {acknowledged:[], cleared:[], pinned:[]};
    }
  }

  let state = read();
  let channel = null;
  try {
    if (typeof BroadcastChannel === 'function') {
      channel = new BroadcastChannel(CHANNEL);
      channel.onmessage = event => {
        const incoming = event.data;
        if (!incoming || incoming.type !== 'state') return;
        state = {acknowledged:unique(incoming.state?.acknowledged), cleared:unique(incoming.state?.cleared), pinned:unique(incoming.state?.pinned)};
        persist(false);
      };
    }
  } catch {}

  function snapshot() {
    return {acknowledged:[...state.acknowledged], cleared:[...state.cleared], pinned:[...state.pinned]};
  }

  function persist(announce = true) {
    try { sessionStorage.setItem(STORE, JSON.stringify(snapshot())); } catch {}
    if (announce) {
      try { channel?.postMessage({type:'state', state:snapshot()}); } catch {}
    }
    window.dispatchEvent(new CustomEvent('northstar:alarm-state-change', {detail:snapshot()}));
  }

  function alarmState(eventId) {
    const id = identifier(eventId);
    return {acknowledged:state.acknowledged.includes(id), cleared:state.cleared.includes(id), pinned:state.pinned.includes(id)};
  }

  function acknowledge(eventId) {
    const id = identifier(eventId);
    if (!id || alarmState(id).cleared || state.acknowledged.includes(id)) return;
    state.acknowledged.push(id);
    persist();
  }

  function clear(eventId) {
    const id = identifier(eventId);
    if (!id || state.cleared.includes(id)) return;
    state.cleared.push(id);
    state.pinned = state.pinned.filter(value => value !== id);
    persist();
  }

  function togglePin(eventId) {
    const id = identifier(eventId);
    if (!id || alarmState(id).cleared) return;
    state.pinned = state.pinned.includes(id) ? state.pinned.filter(value => value !== id) : [id, ...state.pinned];
    persist();
  }

  function pinRank(eventId) {
    const rank = state.pinned.indexOf(identifier(eventId));
    return rank < 0 ? Number.MAX_SAFE_INTEGER : rank;
  }

  let dialog, detailRequest = 0;
  function ensureDialog() {
    if (dialog?.isConnected) return dialog;
    dialog = document.createElement('dialog');
    dialog.id = 'nsAlarmHistoryDialog';
    dialog.setAttribute('aria-label', 'Alarm history');
    dialog.innerHTML = '<header class="ns-alarm-window-bar"><strong>Alarm</strong><span class="ns-alarm-window-controls"><a data-alarm-full href="#" aria-label="Open full alarm detail page" title="Open full alarm detail page">↗</a><button type="button" data-alarm-minimize aria-label="Minimize alarm window" title="Minimize">−</button><button type="button" data-alarm-maximize aria-label="Maximize alarm window" title="Maximize">□</button><button type="button" data-alarm-close aria-label="Close alarm window" title="Close">×</button></span></header><div class="ns-alarm-history-content" role="status">Loading alarm history…</div><footer><button type="button" data-alarm-pin>Pin to top of All</button><button type="button" data-alarm-open>Open in Event Log</button></footer>';
    document.body.append(dialog);
    dialog.addEventListener('cancel', event => { event.preventDefault(); closeDetail(); });
    dialog.addEventListener('click', event => {
      if (event.target === dialog || event.target.closest('[data-alarm-close]')) { closeDetail(); return; }
      if (event.target.closest('[data-alarm-minimize]')) { dialog.classList.toggle('ns-alarm-minimized'); return; }
      if (event.target.closest('[data-alarm-maximize]')) { dialog.classList.toggle('ns-alarm-maximized'); dialog.classList.remove('ns-alarm-minimized'); dialog.style.left = ''; dialog.style.top = ''; dialog.style.margin = ''; return; }
      if (event.target.closest('[data-alarm-full]')) { closeDetail(); return; }
      if (event.target.closest('[data-alarm-pin]')) { togglePin(dialog.dataset.eventId); renderPinAction(); return; }
      if (event.target.closest('[data-alarm-open]')) openInEventLog(dialog.dataset.eventId);
    });
    const bar = dialog.querySelector('.ns-alarm-window-bar');
    bar.addEventListener('pointerdown', event => {
      if (event.target.closest('button,a') || dialog.classList.contains('ns-alarm-maximized')) return;
      const rect = dialog.getBoundingClientRect(), startX = event.clientX, startY = event.clientY;
      dialog.style.left = rect.left + 'px'; dialog.style.top = rect.top + 'px'; dialog.style.margin = '0';
      bar.setPointerCapture(event.pointerId);
      const move = moveEvent => {
        dialog.style.left = Math.max(0, Math.min(innerWidth - 80, rect.left + moveEvent.clientX - startX)) + 'px';
        dialog.style.top = Math.max(0, Math.min(innerHeight - 40, rect.top + moveEvent.clientY - startY)) + 'px';
      };
      bar.addEventListener('pointermove', move);
      bar.addEventListener('lostpointercapture', () => bar.removeEventListener('pointermove', move), {once:true});
    });
    return dialog;
  }

  function closeDetail() {
    detailRequest++;
    if (dialog?.open) dialog.close();
  }

  function renderPinAction() {
    const button = dialog?.querySelector('[data-alarm-pin]');
    if (!button) return;
    const current = alarmState(dialog.dataset.eventId);
    button.disabled = current.cleared;
    button.textContent = current.cleared ? 'Cleared from active alarms' : current.pinned ? 'Unpin from top of All' : 'Pin to top of All';
  }

  function renderDetail(data, fallback) {
    const event = data?.event || fallback || {};
    const history = Array.isArray(data?.history?.items) ? data.history.items : [];
    const content = dialog.querySelector('.ns-alarm-history-content');
    const fields = [event.site, event.payload?.equipment || event.payload?.node, event.severity, event.status, event.source].filter(Boolean).join(' · ');
    content.setAttribute('role', 'document');
    content.innerHTML = `<section class="ns-alarm-current"><h2>${esc(event.summary || event.eventType || 'Alarm')}</h2><p>${esc(text(event))}</p><small>${esc([stamp(event.occurredAt), fields].filter(Boolean).join(' · '))}</small></section><section class="ns-alarm-history-list"><h3>Recorded history</h3>${history.length ? `<ol>${history.map(row => `<li><time>${esc(stamp(row.occurredAt))}</time><strong>${esc(row.summary || row.eventType || 'Alarm update')}</strong><small>${esc([row.category, row.severity, row.status, row.source, row.actorId].filter(Boolean).join(' · '))}</small><p>${esc(text(row))}</p></li>`).join('')}</ol>` : '<p>No related history is available for this alarm.</p>'}</section>`;
    renderPinAction();
  }

  async function openDetail(eventId, fallback) {
    const id = identifier(eventId);
    if (!id) return;
    const current = ensureDialog();
    current.dataset.eventId = id;
    current.querySelector('[data-alarm-full]').href = 'event-detail.html?id=' + encodeURIComponent(id);
    current.classList.remove('ns-alarm-minimized');
    current.querySelector('.ns-alarm-history-content').setAttribute('role', 'status');
    current.querySelector('.ns-alarm-history-content').textContent = 'Loading alarm history…';
    renderPinAction();
    if (!current.open) current.showModal();
    const token = ++detailRequest;
    try {
      const response = await fetch('/api/events/detail?' + new URLSearchParams({id, section:'history', limit:'50'}), {cache:'no-store'});
      const data = await response.json();
      if (!response.ok) throw Error(data.error || 'Alarm history is unavailable.');
      if (token !== detailRequest || current.dataset.eventId !== id) return;
      renderDetail(data, fallback);
    } catch (error) {
      if (token !== detailRequest || current.dataset.eventId !== id) return;
      renderDetail(null, fallback || {eventId:id, summary:'Alarm history unavailable', payload:{details:error.message}});
    }
  }

  function openInEventLog(eventId) {
    closeDetail();
    if (window.NorthstarModules?.open) window.NorthstarModules.open('logbook:eventLogs');
    else document.querySelector('[data-tab="logbook"]')?.click();
    window.dispatchEvent(new CustomEvent('northstar:open-alarm-log', {detail:{eventId:identifier(eventId)}}));
  }

  const timers = new Map();
  function targetFor(event) {
    if (!(event.target instanceof Element) || event.target.closest('button,summary,details,[data-alarm-skip-interaction]')) return null;
    return event.target.closest('[data-ns-alarm-id]');
  }

  document.addEventListener('contextmenu', event => {
    const target = targetFor(event);
    if (!target) return;
    event.preventDefault();
    openDetail(target.dataset.nsAlarmId);
  });
  document.addEventListener('click', event => {
    const target = targetFor(event);
    if (!target) return;
    const id = identifier(target.dataset.nsAlarmId);
    if (!id) return;
    event.preventDefault();
    if (event.detail > 1) {
      clearTimeout(timers.get(id)); timers.delete(id); clear(id);
      return;
    }
    if (event.detail === 0) { acknowledge(id); openDetail(id); return; }
    clearTimeout(timers.get(id));
    timers.set(id, setTimeout(() => { timers.delete(id); acknowledge(id); openDetail(id); }, CLICK_DELAY));
  });
  document.addEventListener('dblclick', event => {
    const target = targetFor(event);
    if (!target) return;
    event.preventDefault();
    const id = identifier(target.dataset.nsAlarmId);
    clearTimeout(timers.get(id)); timers.delete(id); clear(id);
  });

  // Keep attention independent of the selected category or visible row limit.
  const observed = new Map();
  const inactive = new Set(['acknowledged','acked','resolved','cleared','closed','shelved','disabled']);
  let audio, toneTimer, soundButton;
  const voices = new Set();
  const pending = item => isAlarm(item) && !inactive.has(String(item.status || '').toLowerCase()) &&
    !alarmState(item.eventId).acknowledged && !alarmState(item.eventId).cleared;

  function stopTone() {
    clearInterval(toneTimer); toneTimer = null;
    for (const voice of voices) { try { voice.stop(); } catch {} }
    voices.clear();
  }

  function tone() {
    if (audio?.state !== 'running') return;
    const voice = audio.createOscillator(), gain = audio.createGain();
    voice.type = 'sine'; voice.frequency.value = 880;
    gain.gain.setValueAtTime(0, audio.currentTime);
    gain.gain.linearRampToValueAtTime(.08, audio.currentTime + .03);
    gain.gain.setValueAtTime(.08, audio.currentTime + .3);
    gain.gain.linearRampToValueAtTime(0, audio.currentTime + .4);
    voice.connect(gain); gain.connect(audio.destination); voices.add(voice);
    voice.onended = () => { voices.delete(voice); voice.disconnect(); gain.disconnect(); };
    voice.start(); voice.stop(audio.currentTime + .42);
  }

  function refreshAttention() {
    for (const row of document.querySelectorAll('[data-ns-alarm-id]')) {
      const item = observed.get(row.dataset.nsAlarmId);
      if (!item) continue;
      const active = pending(item);
      row.dataset.alarmSeverity = ['critical','warning'].includes(String(item.severity).toLowerCase()) ? String(item.severity).toLowerCase() : 'info';
      row.toggleAttribute('data-alarm-new', active);
      const label = row.querySelector('.ns-status-alarm-text, a[role="cell"], strong');
      let badge = row.querySelector('.ns-alarm-new-badge');
      if (active && label && !badge) {
        badge = document.createElement('small'); badge.className = 'ns-alarm-new-badge';
        badge.textContent = 'NEW · UNACK'; label.append(' ', badge);
      }
      if (!active) badge?.remove();
    }
    const toolbar = document.querySelector('.ns-status-filters') || document.querySelector('.el-categories');
    if (toolbar && !soundButton?.isConnected) {
      soundButton = document.createElement('button'); soundButton.type = 'button';
      soundButton.dataset.alarmAudio = '';
      soundButton.onclick = async () => {
        try {
          const Audio = window.AudioContext || window.webkitAudioContext;
          if (!Audio) throw Error('Audio unavailable');
          audio ||= new Audio(); await audio.resume();
          refreshAttention();
        } catch { soundButton.textContent = 'Audio unavailable · retry'; }
      };
      toolbar.append(soundButton);
    }
    const critical = [...observed.values()].some(item => pending(item) && String(item.severity).toLowerCase() === 'critical');
    const enabled = audio?.state === 'running';
    if (soundButton) {
      soundButton.textContent = enabled ? (critical ? 'Critical alarm sounding' : 'Alarm sound enabled') : 'Enable alarm sound';
      soundButton.setAttribute('aria-pressed', String(enabled));
      soundButton.title = 'Critical alarms repeat until acknowledged. Enable sound after opening this dashboard.';
    }
    if (critical && enabled && !toneTimer) { tone(); toneTimer = setInterval(tone, 2500); }
    if (!critical || !enabled) stopTone();
  }

  function observe(items) {
    for (const item of items || []) {
      if (item?.eventId && isAlarm(item)) observed.set(identifier(item.eventId), item);
    }
    refreshAttention();
  }

  function sourceAcknowledged(type, id) {
    return [...observed.values()].some(item => item.aggregateType === type && identifier(item.aggregateId) === identifier(id) &&
      (alarmState(item.eventId).acknowledged || alarmState(item.eventId).cleared));
  }

  window.addEventListener('northstar:alarm-state-change', () => { renderPinAction(); refreshAttention(); });
  window.addEventListener('pagehide', stopTone);
  window.NorthstarAlarmInteractions = {isAlarm, state:alarmState, acknowledge, clear, togglePin, pinRank, openDetail, openInEventLog, observe, sourceAcknowledged};
})();
