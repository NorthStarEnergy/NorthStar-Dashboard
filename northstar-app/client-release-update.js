// Keep an already-open operator client aligned with the release served by its
// authenticated backend. The backend, not the browser, writes the audit event.
(() => {
  'use strict';

  const CHECK_INTERVAL_MS = 60_000;
  const RELOAD_KEY = 'northstarClientReleaseReload';

  const storage = {
    get() { try { return sessionStorage.getItem(RELOAD_KEY) || ''; } catch { return ''; } },
    set(value) { try { sessionStorage.setItem(RELOAD_KEY, value); } catch { /* private mode */ } },
  };

  const loadedVersion = () => String(window.NORTHSTAR_BUILD_DATA?.current?.version || '').trim();

  const signedIn = async () => {
    if (!window.northstarOperatorSession) return true;
    const session = await window.northstarOperatorSession;
    return !session?.required || Boolean(session.authenticated);
  };

  async function check() {
    const loaded = loadedVersion();
    let authorized;
    try { authorized = await signedIn(); } catch { return { checked: false }; }
    if (!loaded || !authorized) return { checked: false };
    let response;
    try {
      response = await fetch('/api/client-release', {
        cache: 'no-store', credentials: 'same-origin', headers: { Accept: 'application/json' },
      });
    } catch {
      return { checked: false };
    }
    if (!response.ok) return { checked: false };
    let release;
    try { release = await response.json(); } catch { return { checked: false }; }
    const serverVersion = String(release?.dashboard?.version || '').trim();
    if (!serverVersion || serverVersion === loaded) return { checked: true, updated: false, release };
    if (storage.get() === serverVersion) return { checked: true, updated: false, deferred: true, release };

    storage.set(serverVersion);
    window.dispatchEvent(new CustomEvent('northstar-client-update', { detail: release }));
    const target = new URL(window.location.href);
    target.searchParams.set('release', serverVersion);
    window.location.replace(target.toString());
    return { checked: true, updated: true, release };
  }

  const start = () => {
    window.NorthstarClientRelease = Object.freeze({ check });
    void check();
    setInterval(() => { if (!document.hidden) void check(); }, CHECK_INTERVAL_MS);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) void check(); });
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
