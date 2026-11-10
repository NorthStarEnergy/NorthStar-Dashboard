// Suggestions share the editable control; only an explicit choice changes its value.
(() => {
  'use strict';
  const target='[data-step-field="device"],#create [name="asset"],#uwpcRequestForm [name="equipment"]';
  const list=document.createElement('div');list.id='outageDevices';list.hidden=true;
  list.setAttribute('role','listbox');list.setAttribute('aria-label','Devices at selected sites');document.body.append(list);
  let field, rows=[], matches=[], index=-1, sequence=0, rendered=0, lastKey='', lastRows;
  function close(){
    ++sequence;
    if(field){field.setAttribute('aria-expanded','false');field.removeAttribute('aria-activedescendant');}
    field=null;rows=[];index=-1;list.hidden=true;
  }
  function position(){
    if(!field?.isConnected || !field.getClientRects().length)return close();
    const b=field.getBoundingClientRect(),w=Math.min(innerWidth-12,Math.max(320,b.width));
    list.style.width=w+'px';list.style.left=Math.max(6,Math.min(b.left,innerWidth-w-6))+'px';
    list.style.top=(b.bottom+list.offsetHeight+4<=innerHeight ? b.bottom+2 : Math.max(4,b.top-list.offsetHeight-2))+'px';
  }
  function note(text){
    const el=document.createElement('div');el.className='device-note';el.textContent=text;list.replaceChildren(el);position();
  }
  function more(){
    const fragment=document.createDocumentFragment(),end=Math.min(matches.length,rendered+70);
    for(;rendered<end;rendered++){
      const d=matches[rendered],el=document.createElement('div'),detail=document.createElement('small');
      el.setAttribute('role','option');el.dataset.i=String(rendered);el.id='outageDevice'+rendered;
      el.setAttribute('aria-selected','false');el.textContent=d.ref+' · '+d.site;detail.textContent=d.label;
      el.append(detail);fragment.append(el);
    }
    list.append(fragment);
  }
  function filter(){
    const words=field.value.trim().toLowerCase().split(/\s+/).filter(Boolean);
    matches=rows.filter(d=>words.every(w=>d.search.includes(w)));
    rendered=0;index=-1;field.removeAttribute('aria-activedescendant');list.replaceChildren();list.scrollTop=0;
    if(!matches.length)return note(rows.length?'No match. You can keep the reference you typed.':'No catalogued devices for these sites. You can type a reference.');
    more();position();
  }
  async function open(el){
    close();field=el;
    el.setAttribute('role','combobox');el.setAttribute('aria-autocomplete','list');el.setAttribute('aria-controls',list.id);
    el.setAttribute('aria-expanded','true');list.hidden=false;note('Loading site devices…');
    const seq=sequence,form=el.form,workspace=await window.outageWorkspace;
    if(seq!==sequence)return;
    const additional=form.elements.affectedSites||form.elements.additional;
    const sites=[...new Set([form.elements.site?.value,...(additional?.value||'').split(/\r?\n/),...(workspace?.inheritedSites||[])]
      .map(s=>(s||'').trim()).filter(Boolean))].sort();
    if(!sites.length)return note('Choose a site for suggestions, or type a reference.');
    const params=new URLSearchParams(sites.map(s=>['site',s])),key=params.toString();
    try{
      if(key!==lastKey){
        const res=await fetch('/api/uwpc/requests/manager/devices?'+params,{credentials:'same-origin',cache:'no-store'});
        if(!res.ok)throw Error();
        const data=await res.json();if(seq!==sequence)return;
        lastRows=data.devices.map(d=>({...d,search:[d.ref,d.label,d.site].join(' ').toLowerCase()}));lastKey=key;
      }
      rows=lastRows;filter();
    }catch{if(seq===sequence)note('Device list unavailable. You can type a reference.');}
  }
  function choose(i){
    if(!field || !matches[i])return;
    const d=matches[i],el=field;
    const value=d.site+' · '+d.ref;
    el.value=value.length<=160?value:d.ref;el.dispatchEvent(new Event('input',{bubbles:true}));close();
  }
  function eligible(el){return el?.matches?.(target) && !el.matches(':disabled') && !el.readOnly;}
  document.addEventListener('focusin',e=>{if(eligible(e.target))void open(e.target);});
  document.addEventListener('click',e=>{if(eligible(e.target) && e.target!==field)void open(e.target);});
  document.addEventListener('focusout',e=>{if(e.target===field)close();});
  document.addEventListener('input',e=>{if(e.target===field && rows.length)filter();else if(!field && eligible(e.target) && document.activeElement===e.target)void open(e.target);});
  document.addEventListener('keydown',e=>{
    if(e.target!==field){if(e.key==='ArrowDown' && eligible(e.target)){e.preventDefault();void open(e.target);}return;}
    if(e.key==='Escape'){e.preventDefault();close();return;}
    if(e.key==='Enter' && index>=0){e.preventDefault();choose(index);return;}
    if(!['ArrowDown','ArrowUp'].includes(e.key)||!matches.length||!rows.length)return;
    e.preventDefault();
    if(index>=0)list.children[index]?.setAttribute('aria-selected','false');
    index=Math.max(0,Math.min(matches.length-1,index+(e.key==='ArrowDown'?1:-1)));
    if(index>=rendered)more();const opt=list.children[index];
    opt.setAttribute('aria-selected','true');field.setAttribute('aria-activedescendant',opt.id);opt.scrollIntoView({block:'nearest'});
  });
  list.addEventListener('mousedown',e=>e.preventDefault());
  list.addEventListener('click',e=>{const opt=e.target.closest('[role=option]');if(opt)choose(Number(opt.dataset.i));});
  list.addEventListener('scroll',()=>{if(rendered<matches.length && list.scrollHeight-list.scrollTop-list.clientHeight<40)more();});
  document.addEventListener('pointerdown',e=>{if(field && field!==e.target && !list.contains(e.target))close();});
  document.addEventListener('scroll',e=>{if(field && e.target!==list && e.target!==field)position();},true);
  window.addEventListener('resize',()=>{if(field)position();});
  window.addEventListener('hashchange',close);window.addEventListener('blur',close);
})();
