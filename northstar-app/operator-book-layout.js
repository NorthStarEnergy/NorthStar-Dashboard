/* Log Book panels use the same pointer and keyboard geometry as Overview. */
window.NorthstarBookLayout = {
  mount(storagePrefix) {
    const geometry = window.NorthstarWindowLayout;
    const embedded = parent !== window;
    const panels = [...document.querySelectorAll('[data-layout-panel]')];
    const mobile = matchMedia('(max-width:760px)');
    const localBar = document.getElementById('bookLayoutToolbar');
    localBar.hidden = embedded;
    let page, key, saved = {}, draft = null, selected = null;
    const canvas = el => el.closest('.book-canvas');
    const name = el => el.dataset.layoutPanel;
    const active = () => panels.filter(el => el.closest('[data-page]') === page);

    function grid() {
      const source = embedded ? parent : window;
      window.northstarLayoutGridStep = Math.min(100,Math.max(1,Number(source.northstarLayoutGridStep) || 5));
      window.northstarLayoutSnapToGrid = source.northstarLayoutSnapToGrid !== false;
      document.body.style.setProperty('--book-grid',geometry.gridSize()+'px');
      document.body.classList.toggle('book-snapping',window.northstarLayoutSnapToGrid);
    }
    function select(panel) {
      selected?.classList.remove('book-selected');
      selected = panel;
      panel?.classList.add('book-selected');
    }
    function paint(panel) {
      const pos = (draft || saved)[name(panel)];
      panel.style.removeProperty('width');
      panel.style.removeProperty('translate');
      if (!pos) return;
      const available = canvas(panel).clientWidth;
      if (!available) return;
      if (Number.isFinite(pos.w)) panel.style.width = Math.min(available,Math.max(160,pos.w))+'px';
      const x = Math.min(Math.max(0,available-panel.offsetWidth),Math.max(0,pos.x));
      panel.style.translate = (x-panel.offsetLeft)+'px '+(Math.max(0,pos.y)-panel.offsetTop)+'px';
    }
    function render() {
      const editing = draft !== null;
      document.body.classList.toggle('book-editing',editing);
      if (embedded) parent.NorthstarBookNav?.editing(editing);
      localBar.querySelector('[data-edit]').textContent = editing ? 'Cancel' : 'Edit Layout';
      localBar.querySelectorAll('[data-tools]').forEach(el => el.hidden = !editing);
      page?.classList.toggle('book-custom',Object.keys(draft || saved).length > 0);
      for (const panel of active()) {
        paint(panel);
        for (const child of panel.children) {
          if (child.classList.contains('book-handle')) child.hidden = !editing;
          else child.inert = editing;
        }
      }
      if (!editing) select(null);
    }
    function show(view) {
      const next = document.querySelector('[data-page="'+view+'"]');
      const nextKey = storagePrefix+'.layout.'+view+(mobile.matches?'.narrow':'.wide');
      if (key !== nextKey) {
        if (draft) {draft=null;render();}
        page=next;key=nextKey;saved={};
        try {
          const parsed=JSON.parse(localStorage.getItem(key)) || {};
          for (const panel of active()) {
            const p=parsed[name(panel)];
            if (p && Number.isFinite(p.x) && Number.isFinite(p.y)) saved[name(panel)]=p;
          }
        } catch {}
      }
      render();
    }
    function command(action) {
      if (!page) return;
      if (action==='toggle' && !draft) {
        draft=structuredClone(saved);grid();render();
        active()[0]?.querySelector('.book-move').focus({preventScroll:true});
        return;
      }
      if (!draft) return;
      if (action==='reset') {draft={};render();return;}
      if (action==='save') {
        try {localStorage.setItem(key,JSON.stringify(draft));}
        catch {document.getElementById('layoutStatus').textContent='Layout could not be saved on this browser.';return;}
        saved=draft;
      }
      draft=null;render();
    }
    for (const panel of panels) {
      for (const [corner,label] of [['move','Move'],['e','Resize']]) {
        const handle=document.createElement('button');
        handle.type='button';handle.hidden=true;handle.className='book-handle book-'+(corner==='e'?'resize':'move');
        const title=label+' '+panel.querySelector('h2').textContent;
        handle.setAttribute('aria-label',title);handle.title=title+' · Drag or use arrow keys';panel.append(handle);
        handle.addEventListener('focus',()=>select(panel));
        handle.addEventListener('pointerdown',()=>{select(panel);handle.focus({preventScroll:true});});
        const box=()=>{
          const rect=panel.getBoundingClientRect(), area=canvas(panel).getBoundingClientRect();
          return {x:Math.round(rect.left-area.left),y:Math.round(rect.top-area.top),w:panel.offsetWidth,h:panel.offsetHeight};
        };
        geometry.bind(panel,handle,corner,box,next=>{
          if (!draft || !page.contains(panel)) return;
          const record={...draft[name(panel)],x:next.x,y:next.y};
          if (corner==='e') record.w=Math.max(160,Math.min(canvas(panel).clientWidth-next.x,next.w));
          draft[name(panel)]=record;page.classList.add('book-custom');paint(panel);
        },()=>!!draft,()=>{});
      }
    }
    if (embedded) {
      parent.addEventListener('northstar:layout-grid-step-change',grid);
      parent.addEventListener('northstar:layout-snap-change',grid);
    } else {
      const snap=localBar.querySelector('[data-snap]'),step=localBar.querySelector('[data-step]');
      try {snap.checked=localStorage.getItem('northstarLayoutSnapToGrid')!=='false';step.value=Number(localStorage.getItem('northstarLayoutGridStep'))||5;} catch {}
      function localGrid() {
        window.northstarLayoutGridStep=Math.max(1,Math.min(100,Math.round(Number(step.value)||5)));
        step.value=window.northstarLayoutGridStep;window.northstarLayoutSnapToGrid=snap.checked;grid();
      }
      localGrid();localBar.onchange=()=>{localGrid();try{localStorage.setItem('northstarLayoutGridStep',step.value);localStorage.setItem('northstarLayoutSnapToGrid',String(snap.checked));}catch{}};
      localBar.onclick=e=>{const b=e.target.closest('button');if(b)command(b.dataset.action);};
    }
    addEventListener('resize',()=>{if (page) show(page.dataset.page);});
    document.addEventListener('keydown',e=>{if(draft && e.key==='Escape'){e.preventDefault();command('cancel');}});
    return {show,command};
  }
};
