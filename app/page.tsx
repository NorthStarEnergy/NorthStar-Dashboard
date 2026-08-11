'use client';

import { FormEvent, useState } from 'react';

export default function Home() {
  const [unlocked, setUnlocked] = useState(false);
  const [error, setError] = useState('');

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    if (form.get('login') === 'operator' && form.get('password') === 'operator') {
      sessionStorage.setItem('northstarAuth', 'operator');
      setUnlocked(true);
    } else setError('Invalid operator credentials.');
  }

  if (unlocked) return <iframe className="frame" src="/legacy/dashboard.html" title="Northstar Control Room" />;
  return <main className="gate"><section className="card"><div className="mark">◈</div><p className="kicker">NORTHSTAR CONTROL ROOM</p><h1>Operator sign in</h1><p>Enter the operator credentials to continue.</p><form onSubmit={submit}><label>Login<input name="login" autoComplete="username" required /></label><label>Password<input name="password" type="password" autoComplete="current-password" required /></label><button type="submit">ENTER DASHBOARD</button><div className="error" role="alert">{error}</div></form></section></main>;
}
