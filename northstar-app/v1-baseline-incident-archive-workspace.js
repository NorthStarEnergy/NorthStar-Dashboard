(() => {
  'use strict';

  const EMPTY_CATALOG = { available: false, readOnly: true, caseCount: 0, categories: [], years: [], source: {} };
  const EMPTY_RESULTS = { available: false, page: 1, limit: 60, total: 0, pages: 0, records: [], source: {} };
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
  const options = (items, key, selected, allLabel) => [
    `<option value="">${allLabel}</option>`,
    ...items.map(item => `<option value="${escape(item[key])}"${item[key] === selected ? ' selected' : ''}>${escape(item[key])} · ${Number(item.count || 0).toLocaleString('en-CA')}</option>`),
  ].join('');

  let catalog = { ...EMPTY_CATALOG };
  let results = { ...EMPTY_RESULTS };
  let filters = { query: '', category: '', year: '', page: 1 };
  let message = '';

  async function api(path) {
    const response = await fetch(path, { headers: { Accept: 'application/json' } });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || `Request failed (${response.status})`);
    return body;
  }

  function sourceLine(source) {
    if (!source?.filename) return 'No legacy incident archive has been indexed yet.';
    const indexed = source.indexedAt ? ` · indexed ${escape(formatTime(source.indexedAt))}` : '';
    const hash = source.sha256 ? ` · SHA-256 ${escape(String(source.sha256).slice(0, 12))}…` : '';
    return `${escape(source.filename)}${indexed}${hash}`;
  }

  function row(record) {
    const formats = Array.isArray(record.formats) && record.formats.length ? record.formats.join(', ').replaceAll('.', '').toUpperCase() : '—';
    return `<tr>
      <td><b>${escape(record.occurredOn)}</b><small>${escape(record.incidentId)}</small></td>
      <td><strong>${escape(record.title)}</strong><small>${escape(record.category)}</small></td>
      <td><span class="incident-archive-count">${Number(record.reportCount || 0).toLocaleString('en-CA')}</span><small>NARRATIVE REPORTS</small></td>
      <td><span class="incident-archive-count">${Number(record.evidenceFileCount || 0).toLocaleString('en-CA')}</span><small>ASSOCIATED FILES</small></td>
      <td><small>${escape(formats)}</small></td>
    </tr>`;
  }

  function render(root) {
    const source = catalog.source?.filename ? catalog.source : results.source;
    const first = results.total ? (results.page - 1) * results.limit + 1 : 0;
    const last = results.total ? Math.min(results.total, first + results.records.length - 1) : 0;
    root.innerHTML = `<section class="panel incident-archive-hero">
      <div><label>INCIDENT ARCHIVE · METADATA-ONLY REFERENCE</label><h2>Legacy incident report index</h2><p class="muted-note">Search historical incident metadata without exposing the archived documents or turning this reference into an active-control surface. Use Current Outages for a live event.</p></div>
      <div class="incident-archive-source"><span>READ-ONLY</span><small>${sourceLine(source)}</small><button class="secondary-btn" type="button" data-incident-open-current>OPEN CURRENT OUTAGES</button></div>
    </section>
    <section class="incident-archive-metrics">
      <article><span>INDEXED CASES</span><b>${Number(catalog.caseCount || 0).toLocaleString('en-CA')}</b></article>
      <article><span>SOURCE FILES</span><b>${Number(source?.fileCount || 0).toLocaleString('en-CA')}</b></article>
      <article><span>CATEGORIES</span><b>${Number((catalog.categories || []).length).toLocaleString('en-CA')}</b></article>
      <article><span>MATCHING CASES</span><b>${Number(results.total || 0).toLocaleString('en-CA')}</b></article>
    </section>
    <section class="panel incident-archive-controls"><form id="incidentArchiveFilters">
      <label>SEARCH<input name="query" type="search" maxlength="200" value="${escape(filters.query)}" placeholder="Incident ID, title, category"></label>
      <label>CATEGORY<select name="category">${options(catalog.categories || [], 'category', filters.category, 'ALL CATEGORIES')}</select></label>
      <label>YEAR<select name="year">${options(catalog.years || [], 'year', filters.year, 'ALL YEARS')}</select></label>
      <button class="primary-btn" type="submit">APPLY FILTERS</button><button class="secondary-btn" type="button" data-incident-reset>RESET</button>
    </form><p>${message ? escape(message) : `Showing ${first}–${last} of ${Number(results.total || 0).toLocaleString('en-CA')} indexed incident cases.`}</p></section>
    <section class="panel incident-archive-table-panel"><div class="incident-archive-table-scroll"><table class="incident-archive-table"><thead><tr><th>DATE / INCIDENT</th><th>TITLE / CATEGORY</th><th>REPORTS</th><th>FILES</th><th>FORMATS</th></tr></thead><tbody>${results.records.length ? results.records.map(row).join('') : '<tr><td colspan="5" class="incident-archive-empty">No archived incident cases match the current filter.</td></tr>'}</tbody></table></div>
      <div class="incident-archive-pages"><span>${results.pages ? `PAGE ${results.page} OF ${results.pages}` : 'NO PAGES'}</span><button type="button" data-incident-page="${results.page - 1}"${results.page <= 1 ? ' disabled' : ''}>PREVIOUS</button><button type="button" data-incident-page="${results.page + 1}"${!results.pages || results.page >= results.pages ? ' disabled' : ''}>NEXT</button></div>
    </section>
    <p class="incident-archive-note">This index is metadata only. The original archive remains the authoritative source; use approved records-management procedures to access, review, or distribute source documents.</p>`;
    window.NorthstarModules?.refresh?.();
  }

  async function load(root) {
    const params = new URLSearchParams();
    if (filters.query) params.set('q', filters.query);
    if (filters.category) params.set('category', filters.category);
    if (filters.year) params.set('year', filters.year);
    params.set('page', String(filters.page));
    try {
      const [nextCatalog, nextResults] = await Promise.all([
        api('/api/incident-library/catalog'),
        api(`/api/incident-library?${params}`),
      ]);
      catalog = nextCatalog;
      results = nextResults;
      filters.page = Number(nextResults.page || 1);
      message = '';
    } catch (error) {
      catalog = { ...EMPTY_CATALOG };
      results = { ...EMPTY_RESULTS };
      message = `INCIDENT ARCHIVE UNAVAILABLE · ${error.message}`;
    }
    render(root);
  }

  function init() {
    const root = document.querySelector('#incidentArchiveWorkspace');
    if (!root) return;
    root.addEventListener('submit', event => {
      if (!event.target.matches('#incidentArchiveFilters')) return;
      event.preventDefault();
      const data = new FormData(event.target);
      filters = {
        query: String(data.get('query') || '').trim(),
        category: String(data.get('category') || ''),
        year: String(data.get('year') || ''),
        page: 1,
      };
      load(root);
    });
    root.addEventListener('click', event => {
      const target = event.target.closest('button');
      if (!target) return;
      if (target.matches('[data-incident-reset]')) {
        filters = { query: '', category: '', year: '', page: 1 };
        load(root);
      } else if (target.matches('[data-incident-open-current]')) {
        document.querySelector('[data-outage-tab="current"]')?.click();
      } else if (target.dataset.incidentPage && !target.disabled) {
        filters.page = Number(target.dataset.incidentPage);
        load(root);
      }
    });
    render(root);
    load(root);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
