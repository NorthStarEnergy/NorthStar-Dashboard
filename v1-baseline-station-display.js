/* Worker tracker display is local to this dashboard or its detached window. */
(() => {
  'use strict';
  function init() {
    const root = document.querySelector('#overviewStaff');
    if (!root || !window.NorthstarFieldRoster?.mount) return;
    const detached = new URLSearchParams(location.search).get('nsStatusWindow') === '1';
    const key = detached ? 'northstarWorkerDisplayPopoutV2' : 'northstarWorkerDisplayV2';
    const storage = () => detached ? sessionStorage : localStorage;
    const list = document.createElement('section');
    list.id = 'overviewWorkerList';
    list.setAttribute('aria-label','Active Workers');
    list.hidden = true;
    root.append(list);
    const graphics = root.querySelector('#staffGroups');
    const graphicView = document.createElement('div');
    graphicView.id = 'overviewWorkerGraphic';
    graphics.before(graphicView); graphicView.append(graphics);
    let mode = 'list';
    try { if (storage().getItem(key) === 'graphical') mode = 'graphical'; } catch {}
    function set(value, persist = true) {
      if (!['graphical','list'].includes(value)) return;
      mode = value;
      root.dataset.workerDisplay = mode;
      list.hidden = mode !== 'list';
      graphicView.hidden = mode === 'list';
      graphics.inert = mode === 'list';
      window.NorthstarFieldRoster.mount(list);
      if (persist) { try { storage().setItem(key,mode); } catch {} }
      window.dispatchEvent(new CustomEvent('northstar:station-display-change',{detail:{mode}}));
    }
    window.NorthStarStationDisplay = {get:()=>mode,set};
    set(mode,false);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded',init); else init();
})();
