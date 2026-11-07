{
  const page = location.pathname.split('/').pop() || 'index.html';
  const target = page === 'study.html' && !location.search ? 'study.html?scenario=yard' : page + location.search;
  for (const link of document.querySelectorAll('.scenario-picker a')) {
    if (link.getAttribute('href') === target) link.setAttribute('aria-current','page');
  }
}
