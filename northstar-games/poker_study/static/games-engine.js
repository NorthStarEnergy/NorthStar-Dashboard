/* NorthStar recreational games. No dashboard API or operational state access. */
(function(root) {
  'use strict';
  const copy = value => JSON.parse(JSON.stringify(value));
  const shuffle = cards => { for (let i=cards.length-1;i>0;i--) { const j=Math.floor(Math.random()*(i+1)); [cards[i],cards[j]]=[cards[j],cards[i]]; } return cards; };
  const deck = (low=2) => shuffle(['S','H','C','D'].flatMap(s=>Array.from({length:15-low},(_,i)=>({s,r:i+low}))));
  const inside = (r,c,n=8) => r>=0 && c>=0 && r<n && c<n;
  class Checkers {
    constructor() { this.board=Array.from({length:64},(_,i)=>{const r=i>>3,c=i%8;return (r+c)%2?(r<3?-1:r>4?1:0):0;});this.turn=1;this.chain=null;this.quiet=0;this.result=''; }
    moves(capturesOnly=false) {
      const jumps=[],steps=[];
      this.board.forEach((p,i)=>{if(Math.sign(p)!==this.turn || (this.chain!==null && i!==this.chain))return;
        const r=i>>3,c=i%8,dirs=Math.abs(p)===2?[-1,1]:[-this.turn];
        dirs.forEach(dr=>[-1,1].forEach(dc=>{const nr=r+dr,nc=c+dc,tr=r+2*dr,tc=c+2*dc;
          if(!inside(nr,nc))return;
          if(!this.board[nr*8+nc] && this.chain===null)steps.push({from:i,to:nr*8+nc});
          if(inside(tr,tc) && Math.sign(this.board[nr*8+nc])===-this.turn && !this.board[tr*8+tc])jumps.push({from:i,to:tr*8+tc,take:nr*8+nc});
        }));
      });
      return jumps.length?jumps:capturesOnly?[]:steps;
    }
    move(from,to) {
      if(this.result)return false;
      const m=this.moves().find(m=>m.from===from&&m.to===to);if(!m)return false;
      const p=this.board[from];this.board[from]=0;this.board[to]=p;
      if(m.take!==undefined)this.board[m.take]=0;
      const crowned=Math.abs(p)===1 && ((p>0&&to<8)||(p<0&&to>=56));
      if(crowned)this.board[to]=p*2;
      this.quiet=m.take!==undefined||crowned?0:this.quiet+1;
      this.chain=m.take!==undefined&&!crowned?to:null;
      if(this.chain!==null && this.moves(true).length)return true;
      this.chain=null;this.turn*=-1;
      if(!this.moves().length)this.result=(this.turn===1?'Black':'Red')+' wins';
      else if(this.quiet>=80)this.result='Draw — 40 moves each without capture or crowning';
      return true;
    }
  }
  class Go {
    constructor(n=9) {this.n=n;this.board=Array(n*n).fill(0);this.turn=1;this.history=new Set([this.board.join('')]);this.passes=0;this.captured=[0,0];this.result='';}
    neighbors(i) {const r=Math.floor(i/this.n),c=i%this.n;return [[r-1,c],[r+1,c],[r,c-1],[r,c+1]].filter(([a,b])=>inside(a,b,this.n)).map(([a,b])=>a*this.n+b);}
    group(b,i) {const stones=new Set([i]),lib=new Set(),todo=[i];while(todo.length){const k=todo.pop();for(const j of this.neighbors(k)){if(!b[j])lib.add(j);else if(b[j]===b[i]&&!stones.has(j)){stones.add(j);todo.push(j);}}}return {stones:[...stones],lib};}
    candidate(i) {
      if(this.result||!Number.isInteger(i)||i<0||i>=this.board.length||this.board[i])return null;
      const b=this.board.slice();b[i]=this.turn;let count=0;
      for(const j of this.neighbors(i))if(b[j]===-this.turn){const g=this.group(b,j);if(!g.lib.size){count+=g.stones.length;g.stones.forEach(k=>b[k]=0);}}
      if(!this.group(b,i).lib.size||this.history.has(b.join('')))return null;
      return {b,count};
    }
    move(i) {const m=this.candidate(i);if(!m)return false;this.board=m.b;this.captured[this.turn===1?0:1]+=m.count;this.history.add(m.b.join(''));this.turn*=-1;this.passes=0;return true;}
    pass() {if(this.result)return;this.turn*=-1;if(++this.passes===2){const [b,w]=this.score();this.result=b===w?'Draw':(b>w?'Black':'White')+' wins — '+b+' : '+w;}}
    score() {const scores=[0,6.5],seen=new Set();this.board.forEach((v,i)=>{if(v)scores[v===1?0:1]++;else if(!seen.has(i)){const todo=[i],area=[],edges=new Set();seen.add(i);while(todo.length){const j=todo.pop();area.push(j);for(const k of this.neighbors(j)){if(this.board[k])edges.add(this.board[k]);else if(!seen.has(k)){seen.add(k);todo.push(k);}}}if(edges.size===1)scores[edges.has(1)?0:1]+=area.length;}});return scores;}
  }
  function pokerRank(cards) {
    const ranks=cards.map(c=>c.r).sort((a,b)=>b-a),counts=new Map();ranks.forEach(r=>counts.set(r,(counts.get(r)||0)+1));
    const groups=[...counts].sort((a,b)=>b[1]-a[1]||b[0]-a[0]),flush=cards.every(c=>c.s===cards[0].s);
    const unique=[...counts.keys()],straight=unique.length===5&&(ranks[0]-ranks[4]===4?ranks[0]:ranks.join(',')==='14,5,4,3,2'?5:0);
    if(flush&&straight)return [8,straight];
    if(groups[0][1]===4)return [7,...groups.map(g=>g[0])];
    if(groups[0][1]===3&&groups[1][1]===2)return [6,...groups.map(g=>g[0])];
    if(flush)return [5,...ranks];if(straight)return [4,straight];
    if(groups[0][1]===3)return [3,...groups.map(g=>g[0])];
    if(groups[0][1]===2&&groups[1][1]===2)return [2,...groups.map(g=>g[0])];
    if(groups[0][1]===2)return [1,...groups.map(g=>g[0])];return [0,...ranks];
  }
  const compare = (a,b) => {for(let i=0;i<Math.max(a.length,b.length);i++){const d=(a[i]||0)-(b[i]||0);if(d)return Math.sign(d);}return 0;};
  class Poker {
    constructor() {this.chips=[100,100];this.phase='ready';this.result='';}
    deal() {if(this.phase==='draw'||Math.min(...this.chips)<5)return false;this.deck=deck();this.hands=[this.deck.splice(0,5),this.deck.splice(0,5)];this.chips=this.chips.map(n=>n-5);this.phase='draw';this.result='Choose cards to replace, then draw. Pot: 10 play chips.';return true;}
    draw(indices) {if(this.phase!=='draw')return false;for(const i of new Set(indices))if(Number.isInteger(i)&&i>=0&&i<5)this.hands[0][i]=this.deck.pop();
      const h=this.hands[1],rank=pokerRank(h);if(rank[0]<4){const keep=rank[0]===0?[h.reduce((best,c)=>c.r>best.r?c:best).r]:[...new Set(h.filter(c=>h.filter(x=>x.r===c.r).length>1).map(c=>c.r))];h.forEach((c,i)=>{if(!keep.includes(c.r))h[i]=this.deck.pop();});}
      const win=compare(pokerRank(this.hands[0]),pokerRank(h));if(win===0){this.chips[0]+=5;this.chips[1]+=5;}else this.chips[win>0?0:1]+=10;
      this.phase='done';this.result=win===0?'Split pot':win>0?'You win 10 play chips':'Computer wins 10 play chips';return true;
    }
  }
  const sameColor=(a,b)=>('SH'.indexOf(a)>=0? a==='S'?'C':'D':a==='C'?'S':'H')===b;
  const effective=(c,t)=>c.r===11&&sameColor(c.s,t)?t:c.s;
  const strength=(c,t,lead)=>c.r===11&&c.s===t?100:c.r===11&&sameColor(c.s,t)?99:c.s===t?70+c.r:c.s===lead?30+c.r:c.r;
  class Euchre {
    constructor() {this.scores=[0,0];this.dealer=3;this.deal();}
    deal() {this.deck=deck(9);this.hands=Array.from({length:4},()=>this.deck.splice(0,5));this.up=this.deck.pop();this.turn=(this.dealer+1)%4;this.round=1;this.passed=0;this.phase='bid';this.trump='';this.maker=-1;this.tricks=[0,0];this.table=[];this.last=[];this.alone=false;this.skipped=-1;this.result='';}
    suits() {return this.round===1?[this.up.s]:['S','H','C','D'].filter(s=>s!==this.up.s);}
    bid(suit,alone=false) {
      if(this.phase!=='bid')return false;
      if(!suit){if(this.round===2&&this.passed===3)return false;this.passed++;this.turn=(this.turn+1)%4;if(this.passed===4){this.round=2;this.passed=0;this.turn=(this.dealer+1)%4;}return true;}
      if(!this.suits().includes(suit))return false;
      this.trump=suit;this.maker=this.turn;this.alone=alone;this.skipped=alone?(this.maker+2)%4:-1;
      if(this.round===1){this.hands[this.dealer].push(this.up);this.turn=this.dealer;this.phase='discard';}
      else this.start();return true;
    }
    start() {this.phase='play';this.turn=(this.dealer+1)%4;if(this.turn===this.skipped)this.turn=(this.turn+1)%4;}
    discard(i) {if(this.phase!=='discard'||!this.hands[this.turn][i])return false;this.hands[this.turn].splice(i,1);this.start();return true;}
    legal() {const h=this.hands[this.turn];if(!this.table.length)return h.map((_,i)=>i);const lead=effective(this.table[0].card,this.trump),following=h.map((c,i)=>effective(c,this.trump)===lead?i:-1).filter(i=>i>=0);return following.length?following:h.map((_,i)=>i);}
    play(i) {if(this.phase!=='play'||!this.legal().includes(i))return false;this.table.push({player:this.turn,card:this.hands[this.turn].splice(i,1)[0]});
      if(this.table.length===(this.alone?3:4)){const lead=effective(this.table[0].card,this.trump),winner=this.table.reduce((a,b)=>strength(b.card,this.trump,lead)>strength(a.card,this.trump,lead)?b:a);this.tricks[winner.player%2]++;this.last=this.table;this.table=[];this.turn=winner.player;
        if(this.tricks[0]+this.tricks[1]===5){const team=this.maker%2,n=this.tricks[team],points=n<3?2:n===5?(this.alone?4:2):1;this.scores[n<3?1-team:team]+=points;this.phase=Math.max(...this.scores)>=10?'over':'done';this.result=(n<3?'Makers euchred':n===5?'All five tricks':'Makers take '+n+' tricks')+' — '+points+' point'+(points>1?'s':'');}
      }else{this.turn=(this.turn+1)%4;if(this.turn===this.skipped)this.turn=(this.turn+1)%4;}return true;
    }
    ai() {const h=this.hands[this.turn];if(this.phase==='bid'){const options=this.suits().map(s=>({s,v:h.reduce((n,c)=>n+(effective(c,s)===s?1+(c.r===11?1:0):c.r===14?.4:0),0)})).sort((a,b)=>b.v-a.v);this.bid(options[0].v>=2.6 || (this.round===2&&this.passed===3)?options[0].s:null);}
      else if(this.phase==='discard'){let best=0;h.forEach((c,i)=>{if(strength(c,this.trump,'')<strength(h[best],this.trump,''))best=i;});this.discard(best);}
      else if(this.phase==='play'){const lead=this.table.length?effective(this.table[0].card,this.trump):'',legal=this.legal().sort((a,b)=>strength(h[a],this.trump,lead)-strength(h[b],this.trump,lead));const high=this.table.reduce((a,b)=>!a||strength(b.card,this.trump,lead)>strength(a.card,this.trump,lead)?b:a,null);this.play(high&&high.player%2!==this.turn%2?(legal.find(i=>strength(h[i],this.trump,lead)>strength(high.card,this.trump,lead))??legal[0]):legal[0]);}}
    next() {if(this.phase!=='done')return false;this.dealer=(this.dealer+1)%4;this.deal();return true;}
  }
  function poolBotShot(balls,pockets) {
    const cue=balls.find(b=>b.n===0&&!b.pocket),targets=balls.filter(b=>b.n!==0&&!b.pocket);
    if(!cue||!targets.length)return null;
    let best=null;
    for(const target of targets)for(const pocket of pockets){
      const pdx=pocket[0]-target.x,pdy=pocket[1]-target.y,pd=Math.hypot(pdx,pdy)||1;
      const contact={x:target.x-pdx/pd*20,y:target.y-pdy/pd*20};
      const cdx=contact.x-cue.x,cdy=contact.y-cue.y,cd=Math.hypot(cdx,cdy)||1;
      const blocked=balls.some(b=>b!==cue&&b!==target&&!b.pocket&&distanceToSegment(b.x,b.y,cue.x,cue.y,contact.x,contact.y)<21);
      if(blocked)continue;
      const score=cd+pd*.7;
      if(!best||score<best.score)best={angle:Math.atan2(cdy,cdx)*180/Math.PI,power:Math.max(34,Math.min(92,30+(cd+pd)*.09)),score};
    }
    if(best)return {angle:(best.angle+360)%360,power:best.power};
    const target=targets.reduce((a,b)=>Math.hypot(b.x-cue.x,b.y-cue.y)<Math.hypot(a.x-cue.x,a.y-cue.y)?b:a);
    return {angle:(Math.atan2(target.y-cue.y,target.x-cue.x)*180/Math.PI+360)%360,power:58};
  }
  function distanceToSegment(px,py,x1,y1,x2,y2) {
    const dx=x2-x1,dy=y2-y1,length=dx*dx+dy*dy,t=length?Math.max(0,Math.min(1,((px-x1)*dx+(py-y1)*dy)/length)):0;
    return Math.hypot(px-(x1+t*dx),py-(y1+t*dy));
  }
  const chessValues={p:1,n:3,b:3,r:5,q:9,k:0};
  function chessBotMove(game,rating=500,random=Math.random){
    const moves=game.moves({verbose:true});if(!moves.length)return null;
    if(rating<=500)return moves[Math.floor(random()*moves.length)];
    const scored=moves.map(m=>({m,score:(chessValues[m.captured]||0)*10+(m.promotion?8:0)}));
    const jitter=rating<1000?18:rating<1200?8:rating<1500?3:1;
    scored.forEach(x=>x.score+=random()*jitter);scored.sort((a,b)=>b.score-a.score);
    return scored[0].m;
  }
  const api={Checkers,Go,Poker,Euchre,pokerRank,compare,effective,strength,deck,copy,poolBotShot,chessBotMove};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.NorthstarGamesEngine=api;
})(typeof window!=='undefined'?window:globalThis);
