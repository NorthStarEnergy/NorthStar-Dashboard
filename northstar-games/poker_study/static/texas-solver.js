'use strict';
(() => {
 const menu=document.querySelector('#mainMenu .menu-content');
 const entry=document.createElement('button');
 entry.className='button neutral';entry.textContent='TexasSolver · Postflop study';
 menu.append(entry);
 const dialog=document.createElement('dialog');dialog.className='texas-dialog';
 dialog.setAttribute('aria-labelledby','texasTitle');
 dialog.innerHTML=`
 <div class="texas-heading"><h2 id="texasTitle">TexasSolver</h2><button type="button" id="texasClose" class="button neutral">Close</button></div>
 <p class="small">Study a two-player postflop hand. Enter both ranges and the pot at the start of the street. All amounts are in BB.</p>
 <form id="texasForm" class="texas-form">
 <label>Board cards<input id="texasBoard" value="Qs Jh 2h 7c 3d" required autocomplete="off"></label>
 <label>Pot (BB)<input id="texasPot" type="number" min="1" max="1000" step="0.01" value="100" required></label>
 <label>Effective stack (BB)<input id="texasStack" type="number" min="1" max="1000" step="0.01" value="100" required></label>
 <label class="texas-wide">First to act (OOP) range<input id="texasOop" value="AA,KK,TT,99" required maxlength="5000" autocomplete="off"></label>
 <label class="texas-wide">Last to act (IP) range<input id="texasIp" value="AA,KK,TT,99" required maxlength="5000" autocomplete="off"></label>
 <p class="small texas-wide">Ranges: AA,AKs,AKo or AKs:0.5 for half weight. Bets: 50% pot; raises: 100% pot; all-in allowed. Stack limit: 4× pot. Range limits: 60 combinations on flop, 200 on turn, full ranges on river.</p>
 <button id="texasSolve" class="button primary" type="submit">Solve this spot</button>
 </form>
 <p id="texasStatus" role="status" aria-live="polite"></p>
 <section id="texasResults" hidden>
 <p id="texasMetrics" class="small"></p>
 <p id="texasPath"></p><div id="texasBranches" class="texas-branches"></div>
 <label>Find a hand<input id="texasFilter" placeholder="AA or AsAh" autocomplete="off"></label>
 <div class="texas-table"><table><thead id="texasHead"></thead><tbody id="texasRows"></tbody></table></div>
 <button id="texasDownload" class="button neutral" type="button">Download solver result</button>
 <p class="small">Results apply to these ranges and bet sizes. This study tool does not change the table bots. Future streets are included in solving; this view shows the current street.</p>
 </section>`;
 document.body.append(dialog);
 const el=id=>document.getElementById(id);
 const make=(tag,text)=>{const n=document.createElement(tag);n.textContent=text;return n;};
 const actionText=text=>text.replace(/ (\d+(?:\.\d+)?)/g,(_,n)=>' '+Number(n).toLocaleString(undefined,{maximumFractionDigits:2})+' BB');
 let timer=null,result=null,path=[],running=false;
 async function request(url,data){
  const r=await fetch(url,{method:data?'POST':'GET',headers:data?{'Content-Type':'application/json'}:{},body:data?JSON.stringify(data):undefined,credentials:'same-origin'});
  const value=await r.json();if(!r.ok||value.error)throw new Error(value.error||'Request failed.');return value;
 }
 function message(text){el('texasStatus').textContent=text;}
 function lock(value){running=value;el('texasSolve').disabled=value;}
 function render(){
  let current=result.tree;for(const action of path)current=current.childrens[action];
  el('texasPath').textContent=(path.length?path.map(actionText).join(' → ')+' · ':'')+(current.player===1?'OOP acts first':'IP acts last');
  el('texasBranches').replaceChildren();
  if(path.length){const back=make('button','← Back');back.className='button neutral';back.onclick=()=>{path.pop();render();};el('texasBranches').append(back);}
  for(const [action,child] of Object.entries(current.childrens||{})){
   if(!child.strategy)continue;
   const b=make('button',actionText(action));b.className='button neutral';b.onclick=()=>{path.push(action);render();};el('texasBranches').append(b);
  }
  const actions=current.strategy.actions;
  const head=document.createElement('tr');for(const text of ['Hand',...actions.map(actionText)]){const th=make('th',text);th.scope='col';head.append(th);}el('texasHead').replaceChildren(head);
  el('texasRows').replaceChildren();
  const filter=el('texasFilter').value.trim().toLowerCase().replace(/\s/g,'');
  for(const [hand,freq] of Object.entries(current.strategy.strategy)){
   const ranks=hand[0]+hand[2];
   if(filter&&!hand.toLowerCase().includes(filter)&&ranks.toLowerCase()!==filter)continue;
   const tr=document.createElement('tr');tr.append(make('td',hand.slice(0,2)+' '+hand.slice(2)));
   for(const p of freq)tr.append(make('td',(100*p).toFixed(1)+'%'));
   el('texasRows').append(tr);
  }
 }
 async function poll(){
  clearTimeout(timer);
  try{
   const state=await request('/api/texas-solver/status');
   if(state.status==='running'){lock(true);message('Solving… up to 90 seconds. You can close this window and return.');if(dialog.open)timer=setTimeout(poll,1500);return;}
   lock(false);el('texasSolve').disabled=!state.installed;
   if(state.status==='complete'){
    result=await request('/api/texas-solver/result');path=[];
    el('texasResults').hidden=false;
    const metric=result.reported_exploitability_percent;
    el('texasMetrics').textContent=result.engine+' · '+result.seconds+' seconds · Reported exploitability: '+(metric===null?'unavailable':metric.toFixed(3)+'%')+' · '+(result.target_met?'0.5% target reached.':'Accuracy target not reached; treat as an approximation.');
    message('Solve complete. Select an action to explore responses.');render();
   }else message(state.status==='failed'?state.error:state.installed?'Ready. Sample river spot loaded.':'TexasSolver is not installed on this host.');
  }catch(error){lock(false);message(error.message);}
 }
 entry.onclick=()=>{document.getElementById('mainMenu').open=false;dialog.showModal();poll();};
 el('texasClose').onclick=()=>dialog.close();
 dialog.addEventListener('close',()=>clearTimeout(timer));
 el('texasFilter').oninput=()=>{if(result)render();};
 el('texasForm').onsubmit=async event=>{
  event.preventDefault();if(running)return;clearTimeout(timer);lock(true);message('Starting solver…');
  try{
   await request('/api/texas-solver/solve',{board:el('texasBoard').value,pot:Number(el('texasPot').value),stack:Number(el('texasStack').value),oop_range:el('texasOop').value,ip_range:el('texasIp').value});
   result=null;el('texasResults').hidden=true;poll();
  }catch(error){lock(false);message(error.message);}
 };
 el('texasDownload').onclick=()=>{
  if(!result)return;
  const a=document.createElement('a');a.href='/api/texas-solver/download';a.download='northstar-texassolver-result.json';document.body.append(a);a.click();a.remove();
 };
})();

