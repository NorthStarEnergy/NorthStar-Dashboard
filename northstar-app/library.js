(() => {
 'use strict';
 const q=new URLSearchParams(location.search),requestedBuild=q.get('buildView')||q.get('build'),build=['v1','v2','v3'].includes(requestedBuild)?requestedBuild:'v1';
 const shell=(build==='v3'?'northstar-clean.html':'northstar-v1.html')+'?buildView='+build;
 const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const url=id=>'library.html?build='+build+(id?'&item='+encodeURIComponent(id):'');
 const root=window.NorthstarLibraryRoot||document;
 const main=root.getElementById('main');
 async function start(){
  const session=await window.northstarOperatorSession;
  if(!session?.authenticated&&session?.required){location.replace('operator-login.html');return;}
  if(!window.NorthstarLibraryRoot){root.getElementById('home').href=shell+'#overview';
  root.getElementById('navigation').innerHTML=[['Overview','overview'],['Check-ins','crew'],['Events','logbook'],['Operations','operations'],['Markets','markets'],['Agent','assistant'],['Weather','weather'],['Library','library'],['Live status','live-status']].map(([label,id])=>'<a '+(id==='library'?'aria-current="page" ':'')+'href="'+(id==='library'?url():shell+'#'+id)+'">'+label+'</a>').join('');}
  const projects=window.NorthstarResearchCatalog?.projects||[];
  const items=[{id:'daily-report',title:'Daily operating report',type:'Reports',summary:'Water readings, weather forecasts, flow graphs and downloads.',status:'Available',href:'daily-report-automation.html'},...projects.map(p=>({id:'research:'+p.id,title:p.title,type:'Research',summary:p.summary,date:p.date,status:p.status,project:p})),
   {id:'assets',title:'Station and device library',type:'Assets',summary:'Equipment, drawings and reference records by area and site.',disabled:true},
   {id:'schematic-builder',title:'Schematic builder',type:'Tools',summary:'Dedicated one-line drawing workspace.',status:'Available',href:shell+'&nsModuleWindow='+encodeURIComponent('tools:schematic-builder')},
   {id:'data-connections',title:'Data connections',type:'Tools',summary:'Connection information and provider setup.',status:'Available',href:shell+'&nsModuleWindow='+encodeURIComponent('tools:data-connections')},
   {id:'data-workspace',title:'Data workspace',type:'Tools',summary:'Datasets, calculations, saved scripts and charts.',disabled:true},
   {id:'flows',title:'Water flows',type:'Tools',summary:'Water-source monitoring and operational data workspace.',disabled:true},
   {id:'training',title:'Switching Simulator',type:'Tools',summary:'Island / Twin / Iroquois r013 training single-line. Source-qualified draft.',status:'Available',disabled:session?.role!=='operator',href:'northstar-clean.html?buildView=v3&nsModuleWindow=training%3Aswitching-simulator'}];
  const item=items.find(i=>i.id===q.get('item'));
  if(q.has('item')){if(!item){main.innerHTML='<a href="'+url()+'">Back to Library</a><h1>Item not found</h1><p>This link does not identify a Library item.</p>';return;}detail(item);return;}
  main.classList.add('library-index');
  main.innerHTML='<header><h1>Library</h1></header><div class="filters"><label>Search<input id="search" type="search" placeholder="Title, station or topic"></label><label>Type<select id="type"><option>All</option><option>Reports</option><option>Research</option><option>Assets</option><option>Tools</option></select></label></div><p class="count muted" role="status" id="count"></p><div class="list" id="list"></div><div id="itemInfo" popover="auto" aria-label="Item details"></div>';
  const info=root.getElementById('itemInfo');let infoButton=null;
  info.addEventListener('toggle',e=>{if(infoButton)infoButton.setAttribute('aria-expanded',String(e.newState==='open'));});
  root.getElementById('list').addEventListener('click',e=>{
   const button=e.target.closest('[data-info]');if(!button)return;
   if(infoButton===button&&info.matches(':popover-open')){info.hidePopover();return;}
   if(infoButton)infoButton.setAttribute('aria-expanded','false');
   const i=items.find(i=>i.id===button.dataset.info);if(!i)return;infoButton=button;
   info.innerHTML='<strong>'+esc(i.title)+'</strong><p>'+esc(i.summary)+'</p><p class="muted">'+esc(i.type)+' · '+esc(i.date||'No snapshot date')+' · '+esc(i.disabled?'Disabled':i.status)+'</p>'+(i.disabled?'<span class="disabled">This module remains disabled.</span>':'<a href="'+url(i.id)+'">Open '+esc(i.type==='Research'?'report':'workspace')+' →</a>');
   info.showPopover();button.setAttribute('aria-expanded','true');
   const box=button.getBoundingClientRect(),width=info.offsetWidth,height=info.offsetHeight;
   info.style.left=Math.max(12,Math.min(box.right-width,innerWidth-width-12))+'px';
   info.style.top=Math.max(12,Math.min(box.bottom+6,innerHeight-height-12))+'px';
  });
  window.addEventListener('resize',()=>info.hidePopover());
  const search=root.getElementById('search'),type=root.getElementById('type');search.value=q.get('q')||'';if(['Reports','Research','Assets','Tools'].includes(q.get('type')))type.value=q.get('type');
  function render(){const term=search.value.trim().toLowerCase(),matches=items.filter(i=>(type.value==='All'||i.type===type.value)&&(i.title+' '+i.summary).toLowerCase().includes(term));
   const state=new URL(location.href);state.searchParams.set('q',search.value);state.searchParams.set('type',type.value);history.replaceState(null,'',state);
   root.getElementById('count').textContent=matches.length+' items'+(!projects.length?' · Research catalog unavailable':'');
   info.hidePopover();
   root.getElementById('list').innerHTML=matches.length?matches.map(i=>'<div class="row"><div class="item-title" title="'+esc(i.title)+'">'+(i.disabled?'<strong class="disabled">'+esc(i.title)+'</strong>':'<a href="'+url(i.id)+'"><strong>'+esc(i.title)+'</strong></a>')+'</div><span class="item-type">'+i.type+'</span><span class="date muted">'+esc(i.date||'—')+'</span><span class="badge '+(i.disabled?'disabled':'')+'" title="'+esc(i.disabled?'Disabled':i.status)+'">'+esc(i.disabled?'Disabled':i.status)+'</span><button class="item-info" data-info="'+esc(i.id)+'" aria-label="Details for '+esc(i.title)+'" aria-controls="itemInfo" aria-expanded="false" title="Item details">⌄</button></div>').join(''):'<p class="empty">No matching items. Try another search or type.</p>';
  }search.oninput=render;type.onchange=render;render();
 }
 function detail(item){document.title=item.title+' · Library · NorthStar';main.innerHTML='<a class="back" href="'+url()+'">← Back to Library</a><header><small>'+item.type+'</small><h1>'+esc(item.title)+'</h1><p class="muted">'+esc(item.summary)+'</p></header>';
  if(item.disabled){main.insertAdjacentHTML('beforeend','<p role="status">This module is disabled. It has not been enabled by moving it into the Library.</p>');return;}
  if(!item.project){location.replace(item.href+(item.href.includes('?')?'&':'?')+'libraryBuild='+build);return;}
  const p=item.project;main.insertAdjacentHTML('beforeend','<p>'+esc(p.status)+' · Snapshot '+esc(p.date)+'</p><p class="muted">'+esc(p.note)+'</p><div class="file-list" aria-label="Supporting files"></div><p id="download"></p><article class="document" id="document"></article>');
  let active=p.files.find(f=>f.name===q.get('file'))||p.files[0];
  function show(){const state=new URL(location.href);state.searchParams.set('file',active.name);history.replaceState(null,'',state);
   main.querySelector('.file-list').innerHTML=p.files.map((f,n)=>'<button data-file="'+n+'" aria-pressed="'+(f===active)+'">'+esc(f.label||f.name)+'</button>').join('');
   root.getElementById('download').innerHTML='<button id="downloadFile">Download '+esc(active.name)+'</button>';
   root.getElementById('document').innerHTML=active.text!=null?(active.name.endsWith('.md')?window.NorthstarLibraryRender(active.text,p):'<pre>'+esc(active.text)+'</pre>'):'<p>Supporting archive available to download.</p>';
   root.getElementById('downloadFile').onclick=()=>{const bytes=Uint8Array.from(atob(active.base64),c=>c.charCodeAt(0)),blob=URL.createObjectURL(new Blob([bytes],{type:active.mime})),a=document.createElement('a');a.href=blob;a.download=active.name;a.click();setTimeout(()=>URL.revokeObjectURL(blob),1000);};
  }
  main.addEventListener('click',e=>{const b=e.target.closest('[data-file],[data-research-file]');if(!b)return;const file=b.dataset.file!=null?p.files[Number(b.dataset.file)]:p.files.find(f=>f.name===b.dataset.researchFile);if(file){active=file;show();}});if(active)show();else root.getElementById('document').textContent='No files available.';
 }
 start().catch(()=>{main.innerHTML='<h1>Library unavailable</h1><p>Unable to load this session. Reload to try again.</p>';});
})();
