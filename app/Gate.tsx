'use client';

import { FormEvent, useEffect, useState } from 'react';

function formatSystemTime(date: Date) {
  const time = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
  const offset = -date.getTimezoneOffset() / 60;
  return `${time} [HE ${offset >= 0 ? '+' : '-'}${Math.abs(offset)}]`;
}

const OPERATOR_CONSOLE_URL = 'https://ops.northstarenergy.ca/';

export default function Gate() {
  const [systemTime, setSystemTime] = useState(() => formatSystemTime(new Date()));
  const [error, setError] = useState('');

  useEffect(() => {
    const timer = window.setInterval(() => setSystemTime(formatSystemTime(new Date())), 1000);
    return () => window.clearInterval(timer);
  }, []);
  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    if (form.get('username') === 'operator' && form.get('password') === 'operator') {
      window.location.replace(OPERATOR_CONSOLE_URL);
      return;
    }
    setError('Invalid operator credentials.');
  }

  return <main className="gate"><section className="card"><div className="brand-row"><div className="brand"><img src="/northstar-symbol.png" alt="" /><span>NorthStar<small>Dashboard</small></span></div><div className="service-meta"><div className="service-status" role="status" aria-label="Dashboard service is running"><i />Service running</div><div className="system-time">{systemTime}</div></div></div><h1>Operator sign in</h1><p>Enter the operator credentials to open the NorthStar dashboard.</p><form onSubmit={handleSubmit}><label htmlFor="username">USERNAME</label><input id="username" name="username" autoComplete="username" required /><label htmlFor="password">PASSWORD</label><input id="password" name="password" type="password" autoComplete="current-password" required /><button type="submit">OPEN DASHBOARD</button><div className="error" role="alert">{error}</div></form></section></main>;
}
