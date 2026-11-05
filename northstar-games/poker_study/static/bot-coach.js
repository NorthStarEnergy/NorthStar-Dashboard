(() => {
 'use strict';
 const panel=document.getElementById('botCoach'),status=document.getElementById('coachStatus'),list=document.getElementById('coachBots');
 let report=null,loading=false;
 const el=(tag,text,className)=>{const node=document.createElement(tag);if(text!==undefined)node.textContent=text;if(className)node.className=className;return node;};
 const percent=value=>`${(value*100).toFixed(1)}%`;
 async function refresh(){
  if(loading)return;loading=true;status.textContent='Reviewing bot feedback…';
  document.getElementById('coachRefresh').disabled=true;
  try{
   const response=await fetch('/api/bot-coach',{credentials:'same-origin',cache:'no-store'});
   if(!response.ok)throw new Error(response.status===404||response.status===405?'The coach is waiting for the server update.':'The coach report is unavailable. Try again.');
   const data=await response.json();if(!Array.isArray(data.bots))throw new Error('The coach report is unavailable.');
   report=data;list.replaceChildren();
   const total=data.bots.reduce((sum,b)=>sum+b.decisions,0);
   status.textContent=data.error?`Coaching storage needs attention (${data.error}). Feedback may be stale.`:`${total.toLocaleString()} decisions reviewed · ${data.bots.length} bots · Updated ${new Date(data.updated*1000).toLocaleTimeString()}`;
   for(const bot of data.bots){
    const card=el('article',undefined,'coach-card');card.append(el('h3',bot.name),el('p',`${bot.decisions.toLocaleString()} decisions observed`,'small'));
    if(bot.free_checks_saved)card.append(el('p',`Avoided ${bot.free_checks_saved} unnecessary folds when checking was free.`));
    if(!bot.contexts.length)card.append(el('p','Collecting evidence. Feedback starts as this bot plays.'));
    for(const context of bot.contexts){
     const details=el('details'),summary=el('summary',`${context.name} · ${context.decisions} decisions`);details.append(summary);
     if(context.sample_size<data.min_samples)details.append(el('p',`Collecting evidence: ${context.sample_size} / ${data.min_samples} comparable decisions before the first review.`));
     else if(!context.findings.length)details.append(el('p','No recurring leak detected against the shared strategy.'));
     else for(const finding of context.findings)details.append(el('p',`${finding.message} Observed ${percent(finding.observed)}; reference ${percent(finding.reference)} across ${finding.samples} decisions.`));
     details.append(el('p',context.blend>0?`Correction active: gently move decisions toward the shared strategy. Maximum coaching change: 3 percentage points per decision.`:context.findings.length?'Watching this pattern. A second review with new decisions is required before correcting it.':'No learned correction active.'));
     if(context.blend>0)details.open=true;
     details.append(el('p',`Recent average distance from the reference: ${percent(context.raw_distance)} before safeguards → ${percent(context.delivered_distance)} after safeguards. This measures strategy alignment, not winnings.`,'small'));
     if(context.reviews.length){const log=el('ol',undefined,'coach-review-log');for(const review of context.reviews.slice(-3))log.append(el('li',`${review.decisions} decisions: ${review.status}`));details.append(log);}
     card.append(details);
    }
    list.append(card);
   }
   document.getElementById('coachDownload').disabled=false;
  }catch(error){status.textContent=error.message+(report?' Previous report remains below.':'');}
  finally{loading=false;document.getElementById('coachRefresh').disabled=false;}
 }
 document.querySelector('[data-tab="botCoach"]').addEventListener('click',refresh);
 document.getElementById('coachRefresh').addEventListener('click',refresh);
 document.getElementById('coachBack').addEventListener('click',()=>document.querySelector('[data-tab="play"]').click());
 document.getElementById('coachDownload').addEventListener('click',()=>{if(!report)return;const url=URL.createObjectURL(new Blob([JSON.stringify(report,null,2)],{type:'application/json'}));const link=el('a');link.href=url;link.download='northstar-bot-coaching.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);});
 setInterval(()=>{if(!panel.hidden&&!document.hidden)refresh();},30000);
})();
