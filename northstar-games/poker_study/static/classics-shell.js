(function(){
  'use strict';
  const games=new Set(['chess','euchre']);
  function select(){
    const id=games.has(location.hash.slice(1))?location.hash.slice(1):'chess';
    document.body.dataset.game=id;
    document.querySelectorAll('[data-game-link]').forEach(link=>{const active=link.dataset.gameLink===id;link.classList.toggle('active',active);active?link.setAttribute('aria-current','page'):link.removeAttribute('aria-current');});
    document.title=(id==='poker'?'Five-Card Draw':id[0].toUpperCase()+id.slice(1))+' · NorthStar Games';
  }
  addEventListener('hashchange',select);select();
})();

(function(){
  'use strict';
  const storageKey='northstar-chess-visible-panels';
  function install(){
    const chess=document.querySelector('#ng-chess');
    if(!chess?.querySelector('.ng-table-bottom'))return false;
    if(chess.querySelector('.ng-visibility'))return true;
    let saved={};
    try{saved=JSON.parse(localStorage.getItem(storageKey)||'{}')||{};}catch{}
    const bar=document.createElement('div');
    bar.className='ng-visibility';
    bar.innerHTML='<button type="button" class="ng-visibility-trigger" aria-expanded="false" aria-controls="ng-visible-panels">Show / hide ▾</button><div id="ng-visible-panels" hidden role="group" aria-label="Visible sections"></div>';
    const trigger=bar.querySelector('button'),panel=bar.querySelector('div');
    trigger.addEventListener('click',()=>{panel.hidden=!panel.hidden;trigger.setAttribute('aria-expanded',String(!panel.hidden));});
    bar.addEventListener('keydown',event=>{if(event.key==='Escape'){panel.hidden=true;trigger.setAttribute('aria-expanded','false');trigger.focus();}});
    for(const [key,title,selector] of [
      ['controls','Game controls',':scope > .ng-toolbar'],
      ['history','Players & move history','.ng-chess-rail'],
      ['chat','Chat & table','.ng-table-bottom']
    ]){
      const section=chess.querySelector(selector);
      if(!section)continue;
      section.id=section.id||'ng-section-'+key;
      const label=document.createElement('label'),input=document.createElement('input');
      input.type='checkbox';input.checked=saved[key]!==false;input.setAttribute('aria-controls',section.id);
      const apply=()=>section.classList.toggle('ng-section-hidden',!input.checked);
      input.addEventListener('change',()=>{saved[key]=input.checked;apply();try{localStorage.setItem(storageKey,JSON.stringify(saved));}catch{}});
      label.append(input,document.createTextNode(title));panel.append(label);apply();
    }
    chess.querySelector('.ng-status').after(bar);
    return true;
  }
  if(!install()){
    const observer=new MutationObserver(()=>{if(install())observer.disconnect();});
    observer.observe(document.querySelector('main')||document.body,{childList:true,subtree:true});
  }
})();
