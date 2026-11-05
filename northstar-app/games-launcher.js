(function () {
  'use strict';
  const root = document.createElement('section');
  root.id = 'games';
  root.className = 'section';
  root.innerHTML = '<article class="panel" data-module-id="games-hub"><h2>NorthStar Games</h2><p>Open the current games in a new tab.</p><p><a href="https://games.northstarenergy.ca/" target="_blank" rel="noopener noreferrer">Open Games</a></p></article>';
  const anchor = document.querySelector('#training') || document.querySelector('main .section');
  if (!anchor) return;
  anchor.parentElement.append(root);
  const nav = document.querySelector('#sideNav');
  if (nav && !nav.querySelector('[data-tab="games"]')) {
    const button = document.createElement('button');
    button.type = 'button'; button.dataset.tab = 'games'; button.textContent = 'Games';
    nav.append(button);
  }
})();
