/* Shared navigation and editing controls; existing handlers remain attached. */
(() => {
  const items={
    overview:['Overview','M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z'],
    logbook:['Events','M7 3h10v3H7zM5 5H3v16h18V5h-2M7 11h10M7 16h7'],
    crew:['Crew check-ins','M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M16 3a4 4 0 0 1 0 8M22 21v-2a4 4 0 0 0-3-4M13 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0'],
    markets:['Markets','M3 3v18h18M6 15l4-5 4 3 6-8M16 5h4v4'],
    weather:['Weather','M7 18a5 5 0 1 1 1-10 6 6 0 0 1 11 3 4 4 0 0 1-1 7H7Z'],
    tools:['Tools','M14 6l4 4 3-3a7 7 0 0 1-9 9l-6 6-4-4 6-6a7 7 0 0 1 9-9Z'],
    flows:['Flows','M3 7c3-4 6 4 9 0s6 4 9 0M3 12c3-4 6 4 9 0s6 4 9 0M3 17c3-4 6 4 9 0s6 4 9 0'],
    switching:['Engineering','M3 3h6v6H3zM15 15h6v6h-6zM15 3h6v6h-6zM6 9v9h9M9 6h6'],
    outages:['Outages','M13 2 4 14h7l-1 8 10-12h-7Z'],
    scada:['SCADA','M3 4h18v13H3zM8 21h8M12 17v4M6 12l3-4 4 5 4-5 2 2'],
    training:['Training','M2 8l10-5 10 5-10 5ZM6 10v7l6 3 6-3v-7M22 8v8'],
    'live-status':['Live status','M2 12h5l3-8 4 16 3-8h5'],
    modules:['Modules','M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM17 14v7M14 17h7'],
    'field-operations':['Field operations','M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 1 1 16 0M15 10a3 3 0 1 1-6 0 3 3 0 0 1 6 0']
  };
  function init(){
    const nav=document.getElementById('sideNav');if(!nav)return;
    const enhance=()=>nav.querySelectorAll('button[data-tab]').forEach(button=>{
      if(button.dataset.chromeReady)return;
      button.dataset.chromeReady='true';
      const [label,path]=items[button.dataset.tab] || [button.textContent.trim(),items.modules[1]];
      [...button.childNodes].filter(node=>node.nodeType===3).forEach(node=>node.remove());
      const icon=document.createElementNS('http://www.w3.org/2000/svg','svg');icon.setAttribute('viewBox','0 0 24 24');icon.setAttribute('aria-hidden','true');icon.classList.add('nav-icon');
      const line=document.createElementNS('http://www.w3.org/2000/svg','path');line.setAttribute('d',path);icon.append(line);
      const text=document.createElement('span');text.className='nav-label';text.textContent=label;
      button.prepend(icon);button.append(text);button.title=label;button.setAttribute('aria-label',label);
    });
    enhance();new MutationObserver(enhance).observe(nav,{childList:true});
    const toolbar=document.querySelector('.layout-toolbar'),add=document.querySelector('.overview-add-module');
    if(toolbar&&add){toolbar.prepend(add);add.textContent='+ Add module';}
    if(toolbar)new ResizeObserver(()=>document.body.style.setProperty('--ns-dock-height',Math.ceil(toolbar.getBoundingClientRect().height)+'px')).observe(toolbar);
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>setTimeout(init,0));else setTimeout(init,0);
})();
