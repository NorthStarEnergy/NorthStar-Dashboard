/* One authenticated roster snapshot for every dashboard view. */
(() => {
  'use strict';
  let rows = null, pending = null, checked = 0, revision = 0;
  const active = records => records.filter(row => row.status !== 'checked-out');
  const palette = ['#45a88e','#639eda','#ae86d3','#d3a35d','#5bafc0','#cd829a'];
  const color = row => {
    const key = String(row.company || (row.kind === 'Contractor' ? 'Contractor' : 'NorthStar')).toLowerCase().replace(/[^a-z0-9]/g,'');
    return palette[['northstar','northstarenergy'].includes(key) ? 0 : 1 + [...key].reduce((h,c)=>(h*31+c.charCodeAt(0))>>>0,0)%5];
  };
  function publish() {
    const current = active(rows);
    window.renderStaff?.(rows);
    window.renderCrewRows?.(current);
    window.NorthstarOverview?.update('staff', current);
    window.dispatchEvent(new CustomEvent('northstar:field-roster-data',{detail:rows}));
    window.dispatchEvent(new CustomEvent('northstar:roster-updated',{detail:rows}));
  }
  async function load({force=false}={}) {
    if (pending) {const result=await pending;return result || load({force:true});}
    if (!force && rows && Date.now()-checked<1500) {publish();return rows;}
    const version=revision;
    pending=(async()=>{
      await window.northstarOperatorSession;
      const response=await fetch('/api/checkins?include=all&ts='+Date.now(),{cache:'no-store'});
      if(!response.ok)throw Error('Roster unavailable. Refresh to retry.');
      const result=await response.json();
      if(!Array.isArray(result))throw Error('Invalid roster response.');
      await window.NorthStarSites?.ready;
      if(version!==revision)return null;
      rows=result;checked=Date.now();publish();return rows;
    })();
    try {const result=await pending; if(result)return result;}
    catch(error){window.dispatchEvent(new CustomEvent('northstar:roster-error',{detail:error.message}));throw error;}
    finally {pending=null;}
    return load({force:true});
  }
  let channel;
  try {channel=new BroadcastChannel('northstar-roster-refresh');channel.onmessage=()=>invalidate(false);}catch{}
  function invalidate(broadcast=true) {
    revision++;checked=0;
    if(broadcast)channel?.postMessage('changed');
    return load({force:true}).catch(()=>{});
  }
  window.NorthstarRoster={load,active,color,invalidate,get rows(){return rows;}};
  // Successful operator actions invalidate all views, including other open windows.
  const prior=window.fetch.bind(window);
  window.fetch=async function(input,options) {
    const response=await prior(input,options);
    const url=new URL(typeof input==='string'?input:input.url,location.href);
    const method=String(options?.method || input?.method || 'GET').toUpperCase();
    if(response.ok && url.origin===location.origin && /^\/api\/checkins(?:\/|$)/.test(url.pathname) && !['GET','HEAD','OPTIONS'].includes(method))invalidate();
    return response;
  };
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)load({force:true}).catch(()=>{});});
})();
