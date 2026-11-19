/* Table preferences apply to the current roster presentation. */
(() => {
  'use strict';
  const compareText = new Intl.Collator(undefined, {numeric:true, sensitivity:'base'}).compare;
  const dates = {in:'checkedIn', out:'checkedOutAt', seen:'lastHeard'};
  function resizeHandle(th,title,measure,apply,save) {
    const grip=document.createElement('button');
    grip.type='button';grip.className='fr-grip';grip.setAttribute('aria-label','Resize '+title+' column');
    const resize=w=>apply(Math.max(44,Math.min(1400,Math.round(w))));
    grip.onkeydown=e=>{
      if(!['ArrowLeft','ArrowRight'].includes(e.key))return;
      e.preventDefault();resize(measure()+(e.key==='ArrowRight'?1:-1)*(e.shiftKey?10:1));save();
    };
    grip.onpointerdown=e=>{
      if(e.button!==0)return;
      e.preventDefault();const width=measure(),start=e.clientX;
      grip.setPointerCapture(e.pointerId);
      grip.onpointermove=m=>resize(width+m.clientX-start);
      grip.onpointercancel=()=>resize(width);
      grip.onlostpointercapture=()=>{grip.onpointermove=null;save();};
    };
    th.append(grip);
  }
  function mount(root, render) {
    const table = root.querySelector('table');
    const heads = [...table.tHead.rows[0].cells];
    const key = 'northstar.roster.table.' + root.id;
    const defaults = {widths:{}, rowHeight:30, sort:'', direction:1};
    let prefs;
    try { prefs = {...defaults, ...JSON.parse(localStorage.getItem(key))}; } catch { prefs = {...defaults}; }
    prefs.widths ||= {};
    const save = () => { try {localStorage.setItem(key, JSON.stringify(prefs));} catch {} };
    const settings = root.querySelector('.fr-columns > div');
    const label = document.createElement('label');
    label.textContent = 'Row height ';
    const height = document.createElement('input');
    Object.assign(height,{type:'number',min:'24',max:'96',value:String(prefs.rowHeight)});
    height.setAttribute('aria-label','Row height in pixels');
    label.append(height);settings.append(label);
    height.onchange = () => {
      prefs.rowHeight = Math.min(96,Math.max(24,Number(height.value)||30));
      height.value=String(prefs.rowHeight);save();adjust();
    };
    const grouped=document.createElement('button');
    grouped.type='button';grouped.textContent='Group by station';
    grouped.onclick=()=>{prefs.sort='';prefs.direction=1;save();render();};
    settings.append(grouped);
    const reset = document.createElement('button');
    reset.type='button';reset.textContent='Reset table';
    reset.onclick=()=>{prefs={...defaults,widths:{}};height.value='30';save();render();};
    settings.append(reset);
    const columns = heads.map(th=>th.dataset.frCol || th.textContent.trim().toLowerCase());
    heads.forEach((th,index)=>{
      const column=columns[index], title=th.textContent;
      if(column!=='actions'){
        const button=document.createElement('button');
        button.setAttribute('aria-label',title);button.className='fr-sort';button.type='button';button.textContent=title;
        button.onclick=()=>{
          if(prefs.sort===column)prefs.direction*=-1;
          else {prefs.sort=column;prefs.direction=1;}
          save();render();
        };
        th.replaceChildren(button);
      }
      resizeHandle(th,title,()=>{
        heads.forEach((cell,i)=>{if(!cell.hidden)prefs.widths[columns[i]]=Math.round(cell.getBoundingClientRect().width);});
        return prefs.widths[column];
      },w=>{prefs.widths[column]=w;adjust();},save);
    });
    function adjust(){
      root.style.setProperty('--fr-row-height',prefs.rowHeight+'px');
      grouped.disabled=!prefs.sort;
      let total=0;
      heads.forEach((th,i)=>{
        const column=columns[i], w=Number(prefs.widths[column]);
        th.setAttribute('aria-sort',prefs.sort===column?(prefs.direction===1?'ascending':'descending'):'none');
        if(w>0)th.style.setProperty('width',w+'px','important');else th.style.removeProperty('width');
        if(!th.hidden)total+=w||0;
      });
      if(total){table.style.width=total+'px';table.style.minWidth=total+'px';}
      else{table.style.removeProperty('width');table.style.removeProperty('min-width');}
    }
    function compare(a,b,company,state,site){
      const column=prefs.sort, direction=prefs.direction;
      if(dates[column]){
        const x=Date.parse(a[dates[column]]),y=Date.parse(b[dates[column]]);
        if(!Number.isFinite(x)||!Number.isFinite(y))return Number(!Number.isFinite(x))-Number(!Number.isFinite(y));
        return (x-y)*direction;
      }
      if(column==='company'){
        const x=company(a),y=company(b);
        return (Number(y==='northstar')-Number(x==='northstar')||compareText(x,y))*direction;
      }
      const value=r=>column==='station'?site(r).name:column==='status'?state(r):r.name;
      return compareText(value(a),value(b))*direction;
    }
    return {adjust,compare,get sortKey(){return prefs.sort;}};
  }
  window.NorthstarRosterControls={mount,resizeHandle};
})();
