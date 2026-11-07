// An embedded document has its own CSS cascade. Resolve the palette on the
// module element so per-module overrides take precedence over dashboard defaults.
(() => {
  const host = window.frameElement?.closest('#arcFlashStudio');
  if (!host) return;
  const palette = {
    '--canvas': ['--panel2','--bg'], '--paper': ['--panel','--p'],
    '--ink': ['--text','--t'], '--muted': ['--muted','--m'],
    '--line': ['--line','--l'], '--accent': ['--gold','--g','--accent'],
    '--link': ['--blue','--accent2']
  };
  function sync() {
    const style = getComputedStyle(host);
    for (const [key, names] of Object.entries(palette)) {
      const value = names.map(name => style.getPropertyValue(name).trim()).find(Boolean);
      if (value) document.documentElement.style.setProperty(key, value);
    }
    document.documentElement.style.setProperty('--studio-font', style.fontFamily);
  }
  sync();
  const observer = new MutationObserver(sync);
  for (let node = host; node; node = node.parentElement) {
    observer.observe(node, { attributes: true, attributeFilter: ['class','style','data-theme','data-ns-theme'] });
  }
})();
