'use client';

import { FormEvent, useState } from 'react';

export default function Gate({ owner }: { owner: boolean }) {
  const [unlocked, setUnlocked] = useState(() => owner || (typeof window !== 'undefined' && sessionStorage.getItem('northstarAuth') === 'op'));
  const [error, setError] = useState('');

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    if (form.get('login') === 'op' && form.get('password') === '') {
      sessionStorage.setItem('northstarAuth', 'op');
      setUnlocked(true);
    } else setError('Invalid operator login.');
  }

  if (unlocked) return <iframe className="frame" src="/legacy/dashboard.html" title="Northstar Control Room" />;
  return <main className="gate"><section className="card"><div className="brand"><img src="/northstar-symbol-transparent.png" alt="" /><span>NorthStar<small>Energy</small></span></div><p className="kicker">NORTHSTAR CONTROL ROOM</p><h1>Operator sign in</h1><p>Enter your operator login to continue.</p><form onSubmit={submit}><label>Login<input name="login" autoComplete="username" autoFocus required /></label><label>Password<input name="password" type="password" autoComplete="current-password" /></label><button type="submit">ENTER DASHBOARD</button><div className="error" role="alert">{error}</div></form></section></main>;
}
