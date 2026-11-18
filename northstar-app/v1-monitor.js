/* Reuse the status strip's unfiltered register snapshot for the wide V1 canvas. */
(() => {
  'use strict';
  const host=document.querySelector('#overviewShiftEvents [data-event-content]');
  const format=new Intl.DateTimeFormat('en-CA',{hour:'2-digit',minute:'2-digit',hourCycle:'h23',timeZone:'America/Toronto'});
  if(host){
    const head=document.createElement('header'), title=document.createElement('h2'), link=document.createElement('button');
    title.textContent='Event log';link.type='button';link.textContent='All events';
    link.onclick=()=>document.querySelector('#sideNav [data-tab="logbook"]')?.click();
    const list=document.createElement('div'), status=document.createElement('small');
    list.className='shift-event-list';status.setAttribute('role','status');status.textContent='Loading events…';
    head.append(title,status,link);host.append(head,list);
    window.addEventListener('northstar:monitor-events',({detail:{items,failed}})=>{
      status.textContent=failed?(items.length?'Update failed · showing last received events':'Events unavailable'):items.length?'':'No recent events';
      const rows=items.slice(0,20).map(item=>{
        const a=document.createElement('a'), time=document.createElement('time'), summary=document.createElement('span');
        a.href='event-detail.html?id='+encodeURIComponent(item.eventId);
        const date=new Date(item.occurredAt);
        time.textContent=Number.isFinite(date.valueOf())?format.format(date):'—';
        summary.textContent=item.summary||item.eventType||'Event';
        a.append(time,summary);return a;
      });
      const focused=document.activeElement.closest('.shift-event-list a')?.href;
      list.replaceChildren(...rows);
      if(focused)rows.find(row=>row.href===focused)?.focus({preventScroll:true});
    });
  }
  function monitorRail(){
    const rail=document.getElementById('nsSimpleRail'), table=rail?.querySelector('table');
    if(!table)return false;
    const events=rail.querySelector('#nsSimpleEvents');
    events.dataset.moduleId='monitor-event-log';
    const workers=document.getElementById('nsStatusWorkers');
    const key='northstar.monitor.table';
    let prefs;try{prefs=JSON.parse(localStorage.getItem(key))||{};}catch{prefs={};}
    const save=()=>{try{localStorage.setItem(key,JSON.stringify(prefs));}catch{}};
    const split=document.createElement('button');split.type='button';split.className='ns-monitor-divider';
    split.setAttribute('aria-label','Resize worker and event panels');
    const adjust=value=>{
      prefs.left=Math.min(80,Math.max(35,value));
      workers.style.setProperty('--ns-monitor-left',prefs.left+'%');
    };
    if(Number.isFinite(prefs.left))adjust(prefs.left);
    split.onkeydown=e=>{
      if(!['ArrowLeft','ArrowRight'].includes(e.key))return;
      e.preventDefault();adjust((prefs.left??69)+(e.key==='ArrowLeft'?-1:1));save();
    };
    split.onpointerdown=e=>{
      if(e.button!==0)return;
      e.preventDefault();split.setPointerCapture(e.pointerId);
      const bounds=workers.getBoundingClientRect(), initial=prefs.left??69;
      split.onpointermove=m=>adjust(initial+100*(m.clientX-e.clientX)/bounds.width);
      split.onpointercancel=()=>adjust(initial);
      split.onlostpointercapture=()=>{split.onpointermove=null;save();};
    };
    rail.prepend(split);
    const heads=Array.from(table.tHead.rows[0].cells), cols=table.querySelectorAll('col');
    const visible=[0,1,4];
    prefs.widths ||= {};
    function widths(){
      let total=0;
      for(const i of visible){
        const w=Number(prefs.widths[i]);
        if(w>0){cols[i].style.setProperty('width',w+'px','important');total+=w;}
      }
      if(total){table.style.width=total+'px';table.style.minWidth='100%';}
    }
    widths();
    for(const i of visible){
      window.NorthstarRosterControls.resizeHandle(heads[i],heads[i].textContent,()=>{
        for(const n of visible)prefs.widths[n]=heads[n].getBoundingClientRect().width;
        return prefs.widths[i];
      },w=>{prefs.widths[i]=w;widths();},save);
    }
    return true;
  }
  function install(){
    const toolbar=document.querySelector('#nsWebToolbar');
    if(!toolbar)return false;
    const menu=toolbar.querySelector('.ns-web-toolbar-dropdown');
    if(!menu)return false;
    if(new URLSearchParams(location.search).get('nsStatusWindow')==='1'){
      const head=document.querySelector('#nsStationWindow #overviewStaff > .staff-panel-head');
      if(!head)return false;
      head.prepend(toolbar);
      const full=document.createElement('button');
      full.type='button';full.className='ns-monitor-fullscreen';full.textContent='Full screen';
      full.onclick=()=>menu.querySelector('[data-action="fullscreen"]').click();
      document.addEventListener('fullscreenchange',()=>{full.textContent=document.fullscreenElement?'Exit full screen':'Full screen';});
      head.append(full);
      if(!monitorRail()){
        const waiting=new MutationObserver(()=>{if(monitorRail())waiting.disconnect();});
        waiting.observe(document.getElementById('nsStationWindow'),{childList:true,subtree:true});
      }
    }else{
      const label=document.createElement('label'), toggle=document.createElement('input');
      toggle.type='checkbox';toggle.checked=localStorage.getItem('northstarWideOverview')!=='off';
      toggle.onchange=()=>{localStorage.setItem('northstarWideOverview',toggle.checked?'auto':'off');window.dispatchEvent(new Event('resize'));};
      label.className='ns-wide-option';label.append(toggle,' Wide overview on large screens');menu.append(label);
    }
    return true;
  }
  if(!install()){
    const observer=new MutationObserver(()=>{if(install())observer.disconnect();});
    observer.observe(document.body,{childList:true,subtree:true});
  }
})();
