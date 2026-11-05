const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
fs.mkdirSync(path.join(root,'outputs'),{recursive:true});
(async()=>{
 const browser=await chromium.launch({channel:process.env.NORTHSTAR_BROWSER_CHANNEL||'msedge',headless:true});
 try{
 const context=await browser.newContext();
 let avatarId='classic-00', failSend=false;
 const messages=[{id:'one',roomId:'general',author:'Alice',source:'northstar',body:'Hello <script>alert(1)</script>',createdAt:'2026-10-17T15:00:00Z'}];
 const errors=[];
 await context.route('**/*',async route=>{
  const req=route.request(),url=new URL(req.url()),p=url.pathname;
  let data;
  if(p==='/api/avatars')data={avatars:JSON.parse(fs.readFileSync(path.join(root,'assets/avatars/classic/catalog.json'),'utf8'))};
  else if(p==='/api/profile/avatar'){if(req.method()==='POST')avatarId=req.postDataJSON().avatarId;data={actor:'Alice',avatarId};}
  else if(p==='/api/chat/status')data={teams:{mode:'off'}};
  else if(p==='/api/chat/messages'){
    if(req.method()==='POST'){
      if(failSend)return route.fulfill({status:503,json:{error:'Offline fixture'}});
      const payload=req.postDataJSON();data={id:'m'+messages.length,roomId:payload.room,author:'Alice',source:'northstar',body:payload.body,createdAt:new Date().toISOString()};messages.push(data);
    }else data={messages:messages.filter(m=>m.roomId===url.searchParams.get('room')).map(m=>({...m,avatarId}))};
  } else if(p==='/dashboard-fixture')return route.fulfill({contentType:'text/html',body:'<html><head><link rel="stylesheet" href="/northstar-chat-launcher.css"><script defer src="/northstar-chat-launcher.js" data-chat-origin="self"></script></head><body><div class="layout-toolbar" style="position:fixed;right:10px;bottom:10px;z-index:600"><button class="layout-edit-toggle" style="width:100px;height:30px">Edit layout</button></div></body></html>'});
  else if(p==='/games-fixture')return route.fulfill({contentType:'text/html',body:'<html><head><link rel="stylesheet" href="/northstar-chat-launcher.css"><script defer src="/northstar-chat-launcher.js"></script></head><body><div id="inline" style="width:520px;height:220px"></div></body></html>'});
  if(data)return route.fulfill({json:data});
  const file=path.join(root,p.slice(1));
  if(fs.existsSync(file)&&fs.statSync(file).isFile())return route.fulfill({body:fs.readFileSync(file),contentType:p.endsWith('.js')?'application/javascript':p.endsWith('.css')?'text/css':p.endsWith('.png')?'image/png':'text/html'});
  return route.fulfill({status:404,body:'Missing fixture route'});
 });
 const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
 await page.goto('https://ops.northstarenergy.ca/northstar-chat.html');
 await page.locator('.chat-message').waitFor();
 assert.equal(await page.locator('.chat-body').innerText(),'Hello <script>alert(1)</script>');
 await page.locator('[data-ns-avatar-picker]').click();
 await page.locator('[data-avatar-id="classic-44"]').waitFor();
 assert.equal(await page.locator('[data-avatar-id]').count(),45);
 await page.locator('[data-avatar-id="classic-12"]').click();
 await page.waitForFunction(()=>document.querySelector('.ns-chat-avatar').src.endsWith('classic-12.png'));
 await page.reload();await page.locator('.chat-message').waitFor();
 assert.ok((await page.locator('.ns-chat-avatar').getAttribute('src')).endsWith('classic-12.png'));
 await page.locator('#operatorChatInput').fill('Shared from Games');await page.locator('#operatorChatInput').press('Enter');
 await page.locator('.chat-body').filter({hasText:'Shared from Games'}).waitFor();
 failSend=true;await page.locator('#operatorChatInput').fill('Keep draft');await page.locator('#operatorChatInput').press('Enter');
 await page.locator('#chatFeedback').filter({hasText:'Message not sent'}).waitFor();assert.equal(await page.locator('#operatorChatInput').inputValue(),'Keep draft');failSend=false;
 await page.setViewportSize({width:390,height:700});
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 await page.screenshot({path:path.join(root,'outputs/avatar-chat-mobile.png')});
 const games=await context.newPage();await games.goto('https://games.northstarenergy.ca/games-fixture');
 await games.evaluate(()=>NorthStarSharedChat.mount(document.getElementById('inline'),{theme:'classic',compact:true}));
 const compact=games.frameLocator('.ns-inline-chat');await compact.locator('.chat-message').first().waitFor();
 await games.waitForFunction(()=>NorthStarSharedChat.profile?.avatarId==='classic-12');
 const inputBox=await compact.locator('#operatorChatInput').boundingBox();const frameBox=await games.locator('.ns-inline-chat').boundingBox();
 assert.ok(inputBox.y+inputBox.height<=frameBox.y+frameBox.height+1,'composer must fit inside compact frame');
 assert.ok(await compact.locator('#chatMessages').evaluate(el=>getComputedStyle(el).overflowY==='auto'));
 await games.evaluate(()=>dispatchEvent(new MessageEvent('message',{origin:'https://evil.example',data:{type:'northstar:avatar-profile',avatarId:'classic-44'}})));
 assert.equal(await games.evaluate(()=>NorthStarSharedChat.profile.avatarId),'classic-12');
 await games.screenshot({path:path.join(root,'outputs/avatar-chat-compact.png')});
 const local=await context.newPage();await local.goto('http://127.0.0.1:4180/dashboard-fixture');
 await local.waitForFunction(()=>NorthStarSharedChat.profile?.avatarId==='classic-12');
 await local.evaluate(()=>document.querySelector('.layout-edit-toggle').onclick=()=>document.querySelector('.layout-toolbar').classList.add('editing'));
 await local.locator('.layout-edit-toggle').click();
 assert.equal(await local.locator('.ns-shared-chat-toggle').isVisible(),false,'chat must not cover layout editing controls');
 assert.deepEqual(errors,[]);
 const report={passed:true,checks:['45 original picker choices','saved choice survives reload','message avatars update','HTML escaped','send and failed-draft preservation','390px viewport','220px compact transcript/composer','trusted Games bridge','untrusted message ignored','same-origin local desktop bridge','layout controls remain clickable and chat hides during editing'],scope:'Rendered browser fixture; production authentication not exercised'};
 fs.writeFileSync(path.join(root,'outputs/avatar-browser-verification.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
