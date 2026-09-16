/* Interactive build badge and build-history dialog. */
(() => {
  'use strict';

  const buildData = window.NORTHSTAR_BUILD_DATA;
  if (!buildData?.current || !Array.isArray(buildData.history)) return;

  const formatDate = value => {
    const [year, month, day] = String(value).split('-').map(Number);
    if (!year || !month || !day) return String(value);
    return new Intl.DateTimeFormat(undefined, {
      timeZone: 'UTC', year: 'numeric', month: 'long', day: 'numeric'
    }).format(new Date(Date.UTC(year, month - 1, day)));
  };

  const overview = () => {
    const button = document.querySelector('#sideNav [data-tab="overview"]');
    if (button) {
      button.click();
      return;
    }
    location.hash = 'overview';
    document.querySelector('#overview')?.scrollIntoView({ block: 'start' });
  };

  const setAssistantIcon = () => {
    const assistantControl = document.getElementById('aiOpen');
    if (!assistantControl) return;
    assistantControl.textContent = '✦';
    assistantControl.title = 'Open NorthStar AI';
    assistantControl.setAttribute('aria-label', 'Open NorthStar AI');
  };

  const createHistoryDialog = () => {
    const existing = document.getElementById('northstarBuildHistory');
    if (existing) return existing;

    const dialog = document.createElement('dialog');
    dialog.id = 'northstarBuildHistory';
    dialog.className = 'northstar-build-history';
    dialog.setAttribute('aria-labelledby', 'northstarBuildHistoryTitle');

    const panel = document.createElement('section');
    panel.className = 'northstar-build-history-panel';
    const header = document.createElement('header');
    const title = document.createElement('h2');
    title.id = 'northstarBuildHistoryTitle';
    title.textContent = 'Build history';
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'northstar-build-history-close';
    close.setAttribute('aria-label', 'Close build history');
    close.textContent = '×';
    close.addEventListener('click', () => dialog.close());
    header.append(title, close);

    const list = document.createElement('ol');
    list.className = 'northstar-build-history-list';
    buildData.history.forEach(record => {
      const item = document.createElement('li');
      const meta = document.createElement('div');
      const version = document.createElement('strong');
      version.textContent = record.version;
      const date = document.createElement('time');
      date.dateTime = record.published;
      date.textContent = formatDate(record.published);
      meta.append(version, date);
      const summary = document.createElement('p');
      summary.textContent = record.summary;
      summary.title = record.summary;
      item.append(meta, summary);
      list.append(item);
    });

    const note = document.createElement('p');
    note.className = 'northstar-build-history-note';
    note.textContent = 'Release history begins with the first recorded dashboard build.';
    panel.append(header, list, note);
    dialog.append(panel);
    dialog.addEventListener('click', event => {
      if (event.target === dialog) dialog.close();
    });
    document.body.append(dialog);
    return dialog;
  };

  const init = () => {
    setAssistantIcon();
    const brand = document.querySelector('aside .brand');
    if (!brand) return;

    brand.classList.add('brand-home');
    brand.querySelector(':scope > small')?.remove();
    let home = brand.querySelector('.brand-home-control');
    if (!home) {
      home = document.createElement('button');
      home.type = 'button';
      home.className = 'brand-home-control';
      home.setAttribute('aria-label', 'Go to main overview');
      [...brand.children]
        .filter(node => node.matches('img, .brand-name, small'))
        .forEach(node => home.append(node));
      brand.prepend(home);
    }
    home.addEventListener('click', overview);

    let badge = brand.querySelector('.build-label');
    if (badge?.tagName !== 'BUTTON') {
      const replacement = document.createElement('button');
      replacement.type = 'button';
      replacement.className = 'build-label';
      badge?.replaceWith(replacement);
      badge = replacement;
    }
    if (!badge) return;

    const current = buildData.current;
    const published = formatDate(current.published);
    badge.className = 'build-label dashboard-build-label';
    badge.type = 'button';
    badge.textContent = current.version;
    badge.dataset.buildDate = `Built ${published}`;
    badge.title = `Built ${published}`;
    badge.setAttribute('aria-label', `${current.version}, built ${published}. Open build history.`);
    badge.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      const dialog = createHistoryDialog();
      if (!dialog.open) dialog.showModal();
    });

    window.NorthstarBuild = Object.freeze({
      current: Object.freeze({ ...current }),
      history: Object.freeze(buildData.history.map(record => Object.freeze({ ...record })))
    });
  };

  // Existing inline build-label migrations finish during DOMContentLoaded.
  // Run after that queue so this controller owns the final badge.
  const start = () => setTimeout(init, 0);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
