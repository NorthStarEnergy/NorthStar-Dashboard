/* Phone navigation uses existing live modules without moving or cloning their DOM. */
(() => {
  'use strict';
  const phone = matchMedia('(max-width: 700px)');
  const key = 'northstar.phone.lineup.v1';
  let api, lineup = [], current = '', shell, picker, position, options, order, areaOptions;
  let touch, lastGesture = 0;
  const title = m => api.state.modules[m.id]?.name || m.title;
  const category = m => ({ switching: 'Engineering', logbook: 'Events', mobile: 'Field tracker' }[m.section] || m.section.replace(/-/g, ' '));
  const modules = () => [...api.registry.values()].filter(m => m.el.isConnected && m.section !== 'overview');
  const selected = () => lineup.map(id => api.registry.get(id)).filter(Boolean);
  const groups = () => [...new Set(selected().map(m => m.section))];
  function save() { try { localStorage.setItem(key, JSON.stringify(lineup)); } catch {} }
  function element(tag, text, parent) {
    const el = document.createElement(tag); if (text) el.textContent = text;
    if (parent) parent.append(el); return el;
  }
  function button(text, label, parent, action) {
    const el = element('button', text, parent); el.type = 'button'; el.setAttribute('aria-label', label);
    el.addEventListener('click', action); return el;
  }
  function clearMask() {
    document.querySelectorAll('.ns-phone-path,.ns-phone-module').forEach(el => el.classList.remove('ns-phone-path', 'ns-phone-module'));
  }
  function show(id) {
    const m = api.registry.get(id); if (!m || !phone.matches) return;
    api.open(id);
    // The existing workspace decides which modules are available in this account/demo.
    if (api.state.sections[m.section]?.active !== id) {
      position.textContent = 'This module is unavailable in this view'; return;
    }
    current = id; clearMask(); m.el.classList.add('ns-phone-module');
    for (let node = m.el.parentElement; node && node !== document.body; node = node.parentElement) {
      node.classList.add('ns-phone-path');
    }
    const siblings = selected().filter(item => item.section === m.section);
    position.textContent = `${category(m)} · ${title(m)} · ${siblings.findIndex(item => item.id === id) + 1}/${siblings.length}`;
    const cats = groups(), ci = cats.indexOf(m.section), mi = siblings.findIndex(item => item.id === id);
    shell.querySelector('[data-step="up"]').disabled = ci <= 0;
    shell.querySelector('[data-step="down"]').disabled = ci >= cats.length - 1;
    shell.querySelector('[data-step="left"]').disabled = mi <= 0;
    shell.querySelector('[data-step="right"]').disabled = mi >= siblings.length - 1;
    document.querySelector('main').scrollTop = 0;
  }
  function step(axis, direction) {
    const m = api.registry.get(current); if (!m) return;
    const items = axis === 'x' ? selected().filter(item => item.section === m.section) : groups();
    const index = axis === 'x' ? items.findIndex(item => item.id === current) : items.indexOf(m.section);
    const next = items[index + direction]; if (!next) return;
    show(axis === 'x' ? next.id : selected().find(item => item.section === next).id);
  }
  function renderMenu() {
    options.replaceChildren(); order.replaceChildren(); areaOptions.replaceChildren();
    const checkins = window.NorthstarCheckins;
    const crewModule = modules().find(m => m.el.contains(document.querySelector('#crewRows')));
    if (checkins && crewModule) {
      element('h3', 'Check-in areas', areaOptions);
      const choices = element('div', '', areaOptions);
      ['All stations', ...checkins.areas].forEach(area => {
        button(area, `View check-ins: ${area}`, choices, () => {
          if (!lineup.includes(crewModule.id)) { lineup.push(crewModule.id); save(); }
          if (!document.querySelector('#siteCrewWorkspace')?.hidden) document.querySelector('#siteCrewClose')?.click();
          show(crewModule.id); checkins.select(area); picker.close();
        });
      });
    }
    modules().sort((a, b) => (category(a) + title(a)).localeCompare(category(b) + title(b))).forEach(m => {
      const label = element('label', '', options), input = element('input', '', label);
      input.type = 'checkbox'; input.value = m.id; input.checked = lineup.includes(m.id);
      input.disabled = input.checked && lineup.length === 1;
      element('span', `${category(m)} / ${title(m)}`, label);
      input.addEventListener('change', () => {
        lineup = input.checked ? [...lineup, m.id] : lineup.filter(id => id !== m.id);
        save(); if (!lineup.includes(current)) show(lineup[0]); else show(current);
        renderMenu(); options.querySelector(`input[value="${CSS.escape(m.id)}"]`)?.focus();
      });
    });
    selected().forEach((m, i) => {
      const row = element('li', '', order);
      button(`${category(m)} / ${title(m)}`, `View ${title(m)}`, row, () => { show(m.id); picker.close(); });
      [-1, 1].forEach(d => {
        const b = button(d < 0 ? '↑' : '↓', `Move ${title(m)} ${d < 0 ? 'up' : 'down'}`, row, () => {
          [lineup[i], lineup[i + d]] = [lineup[i + d], lineup[i]]; save(); renderMenu(); show(current);
          order.children[i + d]?.querySelector('button')?.focus();
        }); b.disabled = i + d < 0 || i + d >= lineup.length;
      });
    });
  }
  function scrollable(target, axis, direction) {
    for (let node = target; node && node !== document.body; node = node.parentElement) {
      const style = getComputedStyle(node);
      const pos = axis === 'x' ? node.scrollLeft : node.scrollTop;
      const size = axis === 'x' ? node.scrollWidth - node.clientWidth : node.scrollHeight - node.clientHeight;
      const overflow = axis === 'x' ? style.overflowX : style.overflowY;
      if (/(auto|scroll)/.test(overflow) && size > 2 && (direction > 0 ? pos < size - 2 : pos > 2)) return true;
    }
    return false;
  }
  function gesture(target, dx, dy, startedScrollable) {
    if (!phone.matches || picker.open || Date.now() - lastGesture < 400) return false;
    if (target.closest('input,textarea,select,button,a,canvas,iframe,[contenteditable="true"],dialog')) return false;
    const axis = Math.abs(dx) > Math.abs(dy) * 1.3 ? 'x' : 'y';
    const delta = axis === 'x' ? dx : dy;
    if (Math.abs(delta) < 45 || startedScrollable?.[axis + Math.sign(delta)] || scrollable(target, axis, Math.sign(delta))) return false;
    lastGesture = Date.now(); step(axis, Math.sign(delta)); return true;
  }
  function adapt() {
    document.body.classList.toggle('ns-phone-lineup', phone.matches);
    shell.hidden = !phone.matches;
    if (phone.matches) show(lineup.includes(current) ? current : lineup[0]);
    else { picker.close(); clearMask(); api.refresh(); }
  }
  function init() {
    api = window.NorthstarModules;
    if (!api?.registry.size) { setTimeout(init, 200); return; }
    const params = new URLSearchParams(location.search);
    if (params.has('nsModuleWindow') || params.has('nsStatusWindow')) return;
    try { const stored = JSON.parse(localStorage.getItem(key)); if (Array.isArray(stored)) lineup = [...new Set(stored)].filter(id => modules().some(m => m.id === id)); } catch {}
    if (!lineup.length) {
      const seen = new Set();
      lineup = modules().filter(m => { if (seen.has(m.section)) return false; seen.add(m.section); return true; }).map(m => m.id);
    }
    if (!lineup.length) return;
    shell = element('nav', '', document.body); shell.id = 'nsPhoneLineup'; shell.setAttribute('aria-label', 'Mobile module navigation');
    button('☰ Menu', 'Choose mobile module lineup', shell, () => { renderMenu(); picker.showModal(); });
    position = element('span', '', shell); position.setAttribute('aria-live', 'polite');
    const controls = element('div', '', shell);
    [['up','↑','Previous category','y',-1],['left','←','Previous module','x',-1],['right','→','Next module','x',1],['down','↓','Next category','y',1]].forEach(([name, text, label, axis, d]) => {
      button(text, label, controls, () => step(axis, d)).dataset.step = name;
    });
    picker = element('dialog', '', document.body); picker.id = 'nsPhonePicker'; picker.setAttribute('aria-label', 'Choose mobile module lineup');
    element('h2', 'Your mobile lineup', picker);
    element('p', 'Choose modules below. Scroll up/down between categories; swipe left/right within a category. Long content scrolls first.', picker);
    button('Done', 'Close mobile module menu', picker, () => picker.close());
    areaOptions = element('section', '', picker); areaOptions.className = 'ns-phone-checkin-areas';
    order = element('ol', '', picker); order.setAttribute('aria-label', 'Selected lineup order');
    options = element('div', '', picker); options.className = 'ns-phone-options';
    const main = document.querySelector('main');
    main.addEventListener('touchstart', e => { touch = e.touches.length === 1 ? { x: e.touches[0].clientX, y: e.touches[0].clientY, target: e.target, scrollable: Object.fromEntries(['x', 'y'].flatMap(axis => [-1, 1].map(d => [axis + d, scrollable(e.target, axis, d)]))) } : null; }, { passive: true });
    main.addEventListener('touchmove', e => {
      if (!touch || !phone.matches || picker.open || e.touches.length !== 1) return;
      const dx = touch.x - e.touches[0].clientX, dy = touch.y - e.touches[0].clientY;
      if (Math.abs(dx) > 12 && Math.abs(dx) > Math.abs(dy) * 1.3 &&
          !touch.target.closest('input,textarea,select,button,a,canvas,iframe,[contenteditable="true"],dialog') &&
          !touch.scrollable['x' + Math.sign(dx)]) e.preventDefault();
    }, { passive: false });
    main.addEventListener('touchend', e => { if (touch && e.changedTouches[0]) gesture(touch.target, touch.x - e.changedTouches[0].clientX, touch.y - e.changedTouches[0].clientY, touch.scrollable); touch = null; }, { passive: true });
    main.addEventListener('touchcancel', () => { touch = null; }, { passive: true });
    main.addEventListener('wheel', e => { if (gesture(e.target, e.deltaX, e.deltaY)) e.preventDefault(); }, { passive: false });
    phone.addEventListener('change', adapt); adapt();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
