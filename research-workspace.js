/* Curated, shared research snapshots. Source files live in research/projects. */
(() => {
  'use strict';
  const catalog = window.NorthstarResearchCatalog;
  let sharedReader = false;
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const safeUrl = url => /^https?:\/\//i.test(url) ? url : '';
  const fileLink = (label, url, project) => {
    const file = project.files.find(f => f.name === url);
    if (file) return '<button type="button" class="research-inline-file" data-research-file="'+esc(file.name)+'">'+label+'</button>';
    return safeUrl(url) ? '<a href="'+esc(url)+'" target="_blank" rel="noopener noreferrer">'+label+'</a>' : label+' <span class="research-reference">('+esc(url)+')</span>';
  };
  function inline(text, project) {
    const tokens=[];
    const token = html => '\u0000'+(tokens.push(html)-1)+'\u0000';
    text = text.replace(/`([^`]+)`/g, (_,v)=>token('<code>'+esc(v)+'</code>'));
    text = text.replace(/\[([^\]]+)\]\(([^\s)]+)\)/g,(_,label,url)=>token(fileLink(esc(label),url,project)));
    return esc(text).replace(/\*\*([^*]+)\*\*/g,'<strong>$1</strong>').replace(/\u0000(\d+)\u0000/g,(_,n)=>tokens[Number(n)]);
  }
  function markdown(text, project) {
    const lines=text.replace(/\r/g,'').split('\n'); let html='',list='',code=null;
    const close=()=>{if(list){html+='</'+list+'>';list='';}};
    for(let i=0;i<lines.length;i++) {
      const line=lines[i];
      if(/^```/.test(line)){close();if(code!==null){html+='<pre><code>'+esc(code.join('\n'))+'</code></pre>';code=null;}else code=[];continue;}
      if(code!==null){code.push(line);continue;}
      if(!line.trim()){close();continue;}
      if(line.startsWith('|') && /^\s*\|?\s*:?-{3}/.test(lines[i+1]||'')) {
        close();const cells=s=>s.trim().replace(/^\||\|$/g,'').split('|').map(x=>x.trim());
        html+='<div class="research-table"><table><thead><tr>'+cells(line).map(c=>'<th>'+inline(c,project)+'</th>').join('')+'</tr></thead><tbody>';i++;
        while((lines[i+1]||'').startsWith('|'))html+='<tr>'+cells(lines[++i]).map(c=>'<td>'+inline(c,project)+'</td>').join('')+'</tr>';
        html+='</tbody></table></div>';continue;
      }
      const heading=/^(#{1,6})\s+(.+)/.exec(line);
      if(heading){close();const n=Math.min(heading[1].length+1,6);html+='<h'+n+'>'+inline(heading[2],project)+'</h'+n+'>';continue;}
      const item=/^\s*(?:([-*])|\d+[.)])\s+(.+)/.exec(line);
      if(item){const tag=item[1]?'ul':'ol';if(list!==tag){close();list=tag;html+='<'+tag+'>';}html+='<li>'+inline(item[2],project)+'</li>';continue;}
      close();html+=line.startsWith('>')?'<blockquote>'+inline(line.replace(/^>\s?/,''),project)+'</blockquote>':'<p>'+inline(line,project)+'</p>';
    }
    close();if(code!==null)html+='<pre><code>'+esc(code.join('\n'))+'</code></pre>';return html;
  }
  function mountReportCapture(root) {
    if(sharedReader)return;
    const panel=document.createElement('section');
    panel.className='research-report-capture';
    panel.setAttribute('aria-label','Daily report numbers & screenshots');
    panel.innerHTML='<div><strong>Daily report numbers & screenshots</strong><p>Pull public report readings, 10 weather forecasts and 3 flow graphs.</p></div><div class="research-report-actions"><button type="button" data-report-capture disabled>Pull daily report now</button><a href="daily-report-automation.html" target="_blank" rel="noopener noreferrer">View numbers &amp; downloads ↗</a></div><p data-report-status role="status" aria-live="polite">Checking report service…</p>';
    root.querySelector('.research-header').after(panel);
    const button=panel.querySelector('[data-report-capture]'),status=panel.querySelector('[data-report-status]');
    let timer,requesting=false;
    const active=run=>['queued','running'].includes(run?.state);
    async function request(route,post=false) {
      const response=await fetch('/api/daily-report/'+route,{credentials:'same-origin',cache:'no-store',...(post?{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'}:{})});
      if(response.status===401||response.status===403)throw Error('Sign in to pull daily-report screenshots.');
      const data=await response.json();
      if(!response.ok)throw Error(data.error||'Report service unavailable. Try again.');
      return data;
    }
    function poll(){clearTimeout(timer);timer=setTimeout(()=>{if(panel.isConnected)refresh();},5000);}
    async function refresh() {
      try {
        const data=await request('status'),run=data.runs.find(active)||data.runs[0];
        button.disabled=requesting||!data.configured||active(run);
        button.textContent=active(run)?'Pulling daily report…':'Pull daily report now';
        if(!data.configured){status.textContent='Report template is not configured. Open numbers & downloads for setup status.';return;}
        if(active(run)){status.textContent='Collecting report numbers, weather screenshots and flow graphs. This can take several minutes.';poll();return;}
        if(!run){status.textContent='Ready to pull report numbers and all 13 images.';return;}
        const detail=await request('run?id='+encodeURIComponent(run.id));
        const count=(detail.captures||[]).filter(c=>c.status==='captured').length;
        const fields=detail.inputs?.fields||[];
          const collected=fields.filter(f=>['collected','trace'].includes(f.status)).length;
          status.textContent=collected+'/'+fields.length+' public readings available · '+count+'/13 images captured · '+run.day+'. '+
          (['failed','interrupted'].includes(run.state)?'Run '+run.state+'. '+(run.error||'Try again.'):
          count===13?'All screenshots are available. Open numbers & downloads to review.':'Some images are unavailable. Open numbers & downloads for details, or try again.');
      }catch(error){button.disabled=false;button.textContent='Pull daily report now';status.textContent=error.message;}
    }
    button.addEventListener('click',async()=>{
      if(requesting)return;
      requesting=true;clearTimeout(timer);button.disabled=true;button.textContent='Pulling daily report…';status.textContent='Starting daily report collection…';
      try{await request('refresh',true);requesting=false;await refresh();}
      catch(error){requesting=false;button.disabled=false;button.textContent='Pull daily report now';status.textContent=error.message;}
    });
    refresh();
  }
  function mount(root) {
    if(root.dataset.researchMounted)return;root.dataset.researchMounted='true';root.classList.add('research-workspace');
    if (!catalog) {
      root.innerHTML='<header class="research-header"><div><h2>Research</h2><p>Research projects and references.</p></div></header><p role="status">Research catalog is unavailable on this installation. The dashboard and daily report screenshots remain available.</p>';
      mountReportCapture(root);
      return;
    }
    let selected=catalog.projects[0],activeFile=selected?.files[0],query='',category='';
    root.innerHTML='<header class="research-header"><div><h2>Research</h2><p>All '+catalog.projects.length+' projects and '+catalog.projects.reduce((n,p)=>n+p.files.length,0)+' files are available to every signed-in account. Read and download them here.</p></div><a class="research-folder" href="'+esc(catalog.driveFolder)+'" target="_blank" rel="noopener noreferrer">Research folder ↗</a></header><div class="research-filters"><label>Search projects<input type="search" data-research-search placeholder="River, station, topic or document"></label><label>Category<select data-research-category><option value="">All categories</option>'+[...new Set(catalog.projects.map(p=>p.category))].map(c=>'<option>'+esc(c)+'</option>').join('')+'</select></label><span data-research-count role="status" aria-live="polite"></span></div><div class="research-layout"><nav class="research-projects" aria-label="Research projects"></nav><section class="research-detail" aria-label="Selected research project"></section></div>';
    mountReportCapture(root);
    const nav=root.querySelector('.research-projects'),detail=root.querySelector('.research-detail');
    function renderList() {
      const matches=catalog.projects.filter(p=>(!category||p.category===category)&&[p.title,p.summary,p.category,...p.tags,...p.files.map(f=>f.name+' '+(f.text||''))].join(' ').toLowerCase().includes(query));
      root.querySelector('[data-research-count]').textContent=matches.length+' of '+catalog.projects.length+' projects';
      nav.innerHTML=matches.length?matches.map(p=>'<button type="button" data-research-project="'+esc(p.id)+'" aria-current="'+(p.id===selected?.id?'true':'false')+'"><small>'+esc(p.category)+' · '+esc(p.date)+'</small><strong>'+esc(p.title)+'</strong><span>'+esc(p.summary)+'</span><em>'+p.files.length+(p.files.length===1?' file · ':' files · ')+esc(p.status)+'</em></button>').join(''):'<p class="research-empty">No matching projects. Try another search or category.</p>';
      if((selected&&!matches.some(p=>p.id===selected.id))||(!selected&&matches.length)){selected=matches[0];activeFile=selected?.files[0];renderDetail();renderList();}
    }
    function renderDetail() {
      if(!selected){detail.innerHTML='<p class="research-empty">Choose a project to read its reports and supporting files.</p>';return;}
      detail.innerHTML='<header><h3 tabindex="-1" data-research-title>'+esc(selected.title)+'</h3><p>'+esc(selected.summary)+'</p><p class="research-status">'+esc(selected.status)+' · Snapshot '+esc(selected.date)+'</p><p class="research-note">'+esc(selected.note)+'</p>'+ (selected.driveFolder?'<a href=\"'+esc(selected.driveFolder)+'\" target=\"_blank\" rel=\"noopener noreferrer\">Project folder ↗</a>':'')+'</header><div class="research-files" aria-label="Project files">'+selected.files.map(f=>'<button type="button" data-research-file="'+esc(f.name)+'" aria-pressed="'+(f===activeFile)+'">'+esc(f.label||f.name)+'</button>').join('')+'</div><div class="research-document-bar"><strong>'+esc(activeFile?.name)+'</strong><button type="button" data-research-download>Download file</button></div><article class="research-document" aria-label="Document contents"></article>';
      const body=detail.querySelector('.research-document');
      body.innerHTML=activeFile?.text!=null?(activeFile.name.endsWith('.md')?markdown(activeFile.text,selected):'<pre>'+esc(activeFile.text)+'</pre>'):'<p>This supporting archive is available to download.</p>';
    }
    root.addEventListener('input',e=>{if(e.target.matches('[data-research-search]')){query=e.target.value.trim().toLowerCase();renderList();}});
    root.addEventListener('change',e=>{if(e.target.matches('[data-research-category]')){category=e.target.value;renderList();}});
    root.addEventListener('click',e=>{
      const project=e.target.closest('[data-research-project]'),file=e.target.closest('[data-research-file]');
      if(project){selected=catalog.projects.find(p=>p.id===project.dataset.researchProject);activeFile=selected.files[0];renderList();renderDetail();detail.querySelector('[data-research-title]').focus({preventScroll:true});}
      else if(file){const next=selected.files.find(f=>f.name===file.dataset.researchFile);if(next){activeFile=next;renderDetail();}}
      else if(e.target.closest('[data-research-download]')&&activeFile){const bytes=Uint8Array.from(atob(activeFile.base64),c=>c.charCodeAt(0));const url=URL.createObjectURL(new Blob([bytes],{type:activeFile.mime}));const a=document.createElement('a');a.href=url;a.download=activeFile.name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
    });
    renderList();renderDetail();
  }
  function start() {
    document.querySelectorAll('[data-research-root]').forEach(mount);
    const host=document.getElementById('operations-sites')||document.getElementById('operations');
    if(host&&!document.getElementById('operationsResearch')){const el=document.createElement('article');el.id='operationsResearch';el.className='panel';el.dataset.moduleId='research';el.setAttribute('aria-label','Research');host.append(el);mount(el);}
  }
  function ready() {
    Promise.resolve(window.northstarOperatorSession).then(session=>{
      if(session?.required&&!session.authenticated){location.replace('/operator-login.html');return;}
      sharedReader=session?.role==='site_viewer';
      start();
    }).catch(()=>{});
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',ready);else ready();
})();
