'use client';

import { FormEvent, useEffect, useState } from 'react';

function formatSystemTime(date: Date) {
  const time = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
  const offset = -date.getTimezoneOffset() / 60;
  return `${time} [HE ${offset >= 0 ? '+' : '-'} ${Math.abs(offset)}]`;
}

export default function Gate({ owner }: { owner: boolean }) {
  const [unlocked, setUnlocked] = useState(() => owner || (typeof window !== 'undefined' && sessionStorage.getItem('northstarAuth') === 'op'));
  const [error, setError] = useState('');
  const [systemTime, setSystemTime] = useState(() => formatSystemTime(new Date()));

  useEffect(() => {
    const timer = window.setInterval(() => setSystemTime(formatSystemTime(new Date())), 1000);
    return () => window.clearInterval(timer);
  }, []);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    if (form.get('login') === 'op' && form.get('password') === '') {
      sessionStorage.setItem('northstarAuth', 'op');
      setUnlocked(true);
    } else setError('Invalid operator login.');
  }

  if (unlocked) return <iframe className="frame" src="/legacy/dashboard.html" title="Northstar Control Room" />;
  return <main className="gate"><section className="card"><div className="brand-row"><div className="brand"><img src="/northstar-symbol.png" alt="" /><span>NorthStar<small>Dashboard</small></span></div><div className="service-meta"><div className="service-status" role="status" aria-label="Dashboard service is running"><i />Service running</div><div className="system-time">{systemTime}</div></div></div><h1>Sign in</h1><p>Enter your login details to continue.</p><form onSubmit={submit}><label>Email<input name="login" type="text" autoComplete="username" autoFocus required /></label><label>Password<input name="password" type="password" autoComplete="current-password" /></label><button type="submit">Sign in</button><div className="error" role="alert">{error}</div></form><div className="support-actions"><a href="mailto:support@northstar.local?subject=Email%20recovery">Forgot email? Recover access</a><a href="mailto:support@northstar.local?subject=Login%20help">Help with an inquiry</a></div></section></main>;
}
