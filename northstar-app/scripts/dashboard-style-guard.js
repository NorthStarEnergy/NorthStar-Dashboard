/* Embedded in the dashboard head: recovery must not depend on another asset request. */
(() => {
  const root = document.documentElement;
  root.dataset.nsStyles = 'loading';
  let release, running = false, status;
  const failedScripts = new Set();
  document.addEventListener('error',event=>{if(event.target?.tagName==='SCRIPT' && event.target.src && event.target.hasAttribute('data-ns-required'))failedScripts.add(event.target.src);},true);
  window.northstarStylesReady = new Promise(resolve => { release = resolve; });
  const valid = link => {
    try { return !!link.sheet && link.sheet.cssRules.length > 0; }
    catch { return false; }
  };
  function retry(link, remaining) {
    return new Promise(resolve => {
      const replacement = link.cloneNode();
      const url = new URL(link.href);
      url.searchParams.set('nsStyleRetry', Date.now());
      replacement.href = url.href;
      const finish = () => { clearTimeout(timer); replacement.onload = replacement.onerror = null; resolve(); };
      const timer = setTimeout(finish, Math.min(8000, remaining));
      replacement.onload = replacement.onerror = finish;
      link.replaceWith(replacement); // Keep the original cascade order.
    });
  }
  async function check() {
    if (running) return;
    running = true;
    root.dataset.nsStyles = 'loading';
    if (!status) {
      status = document.createElement('div'); status.id = 'nsStyleStatus';
      status.setAttribute('role', 'status');
      status.innerHTML = '<strong>Loading dashboard…</strong><p></p><button type="button">Retry loading</button>';
      status.querySelector('button').onclick = () => failedScripts.size || !window.northstarOperatorSession ? location.reload() : check();
      document.body.append(status);
    }
    status.hidden = false;
    status.querySelector('strong').textContent = 'Loading dashboard…';
    status.querySelector('p').textContent = 'Restoring the dashboard display.';
    status.querySelector('button').hidden = true;
    // Retry failed styles sequentially instead of sending another burst of requests.
    const deadline = Date.now() + 16000;
    for (let attempt = 0; attempt < 2 && Date.now() < deadline; attempt++) {
      const missing = [...document.querySelectorAll('link[rel="stylesheet"]')].filter(link => !valid(link));
      if (!missing.length) break;
      for (const link of missing) {
        if (Date.now() >= deadline) break;
        await retry(link, deadline - Date.now());
      }
    }
    const scriptsReady = !failedScripts.size && !!window.northstarOperatorSession;
    const ready = scriptsReady && [...document.querySelectorAll('link[rel="stylesheet"]')].every(valid);
    root.dataset.nsStyles = ready ? 'ready' : 'failed';
    status.hidden = ready;
    if (ready) {
      release();
      window.dispatchEvent(new Event('northstar:styles-ready'));
    } else {
      status.querySelector('strong').textContent = scriptsReady ? 'Dashboard display could not load' : 'Dashboard files could not load';
      const missingFiles = [...failedScripts].map(src => new URL(src).pathname.split('/').pop());
      if (!window.northstarOperatorSession) missingFiles.unshift('operator-session.js');
      status.querySelector('p').textContent = (missingFiles.length ? 'Could not load: ' + missingFiles.join(', ') + '. ' : '') + 'Retry loading. Your saved layout has not been reset.';
      status.querySelector('button').hidden = false;
    }
    running = false;
  }
  document.addEventListener('DOMContentLoaded', check);
  window.addEventListener('pageshow', event => { if (event.persisted) check(); });
})();
