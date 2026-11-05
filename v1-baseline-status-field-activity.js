/* Daily workforce and field-operations audit feed for the detached dashboard. */
(() => {
  const start=()=>{
    const host=document.getElementById('nsFieldActivity');if(!host||host.dataset.feedReady)return;
    host.dataset.feedReady='true';
    const status=host.querySelector('[role=status]'),rows=host.querySelector('.ns-field-activity-rows');
    const zone='America/Toronto',day=value=>new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(value));
    let loading=false;
    async function refresh(){
      if(loading)return;loading=true;
      const now=new Date(),today=day(now),params=new URLSearchParams({limit:'100',from:new Date(now.getTime()-48*3600000).toISOString(),to:now.toISOString()});
      params.append('source','workforce');params.append('source','field_operations');
      let cursor=null,items=[];
      try{
        do{
          if(cursor)params.set('cursor',cursor);
          const response=await fetch('/api/events/register?'+params,{cache:'no-store'});
          if(!response.ok)throw new Error('Activity service unavailable');
          const result=await response.json();if(!Array.isArray(result.items))throw new Error('Invalid activity response');
          items.push(...result.items);cursor=result.nextCursor;
        }while(cursor);
        if(today!==day(new Date()))return;
        const current=items.filter(item=>['workforce','field_operations'].includes(item.source)&&day(item.occurredAt||item.recordedAt)===today).sort((a,b)=>Date.parse(b.occurredAt||b.recordedAt)-Date.parse(a.occurredAt||a.recordedAt));
        rows.replaceChildren(...current.map(item=>{
          const link=document.createElement('a');link.href='event-detail.html?id='+encodeURIComponent(item.eventId);
          const time=document.createElement('time');time.textContent=new Date(item.occurredAt||item.recordedAt).toLocaleTimeString('en-CA',{timeZone:zone,hour:'2-digit',minute:'2-digit',hour12:false});
          const text=document.createElement('span');text.textContent=item.summary||item.eventType;
          const site=document.createElement('small');site.textContent=item.site||item.payload?.site||item.payload?.station||'';
          link.append(time,text,site);return link;
        }));
        status.textContent=current.length?`${today} · ${current.length} events · Eastern time`:'No field activity recorded today · Eastern time';
      }catch(error){status.textContent='Unable to refresh field activity. Previous results may be stale.';}
      finally{loading=false;}
    }
    refresh();setInterval(()=>{if(!document.hidden)refresh();},30000);
    document.addEventListener('visibilitychange',()=>{if(!document.hidden)refresh();});
  };
  window.addEventListener('northstar:status-ready',start);
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start);else start();
})();
