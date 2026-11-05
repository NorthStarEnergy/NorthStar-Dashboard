(() => {
  'use strict';
  const $=id=>document.getElementById(id), id=new URLSearchParams(location.search).get('id');
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const date=v=>v&&!Number.isNaN(new Date(v).valueOf())?new Date(v).toLocaleString([], {timeZoneName:'short'}):'Not supplied';
  let section='history',cursor=null,request=0,items=[],attempt=null;
  async function json(url,options){const r=await fetch(url,{cache:'no-store',...options});let data;try{data=await r.json();}catch{throw Error('Unreadable service response.');}if(!r.ok)throw Error(data.error||'Event service unavailable.');return data;}
  function renderEvent(e,recurrence){
    document.title=(e.summary||e.eventType)+' · NorthStar event';$('title').textContent=e.summary||e.eventType;
    $('classification').textContent=[e.category,e.severity,e.source,e.eventType].join(' / ');
    const fields={Occurred:date(e.occurredAt),Recorded:date(e.recordedAt),Category:e.category,Severity:e.severity,'State at event':e.status||'Not supplied',Source:e.source,Actor:e.actorId,Site:e.site||'Not supplied',Equipment:e.payload?.equipment||e.payload?.node||'Not supplied','Event ID':e.eventId,'Object type':e.aggregateType,'Object ID':e.aggregateId,Correlation:e.correlationId||'Not supplied',Cause:e.causationId||'Not supplied'};
    $('metadata').innerHTML=Object.entries(fields).map(([k,v])=>`<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('');
    $('message').textContent=e.payload?.details||e.payload?.detail||e.payload?.text||'';
    $('raw').textContent=JSON.stringify(e,null,2);$('assistive').hidden=!e.payload?.assistiveOnly;
    $('original').hidden=true;try{const u=new URL(e.payload?.originalUrl);if(u.protocol==='https:'&&!u.username&&['outlook.office.com','outlook.office365.com','teams.microsoft.com','teams.cloud.microsoft'].includes(u.hostname)){$('original').href=u.href;$('original').hidden=false;}}catch{}
    $('prior').textContent=recurrence?.prior??'Unavailable';$('total').textContent=recurrence?.total??'Unavailable';$('first').textContent=date(recurrence?.firstOccurredAt);$('last').textContent=date(recurrence?.lastOccurredAt);$('basis').textContent=recurrence?.basis||'Recurrence reporting requires a backend service restart.';
  }
  async function load(older=false){
    const token=++request;$('more').disabled=true;$('error').hidden=true;$('retry').hidden=true;
    $('historyStatus').textContent='Loading…';
    const p=new URLSearchParams({id,section,limit:'50'});if(older&&cursor)p.set('cursor',cursor);
    try{if(!id)throw Error('No event ID supplied. Open an event from the register.');const data=await json('/api/events/detail?'+p);if(token!==request)return;
      renderEvent(data.event,data.recurrence);$('report').hidden=false;
      if(section!=='history'&&data.section!==section)throw Error('This history view requires a backend service restart.');
      items=older?[...items,...data.history.items]:data.history.items;cursor=data.history.nextCursor;
      $('timeline').innerHTML=items.map(e=>`<li><time>${esc(date(e.occurredAt))}</time><a href="event-detail.html?id=${encodeURIComponent(e.eventId)}">${esc(e.summary||e.eventType)}</a><small>${esc(e.category)} · ${esc(e.severity)} · ${esc(e.source)} · ${esc(e.actorId)}${e.status?' · '+esc(e.status):''}</small><p>${esc(e.payload?.details||e.payload?.detail||e.payload?.text||'')}</p></li>`).join('');
      $('historyStatus').textContent=`${items.length} of ${data.history.total} records · ${data.relationshipBasis||'Recorded object lifecycle'} · newest first${!items.length?' · No matching records':''}`;$('more').hidden=!cursor;
    }catch(error){if(token===request){$('error').textContent=error.message;$('error').hidden=false;$('retry').hidden=false;$('historyStatus').textContent='Unable to load requested history.';}}
    finally{if(token===request)$('more').disabled=false;}
  }
  document.querySelectorAll('[data-section]').forEach(b=>b.onclick=()=>{section=b.dataset.section;cursor=null;items=[];$('timeline').innerHTML='';$('more').hidden=true;document.querySelectorAll('[data-section]').forEach(t=>t.setAttribute('aria-pressed',String(t===b)));load();});
  $('more').onclick=()=>load(true);$('retry').onclick=()=>load();$('note').oninput=()=>attempt=null;
  $('noteForm').onsubmit=async e=>{e.preventDefault();const text=$('note').value.trim();if(!text||!id)return;attempt=attempt||crypto.randomUUID();$('save').disabled=true;$('note').disabled=true;$('noteStatus').textContent='Saving…';
    try{await json('/api/events/notes',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({eventId:id,text,requestId:attempt})});$('note').value='';attempt=null;$('noteStatus').textContent='Note recorded in object history.';await load();}
    catch(error){$('noteStatus').textContent='Not confirmed: '+error.message+' Retry to confirm the same note.';}finally{$('save').disabled=false;$('note').disabled=false;}
  };
  load();
})();
