'use client';

import { useEffect, useState } from 'react';

function formatSystemTime(date: Date) {
  const time = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
  const offset = -date.getTimezoneOffset() / 60;
  return `${time} [HE ${offset >= 0 ? '+' : '-'}${Math.abs(offset)}]`;
}

const OPERATOR_CONSOLE_URL = 'https://ops.northstarenergy.ca/';

export default function Gate() {
  const [systemTime, setSystemTime] = useState(() => formatSystemTime(new Date()));

  useEffect(() => {
    const timer = window.setInterval(() => setSystemTime(formatSystemTime(new Date())), 1000);
    window.location.replace(OPERATOR_CONSOLE_URL);
    return () => window.clearInterval(timer);
  }, []);
  return <main className="gate"><section className="card"><div className="brand-row"><div className="brand"><img src="/northstar-symbol.png" alt="" /><span>NorthStar<small>Dashboard</small></span></div><div className="service-meta"><div className="service-status" role="status" aria-label="Dashboard service is running"><i />Service running</div><div className="system-time">{systemTime}</div></div></div><h1>Opening operator console</h1><p>The live dashboard is protected at the operator address.</p><a className="button" href={OPERATOR_CONSOLE_URL}>Open NorthStar Operator Console</a></section></main>;
}
