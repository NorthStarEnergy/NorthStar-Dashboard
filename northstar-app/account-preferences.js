(() => {
  const init = () => {
    const toggle = document.getElementById('accountHoverPreviews');
    if (!toggle) return;
    const status = document.getElementById('accountPreferenceStatus');
    const sync = () => { toggle.checked = window.NorthstarHoverPreviewsEnabled?.() !== false; };
    sync();
    window.addEventListener('northstar:hover-previews-change', sync);
    toggle.addEventListener('change', () => {
      window.NorthstarSetHoverPreviews(toggle.checked);
      status.textContent = 'Preference saved in this browser.';
    });
    Promise.resolve(window.northstarOperatorSession).then(session => {
      document.getElementById('accountUsername').textContent = session?.username || 'Username unavailable';
      document.getElementById('accountRole').textContent = session?.role === 'platform_demo' ? 'Platform demo' : session?.role === 'operator' ? 'Operator' : session?.required ? 'Signed-in operator' : 'Dashboard access';
      const signOut = document.getElementById('accountSignOut');
      if (session?.required && session?.authenticated) {
        signOut.hidden = false;
        signOut.addEventListener('click', () => document.querySelector('.operator-signout')?.click());
      }
    }).catch(() => {
      document.getElementById('accountUsername').textContent = 'Unavailable';
      document.getElementById('accountRole').textContent = 'Unavailable';
    });
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
