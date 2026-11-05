/* Six self-contained recreational modules, discovered by the shared workspace. */
(async function() {
  'use strict';
  const E=window.NorthstarGamesEngine;
  const titles={chess:'Chess',checkers:'Checkers',go:'Go',poker:'Poker',pool:'Pool',euchre:'Euchre'};
  const rules={
    chess:'Select a piece, then a highlighted square. White moves first. Legal moves, castling, en passant, check, checkmate and draws are enforced. Choose a promotion piece before moving your pawn to the last rank. Change the computer strength at any time while playing against it.',
    checkers:'American checkers. Red moves first. Men move and capture diagonally forward; kings move both ways. Captures are compulsory and multiple jumps must be completed. Crowning ends the turn. No legal move loses; 40 moves each without capture or crowning is a draw.',
    go:'9 × 9 Go. Black moves first; White receives 6.5 komi. Surround groups to capture them. Suicide and repeated board positions are forbidden. Play out disputed or dead groups before passing: no automatic dead-stone removal. Two passes finish the game with area scoring (stones plus surrounded empty points). Computer plays White at beginner strength.',
    poker:'Five-card draw against the computer. Each player starts with 100 play chips and antes 5 per hand. Select any cards to replace once, then draw and reveal. Highest five-card hand takes the 10-chip pot; equal hands split. This casual variant has no betting rounds. No real money.',
    pool:'Solo pool practice. Click or tap the table to aim from the white cue ball, or use the angle control. Set power, then Shoot. Pocket all 10 coloured balls in as few shots as possible. A scratch respots the cue ball after the table stops. Simplified friction and elastic collisions; no spin or eight-ball rules.',
    euchre:'You and North (your computer partner) play East and West. First team to 10 wins. A 24-card deck, five cards each. Order up the turned suit or pass; second round chooses another suit (dealer must call). Dealer picks up and discards in round one. Right and left bowers are highest trump; follow effective suit. Makers need 3 tricks for 1 point, all 5 for 2, or 4 when alone; being euchred gives opponents 2. Going alone sits out your partner.'
  };
  const root=document.createElement('section');root.id='games';root.className='section';
  const chessStrengths=[['500','New'],['750','Learning'],['1000','Average'],['1200','Good'],['1500','Strong'],['1800','Master'],['2200','Grandmaster']];
  root.innerHTML=Object.entries(titles).map(([id,title])=>`<article class="panel ng-game" data-module-id="${id}" id="ng-${id}"><h2>${title}</h2><p class="ng-note">${id==='pool'?'Solo practice':id==='poker'||id==='euchre'?'Play against computer opponents':'Computer opponent or two players on this device'}</p><div class="ng-toolbar"><button type="button" data-new>New game</button>${['chess','checkers','go'].includes(id)?'<label>Mode <select data-mode><option value="computer">Vs computer</option><option value="local">Two players</option></select></label>':''}${id==='chess'?`<label>Bot strength <select data-strength aria-label="Chess bot strength">${chessStrengths.map(([rating,label])=>`<option value="${rating}">${label} (${rating})</option>`).join('')}</select></label><label>Promote to <select data-promotion><option value="q">Queen</option><option value="r">Rook</option><option value="b">Bishop</option><option value="n">Knight</option></select></label>`:''}</div><div class="ng-status" role="status" aria-live="polite"></div><div class="ng-play"></div><details><summary>How to play</summary><p>${rules[id]}</p></details></article>`).join('');
  const anchor=document.querySelector('#training')||document.querySelector('main .section');if(!anchor)return;anchor.parentElement.append(root);
  const nav=document.querySelector('#sideNav');if(nav&&!nav.querySelector('[data-tab="games"]')){const b=document.createElement('button');b.type='button';b.dataset.tab='games';b.textContent='Games';nav.append(b);}
  const align=()=>root.style.setProperty('--ng-left',Math.max(12,(document.querySelector('#nsStatusBar')?.getBoundingClientRect().left??180)+12)+'px');
  window.addEventListener('resize',align);requestAnimationFrame(align);
  const bar=document.querySelector('#nsStatusBar');if(bar)new ResizeObserver(align).observe(bar);
  const symbol={S:'♠',H:'♥',C:'♣',D:'♦'},rank=r=>({11:'J',12:'Q',13:'K',14:'A'}[r]||r),cardName=c=>rank(c.r)+symbol[c.s];
  const card=(c,i,selected=false,hidden=false,disabled=false)=>`<button type="button" class="ng-card ${hidden?'back':c.s==='H'||c.s==='D'?'red':''} ${selected?'selected':''}" data-card="${i}" ${disabled?'disabled':''} aria-label="${hidden?'Hidden card':cardName(c)}" aria-pressed="${selected}">${hidden?'?':cardName(c)}${selected?'<small>REPLACE</small>':''}</button>`;
  const state={},timers={};
  function pane(id){return root.querySelector('#ng-'+id);}
  function status(id,s){pane(id).querySelector('.ng-status').textContent=s;}
  function schedule(id,fn){clearTimeout(timers[id]);timers[id]=setTimeout(()=>{if(!pane(id).checkVisibility()){schedule(id,fn);return;}fn();},500);}
  let Chess;
  try {({Chess}=await import('./vendor/chess/chess.js'));}catch {status('chess','Chess could not load. Reload to retry.');}
  function newGame(id){clearTimeout(timers[id]);const mode=pane(id).querySelector('[data-mode]')?.value;const strength=Number(pane(id).querySelector('[data-strength]')?.value)||500;state[id]={mode,strength,selected:null};
    if(id==='chess'){if(!Chess)return;state[id].game=new Chess();}
    if(id==='checkers')state[id].game=new E.Checkers();
    if(id==='go')state[id].game=new E.Go();
    if(id==='poker'){state[id].game=new E.Poker();state[id].game.deal();state[id].held=new Set();}
    if(id==='euchre')state[id].game=new E.Euchre();
    if(id==='pool'){initPool();return;}render(id);
  }
  function render(id){if(['chess','checkers','go'].includes(id))renderBoard(id);else if(id==='poker')renderPoker();else if(id==='euchre')renderEuchre();}
  function renderBoard(id){const s=state[id],g=s.game,go=id==='go',chess=id==='chess',n=go?9:8;
    const ended=chess?g.isGameOver():!!g.result,turn=chess?g.turn()==='w'?1:-1:g.turn,human=s.mode==='local'||turn===1;
    const colour=chess?turn===1?'White':'Black':go?turn===1?'Black':'White':turn===1?'Red':'Black';
    const message=chess?(g.isCheckmate()?(turn===1?'Black':'White')+' wins by checkmate':g.isDraw()?'Draw':colour+' to move'+(g.isCheck()?' — check':'')):g.result||colour+' to move'+(!go&&g.chain!==null?' — continue capture':'');
    status(id,message+(!ended&&!human?' · Computer thinking…':''));
    const selected=s.selected,legal=chess?(selected?g.moves({square:selected,verbose:true}).map(m=>m.to):[]):go?[]:g.moves().filter(m=>m.from===selected).map(m=>m.to);
    const pieces={wk:'♔',wq:'♕',wr:'♖',wb:'♗',wn:'♘',wp:'♙',bk:'♚',bq:'♛',br:'♜',bb:'♝',bn:'♞',bp:'♟'};
    let html=`<div class="ng-board ${go?'go':''}" aria-label="${titles[id]} board">`;
    for(let i=0;i<n*n;i++){const r=Math.floor(i/n),c=i%n,key=chess?'abcdefgh'[c]+(8-r):i,p=chess?g.get(key):g.board[i],label=chess?key:'ABCDEFGHJ'[c]+(n-r);
      const content=chess?p?pieces[p.color+p.type]:'':go?p?`<span class="ng-stone ${p<0?'white':''}"></span>`:'':p?`<span class="ng-piece ${p<0?'black':''}">${Math.abs(p)===2?'K':''}</span>`:'';
      const desc=chess?p?(p.color==='w'?'White ':'Black ')+({p:'pawn',n:'knight',b:'bishop',r:'rook',q:'queen',k:'king'}[p.type]):'empty':p?(go?(p>0?'Black stone':'White stone'):(p>0?'Red':'Black')+(Math.abs(p)===2?' king':' piece')):'empty';
      html+=`<button type="button" class="ng-square ${(r+c)%2?'dark':''} ${selected===key?'selected':''} ${legal.includes(key)?'legal':''}" data-square="${key}" aria-label="${label}, ${desc}" ${ended||!human?'disabled':''}>${content}${!go?`<small>${label}</small>`:''}</button>`;
    }
    html+='</div>';if(go)html+=`<div class="ng-toolbar"><button type="button" data-pass ${ended||!human?'disabled':''}>Pass</button><span>Captured · Black ${g.captured[0]} / White ${g.captured[1]}</span></div>`;
    pane(id).querySelector('.ng-play').innerHTML=html;
    pane(id).querySelectorAll('[data-square]').forEach(b=>b.onclick=()=>{
      const to=chess?b.dataset.square:Number(b.dataset.square);let moved=false;
      if(go)moved=g.move(to);
      else if(chess){if(selected&&legal.includes(to)){g.move({from:selected,to,promotion:pane(id).querySelector('[data-promotion]').value});moved=true;}else s.selected=g.get(to)?.color===g.turn()?to:null;}
      else if(selected!==null&&legal.includes(to))moved=g.move(selected,to);else s.selected=Math.sign(g.board[to])===g.turn?to:null;
      if(moved)s.selected=!chess&&!go?g.chain:null;renderBoard(id);if(go&&!moved)status(id,'Illegal move: occupied point, suicide, or repeated position.');
    });
    pane(id).querySelector('[data-pass]')?.addEventListener('click',()=>{g.pass();renderBoard(id);});
    if(!ended&&!human)schedule(id,()=>{if(chess){const move=E.chessBotMove(g,s.strength);if(move)g.move(move);}else if(go){const legal=g.board.map((_,i)=>({i,m:g.candidate(i)})).filter(x=>x.m);if(g.passes||!legal.length)g.pass();else{legal.forEach(x=>x.v=x.m.count*5+Math.random()+(g.neighbors(x.i).some(j=>g.board[j])?.25:0));legal.sort((a,b)=>b.v-a.v);g.move(legal[0].i);}}else{const moves=g.moves();const m=moves[Math.floor(Math.random()*moves.length)];g.move(m.from,m.to);}s.selected=null;renderBoard(id);});
  }
  const pokerNames=['High card','Pair','Two pair','Three of a kind','Straight','Flush','Full house','Four of a kind','Straight flush'];
  function renderPoker(){const s=state.poker,g=s.game,done=g.phase==='done';status('poker',g.result);pane('poker').querySelector('.ng-play').innerHTML=`<div class="ng-score">You: ${g.chips[0]} · Computer: ${g.chips[1]} play chips</div><div class="ng-table">Computer${done?' · '+pokerNames[E.pokerRank(g.hands[1])[0]]:''}<div class="ng-hand">${g.hands[1].map((c,i)=>card(c,i,false,!done,true)).join('')}</div></div><p>Your hand${done?' · '+pokerNames[E.pokerRank(g.hands[0])[0]]:''}</p><div class="ng-hand" data-hand>${g.hands[0].map((c,i)=>card(c,i,s.held.has(i),false,done)).join('')}</div><div class="ng-toolbar"><button type="button" data-draw ${done?'disabled':''}>${s.held.size?'Replace '+s.held.size+' and reveal':'Stand pat and reveal'}</button><button type="button" data-deal ${!done||Math.min(...g.chips)<5?'disabled':''}>Next hand · ante 5</button></div>${Math.min(...g.chips)<5&&done?'<p>Match finished. Start a new game to reset the play chips.</p>':''}`;
    pane('poker').querySelectorAll('[data-hand] [data-card]').forEach(b=>b.onclick=()=>{const i=Number(b.dataset.card);s.held.has(i)?s.held.delete(i):s.held.add(i);renderPoker();});
    pane('poker').querySelector('[data-draw]').onclick=()=>{g.draw([...s.held]);s.held.clear();renderPoker();};pane('poker').querySelector('[data-deal]').onclick=()=>{g.deal();renderPoker();};
  }
  const seats=['You','East','North (partner)','West'];
  function renderEuchre(){const g=state.euchre.game,human=g.turn===0,playing=['bid','discard','play'].includes(g.phase);status('euchre',g.result||(g.phase==='bid'?`${seats[g.turn]} to call trump · round ${g.round}`:g.phase==='discard'?`${seats[g.turn]} must discard one card`:`${seats[g.turn]} to play`));
    const table=g.table.length?g.table:g.last;
    let html=`<div class="ng-score">Your team ${g.scores[0]} · Opponents ${g.scores[1]} / 10</div><p>Dealer: ${seats[g.dealer]} · ${g.trump?'Trump: '+symbol[g.trump]+(g.alone?' · '+seats[g.maker]+' alone':''):'Turned card: '+cardName(g.up)} · Tricks: ${g.tricks[0]}–${g.tricks[1]}</p><div class="ng-table">${g.table.length?'Current trick':g.last.length?'Last trick':'Table'}<div class="ng-hand">${table.map((x,i)=>`<div>${seats[x.player]}${card(x.card,i,false,false,true)}</div>`).join('')}</div></div>`;
    if(g.phase==='bid'&&human)html+=`<div class="ng-toolbar">${g.suits().map(s=>`<button type="button" data-bid="${s}">${g.round===1?'Order up':'Call'} ${symbol[s]}</button>`).join('')}<button type="button" data-bid="" ${g.round===2&&g.passed===3?'disabled':''}>Pass</button><label><input type="checkbox" data-alone> Go alone</label></div>`;
    const legal=g.phase==='play'&&human?g.legal():[];
    html+=`<p>Your hand${g.skipped===0?' · Sitting out this hand':''}</p><div class="ng-hand" data-hand>${g.hands[0].map((c,i)=>card(c,i,false,false,!human||!(g.phase==='discard'||g.phase==='play'&&legal.includes(i)))).join('')}</div>`;
    if(g.phase==='done')html+='<button type="button" data-next>Next hand</button>';if(g.phase==='over')html+=`<p>${g.scores[0]>=10?'Your team wins the match!':'Opponents win the match.'}</p>`;
    pane('euchre').querySelector('.ng-play').innerHTML=html;
    pane('euchre').querySelectorAll('[data-bid]').forEach(b=>b.onclick=()=>{g.bid(b.dataset.bid||null,pane('euchre').querySelector('[data-alone]').checked);renderEuchre();});
    pane('euchre').querySelectorAll('[data-hand] [data-card]').forEach(b=>b.onclick=()=>{g.phase==='discard'?g.discard(Number(b.dataset.card)):g.play(Number(b.dataset.card));renderEuchre();});
    pane('euchre').querySelector('[data-next]')?.addEventListener('click',()=>{g.next();renderEuchre();});if(playing&&!human)schedule('euchre',()=>{g.ai();renderEuchre();});
  }
  let animation=0;
  function initPool(){cancelAnimationFrame(animation);const s=state.pool;s.shots=0;s.scratches=0;s.moving=false;s.balls=[{x:180,y:200,vx:0,vy:0,n:0}];for(let r=0,k=1;r<4;r++)for(let c=0;c<=r;c++)s.balls.push({x:510+r*19,y:200+(c-r/2)*22,vx:0,vy:0,n:k++});
    pane('pool').querySelector('.ng-play').innerHTML='<canvas class="ng-pool" width="800" height="400" aria-label="Pool table: use angle, power and Shoot controls"></canvas><div class="ng-toolbar"><label>Angle <input data-angle type="range" min="0" max="359" value="0"> <output data-angle-value>0°</output></label><label>Power <input data-power type="range" min="1" max="100" value="60"></label><button type="button" data-shoot>Shoot</button></div>';
    const canvas=pane('pool').querySelector('canvas'),ctx=canvas.getContext('2d'),angle=pane('pool').querySelector('[data-angle]'),power=pane('pool').querySelector('[data-power]'),shoot=pane('pool').querySelector('[data-shoot]');
    const pockets=[[13,13],[400,10],[787,13],[13,387],[400,390],[787,387]],colours=['#faf6e9','#e5ba37','#448bcd','#ce514b','#9667c9','#df863b','#56a88e','#a14462','#24262b','#e5ba37','#448bcd'];
    function draw(){ctx.clearRect(0,0,800,400);ctx.fillStyle='#184c3b';ctx.fillRect(0,0,800,400);pockets.forEach(([x,y])=>{ctx.beginPath();ctx.arc(x,y,19,0,7);ctx.fillStyle='#0b1817';ctx.fill();});const cue=s.balls.find(b=>!b.n&&!b.pocket);if(cue&&!s.moving){const a=Number(angle.value)*Math.PI/180;ctx.beginPath();ctx.moveTo(cue.x,cue.y);ctx.lineTo(cue.x+Math.cos(a)*120,cue.y+Math.sin(a)*120);ctx.strokeStyle='#e7e7c6';ctx.setLineDash([6,6]);ctx.stroke();ctx.setLineDash([]);}s.balls.filter(b=>!b.pocket).forEach(b=>{ctx.beginPath();ctx.arc(b.x,b.y,10,0,7);ctx.fillStyle=colours[b.n];ctx.fill();ctx.strokeStyle='#111';ctx.stroke();if(b.n){ctx.fillStyle=b.n===8?'white':'#101b22';ctx.font='bold 11px sans-serif';ctx.textAlign='center';ctx.fillText(b.n,b.x,b.y+4);}});const count=s.balls.filter(b=>b.n&&b.pocket).length;shoot.disabled=s.moving||count===10;status('pool',`${count===10?'Table cleared! · ':''}${count}/10 pocketed · ${s.shots} shots · ${s.scratches} scratches${s.moving?' · Balls moving':''}`);}
    function tick(){if(!pane('pool').checkVisibility()){animation=requestAnimationFrame(tick);return;}for(let step=0;step<3;step++){
      const active=s.balls.filter(b=>!b.pocket);for(const b of active){b.x+=b.vx/3;b.y+=b.vy/3;b.vx*=.992;b.vy*=.992;if(Math.hypot(b.vx,b.vy)<.06)b.vx=b.vy=0;if(pockets.some(([x,y])=>Math.hypot(b.x-x,b.y-y)<20)){b.pocket=true;b.vx=b.vy=0;if(!b.n)s.scratches++;continue;}if(b.x<12||b.x>788){b.x=Math.max(12,Math.min(788,b.x));b.vx*=-.9;}if(b.y<12||b.y>388){b.y=Math.max(12,Math.min(388,b.y));b.vy*=-.9;}}
      for(let i=0;i<active.length;i++)for(let j=i+1;j<active.length;j++){const a=active[i],b=active[j];if(a.pocket||b.pocket)continue;const dx=b.x-a.x,dy=b.y-a.y,d=Math.hypot(dx,dy);if(d>0&&d<20){const nx=dx/d,ny=dy/d,overlap=(20-d)/2;a.x-=nx*overlap;a.y-=ny*overlap;b.x+=nx*overlap;b.y+=ny*overlap;const v=(a.vx-b.vx)*nx+(a.vy-b.vy)*ny;if(v>0){a.vx-=v*nx;a.vy-=v*ny;b.vx+=v*nx;b.vy+=v*ny;}}}
    }s.moving=s.balls.some(b=>!b.pocket&&(b.vx||b.vy));if(!s.moving){const cue=s.balls[0];if(cue.pocket){let spot;for(let x=80;x<780&&!spot;x+=24)for(let y=40;y<380&&!spot;y+=24)if(s.balls.every(b=>b===cue||b.pocket||Math.hypot(b.x-x,b.y-y)>22))spot={x,y};Object.assign(cue,spot,{pocket:false});}}draw();if(s.moving)animation=requestAnimationFrame(tick);}
    angle.oninput=()=>{pane('pool').querySelector('[data-angle-value]').textContent=angle.value+'°';draw();};canvas.onpointerdown=e=>{if(s.moving)return;const box=canvas.getBoundingClientRect(),cue=s.balls[0],a=Math.atan2((e.clientY-box.top)*400/box.height-cue.y,(e.clientX-box.left)*800/box.width-cue.x)*180/Math.PI;angle.value=Math.round((a+360)%360);angle.oninput();};shoot.onclick=()=>{if(s.moving)return;const a=Number(angle.value)*Math.PI/180;s.balls[0].vx=Math.cos(a)*Number(power.value)*.16;s.balls[0].vy=Math.sin(a)*Number(power.value)*.16;s.shots++;s.moving=true;tick();};draw();
  }
  Object.keys(titles).forEach(id=>{pane(id).querySelector('[data-new]').onclick=()=>{if(confirm('Start a new '+titles[id]+' game? Current progress will be lost.'))newGame(id);};pane(id).querySelector('[data-mode]')?.addEventListener('change',()=>newGame(id));pane(id).querySelector('[data-strength]')?.addEventListener('change',e=>{if(state[id])state[id].strength=Number(e.target.value);});newGame(id);});
  window.NorthstarGames={state,newGame};
})();
