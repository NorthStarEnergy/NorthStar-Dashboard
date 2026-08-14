'use client';

import { useEffect, useState } from 'react';

function formatSystemTime(date: Date) {
  const time = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
  const offset = -date.getTimezoneOffset() / 60;
  const sign = offset >= 0 ? '+' : '-';
  const hours = String(Math.abs(offset)).padStart(2, '0');
  return `${time} [HE ${sign} ${hours}]`;
}

const OPERATOR_CONSOLE_URL = 'https://ops.northstarenergy.ca/';

export default function Gate() {
  const [systemTime, setSystemTime] = useState(() => formatSystemTime(new Date()));

  useEffect(() => {
    const timer = window.setInterval(() => setSystemTime(formatSystemTime(new Date())), 1000);
    return () => window.clearInterval(timer);
  }, []);
  return <main className="gate"><section className="card"><div className="brand-row"><div className="brand"><img src="/northstar-symbol.png" alt="" /><span>NorthStar<small>Dashboard</small></span></div><div className="service-meta"><div className="service-status" role="status" aria-label="Dashboard service is running"><i />Service running</div><div className="system-time">{systemTime}</div></div></div><h1>NorthStar operator console</h1><p>The operator console now owns authentication.</p><a className="button" href={OPERATOR_CONSOLE_URL}>OPEN OPERATOR CONSOLE</a><div className="support-actions"><a className="support-button" href="mailto:support@northstarenergy.ca?subject=NorthStar%20username%20or%20password%20help">Forgot Username/Password</a><a className="support-button" href="mailto:support@northstarenergy.ca?subject=NorthStar%20support%20request">Contact</a></div></section></main>;
}
