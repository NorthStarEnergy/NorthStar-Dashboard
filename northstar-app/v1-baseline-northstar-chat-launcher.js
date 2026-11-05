/* The same authenticated NorthStar chat on dashboard and Games. */
(() => {
  'use strict';
  if (window.NorthStarSharedChat) return;
  const script = document.currentScript;
  const configured = script?.dataset.chatOrigin;
  const local = ['localhost','127.0.0.1'].includes(location.hostname);
  const origin = configured === 'self' ? location.origin : configured && (configured === 'https://ops.northstarenergy.ca' || (local && /^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(configured)))
    ? configured : 'https://ops.northstarenergy.ca';
  let frame, panel, trigger, profile = null, pendingPicker = false, avatarImage, menuToggle, returnFocus;
  const frames = new Set();
  function post(type) { frame?.contentWindow?.postMessage({type}, origin); }
  function mount() {
    if (panel) return;
    trigger = document.createElement('button'); trigger.type = 'button'; trigger.className = 'ns-shared-chat-toggle';
    trigger.textContent = 'Chat'; trigger.setAttribute('aria-expanded','false'); trigger.setAttribute('aria-controls','nsSharedChat');
    panel = document.createElement('section'); panel.id = 'nsSharedChat'; panel.className = 'ns-shared-chat'; panel.hidden = true;
    panel.setAttribute('aria-label','NorthStar shared chat');
    const header = document.createElement('header');
    const title = document.createElement('strong'); title.textContent = 'NorthStar Chat';
    const full = document.createElement('a'); full.href = origin + '/northstar-chat.html'; full.target = '_blank'; full.rel = 'noopener'; full.textContent = 'Open in tab';
    const close = document.createElement('button'); close.type = 'button'; close.textContent = '\u00d7'; close.setAttribute('aria-label','Close NorthStar chat'); close.onclick = () => toggle(false);
    header.append(title,full,close);
    frame = document.createElement('iframe'); frame.title = 'NorthStar conversation and avatar selection'; frame.src = origin + '/northstar-chat.html';
    frames.add(frame);
    frame.addEventListener('load', () => {post('northstar:avatar-request'); if (pendingPicker) {post('northstar:avatar-picker');pendingPicker=false;}});
    panel.append(header,frame); document.body.append(panel);
    const avatarButton=document.createElement('button');avatarButton.type='button';avatarButton.className='ns-shared-avatar';avatarButton.setAttribute('aria-label','Choose your NorthStar avatar');
    avatarImage=document.createElement('img');avatarImage.src='/assets/avatars/classic/classic-00.png';avatarImage.width=34;avatarImage.height=23;avatarImage.alt='Your avatar';avatarButton.append(avatarImage);avatarButton.onclick=()=>{ if(window.NorthStarAvatars) window.NorthStarAvatars.open(avatarButton); else chooseAvatar(); };
    const userProfile=document.createElement('details');userProfile.className='ns-menu-profile';
    const summary=document.createElement('summary');summary.textContent='User profile';
    const hint=document.createElement('small');hint.textContent='Click your avatar to change it';
    userProfile.append(summary,avatarButton,hint);
    const mountMenu=()=>{
      const host=document.querySelector('#nsWebToolbar .ns-web-toolbar-dropdown') || document.querySelector('.table-menu .menu-content, .table-menu > nav');
      if(!host) return false;
      menuToggle=host.closest('#nsWebToolbar')?.querySelector('.ns-web-toolbar-menu') || host.closest('details')?.querySelector('summary');
      host.prepend(userProfile,trigger);return true;
    };
    if(!mountMenu()){
      // The dashboard toolbar is created after its other deferred scripts.
      if(configured==='self' && !/Electron/i.test(navigator.userAgent) && new URLSearchParams(location.search).get('nsToolbar')!=='off'){
        const observer=new MutationObserver(()=>{if(mountMenu())observer.disconnect();});
        observer.observe(document.body,{childList:true,subtree:true});
      } else {
        const menu=document.createElement('details');menu.className='ns-account-menu';
        const summary=document.createElement('summary');summary.textContent='\u2630';summary.setAttribute('aria-label','Open application menu');
        const content=document.createElement('div');content.className='ns-account-menu-content';content.append(userProfile,trigger);
        menu.append(summary,content);
        (document.querySelector('.topbar, .app > aside .brand') || document.body).append(menu);
        menuToggle=summary;
        document.addEventListener('pointerdown',event=>{if(!menu.contains(event.target))menu.open=false;});
        menu.addEventListener('keydown',event=>{if(event.key==='Escape'){menu.open=false;summary.focus();}});
      }
    }
    window.addEventListener('northstar:avatar-change',event=>{if(/^classic-(?:[0-3]\d|4[0-4])$/.test(event.detail?.avatarId))avatarImage.src='/assets/avatars/classic/'+event.detail.avatarId+'.png';});
    if(configured==='self') [trigger,panel,avatarButton].forEach(el=>el.classList.add('ns-dashboard-chat'));
    trigger.onclick = () => toggle(panel.hidden);
    panel.addEventListener('keydown',event=>{if(event.key==='Escape')toggle(false);});
  }
  function toggle(open) { mount(); panel.hidden = !open; trigger.setAttribute('aria-expanded',String(open)); if(open) {returnFocus=menuToggle || document.activeElement;const details=menuToggle?.closest('details');if(details)details.open=false;const dropdown=document.querySelector('#nsWebToolbarDropdown');if(dropdown){dropdown.hidden=true;menuToggle?.setAttribute('aria-expanded','false');}post('northstar:avatar-request'); panel.querySelector('header button').focus();} else returnFocus?.focus(); }
  function chooseAvatar() { pendingPicker = true; toggle(true); post('northstar:avatar-picker'); }
  window.addEventListener('message',event=>{
    if (![...frames].some(item=>item.contentWindow===event.source) || event.origin !== origin || event.data?.type !== 'northstar:avatar-profile' || !/^classic-(?:[0-3]\d|4[0-4])$/.test(event.data.avatarId)) return;
    const changed = profile?.avatarId !== event.data.avatarId;
    profile = {avatarId:event.data.avatarId};
    if(avatarImage) avatarImage.src='/assets/avatars/classic/'+profile.avatarId+'.png';
    if(changed) window.dispatchEvent(new CustomEvent('northstar:avatar-change',{detail:profile}));
  });
  function mountInline(container, options = {}) {
    if (!(container instanceof HTMLElement)) throw new TypeError('A chat container is required.');
    if (container.querySelector('.ns-inline-chat')) return container.querySelector('.ns-inline-chat');
    const embedded = document.createElement('iframe'); embedded.className='ns-inline-chat';
    embedded.title='NorthStar shared conversation'; embedded.src=origin+'/northstar-chat.html'+(options.theme==='classic'?'?theme=classic&compact=1':'');
    if(options.compact) embedded.classList.add('ns-inline-chat-compact'); frames.add(embedded);
    embedded.addEventListener('load',()=>embedded.contentWindow.postMessage({type:'northstar:avatar-request'},origin));
    container.append(embedded); return embedded;
  }
  window.NorthStarSharedChat = {open:()=>toggle(true),chooseAvatar,mount:mountInline,get profile(){return profile;}};
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',mount,{once:true}); else mount();
})();
