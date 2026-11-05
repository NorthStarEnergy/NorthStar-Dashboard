(function () {
  'use strict';
  function addLink() {
    if (!window.northstarOperatorSession) return;
    window.northstarOperatorSession.then(function (session) {
      if (!session || session.role !== 'operator' || String(session.username || '').toLowerCase() !== 'ryan') return;
      var panel = document.querySelector('#scada .scada-panel');
      if (!panel || document.getElementById('scada-workbench-link')) return;
      var link = document.createElement('a');
      link.id = 'scada-workbench-link';
      link.className = 'primary-btn';
      link.href = '/scada-workbench/';
      link.textContent = 'OPEN SCADA BENCH';
      panel.appendChild(link);
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', addLink); else addLink();
}());
