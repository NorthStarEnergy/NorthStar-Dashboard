/* Only a trusted NorthStar Games parent receives the selected avatar ID. */
(() => {
  'use strict';
  const params = new URLSearchParams(location.search);
  if(params.get('theme')==='classic') document.documentElement.classList.add('classic-chat');
  if(params.get('compact')==='1') document.documentElement.classList.add('compact-chat');
  window.NorthStarAvatars.ready().then(()=>{document.querySelector('.chat-session a').hidden=true;}).catch(()=>document.documentElement.classList.add('chat-signed-out'));
  document.getElementById('chatReconnect')?.addEventListener('click',()=>location.reload());
  if (parent === window) return;
  const allowed = new Set(['https://games.northstarenergy.ca','https://ops.northstarenergy.ca']);
  allowed.add(location.origin);
  if (['127.0.0.1','localhost'].includes(location.hostname)) {
    allowed.add('http://127.0.0.1:4185');allowed.add('http://localhost:4185');
  }
  let parentOrigin = '';
  function publish() {
    const profile = window.NorthStarAvatars?.profile;
    if (parentOrigin && profile) parent.postMessage({type:'northstar:avatar-profile',avatarId:profile.avatarId},parentOrigin);
  }
  window.addEventListener('message',event=>{
    if (event.source !== parent || !allowed.has(event.origin)) return;
    if (event.data?.type === 'northstar:avatar-request') {
      parentOrigin = event.origin;
      window.NorthStarAvatars.ready().then(publish).catch(()=>{});
    }
    if (event.data?.type === 'northstar:avatar-picker') {
      parentOrigin = event.origin;window.NorthStarAvatars.open();
    }
  });
  window.addEventListener('northstar:avatar-change',publish);
})();
