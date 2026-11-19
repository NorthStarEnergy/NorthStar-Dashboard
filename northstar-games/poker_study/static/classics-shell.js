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
    const play=chess.querySelector('.ng-play');
    const appearance=document.createElement('div');
    appearance.className='chess-appearance';
    let prefs={};
    try{prefs=JSON.parse(localStorage.getItem('chessAppearance')||'{}')||{};}catch{}
    function save(){try{localStorage.setItem('chessAppearance',JSON.stringify(prefs));}catch{}}
    function palette(key,title,options){
      const label=document.createElement('label'),select=document.createElement('select');
      select.setAttribute('aria-label',title);label.append(title+' ',select);appearance.append(label);
      for(const [value,name] of Object.entries(options))select.add(new Option(name,value));
      select.value=Object.hasOwn(options,prefs[key])?prefs[key]:select.options[0].value;
      chess.dataset[key]=select.value;
      select.onchange=()=>{chess.dataset[key]=prefs[key]=select.value;save();};
    }
    palette('boardTone','Board',{green:'Forest',wood:'Walnut',blue:'Slate blue'});
    palette('pieceTone','Pieces',{classic:'Ivory & ebony',silver:'Silver & graphite',amber:'Amber & mahogany'});
    bar.prepend(appearance);
    const handle=document.createElement('button');
    handle.type='button';handle.className='chess-resize';handle.textContent='⤡';
    handle.setAttribute('aria-label','Resize chessboard');handle.title='Drag to resize, or use arrow keys';
    // The renderer replaces the frame after each move. Keep the handle on its stable parent.
    const holder=document.createElement('div');
    holder.className='chess-board-holder';play.before(holder);holder.append(play,handle);
    function size(width){
      prefs.width=Math.round(Math.max(280,Math.min(width,holder.parentElement.clientWidth-28)));
      holder.style.setProperty('--chess-width',prefs.width+'px');
    }
    if(Number.isFinite(prefs.width))size(prefs.width);
    let drag=null;
    handle.onpointerdown=e=>{
      if(e.button!==0)return;
      drag={x:e.clientX,y:e.clientY,width:holder.getBoundingClientRect().width};
      handle.setPointerCapture(e.pointerId);e.preventDefault();
    };
    handle.onpointermove=e=>{
      if(!drag)return;
      const dx=e.clientX-drag.x,dy=e.clientY-drag.y;
      size(drag.width+(Math.abs(dx)>Math.abs(dy)?dx:dy));
    };
    handle.onlostpointercapture=()=>{drag=null;save();};
    handle.onkeydown=e=>{
      if(!['ArrowRight','ArrowUp','ArrowLeft','ArrowDown'].includes(e.key))return;
      e.preventDefault();size(holder.offsetWidth+(['ArrowRight','ArrowDown'].includes(e.key)?16:-16));save();
    };
    chess.querySelector('.ng-toolbar').after(bar);
    return true;
  }
  if(!install()){
    const observer=new MutationObserver(()=>{if(install())observer.disconnect();});
    observer.observe(document.querySelector('main')||document.body,{childList:true,subtree:true});
  }
})();


