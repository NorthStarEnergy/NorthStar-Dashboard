'use strict';

const $ = id => document.getElementById(id);
function applyDeckColors(){document.documentElement.classList.toggle('four-color-deck',$('fourColorDeck').checked);}
try{$('fourColorDeck').checked=localStorage.getItem('northstarPokerFourColorDeckV1')==='true';}catch{}
applyDeckColors();
$('fourColorDeck').addEventListener('change',()=>{applyDeckColors();try{localStorage.setItem('northstarPokerFourColorDeckV1',String($('fourColorDeck').checked));}catch{}});
$('autoReload').checked=true;$('autoReload').disabled=true;
$('autoReload').addEventListener('change',()=>{try{localStorage.setItem('northstarPokerAutoReloadV1',String($('autoReload').checked));}catch{}scheduleNext();});

let game = null, busy = false, ranges = null, replayFrames = [], replayEvents = [], replayIndex = 0;

let handAccuracy={number:null,scores:[],unrated:0};
try{handAccuracy=JSON.parse(sessionStorage.getItem('northstarPokerAccuracyV1'))||handAccuracy;}catch{}
let currentMode="grind",career=null,nextHandTimer=null;
let players=[], allOpponents=[], selectedProfile='maya', replayPlayers=[];

const tableLayoutKey='northstarPokerTableLayoutV1',tableDefaultKey='northstarPokerTableDefaultV1';let tableEditMode=false,tableLayout={},tableDrag=null,tableDefault={};try{tableDefault=JSON.parse(localStorage.getItem(tableDefaultKey)||'{}');tableLayout=JSON.parse(localStorage.getItem(tableLayoutKey)||JSON.stringify(tableDefault));}catch{tableLayout={...tableDefault};}function tableLayoutValues(el,layout){el.style.setProperty('--table-edit-x',`${layout.x||0}px`);el.style.setProperty('--table-edit-y',`${layout.y||0}px`);el.style.setProperty('--table-edit-scale',layout.scale||1)}function tableAsset(el,key){el.classList.add('table-asset');el.dataset.layoutKey=key;tableLayoutValues(el,tableLayout[key]||{});el.querySelector(':scope > .layout-resize-handle')?.remove();if(tableEditMode)el.append(node('span',undefined,'layout-resize-handle'))}function tablePoint(e){const r=document.querySelector('.poker-stage').getBoundingClientRect();return{x:e.clientX-r.left,y:e.clientY-r.top}}function prepareControlAssets(){
 for(const id of ['fold','call','raise','deal']){const control=document.getElementById(id);if(control)tableAsset(control,id);}
 const raiseControl=document.getElementById('raiseAmount')?.closest('.raise-control');if(raiseControl)tableAsset(raiseControl,'raise-control');
 document.querySelectorAll('#sizes button').forEach((control,index)=>tableAsset(control,`size-${index}`));
}document.addEventListener('pointerdown',e=>{if(!tableEditMode)return;const a=e.target.closest('.table-asset');if(!a)return;e.preventDefault();const p=tablePoint(e),l=tableLayout[a.dataset.layoutKey]||{};tableDrag={a,key:a.dataset.layoutKey,resize:!!e.target.closest('.layout-resize-handle'),x:p.x,y:p.y,ox:l.x||0,oy:l.y||0,scale:l.scale||1}});document.addEventListener('pointermove',e=>{if(!tableDrag)return;const p=tablePoint(e),l=tableLayout[tableDrag.key]||{},dx=p.x-tableDrag.x,dy=p.y-tableDrag.y;if(tableDrag.resize)l.scale=Math.max(.55,Math.min(1.8,tableDrag.scale+(dx+dy)/260));else{l.x=Math.round(tableDrag.ox+dx);l.y=Math.round(tableDrag.oy+dy)}tableLayout[tableDrag.key]=l;localStorage.setItem(tableLayoutKey,JSON.stringify(tableLayout));tableLayoutValues(tableDrag.a,l)});document.addEventListener('pointerup',()=>{if(tableDrag){localStorage.setItem(tableLayoutKey,JSON.stringify(tableLayout));tableDrag=null}});
const suits = {c:'♣',d:'♦',h:'♥',s:'♠'};

const bb = chips => Number((chips / 100).toFixed(2)).toLocaleString(undefined,{maximumFractionDigits:2});
// The engine uses raise for both bets and raises; preserve replay actions.
function actionName(event, history){
 if(event.action!=='raise'||event.street==='preflop')return event.action;
 const index=history.indexOf(event);
 return history.slice(0,index).some(e=>e.street===event.street&&['raise','bet'].includes(e.action))?'raise':'bet';
}

const bbLabel = chips => `${bb(chips)} BB`;
document.querySelectorAll('#stack option').forEach(option=>{option.textContent=`${option.value} BB`;});

const node = (tag, text, cls) => {const el=document.createElement(tag);if(text!==undefined)el.textContent=text;if(cls)el.className=cls;return el;};


// Preflop preferences are local to this browser, with an independent range per seat.
const autoFoldKey='northstarPokerAutoFoldV1',autoFoldPositions=['UTG','HJ','CO','BTN','SB','BB'];
let autoFoldPreferences={enabled:true,hands:{}},autoFoldAttempt=null;
try{
 const saved=JSON.parse(localStorage.getItem(autoFoldKey));
 if(saved&&typeof saved==='object'){
  autoFoldPreferences.enabled=saved.enabled!==false;
  for(const position of autoFoldPositions){
   const hands=saved.hands?.[position];
   if(Array.isArray(hands))autoFoldPreferences.hands[position]=hands.filter(hand=>typeof hand==='string'&&/^[AKQJT2-9]{2}[so]?$/.test(hand));
  }
 }
}catch{}
function startingHandName(hole){
 if(!Array.isArray(hole)||hole.length!==2||hole.some(card=>typeof card!=='string'||! /^[AKQJT2-9][cdhs]$/.test(card)))return null;
 const ranks='AKQJT98765432',sorted=[...hole].sort((a,b)=>ranks.indexOf(a[0])-ranks.indexOf(b[0]));
 return sorted[0][0]+sorted[1][0]+(sorted[0][0]===sorted[1][0]?'':sorted[0][1]===sorted[1][1]?'s':'o');
}
function saveAutoFoldPreferences(){
 try{localStorage.setItem(autoFoldKey,JSON.stringify(autoFoldPreferences));$('autoFoldStorageStatus').textContent='Saved in this browser.';}
 catch{$('autoFoldStorageStatus').textContent='Browser storage unavailable; selections apply until this page closes.';}
 scheduleNext();
}
function updateAutoFoldCell(cell,position,hand){
 const selected=(autoFoldPreferences.hands[position]||[]).includes(hand);
 cell.classList.toggle('auto-fold-selected',selected);
 cell.setAttribute('aria-pressed',String(selected));
 cell.setAttribute('aria-label',`${position} ${hand}: ${selected?'auto-fold selected':'play manually'}`);
}
function updateAutoFoldCount(){
 const position=$('autoFoldPosition').value,count=(autoFoldPreferences.hands[position]||[]).length;
 $('autoFoldCount').textContent=`${position}: ${count} of 169 hands selected`;
}
function renderAutoFoldRange(){
 const position=$('autoFoldPosition').value,ranks='AKQJT98765432';
 $('autoFoldGrid').replaceChildren();
 for(let row=0;row<13;row++)for(let col=0;col<13;col++){
  const hand=row===col?ranks[row]+ranks[col]:row<col?ranks[row]+ranks[col]+'s':ranks[col]+ranks[row]+'o';
  const cell=node('button',hand,'range-cell');cell.type='button';cell.dataset.hand=hand;
  updateAutoFoldCell(cell,position,hand);
  cell.addEventListener('click',()=>{
   const hands=new Set(autoFoldPreferences.hands[position]||[]);
   if(hands.has(hand))hands.delete(hand);else hands.add(hand);
   autoFoldPreferences.hands[position]=[...hands];
   updateAutoFoldCell(cell,position,hand);updateAutoFoldCount();saveAutoFoldPreferences();
  });
  $('autoFoldGrid').append(cell);
 }
 updateAutoFoldCount();
}
function autoFoldDecision(){
 if(!autoFoldPreferences.enabled||busy||tableEditMode||document.hidden||$('loginPrompt').open||currentMode==='sim'||!game||game.done||game.bot_thinking||game.street!=='preflop'||game.actor!==game.hero||game.folded?.[game.hero]||game.stacks?.[game.hero]<=0)return null;
 const hand=startingHandName(game.hole),position=game.positions?.[game.hero]||game.position;
 if(!hand||!(autoFoldPreferences.hands[position]||[]).includes(hand)||!Number.isFinite(game.legal?.call))return null;
 const key=JSON.stringify([game.hand_number,game.hero,position,hand,game.history.length]);
 if(key===autoFoldAttempt)return null;
 return {key,action:game.legal.call>0?'fold':'check'};
}
$('autoFoldEnabled').checked=autoFoldPreferences.enabled;
$('autoFoldEnabled').addEventListener('change',()=>{autoFoldPreferences.enabled=$('autoFoldEnabled').checked;saveAutoFoldPreferences();});
$('autoFoldPosition').addEventListener('change',renderAutoFoldRange);
$('clearAutoFoldPosition').addEventListener('click',()=>{autoFoldPreferences.hands[$('autoFoldPosition').value]=[];renderAutoFoldRange();saveAutoFoldPreferences();});
renderAutoFoldRange();

function cards(target, values, placeholders=0) {

 target.replaceChildren();

 for(const value of [...values,...Array(Math.max(0,placeholders-values.length)).fill(null)]) {

  const el=node('span',undefined,'card'+(!value?' blank':value==='??'?' back':['h','d'].includes(value[1])?' red':''));

  if(!value) el.textContent='·'; else if(value==='??') {el.textContent='✦';el.setAttribute('aria-label','Hidden card');}

  else {el.dataset.suit=value[1];el.append(node('span',value[0]==='T'?'10':value[0]),node('span',suits[value[1]],'suit'));el.setAttribute('aria-label',value);}

  target.append(el);

 }

}

async function api(path, data) {

 const response=await fetch(path,{method:data===undefined?'GET':'POST',headers:data===undefined?{}:{'Content-Type':'application/json'},body:data===undefined?undefined:JSON.stringify(data),credentials:'same-origin'});

 const body=await response.text();
 let result;
 try{result=JSON.parse(body);}catch{throw new Error(response.ok?'The server returned an invalid response. Refresh and try again.':'The server is temporarily unavailable. Refresh and try again.');}
 if(!response.ok)throw new Error(result.error||'The request could not be completed.');
 return result;

}

const playerDialog=node('dialog',undefined,'player-dialog');
playerDialog.id='playerDialog';
playerDialog.innerHTML='<div class="player-dialog-head"><h2 id="playerDialogTitle">Player profile</h2><button type="button" id="closePlayerDialog" class="button neutral" aria-label="Close player profile">Close</button></div><div id="playerDialogBody"></div>';
document.body.append(playerDialog);
$('closePlayerDialog').addEventListener('click',()=>playerDialog.close());
let profileOpenId=null;
function profileButton(player,label=player.name){
 const button=node('button',label,'profile-link');
 button.type='button';
 button.addEventListener('click',()=>openPlayerProfile(player.id));
 return button;
}
function profileHand(hand){
 const item=node('details',undefined,'profile-hand');
 const summary=node('summary',`Hand ${hand.hand_no} · Pot ${bb(hand.pot)} BB · ${hand.net>=0?'+':''}${bb(hand.net)} BB`);
 item.append(summary);
 const cardsText=cards=>(cards||[]).map(card=>card[0]+(suits[card[1]]||card[1])).join(' ')||'None';
 item.append(node('p',`Your cards: ${cardsText(hand.hole)} · Board: ${cardsText(hand.board)}`,'small'));
 const list=node('ol',undefined,'profile-actions');
 for(const event of hand.actions||[]){
  const name=hand.players?.[event.seat]||`Seat ${event.seat+1}`;
  const label=actionName(event,hand.actions);
  list.append(node('li',`${event.street} · ${name}: ${label}${event.amount==null?'':(label==='raise'?' to ':' ')+bb(event.amount)+' BB'}`));
 }
 item.append(list);
 return item;
}
function profileChart(points){
 if(!points.length)return node('p','No recorded hand chart yet.','small');
 const box=node('div',undefined,'profile-chart');
 const min=Math.min(0,...points.map(p=>p.profit)),max=Math.max(0,...points.map(p=>p.profit));
 const scale=max===min?1:max-min;
 const coords=points.map((p,i)=>[20+(i/Math.max(1,points.length-1))*580,160-140*(p.profit-min)/scale]);
 const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');
 svg.setAttribute('viewBox','0 0 620 180');svg.setAttribute('role','img');
 svg.setAttribute('aria-label',`Recorded profit chart, ${points.length} samples; latest ${bb(points.at(-1).profit)} BB`);
 const baseline=document.createElementNS(svg.namespaceURI,'line');
 baseline.setAttribute('x1','20');baseline.setAttribute('x2','600');
 baseline.setAttribute('y1',String(160-140*(0-min)/scale));baseline.setAttribute('y2',String(160-140*(0-min)/scale));
 baseline.setAttribute('stroke','#61746d');svg.append(baseline);
 const line=document.createElementNS(svg.namespaceURI,'polyline');
 line.setAttribute('points',coords.map(pair=>pair.join(',')).join(' '));
 line.setAttribute('fill','none');line.setAttribute('stroke','#d5bd83');line.setAttribute('stroke-width','3');
 svg.append(line);box.append(svg);
 box.append(node('span',`Recorded profit: ${bb(points.at(-1).profit)} BB · ${points.at(-1).hand} hands shown`,'small'));
 return box;
}
async function openPlayerProfile(id,offset=0){
 if(!id)return;
 if(offset===0){
  profileOpenId=id;
  $('playerDialogTitle').textContent='Loading player profile…';
  $('playerDialogBody').replaceChildren();
  playerDialog.showModal();
 }
 try{
  const data=await api(`/api/players/${id}${offset?'/hands/'+offset:''}`);
  if(profileOpenId!==id)return;
  const body=$('playerDialogBody');
  if(offset===0){
   const p=data.player;
   $('playerDialogTitle').textContent=p.name;
   body.append(node('p',`${p.kind}${p.style?' · '+p.style:''} · ${p.hands} hands · ${p.wins} wins · ${p.rebuys} reloads · ${p.profit>=0?'+':''}${bbLabel(p.profit)} profit`,'profile-summary'));
   body.append(node('h3','Performance'),profileChart(data.performance));
   if(data.recorded_hands<p.hands)body.append(node('p',`Detailed records available for ${data.recorded_hands} hands played since this feature was added.`,'small'));
   body.append(node('h3','Largest 10 pots'));
   const top=node('div',undefined,'profile-hand-list');
   if(data.top_pots.length)for(const hand of data.top_pots)top.append(profileHand(hand));
   else top.append(node('p','No completed pots recorded yet.','small'));
   body.append(top,node('h3','Hand histories'));
   const history=node('div',undefined,'profile-hand-list');history.id='profileHistory';body.append(history);
  }
  const history=$('profileHistory');
  if(data.hands.length)for(const hand of data.hands)history.append(profileHand(hand));
  else if(!offset)history.append(node('p','No completed hands recorded yet.','small'));
  $('profileMore')?.remove();
  if(data.next_offset!==null){
   const more=node('button','Load more hands','button neutral');more.id='profileMore';
   more.addEventListener('click',()=>openPlayerProfile(id,data.next_offset));body.append(more);
  }
 }catch(error){$('playerDialogBody').append(node('p',error.message||'Profile unavailable.','small'));}
}

function renderAccount(account){
 const signedIn=!!account;
 $('accountSignedOut').hidden=signedIn;$('accountSignedIn').hidden=!signedIn;
 if(signedIn)$('accountLabel').textContent=`Signed in as ${account.id}`;
}

async function accountAction(path){
 if(busy)return;
 $('accountStatus').textContent='';
 const id=$('accountId').value,password=$('accountPassword').value,remember=$('rememberMe').checked;
 try{
  const data=path.endsWith('register')?{id,password,name:$('characterName').value}:{id,password};
  const result=await api(path,{...data,remember});autoFoldAttempt=null;render(result);$('accountPassword').value='';if($('loginPrompt').open)$('loginPrompt').close();
  window.dispatchEvent(new CustomEvent('northstar:games-account-change',{detail:{source:'poker'}}));
  $('accountStatus').textContent=path.endsWith('register')?'Account created. You can now sign in on another device.':path.endsWith('login')?'Signed in; your saved career is loaded.':'Signed out.';scheduleNext();
 }catch(error){$('accountStatus').textContent=error.message||'Account request failed.';}
}

async function task(fn) {

 if(busy)return;

 busy=true;$('status').textContent='';document.body.setAttribute('aria-busy','true');

 const states=[...document.querySelectorAll('button:not(#soundToggle)')].filter(b=>!b.closest('.ns-invite-dialog,.ns-invite-bar')).map(b=>[b,b.disabled]);states.forEach(([b])=>b.disabled=true);

 try{await fn();}catch(error){$('autoDeal').checked=false;clearTimeout(nextHandTimer);$('status').textContent=error.message||'Please try again.';}

 finally{busy=false;document.body.removeAttribute('aria-busy');states.forEach(([b,d])=>{if(b.isConnected)b.disabled=d;});renderControls();scheduleNext();}

}

function renderControls(){

 const active=game&&!game.done&&!busy&&currentMode!=='sim'&&game.actor===game.hero;
 $('deal').disabled=!tableEditMode&&(busy||!!(game&&!game.done&&currentMode!=='study'));
 $('tableMode').disabled=busy||!!(game&&!game.done&&currentMode!=='study');
 $('stack').disabled=$('position').disabled=$('tableMode').value!=='study';
 $('minBet').disabled=$('maxBet').disabled=busy||!!(game&&!game.done);
 $('rebuy').hidden=!career||career.stack>0;
 $('rebuy').disabled=busy||!!(game&&!game.done);

 for(const id of ['hint','equity','exportSpot'])$(id).disabled=!active;

 $('downloadHand').disabled=!game;

 $('fold').disabled=!active&&!tableEditMode;

 $('call').disabled=!active&&!tableEditMode;

 const legal=active?game.legal:{};

 $('call').textContent=legal.call?`Call ${bbLabel(legal.call)}`:'Check';
 $('fold').textContent=matchMedia('(max-width:760px)').matches&&!legal.call?'Check / Fold':'Fold';

 const canRaise=active&&legal.raise_min!==null;

 $('raise').textContent=game&&Math.max(...game.street_bets)===0?'Bet':'Raise';
 $('raiseAmount').previousElementSibling.innerHTML=($('raise').textContent==='Bet'?'Bet':'Raise to')+' <span>(BB)</span>';
 $('raise').disabled=!canRaise&&!tableEditMode;$('raiseAmount').disabled=!canRaise;
 document.querySelectorAll('#sizes button').forEach(button=>button.disabled=!canRaise&&!tableEditMode);
 document.querySelectorAll('#mobileRaiseLevels button').forEach(button=>button.disabled=!canRaise||tableEditMode||button.dataset.duplicate==='true');

 $('previous').disabled=replayIndex<=0;$('next').disabled=!replayFrames.length||replayIndex>=replayFrames.length-1;

}

function render(data){

 game=data.game;
 if(game&&handAccuracy.number!==(game.hand_number)){handAccuracy={number:game.hand_number,scores:[],unrated:0};sessionStorage.setItem('northstarPokerAccuracyV1',JSON.stringify(handAccuracy));}
 renderHandPerformance();
 $('version').textContent='v'+data.version;
 if(data.account!==undefined)renderAccount(data.account);
 if(data.mode&&game){currentMode=data.mode;$('tableMode').value=data.mode;}
 if(data.career!==undefined)career=data.career;
 if(data.bet_limits){if(document.activeElement!==$('minBet'))$('minBet').value=bb(data.bet_limits.min);if(document.activeElement!==$('maxBet'))$('maxBet').value=bb(data.bet_limits.max);}
 if(career){if(document.activeElement!==$('characterName'))$('characterName').value=career.name;$('careerStats').textContent=`${career.name} · ${bbLabel(career.stack)} · ${career.hands} hands · ${career.wins} winning hands · ${career.net>=0?'+':''}${bbLabel(career.net)} profit · ${career.reloads??Math.max(0,career.buyins-1)} reload(s) · Best ${bbLabel(career.best)}`;}
 $('tableNotice').textContent=game?.bot_thinking?'Bot is calculating its move…':(data.notice||'');

 const hero=game?game.hero:Number($('position').value);

 if(data.players)allOpponents=data.players.filter(Boolean);

 let opponentIndex=0;players=data.players||Array.from({length:6},(_,i)=>i===hero?null:allOpponents[opponentIndex++]);

 renderProfiles();

 $('seats').replaceChildren();

 for(let offset=0;offset<6;offset++){

  const i=(hero+offset)%6, isHero=i===hero&&currentMode!=='sim';

  const seat=node('div',undefined,`seat s${offset}${isHero?' hero':''}${game&&game.folded[i]?' folded':''}`);

  tableAsset(seat,'seat-'+offset);

  const hand=node('div',undefined,'cards');

  const values=game?(isHero?game.hole:game.showdown[String(i)]||['??','??']):['??','??'];cards(hand,values);

  const person=players[i];

  const box=node(person?'button':'div',undefined,'seat-box'),name=node('div',isHero?(career&&currentMode==='grind'?career.name:'You'):person?person.name.split(' ')[0]:`Seat ${i+1}`,'seat-name');

  if(person){const avatar=node('img',undefined,'seat-avatar');avatar.src=person.avatar;avatar.alt='';box.append(avatar);box.title=person.name+' · '+person.style;box.setAttribute('aria-label',person.name+' — view playstyle');box.addEventListener('click',()=>{selectedProfile=person.id;renderProfiles();$('profile').scrollIntoView({block:'nearest',behavior:'smooth'});});}

  const pos=game?game.positions[i]:['BTN','SB','BB','UTG','HJ','CO'][i];name.append(node('b',pos));

  if(i===(game?game.button:0)){const dealer=node('span','D','dealer');dealer.setAttribute('aria-label','Dealer button');seat.append(dealer);}

  const stackAmount=game?game.stacks[i]:Number($('stack').value)*100;
  const info=node('div',undefined,'seat-info');info.append(name,node('div',`${bb(stackAmount)} BBs`,'seat-stack'));box.append(info);

  const bet=game&&game.folded[i]?'Folded':game&&game.stacks[i]===0&&!game.done?'All-in':game&&game.street_bets[i]&&!game.done?`${bb(game.street_bets[i])} BB committed`:'';

  seat.dataset.seat=i;

  seat.append(hand,box,node('div',bet,'seat-bet'));

  if(game&&game.street_bets[i]&&!game.done){const pile=chipPile(game.street_bets[i]);const wager=node('span',undefined,'wager');const last=game.history.filter(e=>e.seat===i&&e.street===game.street).at(-1);const action=last?actionName(last,game.history):null;const label=action==='raise'?'Raise':action==='call'?'Call':action==='bet'?'Bet':'Blind';wager.append(pile,node('strong',`${label} ${bbLabel(game.street_bets[i])}`,'wager-label'));seat.append(wager);}$('seats').append(seat);

 }

 const potChips=$('potChips');potChips.replaceChildren();if(game&&game.pot)potChips.append(chipPile(game.pot));

 tableAsset(document.querySelector('.center-cards'),'board');
tableAsset($('decisionLabel').closest('.table-decision'),'decision');

cards($('board'),game?game.board:[],5);

 $('handLabel').textContent=game?`Hand ${String(game.hand_number).padStart(2,'0')} · ${game.position}`:'Ready when you are';

 $('streetLabel').textContent=game?(game.done?'HAND COMPLETE':game.street.toUpperCase()):'6-MAX CASH';

 $('pot').textContent=game?(game.done?`Total pot ${bbLabel(game.total.reduce((a,b)=>a+b,0))}`:`Pot ${bbLabel(game.pot)}`):'Deal your first hand';

 $('decisionLabel').textContent='ACTION - XXXXX';

 $('decisionText').textContent=!game?'Take a seat at the table.':game.done?'Review the hand, then deal again.':game.bot_thinking?'Calculating a move. Play will continue automatically.':game.legal.call?`${bbLabel(game.legal.call)} to continue.`:'You can check or bet.';

 $('result').textContent=game&&game.done?`${game.net>=0?'+':''}${bbLabel(game.net)}`:'';

 $('deal').replaceChildren(document.createTextNode(game?'Deal next hand':'Deal a hand'),node('span','→'));

 renderBetPresets();

 $('activity').replaceChildren();

 for(const event of game?game.history:[]){$('activity').append(node('li',`${event.street.toUpperCase()} · ${event.seat===game.hero&&currentMode!=='sim'?(career&&currentMode==='grind'?career.name:'You'):players[event.seat]?.name||'Seat '+(event.seat+1)} (${game.positions[event.seat]}) · ${actionName(event,game.history)}${event.amount!==null?(actionName(event,game.history)==='raise'?' to ':' ')+bb(event.amount)+' BB':''}`));}

 $('actionCount').textContent=`${game?game.history.length:0} actions`;

 $('strategyStatus').textContent=game&&game.imported_states?`${game.imported_states} imported states available`:'Mixed strategy with subtle player tendencies'; if(tableEditMode)prepareControlAssets();


 renderControls();

}

function renderProfiles(){

 $('roster').replaceChildren();

 for(const person of allOpponents){const button=node('button',undefined,'roster-player'+(person.id===selectedProfile?' selected':''));button.setAttribute('aria-label',person.name+' profile');button.setAttribute('aria-pressed',String(person.id===selectedProfile));const avatar=node('img');avatar.src=person.avatar;avatar.alt='';button.append(avatar,node('span',person.name.split(' ')[0]));button.addEventListener('click',()=>{selectedProfile=person.id;renderProfiles();});$('roster').append(button);}

 const person=allOpponents.find(p=>p.id===selectedProfile)||allOpponents[0];$('profile').replaceChildren();if(!person)return;

 const header=node('div',undefined,'profile-heading'),avatar=node('img');avatar.src=person.avatar;avatar.alt=person.name+' classic avatar';const text=node('div');text.append(node('strong',person.name),node('span',person.style));header.append(avatar,text);$('profile').append(header,node('p',person.description));const list=node('ul');for(const trait of person.tendencies)list.append(node('li',trait));$('profile').append(list);

}

function clearStudy(){ $('hintRows').replaceChildren();$('hintText').textContent='Make your decision, or reveal the study policy before you act.';$('equityResult').textContent='';}

function download(name, data){const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));const a=node('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);}

async function readFile(input){const file=input.files[0];if(!file)return null;if(file.size>1048576)throw new Error('Choose a JSON file smaller than 1 MB.');return JSON.parse(await file.text());}

async function act(label){if(tableEditMode)return;unlockAudio();await task(async()=>{
 let score=null;try{score=practiceActionScore(label,(await api('/api/hint',{})).probabilities);}catch{}
 const data=await api('/api/action',{action:label});
 if(score===null)handAccuracy.unrated++;else handAccuracy.scores.push(score);
 sessionStorage.setItem('northstarPokerAccuracyV1',JSON.stringify(handAccuracy));
 await present(data);clearStudy();
});}

async function dealNext(){if(tableEditMode)return;unlockAudio();const minBet=Number($('minBet').value),maxBet=Number($('maxBet').value);if(!$('minBet').checkValidity()||!$('maxBet').checkValidity()||minBet>maxBet){$('status').textContent='Choose bet limits from 1 to 300 BB, with minimum no greater than maximum.';return;}return task(async()=>{await present(await api('/api/new',{mode:$('tableMode').value,hero:Number($('position').value),stack_bb:Number($('stack').value),auto_reload:$('autoReload').checked,min_bet:Math.round(minBet*100),max_bet:Math.round(maxBet*100)}));clearStudy();});}
$('deal').addEventListener('click',dealNext);

$('fold').addEventListener('click',()=>act(matchMedia('(max-width:760px)').matches&&!game.legal.call?'check':'fold'));

$('call').addEventListener('click',()=>act(game.legal.call?'call':'check'));

$('raise').addEventListener('click',()=>{if(tableEditMode)return;const amount=Number($('raiseAmount').value);if(!$('raiseAmount').checkValidity()||!Number.isFinite(amount)){$('status').textContent='Enter a legal raise amount within the displayed limits.';return;}act('raise:'+Math.round(amount*100));});

$('hint').addEventListener('click',()=>task(async()=>{const hint=await api('/api/hint',{});$('hintText').textContent=hint.source;$('hintRows').replaceChildren();for(const [action,probability]of Object.entries(hint.probabilities)){const row=node('div',undefined,'hint-row');row.append(node('span',action.startsWith('raise:')?`${Math.max(...game.street_bets)===0?'Bet':'Raise to'} ${bb(Number(action.split(':')[1]))} BB`:action[0].toUpperCase()+action.slice(1)),node('strong',`${Math.round(probability*100)}%`));$('hintRows').append(row);}}));

$('equity').addEventListener('click',()=>task(async()=>{$('equityResult').textContent='Estimating showdown equity…';const value=await api('/api/equity',{});$('equityResult').textContent=`${(value.equity*100).toFixed(1)}% estimated equity · sampling SE ${(value.standard_error*100).toFixed(1)} percentage points. Uniform random opponents; no future betting.`;}));

$('downloadHand').addEventListener('click',()=>task(async()=>download('northstar-hand.json',withHandPerformance(await api('/api/history')))));

$('exportSpot').addEventListener('click',()=>task(async()=>download('northstar-study-spot.json',await api('/api/spot',{}))));

$('strategyFile').addEventListener('change',()=>task(async()=>{const data=await readFile($('strategyFile'));if(data){const value=await api('/api/strategy',data);render(value);$('status').textContent=value.message;} $('strategyFile').value='';}));

function renderRange(){if(!ranges)return;const position=$('rangePosition').value,table=ranges[position],ranks='AKQJT98765432';$('rangeGrid').replaceChildren();for(let row=0;row<13;row++)for(let col=0;col<13;col++){const name=row===col?ranks[row]+ranks[col]:row<col?ranks[row]+ranks[col]+'s':ranks[col]+ranks[row]+'o';const freq=table[name];const cell=node('button',name,'range-cell'+(freq?' open':''));cell.setAttribute('aria-label',`${name}: raise ${freq*100}%`);cell.addEventListener('click',()=>{document.querySelectorAll('.range-cell.selected').forEach(e=>e.classList.remove('selected'));cell.classList.add('selected');$('rangeSelection').textContent=`${position} · ${name} · Raise ${(freq*100).toFixed(0)}%, fold ${((1-freq)*100).toFixed(0)}%`;});$('rangeGrid').append(cell);}}

$('backToTable').addEventListener('click',()=>document.querySelector('.tab[data-tab="play"]').click());
for(const button of document.querySelectorAll('.tab'))button.addEventListener('click',async()=>{if(busy)return;$('mainMenu').open=false;$('mainMenu').querySelector('summary').focus();for(const tab of document.querySelectorAll('.tab')){tab.classList.toggle('active',tab===button);tab.setAttribute('aria-selected',String(tab===button));}for(const panel of document.querySelectorAll('.tab-panel'))panel.hidden=panel.id!==button.dataset.tab;if(button.dataset.tab==='ranges'&&!ranges)await task(async()=>{ranges=(await api('/api/ranges')).ranges;renderRange();});});

$('rangePosition').addEventListener('change',renderRange);
function leagueChips(value){return Math.round(value/100).toLocaleString();}
let observedTable=null, leagueSnapshot=null, leagueLoading=false;
function observerCards(table,player){return table.bot_only===true?player.hole||['??','??']:['??','??'];}
function leagueAction(event,history){const action=actionName(event,history);return action[0].toUpperCase()+action.slice(1)+(event.amount!=null?(action==='raise'?' to ':' ')+bb(event.amount)+' BB':'');}
function leagueSeatAction(table,index){
 const event=[...(table.history||[])].reverse().find(e=>e.seat===index);
 const last=event?`${event.street} · ${leagueAction(event,table.history)}`:'';
 if(!table.done&&table.actor===index)return 'Acting now'+(last?' · '+last:'');
 return last||(table.done?'Hand complete':'Waiting');
}
function renderLeagueHistory(target,table){
 target.replaceChildren();
 for(const event of (table.history||[]).slice(-12))target.append(node('li',`${event.street} · ${table.players[event.seat].name}: ${leagueAction(event,table.history)}`));
 for(const award of table.awards||[])target.append(node('li',`${award.winners.map(i=>table.players[i].name).join(' / ')} awarded ${bb(award.amount)} BB`));
 target.scrollTop=target.scrollHeight;
}
function renderLeague(data){
 leagueSnapshot=data;
 if(!data||!Array.isArray(data.tables))return;
 $('leagueMeta').textContent=`${data.hands_completed.toLocaleString()} hands completed · ${data.rotations} seat rotations · ${(data.waiting||[]).length} waiting`;
 $('leagueTables').replaceChildren();
 if(!data.tables.length)$('leagueTables').append(node('p','No tables are running.','small'));
 for(const table of data.tables){
  const panel=node('article',undefined,'league-card'),head=node('div',undefined,'league-card-head');head.append(node('span',`TABLE ${String(table.id).padStart(2,'0')}`),node('span',`HAND ${String(table.hand).padStart(3,'0')} · ${table.street.toUpperCase()}`));panel.append(head);
  const board=node('div',undefined,'league-board');if(table.board.length){for(const card of table.board){const c=node('span',undefined,'card'+(['h','d'].includes(card[1])?' red':''));c.dataset.suit=card[1];c.append(node('span',card[0]),node('span',suits[card[1]],'suit'));board.append(c);}}else board.append(node('span','♠  ♥  ♦  ♣','small'));panel.append(board);
  table.players.forEach((player,index)=>{
   const row=node('div',undefined,'league-player'+(!table.done&&table.actor===index?' acting':'')),img=node('img');img.src=player.avatar;img.alt='';
   const details=node('div',undefined,'league-player-detail');details.append(node('div',player.name,'league-player-name'),node('div',`${player.style} · ${player.rating} rating · ${player.hands} hands`,'league-player-sub'),node('div',leagueSeatAction(table,index),'league-action'));
   const hand=node('div',undefined,'cards league-hole');cards(hand,observerCards(table,player));
   row.append(img,details,hand,node('span',`${leagueChips(player.stack)} BB · bank ${leagueChips(player.bankroll)} BB`,'league-player-stack'));panel.append(row);
  });
  const history=node('ol',undefined,'observer-history league-history');panel.append(history);renderLeagueHistory(history,table);
  const watch=node('button',`Observe table ${table.id} · Pot ${bb(table.pot)} BB`,'button primary');watch.addEventListener('click',()=>{observedTable=table.id;renderObserver();$('observer').scrollIntoView({block:'start',behavior:'smooth'});});panel.append(watch);
  $('leagueTables').append(panel);history.scrollTop=history.scrollHeight;
 }
 renderObserver();
 $('leagueRanks').replaceChildren();
  for(const [index,player] of data.leaderboard.entries()){const row=node('tr'),who=node('td'),whoInner=node('span',undefined,'league-ranked-player'),img=node('img');img.src=player.avatar;img.alt='';whoInner.append(img,profileButton({id:'bot:'+player.id},`${index+1}. ${player.name}`));who.append(whoInner);row.append(who,node('td',player.style),node('td',`${leagueChips(player.bankroll)} BB`),node('td',player.rating.toLocaleString()),node('td',player.hands.toLocaleString()),node('td',`${player.wins}-${player.hands-player.wins}`),node('td',`${player.profit>=0?'+':''}${leagueChips(player.profit)} BB`,'league-'+(player.profit>=0?'positive':'negative')),node('td',`${player.vpip}% / ${player.pfr}%`));$('leagueRanks').append(row);}
}
function renderObserver(){
 const table=leagueSnapshot?.tables.find(t=>t.id===observedTable);
 $('observer').hidden=!table;$('leagueTables').hidden=!!table;
 if(!table)return;
 $('observerTitle').textContent=`Observing table ${table.id}`;
 $('observerMeta').textContent=`LIVE · Hand ${table.hand} · ${table.done?'Hand complete':table.street} · Pot ${bb(table.pot)} BB · Read-only`;
 cards($('observerBoard'),table.board,5);$('observerSeats').replaceChildren();
 table.players.forEach((player,index)=>{
  const seat=node('article',undefined,'observer-seat'+(table.actor===index?' acting':'')+(player.folded?' folded':''));
  const avatar=node('img');avatar.src=player.avatar;avatar.alt='';
  seat.append(avatar,node('strong',player.name),node('span',`${player.position||''}${table.button===index?' · Dealer':''}`,'small'),node('b',`${bb(player.stack)} BB`),node('span',player.folded?'Folded':table.actor===index?'Acting now':table.done?'Hand complete':player.stack===0?'All-in':`${bb(player.bet||0)} BB committed`,'small'));
  seat.append(node('span',leagueSeatAction(table,index),'league-action'));
  tableAsset(seat,'seat-'+offset);

  const hand=node('div',undefined,'cards');cards(hand,observerCards(table,player));seat.append(hand);$('observerSeats').append(seat);
 });
 renderLeagueHistory($('observerHistory'),table);
}
$('closeObserver').addEventListener('click',()=>{observedTable=null;renderObserver();});
async function refreshLeague(){if(document.hidden||leagueLoading)return;leagueLoading=true;try{renderLeague(await api('/api/league'));}catch{$('leagueMeta').textContent='Connection interrupted · reconnecting…';if(observedTable!==null)$('observerMeta').textContent='Connection interrupted · displayed table may be stale';}finally{leagueLoading=false;}}
refreshLeague();setInterval(()=>{if(!$('league').hidden)refreshLeague();},500);document.addEventListener('visibilitychange',refreshLeague);

function renderReplay(){const frame=replayFrames[replayIndex];if(!frame)return;$('replayStep').textContent=`Step ${replayIndex} of ${replayFrames.length-1}`;$('replayTitle').textContent=frame.street[0].toUpperCase()+frame.street.slice(1);cards($('replayBoard'),frame.board,5);$('replayDetails').replaceChildren();const last=replayEvents[replayIndex-1];$('replayDetails').append(node('p',last?`${replayPlayers[last.seat]?.name||'Seat '+(last.seat+1)}: ${last.action}${last.amount!==null?' to '+bb(last.amount)+' BB':''}`:'Blinds posted. Action begins.'));for(const [label,value]of [['Pot',bb(frame.pot)+' BB'],['Next actor',frame.actor===null?'Hand complete':`${replayPlayers[frame.actor]?.name||'Seat '+(frame.actor+1)} · ${frame.position}`],['Actor cards',frame.hole.join(' ')||'—'],['Stacks',frame.stacks.map(s=>bb(s)).join(' / ')+' BB']]){const line=node('div',undefined,'replay-line');line.append(node('span',label),node('span',value));$('replayDetails').append(line);}renderControls();}

$('replayFile').addEventListener('change',()=>task(async()=>{const data=await readFile($('replayFile'));if(data){const replay=await api('/api/replay',data);replayFrames=replay.frames;replayEvents=data.actions;replayPlayers=Array.isArray(data.players)?data.players:[];replayIndex=0;renderReplay();}$('replayFile').value='';}));

$('previous').addEventListener('click',()=>{if(replayIndex>0){replayIndex--;renderReplay();}});$('next').addEventListener('click',()=>{if(replayIndex<replayFrames.length-1){replayIndex++;renderReplay();}});

$('stack').addEventListener('change',()=>{if(!game)render({game:null,version:'0.4.0'});});$('position').addEventListener('change',()=>{if(!game)render({game:null,version:'0.4.0'});});

document.body.append($('loginPrompt'));
tableAsset($('actionPanel'),'controls');
renderBetPresets();
prepareControlAssets();
task(async()=>{const state=await api('/api/state');render(state);if(!state.account&&!sessionStorage.getItem('guestChosen'))$('loginPrompt').showModal();});
$('continueGuest').addEventListener('click',()=>sessionStorage.setItem('guestChosen','1'));
$('createAccount').addEventListener('click',()=>accountAction('/api/auth/register'));
$('signIn').addEventListener('click',()=>accountAction('/api/auth/login'));
$('signOut').addEventListener('click',()=>accountAction('/api/auth/logout'));



// Sound begins only after a user gesture; a muted/unavailable device never blocks play.

let audioContext=null, soundEnabled=true;

function unlockAudio(){try{if(!soundEnabled)return;audioContext ||= new (window.AudioContext||window.webkitAudioContext)();audioContext.resume().catch(()=>{});}catch{}}

function actionSound(action){

 if(!soundEnabled||!audioContext||audioContext.state!=='running')return;

 const count=action==='raise'||action==='call'?3:1;

 for(let i=0;i<count;i++){const t=audioContext.currentTime+i*.045,o=audioContext.createOscillator(),g=audioContext.createGain();o.type='triangle';o.frequency.setValueAtTime(action==='fold'?180:action==='check'?330:1050+i*170,t);o.frequency.exponentialRampToValueAtTime(100,t+.07);g.gain.setValueAtTime(.045,t);g.gain.exponentialRampToValueAtTime(.001,t+.08);o.connect(g);g.connect(audioContext.destination);o.start(t);o.stop(t+.09);o.onended=()=>{o.disconnect();g.disconnect();};}

}

function chipPile(amount){const pile=node('span',undefined,'chip-pile');pile.setAttribute('aria-label',bb(amount)+' BB in chips');for(let i=0;i<Math.min(6,Math.max(1,Math.ceil(Math.log2(amount/50+1))));i++)pile.append(node('i',undefined,'chip'));return pile;}

const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));

async function present(data){

 const frames=data.frames||[data];render(frames[0]);

 for(let i=1;i<frames.length;i++){

  const next=frames[i],event=next.game.history.at(-1),seat=document.querySelector(`[data-seat="${event.seat}"]`);

  seat?.classList.add('thinking');$('decisionLabel').textContent='ACTION - XXXXX';$('decisionText').textContent=(players[event.seat]?.name||'Player')+' is thinking…';

  await pause($('botSpeed').value==='instant'?0:$('botSpeed').value==='fast'?90:650+Math.random()*450);

  render(next);actionSound(event.action);

  const target=document.querySelector(`[data-seat="${event.seat}"]`);target?.classList.add('just-acted');

  const displayAction=actionName(event,next.game.history);
  const badge=node('span',displayAction[0].toUpperCase()+displayAction.slice(1)+(['raise','call','bet'].includes(displayAction)?' '+bbLabel(next.game.street_bets[event.seat]||event.amount||0):''),'action-badge');target?.append(badge);

  $('decisionText').textContent=(players[event.seat]?.name||'Player')+' · '+badge.textContent;

  await pause($('botSpeed').value==='instant'?0:$('botSpeed').value==='fast'?70:420);

 }

 render(data);
 if(game?.done)await rememberSessionHand();

}

$('soundToggle').addEventListener('click',()=>{soundEnabled=!soundEnabled;$('soundToggle').textContent=soundEnabled?'Sound on':'Sound off';$('soundToggle').setAttribute('aria-pressed',String(soundEnabled));if(soundEnabled)unlockAudio();});


let installPrompt=null;
window.addEventListener('beforeinstallprompt',event=>{event.preventDefault();installPrompt=event;$('installApp').hidden=false;});
$('installApp').addEventListener('click',async()=>{if(!installPrompt){$('installSteps').open=true;$('installSteps').scrollIntoView({block:'nearest',behavior:'smooth'});return;}await installPrompt.prompt();await installPrompt.userChoice;installPrompt=null;$('installApp').hidden=true;});
window.addEventListener('appinstalled',()=>{installPrompt=null;$('installApp').hidden=true;});
let workerRegistration=null;
if('serviceWorker' in navigator)navigator.serviceWorker.register('/sw.js',{updateViaCache:'none'}).then(r=>{workerRegistration=r;}).catch(()=>{});

function scheduleNext(){
 clearTimeout(nextHandTimer);
 if(applyPendingUpdate())return;
 if(autoFoldDecision()){
  nextHandTimer=setTimeout(()=>{
   const decision=autoFoldDecision();if(!decision)return;
   // Record before submitting: a failed or ambiguous response must not retry a move.
   autoFoldAttempt=decision.key;
   act(decision.action);
  },200);
  return;
 }
 if(!busy&&game?.done&&$('autoDeal').checked&&currentMode!=='study'&&!(currentMode==='grind'&&career?.stack<=0&&!$('autoReload').checked)&&!document.hidden){
  nextHandTimer=setTimeout(()=>{if($('autoDeal').checked&&!busy&&!document.hidden)dealNext();},currentMode==='sim'?350:1200);
 }
}
$('autoDeal').addEventListener('change',scheduleNext);
document.addEventListener('visibilitychange',scheduleNext);
 $('tableMode').addEventListener('change',()=>{clearTimeout(nextHandTimer);$('autoDeal').checked=$('tableMode').value!=='study';renderControls();});
$('saveCharacter').addEventListener('click',()=>task(async()=>render(await api('/api/profile',{name:$('characterName').value}))));
$('rebuy').addEventListener('click',()=>task(async()=>render(await api('/api/rebuy',{}))));
$('createAccount').addEventListener('click',()=>accountAction('/api/auth/register'));
$('signIn').addEventListener('click',()=>accountAction('/api/auth/login'));
$('signOut').addEventListener('click',()=>accountAction('/api/auth/logout'));
$('continueGuest').addEventListener('click',()=>{$('loginPrompt').close();sessionStorage.setItem('guestChosen','1');scheduleNext();});
$('continueGuestPrompt').addEventListener('click',()=>{$('loginPrompt').close();sessionStorage.setItem('guestChosen','1');scheduleNext();});
$('accountIdPrompt').addEventListener('input',()=>{$('accountId').value=$('accountIdPrompt').value;});
$('accountPasswordPrompt').addEventListener('input',()=>{$('accountPassword').value=$('accountPasswordPrompt').value;});
$('rememberMePrompt').addEventListener('change',()=>{$('rememberMe').checked=$('rememberMePrompt').checked;});
for(const [button,path] of [['createAccountPrompt','/api/auth/register'],['signInPrompt','/api/auth/login']])$(button).addEventListener('click',async()=>{ $('accountId').value=$('accountIdPrompt').value;$('accountPassword').value=$('accountPasswordPrompt').value;$('rememberMe').checked=$('rememberMePrompt').checked;await accountAction(path);$('accountPromptStatus').textContent=$('accountStatus').textContent;});

// Compare the loaded code's version, not the version displayed by newer API responses.
const LOADED_VERSION='0.8.2';
let pendingUpdate=false,checkingUpdate=false,reloadingUpdate=false;
function applyPendingUpdate(){
 if(!pendingUpdate||busy||document.hidden||reloadingUpdate)return false;
 if(game&&!game.done){$('updateNotice').textContent='Update ready — it will apply after this hand.';return false;}
 reloadingUpdate=true;clearTimeout(nextHandTimer);
 $('updateNotice').textContent='Updating NorthStar Poker…';
 location.reload();return true;
}
async function checkForUpdate(){
 if(checkingUpdate||document.hidden||reloadingUpdate)return;
 checkingUpdate=true;
 try{
  const response=await fetch('/api/health',{cache:'no-store',credentials:'same-origin',signal:AbortSignal.timeout(8000)});
  if(!response.ok)return;
  const health=await response.json();
  if(health.app==='northstar-games'&&health.status==='ok'&&typeof health.version==='string'&&health.version.localeCompare(LOADED_VERSION,undefined,{numeric:true})>0){pendingUpdate=true;applyPendingUpdate();}
  workerRegistration?.update().catch(()=>{});
 }catch{}finally{checkingUpdate=false;}
}
setInterval(checkForUpdate,30000);
window.addEventListener('online',checkForUpdate);
window.addEventListener('pageshow',checkForUpdate);
document.addEventListener('visibilitychange',()=>{if(!document.hidden)checkForUpdate();});
checkForUpdate();

async function refreshRankings(){
 if(document.hidden)return;
 try{
  const data=await api('/api/leaderboard');
  $('topPlayers').replaceChildren();$('allPlayers').replaceChildren();
  for(const [index,player] of data.players.entries()){
   const profit=`${player.profit>0?'+':''}${bbLabel(player.profit)}`;
   if(index<5){const row=node('li');row.append(profileButton(player,`${index+1}. ${player.name}`),node('strong',profit));$('topPlayers').append(row);}
   const row=node('tr'),name=node('td');name.append(profileButton(player));row.append(node('td',index+1),name,node('td',player.kind),node('td',player.hands.toLocaleString()),node('td',profit));$('allPlayers').append(row);
  }
  $('leaderboardStatus').textContent=data.players.length?`${data.players.length} players · updates every 15 seconds`:'No completed hands yet. Play a cash-career hand to join the rankings.';
 }catch{$('leaderboardStatus').textContent='Rankings unavailable. Retrying shortly.';}
}
refreshRankings();setInterval(refreshRankings,15000);
document.addEventListener('visibilitychange',()=>{if(!document.hidden)refreshRankings();});
$('fullRankings').addEventListener('toggle',()=>{if($('fullRankings').open)refreshRankings();});

// Rankings remain available in the menu so the table can use the full screen.

document.addEventListener('keydown',event=>{if(event.key==='Escape'&&$('mainMenu').open){$('mainMenu').open=false;$('mainMenu').querySelector('summary').focus();}});

function bettingPresets(game){
 const legal=game.legal,current=Math.max(...game.street_bets);
 const clamp=amount=>Math.max(legal.raise_min,Math.min(Math.round(amount),legal.raise_max));
 let presets;
 if(game.street==='preflop'){
  const opening=current<=game.big_blind;
  const amount=clamp(opening?2.2*game.big_blind:3*current);
  presets=[{amount,label:bbLabel(amount)}];
 }else if(game.street==='river'){
  presets=[.6,1,1.25].map(fraction=>({amount:clamp(current+(game.pot+legal.call)*fraction),label:`${fraction*100}% pot`}));
 }else{
  presets=[.5,.75,1].map(fraction=>({amount:clamp(current+(game.pot+legal.call)*fraction),label:`${fraction*100}% pot`}));
 }
 if(!presets.some(p=>p.amount===legal.raise_max))presets.push({amount:legal.raise_max,label:'All-in'});
 return presets;
}

function renderMobileRaiseLevels(canRaise){
 const container=$('mobileRaiseLevels');
 container.replaceChildren();
 const verb=game&&Math.max(...game.street_bets)===0?'Bet':'Raise';
 let levels=[{amount:220,label:'2.2 BB'},{amount:300,label:'3 BB'},{amount:400,label:'4 BB'}];
 if(canRaise){
  if(game.street==='preflop'){
   const current=Math.max(...game.street_bets),opening=current<=game.big_blind;
   levels=(opening?[2.2,3,4]:[2.2,2.5,3]).map(multiplier=>{
    const amount=Math.max(game.legal.raise_min,Math.min(Math.round(multiplier*(opening?game.big_blind:current)),game.legal.raise_max));
    return {amount,label:opening?bbLabel(amount):`${multiplier}×`};
   });
  }else levels=bettingPresets(game).slice(0,3);
 }
 const seen=new Set();
 for(const {amount,label} of levels){
  const button=node('button');button.type='button';
  button.dataset.amount=String(amount);button.dataset.duplicate=String(seen.has(amount));seen.add(amount);
  button.append(node('small',label),node('span',verb),node('strong',bbLabel(amount)));
  button.setAttribute('aria-label',`${verb} to ${bbLabel(amount)} (${label})`);
  button.disabled=!canRaise||busy||tableEditMode||button.dataset.duplicate==='true';
  button.addEventListener('click',()=>{
   if(busy||tableEditMode||!game||game.done||game.actor!==game.hero||game.legal.raise_min==null)return;
   if(amount<game.legal.raise_min||amount>game.legal.raise_max)return;
   act('raise:'+amount);
  });
  container.prepend(button);
 }
}

function renderBetPresets(){
 const canRaise=game&&!game.done&&currentMode!=='sim'&&game.actor===game.hero&&!game.bot_thinking&&game.legal.raise_min!=null;
 const presets=canRaise?bettingPresets(game):[{amount:200,label:'2 BB'},{amount:500,label:'½ Pot'},{amount:1000,label:'Pot'},{amount:10000,label:'All-in'}];
 renderMobileRaiseLevels(canRaise);
 const sizes=$('sizes');
 sizes.replaceChildren();
 if(canRaise){$('raiseAmount').min=String(game.legal.raise_min/100);$('raiseAmount').max=String(game.legal.raise_max/100);$('raiseAmount').value=String(presets[0].amount/100);}
 for(const {amount,label} of presets){
  const button=node('button',label);
  button.type='button';
  button.disabled=!canRaise&&!tableEditMode;
  button.addEventListener('click',()=>{if(!busy&&canRaise&&!tableEditMode)$('raiseAmount').value=String(amount/100);});
  sizes.append(button);
 }
 prepareControlAssets();
}

// Resume a pending native solve without blocking the UI or accepting human bot moves.
setInterval(()=>{
 if(!busy&&!document.hidden&&game&&!game.done&&game.bot_thinking){
  task(async()=>present(await api('/api/bot-step',{})));
 }
},1500);
$('editTable').addEventListener('click',()=>{
 tableEditMode=!tableEditMode;
 mainMenu.open=false;
 document.body.classList.toggle('table-editing',tableEditMode);tableAsset(document.getElementById('actionPanel'),'controls');renderBetPresets();prepareControlAssets();renderControls();
 $('tableEditor').hidden=!tableEditMode;
 $('editTable').textContent=tableEditMode?'Done editing':'Edit table';
 $('editTable').setAttribute('aria-pressed',String(tableEditMode));scheduleNext();
 document.querySelectorAll('.table-asset').forEach(asset=>tableAsset(asset,asset.dataset.layoutKey));
});
$('resetTableLayout').addEventListener('click',()=>{
 tableLayout=JSON.parse(JSON.stringify(tableDefault));localStorage.setItem(tableLayoutKey,JSON.stringify(tableLayout));
 document.querySelectorAll('.table-asset').forEach(asset=>tableLayoutValues(asset,tableLayout[asset.dataset.layoutKey]||{}));
 $('tableEditorStatus').textContent=Object.keys(tableDefault).length?'Restored your saved default.':'Restored the original layout.';
});$('saveTableDefault').addEventListener('click',()=>{
 tableDefault=JSON.parse(JSON.stringify(tableLayout));
 localStorage.setItem(tableDefaultKey,JSON.stringify(tableDefault));
 $('tableEditorStatus').textContent='Saved as your default layout.';
});

const sessionHandsKey='northstarPokerSessionHandsV1';
let sessionHands=[];
try{sessionHands=JSON.parse(sessionStorage.getItem(sessionHandsKey)||'[]');if(!Array.isArray(sessionHands))sessionHands=[];}catch{}
function renderSessionHands(){
 const list=$('sessionHandList');list.replaceChildren();
 if(!sessionHands.length)list.append(node('li','No completed hands this session.'));
 for(const [index,hand] of sessionHands.entries()){
  const item=node('li'),button=node('button',`Hand ${sessionHands.length-index} · ${typeof hand.net==='number'?signedHandBB(hand.net):'Result unavailable'} · ${typeof hand.accuracy==='number'?hand.accuracy+'% practice accuracy':'Accuracy unavailable'} · ${hand.label}`,'button neutral');button.type='button';
  button.addEventListener('click',()=>task(async()=>{
   const replay=await api('/api/replay',hand.data);replayFrames=replay.frames;replayEvents=hand.data.actions;replayPlayers=hand.data.players||[];replayIndex=0;
   $('sessionHistory').open=false;
   document.querySelectorAll('.tab').forEach(tab=>{const selected=tab.dataset.tab==='replay';tab.classList.toggle('active',selected);tab.setAttribute('aria-selected',String(selected));});
   document.querySelectorAll('.tab-panel').forEach(panel=>panel.hidden=panel.id!=='replay');renderReplay();
  }));item.append(button);list.append(item);
 }
}
async function rememberSessionHand(){
 try{
  const data=withHandPerformance(await api('/api/history')),key=JSON.stringify([data.config,data.deck,data.actions]);
  if(sessionHands.some(hand=>hand.key===key))return;
  sessionHands.unshift({key,data,net:game.net,accuracy:practiceAccuracy(),rated:handAccuracy.scores.length,unrated:handAccuracy.unrated,label:`Pot ${bbLabel(game.pot)} · ${game.board.join(' ')||'Preflop'}`});sessionHands=sessionHands.slice(0,100);
  sessionStorage.setItem(sessionHandsKey,JSON.stringify(sessionHands));renderSessionHands();
 }catch{$('sessionHandList').replaceChildren(node('li','Could not save this hand.'));}
}
$('deal').closest('.setup').classList.add('deal-panel');
$('actionPanel').after($('deal').closest('.setup'));
renderSessionHands();

function practiceActionScore(action,probabilities){
 const entries=Object.entries(probabilities||{}).filter(([,p])=>Number.isFinite(p)&&p>=0);
 if(!entries.length)return null;
 const best=Math.max(...entries.map(([,p])=>p));if(best<=0)return null;
 let chosen=entries.find(([a])=>a===action);
 if(!chosen&&action.startsWith('raise:')){
  const amount=Number(action.split(':')[1]);
  chosen=entries.filter(([a])=>a.startsWith('raise:')).sort((a,b)=>Math.abs(Number(a[0].split(':')[1])-amount)-Math.abs(Number(b[0].split(':')[1])-amount))[0];
 }
 return Math.max(0,Math.min(100,100*(chosen?.[1]||0)/best));
}
function practiceAccuracy(){return handAccuracy.scores.length?Math.round(handAccuracy.scores.reduce((a,b)=>a+b,0)/handAccuracy.scores.length):null;}
function signedHandBB(net){return `${net>=0?'+':''}${bbLabel(net)}`;}
function renderHandPerformance(){
 const accuracy=practiceAccuracy(),count=handAccuracy.scores.length;
 $('handAccuracy').textContent=accuracy===null?'Practice accuracy: —':`Practice accuracy: ${accuracy}% · ${count} decision${count===1?'':'s'}${handAccuracy.unrated?' · '+handAccuracy.unrated+' unrated':''}`;
 $('handOutcome').textContent=game?.done?`Hand result: ${signedHandBB(game.net)}`:'Hand result: In progress';
 $('handOutcome').dataset.outcome=game?.done?(game.net>0?'win':game.net<0?'loss':'even'):'pending';
}

function withHandPerformance(data){
 return {...data,performance:{hero:game?.hero,result_bb:game?.done?game.net/100:null,practice_accuracy_percent:practiceAccuracy(),rated_decisions:handAccuracy.scores.length,unrated_decisions:handAccuracy.unrated,method:'Practice policy frequency relative to most recommended action; custom raises use nearest suggested size. Not solver EV accuracy.'}};
}

matchMedia('(max-width:760px)').addEventListener('change',()=>renderControls());

window.addEventListener('northstar:games-account-change', event => {
 if(event.detail?.source==='poker')return;
 clearTimeout(nextHandTimer);autoFoldAttempt=null;
 task(async()=>{render(await api('/api/state'));if($('loginPrompt').open)$('loginPrompt').close();scheduleNext();});
});

window.addEventListener('northstar:games-before-account-change', event => {
 if(busy){event.preventDefault();return;}
 clearTimeout(nextHandTimer);
});
