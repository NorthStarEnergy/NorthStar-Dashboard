(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const baseFields = [{key:'_id',label:'Record ID',type:'text'},{key:'_version',label:'Revision',type:'integer'},{key:'_created_at',label:'Created at',type:'datetime'},{key:'_updated_at',label:'Updated at',type:'datetime'},{key:'_actor',label:'Last edited by',type:'text'}];
  const s = {datasets:[],id:'power',tab:'data',filters:[],draftFilters:[],rows:[],pages:[null],page:0,next:null,hidden:[],items:[],record:null,history:[],dirty:false,preview:null,formula:null,view:null,script:null,chart:null,ticket:0,chartTicket:0,jobTimer:null,connected:false};
  const model = () => s.datasets.find(d => d.id === s.id);
  const calculated = () => (model()?.formulas || []).map(f => ({key:f.name,label:f.label,type:'number',unit:f.unit,calculated:true}));
  const columns = () => [...(model()?.fields || []),...calculated(),...baseFields];
  const visible = () => columns().filter(f => !s.hidden.includes(f.key));
  const numeric = () => columns().filter(f => ['number','integer'].includes(f.type) && !f.key.startsWith('_'));
  const options = (list, selected) => list.map(f => `<option value="${esc(f.key)}" ${selected===f.key?'selected':''}>${esc(f.label)}${f.unit?' · '+esc(f.unit):''}</option>`).join('');
  const fmt = value => value === null || value === undefined ? '—' : typeof value === 'number' ? value.toLocaleString(undefined,{maximumFractionDigits:6}) : String(value);
  function notice(text,error=false) { $('notice').textContent=text; $('notice').classList.toggle('error',error); $('notice').hidden=!text; }
  async function api(action,body,name=s.id) {
    const url=action==='status'?'/api/data-workspace/status':`/api/data-workspace/${name}/${action}`;
    const r=await fetch(url,{method:body===undefined?'GET':'POST',headers:{'Accept':'application/json',...(body===undefined?{}:{'Content-Type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)})});
    let data;try{data=await r.json();}catch{throw new Error('The server returned an invalid response. Try refreshing.');}
    if(!r.ok)throw new Error(data.error || `Request failed (${r.status})`);
    return data;
  }
  function handle(fn) { return async event => { try { await fn(event); } catch(error) { notice(error.message,true); if($('formulaDialog').open)$('formulaError').textContent=error.message; } }; }
  function resetPages(){s.pages=[null];s.page=0;s.next=null;}
  let previewTicket=0;
  function invalidatePreview(){previewTicket++;s.preview=null;$('scriptPreview').hidden=true;}
  function query(){return {filters:s.filters,sort:$('sortField').value,direction:$('sortDirection').value,limit:100,cursor:s.pages[s.page]};}
  function rememberColumns(){try{localStorage.setItem('northstarDataColumns:'+s.id,JSON.stringify(s.hidden));}catch{}}
  function renderColumns(){
    $('columnsPanel').innerHTML=columns().map(f=>`<label><input type="checkbox" data-column="${esc(f.key)}" ${s.hidden.includes(f.key)?'':'checked'}>${esc(f.label)}</label>`).join('');
    $('columnsPanel').querySelectorAll('input').forEach(input=>input.onchange=()=>{if(!input.checked && visible().length<=1){input.checked=true;notice('Keep at least one column visible.',true);return;}s.hidden=s.hidden.filter(k=>k!==input.dataset.column);if(!input.checked)s.hidden.push(input.dataset.column);rememberColumns();renderGrid();});
  }
  function renderGrid(){
    const cols=visible();
    $('dataGrid').querySelector('thead').innerHTML='<tr><th class="row-number">#</th>'+cols.map(f=>`<th>${f.calculated?'ƒ ':''}${esc(f.label)}${f.unit?`<small>${esc(f.unit)}</small>`:''}</th>`).join('')+'</tr>';
    $('dataGrid').querySelector('tbody').innerHTML=s.rows.map((row,i)=>`<tr data-record="${esc(row._id)}" tabindex="0" aria-label="Open record ${i+1}"><td class="row-number">${s.page*100+i+1}</td>${cols.map(f=>`<td class="${['number','integer'].includes(f.type)?'numeric ':''}${f.calculated?'formula-cell':''}" title="${esc(fmt(row[f.key]))}">${esc(fmt(row[f.key]))}</td>`).join('')}</tr>`).join('');
    $('dataGrid').querySelectorAll('[data-record]').forEach(row=>{row.onclick=()=>openRecord(s.rows.find(r=>r._id===row.dataset.record));row.onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();row.click();}};});
    $('emptyState').hidden=!!s.rows.length;
    $('emptyState').querySelector('h2').textContent=s.filters.length?'No matching records':'No records yet';
    $('emptyState').querySelector('p').textContent=s.filters.length?'Change or clear the filters to explore this dataset.':'This dataset is ready. Its structure is in place. No data has been imported.';
    $('rowStatus').textContent=`${s.rows.length.toLocaleString()} records on this page${s.next?' · More available':''} · ${visible().length} columns`;
    $('pageNumber').textContent=`Page ${s.page+1}`;
    $('previousPage').disabled=s.page===0;$('nextPage').disabled=!s.next;
  }
  async function loadRows(){
    if(!s.connected)return;
    const ticket=++s.ticket;document.body.dataset.busy='true';$('rowStatus').textContent='Loading records…';
    try{const data=await api('query',query());if(ticket!==s.ticket)return;s.rows=data.rows;s.next=data.nextCursor;renderGrid();}
    catch(error){if(ticket===s.ticket){s.rows=[];s.next=null;renderGrid();$('emptyState').querySelector('h2').textContent='Records could not be loaded';$('emptyState').querySelector('p').textContent=error.message;notice(error.message,true);}}
    finally{if(ticket===s.ticket)document.body.dataset.busy='false';}
  }
  function renderFilters(){
    $('filterRows').innerHTML=s.draftFilters.map((f,i)=>`<div class="filter-row" data-filter="${i}"><select aria-label="Filter column">${options(columns(),f.field)}</select><select aria-label="Filter operator">${Object.entries({eq:'Equals',ne:'Does not equal',contains:'Contains',starts:'Starts with',gt:'Greater than',gte:'At least',lt:'Less than',lte:'At most',empty:'Is empty',not_empty:'Is not empty'}).map(([k,v])=>`<option value="${k}" ${k===f.op?'selected':''}>${v}</option>`).join('')}</select><input aria-label="Filter value" placeholder="Value · use ISO dates with timezone" value="${esc(f.value??'')}"><button aria-label="Remove condition" data-remove="${i}">×</button></div>`).join('');
    $('filterRows').querySelectorAll('[data-remove]').forEach(b=>b.onclick=()=>{readFilterControls();s.draftFilters.splice(Number(b.dataset.remove),1);renderFilters();invalidatePreview();});
    $('filterCount').textContent=s.filters.length;
  }
  function readFilterControls(){s.draftFilters=[...$('filterRows').children].map(row=>({field:row.children[0].value,op:row.children[1].value,value:row.children[2].value}));}
  function showTab(tab){s.tab=tab;document.querySelectorAll('[data-tab]').forEach(b=>b.setAttribute('aria-selected',String(b.dataset.tab===tab)));document.querySelectorAll('.tab-panel').forEach(p=>p.hidden=p.id!=='panel-'+tab);if(tab==='scripts')loadJobs().catch(e=>notice(e.message,true));if(tab==='activity')loadActivity().catch(e=>notice(e.message,true));}
  async function saved(){
    const id=s.id;const data=await api('saved');if(s.id!==id)return;s.items=data.items;
    for(const [kind,target,label,current] of [['view','savedView','Current view',s.view],['script','savedScript','New script',s.script],['chart','savedChart','New chart',s.chart]]){
      $(target).innerHTML=`<option value="">${label}</option>`+s.items.filter(x=>x.kind===kind).map(x=>`<option value="${x.id}">${esc(x.name)}</option>`).join('');$(target).value=current?.id||'';
    }
  }
  function renderFormulaList(){
    const formulas=model().formulas||[];
    $('formulaList').innerHTML=formulas.length?formulas.map(f=>`<article class="formula-card"><header><h3>ƒ ${esc(f.label)}</h3><button data-formula="${esc(f.name)}">Edit</button></header><code>${esc(f.expression)}</code><small>${esc(f.name)} ${f.unit?'· '+esc(f.unit):''} · Revision ${f.version}</small></article>`).join(''):'<div class="empty-state"><div class="empty-icon">ƒ</div><h2>No calculated columns</h2><p>Define formulas now; they will evaluate when records are added.</p></div>';
    $('formulaList').querySelectorAll('[data-formula]').forEach(b=>b.onclick=()=>openFormula(formulas.find(f=>f.name===b.dataset.formula)));
  }
  function openFormula(formula=null){
    $('formulaError').textContent='';s.formula=formula;$('formulaKey').value=formula?.name||'';$('formulaKey').readOnly=!!formula;$('formulaLabel').value=formula?.label||'';$('formulaUnit').value=formula?.unit||'';$('formulaExpression').value=formula?.expression||'';
    $('formulaExpression').placeholder=numeric()[0]?`ROUND(${numeric()[0].key}, 3)`:'A numeric field is needed to calculate values';
    $('formulaFields').innerHTML=numeric().filter(f=>f.key!==formula?.name).map(f=>`<button type="button" data-field="${f.key}">${esc(f.key)}</button>`).join('');
    $('formulaFields').querySelectorAll('button').forEach(b=>b.onclick=()=>{$('formulaExpression').setRangeText(b.dataset.field,$('formulaExpression').selectionStart,$('formulaExpression').selectionEnd,'end');$('formulaExpression').focus();});
    $('formulaDialog').showModal();$('formulaKey').focus();
  }
  function chartOptions(){
    const group=$('chartGroup').value,metric=$('chartMetric').value;
    $('chartGroup').innerHTML=options(model().fields.filter(f=>['text','date','datetime'].includes(f.type)),group);
    if(!group)$('chartGroup').value=model().fields.find(f=>f.type==='datetime')?.key||'site';
    $('chartMetric').innerHTML=options(numeric(),metric);
    $('drawChart').disabled=!numeric().length;
  }
  function discard(){return !s.dirty || window.confirm('Discard your unsaved record changes?');}
  function closeRecord(){if(!discard())return false;s.dirty=false;$('inspector').hidden=true;s.record=null;return true;}
  function localInput(value,type){
    if(!value)return '';
    if(type!=='datetime')return String(value);
    const d=new Date(value);if(!Number.isFinite(d.getTime()))return '';
    return new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,19);
  }
  function fillRecord(values){
    for(const f of model().fields){const input=$('rec-'+f.key);if(input)input.value=localInput(values[f.key],f.type);}
  }
  async function openRecord(row=null){
    if(!discard())return;s.record=row;s.dirty=false;s.history=[];$('recordTitle').textContent=row?'Edit record':'New record';
    $('recordMeta').textContent=row?`Revision ${row._version} · ${row._actor} · ${new Date(row._updated_at).toLocaleString()}\n${row._id}`:'New records are saved with your operator identity.';
    $('recordFields').innerHTML=model().fields.map(f=>`<label>${esc(f.label)}${f.unit?' · '+esc(f.unit):''}${f.required?' *':''}${['notes','summary'].includes(f.key)?`<textarea id="rec-${f.key}" ${f.required?'required':''} maxlength="10000"></textarea>`:`<input id="rec-${f.key}" type="${f.type==='datetime'?'datetime-local':f.type==='date'?'date':['number','integer'].includes(f.type)?'number':'text'}" ${['number','integer'].includes(f.type)?'step="'+(f.type==='integer'?'1':'any')+'"':f.type==='datetime'?'step="1"':''} ${f.required?'required':''} maxlength="10000">`}</label>`).join('');
    fillRecord(row||{});$('inspector').hidden=false;$('recordHistory').textContent=row?'Loading history…':'History begins when the record is saved.';
    $('recordFields').querySelector('input,textarea')?.focus();
    if(row){
      const dataset=s.id;
      try{const response=await fetch(`/api/data-workspace/${dataset}/history?id=${encodeURIComponent(row._id)}`,{headers:{Accept:'application/json'}});const result=await response.json();if(!response.ok)throw new Error(result.error||'History unavailable');if(s.record?._id!==row._id||s.id!==dataset)return;s.history=result.items;
        $('recordHistory').innerHTML=result.items.map((r,i)=>`<div class="history-item">${i?`<button type="button" data-restore="${i}">Restore values</button>`:''}<strong>Revision ${r.version}</strong><br>${esc(r.actor)} · ${esc(new Date(r.at).toLocaleString())}${r.job_id?'<br>Script calculation':''}</div>`).join('');
        $('recordHistory').querySelectorAll('[data-restore]').forEach(b=>b.onclick=()=>{fillRecord(s.history[Number(b.dataset.restore)].after_row);s.dirty=true;notice('Historical values loaded into the editor. Save to create a new revision.');});
      }catch(error){$('recordHistory').textContent=error.message;}
    }
  }
  async function chooseDataset(id){
    if(!closeRecord())return;
    s.id=id;s.ticket++;s.chartTicket++;s.filters=[];s.draftFilters=[];resetPages();invalidatePreview();s.view=null;s.script=null;s.chart=null;s.rows=[];
    try{s.hidden=JSON.parse(localStorage.getItem('northstarDataColumns:'+id)||'null')||baseFields.map(f=>f.key);}catch{s.hidden=baseFields.map(f=>f.key);}
    if(!Array.isArray(s.hidden))s.hidden=baseFields.map(f=>f.key);
    document.querySelectorAll('[data-dataset]').forEach(b=>b.classList.toggle('active',b.dataset.dataset===id));
    $('datasetTitle').textContent=model().name;$('domainCrumb').textContent=model().name.toUpperCase();$('datasetDescription').textContent=model().description;
    $('sortField').innerHTML=options([...model().fields,...baseFields],'_updated_at');$('sortDirection').value='desc';
    $('viewName').value='';$('scriptName').value='';$('scriptSource').value='';$('chartName').value='';$('chartGroup').innerHTML='';$('chartMetric').innerHTML='';
    $('chartCanvas').innerHTML='<div class="empty-state"><div class="empty-icon">⌁</div><h2>Your chart starts with data</h2><p>Choose a value and grouping to explore this dataset.</p></div>';$('chartSummary').textContent='';$('chartDetails').hidden=true;
    renderFilters();renderColumns();renderGrid();renderFormulaList();chartOptions();notice('');
    await Promise.all([loadRows(),saved()]);if(s.tab==='scripts')await loadJobs();if(s.tab==='activity')await loadActivity();
  }
  function tableOf(rows){
    if(!rows.length)return '<p class="muted">No records to display.</p>';
    const keys=Object.keys(rows[0]);return '<div class="table-scroll"><table><thead><tr>'+keys.map(k=>'<th>'+esc(k)+'</th>').join('')+'</tr></thead><tbody>'+rows.map(r=>'<tr>'+keys.map(k=>'<td>'+esc(fmt(r[k]))+'</td>').join('')+'</tr>').join('')+'</tbody></table></div>';
  }
  async function preview(){
    invalidatePreview();const id=s.id,ticket=previewTicket;const result=await api('preview',{source:$('scriptSource').value,filters:s.filters});if(s.id!==id||ticket!==previewTicket)return;s.preview=result;
    $('scriptPreview').innerHTML=`<header><div><span class="eyebrow">REVIEW BEFORE RUNNING</span><h3>${result.count.toLocaleString()} matching records</h3></div><button id="applyScript" class="primary" ${!result.count?'disabled':''}>Run script</button></header><p>${esc(result.notice)}</p>${tableOf(result.sample)}<p>Sample shows up to ten records. Preview expires in ten minutes.</p>`;$('scriptPreview').hidden=false;
    $('applyScript').onclick=handle(async()=>{const button=$('applyScript');button.disabled=true;try{await api('run',{token:s.preview.token});invalidatePreview();notice('Script queued. Monitor its progress below.');await loadJobs();}catch(error){button.disabled=false;throw error;}});
  }
  async function loadJobs(){
    clearTimeout(s.jobTimer);const id=s.id;const result=await api('jobs');if(id!==s.id)return;
    $('jobsList').innerHTML=result.items.length?result.items.map(job=>`<div class="job-row"><span class="job-status">${esc(job.status)}</span><div>${job.processed.toLocaleString()} records updated<small>${esc(new Date(job.created_at).toLocaleString())} · ${esc(job.id.slice(0,8))}</small>${job.error?`<small class="job-error">${esc(job.error)}</small>`:''}</div>${['running','queued'].includes(job.status)?`<button data-cancel="${job.id}" ${job.cancel_requested?'disabled':''}>${job.cancel_requested?'Cancelling…':'Cancel job'}</button>`:''}</div>`).join(''):'<div class="empty-state"><h2>No script runs</h2><p>Saved scripts and execution history will appear here.</p></div>';
    $('jobsList').querySelectorAll('[data-cancel]').forEach(b=>b.onclick=handle(async()=>{await api('cancel',{id:b.dataset.cancel});await loadJobs();}));
    if(result.items.some(x=>['queued','running'].includes(x.status))&&!document.hidden)s.jobTimer=setTimeout(()=>loadJobs().catch(e=>notice(e.message,true)),2000);
  }
  function chartConfig(){return {filters:s.filters,group:$('chartGroup').value,metric:$('chartMetric').value,aggregate:$('chartAggregate').value,bucket:$('chartBucket').value,type:$('chartType').value};}
  async function draw(){
    const ticket=++s.chartTicket;const cfg=chartConfig();const result=await api('chart',cfg);if(ticket!==s.chartTicket)return;
    const points=result.points;const valid=points.filter(p=>typeof p.y==='number'&&Number.isFinite(p.y));
    $('chartSummary').textContent=`${points.length} groups · ${points.reduce((a,p)=>a+Number(p.n),0).toLocaleString()} source records · ${points.reduce((a,p)=>a+Number(p.valid),0).toLocaleString()} valid numeric values · UTC${result.truncated?' · First 500 groups only: narrow your filters':''}`;
    $('chartDetails').hidden=!points.length;$('chartValues').innerHTML=tableOf(points);
    if(!valid.length){$('chartCanvas').innerHTML='<div class="empty-state"><div class="empty-icon">⌁</div><h2>No values to plot</h2><p>This selection has no numeric observations. Nothing has been inferred or filled in.</p></div>';return;}
    const W=1000,H=320,L=75,R=25,T=25,B=55;let min=Math.min(...valid.map(p=>p.y)),max=Math.max(...valid.map(p=>p.y));
    if(cfg.type==='bar'){min=Math.min(0,min);max=Math.max(0,max);}if(min===max){const pad=Math.abs(min)*.1||1;min-=pad;max+=pad;}
    const x=i=>L+(i+.5)*(W-L-R)/points.length,y=v=>T+(max-v)*(H-T-B)/(max-min);
    let svg=`<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(cfg.aggregate+' '+cfg.metric+' by '+cfg.group)}">`;
    for(let i=0;i<=4;i++){const v=min+(max-min)*i/4,yy=y(v);svg+=`<line x1="${L}" y1="${yy}" x2="${W-R}" y2="${yy}" stroke="#2c3b4a"/><text x="${L-9}" y="${yy+4}" text-anchor="end">${esc(fmt(Number(v.toPrecision(4))))}</text>`;}
    let path='';let segment=false;
    points.forEach((p,i)=>{if(typeof p.y!=='number'){segment=false;return;}const xx=x(i),yy=y(p.y),label=String(p.x??'Missing category');
      if(cfg.type==='bar'){const width=Math.max(1,(W-L-R)/points.length*.65);svg+=`<rect class="chart-bar" x="${xx-width/2}" y="${Math.min(y(0),yy)}" width="${width}" height="${Math.max(1,Math.abs(y(0)-yy))}"><title>${esc(label)}: ${esc(fmt(p.y))} (${p.valid} valid)</title></rect>`;}
      else{path+=(segment?' L':' M')+xx+','+yy;segment=true;svg+=`<circle class="chart-point" cx="${xx}" cy="${yy}" r="3"><title>${esc(label)}: ${esc(fmt(p.y))} (${p.valid} valid)</title></circle>`;}
    });
    if(path)svg+=`<path class="chart-line" d="${path}"/>`;
    const stride=Math.max(1,Math.ceil(points.length/7));points.forEach((p,i)=>{if(i%stride===0){const label=String(p.x??'Missing').replace('T',' ').slice(0,19);svg+=`<text x="${x(i)}" y="${H-B+24}" text-anchor="middle">${esc(label.length>18?label.slice(0,17)+'…':label)}</text>`;}});
    $('chartCanvas').innerHTML=svg+'</svg>';
  }
  async function loadActivity(){const id=s.id;const result=await api('activity');if(id!==s.id)return;$('activityList').innerHTML=result.items.length?result.items.map(r=>`<div class="activity-row"><span>↳</span><div><strong>${esc(r.kind)}</strong> ${esc(r.name||r.record_id||'')}<br><small class="muted">${esc(r.actor)} · ${esc(new Date(r.at).toLocaleString())} · Revision ${r.version}</small></div></div>`).join(''):'<div class="empty-state"><div class="empty-icon">◷</div><h2>No changes recorded</h2><p>Edits, calculations and saved configuration changes appear here.</p></div>';}
  function exportPage(){const cols=visible();const cell=value=>{let str=value==null?'':String(value);if(typeof value==='string'&&/^[\s]*[=+\-@]/.test(str))str="'"+str;return '"'+str.replace(/"/g,'""')+'"';};const csv=[cols.map(f=>cell(f.label)).join(','),...s.rows.map(r=>cols.map(f=>cell(r[f.key])).join(','))].join('\r\n');const url=URL.createObjectURL(new Blob(['\uFEFF'+csv],{type:'text/csv;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download=`northstar-${s.id}-page-${s.page+1}.csv`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
  document.querySelectorAll('[data-tab]').forEach(b=>b.onclick=()=>showTab(b.dataset.tab));
  $('filterToggle').onclick=()=>{$('filtersPanel').hidden=!$('filtersPanel').hidden;$('filterToggle').setAttribute('aria-expanded',String(!$('filtersPanel').hidden));};
  $('columnToggle').onclick=()=>{$('columnsPanel').hidden=!$('columnsPanel').hidden;};
  $('addFilter').onclick=()=>{readFilterControls();if(s.draftFilters.length>=12)return notice('At most twelve filters.',true);s.draftFilters.push({field:'site',op:'eq',value:''});renderFilters();invalidatePreview();};
  $('filterRows').oninput=invalidatePreview;
  $('applyFilters').onclick=handle(async()=>{readFilterControls();s.filters=structuredClone(s.draftFilters);$('filterCount').textContent=s.filters.length;resetPages();invalidatePreview();notice('');await loadRows();});
  $('clearFilters').onclick=handle(async()=>{s.filters=[];s.draftFilters=[];renderFilters();resetPages();invalidatePreview();await loadRows();});
  for(const id of ['sortField','sortDirection'])$(id).onchange=handle(async()=>{resetPages();await loadRows();});
  $('nextPage').onclick=handle(async()=>{if(!s.next)return;s.pages.push(s.next);s.page++;await loadRows();});
  $('previousPage').onclick=handle(async()=>{if(!s.page)return;s.pages.pop();s.page--;await loadRows();});
  $('refreshButton').onclick=handle(async()=>{if(!s.connected)return boot();resetPages();notice('');await loadRows();await saved();});
  $('newRecord').onclick=()=>openRecord();$('closeInspector').onclick=closeRecord;$('cancelRecord').onclick=closeRecord;
  $('recordForm').oninput=()=>{s.dirty=true;};
  $('recordForm').onsubmit=handle(async e=>{e.preventDefault();const values={};for(const f of model().fields){let value=$('rec-'+f.key).value;if(value&&f.type==='datetime')value=new Date(value).toISOString();values[f.key]=value===''?null:value;}const button=$('recordForm').querySelector('[type=submit]');button.disabled=true;try{const row=await api('edit',{id:s.record?._id,version:s.record?._version,values});s.dirty=false;notice('Record saved. Revision '+row._version+'.');await openRecord(row);await loadRows();}finally{button.disabled=false;}});
  $('emptyFormula').onclick=()=>{showTab('formulas');openFormula();};$('newFormula').onclick=()=>openFormula();
  for(const id of ['closeFormula','cancelFormula'])$(id).onclick=()=>$('formulaDialog').close();
  $('formulaForm').onsubmit=handle(async e=>{e.preventDefault();const result=await api('formula',{name:$('formulaKey').value,label:$('formulaLabel').value,expression:$('formulaExpression').value,unit:$('formulaUnit').value,version:s.formula?.version});model().formulas=result.formulas;$('formulaDialog').close();renderFormulaList();renderColumns();renderFilters();chartOptions();resetPages();invalidatePreview();await loadRows();notice('Calculated column saved.');});
  $('saveView').onclick=handle(async()=>{const body={...query(),cursor:null,hidden:s.hidden};s.view=await api('save',{kind:'view',name:$('viewName').value,body,version:s.view?.name===$('viewName').value?s.view.version:undefined});await saved();notice('View saved for your account.');});
  $('savedView').onchange=handle(async()=>{s.view=s.items.find(x=>x.id===$('savedView').value)||null;if(!s.view)return;$('viewName').value=s.view.name;s.filters=s.view.body.filters||[];s.draftFilters=structuredClone(s.filters);$('sortField').value=s.view.body.sort||'_updated_at';$('sortDirection').value=s.view.body.direction||'desc';s.hidden=s.view.body.hidden||[];rememberColumns();renderFilters();renderColumns();resetPages();invalidatePreview();await loadRows();});
  $('saveScript').onclick=handle(async()=>{s.script=await api('save',{kind:'script',name:$('scriptName').value,body:{source:$('scriptSource').value},version:s.script?.name===$('scriptName').value?s.script.version:undefined});await saved();notice('Script saved. Preview before running it.');});
  $('savedScript').onchange=()=>{s.script=s.items.find(x=>x.id===$('savedScript').value)||null;$('scriptName').value=s.script?.name||'';$('scriptSource').value=s.script?.body.source||'';invalidatePreview();};
  $('scriptSource').oninput=invalidatePreview;$('previewScript').onclick=handle(preview);$('refreshJobs').onclick=handle(loadJobs);
  $('drawChart').onclick=handle(draw);$('saveChart').onclick=handle(async()=>{s.chart=await api('save',{kind:'chart',name:$('chartName').value,body:chartConfig(),version:s.chart?.name===$('chartName').value?s.chart.version:undefined});await saved();notice('Chart saved for your account.');});
  $('savedChart').onchange=handle(async()=>{s.chart=s.items.find(x=>x.id===$('savedChart').value)||null;if(!s.chart)return;const body=s.chart.body;$('chartName').value=s.chart.name;for(const [id,key]of[['chartGroup','group'],['chartMetric','metric'],['chartAggregate','aggregate'],['chartBucket','bucket'],['chartType','type']])$(id).value=body[key];s.filters=body.filters||[];s.draftFilters=structuredClone(s.filters);renderFilters();resetPages();invalidatePreview();await loadRows();await draw();});
  $('refreshActivity').onclick=handle(loadActivity);$('exportButton').onclick=exportPage;
  $('helpButton').onclick=()=>$('helpDialog').showModal();$('closeHelp').onclick=()=>$('helpDialog').close();
  window.addEventListener('beforeunload',e=>{if(s.dirty){e.preventDefault();e.returnValue='';}});window.addEventListener('pagehide',()=>clearTimeout(s.jobTimer));
  document.addEventListener('visibilitychange',()=>{if(document.hidden)clearTimeout(s.jobTimer);else if(s.connected&&s.tab==='scripts')loadJobs().catch(e=>notice(e.message,true));});
  document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!$('inspector').hidden)closeRecord();});
  async function boot(){
    $('newRecord').disabled=true;
    try{const meta=await api('status');s.datasets=meta.datasets;s.connected=true;$('connection').textContent='● PostgreSQL connected';$('connection').className='connection ready';$('newRecord').disabled=false;
      $('datasets').innerHTML=s.datasets.map(d=>`<button class="dataset-button" data-dataset="${d.id}"><span>${esc(d.icon)}</span><span>${esc(d.name)}</span></button>`).join('');
      $('datasets').querySelectorAll('button').forEach(b=>b.onclick=handle(()=>chooseDataset(b.dataset.dataset)));await chooseDataset(s.id);
    }catch(error){s.connected=false;$('connection').textContent='Connection unavailable';$('connection').className='connection failed';$('rowStatus').textContent='Database unavailable';notice(error.message,true);}
  }
  boot();
})();
