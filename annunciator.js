(() => {
  const alarmApi = '/api/alarms/annunciator';
  const authApi = '/api/auth/config';
  const tokenKey = 'northstar.accessToken';
  let audio;
  let toneTimer;
  let lastAlarmToken = '';

  const auth = document.createElement('div');
  auth.id = 'northstar-auth';
  auth.innerHTML = '<span data-auth-status>AUTH CHECKING…</span> <button data-signin hidden>SIGN IN</button> <button data-signout hidden>SIGN OUT</button>';
  Object.assign(auth.style, { position: 'fixed', right: '12px', bottom: '12px', zIndex: 2147483646, background: '#111827', color: '#fff', padding: '8px 10px', border: '1px solid #475569', borderRadius: '5px', font: '12px system-ui,sans-serif' });
  document.body.append(auth);

  const bar = document.createElement('section');
  bar.id = 'northstar-annunciator';
  bar.hidden = true;
  bar.innerHTML = '<div class="annunciator-head"><strong>NORTHSTAR LIFE-SAFETY ALARM</strong><button data-enable>ENABLE AUDIO</button></div><div data-list></div>';
  document.body.prepend(bar);

  const mobile = document.createElement('section');
  mobile.id = 'northstar-mobile-status';
  mobile.innerHTML = '<div><strong>MOBILE WORKER v0.6</strong><span>ANDROID FIELD SAFETY</span></div><div class="mobile-status-grid"><span><b>SQLCIPHER QUEUE</b> ENCRYPTED OFFLINE</span><span><b>BACKGROUND SERVICE</b> FOREGROUND TASK</span><span><b>AUTH</b> PKCE / OIDC</span><span><b>RELEASE</b> COMMISSIONING REQUIRED</span></div>';
  document.querySelector('.page-header')?.after(mobile);
  const style = document.createElement('style');
  style.textContent = '#northstar-annunciator{position:fixed;inset:auto 12px 12px auto;z-index:2147483647;background:#101c25;color:#fff;padding:10px 12px;width:min(460px,calc(100vw - 24px));border:1px solid #b54c4c;border-radius:6px;font:12px system-ui,sans-serif;box-shadow:0 8px 24px #0008}#northstar-annunciator[hidden]{display:none}.annunciator-head{display:flex;gap:14px;align-items:center;flex-wrap:wrap}.annunciator-head strong{font-size:14px;color:#ff766d}.annunciator-head button,#northstar-annunciator [data-list] button{border:1px solid #fff;background:#fff;color:#641b1b;border-radius:4px;padding:5px 8px;font-weight:700}.annunciator-head button{margin-left:auto}#northstar-annunciator [data-list]{display:flex;gap:12px;flex-wrap:wrap;margin-top:7px}#northstar-mobile-status{margin:8px 0;padding:9px 12px;background:#101c25;border:1px solid #39505b;border-radius:6px;color:#d6e6ed;font:9px monospace;letter-spacing:.5px}#northstar-mobile-status>div:first-child{display:flex;justify-content:space-between;gap:10px;margin-bottom:6px;color:#e6b85c}#northstar-mobile-status>div:first-child span{color:#7faabd}.mobile-status-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:6px}.mobile-status-grid span{padding:5px 6px;background:#0a141b;border-radius:3px;color:#8fa5ae}.mobile-status-grid b{display:block;color:#65c6a3;font-size:8px;margin-bottom:2px}@media(max-width:700px){#northstar-auth{right:6px!important;bottom:58px!important;font-size:10px!important}.mobile-status-grid{grid-template-columns:repeat(2,minmax(0,1fr))}#northstar-mobile-status{margin:5px 0 8px;font-size:8px}.mobile-status-grid b{font-size:7px}.annunciator-head strong{font-size:12px}}';
  document.head.append(style);

  const status = auth.querySelector('[data-auth-status]');
  const signIn = auth.querySelector('[data-signin]');
  const signOut = auth.querySelector('[data-signout]');
  const list = bar.querySelector('[data-list]');
  let authConfig;

  const token = () => sessionStorage.getItem(tokenKey) || '';
  const headers = () => ({ 'Content-Type': 'application/json', ...(token() ? { Authorization: `Bearer ${token()}` } : {}) });
  const setAuth = (message, signedIn = Boolean(token())) => {
    status.textContent = message;
    signIn.hidden = !authConfig?.enabled || signedIn;
    signOut.hidden = !signedIn;
  };

  function beep() {
    if (!audio) return;
    const oscillator = audio.createOscillator();
    const gain = audio.createGain();
    oscillator.frequency.value = 880;
    oscillator.type = 'square';
    gain.gain.value = 0.12;
    oscillator.connect(gain); gain.connect(audio.destination);
    oscillator.start(); oscillator.stop(audio.currentTime + 0.45);
  }

  bar.querySelector('[data-enable]').onclick = () => {
    audio = audio || new (window.AudioContext || window.webkitAudioContext)();
    audio.resume(); beep();
  };
  signOut.onclick = () => { sessionStorage.removeItem(tokenKey); setAuth('SIGN-IN REQUIRED', false); };
  signIn.onclick = () => setAuth('OIDC SIGN-IN REQUIRED');

  async function acknowledge(id) {
    const response = await fetch(`${alarmApi}/acknowledge`, { method: 'POST', headers: headers(), body: JSON.stringify({ alarmId: id }) });
    if (response.status === 401 || response.status === 403) { setAuth('SIGN-IN REQUIRED', false); return; }
    poll();
  }

  async function poll() {
    try {
      const response = await fetch(alarmApi, { headers: headers(), cache: 'no-store' });
      if (response.status === 401 || response.status === 403) { setAuth('SIGN-IN REQUIRED', false); return; }
      if (!response.ok) return pollLegacy();
      setAuth('SIGNED IN');
      const state = await response.json();
      bar.hidden = !state.active;
      list.replaceChildren();
      for (const alarm of state.alarms || []) {
        const row = document.createElement('span');
        row.textContent = alarm.message || 'Life-safety event';
        if (!alarm.acknowledged) {
          const button = document.createElement('button');
          button.textContent = 'ACKNOWLEDGE';
          button.onclick = () => acknowledge(alarm.id);
          row.append(' ', button);
        }
        list.append(row);
      }
      if (state.soundRequired && state.alarmToken !== lastAlarmToken) beep();
      lastAlarmToken = state.alarmToken || '';
      if (state.soundRequired && !toneTimer) toneTimer = setInterval(beep, 4000);
      if (!state.soundRequired && toneTimer) { clearInterval(toneTimer); toneTimer = null; }
    } catch {
      pollLegacy();
    }
  }

  async function pollLegacy() {
    try {
      const [crewResponse, alertResponse] = await Promise.all([
        fetch('/api/checkins?ts=' + Date.now(), { cache: 'no-store' }),
        fetch('/api/alerts?ts=' + Date.now(), { cache: 'no-store' })
      ]);
      if (!crewResponse.ok || !alertResponse.ok) throw new Error('legacy safety feed unavailable');
      const crew = await crewResponse.json();
      const alerts = await alertResponse.json();
      const safety = crew.filter(row => row.needsHelp || row.overdue).map(row => ({ message: `${row.needsHelp ? 'HELP' : 'OVERDUE'} · ${row.name} · ${row.site}` }));
      const prices = alerts.filter(row => row.state === 'active').map(row => ({ message: `PRICE ALERT · ${row.node} · $${Number(row.price).toFixed(2)}` }));
      const alarms = [...safety, ...prices];
      bar.hidden = !alarms.length;
      list.replaceChildren(...alarms.map(alarm => { const row = document.createElement('span'); row.textContent = alarm.message; return row; }));
      if (!authConfig?.enabled) setAuth('LOCAL SAFETY FEED');
    } catch {
      bar.hidden = true;
      if (!authConfig?.enabled) setAuth('LIFE-SAFETY FEED UNAVAILABLE', false);
    }
  }

  async function boot() {
    try {
      const response = await fetch(authApi, { cache: 'no-store' });
      authConfig = response.ok ? await response.json() : { enabled: false, legacy: true };
      setAuth(authConfig.enabled ? (token() ? 'SIGNED IN' : 'SIGN-IN REQUIRED') : 'LOCAL SAFETY FEED');
    } catch { authConfig = { enabled: false, legacy: true }; setAuth('LOCAL SAFETY FEED'); }
    poll();
    setInterval(poll, 3000);
  }
  boot();
})();
