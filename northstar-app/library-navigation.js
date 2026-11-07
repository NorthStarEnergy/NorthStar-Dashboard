/* Shared routing and availability for all dashboard presentations. */
(() => {
 'use strict';
 const params=new URLSearchParams(location.search);
 let ryanOperator=false;
 if(params.has('libraryBuild')){
  const b=['v1','v2','v3'].includes(params.get('libraryBuild'))?params.get('libraryBuild'):'v1';
  const back=document.createElement('a');back.textContent='← Library';back.href='library.html?build='+b;
  back.style.cssText='position:fixed;top:8px;right:22px;z-index:2147483647;background:#203c4b;color:#c9ebff;padding:8px 16px;border:1px solid #7298ad;border-radius:5px;font:14px system-ui';
  document.body.append(back);
 }
 if(params.has('nsModuleWindow')||params.has('nsStatusWindow')||!document.querySelector('#sideNav'))return;
 const build=()=>new URLSearchParams(location.search).get('buildView')||(location.pathname.includes('northstar-v1')?'v1':'v3');
 const library=id=>'library.html?build='+encodeURIComponent(build())+(id?'&item='+encodeURIComponent(id):'');
 document.addEventListener('click',e=>{
   const b=e.target.closest('button,a');if(!b)return;
   const ryanEngineering=ryanOperator && b.dataset.tab==='switching';
   if(b.closest('#sideNav')&&!ryanEngineering&&(b.classList.contains('ns-demo-restricted')||['switching','outages','games'].includes(b.dataset.tab))){e.preventDefault();e.stopImmediatePropagation();return;}
   const id=b.dataset.openModule||b.dataset.v3Destination;
   if(b.dataset.tab==='tools'||id==='operations:research'||id==='tools:schematic-builder'){
    e.preventDefault();e.stopImmediatePropagation();
    if(b.dataset.tab==='tools'&&new URLSearchParams(location.search).has('nsLibrary')&&(!e.isTrusted||!new URLSearchParams(location.search).has('item'))){document.querySelectorAll('#sideNav [data-tab]').forEach(n=>n.classList.toggle('active',n===b));return;}
    location.assign(library(id==='operations:research'?null:id==='tools:schematic-builder'?'schematic-builder':null));
   }
 },true);
 function update(){
  const nav=document.querySelector('#sideNav');if(!nav)return;
  const tool=nav.querySelector('[data-tab="tools"]');if(tool&&tool.textContent.trim()!=='Library'){tool.textContent='Library';tool.setAttribute('aria-label','Library');tool.classList.remove('ns-demo-partial');}
  nav.querySelectorAll('[data-open-module="operations:research"],[data-v3-destination="operations:research"]').forEach(b=>{b.hidden=true;});
  nav.querySelectorAll('.ns-demo-restricted').forEach(b=>{if(b.getAttribute('aria-disabled')!=='true')b.setAttribute('aria-disabled','true');});
 }
 function start(){update();const nav=document.querySelector('#sideNav');if(nav)new MutationObserver(update).observe(nav,{childList:true,subtree:true});
  // Existing bookmarks should land in the catalog, not the old mixed workspace.
  if(location.hash==='#tools'&&!params.has('nsLibrary'))location.replace(library());
 }
 Promise.resolve(window.northstarOperatorSession).then(session=>{
  ryanOperator=session?.role==='operator' && String(session.username||'').toLowerCase()==='ryan';
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start);else start();});
})();
