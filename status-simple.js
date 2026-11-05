/* Detached monitor presentation. Uses the shared roster, dispatch and audit ledger. */
(() => {
  'use strict';
  if (new URLSearchParams(location.search).get('nsStatusWindow') !== '1') return;
  const $ = s => document.querySelector(s), shell = $('#nsStationWindow');
  if (!shell) return;
  const css = document.createElement('link'); css.rel = 'stylesheet'; css.href = 'status-simple.css?v=20261030'; document.head.append(css);
  const key = 'northstarPopoutBuildViewV1';
  let view = 'simple', events, ready;
  try { view = localStorage.getItem(key) || 'simple'; } catch {}
  const options = $('#nsBuildViewOptions');
  options.innerHTML = '<button type="button" data-build-view="simple">Simple monitor</button><button type="button" data-build-view="classic">Classic dashboard</button>';
  const rail = document.createElement('aside'); rail.id = 'nsSimpleRail';
  const marker = document.createComment('status bar position');
  const bar = $('#nsStatusBar'); bar.before(marker);
  // The classic canvas writes inline !important geometry on resize. Clear only
  // that geometry in monitor mode, without changing its saved layout profile.
  const geometry=['position','left','top','right','bottom','width','height','min-height','min-width','transform','translate'];
  function releaseGeometry(){
    if(view!=='simple')return;
    [bar,...bar.querySelectorAll(':scope > [data-status]')].forEach(node=>geometry.forEach(name=>{if(node.style.getPropertyValue(name))node.style.removeProperty(name);}));
  }
  new MutationObserver(releaseGeometry).observe(bar,{attributes:true,attributeFilter:['style'],subtree:true});
  const eventHost = document.createElement('section'); eventHost.id = 'nsSimpleEvents';
  rail.append(eventHost); $('#nsStatusWorkers').append(rail);
  async function mount() {
    if (!window.NorthStarV3Data) {
      await new Promise((resolve,reject) => { const script=document.createElement('script'); script.src='build-view-v3-data.js';script.onload=resolve;script.onerror=reject;document.head.append(script); });
    }
    const style=document.createElement('link');style.rel='stylesheet';style.href='build-view-v3-data.css';document.head.append(style);
    events=window.NorthStarV3Data.mountEvents(eventHost);
    const header=eventHost.querySelector('header');
    const add=document.createElement('button');add.type='button';add.textContent='+';add.setAttribute('aria-label','Add log entry');add.setAttribute('aria-expanded','false');add.setAttribute('aria-controls','nsSimpleComposer');header.prepend(add);
    const form=document.createElement('form');form.id='nsSimpleComposer';form.hidden=true;
    form.innerHTML='<label>Log entry<textarea name="details" required maxlength="20000" rows="4" placeholder="Write an operator log entry…"></textarea></label><div><label>Type<select name="type"><option>Operator action</option><option>Shift handoff</option><option>Observation</option></select></label><label>Site (optional)<input name="site" maxlength="150" placeholder="Station or location"></label></div><button type="submit">Save entry</button> <button type="button" data-cancel>Close</button><p role="status" aria-live="polite"></p>';
    header.after(form);
    const toggle=show=>{form.hidden=!show;add.setAttribute('aria-expanded',String(show));if(show)form.elements.details.focus();else add.focus();};
    add.onclick=()=>toggle(form.hidden);form.querySelector('[data-cancel]').onclick=()=>toggle(false);
    let saving=false;
    form.onsubmit=async e=>{
      e.preventDefault();if(saving||!form.elements.details.value.trim())return;
      saving=true;const button=form.querySelector('[type=submit]'),status=form.querySelector('[role=status]');button.disabled=true;status.textContent='Saving…';
      try {
        const response=await fetch('/api/logbook',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({type:form.elements.type.value,subject:form.elements.site.value.trim()||'Operator log',details:form.elements.details.value.trim()})});
        if(!response.ok)throw Error('Save failed ('+response.status+'). Your entry is retained.');
        form.reset();status.textContent='Entry saved.';window.dispatchEvent(new Event('northstar:logbook-saved'));eventHost.querySelector('[data-v3-event-refresh]').click();
      }catch(error){status.textContent=error.message||'Connection unavailable. Your entry is retained.';}
      finally{saving=false;button.disabled=false;}
    };
    if(view!=='simple')events.deactivate();
  }
  function set(value) {
    if(!['simple','classic'].includes(value))return;
    view=value;document.body.classList.toggle('ns-simple-monitor',view==='simple');
    rail.hidden=view!=='simple';
    if(view==='simple'){
      rail.prepend(bar);bar.hidden=false;window.NorthStarStationDisplay?.set('list',false);
      releaseGeometry();
      if(!ready)ready=mount().catch(()=>{eventHost.textContent='Event log could not load. Refresh the dashboard to retry.';});
      events?.activate();
    }else{marker.after(bar);events?.deactivate();window.dispatchEvent(new Event('resize'));}
    try{localStorage.setItem(key,view);}catch{}
    options.querySelectorAll('[data-build-view]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.buildView===view)));
    window.dispatchEvent(new CustomEvent('northstar:build-view-change',{detail:{view}}));
  }
  window.NorthStarBuildView={get:()=>view,set};
  set(view==='classic'?'classic':'simple');
})();
