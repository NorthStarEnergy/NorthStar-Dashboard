/* Interactive build badge and build-history dialog. */
(() => {
  'use strict';

  const buildData = window.NORTHSTAR_BUILD_DATA;
  if (!buildData?.current || !Array.isArray(buildData.history)) return;
  let activeAssistantRequests = 0;
  let assistantHasAnswer = false;

  const formatPublication = record => {
    const timestamp = String(record.publishedAt || '').trim();
    if (timestamp) {
        const parsed = new Date(timestamp);
        if (!Number.isNaN(parsed.getTime())) {
        return new Intl.DateTimeFormat(undefined, {
          year: 'numeric', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short'
        }).format(parsed);
      }
    }
    const value = record.published;
    const [year, month, day] = String(value).split('-').map(Number);
    if (!year || !month || !day) return String(value);
    return new Intl.DateTimeFormat(undefined, {
      timeZone: 'UTC', year: 'numeric', month: 'long', day: 'numeric'
    }).format(new Date(Date.UTC(year, month - 1, day)));
  };

  const overview = () => {
    const button = document.querySelector('#sideNav [data-tab="assistant"]');
    if (button) {
      button.click();
      window.dispatchEvent(new Event('northstar:assistant-opened'));
      return;
    }
    location.hash = 'assistant';
    document.querySelector('#assistant')?.scrollIntoView({ block: 'start' });
  };

  const applyAssistantThinkingState = () => {
    const assistantControl = document.getElementById('aiOpen');
    const thinking = activeAssistantRequests > 0;
    if (assistantControl) {
      assistantControl.classList.toggle('is-thinking', thinking);
      assistantControl.classList.toggle('has-answer', assistantHasAnswer && !thinking);
      assistantControl.setAttribute('aria-busy', String(thinking));
      assistantControl.title = thinking ? 'AGENT is thinking' : assistantHasAnswer ? 'AGENT has a new answer' : 'Open AGENT';
      assistantControl.setAttribute('aria-label', thinking ? 'AGENT is thinking' : assistantHasAnswer ? 'Open AGENT with a new answer' : 'Open AGENT');
    }
    document.querySelectorAll('.app>aside .brand-home-control img').forEach(logo => {
      logo.classList.toggle('is-ai-thinking', thinking);
    });
  };

  const setAssistantIcon = () => {
    const assistantControl = document.getElementById('aiOpen');
    if (!assistantControl) return;
    const icon = document.createElement('img');
    icon.className = 'northstar-ai-icon';
    icon.src = 'northstar-agent-icon.png';
    icon.alt = '';
    icon.setAttribute('aria-hidden', 'true');
    assistantControl.replaceChildren(icon);
    assistantControl.setAttribute('aria-label', 'Open AGENT');
    applyAssistantThinkingState();
  };

  const setAssistantThinking = active => {
    activeAssistantRequests = Math.max(0, activeAssistantRequests + (active ? 1 : -1));
    if (active) assistantHasAnswer = false;
    applyAssistantThinkingState();
  };

  document.getElementById('aiOpen')?.addEventListener('click', () => {
    assistantHasAnswer = false;
    applyAssistantThinkingState();
  });

  window.addEventListener('northstar-ai-answer', () => {
    assistantHasAnswer = true;
    applyAssistantThinkingState();
  });

  window.addEventListener('northstar-ai-thinking', event => {
    if (typeof event.detail?.active === 'boolean') setAssistantThinking(event.detail.active);
  });

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
      date.dateTime = record.publishedAt || record.published;
      date.textContent = formatPublication(record);
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
      home.setAttribute('aria-label', 'Open Agent');
      [...brand.children]
        .filter(node => node.matches('img, .brand-name, small'))
        .forEach(node => home.append(node));
      brand.prepend(home);
    }
    home.addEventListener('click', overview);

    const brandIcon = home.querySelector('img');
    if (brandIcon) {
      const menuButton = document.createElement('button');
      menuButton.type = 'button';
      menuButton.className = 'northstar-ai-menu-toggle';
      menuButton.setAttribute('aria-label', 'Open Agent');
      menuButton.title = 'Open Agent';
      menuButton.append(brandIcon);
      brand.prepend(menuButton);
      menuButton.addEventListener('click', overview);
    }

    let badge = brand.querySelector('.build-label');
    if (!badge) {
      badge = document.createElement('button');
      badge.type = 'button';
      badge.className = 'build-label';
      brand.append(badge);
    }
    if (badge?.tagName !== 'BUTTON') {
      const replacement = document.createElement('button');
      replacement.type = 'button';
      replacement.className = 'build-label';
      badge?.replaceWith(replacement);
      badge = replacement;
    }

    const current = buildData.current;
    const published = formatPublication(current);
    badge.className = 'build-label dashboard-build-label';
    badge.type = 'button';
    badge.textContent = current.version;
    badge.dataset.buildDate = `Built ${published}`;
    badge.removeAttribute('title');
    badge.setAttribute('aria-label', `${current.version}, built ${published}. Open build history.`);
    badge.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      const dialog = createHistoryDialog();
      if (!dialog.open) dialog.showModal();
    });
    const systems = document.getElementById('watchdog');
    if (systems) {
      systems.parentElement.classList.add('northstar-systems-row');
      systems.after(badge);
    }
    const buildDetails = document.createElement('p');
    buildDetails.textContent = `Built ${published}. ${current.summary || ''}`;
    window.NorthstarModulePreview.bind(badge, {
      title: () => current.version,
      source: () => buildDetails,
      open: () => {}
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
