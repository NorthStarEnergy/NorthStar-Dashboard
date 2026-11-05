(() => {
  'use strict';

  const EMPTY = {
    available: false, readOnly: true, recordCount: 0, openCount: 0, statuses: [], source: {},
  };
  const EMPTY_RESULTS = {
    available: false, page: 1, limit: 75, total: 0, pages: 0, records: [], source: {},
  };
  const escape = value => String(value ?? '').replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[character]));
  const formatTime = value => {
    if (!value) return '—';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return escape(value);
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Toronto', month: 'short', day: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit', hour12: false,
    }).format(date) + ' ET';
  };
  const dueClass = state => ({
    OVERDUE: 'overdue', 'DUE NEXT 7 DAYS': 'soon', OPEN: 'open', CLOSED: 'closed', 'NO TARGET': 'no-target',
  }[state] || 'no-target');
  const statusOptions = (items, selected) => [
    '<option value="">ALL STATUSES</option>',
    ...items.map(item => `<option value="${escape(item.status)}"${item.status === selected ? ' selected' : ''}>${escape(item.status)} · ${Number(item.count || 0).toLocaleString('en-CA')}</option>`),
  ].join('');

  let catalog = { ...EMPTY };
  let results = { ...EMPTY_RESULTS };
  let filters = { query: '', status: '', due: '', page: 1 };
  let message = '';

  async function api(path) {
    const response = await fetch(path, { headers: { Accept: 'application/json' } });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || `Request failed (${response.status})`);
    return body;
  }

  function sourceLine(source) {
    if (!source?.filename) return 'No snapshot has been imported yet.';
    const hash = source.sha256 ? ` · SHA-256 ${String(source.sha256).slice(0, 12)}…` : '';
    return `${escape(source.filename)}${source.sheetName ? ` · ${escape(source.sheetName)}` : ''}${source.importedAt ? ` · imported ${escape(formatTime(source.importedAt))}` : ''}${hash}`;
  }

  function recordRow(record) {
    return `<tr>
      <td><b>${escape(record.serviceRequest)}</b><small>${escape(record.classification || 'Unclassified')}</small></td>
      <td><strong>${escape(record.summary || 'No summary')}</strong><small>${escape(record.location || 'No location')}</small></td>
      <td><span class="service-status">${escape(record.status)}</span><small>${escape(record.priority || 'No priority')}</small></td>
      <td><span class="service-due ${dueClass(record.dueState)}">${escape(record.dueState)}</span><small>${escape(formatTime(record.targetFinish))}</small></td>
      <td>${escape(record.owner || 'Unassigned')}<small>${escape(record.ownerGroup || '')}</small></td>
      <td>${escape(formatTime(record.reportedAt))}</td>
    </tr>`;
  }

  function render(root) {
    const source = catalog.source?.filename ? catalog.source : results.source;
    const first = results.total ? (results.page - 1) * results.limit + 1 : 0;
    const last = results.total ? Math.min(results.total, first + results.records.length - 1) : 0;
    root.innerHTML = `<section class="panel service-requests-hero">
      <div><label>SERVICE REQUESTS · READ-ONLY MAXIMO SNAPSHOT</label><h2>Maintenance request register</h2><p class="muted-note">Search the imported Service Requests report without turning the dashboard into a Maximo write surface. No request is created, assigned, changed, or closed here.</p></div>
      <div class="service-source"><span class="service-readonly">READ-ONLY</span><small>${sourceLine(source)}</small></div>
    </section>
    <section class="service-request-metrics">
      <article><span>IMPORTED REQUESTS</span><b>${Number(catalog.recordCount || 0).toLocaleString('en-CA')}</b></article>
      <article><span>OPEN / ACTIVE</span><b>${Number(catalog.openCount || 0).toLocaleString('en-CA')}</b></article>
      <article><span>MATCHING FILTER</span><b>${Number(results.total || 0).toLocaleString('en-CA')}</b></article>
      <article><span>SNAPSHOT STATUS</span><b>${catalog.available ? 'LOADED' : 'WAITING'}</b></article>
    </section>
    <section class="panel service-request-controls"><form id="serviceRequestFilters">
      <label>SEARCH<input name="query" type="search" maxlength="200" value="${escape(filters.query)}" placeholder="Request, summary, location, owner"></label>
      <label>STATUS<select name="status">${statusOptions(catalog.statuses || [], filters.status)}</select></label>
      <label>DUE STATE<select name="due"><option value="">ALL REQUESTS</option><option value="open"${filters.due === 'open' ? ' selected' : ''}>OPEN / ACTIVE</option><option value="overdue"${filters.due === 'overdue' ? ' selected' : ''}>OVERDUE</option><option value="next_7"${filters.due === 'next_7' ? ' selected' : ''}>DUE NEXT 7 DAYS</option></select></label>
      <button class="primary-btn" type="submit">APPLY FILTERS</button><button class="secondary-btn" type="button" data-service-reset>RESET</button>
    </form><p>${message ? escape(message) : `Showing ${first}–${last} of ${Number(results.total || 0).toLocaleString('en-CA')} matching source rows.`}</p></section>
    <section class="panel service-request-table-panel"><div class="service-request-table-scroll"><table class="service-request-table"><thead><tr><th>REQUEST</th><th>SUMMARY / LOCATION</th><th>STATUS</th><th>TARGET</th><th>OWNER</th><th>REPORTED</th></tr></thead><tbody>${results.records.length ? results.records.map(recordRow).join('') : '<tr><td colspan="6" class="service-request-empty">No service requests match the current filter.</td></tr>'}</tbody></table></div>
      <div class="service-request-pages"><span>${results.pages ? `PAGE ${results.page} OF ${results.pages}` : 'NO PAGES'}</span><button type="button" data-service-page="${results.page - 1}"${results.page <= 1 ? ' disabled' : ''}>PREVIOUS</button><button type="button" data-service-page="${results.page + 1}"${!results.pages || results.page >= results.pages ? ' disabled' : ''}>NEXT</button></div>
    </section>
    <p class="service-request-note">The source remains a dated, imported report. Use approved Maximo workflows for any operational change or confirmation.</p>`;
    window.NorthstarModules?.refresh?.();
  }

  async function load(root) {
    const params = new URLSearchParams();
    if (filters.query) params.set('q', filters.query);
    if (filters.status) params.set('status', filters.status);
    if (filters.due) params.set('due', filters.due);
    params.set('page', String(filters.page));
    try {
      const [nextCatalog, nextResults] = await Promise.all([
        api('/api/service-requests/catalog'),
        api(`/api/service-requests?${params}`),
      ]);
      catalog = nextCatalog;
      results = nextResults;
      filters.page = Number(nextResults.page || 1);
      message = '';
    } catch (error) {
      catalog = { ...EMPTY };
      results = { ...EMPTY_RESULTS };
      message = `SERVICE REQUEST SNAPSHOT UNAVAILABLE · ${error.message}`;
    }
    render(root);
  }

  function init() {
    const root = document.querySelector('#serviceRequestsWorkspace');
    if (!root) return;
    root.addEventListener('submit', event => {
      if (!event.target.matches('#serviceRequestFilters')) return;
      event.preventDefault();
      const data = new FormData(event.target);
      filters = {
        query: String(data.get('query') || '').trim(),
        status: String(data.get('status') || ''),
        due: String(data.get('due') || ''),
        page: 1,
      };
      load(root);
    });
    root.addEventListener('click', event => {
      const target = event.target.closest('button');
      if (!target) return;
      if (target.matches('[data-service-reset]')) {
        filters = { query: '', status: '', due: '', page: 1 };
        load(root);
      } else if (target.dataset.servicePage && !target.disabled) {
        filters.page = Number(target.dataset.servicePage);
        load(root);
      }
    });
    render(root);
    load(root);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
