(function(root){
'use strict';
const ranks=['A','2','3','4','5','6','7','8','9','10','J','Q','K'];
const value=c=>c.rank==='A'?11:Math.min(10,Number(c.rank)||10);
const tag=c=>value(c)>=10?-1:value(c)<=6?1:0;
function total(cards){let n=cards.reduce((s,c)=>s+value(c),0),aces=cards.filter(c=>c.rank==='A').length;while(n>21&&aces){n-=10;aces--;}return {n,soft:aces>0};}
function shoe(decks,rng=Math.random){if(!Number.isInteger(decks)||decks<1||decks>12)throw Error('Enter a whole number of decks from 1 to 12.');const cards=[];for(let d=0;d<decks;d++)for(const suit of ['♠','♥','♦','♣'])for(const rank of ranks)cards.push({rank,suit,id:`${d}-${suit}-${rank}`});for(let i=cards.length-1;i>0;i--){const j=Math.floor(rng()*(i+1));[cards[i],cards[j]]=[cards[j],cards[i]];}return cards;}
const emptyStats=()=>({rounds:0,hands:0,wins:0,losses:0,pushes:0,blackjacks:0,units:0,decisions:0,correct:0,assisted:0,betDecisions:0,betCorrect:0,checks:0,countCorrect:0,trueChecks:0,trueCorrect:0,assistedChecks:0,shuffles:0,abandoned:0,streak:0,best:0});
function betRamp(trueCount,minBet,maxBet){const tc=Math.floor(Number.isFinite(trueCount)?trueCount:0),multiple=tc<=1?1:tc===2?2:tc===3?4:tc===4?8:tc===5?10:12;return Math.min(maxBet,minBet*multiple);}
function legal(g){if(g.phase!=='player')return [];const h=g.hands[g.active],a=['hit','stand'],committed=g.hands.reduce((sum,hand)=>sum+hand.bet,0),canAdd=committed+h.bet<=g.bankroll;if(h.cards.length===2&&canAdd)a.push('double');if(h.cards.length===2&&canAdd&&value(h.cards[0])===value(h.cards[1])&&g.hands.length<4)a.push('split');return a;}
// Total-dependent S17, DAS, no surrender; separate single/double/multi-deck rules.
function strategy(cards,up,decks,actions=['hit','stand','double','split']){
 const {n,soft}=total(cards),d=value(up),single=decks===1,small=decks<=2;
 const dbl=fallback=>actions.includes('double')?'double':fallback;
 if(cards.length===2&&value(cards[0])===value(cards[1])&&actions.includes('split')){
  const p=value(cards[0]);
  if(p===11||p===8||(p===2&&d<=7)||(p===3&&d<=(single?8:7))||(p===4&&d>=4+(single?0:1)&&d<=6)||(p===6&&d<= (small?7:6))||(p===7&&d<=(small?8:7))||(p===9&&(d<=6||d===8||d===9)))return 'split';
 }
 if(single&&cards.length===2&&cards.every(c=>c.rank==='7')&&d===10)return 'stand';
 if(soft){
  if(n>=20)return 'stand';
  if(n===19)return single&&d===6?dbl('stand'):'stand';
  if(n===18){if(d>=3&&d<=6)return dbl('stand');return d===9||d===10||(d===11&&!single)?'hit':'stand';}
  if(n===17)return d>=(single?2:3)&&d<=6?dbl('hit'):'hit';
  if(n===15||n===16)return d>=(single?4:4)&&d<=6?dbl('hit'):'hit';
  if(n===13||n===14)return d>=(single?4:(decks===2&&n===14?4:5))&&d<=6?dbl('hit'):'hit';
  return 'hit';
 }
 if(n>=17)return 'stand';
 if(n>=13)return d<=6?'stand':'hit';
 if(n===12)return d>=4&&d<=6?'stand':'hit';
 if(n===11)return d!==11||small?dbl('hit'):'hit';
 if(n===10)return d<=9?dbl('hit'):'hit';
 if(n===9)return d>=(small?2:3)&&d<=6?dbl('hit'):'hit';
 if(n===8&&single&&d>=5&&d<=6)return dbl('hit');
 return 'hit';
}
class Game{
 constructor(decks=6,minBet=1,maxBet=12,bankroll=600){if(!Number.isFinite(minBet)||!Number.isFinite(maxBet)||!Number.isFinite(bankroll)||minBet<=0||maxBet<minBet||bankroll<minBet)throw Error('Use a positive minimum, a maximum at least as large, and a bankroll that covers the minimum bet.');this.minBet=minBet;this.maxBet=maxBet;this.initialBankroll=bankroll;this.bankroll=bankroll;this.stats=emptyStats();this.history=[];this.lastBetCheck=null;this.shuffle(decks,false);}
 shuffle(decks=this.decks,record=true){const next=shoe(decks);if(this.phase==='player')this.stats.abandoned++;this.decks=decks;this.shoe=next;this.running=0;this.exposed=0;this.checkedAt=-1;this.assistedAt=-1;this.phase='ready';this.hands=[];this.dealer=[];this.holeVisible=false;this.active=0;this.feedback='Fresh shoe. Deal a hand when you’re ready.';if(record)this.stats.shuffles++;}
 expose(c){this.running+=tag(c);this.exposed++;return c;}
 draw(visible=true){if(!this.shoe.length)throw Error('Shoe exhausted');const c=this.shoe.pop();return visible?this.expose(c):c;}
 revealHole(){if(this.dealer.length>1&&!this.holeVisible){this.expose(this.dealer[1]);this.holeVisible=true;}}
 get trueCount(){return this.shoe.length?this.running/(this.shoe.length/52):null;}
 get recommendedBet(){return betRamp(this.trueCount,this.minBet,this.maxBet);}
 deal(bet=this.minBet){if(this.phase==='player')return false;if(this.shoe.length<16){this.feedback='Fewer than 16 cards remain. Shuffle to start another hand.';return false;}bet=Number(bet);if(!Number.isFinite(bet)||bet<this.minBet||bet>this.maxBet)throw Error(`Bet between $${this.minBet} and $${this.maxBet}.`);if(bet>this.bankroll)throw Error('That bet is larger than your bankroll.');const recommended=this.recommendedBet,correct=Math.abs(bet-recommended)<0.001;this.stats.betDecisions++;if(correct)this.stats.betCorrect++;this.lastBetCheck={bet,recommended,trueCount:this.trueCount,correct};this.phase='player';this.active=0;this.holeVisible=false;this.hands=[{cards:[],bet,split:false,done:false}];this.dealer=[];this.feedback='Choose your action. Keep the running count in your head.';const h=this.hands[0];h.cards.push(this.draw());this.dealer.push(this.draw());h.cards.push(this.draw());this.dealer.push(this.draw(false));if(total(h.cards).n===21||total(this.dealer).n===21){this.revealHole();this.settle();}return true;}
 hint(){if(this.phase!=='player')return '';this.hands[this.active].hinted=true;return strategy(this.hands[this.active].cards,this.dealer[0],this.decks,legal(this));}
 act(action){if(!legal(this).includes(action))return false;const h=this.hands[this.active],expected=strategy(h.cards,this.dealer[0],this.decks,legal(this));const good=action===expected,assisted=!!h.hinted;h.hinted=false;
  if(assisted)this.stats.assisted++;else{this.stats.decisions++;if(good){this.stats.correct++;this.stats.streak++;this.stats.best=Math.max(this.stats.best,this.stats.streak);}else this.stats.streak=0;}
  this.feedback=`${good?'Correct':'Review'}${assisted?' · hinted':''}: ${action}. Basic strategy: ${expected}.`;
  this.history.unshift({hand:h.cards.map(c=>c.rank).join(', '),dealer:this.dealer[0].rank,action,expected,good,assisted});this.history=this.history.slice(0,40);
  try{
   if(action==='hit'){h.cards.push(this.draw());if(total(h.cards).n>=21)h.done=true;}
   if(action==='stand')h.done=true;
   if(action==='double'){h.bet*=2;h.doubled=true;h.cards.push(this.draw());h.done=true;}
   if(action==='split'){const [a,b]=h.cards,aces=a.rank==='A';const one={cards:[a,this.draw()],bet:h.bet,split:true,done:aces},two={cards:[b,this.draw()],bet:h.bet,split:true,done:aces};if(total(one.cards).n===21)one.done=true;if(total(two.cards).n===21)two.done=true;this.hands.splice(this.active,1,one,two);}
   this.advance();
  }catch(e){if(e.message!=='Shoe exhausted')throw e;this.revealHole();this.phase='done';this.stats.abandoned++;this.hands.forEach(x=>x.result='Void');this.feedback+=' Shoe exhausted: round void, no units won or lost. Shuffle to continue.';}
  return true;
 }
 advance(){while(this.active<this.hands.length&&this.hands[this.active].done)this.active++;if(this.active<this.hands.length)return;this.revealHole();if(this.hands.some(h=>total(h.cards).n<=21))while(total(this.dealer).n<17)this.dealer.push(this.draw());this.settle();}
 settle(){const dealer=total(this.dealer).n,dealerBJ=this.dealer.length===2&&dealer===21;this.revealHole();this.stats.rounds++;for(const h of this.hands){const n=total(h.cards).n,bj=n===21&&h.cards.length===2&&!h.split;let gain=n>21?-h.bet:dealerBJ?(bj?0:-h.bet):bj?1.5*h.bet:dealer>21||n>dealer?h.bet:n===dealer?0:-h.bet;h.result=gain>0?(bj?'Blackjack':'Win'):gain<0?'Loss':'Push';h.gain=gain;this.stats.hands++;this.stats.units+=gain;this.bankroll+=gain;this.stats[gain>0?'wins':gain<0?'losses':'pushes']++;if(bj)this.stats.blackjacks++;}this.phase='done';}
 checkCount(running,trueGuess,assisted=false){if(this.checkedAt===this.exposed)return null;const r=Number(running);if(String(running).trim()===''||!Number.isInteger(r))throw Error('Enter a whole-number running count.');const hasTrue=String(trueGuess??'').trim()!=='';const t=Number(trueGuess);if(hasTrue&&(!Number.isFinite(t)||this.trueCount===null))throw Error('Enter a valid true count while cards remain.');this.checkedAt=this.exposed;const result={correct:r===this.running,trueCorrect:hasTrue?Math.abs(t-Number(this.trueCount.toFixed(1)))<0.051:null,assisted:assisted||this.assistedAt===this.exposed};if(result.assisted)this.stats.assistedChecks++;else{this.stats.checks++;if(result.correct)this.stats.countCorrect++;if(hasTrue){this.stats.trueChecks++;if(result.trueCorrect)this.stats.trueCorrect++;}}return result;}
}
const api={Game,shoe,value,tag,total,strategy,legal,emptyStats,betRamp};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.Blackjack=api;
})(typeof globalThis!=='undefined'?globalThis:this);
