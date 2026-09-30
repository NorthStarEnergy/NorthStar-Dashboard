const {test}=require('node:test');
const assert=require('node:assert/strict');
const context={module:{exports:{}}};require('node:vm').runInNewContext(require('node:fs').readFileSync(require('node:path').join(__dirname,'../games-engine.js'),'utf8'),context);
const E=context.module.exports;
const normalize=value=>JSON.parse(JSON.stringify(value));
test('vendored chess enforces legal moves and checkmate',async()=>{
 const {Chess}=await import('../vendor/chess/chess.js');const g=new Chess();
 assert.throws(()=>g.move({from:'e2',to:'e5'}));['f3','e5','g4','Qh4#'].forEach(m=>g.move(m));assert.equal(g.isCheckmate(),true);
});
test('chess supports castling, en passant and underpromotion',async()=>{
 const {Chess}=await import('../vendor/chess/chess.js');
 const castle=new Chess('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1');castle.move('O-O');assert.equal(castle.get('f1').type,'r');
 const ep=new Chess();['e4','a6','e5','d5','exd6'].forEach(m=>ep.move(m));assert.equal(ep.get('d5'),undefined);
 const promote=new Chess('7k/P7/8/8/8/8/8/7K w - - 0 1');promote.move({from:'a7',to:'a8',promotion:'n'});assert.equal(promote.get('a8').type,'n');
});
test('checkers forces captures and continues multiple jumps',()=>{
 const g=new E.Checkers();g.board.fill(0);g.board[42]=1;g.board[35]=-1;g.board[21]=-1;g.board[7]=-1;
 assert.deepEqual(normalize(g.moves()),[{from:42,to:28,take:35}]);assert.equal(g.move(42,33),false);
 assert.equal(g.move(42,28),true);assert.equal(g.turn,1);assert.equal(g.chain,28);
 assert.equal(g.move(28,14),true);assert.equal(g.turn,-1);assert.equal(g.board[21],0);
});
test('checkers crowning ends capture and immobilized side loses',()=>{
 const g=new E.Checkers();g.board.fill(0);g.board[17]=1;g.board[10]=-1;g.board[12]=-1;
 g.move(17,3);assert.equal(g.board[3],2);assert.equal(g.turn,-1);assert.equal(g.chain,null);
 const h=new E.Checkers();h.board.fill(0);h.board[17]=1;h.board[10]=-1;h.move(17,3);assert.equal(h.result,'Red wins');
});
test('Go capture, suicide, repeated position, passes and area score',()=>{
 const g=new E.Go(3);g.board=[0,1,0,1,-1,1,0,0,0];assert.equal(g.move(7),true);assert.equal(g.board[4],0);assert.equal(g.captured[0],1);
 assert.equal(g.move(4),false);const h=new E.Go(3);const candidate=h.candidate(0);h.history.add(candidate.b.join(''));assert.equal(h.move(0),false);
 const s=new E.Go(3);s.board=[1,1,1,1,0,1,1,1,1];assert.deepEqual(normalize(s.score()),[9,6.5]);s.pass();s.pass();assert.match(s.result,/Black wins/);assert.equal(s.move(4),false);
});
test('poker rankings handle wheel, full house, kicker and split',()=>{
 const c=(rs,ss=['S','H','C','D','S'])=>rs.map((r,i)=>({r,s:ss[i]}));
 assert.deepEqual(normalize(E.pokerRank(c([14,2,3,4,5]))),[4,5]);
 assert.equal(E.compare(E.pokerRank(c([10,10,10,9,9])),E.pokerRank(c([14,12,10,8,6],Array(5).fill('S')))),1);
 assert.equal(E.compare(E.pokerRank(c([9,9,14,7,6])),E.pokerRank(c([9,9,13,12,11]))),1);
 const p=new E.Poker();p.deal();p.hands=[c([14,13,12,11,10],Array(5).fill('S')),c([14,13,12,11,10],Array(5).fill('H'))];p.draw([]);assert.deepEqual(normalize(p.chips),[100,100]);assert.equal(p.draw([]),false);
});
test('Euchre left bower follows trump and is not its printed suit',()=>{
 const g=new E.Euchre();g.phase='play';g.trump='H';g.turn=0;g.hands[0]=[{r:11,s:'D'},{r:9,s:'D'},{r:14,s:'S'}];g.table=[{player:3,card:{r:14,s:'H'}}];assert.deepEqual(normalize(g.legal()),[0]);
 g.table=[{player:3,card:{r:14,s:'D'}}];assert.deepEqual(normalize(g.legal()),[1]);assert.equal(E.effective({r:11,s:'D'},'H'),'H');
 assert.ok(E.strength({r:11,s:'H'},'H','H')>E.strength({r:11,s:'D'},'H','H'));
});
test('Euchre full matches finish, hands score and cards remain unique',()=>{
 for(let run=0;run<20;run++){const g=new E.Euchre();let actions=0;
 while(g.phase!=='over'&&actions++<3000){if(g.phase==='done')g.next();else g.ai();
 const cards=g.hands.flat().map(c=>c.r+c.s);assert.equal(new Set(cards).size,cards.length);
 }assert.equal(g.phase,'over');assert.ok(Math.max(...g.scores)>=10);}
});
test('Euchre alone sits partner out and awards four for a sweep',()=>{
 const g=new E.Euchre();g.round=2;g.turn=0;const suit=g.suits()[0];g.bid(suit,true);assert.equal(g.skipped,2);
 g.tricks=[4,0];g.turn=0;g.hands=[[{s:suit,r:11}],[{s:suit,r:9}],[],[{s:suit,r:10}]];g.table=[];
 g.play(0);g.play(0);g.play(0);assert.equal(g.scores[0],4);assert.equal(g.phase,'done');
});

