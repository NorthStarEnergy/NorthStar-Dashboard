(() => {
  'use strict';
  const root = document.querySelector('#engineeringSitemapTree');
  const search = document.querySelector('#engineeringSitemapSearch');
  if (!root) return;
  const tree = [
    {title:'NorthStar Control Room', kind:'system', children:[
      {title:'Live dashboard surfaces', children:[
        {title:'Operator console', detail:'northstar-clean.html · ops.northstarenergy.ca'},
        {title:'Engineering', detail:'Switching / UWPC · one-line editor · SCADA · data sitemap'},
        {title:'Worker check-in PWA', detail:'contractor-checkin.html · checkin.northstarenergy.ca'},
        {title:'Events · Crew · Field tracker · Tools · Markets · Weather · AI · Chat · Voice', detail:'Live workspaces registered by module-workspace.js'}
      ]},
      {title:'Engineering data hierarchy', children:[
        {title:'Operational records', children:[
          {title:'Work protection and switching', detail:'switching_drafts · switching_attachments · switching_draft_events'},
          {title:'One-line drawings', detail:'one_line_documents · one_line_revisions · one-line-symbol-catalogue.json'},
          {title:'Outages, logbook, alerts', detail:'outages · outage_events · logbook · alert_settings · alerts · alert_events'},
          {title:'Field, daily operations, unit cycling, water observations', detail:'field_reports · action_items · daily_operation_* · unit_cycling_records · water_observations'}
        ]},
        {title:'Telemetry and plant reference', children:[
          {title:'SCADA', detail:'scada_feeds · scada_tags · scada_readings · scada_import_batches · rejects · watermarks'},
          {title:'Device and station library', detail:'asset_registry · data/maximo/equipment-master.json · northstar_sites.py'},
          {title:'Maximo', detail:'Optional read-only connector; snapshot and authorized runtime configuration'},
          {title:'Canonical sites', detail:'northstar_sites.py · site IDs and aliases used across records'}
        ]},
        {title:'Reference and controlled sources', children:[
          {title:'UWPC 2024', detail:'northstar_uwpc.py · data/controlled-sources (protected source path)'},
          {title:'Legacy SOP library', detail:'94 PDFs · LEGACY_REFERENCE · review required · excluded from AI answering'},
          {title:'Incident archive', detail:'data/incident-library/incident-index.json'},
          {title:'Water management source set', detail:'132 CSV/TXT files · data/water-management/source/Water_Management/'},
          {title:'Maximo equipment source', detail:'data/maximo/sources/87438723.xlsx'},
          {title:'Service request source', detail:'data/service-requests/service-requests.json'}
        ]}
      ]},
      {title:'Persistence and evidence', children:[
        {title:'SQLite operational store', detail:'data/northstar.db · WAL · 46 tables · server boundary'},
        {title:'Database backups', detail:'data/backups/ · daily copies · restore_drill.py'},
        {title:'Append-only audit/event records', detail:'audit_events · domain event tables · logbook hash chain'},
        {title:'Voice binary stores', detail:'data/voice-inbox/ · data/voice-store/ · metadata in voice_* tables'},
        {title:'Browser-local state', detail:'module layout, tabs, drafts, flowchart state, saved presentation settings'},
        {title:'Runtime logs', detail:'data/northstar-backend.*.log · task-start.log · directive verification logs'}
      ]},
      {title:'HTTP API hierarchy', children:[
        {title:'Health and feeds', detail:'/api/health · /api/weather · /api/market-prices · /api/flows · /api/dispatch/apiroq · /api/readiness'},
        {title:'Worker safety', detail:'/api/checkins · /api/checkins/{id}/heartbeat · /help · /api/checkin-tokens · /api/phone-verifications'},
        {title:'Operations', detail:'/api/logbook · /api/outages · /api/alerts · /api/action-items · /api/field-reports · /api/daily-operations'},
        {title:'Engineering', detail:'/api/switching/drafts · /api/schematics · /api/uwpc · /api/scada · /api/assets · /api/maximo'},
        {title:'Reference libraries', detail:'/api/library · /api/sites · /api/incident-library · /api/service-requests · /api/controlled-sources'},
        {title:'Communication and intelligence', detail:'/api/events · /api/chat · /api/ai · /api/voice'},
        {title:'Access and layout', detail:'/api/auth/* · /api/dashboard-layout-default'}
      ]},
      {title:'Processes and external sources', children:[
        {title:'Background loops', detail:'IESO refresh · overdue/retention/backup · SCADA poll · flow refresh · dispatch tick · voice poll'},
        {title:'External read sources', detail:'IESO public reports · ECCC SWOB · Open-Meteo · Water Survey · CEHQ'},
        {title:'Optional connectors', detail:'OpenAI AI engine · Maximo read-only · Microsoft/Teams adapter'},
        {title:'Hosting boundary', detail:'Cloudflare Access / Tunnel → loopback Python server :4180'},
        {title:'Operator tools', detail:'scripts/import_* · index_incident_reports.py · verify-release.py · restore_drill.py · start-northstar.ps1'}
      ]}
    ]}
  ];
  const esc = value => String(value).replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const matches = (node, query) => !query || (node.title+' '+(node.detail||'')).toLowerCase().includes(query) || (node.children||[]).some(child => matches(child, query));
  const render = (nodes, query) => nodes.filter(node => matches(node, query)).map(node => {
    const children = node.children ? render(node.children, query) : '';
    const hasChildren = Boolean(node.children?.length);
    return `<details class="engineering-sitemap-node"${query && hasChildren ? ' open' : ''}><summary><span class="engineering-sitemap-kind">${esc(node.kind || 'data')}</span><strong>${esc(node.title)}</strong>${node.detail ? `<small>${esc(node.detail)}</small>` : ''}</summary>${hasChildren ? `<div class="engineering-sitemap-children">${children}</div>` : ''}</details>`;
  }).join('') || '<p class="engineering-sitemap-empty">No matching nodes.</p>';
  const paint = () => { const query=(search?.value||'').trim().toLowerCase();root.innerHTML=render(tree,query); };
  search?.addEventListener('input', paint);
  paint();
})();
