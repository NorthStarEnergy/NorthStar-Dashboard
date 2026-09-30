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
        <label>VOICE OPERATIONS · PC AUDIO &amp; FILE INTAKE</label>
        <h2>Radio &amp; Call Log</h2>
      </div>
      <span class="voice-engine-badge off" id="voiceEngineBadge">ENGINE —</span>
    </div>
    <div class="voice-notice" id="voiceNotice"></div>
    <div class="voice-input">
      <h3>PC AUDIO INPUT</h3>
      <p>Record a test conversation with your microphone or headset, or upload an audio file. Transcription runs after saving. PBX connection pending.</p>
      <div class="voice-input-controls">
        <label>Recording name <input id="voiceInputName" maxlength="140" placeholder="Test conversation"></label>
        <button type="button" id="voiceRecord">START MICROPHONE</button>
        <button type="button" id="voiceStop" disabled>STOP</button>
        <label>Audio file <input type="file" id="voiceFile" accept=".wav,.mp3,.m4a,.ogg,.oga,.flac,.amr,.aac,.wma,.opus,.webm"></label>
      </div>
      <p id="voiceInputStatus" role="status" aria-live="polite">Ready. Uses your default PC microphone. Maximum 10 minutes per recording / 32 MB per upload.</p>
      <div id="voicePending" hidden>
        <audio id="voicePreview" controls></audio>
        <button type="button" id="voiceSave">SAVE TO CALL LOG</button>
        <a id="voiceDownload">DOWNLOAD AUDIO</a>
        <button type="button" id="voiceDiscard">DISCARD</button>
      </div>
    </div>
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

  const input = Object.fromEntries(['Record', 'Stop', 'File', 'InputName', 'InputStatus',
    'Pending', 'Preview', 'Save', 'Download', 'Discard'].map(key => [key, section.querySelector('#voice' + key)]));
  const maxBytes = 32 * 1024 * 1024;
  let recorder, stream, timer, pending, previewUrl, starting = false, saving = false;
  const say = message => { input.InputStatus.textContent = message; };
  function controls() {
    const busy = starting || !!stream || saving || !!pending;
    input.Record.disabled = busy;
    input.File.disabled = busy;
    input.Stop.disabled = !recorder || recorder.state !== 'recording';
    input.Save.disabled = saving;
    input.Discard.disabled = saving;
  }
  function release() {
    clearInterval(timer);
    if (stream) stream.getTracks().forEach(track => track.stop());
    stream = null;
  }
  function clearPending() {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    previewUrl = null;
    pending = null;
    input.Preview.removeAttribute('src');
    input.Preview.load();
    input.Pending.hidden = true;
    input.File.value = '';
    controls();
  }
  function ready(blob, name, source) {
    if (!blob.size || blob.size > maxBytes) {
      say('Audio is empty or exceeds 32 MB. Choose a smaller recording.');
      controls();
      return;
    }
    pending = { blob, name, source };
    previewUrl = URL.createObjectURL(blob);
    input.Preview.src = previewUrl;
    input.Download.href = previewUrl;
    input.Download.download = name;
    input.Pending.hidden = false;
    say('Audio ready. Listen, then save to the call log.');
    controls();
  }
  input.Record.onclick = async () => {
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
      say('Microphone recording requires a supported browser on HTTPS or localhost. Audio uploads are available.');
      return;
    }
    starting = true;
    controls();
    say('Waiting for microphone permission…');
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/mp4'].find(type => MediaRecorder.isTypeSupported(type));
      if (!mime) throw new Error('No supported recording format. Use an audio file instead.');
      recorder = new MediaRecorder(stream, { mimeType: mime, audioBitsPerSecond: 64000 });
      const chunks = [];
      let bytes = 0, failed = false;
      const started = Date.now();
      recorder.ondataavailable = event => {
        if (event.data.size) { chunks.push(event.data); bytes += event.data.size; }
        if (bytes >= maxBytes - 128 * 1024 && recorder.state === 'recording') recorder.stop();
      };
      recorder.onerror = () => { failed = true; say('Recording failed. Try again or upload an audio file.'); release(); controls(); };
      recorder.onstop = () => {
        release();
        if (!failed) {
          const extension = mime.includes('webm') ? 'webm' : mime.includes('ogg') ? 'ogg' : 'm4a';
          const label = input.InputName.value.trim().replace(/[\\/:*?"<>|\x00-\x1f]/g, '-') || 'PC test';
          ready(new Blob(chunks, { type: mime }), `${label}-${new Date(started).toISOString().replace(/[:.]/g, '-')}.${extension}`, 'pc-microphone');
        }
        controls();
      };
      stream.getAudioTracks().forEach(track => track.addEventListener('ended', () => {
        if (recorder.state === 'recording') recorder.stop();
      }));
      recorder.start(1000);
      timer = setInterval(() => {
        const seconds = Math.floor((Date.now() - started) / 1000);
        say(`Recording microphone · ${clock(seconds)} · Stop to review and save.`);
        if (seconds >= 600 && recorder.state === 'recording') recorder.stop();
      }, 1000);
      say('Recording microphone · 00:00 · Stop to review and save.');
    } catch (error) {
      release();
      say(`Microphone unavailable: ${error.message}. You can upload an audio file.`);
    } finally { starting = false; controls(); }
  };
  input.Stop.onclick = () => { if (recorder?.state === 'recording') recorder.stop(); };
  input.File.onchange = () => {
    const file = input.File.files[0];
    if (file) ready(file, file.name, 'audio-upload');
  };
  input.Discard.onclick = () => { clearPending(); say('Discarded. Ready for another recording.'); };
  input.Save.onclick = async () => {
    if (!pending || saving) return;
    saving = true; controls(); say('Saving audio to the call log…');
    try {
      const query = new URLSearchParams({ name: pending.name, source: pending.source });
      const response = await fetch('/api/voice/upload?' + query, {
        method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: pending.blob,
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || `Upload failed (${response.status})`);
      selectedId = result.recordingId;
      clearPending();
      say(result.duplicate ? 'This audio is already in the call log.' : 'Saved. Transcription status appears in the recording log.');
      await load();
    } catch (error) {
      say(`Not saved: ${error.message}. Your audio is still available to retry or download.`);
    } finally { saving = false; controls(); }
  };
  window.addEventListener('beforeunload', event => {
    if (stream || pending || saving) { event.preventDefault(); event.returnValue = ''; }
  });
  window.addEventListener('pagehide', release);

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
