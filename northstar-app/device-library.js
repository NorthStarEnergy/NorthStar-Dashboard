/**
 * Company device library (Tools).
 *
 * Operations → Plants → plant folders, plus area/site equipment.
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
          <p>Plant records are filed by Operations → Plants → plant folders. Area and site equipment records remain available below.</p>
        </div>
        <div class="dl-counts" id="dlCounts"></div>
      </div>
      <p class="dl-caution" id="dlCaution">Reference library only. Records do not command equipment. Notes do not acknowledge or clear alarms.</p>
      <div class="dl-layout">
        <div class="dl-tree-pane">
          <div class="dl-tree-tools">
            <input id="dlSearch" type="search" maxlength="200" placeholder="Search plants, devices, sites, folders" aria-label="Search the device library">
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
    let equipmentMaster = { query: '', site: '', page: 1 };
    let dataCatalog = { collectionId: '' };

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
        if (node.kind === 'area' || node.id === 'folder:company:operations') expanded.add(node.id);
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
      const reportHref = value => {
        const href = String(value || '');
        return href.startsWith('event-detail.html?id=') ? href : '';
      };
      const notes = (record.notes || []).map(note => {
        const schedule = note.expired
          ? `Expired ${esc(when(note.expiresAt))}`
          : note.expiresAt
            ? `Expires ${esc(when(note.expiresAt))}`
            : note.persistOn
              ? `Persists on ${esc(note.persistOn)}`
              : '';
        const href = reportHref(note.href) || (note.eventId || note.id
          ? `event-detail.html?id=${encodeURIComponent(note.eventId || note.id)}` : '');
        return `<li class="${note.expired ? 'expired' : ''}"><small>${esc(when(note.createdAt))} · ${esc(note.actorId)}${schedule ? ` · ${schedule}` : ''}</small>${esc(note.text)}${href ? `<a class="dl-event-link" href="${esc(href)}">Open event report</a>` : ''}</li>`;
      }).join('');
      const eventRows = (record.events || []).map(event => {
        const href = reportHref(event.href) || (event.eventId
          ? `event-detail.html?id=${encodeURIComponent(event.eventId)}` : '');
        if (!href) return '';
        return `<li><a class="dl-event" href="${esc(href)}">${esc(event.summary || event.eventType)}<small>${esc(when(event.occurredAt))} · ${esc(event.category || event.source || '')} · ${esc(event.severity || '')}</small></a></li>`;
      }).join('');
      const procedureRows = (record.procedures || []).map(procedure => {
        const id = String(procedure.id || '');
        if (!/^flc-[a-f0-9]{16}$/.test(id)) return '';
        const href = `/api/library/procedures/${id}/file`;
        const detail = [procedure.procedureCode, procedure.revision, procedure.language, procedure.kind, 'OPEN PDF']
          .filter(Boolean).map(value => esc(String(value))).join(' · ');
        return `<li><a class="dl-event" href="${esc(href)}" target="_blank" rel="noopener">${esc(procedure.title || procedure.filename || 'Legacy SOP PDF')}<small>${detail}</small></a></li>`;
      }).join('');
      const scheduled = record.menuKey === 'notes';
      nodes.detail.innerHTML = `
        <p class="dl-crumb">${esc(crumb || record.name)}</p>
        <h4>${esc(record.name)}</h4>
        <p>${esc(record.description || record.note || '')}</p>
        ${fields(record)}
        ${contents ? `<div class="dl-contents">${contents}</div>` : ''}
        ${record.state === 'Setup pending' ? `<div class="dl-conditions">
          <h5>${esc(record.name)}</h5>
          <p class="dl-status">${esc(record.state)} · ${esc(record.description || '')}</p>
        </div>` : ''}
        <p class="dl-status">${esc(record.note || '')}</p>
        ${record.menuKey === 'maximo-database' ? '<div class="dl-maximo" id="dlMaximo"><p class="dl-status">Loading Maximo…</p></div>' : ''}
        ${record.menuKey === 'maximo-equipment-master' ? '<div class="dl-maximo" id="dlMaximoEquipment"><p class="dl-status">Loading equipment master…</p></div>' : ''}
        ${record.menuKey === 'operations-data-catalog' ? '<div class="dl-maximo" id="dlDataCatalog"><p class="dl-status">Loading operations data catalog…</p></div>' : ''}
        ${record.procedureSource ? `<div class="dl-events dl-procedures">
          <h5>${esc(record.procedureSource.name || 'Procedure library')}</h5>
          <p class="dl-status">${esc(record.procedureSource.status || '')} · ${esc(record.procedureSource.notice || '')}</p>
          <ul class="dl-event-list">${procedureRows || '<li class="dl-status">No matching legacy SOP PDFs are installed for this library item.</li>'}</ul>
        </div>` : ''}
        <div class="dl-events">
          <h5>Event reports</h5>
          <p class="dl-status">Recorded events, reports and alarms open a dedicated log. This list stays empty until a write exists. It does not invent readings or acknowledge alarms.</p>
          <ul class="dl-event-list">${eventRows || '<li class="dl-status">No recorded events for this item yet.</li>'}</ul>
        </div>
        <form class="dl-notes" id="dlNoteForm">
          <h5>Append-only notes</h5>
          <p class="dl-status">A note is recorded against this library item. It does not acknowledge, clear, or change an alarm.${scheduled ? ' Expired notes stay on the record.' : ''}</p>
          <textarea id="dlNoteText" maxlength="8000" required placeholder="Operator note"></textarea>
          ${scheduled ? `<fieldset class="dl-note-schedule">
            <legend>Schedule</legend>
            <label><input type="radio" name="dlNoteWhen" value="persist" checked> Persist on date</label>
            <label><input type="radio" name="dlNoteWhen" value="expire"> Time expiry</label>
            <label><input type="radio" name="dlNoteWhen" value="none"> No schedule</label>
            <input id="dlPersistOn" type="date" aria-label="Persist on date">
            <input id="dlExpiresAt" type="datetime-local" aria-label="Expiry date and time" hidden>
          </fieldset>` : ''}
          <button type="submit">ADD NOTE</button>
          <p class="dl-status" id="dlNoteStatus"></p>
          <ul class="dl-note-list">${notes || '<li class="dl-status">No notes yet.</li>'}</ul>
        </form>`;
      if (scheduled) {
        const persist = host.querySelector('#dlPersistOn');
        const expiry = host.querySelector('#dlExpiresAt');
        const syncSchedule = () => {
          const mode = host.querySelector('input[name="dlNoteWhen"]:checked')?.value;
          persist.hidden = mode !== 'persist';
          expiry.hidden = mode !== 'expire';
        };
        host.querySelectorAll('input[name="dlNoteWhen"]').forEach(input => {
          input.addEventListener('change', syncSchedule);
        });
        syncSchedule();
      }
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
        if (record.menuKey === 'maximo-database' && record.siteId) loadMaximo(record.siteId, token);
        if (record.menuKey === 'maximo-equipment-master') {
          equipmentMaster = { query: '', site: '', page: 1 };
          loadMaximoEquipment(token);
        }
        if (record.menuKey === 'operations-data-catalog') {
          dataCatalog = { collectionId: '' };
          loadDataCatalog(token);
        }
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
        ${rows(snapshot.workOrders || [], snapshot.configured ? 'No Maximo work orders returned for this station.' : 'Work orders are read-only from Maximo. None are shown until the connection is authorized.')}
        ${snapshot.equipmentMaster?.available ? `<p class="dl-status">The local equipment master has ${esc(String(snapshot.equipmentMaster.assetCount || 0))} assets across ${esc(String(snapshot.equipmentMaster.siteCount || 0))} Maximo site codes. <button type="button" data-open="menu:company:maximo-equipment-master">Open equipment master</button></p>` : ''}`;
    }

    function renderMaximoEquipment(snapshot) {
      const box = host.querySelector('#dlMaximoEquipment');
      if (!box) return;
      const source = snapshot.source || {};
      const assetCount = Number(snapshot.assetCount || 0);
      const siteCount = Number(snapshot.siteCount || 0);
      const options = (snapshot.sites || []).map(row => `<option value="${esc(row.code)}"${row.code === snapshot.site ? ' selected' : ''}>${esc(row.code)} (${esc(String(row.assets || 0))})</option>`).join('');
      const rows = (snapshot.assets || []).map(asset => `<tr>
        <td>${esc(asset.assetNum)}</td><td>${esc(asset.description)}</td><td>${esc(asset.location)}</td>
        <td>${esc(asset.locationDescription)}</td><td>${esc(asset.parent)}</td><td>${esc(asset.rotatingItem)}</td><td>${esc(asset.site)}</td>
      </tr>`).join('');
      const first = snapshot.total ? (snapshot.page - 1) * snapshot.limit + 1 : 0;
      const last = snapshot.total ? Math.min(snapshot.page * snapshot.limit, snapshot.total) : 0;
      const canPrevious = snapshot.page > 1;
      const canNext = snapshot.page < snapshot.pages;
      const importedAt = source.importedAt ? `Imported ${esc(when(source.importedAt))}` : '';
      box.innerHTML = `
        <h5>Maximo Equipment Master</h5>
        <p class="dl-status">${esc(snapshot.state || 'No imported equipment master')} · ${esc(String(assetCount))} assets · ${esc(String(siteCount))} Maximo site codes</p>
        ${source.filename ? `<p class="dl-crumb">${esc(source.filename)}${source.sheetName ? ` \\ ${esc(source.sheetName)}` : ''}${importedAt ? ` \\ ${importedAt}` : ''}</p>` : ''}
        ${snapshot.available ? `<form class="dl-maximo-controls" id="dlMaximoEquipmentSearch">
          <label>Search<input id="dlMaximoSearch" type="search" maxlength="200" value="${esc(snapshot.query)}" placeholder="Asset, description, location, parent" aria-label="Search Maximo equipment"></label>
          <label>Site<select id="dlMaximoSite" aria-label="Filter by Maximo site"><option value="">All sites</option>${options}</select></label>
          <button type="submit">Search</button>
        </form>
        <p class="dl-status">${snapshot.total ? `Showing ${esc(String(first))}–${esc(String(last))} of ${esc(String(snapshot.total))} matching assets.` : 'No matching assets.'}</p>
        <div class="dl-maximo-table"><table><thead><tr><th>Asset</th><th>Asset description</th><th>Location</th><th>Location description</th><th>Parent</th><th>Rotating item</th><th>Site</th></tr></thead><tbody>${rows || '<tr><td colspan="7" class="dl-status">No matching assets.</td></tr>'}</tbody></table></div>
        ${snapshot.pages > 1 ? `<div class="dl-maximo-pages"><button type="button" data-maximo-page="${esc(String(snapshot.page - 1))}"${canPrevious ? '' : ' disabled'}>Previous</button><span>Page ${esc(String(snapshot.page))} of ${esc(String(snapshot.pages))}</span><button type="button" data-maximo-page="${esc(String(snapshot.page + 1))}"${canNext ? '' : ' disabled'}>Next</button></div>` : ''}` : ''}`;
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

    async function loadMaximoEquipment(token) {
      const params = new URLSearchParams();
      if (equipmentMaster.query) params.set('q', equipmentMaster.query);
      if (equipmentMaster.site) params.set('site', equipmentMaster.site);
      params.set('page', String(equipmentMaster.page));
      try {
        const snapshot = await json(`/api/maximo/equipment?${params}`);
        if (token !== loadToken) return;
        equipmentMaster = { query: snapshot.query || '', site: snapshot.site || '', page: snapshot.page || 1 };
        renderMaximoEquipment(snapshot);
      } catch (error) {
        if (token !== loadToken) return;
        const box = host.querySelector('#dlMaximoEquipment');
        if (box) box.innerHTML = `<h5>Maximo Equipment Master</h5><p class="dl-error">${esc(error.status === 404
          ? 'The Maximo API needs a backend service restart.'
          : error.message)}</p>`;
      }
    }

    function refreshMaximoEquipment(page) {
      equipmentMaster.page = page;
      const token = ++loadToken;
      const box = host.querySelector('#dlMaximoEquipment');
      if (box) box.innerHTML = '<p class="dl-status">Loading equipment master…</p>';
      loadMaximoEquipment(token);
    }

    function bytes(value) {
      const count = Number(value || 0);
      if (!Number.isFinite(count) || count < 1) return 'Size not supplied';
      const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];
      let amount = count;
      let unit = 0;
      while (amount >= 1024 && unit < units.length - 1) { amount /= 1024; unit += 1; }
      return `${amount >= 10 || unit === 0 ? amount.toFixed(0) : amount.toFixed(1)} ${units[unit]}`;
    }

    function renderDataCatalog(snapshot) {
      const box = host.querySelector('#dlDataCatalog');
      if (!box) return;
      const run = snapshot.latestRun || {};
      const collections = (snapshot.collections || []).map(collection => `<tr>
        <td><button type="button" data-data-catalog-collection="${esc(collection.id)}">${esc(collection.title)}</button></td>
        <td>${esc(collection.domain)}</td><td>${esc(collection.state)}</td>
        <td>${esc(String(collection.artifactCount || 0))}</td>
      </tr>`).join('');
      const artifacts = (snapshot.artifacts || []).map(artifact => `<tr>
        <td>${esc(artifact.relativePath)}</td><td>${esc(artifact.origin)}</td>
        <td>${esc(artifact.status)}</td><td>${esc(bytes(artifact.byteCount))}</td>
        <td>${esc(artifact.sha256 ? artifact.sha256.slice(0, 16) : 'Not supplied')}</td>
      </tr>`).join('');
      const selected = (snapshot.collections || []).find(item => item.id === snapshot.selectedCollectionId);
      box.innerHTML = `
        <h5>Operations Data Catalog</h5>
        <p class="dl-status">${esc(snapshot.note || '')}</p>
        <p class="dl-status">${snapshot.summary?.catalogReady
          ? `${esc(String(snapshot.summary.collectionCount || 0))} collections · ${esc(String(snapshot.summary.artifactCount || 0))} active catalog entries`
          : 'Catalog has not run yet. Run an intake refresh to index the known source collections.'}</p>
        <p class="dl-status">${run.completedAt ? `Last intake: ${esc(when(run.completedAt))} · ${esc(run.state || '')}` : 'No completed intake run yet.'}
          <button type="button" data-data-catalog-refresh>REFRESH CATALOG</button></p>
        <div class="dl-maximo-table"><table><thead><tr><th>Collection</th><th>Domain</th><th>State</th><th>Entries</th></tr></thead>
          <tbody>${collections || '<tr><td colspan="4" class="dl-status">No source collections cataloged yet.</td></tr>'}</tbody></table></div>
        ${selected ? `<h6>${esc(selected.title)} · source entries</h6><p class="dl-status">${esc(selected.description || '')}</p>
          <div class="dl-maximo-table"><table><thead><tr><th>Path</th><th>Origin</th><th>Status</th><th>Size</th><th>SHA-256</th></tr></thead>
          <tbody>${artifacts || '<tr><td colspan="5" class="dl-status">No active entries for this collection.</td></tr>'}</tbody></table></div>` : ''}`;
    }

    async function loadDataCatalog(token) {
      const params = new URLSearchParams();
      if (dataCatalog.collectionId) params.set('collectionId', dataCatalog.collectionId);
      try {
        const snapshot = await json(`/api/data-catalog${params.toString() ? `?${params}` : ''}`);
        if (token !== loadToken) return;
        renderDataCatalog(snapshot);
      } catch (error) {
        if (token !== loadToken) return;
        const box = host.querySelector('#dlDataCatalog');
        if (box) box.innerHTML = `<h5>Operations Data Catalog</h5><p class="dl-error">${esc(error.status === 404
          ? 'The data-catalog update needs a backend service restart.'
          : error.message)}</p>`;
      }
    }

    async function refreshDataCatalog() {
      const box = host.querySelector('#dlDataCatalog');
      if (box) box.innerHTML = '<p class="dl-status">Cataloging source metadata…</p>';
      const token = ++loadToken;
      try {
        await json('/api/data-catalog/refresh', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
        });
        if (token !== loadToken) return;
        dataCatalog.collectionId = '';
        loadDataCatalog(token);
      } catch (error) {
        if (token !== loadToken) return;
        if (box) box.innerHTML = `<p class="dl-error">${esc(error.message)}</p>`;
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
      if (open) {
        select(open.dataset.open);
        return;
      }
      const page = event.target.closest('[data-maximo-page]');
      if (page && !page.disabled) refreshMaximoEquipment(Number(page.dataset.maximoPage));
      const collection = event.target.closest('[data-data-catalog-collection]');
      if (collection) {
        dataCatalog.collectionId = collection.dataset.dataCatalogCollection || '';
        const token = ++loadToken;
        loadDataCatalog(token);
        return;
      }
      if (event.target.closest('[data-data-catalog-refresh]')) refreshDataCatalog();
    });

    nodes.detail.addEventListener('submit', async event => {
      if (event.target.matches('#dlMaximoEquipmentSearch')) {
        event.preventDefault();
        equipmentMaster.query = host.querySelector('#dlMaximoSearch')?.value.trim() || '';
        equipmentMaster.site = host.querySelector('#dlMaximoSite')?.value || '';
        refreshMaximoEquipment(1);
        return;
      }
      if (!event.target.matches('#dlNoteForm')) return;
      event.preventDefault();
      const text = host.querySelector('#dlNoteText')?.value || '';
      const status = host.querySelector('#dlNoteStatus');
      const mode = host.querySelector('input[name="dlNoteWhen"]:checked')?.value;
      const persistOn = mode === 'persist' ? (host.querySelector('#dlPersistOn')?.value || '') : '';
      const expiresRaw = mode === 'expire' ? (host.querySelector('#dlExpiresAt')?.value || '') : '';
      let expiresAt = '';
      if (mode === 'persist' && !persistOn) {
        if (status) status.textContent = 'Enter a persist-on date.';
        return;
      }
      if (mode === 'expire') {
        const parsed = expiresRaw ? new Date(expiresRaw) : null;
        if (!parsed || Number.isNaN(parsed.valueOf())) {
          if (status) status.textContent = 'Enter an expiry date and time.';
          return;
        }
        expiresAt = parsed.toISOString();
      }
      try {
        const result = await json('/api/library/notes', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ itemId: selectedId, text, requestId: requestId(), expiresAt, persistOn }),
        });
        if (status) {
          const href = String(result.href || '').startsWith('event-detail.html?id=') ? result.href : '';
          status.innerHTML = href
            ? `Note recorded. <a class="dl-event-link" href="${esc(href)}">Open event report</a>`
            : 'Note recorded.';
        }
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
