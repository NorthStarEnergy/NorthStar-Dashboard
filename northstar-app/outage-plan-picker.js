/* Copy planning instructions into an editable form, never execution records. */
window.openOutagePlanPicker = async function({api,request,row,similar,esc,when,canMerge,merge}) {
  const dialog=document.createElement('dialog');
  dialog.className='plan-picker';
  dialog.setAttribute('aria-labelledby','planPickerTitle');
  dialog.innerHTML=`<header><h2 id="planPickerTitle">${similar?'Similar outages':'Open switching plan'}</h2><button type="button" aria-label="Close">×</button></header>
    <label>Find a plan<input type="search" placeholder="Site or plan name"></label>
    <label>Switching plan<select data-plans></select></label>
    <label>Saved version<select data-versions></select></label><div data-preview></div>
    <p role="status">Loading plans…</p><footer hidden><label>Merge into this form<select data-mode><option value="append">Append steps</option><option value="replace">Replace steps</option></select></label>
    <button type="button" class="btn" data-merge>Merge</button></footer>`;
  document.body.append(dialog);dialog.showModal();
  const find=s=>dialog.querySelector(s), plans=find('[data-plans]'),versions=find('[data-versions]');
  const preview=find('[data-preview]'),status=find('[role=status]'),footer=find('footer'),button=find('[data-merge]');
  find('header button').onclick=()=>dialog.close();dialog.onclose=()=>dialog.remove();
  const targetForm=document.getElementById('uwpcRequestForm');
  const targetSite=(targetForm?.elements.site.value||row.site).trim().toLowerCase();
  let all=[],history=[],prepared=[],sequence=0;
  function matchingSites(v){
    const normalize=xs=>[...new Set(xs.map(s=>s.trim().toLowerCase()).filter(Boolean))].sort().join('|');
    const extra=targetForm?.elements.affectedSites?.value||'';
    return targetSite===v.site.trim().toLowerCase() &&
      normalize([targetSite,...extra.split(/\r?\n/)])===normalize([v.site,...v.sites]);
  }
  function draw(){
    const v=history[Number(versions.value)];
    if(!v){preview.replaceChildren();footer.hidden=true;return;}
    const same=matchingSites(v);
    const aliases={'camp three rapids':['CTR'],'big beaver falls':['BBF'],'old woman falls':['OWF'],
      'white otter rapids':['WOR'],'calm lake':['CL'],'fort frances':['FF'],'sturgeon falls':['SF'],
      'iroquois falls':['IR'],'twin falls':['TW'],'island falls':['IS'],'okikendawt gs':['OKI']};
    const tokens=new Set();
    for(const name of [v.site,...v.sites]){
      const station=name.trim();if(!station)continue;
      tokens.add(station);for(const alias of aliases[station.toLowerCase()]||[])tokens.add(alias);
    }
    for(const step of v.steps){
      for(const key of ['device','removeTag','placeTag','lockNo']){
        const value=String(step[key]||'').trim();if(!value)continue;
        tokens.add(value);
        if(key==='device')for(const part of value.split(' · '))tokens.add(part);
      }
    }
    const escapeRE=s=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
    const terms=[...tokens].filter(Boolean).sort((a,b)=>b.length-a.length).map(escapeRE);
    const refs=terms.length?new RegExp('(?<![a-z0-9])(?:'+terms.join('|')+')(?![a-z0-9])','gi'):null;
    prepared=v.steps.map(s=>({device:same?s.device:'',operation:!same&&refs?s.operation.replace(refs,'[reference]'):s.operation,
      removeTag:'',placeTag:'',lockNo:'',orderedBy:'',completedBy:''}));
    preview.innerHTML='<ol>'+prepared.map(s=>`<li><strong>${esc(s.device||'Select equipment')}</strong> · ${esc(s.operation)}</li>`).join('')+'</ol>';
    status.textContent=!canMerge()?'Check out the destination form to merge.':same?
      'Review the equipment and instructions before saving.':'Select destination equipment and review each instruction for site references.';
    button.disabled=!canMerge();footer.hidden=false;
  }
  async function select(){
    const seq=++sequence;history=[];prepared=[];versions.replaceChildren();footer.hidden=true;preview.replaceChildren();
    if(!plans.value){status.textContent='No matching switching plans.';return;}
    status.textContent='Loading revisions…';
    try{
      const result=await request(api+'/manager/plan-versions?id='+encodeURIComponent(plans.value));
      if(seq!==sequence || !dialog.open)return;
      history=result;versions.replaceChildren(...history.map((v,i)=>new Option((i===0?'Latest · ':'')+when(v.at),String(i))));
      draw();
    }catch(e){if(seq===sequence)status.textContent=e.message;}
  }
  function filter(){
    const q=find('input').value.toLowerCase().trim();
    plans.replaceChildren(...all.filter(r=>(!similar||r.similar) && (r.title+' '+r.site).toLowerCase().includes(q))
      .map(r=>new Option(r.title+' · '+r.site,r.id)));
    void select();
  }
  find('input').oninput=filter;plans.onchange=select;versions.onchange=draw;
  button.onclick=async()=>{button.disabled=true;try{await merge(prepared,find('[data-mode]').value);dialog.close();}
    catch(e){status.textContent=e.message;button.disabled=!canMerge();}};
  try{all=await request(api+'/manager/plans?target='+encodeURIComponent(row.id));if(dialog.open)filter();}
  catch(e){status.textContent=e.message;}
};
