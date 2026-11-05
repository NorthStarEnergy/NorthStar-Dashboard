(() => {
  'use strict';
  const grid = document.querySelector('#weatherGridFull');
  if (!grid) return;
  const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const number = (value, suffix = '°') => value!==null && value!==undefined && value!=='' && Number.isFinite(Number(value)) ? `${Math.round(Number(value))}${suffix}` : '—';
  const icon = window.NorthstarWeatherIcon;
  const condition = window.precipType;
  const hourLabel = value => new Date(value).toLocaleTimeString([], {hour:'numeric'});
  const dayLabel = (value, index) => index===0?'Today':new Date(`${value}T12:00`).toLocaleDateString([], {weekday:'short'});
  function renderLocation([name], feedLoaded) {
    const data = window.NorthstarWeatherData?.[name] || {};
    const current = data.current || {}, hourly = data.hourly || {}, daily = data.daily || {};
    const times = Array.isArray(hourly.time) ? hourly.time : [];
    const start = Math.max(0, times.findIndex(time => new Date(time).getTime() >= Date.now()));
    const code = current.weather_code ?? hourly.weather_code?.[start];
    const temperature = current.temperature_2m ?? hourly.temperature_2m?.[start];
    const status = data.current ? `${condition(code)} · Feels ${number(current.apparent_temperature ?? hourly.apparent_temperature?.[start])}` : feedLoaded ? 'Weather unavailable' : 'Loading weather…';
    return `<button class="weather-module-card" type="button" data-weather="${escapeHtml(name)}" aria-label="Open extended forecast for ${escapeHtml(name)}"><span class="weather-module-icon" aria-hidden="true">${data.current || times.length ? icon(code,current.is_day ?? hourly.is_day?.[start],current.time ?? times[start]) : '—'}</span><span class="weather-module-copy"><strong>${escapeHtml(name)}</strong><b>${number(temperature)}</b><small>${escapeHtml(status)}</small></span><span class="weather-module-dogear" aria-hidden="true"></span></button>`;
  }
  function render() {
    const places = window.NorthstarWeatherPlaces || [];
    if (!places.length) return;
    const dataCount=Object.keys(window.NorthstarWeatherData || {}).length;
    const feedLoaded=Boolean(window.NorthstarWeatherLoaded);
    const status=window.NorthstarWeatherStale?'STALE FEED':dataCount===0?(feedLoaded?'FEED UNAVAILABLE':'CONNECTING'):dataCount<places.length?'PARTIAL FEED':'LIVE FEED';
    grid.classList.add('weather-location-list-root');
    grid.innerHTML = `<div class="weather-module-list"><header class="weather-location-intro"><div><span class="weather-row-kicker">FIELD WEATHER</span><h2>Weather by location</h2><p>Select a module to open its extended field forecast.</p></div><span class="weather-feed-status">${status}</span></header><div class="weather-module-grid">${places.map(place=>renderLocation(place,feedLoaded)).join('')}</div><p class="weather-list-source">Forecast data: <a href="https://open-meteo.com/" target="_blank" rel="noreferrer">Open-Meteo</a></p></div>`;
  }
  const observer = new MutationObserver(() => {
    if ([...grid.children].some(child => child.classList.contains('weather-card'))) { window.NorthstarWeatherLoaded=true; render(); }
  });
  observer.observe(grid, {childList:true});
  grid.addEventListener('click',event=>{const button=event.target.closest('.weather-module-card');if(!button)return;event.preventDefault();if(!document.body.classList.contains('layout-edit'))window.openWeather?.(button.dataset.weather);});
  grid.addEventListener('keydown',event=>{if(document.body.classList.contains('layout-edit')&&event.key==='Enter'&&event.target.closest('.weather-module-card'))event.preventDefault();});
  render();
})();
