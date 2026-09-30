// Packet 19 — demo operator session guard for the dashboard.
//
// This is not the lock. Every operator route is enforced server-side in
// ieso_backend.py, and nothing here can open one. What this does is make the
// dashboard behave correctly when there is no session: check first, then load,
// so a signed-out or expired browser gets the login screen instead of a console
// full of failed panels.
//
// It must run before the dashboard's inline boot code, which starts fetching
// operator data as soon as it parses — hence a plain <script> in <head>.
(function () {
  'use strict';

  var LOGIN_PAGE = '/operator-login.html';
  var REMOTE_DASHBOARD = 'https://ops.northstarenergy.ca/northstar-clean.html';
  var nativeFetch = window.fetch.bind(window);
  var redirecting = false;

  function toLogin() {
    if (redirecting) return;
    redirecting = true;
    try { sessionStorage.setItem('northstarSessionEnded', '1'); } catch (e) { /* private mode */ }
    window.location.replace(LOGIN_PAGE);
  }

  function isLoopback() {
    return /^(localhost|127(?:\.\d{1,3}){3}|\[::1\])$/i.test(window.location.hostname);
  }

  // A production demo session is deliberately host-bound to ops.  A browser
  // left on localhost cannot sign in or load protected records there, so send
  // it to the operator hostname instead of leaving every panel in a retry loop.
  function toOperatorDashboard() {
    if (redirecting) return;
    redirecting = true;
    window.location.replace(REMOTE_DASHBOARD);
  }

  // One request, asked once, before anything else touches /api/.
  var state = nativeFetch('/api/auth/session', {
    headers: { Accept: 'application/json' },
    cache: 'no-store',
  }).then(function (response) {
    return response.json().catch(function () { return {}; }).then(function (body) {
      if (isLoopback() && (response.status === 404 || body.mode === 'access')) {
        toOperatorDashboard();
        return { required: false, authenticated: false, username: null };
      }
      return {
        // A 404 means this deployment has no demo gate (localhost development,
        // or Cloudflare Access in front). Leave the dashboard alone.
        required: response.status === 404 ? false : Boolean(body.required),
        authenticated: Boolean(body.authenticated),
        username: body.username || null,
      };
    });
  }).catch(function () {
    // The backend is unreachable. That is the watchdog's problem to display,
    // not a reason to bounce the operator to a login page that also will not load.
    return { required: false, authenticated: false, username: null };
  });

  window.northstarOperatorSession = state;

  window.fetch = function (input, init) {
    var url = String(typeof input === 'string' ? input : (input && input.url) || '');
    var path = url.indexOf(window.location.origin) === 0 ? url.slice(window.location.origin.length) : url;
    if (path.indexOf('/api/') !== 0 || path.indexOf('/api/auth/') === 0) {
      return nativeFetch(input, init);
    }
    return state.then(function (session) {
      if (session.required && !session.authenticated) {
        toLogin();
        return Promise.reject(new Error('operator sign-in required'));
      }
      return nativeFetch(input, init).then(function (response) {
        // A session that expires mid-shift ends the same way it started.
        if (session.required && (response.status === 401 || response.status === 403)) {
          response.clone().json().then(function (body) {
            if (body && body.loginRequired) toLogin();
          }).catch(function () { /* not a JSON refusal; leave it to the caller */ });
        }
        return response;
      });
    });
  };

  function addSignOut(session) {
    if (!session.required || !session.authenticated) return;
    if (document.querySelector('.operator-signout')) return;
    var button = document.createElement('button');
    button.type = 'button';
    button.className = 'operator-signout';
    button.textContent = 'SIGN OUT';
    button.title = 'End this demo operator session';
    button.addEventListener('click', function () {
      var modal = document.createElement('div');
      modal.className = 'logout-modal-backdrop';
      modal.innerHTML = '<div class="logout-modal" role="dialog" aria-modal="true" aria-labelledby="logout-title"><h2 id="logout-title">Log out?</h2><p>End the current operator session?</p><div class="logout-modal-actions"><button class="logout-cancel" type="button">CANCEL</button><button class="logout-confirm" type="button">LOG OUT</button></div></div>';
      document.body.appendChild(modal);
      modal.querySelector('.logout-cancel').focus();
      modal.querySelector('.logout-cancel').onclick = function () { modal.remove(); button.focus(); };
      modal.querySelector('.logout-confirm').onclick = function () {
        button.disabled = true;
        modal.querySelector('.logout-confirm').disabled = true;
        nativeFetch('/api/auth/logout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
          .catch(function () { /* the redirect below is what the operator sees */ })
          .then(function () { window.location.replace(LOGIN_PAGE); });
      };
      modal.onclick = function (event) { if (event.target === modal) modal.remove(); };
    });
    var placeInMenu = function () {
      var host = document.querySelector('#nsWebToolbar .ns-web-toolbar-dropdown');
      if (!host) return false;
      host.insertBefore(button, host.children[1] || null);
      button.hidden = false;
      return true;
    };
    if (!placeInMenu()) {
      button.hidden = true;
      var observer = new MutationObserver(function () { if (placeInMenu()) observer.disconnect(); });
      observer.observe(document.documentElement, { childList: true, subtree: true });
    }
  }

  function ready(run) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', run);
    } else {
      run();
    }
  }

  state.then(function (session) { ready(function () { addSignOut(session); }); });
})();
