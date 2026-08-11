/**
 * Voice operations workspace.
 *
 * Reads /api/voice (operator-gated). Presents recordings, their transcripts,
 * and the triage verdict on every line.
 *
 * Two rules this UI must keep:
 *   - Filtered lines are shown, dimmed, with the reason they were set aside.
 *     Hiding them entirely would make the filter unauditable.
 *   - Safety-held lines are marked and cannot be filtered out from here; the
 *     server refuses it too, so this is a matching affordance, not the control.
 */
(() => {
  const section = document.querySelector('#voice');
  if (!section) return;

  const esc = value => String(value ?? '').replace(/[<>&"]/g, c => (
    { '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));
  const when = value => value
    ? new Date(value).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })
    : '—';
  const kb = bytes => bytes ? `${(Number(bytes) / 1024).toFixed(0)} KB` : '—';
  const clock = seconds => Number.isFinite(Number(seconds))
    ? `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`
    : null;
  const statusClass = status => /awaiting/i.test(status) ? 'awaiting'
    : /failed/i.test(status) ? 'failed'
    : /purged/i.test(status) ? 'purged' : 'transcribed';

  let selectedId = null;
  let showFiltered = true;

  section.innerHTML = `
    <div class="voice-banner">
      <div>
        <label>VOICE OPERATIONS · AUDIO FILE INTAKE</label>
        <h2>Radio &amp; Call Log</h2>
      </div>
      <span class="voice-engine-badge off" id="voiceEngineBadge">ENGINE —</span>
    </div>
    <div class="voice-notice" id="voiceNotice"></div>
    <div class="voice-summary" id="voiceSummary"></div>
    <div class="voice-layout">
      <div class="voice-list">
        <h3>RECORDINGS</h3>
        <div class="voice-recordings" id="voiceRecordings"><div class="voice-empty">Loading…</div></div>
      </div>
      <div class="voice-detail">
        <h3 id="voiceDetailTitle">TRANSCRIPT</h3>
        <div class="voice-filter-row">
          <button type="button" id="voiceShowAll" class="active">ALL LINES</button>
          <button type="button" id="voiceShowOperational">OPERATIONAL ONLY</button>
        </div>
        <div class="voice-segments" id="voiceSegments"><div class="voice-empty">Select a recording.</div></div>
        <div class="voice-events" id="voiceEvents"></div>
      </div>
    </div>`;

  const nodes = {
    badge: section.querySelector('#voiceEngineBadge'),
    notice: section.querySelector('#voiceNotice'),
    summary: section.querySelector('#voiceSummary'),
    recordings: section.querySelector('#voiceRecordings'),
    title: section.querySelector('#voiceDetailTitle'),
    segments: section.querySelector('#voiceSegments'),
    events: section.querySelector('#voiceEvents'),
    showAll: section.querySelector('#voiceShowAll'),
    showOperational: section.querySelector('#voiceShowOperational'),
  };

  function renderSnapshot(snapshot) {
    nodes.badge.textContent = snapshot.engineConfigured
      ? `ENGINE · ${String(snapshot.engine).toUpperCase()}`
      : 'NO TRANSCRIPTION ENGINE';
    nodes.badge.className = `voice-engine-badge ${snapshot.engineConfigured ? 'on' : 'off'}`;
    nodes.notice.innerHTML = `<strong>${snapshot.engineConfigured ? 'ACTIVE.' : 'INTAKE ONLY.'}</strong> `
      + `${esc(snapshot.engineNote)} Audio is retained ${snapshot.retentionDays} days, then the recording is `
      + `deleted and the transcript kept. Drop files in <code>${esc(snapshot.inbox)}</code>`
      + `${snapshot.inboxExists ? '' : ' <em>(folder missing)</em>'}.`;
    const cell = (label, value, tone) =>
      `<div><span>${label}</span><b class="${tone || ''}">${value}</b></div>`;
    nodes.summary.innerHTML = [
      cell('RECORDINGS', snapshot.recordings),
      cell('IN INBOX', snapshot.inboxWaiting, snapshot.inboxWaiting ? 'warn' : ''),
      cell('AWAITING', snapshot.awaiting, snapshot.awaiting ? 'warn' : ''),
      cell('OPERATIONAL LINES', snapshot.operationalSegments),
      cell('FILTERED', snapshot.filteredSegments),
      cell('SAFETY HELD', snapshot.safetySegments, snapshot.safetySegments ? 'danger' : ''),
    ].join('');
  }

  function renderRecordings(rows) {
    if (!rows.length) {
      nodes.recordings.innerHTML = '<div class="voice-empty">No audio received yet.</div>';
      return;
    }
    nodes.recordings.innerHTML = rows.map(row => `
      <button type="button" class="voice-recording ${row.recordingId === selectedId ? 'selected' : ''} ${row.safetySegments ? 'has-safety' : ''}" data-recording="${esc(row.recordingId)}">
        <strong>${esc(row.originalName)}</strong>
        <small>${when(row.receivedAt)} · ${kb(row.byteSize)} · ${esc(row.source)}
          <span class="voice-status ${statusClass(row.status)}">${esc(row.status).toUpperCase()}</span>
          ${row.audioRetained ? '' : ' · AUDIO PURGED'}</small>
        <span class="voice-tally">
          <i>${row.operationalSegments} operational</i>
          <i class="filtered">${row.filteredSegments} filtered</i>
          ${row.safetySegments ? `<i class="safety">${row.safetySegments} SAFETY</i>` : ''}
        </span>
      </button>`).join('');
    nodes.recordings.querySelectorAll('[data-recording]').forEach(button => {
      button.onclick = () => { selectedId = button.dataset.recording; load(); };
    });
  }

  function renderDetail(record) {
    if (!record) {
      nodes.title.textContent = 'TRANSCRIPT';
      nodes.segments.innerHTML = '<div class="voice-empty">Select a recording.</div>';
      nodes.events.innerHTML = '';
      return;
    }
    nodes.title.textContent = `TRANSCRIPT · ${record.originalName}`;
    const visible = showFiltered
      ? record.segments
      : record.segments.filter(s => s.classification === 'operational');
    if (!visible.length) {
      nodes.segments.innerHTML = record.status && /awaiting/i.test(record.status)
        ? '<div class="voice-empty">Awaiting transcription — no engine has processed this audio yet. Nothing has been transcribed, and nothing has been invented.</div>'
        : '<div class="voice-empty">No lines to show.</div>';
    } else {
      nodes.segments.innerHTML = visible.map(segment => {
        const stamp = clock(segment.startedSeconds);
        const filtered = segment.classification === 'non-operational';
        return `
        <div class="voice-segment ${esc(segment.classification)} ${segment.safetyHold ? 'safety' : ''}">
          <p>${esc(segment.text)}</p>
          <div class="voice-meta">
            <span>${stamp ? stamp + ' · ' : ''}${esc(segment.classification).toUpperCase()}${segment.safetyHold ? ' <span class="voice-safety-tag">SAFETY HELD</span>' : ''}</span>
            <span class="voice-reason">${esc(segment.reason)}</span>
          </div>
          ${segment.reviewedBy ? `<div class="voice-meta"><span>reviewed by ${esc(segment.reviewedBy)} · ${when(segment.reviewedAt)}</span></div>` : ''}
          <button type="button" data-review="${esc(segment.segmentId)}" data-to="${filtered ? 'operational' : 'non-operational'}" ${segment.safetyHold ? 'disabled title="Safety content cannot be filtered out"' : ''}>
            ${filtered ? 'RESTORE TO OPERATIONAL FEED' : 'MARK NON-OPERATIONAL'}
          </button>
        </div>`;
      }).join('');
      nodes.segments.querySelectorAll('[data-review]').forEach(button => {
        button.onclick = async () => {
          button.disabled = true;
          try {
            const response = await fetch(`/api/voice/segments/${encodeURIComponent(button.dataset.review)}/review`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ classification: button.dataset.to, note: 'reviewed from the voice workspace' }),
            });
            if (!response.ok) throw new Error((await response.json()).error || 'review failed');
            await load();
          } catch (error) {
            button.disabled = false;
            button.textContent = String(error.message || error).toUpperCase();
          }
        };
      });
    }
    nodes.events.innerHTML = (record.events || []).map(event =>
      `<div>${when(event.at)} · ${esc(event.event)} · ${esc(event.detail)}${event.actor && event.actor !== 'system' ? ' · ' + esc(event.actor) : ''}</div>`
    ).join('') || '<div>No audit events.</div>';
  }

  async function load() {
    try {
      const [snapshot, recordings] = await Promise.all([
        fetch('/api/voice?ts=' + Date.now()).then(r => r.json()),
        fetch('/api/voice/recordings?ts=' + Date.now()).then(r => r.json()),
      ]);
      renderSnapshot(snapshot);
      renderRecordings(Array.isArray(recordings) ? recordings : []);
      if (selectedId) {
        const record = await fetch(`/api/voice/recordings/${encodeURIComponent(selectedId)}`).then(r => r.ok ? r.json() : null);
        renderDetail(record);
      } else {
        renderDetail(null);
      }
    } catch (error) {
      nodes.recordings.innerHTML = `<div class="voice-empty">Voice feed unavailable — ${esc(error.message)}</div>`;
    }
  }

  nodes.showAll.onclick = () => {
    showFiltered = true;
    nodes.showAll.classList.add('active');
    nodes.showOperational.classList.remove('active');
    load();
  };
  nodes.showOperational.onclick = () => {
    showFiltered = false;
    nodes.showOperational.classList.add('active');
    nodes.showAll.classList.remove('active');
    load();
  };

  load();
  setInterval(load, 30000);
})();
