/* Keep the real dashboard navigation around Library and let AI own the left rail. */
(() => {
 'use strict';
 const params=new URLSearchParams(location.search),shellTitle=document.title;
 if(params.has('nsModuleWindow')||params.has('nsStatusWindow'))return;
 let active=false,opened=false,bar,aside,frame=0;
 function update(){frame=0;const ai=!document.body.classList.contains('ns-library-shell')&&document.querySelector('#assistant')?.classList.contains('active');
  if(ai&&!active){opened=false;document.body.style.setProperty('--ns-default-rail',Math.max(140,Math.min(240,aside.getBoundingClientRect().width||148))+'px');}
  if(ai){const status=document.querySelector('#nsStatusBar');document.body.style.setProperty('--ns-ai-top',Math.max(0,status?.getBoundingClientRect().bottom||0)+'px');}
  active=!!ai;document.body.classList.toggle('ns-ai-mode',active);document.body.classList.toggle('ns-ai-nav-open',active&&opened);
  aside.inert=active&&!opened;bar.hidden=!active;bar.textContent=opened?'‹':'›';bar.setAttribute('aria-expanded',String(opened));bar.setAttribute('aria-label',opened?'Collapse NorthStar menu':'Open NorthStar menu');bar.title=bar.getAttribute('aria-label');
  const menu=document.querySelector('#assistantWorkspace .ai-assistant-sidebar');if(menu){menu.setAttribute('popover','manual');if(active&&!opened&&!menu.matches(':popover-open'))menu.showPopover();if((!active||opened)&&menu.matches(':popover-open'))menu.hidePopover();}
  const host=document.getElementById('nsLibraryHost');if(host){const header=document.querySelector('#nsStatusBar')||document.querySelector('.page-header');host.style.left=aside.getBoundingClientRect().right+'px';host.style.top=Math.max(0,header?.getBoundingClientRect().bottom||0)+'px';}
 }
 const schedule=()=>{if(!frame)frame=requestAnimationFrame(update);};
 async function mountLibrary(){
  if(!params.has('nsLibrary'))return;
  document.body.classList.add('ns-library-shell');
  const host=document.createElement('div');host.id='nsLibraryHost';document.body.append(host);
  const shadow=host.attachShadow({mode:'open'});window.NorthstarLibraryRoot=shadow;
  shadow.innerHTML='<link rel="stylesheet" href="library.css"><style>:host{display:block;min-width:0;color:#e4edf1;font:16px/1.6 system-ui}main{margin:0;max-width:none;padding:20px 24px}.library-index{padding:20px 24px}#itemInfo{z-index:1000}</style><main id="main"><p role="status">Loading Library…</p></main>';
  const load=src=>new Promise((resolve,reject)=>{const script=document.createElement('script');script.src=src;script.onload=resolve;script.onerror=reject;document.head.append(script);});
  try{if(!window.NorthstarResearchCatalog)await load('v1-baseline-research-catalog.js');if(!window.NorthstarLibraryRender)await load('library-renderer.js');await load('library.js');}catch{shadow.getElementById('main').textContent='Library could not load. Reload to try again.';}
 }
 function start(){aside=document.querySelector('.app>aside');if(!aside)return;
  bar=document.createElement('button');bar.id='nsAiNavToggle';bar.type='button';bar.hidden=true;bar.setAttribute('aria-controls','sideNav');bar.onclick=()=>{opened=!opened;update();};document.body.append(bar);
  document.addEventListener('click',e=>{const button=e.target.closest('#sideNav [data-tab]');if(!e.isTrusted||!button||button.classList.contains('ns-demo-restricted'))return;
   if(button.dataset.tab!=='tools'&&document.body.classList.contains('ns-library-shell')){document.body.classList.remove('ns-library-shell');document.title=shellTitle;const u=new URL(location.href);['nsLibrary','item','file','q','type'].forEach(k=>u.searchParams.delete(k));history.replaceState(null,'',u);}
   schedule();
  },true);
  document.addEventListener('keydown',e=>{if(e.key==='Escape'&&active&&opened){opened=false;update();bar.focus();}});
  document.querySelectorAll('.section').forEach(s=>new MutationObserver(schedule).observe(s,{attributes:true,attributeFilter:['class']}));
  new MutationObserver(schedule).observe(document.body,{attributes:true,attributeFilter:['data-v3-section']});
  window.addEventListener('hashchange',schedule);window.addEventListener('resize',schedule);const resize=new ResizeObserver(schedule);resize.observe(aside);const header=document.querySelector('#nsStatusBar')||document.querySelector('.page-header');if(header)resize.observe(header);mountLibrary();schedule();
 }
 Promise.resolve(window.northstarOperatorSession).then(()=>{if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start);else start();});
})();
