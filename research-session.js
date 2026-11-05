/* Shared research reader: use the server session without redirecting demo roles. */
(() => {
  'use strict';
  window.northstarOperatorSession = fetch('/api/auth/session', {
    credentials: 'same-origin', cache: 'no-store', headers: {Accept: 'application/json'}
  }).then(async response => {
    const session = await response.json();
    if(response.status===401 || (session.required && !session.authenticated)) {
      location.replace('/operator-login.html');
      return {required:true,authenticated:false};
    }
    if(!response.ok)throw Error('Unable to check your session. Reload Research to try again.');
    const back=document.querySelector('.research-back');
    if(back && ['platform_demo','site_viewer'].includes(session.role)) {
      back.href=session.role==='platform_demo'?'/platform-demo.html':'/demo-sites.html';
      back.textContent='← Workspace';
    }
    return session;
  }).catch(error => {
    const root=document.querySelector('[data-research-root]');
    if(root)root.textContent=error.message;
    throw error;
  });
})();
