(() => {
  'use strict';
  const esc = v => String(v ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const link = (url, label) => /^https:\/\/(www\.ieso\.ca|reports-public\.ieso\.ca)\//.test(url || '') ? `<a target="_blank" rel="noopener noreferrer" href="${esc(url)}">${esc(label)}</a>` : esc(label);
  const status = s => s?.stale ? `Unavailable / stale: ${s.error || 'waiting for IESO'}` : `Retrieved ${s?.retrieved || s?.received || '—'}`;
  async function get(url) { const r = await fetch(url,{cache:'no-store'}); if(!r.ok)throw Error(`IESO connection unavailable (${r.status})`); return r.json(); }
  let data, pending;
  async function load(force=false) {
    if(!pending && (force || !data)) pending=get('/api/ieso-streams').then(d=>data=d).finally(()=>pending=null);
    return pending || data;
  }
  function mount(host) {
    if(host.querySelector(':scope > .ieso-streams'))return;
    const panel=document.createElement('details');panel.className='ieso-streams';panel.style.cssText='margin:16px 0;padding:12px;border:1px solid var(--border,#607080);border-radius:8px;min-width:0';
    panel.innerHTML='<summary style="cursor:pointer;font-weight:700">IESO · News, system and all public data streams</summary><div data-stream-body></div>';
    host.append(panel);
    const body=panel.querySelector('[data-stream-body]');
    async function render(force=false) {
      body.textContent='Connecting directly to IESO…';
      try {
        const d=await load(force);if(!panel.isConnected)return;
        body.innerHTML=`<p>${esc(d.scope)}</p><button type="button" data-refresh>Refresh streams</button><p role="status">Catalogue: ${esc(status(d.catalogue))}</p><label>Search reports <input data-search type="search" placeholder="Price, demand, outage, generation…"></label> <label>Category <select data-category><option>All</option>${['System','Supply and demand','Market','Settlement'].map(x=>`<option>${x}</option>`).join('')}</select></label><p data-count></p><div data-reports style="max-height:360px;overflow:auto"></div><section data-report aria-live="polite"></section><h3>IESO news</h3><p>${esc(status(d.news))} · Latest 100 articles · ${link('https://www.ieso.ca/Sector-Participants/IESO-News','All news')}</p><div style="max-height:300px;overflow:auto">${(d.news?.items||[]).map(n=>`<p>${esc(n.issued?.slice(0,10))} · ${link(n.url,n.title)}</p>`).join('')}</div><h3>System and market notifications</h3><div>${Object.entries(d.advisories?.feeds||{}).map(([name,s])=>`<p>${link(s.url,name)} · ${esc(s.count ?? '—')} notices · ${esc(status(s))}</p>`).join('') || 'Feeds warming up; refresh shortly.'}</div><div style="max-height:360px;overflow:auto">${(d.advisories?.notices||[]).map(n=>`<p><b>${esc(n.feed)}</b> · ${esc(n.issued || 'Date unavailable')}<br>${link(n.url,n.title)}<br>${esc(n.description)}</p>`).join('')}</div><p>${link('https://www.ieso.ca/Sector-Participants/RSS-Feeds/Emergency-Purchases-Sales','Emergency purchases and sales — IESO web publication')}</p>`;
        function filter(){const q=body.querySelector('[data-search]').value.toLowerCase(),c=body.querySelector('[data-category]').value;const rows=(d.catalogue?.reports||[]).filter(r=>(c==='All'||r.category===c)&&`${r.id} ${r.name}`.toLowerCase().includes(q));body.querySelector('[data-count]').textContent=`${rows.length} of ${(d.catalogue?.reports||[]).length} public report streams`;body.querySelector('[data-reports]').innerHTML=rows.map(r=>`<p><button type="button" data-id="${esc(r.id)}">${esc(r.name)}</button> <small>${esc(r.id)} · ${esc(r.category)} · Directory modified ${esc(r.published)}</small> ${link(r.url,'Source')}</p>`).join('');}
        body.querySelector('[data-search]').oninput=filter;body.querySelector('[data-category]').onchange=filter;filter();
        body.querySelector('[data-refresh]').onclick=()=>render(true);
        let selection=0;
        body.querySelector('[data-reports]').onclick=async e=>{const button=e.target.closest('[data-id]');if(!button)return;const id=button.dataset.id,request=++selection,target=body.querySelector('[data-report]');target.textContent='Loading '+id+'…';try{const r=await get('/api/ieso-report?id='+encodeURIComponent(id));if(request!==selection||!target.isConnected)return;target.innerHTML=`<h3>${esc(id)}</h3><p>${esc(status(r))}</p><p>Source publication: ${esc(r.published || 'unknown')} · ${r.latestAlias?'Latest published file':'Historical file; no latest alias available'}</p><p>${link(r.source,'Open original report')}</p><pre style="max-height:380px;overflow:auto;white-space:pre-wrap;overflow-wrap:anywhere"></pre>`;target.querySelector('pre').textContent=r.content || r.error || 'Open the original file to view this format.';
if(r.format==='xml'&&r.content){const xml=new DOMParser().parseFromString(r.content,'application/xml');if(!xml.querySelector('parsererror')){const leaves=[...xml.querySelectorAll('*')].filter(n=>!n.children.length&&n.textContent.trim());const table=document.createElement('div');table.style.cssText='max-height:380px;overflow:auto';table.innerHTML='<table><thead><tr><th>Field / context</th><th>Published value</th></tr></thead><tbody>'+leaves.slice(0,1000).map(n=>{let parts=[],node=n;while(node&&node.nodeType===1){parts.unshift(node.localName);node=node.parentElement;}return '<tr><td>'+esc(parts.join(' / '))+'</td><td>'+esc(n.textContent)+'</td></tr>';}).join('')+'</tbody></table><p>'+leaves.length+' fields; showing up to 1,000. Full source below.</p>';target.insertBefore(table,target.querySelector('pre'));}}
}catch(err){if(request===selection)target.textContent=err.message;}};
      }catch(err){body.textContent=err.message;const retry=document.createElement('button');retry.textContent='Retry';retry.onclick=()=>render(true);body.append(retry);}
    }
    panel.addEventListener('toggle',()=>{if(panel.open)render();});
    panel.refreshIeso = () => render(true);
  }
  setInterval(()=>{if(!document.hidden)document.querySelectorAll('.ieso-streams[open]').forEach(panel=>{if(!panel.contains(document.activeElement))panel.refreshIeso?.();});},300000);
  let scheduled=false;
  function scan(){scheduled=false;document.querySelectorAll('#marketDetail,[data-v3-chart]').forEach(node=>mount(node.parentElement));}
  new MutationObserver(()=>{if(!scheduled){scheduled=true;requestAnimationFrame(scan);}}).observe(document.body,{childList:true,subtree:true});scan();
})();
