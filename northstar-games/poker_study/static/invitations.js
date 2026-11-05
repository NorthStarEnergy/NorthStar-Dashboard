/* One Games identity and invitation flow across the lobby and every game. */
(() => {
  'use strict';
  const bar = document.createElement('nav');
  bar.className = 'ns-invite-bar';
  bar.setAttribute('aria-label', 'Games account and invitations');
  bar.innerHTML = '<span data-identity>Guest</span><button type="button" data-ns-account>Account</button><button type="button" data-ns-invite>Invite</button>';
  const header = document.querySelector('.topbar');
  if (header) header.append(bar); else document.body.prepend(bar);
  const dialog = document.createElement('dialog');
  dialog.className = 'ns-invite-dialog';
  dialog.setAttribute('aria-labelledby', 'ns-invite-title');
  dialog.innerHTML = `<div class="ns-invite-heading"><h2 id="ns-invite-title">Invite to NorthStar Games</h2><button type="button" data-close aria-label="Close invitations">×</button></div>
    <p data-context></p><p data-message role="status" aria-live="polite"></p>
    <section data-landing hidden><p>Play any of the eight games as a guest. Create your own account whenever you are ready; your inviter remains your sponsor.</p><button type="button" data-join>Join as guest</button><a href="/" data-browse>Browse all games</a></section>
    <section data-auth hidden><p data-auth-note>Create a Games account or sign in to invite people.</p>
      <form data-auth-form><label>Account ID<input name="id" autocomplete="username" pattern="[A-Za-z0-9_-]{3,24}" minlength="3" maxlength="24" required></label>
      <small>3–24 letters, numbers, underscores or hyphens.</small><label>Password<input name="password" type="password" autocomplete="current-password"></label>
      <label>Player name <span>(for a new account)</span><input name="name" autocomplete="nickname" maxlength="24" placeholder="Player"></label>
      <div class="ns-invite-actions"><button type="submit" name="action" value="register">Create account</button><button type="submit" name="action" value="login">Sign in</button></div></form></section>
    <section data-manage hidden><p>Invite people to all NorthStar Games. Each person plays in their own session.</p><button type="button" data-create>Create invite link</button>
      <section data-share hidden><label>Direct link<input data-link readonly aria-label="Invitation link"></label><div class="ns-invite-actions"><a data-email>Email</a><a data-sms>Text message</a><button type="button" data-copy>Copy link</button><button type="button" data-qr-toggle aria-expanded="false">QR code</button></div>
      <figure data-qr hidden><img alt="Scan to join NorthStar Games" width="260" height="260"><figcaption>Scan with your phone camera</figcaption><a data-download download="northstar-games-invite.svg">Save QR code</a></figure><p data-expiry></p></section>
      <h3>Active invite links</h3><p>Links last 30 days. Anyone with a link can join. Revoking a link stops new joins; people already sponsored stay linked.</p><ul data-invites></ul>
      <h3 data-people-title>Your invited people</h3><p>Guests become named accounts when they sign up. Sponsorship links accounts without sharing passwords or private game saves.</p><ul data-people></ul>
      <button type="button" data-signout>Sign out</button></section>`;
  document.body.append(dialog);
  const $ = selector => dialog.querySelector(selector);
  let profile = {}, invite = null, incoming = null, opener = null, busy = false;
  const date = seconds => new Date(seconds * 1000).toLocaleDateString();
  const message = text => { $('[data-message]').textContent = text; };
  async function api(path, data) {
    const response = await fetch(path, {credentials: 'same-origin', cache: 'no-store',
      ...(data === undefined ? {} : {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(data)})});
    const value = await response.json();
    if (!response.ok) throw new Error(value.error || 'Could not complete that action. Please try again.');
    return value;
  }
  async function changeAccount(path, data) {
    if (!window.dispatchEvent(new Event('northstar:games-before-account-change', {cancelable: true}))) throw new Error('Wait for the current game action to finish, then try again.');
    try { return await api(path, data); }
    finally { window.dispatchEvent(new Event('northstar:games-account-change')); }
  }
  function identity() {
    bar.querySelector('[data-identity]').textContent = (profile.account || 'Guest') + (profile.sponsor ? ' · Sponsored by ' + profile.sponsor : '');
    bar.querySelector('[data-ns-account]').textContent = profile.account ? 'Account' : 'Sign in / Join';
  }
  function listItem(text) { const item = document.createElement('li'); item.textContent = text; return item; }
  function render() {
    identity();
    $('[data-landing]').hidden = !!(!incoming);
    $('[data-auth]').hidden = !!incoming || !!profile.account;
    $('[data-manage]').hidden = !!incoming || !profile.account;
    if (incoming) return;
    $('#ns-invite-title').textContent = 'Invite to NorthStar Games';
    $('[data-context]').textContent = profile.account ? 'Signed in as ' + profile.account + (profile.sponsor ? ' · Sponsored by ' + profile.sponsor : '') : profile.sponsor ? 'You joined as a guest of ' + profile.sponsor + '. Your new account will keep this sponsor.' : 'Play as a guest, or save your identity with a Games account.';
    $('[data-auth-note]').textContent = profile.sponsor ? 'Create your account below, or sign in to an existing account. Existing accounts keep their original sponsor.' : 'Create a Games account or sign in to invite people.';
    const links = $('[data-invites]'); links.replaceChildren();
    for (const row of profile.invites || []) {
      const li = listItem('Created ' + date(row.created_at) + ' · expires ' + date(row.expires_at) + ' ');
      const button = document.createElement('button'); button.type = 'button'; button.textContent = 'Revoke'; button.dataset.revoke = row.id; li.append(button); links.append(li);
    }
    if (!links.children.length) links.append(listItem('No active invite links.'));
    const people = $('[data-people]'); people.replaceChildren();
    $('[data-people-title]').textContent = 'Your invited people (' + (profile.people_count || 0) + ')';
    for (const person of profile.people || []) people.append(listItem(person.name + ' · ' + (person.kind === 'account' ? 'Account' : 'Guest') + ' · joined ' + date(person.joined_at)));
    if (!people.children.length) people.append(listItem('People appear here after they join through your link.'));
    if (profile.people_count > 100) people.append(listItem('Showing the 100 most recent people.'));
  }
  async function refresh() {
    const next = await api('/api/invites');
    if (profile.account !== next.account) { invite = null; $('[data-share]').hidden = true; }
    profile = next; render();
  }
  async function run(action) {
    if (busy) return;
    busy = true; dialog.setAttribute('aria-busy', 'true'); message('');
    const buttons = [...dialog.querySelectorAll('button:not([data-close])')]; buttons.forEach(b => b.disabled = true);
    try { await action(); } catch (error) { message(error.message || 'Something went wrong. Please try again.'); }
    finally { busy = false; dialog.removeAttribute('aria-busy'); buttons.forEach(b => b.disabled = false); }
  }
  function open() {
    if (!dialog.open) { opener = document.activeElement; dialog.showModal(); }
    run(refresh);
  }
  function close() { dialog.close(); }
  dialog.addEventListener('close', () => { $('[name=password]').value = ''; if (opener?.isConnected) opener.focus(); });
  document.addEventListener('click', event => {
    if (event.target.closest('[data-ns-invite], [data-ns-account]')) { event.preventDefault(); open(); }
  });
  $('[data-close]').addEventListener('click', close);
  $('[data-create]').addEventListener('click', () => run(async () => {
    invite = await api('/api/invites/create', {});
    $('[data-link]').value = invite.url;
    const body = invite.sponsor + ' invited you to NorthStar Games. Join as a guest, explore every game, and create your own account with ' + invite.sponsor + ' as your sponsor.\n\n' + invite.url;
    $('[data-email]').href = 'mailto:?subject=' + encodeURIComponent('Join me on NorthStar Games') + '&body=' + encodeURIComponent(body);
    $('[data-sms]').href = 'sms:' + (/(iPhone|iPad|iPod)/.test(navigator.userAgent) ? '&' : '?') + 'body=' + encodeURIComponent(body);
    $('[data-qr] img').src = invite.qr; $('[data-download]').href = invite.qr;
    $('[data-expiry]').textContent = 'Expires ' + date(invite.expires_at) + '. Copy this link or save the QR code to share it again later.';
    $('[data-share]').hidden = false; $('[data-qr]').hidden = true; $('[data-qr-toggle]').setAttribute('aria-expanded', 'false');
    await refresh(); $('[data-link]').focus();
  }));
  $('[data-copy]').addEventListener('click', () => run(async () => {
    try { await navigator.clipboard.writeText($('[data-link]').value); message('Invite link copied.'); }
    catch { $('[data-link]').focus(); $('[data-link]').select(); message('Select and copy the invitation link above.'); }
  }));
  $('[data-qr-toggle]').addEventListener('click', () => {
    const figure = $('[data-qr]'); figure.hidden = !figure.hidden;
    $('[data-qr-toggle]').setAttribute('aria-expanded', String(!figure.hidden));
  });
  dialog.addEventListener('click', event => {
    const button = event.target.closest('[data-revoke]');
    if (button) run(async () => {
      await api('/api/invites/revoke', {id: button.dataset.revoke});
      if (invite?.id === button.dataset.revoke) { invite = null; $('[data-share]').hidden = true; }
      await refresh(); message('Invite link revoked.');
    });
  });
  $('[data-auth-form]').addEventListener('submit', event => {
    event.preventDefault(); const action = event.submitter?.value || 'register';
    run(async () => {
      const form = new FormData(event.target);
      await changeAccount('/api/auth/' + action, {id: form.get('id'), password: form.get('password'), name: form.get('name').trim() || 'Player'});
      $('[name=password]').value = ''; await refresh(); message(action === 'register' ? 'Account created. You can play every game and invite people.' : 'Signed in.');
    });
  });
  $('[data-signout]').addEventListener('click', () => run(async () => {
    await changeAccount('/api/auth/logout', {}); await refresh(); message('Signed out. You can still play as a guest.');
  }));
  $('[data-join]').addEventListener('click', () => run(async () => {
    await api('/api/invites/accept', {token: incoming});
    sessionStorage.setItem('guestChosen', '1');
    incoming = null; history.replaceState(null, '', location.pathname + location.search);
    await refresh(); close();
  }));
  window.addEventListener('northstar:games-account-change', () => { if (!busy) refresh().catch(() => {}); });
  window.NorthStarInvites = {open};
  async function init() {
    const match = /^#invite=(.*)$/.exec(location.hash);
    if (match) {
      incoming = match[1]; opener = bar.querySelector('[data-ns-account]'); dialog.showModal();
      await run(async () => {
        await refresh();
        $('#ns-invite-title').textContent = 'You’re invited';
        $('[data-context]').textContent = 'Checking invitation…';
        try {
          const details = await api('/api/invites/preview', {token: incoming});
          $('[data-context]').textContent = details.sponsor + ' invited you to NorthStar Games. This invitation expires ' + date(details.expires_at) + '.';
        } catch (error) {
          $('[data-context]').textContent = 'This invitation is unavailable.';
          $('[data-join]').hidden = true; throw error;
        }
      });
    } else {
      try { await refresh(); } catch { bar.querySelector('[data-identity]').textContent = 'Games account'; }
    }
  }
  init();
})();
