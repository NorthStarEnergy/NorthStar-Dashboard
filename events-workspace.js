(() => {
  const FILTERS = [
    ['all', 'ALL'],
    ['alarms', 'ALARMS'],
    ['dispatch', 'DISPATCH'],
    ['market', 'MARKET'],
    ['comms', 'COMMS'],
    ['safety', 'SAFETY'],
    ['engineering', 'ENGINEERING'],
    ['system', 'SYSTEM'],
  ];

  const ICONS = {
    alarm: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 3 3 19h18L12 3zm0 14a1.25 1.25 0 1 1 0 2.5A1.25 1.25 0 0 1 12 17zm-1-2h2v-5h-2v5z"/></svg>',
    market: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M4 19V5h16v14H4zm2-2h3v-4H6v4zm5 0h3V9h-3v8zm5 0h2V7h-2v10z"/></svg>',
    dispatch: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M13 2 4 14h7l-1 8 10-14h-7l1-6z"/></svg>',
    email: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M4 5h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2zm0 2 8 5 8-5v2l-8 5-8-5V7z"/></svg>',
    teams: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M16 11c1.7 0 3-1.3 3-3s-1.3-3-3-3-3 1.3-3 3 1.3 3 3 3zm-8 0c1.7 0 3-1.3 3-3S9.7 5 8 5 5 6.3 5 8s1.3 3 3 3zm0 2c-2.7 0-8 1.3-8 4v2h16v-2c0-2.7-5.3-4-8-4zm8 0c-.3 0-.7 0-1 .1 1.2.8 2 1.9 2 3.9v2h7v-2c0-2.7-5.3-4-8-4z"/></svg>',
    phone: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M7 2h2l1 5-2 1a14 14 0 0 0 7 7l1-2 5 1v2c0 1.1-.9 2-2 2C10.1 18 6 13.9 6 8c0-1.1.9-2 2-2z"/></svg>',
    voice: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 14a3 3 0 0 0 3-3V6a3 3 0 1 0-6 0v5a3 3 0 0 0 3 3zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 14 0h-2zm-5 7v4h3v2H9v-2h3v-4z"/></svg>',
    safety: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 2 4 5v6c0 5 3.4 9.7 8 11 4.6-1.3 8-6 8-11V5l-8-3zm0 3 5 1.9V11c0 3.6-2.3 7-5 8.1C9.3 18 7 14.6 7 11V6.9l5-1.9z"/></svg>',
    outage: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z"/></svg>',
    engineering: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="m22.7 19.3-8-8 1.4-1.4 8 8-1.4 1.4zM3 17.2V21h3.8L18.8 9l-3.8-3.8L3 17.2zM5.9 19H5v-.9L14.1 9l.9.9L5.9 19z"/></svg>',
    operator: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 12a4 4 0 1 0-4-4 4 4 0 0 0 4 4zm0 2c-3.3 0-10 1.7-10 5v3h20v-3c0-3.3-6.7-5-10-5z"/></svg>',
    scada: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M4 4h16v2H4V4zm0 7h10v2H4v-2zm0 7h16v2H4v-2zm12-8 4 3-4 3V10z"/></svg>',
    field: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 2a7 7 0 0 0-7 7c0 5.2 7 13 7 13s7-7.8 7-13a7 7 0 0 0-7-7zm0 9.5A2.5 2.5 0 1 1 14.5 9 2.5 2.5 0 0 1 12 11.5z"/></svg>',
    ai: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M9 3a1 1 0 0 0-1 1v1H5a2 2 0 0 0-2 2v3h18V7a2 2 0 0 0-2-2h-3V4a1 1 0 0 0-1-1H9zm12 9H3v7a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7zM8 14h2v2H8v-2zm4 0h2v2h-2v-2z"/></svg>',
    system: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M19.4 13a7.4 7.4 0 0 0 .1-2 7.4 7.4 0 0 0-.1-2l2-1.6-2-3.4-2.4 1a7.6 7.6 0 0 0-1.7-1L15 2h-6l-.7 2.6a7.6 7.6 0 0 0-1.7 1l-2.4-1-2 3.4L4.6 9a7.4 7.4 0 0 0-.1 2 7.4 7.4 0 0 0 .1 2l-2 1.6 2 3.4 2.4-1a7.6 7.6 0 0 0 1.7 1L9 22h6l.7-2.6a7.6 7.6 0 0 0 1.7-1l2.4 1 2-3.4-2-1.6zM12 15.5A3.5 3.5 0 1 1 15.5 12 3.5 3.5 0 0 1 12 15.5z"/></svg>',
    trip: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 2 1 21h22L12 2zm1 15h-2v-2h2v2zm0-4h-2V9h2v4z"/></svg>',
    'generator-start': '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2"/><path fill="currentColor" d="M11 8h2v8h-2zM8 11h8v2H8z"/></svg>',
    'generator-stop': '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2"/><rect x="8" y="8" width="8" height="8" fill="currentColor"/></svg>',
  };

  let activeFilter = 'all';

  function esc(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function clock(value) {
    const date = value ? new Date(value) : new Date();
    return Number.isNaN(date.getTime())
      ? '--:--:--'
      : date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
  }

  function detailText(event) {
    return event.display?.detail || '';
  }

  function iconMarkup(channel, label) {
    const svg = ICONS[channel] || ICONS.operator;
    return `<span class="cip-event-icon cip-event-icon-${esc(channel)}" role="img" aria-label="${esc(label)}" title="${esc(label)}">${svg}</span>`;
  }

  function matchesFilter(event) {
    const group = event.display?.filterGroup || 'operator';
    if (activeFilter === 'all') {
      return group !== 'system' || event.display?.channel === 'alarm';
    }
    return group === activeFilter;
  }

  function renderEventRow(event) {
    const display = event.display || {};
    const channel = display.channel || 'operator';
    const severity = display.severityLabel || 'INFO';
  const correlation = event.correlationId ? event.correlationId.slice(-8) : '—';
    return `<article class="cip-log-row cip-channel-${esc(channel)} cip-sev-${esc(severity.toLowerCase())}" data-event-id="${esc(event.eventId)}">
      <div class="cip-log-time">${esc(clock(event.occurredAt))}</div>
      <div class="cip-log-icon">${iconMarkup(channel, display.channelLabel || channel.toUpperCase())}</div>
      <div class="cip-log-channel">${esc(display.channelLabel || channel.toUpperCase())}</div>
      <div class="cip-log-sev">${esc(severity)}</div>
      <div class="cip-log-actor">${esc(event.actorId || event.source || 'SYSTEM')}</div>
      <div class="cip-log-body">
        <strong>${esc(event.summary || event.eventType)}</strong>
        <p>${esc(detailText(event))}</p>
        <span class="cip-log-class">${esc(display.logClass || 'OPERATIONAL')}</span>
      </div>
      <div class="cip-log-ref" title="${esc(event.correlationId || '')}">${esc(correlation)}</div>
    </article>`;
  }

  function renderEvents() {
    const stream = document.querySelector('#eventsStream');
    const count = document.querySelector('#eventsCount');
    if (!stream) return;
    const rows = (Array.isArray(window.opsEvents) ? window.opsEvents : [])
      .filter(matchesFilter)
      .slice(0, 250);
    if (count) count.textContent = String(rows.length);
    stream.innerHTML = rows.length
      ? `<div class="cip-log-head" aria-hidden="true">
          <div>TIME</div><div></div><div>CHANNEL</div><div>SEV</div><div>OPERATOR</div><div>EVENT</div><div>REF</div>
        </div>${rows.map(renderEventRow).join('')}`
      : `<div class="muted-note">No ${esc(activeFilter)} events in the control room log.</div>`;
  }

  function ensureEventsCard() {
    const overviewRoot = document.querySelector('.overview');
    const quickLogCard = overviewRoot?.querySelector('.quick-log');
    if (!overviewRoot || !quickLogCard || document.querySelector('#eventsCard')) return;

    overviewRoot.insertAdjacentHTML(
      'beforeend',
      `<div class="events-card panel" id="eventsCard">
        <div class="events-head">
          <div>
            <h2>CONTROL ROOM LOG</h2>
            <small>NERC CIP-STYLE OPERATIONAL EVENT RECORD · APPEND-ONLY</small>
          </div>
          <div class="events-filters" id="eventFilters">
            ${FILTERS.map(([id, label], index) => `<button class="events-filter${index === 0 ? ' active' : ''}" data-event-filter="${id}" type="button">${label}</button>`).join('')}
          </div>
          <span class="events-live"><i>●</i> LIVE <b id="eventsCount">0</b></span>
        </div>
        <div class="events-log-entry" id="eventsLogEntry"><label>QUICK OPERATOR LOG ENTRY</label></div>
        <input id="eventQuery" class="events-query" type="search" placeholder="Search operator, site, alarm, market node, correlation ref…">
        <div class="events-stream" id="eventsStream"><div class="muted-note">Waiting for control room events…</div></div>
      </div>`
    );

    const eventsLogEntry = document.querySelector('#eventsLogEntry');
    const quickLogFormToMove = document.querySelector('#quickLogForm');
    const quickLogStatusToMove = document.querySelector('#quickLogStatus');
    if (eventsLogEntry && quickLogFormToMove) {
      eventsLogEntry.append(quickLogFormToMove);
      if (quickLogStatusToMove) eventsLogEntry.append(quickLogStatusToMove);
      quickLogCard.remove();
    }

    const overviewEventsCard = document.querySelector('#eventsCard');
    if (overviewEventsCard) {
      overviewEventsCard.setAttribute('data-overview-module', '');
      overviewEventsCard.dataset.moduleId = 'overview-events';
    }

    document.querySelectorAll('#eventFilters .events-filter').forEach(button => {
      button.addEventListener('click', () => {
        activeFilter = button.dataset.eventFilter || 'all';
        document.querySelectorAll('#eventFilters .events-filter').forEach(node => {
          node.classList.toggle('active', node === button);
        });
        renderEvents();
      });
    });

    let searchTimer;
    document.querySelector('#eventQuery')?.addEventListener('input', () => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => {
        if (typeof window.loadOps === 'function') window.loadOps();
      }, 250);
    });
  }

  function bindOverviewCloseButtons() {
    const closedOverviewKey = 'northstarClosedOverviewModules';
    const closedOverview = () => {
      try {
        return JSON.parse(localStorage.getItem(closedOverviewKey) || '[]');
      } catch {
        return [];
      }
    };
    const saveClosedOverview = items => {
      try {
        localStorage.setItem(closedOverviewKey, JSON.stringify(items));
      } catch {}
    };
    document.querySelectorAll('#overviewModules>[data-overview-module]').forEach(module => {
      const id = module.dataset.moduleId || module.id;
      if (!id || module.querySelector('.overview-module-close')) return;
      const close = document.createElement('button');
      close.type = 'button';
      close.className = 'overview-module-close';
      close.textContent = '×';
      close.title = 'Close section';
      close.setAttribute('aria-label', `Close ${id.replace(/^overview-/, '')} section`);
      close.onclick = () => {
        module.hidden = true;
        saveClosedOverview([...new Set([...closedOverview(), id])]);
      };
      module.append(close);
      if (closedOverview().includes(id)) module.hidden = true;
    });
  }

  window.NorthStarEvents = {
    render: renderEvents,
    detailText,
    init() {
      ensureEventsCard();
      bindOverviewCloseButtons();
      renderEvents();
      setInterval(renderEvents, 3000);
    },
  };

  window.renderNorthstarEvents = renderEvents;
  document.addEventListener('DOMContentLoaded', () => window.NorthStarEvents.init());
})();
