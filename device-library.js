/**
 * Company device library (Tools).
 *
 * Area → site → Info / Operating Conditions / Data → station folders → devices.
 * Left pane is a Windows-style folder tree; folder glyphs are nested sunflowers.
 * Reference data only. Notes are append-only and never acknowledge alarms.
 */
(() => {
  const boot = () => {
    const host = document.querySelector('#deviceLibrary');
    if (!host || host.dataset.ready === '1') return;
    host.dataset.ready = '1';

    const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
    const requestId = () => (globalThis.crypto?.randomUUID?.()
      || `libnote_${Date.now()}_${Math.random().toString(16).slice(2)}`);
    const when = value => {
      const date = value ? new Date(value) : null;
      return date && !Number.isNaN(date.valueOf())
        ? date.toLocaleString([], {
          year: 'numeric', month: 'short', day: '2-digit',
          hour: '2-digit', minute: '2-digit', hour12: false,
        })
        : 'Time not supplied';
    };

    host.innerHTML = `
      <div class="dl-head">
        <div>
          <h3>Device Library</h3>
          <p>Company repository by area and site. Each generating station opens with Info, Operating Conditions, and Data.</p>
        </div>
        <div class="dl-counts" id="dlCounts"></div>
      </div>
      <p class="dl-caution" id="dlCaution">Reference library only. Records do not command equipment. Notes do not acknowledge or clear alarms.</p>
      <div class="dl-layout">
        <div class="dl-tree-pane">
          <div class="dl-tree-tools">
            <input id="dlSearch" type="search" maxlength="200" placeholder="Search devices, sites, folders" aria-label="Search the device library">
            <button type="button" id="dlExpand">Expand</button>
            <button type="button" id="dlCollapse">Collapse</button>
          </div>
          <div class="dl-tree" id="dlTree" role="tree" aria-label="Company folders"></div>
        </div>
        <div class="dl-detail" id="dlDetail"><div class="dl-empty">Select a folder or device.</div></div>
      </div>`;

    const nodes = {
      counts: host.querySelector('#dlCounts'),
      caution: host.querySelector('#dlCaution'),
      search: host.querySelector('#dlSearch'),
      expand: host.querySelector('#dlExpand'),
      collapse: host.querySelector('#dlCollapse'),
      tree: host.querySelector('#dlTree'),
      detail: host.querySelector('#dlDetail'),
    };

    let snapshot = null;
    let selectedId = 'company:northstar';
    let expanded = new Set();
    let query = '';
    let searchTimer = 0;
    let loadToken = 0;

    async function json(url, options = {}) {
      const response = await fetch(url, { cache: 'no-store', ...options });
      let body;
      try { body = await response.json(); } catch {
        throw Error('The library service returned an unreadable response.');
      }
      if (!response.ok) {
        const error = Error(body.error || `Request failed (${response.status}).`);
        error.status = response.status;
        throw error;
      }
      return body;
    }

    function walk(node, visit) {
      if (!node) return;
      visit(node);
      (node.children || []).forEach(child => walk(child, visit));
    }

    function pathTo(itemId, node = snapshot?.tree, trail = []) {
      if (!node) return null;
      const next = trail.concat(node);
      if (node.id === itemId) return next;
      for (const child of node.children || []) {
        const found = pathTo(itemId, child, next);
        if (found) return found;
      }
      return null;
    }

    function expandDefaults() {
      expanded = new Set(['company:northstar']);
      walk(snapshot?.tree, node => {
        if (node.kind === 'area') expanded.add(node.id);
      });
    }

    function expandVisible() {
      walk(snapshot?.tree, node => {
        if ((node.children || []).length) expanded.add(node.id);
      });
    }

    function collectExpandable(into) {
      walk(snapshot?.tree, node => {
        if ((node.children || []).length) into.add(node.id);
      });
    }

    function renderTree() {
      const root = snapshot?.tree;
      if (!root) {
        nodes.tree.innerHTML = '<div class="dl-empty">Loading…</div>';
        return;
      }
      const paint = (node) => {
        const kids = node.children || [];
        const folder = node.kind !== 'device';
        const open = folder && expanded.has(node.id);
        const twist = folder ? (open ? '▾' : '▸') : '';
        const icon = folder
          ? '<i class="dl-sunflower" aria-hidden="true"></i>'
          : '<i class="dl-file" aria-hidden="true"></i>';
        const active = selectedId === node.id ? ' active' : '';
        let html = `<li role="none">
          <button type="button" class="dl-node${active}" role="treeitem"
            aria-expanded="${folder ? (open ? 'true' : 'false') : 'false'}"
            data-id="${esc(node.id)}" data-kind="${esc(node.kind)}">
            <span class="dl-twist">${twist}</span>${icon}<span class="dl-label">${esc(node.name)}</span>
          </button>`;
        if (open && kids.length) {
          html += `<ul class="dl-kids" role="group">${kids.map(paint).join('')}</ul>`;
        }
        return `${html}</li>`;
      };
      nodes.tree.innerHTML = `<ul role="none">${paint(root)}</ul>`;
      const counts = snapshot.counts || {};
      nodes.counts.innerHTML = `${esc(String(counts.areas ?? 0))} areas<br>${esc(String(counts.sites ?? 0))} sites<br>${esc(String(counts.devices ?? 0))} devices`;
      if (snapshot.note) nodes.caution.textContent = snapshot.note;
    }

    function fields(record) {
      const rows = [
        ['Kind', record.kind === 'menu' ? 'Station menu' : record.kind],
        ['Menu', record.menuKey],
        ['Class', record.className],
        ['Folder', record.folder],
        ['Site', record.site],
        ['Area', record.area],
        ['Voltage', record.voltage],
        ['Rating', record.rating],
        ['State', record.state],
      ].filter(([, value]) => value);
      if (!rows.length) return '';
      return `<div class="dl-meta">${rows.map(([label, value]) =>
        `<div><span>${esc(label)}</span><b>${esc(value)}</b></div>`).join('')}</div>`;
    }

    function renderDetail(record) {
      const trail = pathTo(record.id) || [];
      const crumb = trail.map(node => node.name).join(' \\ ');
      const contents = (record.contents || []).map(child =>
        `<button type="button" data-open="${esc(child.id)}">${esc(child.name)}<small> ${esc(child.kind || child.className || '')}</small></button>`
      ).join('');
      const notes = (record.notes || []).map(note =>
        `<li><small>${esc(when(note.createdAt))} · ${esc(note.actorId)}</small>${esc(note.text)}</li>`
      ).join('');
      nodes.detail.innerHTML = `
        <p class="dl-crumb">${esc(crumb || record.name)}</p>
        <h4>${esc(record.name)}</h4>
        <p>${esc(record.description || record.note || '')}</p>
        ${fields(record)}
        ${contents ? `<div class="dl-contents">${contents}</div>` : ''}
        ${record.menuKey === 'operating-conditions' ? `<div class="dl-conditions">
          <h5>Operating conditions</h5>
          <p class="dl-status">${esc(record.state || 'Setup pending')} · Live operating conditions are not shown until an authorized station feed is connected. This record does not invent readings or command equipment.</p>
        </div>` : ''}
        <p class="dl-status">${esc(record.note || '')}</p>
        ${record.menuKey === 'data' ? '<div class="dl-maximo" id="dlMaximo"><p class="dl-status">Loading Maximo…</p></div>' : ''}
        <form class="dl-notes" id="dlNoteForm">
          <h5>Append-only notes</h5>
          <p class="dl-status">A note is recorded against this library item. It does not acknowledge, clear, or change an alarm.</p>
          <textarea id="dlNoteText" maxlength="8000" required placeholder="Operator note"></textarea>
          <button type="submit">ADD NOTE</button>
          <p class="dl-status" id="dlNoteStatus"></p>
          <ul class="dl-note-list">${notes || '<li class="dl-status">No notes yet.</li>'}</ul>
        </form>`;
    }

    async function select(itemId, expandAncestors = true) {
      selectedId = itemId;
      if (expandAncestors) {
        (pathTo(itemId) || []).forEach(node => {
          if (node.kind !== 'device') expanded.add(node.id);
        });
      }
      renderTree();
      const token = ++loadToken;
      nodes.detail.innerHTML = '<div class="dl-empty">Loading…</div>';
      try {
        const record = await json(`/api/library/item?id=${encodeURIComponent(itemId)}`);
        if (token !== loadToken) return;
        renderDetail(record);
        if (record.menuKey === 'data' && record.siteId) loadMaximo(record.siteId, token);
      } catch (error) {
        if (token !== loadToken) return;
        nodes.detail.innerHTML = `<div class="dl-error">${esc(error.status === 404
          ? 'The library update needs a backend service restart.'
          : error.message)}</div>`;
      }
    }

    function renderMaximo(snapshot) {
      const box = host.querySelector('#dlMaximo');
      if (!box) return;
      const rows = (items, empty) => items.length
        ? `<table><thead><tr><th>ID</th><th>Description</th><th>Status</th></tr></thead><tbody>${
          items.map(item => `<tr><td>${esc(item.assetNum || item.woNum)}</td><td>${esc(item.description)}</td><td>${esc(item.status)}</td></tr>`).join('')
        }</tbody></table>`
        : `<p class="dl-status">${esc(empty)}</p>`;
      box.innerHTML = `
        <h5>Maximo</h5>
        <p class="dl-status">${esc(snapshot.state || 'Setup pending')} · ${esc(snapshot.note || '')}</p>
        <p class="dl-crumb">${esc(snapshot.station?.maximoSiteId || '')} \\ ${esc(snapshot.station?.maximoLocation || '')}</p>
        <h6>Assets</h6>
        ${rows(snapshot.assets || [], snapshot.configured ? 'No Maximo assets returned for this station.' : 'Maximo is not connected. Station asset records will appear here after authorized setup.')}
        <h6>Work orders</h6>
        ${rows(snapshot.workOrders || [], snapshot.configured ? 'No Maximo work orders returned for this station.' : 'Work orders are read-only from Maximo. None are shown until the connection is authorized.')}`;
    }

    async function loadMaximo(stationId, token) {
      try {
        const snapshot = await json(`/api/maximo/station?id=${encodeURIComponent(stationId)}`);
        if (token !== loadToken) return;
        renderMaximo(snapshot);
      } catch (error) {
        if (token !== loadToken) return;
        const box = host.querySelector('#dlMaximo');
        if (box) box.innerHTML = `<h5>Maximo</h5><p class="dl-error">${esc(error.status === 404
          ? 'The Maximo API needs a backend service restart.'
          : error.message)}</p>`;
      }
    }

    async function loadTree() {
      const params = new URLSearchParams();
      if (query) params.set('q', query);
      try {
        snapshot = await json(`/api/library${params.toString() ? `?${params}` : ''}`);
        if (query) expandVisible();
        else if (!expanded.size) expandDefaults();
        if (!pathTo(selectedId)) selectedId = snapshot.tree?.id || 'company:northstar';
        renderTree();
        await select(selectedId, false);
      } catch (error) {
        nodes.tree.innerHTML = `<div class="dl-error">${esc(error.status === 404
          ? 'The library update needs a backend service restart.'
          : error.message)}</div>`;
      }
    }

    nodes.tree.addEventListener('click', event => {
      const button = event.target.closest('.dl-node');
      if (!button) return;
      const itemId = button.dataset.id;
      const folder = button.dataset.kind !== 'device';
      if (event.target.closest('.dl-twist') && folder) {
        if (expanded.has(itemId)) expanded.delete(itemId);
        else expanded.add(itemId);
        renderTree();
        return;
      }
      if (folder && !expanded.has(itemId)) expanded.add(itemId);
      select(itemId);
    });

    nodes.tree.addEventListener('keydown', event => {
      const button = event.target.closest('.dl-node');
      if (!button) return;
      const itemId = button.dataset.id;
      const folder = button.dataset.kind !== 'device';
      if (event.key === 'ArrowRight' && folder) {
        event.preventDefault();
        expanded.add(itemId);
        renderTree();
        nodes.tree.querySelector(`[data-id="${CSS.escape(itemId)}"]`)?.focus();
      } else if (event.key === 'ArrowLeft' && folder) {
        event.preventDefault();
        expanded.delete(itemId);
        renderTree();
        nodes.tree.querySelector(`[data-id="${CSS.escape(itemId)}"]`)?.focus();
      } else if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        select(itemId);
      }
    });

    nodes.detail.addEventListener('click', event => {
      const open = event.target.closest('[data-open]');
      if (open) select(open.dataset.open);
    });

    nodes.detail.addEventListener('submit', async event => {
      if (!event.target.matches('#dlNoteForm')) return;
      event.preventDefault();
      const text = host.querySelector('#dlNoteText')?.value || '';
      const status = host.querySelector('#dlNoteStatus');
      try {
        await json('/api/library/notes', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ itemId: selectedId, text, requestId: requestId() }),
        });
        if (status) status.textContent = 'Note recorded.';
        await select(selectedId, false);
      } catch (error) {
        if (status) status.textContent = error.message;
      }
    });

    nodes.search.addEventListener('input', () => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => {
        query = nodes.search.value.trim();
        if (!query) expandDefaults();
        loadTree();
      }, 180);
    });
    nodes.expand.addEventListener('click', () => {
      collectExpandable(expanded);
      renderTree();
    });
    nodes.collapse.addEventListener('click', () => {
      expanded = new Set([snapshot?.tree?.id || 'company:northstar']);
      renderTree();
    });

    document.querySelector('#openDeviceLibrary')?.addEventListener('click', () => {
      document.querySelector('[data-tab="tools"]')?.click();
      host.scrollIntoView({ behavior: 'smooth', block: 'start' });
      nodes.search.focus();
    });

    loadTree();
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
