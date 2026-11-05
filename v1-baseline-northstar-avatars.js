/* Shared authenticated profile preference; never inferred from a game display name. */
(() => {
  'use strict';
  let catalog = [], profile = null, dialog, opener, loading, saving = false;
  const valid = id => /^classic-(?:[0-3][0-9]|4[0-4])$/.test(String(id || ''));
  const url = id => `/assets/avatars/classic/${valid(id) ? id : 'classic-00'}.png`;
  async function request(path, options = {}) {
    const response = await fetch(path, {cache:'no-store', ...options});
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || 'Avatar service unavailable.');
    return body;
  }
  function publish(next) {
    if (!valid(next.avatarId) || typeof next.actor !== 'string') throw new Error('Invalid profile response.');
    const changed = !profile || profile.avatarId !== next.avatarId || profile.actor !== next.actor;
    profile = next;
    document.querySelectorAll('[data-ns-own-avatar]').forEach(img => {img.src = url(profile.avatarId);});
    document.querySelectorAll('[data-ns-avatar-name]').forEach(el => {el.textContent = catalog.find(a => a.id === profile.avatarId)?.name || 'Classic avatar';});
    if (changed) window.dispatchEvent(new CustomEvent('northstar:avatar-change', {detail:{...profile}}));
    return profile;
  }
  async function refresh() { return publish(await request('/api/profile/avatar')); }
  async function ready() {
    if (!loading) loading = (async () => {
      const data = await request('/api/avatars');
      catalog = data.avatars.filter(a => valid(a.id));
      if (catalog.length !== 45) throw new Error('The avatar catalog could not be loaded.');
      await refresh();
      return profile;
    })().catch(error => {loading = null; throw error;});
    return loading;
  }
  async function choose(avatarId) {
    if (saving || !valid(avatarId)) return;
    saving = true;
    const status = dialog.querySelector('[role="status"]');
    status.textContent = 'Saving…';
    dialog.querySelectorAll('[data-avatar-id]').forEach(b => {b.disabled = true;});
    try {
      publish(await request('/api/profile/avatar', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({avatarId})}));
      status.textContent = 'Avatar saved across NorthStar.';
      dialog.close();
    } catch (error) { status.textContent = error.message || 'Could not save. Please try again.'; }
    finally { saving = false; dialog.querySelectorAll('[data-avatar-id]').forEach(b => {b.disabled = false;}); }
  }
  function ensureDialog() {
    if (dialog) return;
    dialog = document.createElement('dialog');
    dialog.className = 'ns-avatar-dialog';
    dialog.setAttribute('aria-labelledby','nsAvatarHeading');
    dialog.innerHTML = '<form method="dialog" class="ns-avatar-heading"><h2 id="nsAvatarHeading">Choose your avatar</h2><button aria-label="Close avatar picker">×</button></form><p>Your avatar follows your NorthStar account into chat and games.</p><div class="ns-avatar-grid" aria-label="Classic avatars"></div><p role="status" aria-live="polite"></p>';
    document.body.appendChild(dialog);
    dialog.addEventListener('close', () => opener?.focus());
    dialog.querySelector('.ns-avatar-grid').addEventListener('keydown', event => {
      const buttons = [...dialog.querySelectorAll('[data-avatar-id]')], index = buttons.indexOf(document.activeElement);
      const columns = getComputedStyle(dialog.querySelector('.ns-avatar-grid')).gridTemplateColumns.split(' ').length;
      const offsets = {ArrowLeft:-1,ArrowRight:1,ArrowUp:-columns,ArrowDown:columns};
      if (index < 0 || !(event.key in offsets || ['Home','End'].includes(event.key))) return;
      event.preventDefault();
      buttons[event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (index + offsets[event.key] + buttons.length) % buttons.length].focus();
    });
  }
  async function open(trigger) {
    ensureDialog(); opener = trigger || document.activeElement;
    dialog.querySelector('[role="status"]').textContent = 'Loading avatars…';
    if (!dialog.open) dialog.showModal();
    try {
      await ready(); await refresh();
      const grid = dialog.querySelector('.ns-avatar-grid'); grid.replaceChildren();
      for (const item of catalog) {
        const button = document.createElement('button'); button.type = 'button'; button.dataset.avatarId = item.id;
        button.title = item.name; button.setAttribute('aria-label',item.name); button.setAttribute('aria-pressed',String(item.id === profile.avatarId));
        const img = document.createElement('img'); img.src = url(item.id); img.width = 68; img.height = 46; img.alt = '';
        button.append(img); button.addEventListener('click',() => choose(item.id)); grid.append(button);
      }
      dialog.querySelector('[role="status"]').textContent = '45 original pixel avatars. Select one to save.';
      if (dialog.open) grid.querySelector('[aria-pressed="true"]')?.focus();
    } catch (error) { dialog.querySelector('[role="status"]').textContent = error.message || 'Sign in to choose an avatar.'; }
  }
  function init() {
    const account = document.querySelector('#account .account-settings-grid');
    if (account && !document.getElementById('accountAvatar')) {
      const card = document.createElement('div');card.id = 'accountAvatar';card.className = 'account-settings-card';
      card.innerHTML = '<h3>Avatar</h3><button type="button" class="ns-avatar-profile-button" data-ns-avatar-picker><img data-ns-own-avatar src="/assets/avatars/classic/classic-00.png" width="68" height="46" alt="Your avatar"><span>Choose avatar</span></button><p data-ns-avatar-name>Classic avatar</p>';
      account.append(card);
    }
    document.addEventListener('click',event => {const button = event.target.closest('[data-ns-avatar-picker]');if (button) open(button);});
    ready().catch(() => {});
  }
  window.NorthStarAvatars = {url, valid, ready, refresh, open, get profile() { return profile; }};
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();
