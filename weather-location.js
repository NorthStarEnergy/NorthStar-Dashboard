(() => {
  'use strict';
  const title = document.querySelector('#locationTitle');
  const subtitle = document.querySelector('#locationSubtitle');
  const detail = document.querySelector('#weatherDetail');
  const badge = document.querySelector('#feedBadge');
  const places = window.NorthstarWeatherPlaces || [
    ['Iroquois Falls',48.77,-80.68],['Atikokan',48.76,-91.62],['Kapuskasing',49.42,-82.43],['Oshawa',43.90,-78.86],
    ['Toronto',43.65,-79.38],['Fort Frances',48.61,-93.40],['Dokis FN',46.17,-80.04],['Kenora',49.77,-94.49]
  ];
  const requested = new URLSearchParams(location.search).get('site') || '';
  const place = places.find(([name]) => name.toLocaleLowerCase() === requested.toLocaleLowerCase());
  const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const value = (raw, suffix='') => raw!==null && raw!==undefined && raw!=='' && Number.isFinite(Number(raw)) ? `${Number(raw).toFixed(suffix===' mm'?1:0)}${suffix}` : '—';
  const icon = code => { code=Number(code); return code>=95?'⛈️':code>=71&&code<=86?'❄️':code>=51&&code<=67?'🌧️':code>=45&&code<=48?'🌫️':code===0?'☀️':code<=3?'🌤️':'☁️'; };
  const condition = code => { code=Number(code); return code>=95?'Thunderstorm':code>=71&&code<=86?'Snow':code>=51&&code<=67?'Rain':code>=45&&code<=48?'Fog':code===0?'Clear':code<=3?'Partly cloudy':'Cloudy'; };
  const dateLabel = value => new Date(`${value}T12:00`).toLocaleDateString([], {weekday:'short',month:'short',day:'numeric'});
  const stamp = value => value ? new Date(value).toLocaleString([], {dateStyle:'medium',timeStyle:'short'}) : 'Time not reported';
  const fail = message => { detail.innerHTML = `<section class="error-card"><h2>Weather details unavailable</h2><p>${escapeHtml(message)}</p><a href="northstar-clean.html#weather">Return to all locations</a></section>`; };
  function renderForecast(name, data, metadata) {
    const current = data.current || {}, hourly = data.hourly || {}, daily = data.daily || {};
    const start = Math.max(0,(hourly.time||[]).findIndex(time => new Date(time).getTime() >= Date.now()));
    const hCode = hourly.weather_code?.[start] ?? current.weather_code;
    const localDate = current.time?.slice(0,10) || new Date().toISOString().slice(0,10);
    const today = Math.max(0,(daily.time||[]).findIndex(day => day===localDate));
    const high = daily.temperature_2m_max?.[today], low = daily.temperature_2m_min?.[today];
    const windDirection = current.wind_direction_10m == null ? '—' : `${Math.round(current.wind_direction_10m)}°`;
    const hourlyCards = (hourly.time||[]).slice(start,start+24).map((time,index) => {
      const i=start+index;
      return `<article class="hour-card"><span>${escapeHtml(new Date(time).toLocaleTimeString([], {hour:'numeric'}))}</span><i aria-hidden="true">${icon(hourly.weather_code?.[i])}</i><b>${value(hourly.temperature_2m?.[i],'°')}</b><small>Feels ${value(hourly.apparent_temperature?.[i],'°')}<br>Rain ${hourly.precipitation_probability?.[i]??'—'}%</small></article>`;
    }).join('') || '<p class="source-note">Hourly forecast is not available.</p>';
    const dailyCards = (daily.time||[]).slice(0,14).map((day,index) => `<article class="day-card"><span>${escapeHtml(dateLabel(day))}</span><i aria-hidden="true">${icon(daily.weather_code?.[index])}</i><b>${value(daily.temperature_2m_max?.[index],'°')} / ${value(daily.temperature_2m_min?.[index],'°')}</b><small>Rain chance ${daily.precipitation_probability_max?.[index]??'—'}%<br>Precip ${value(daily.precipitation_sum?.[index],' mm')}</small></article>`).join('') || '<p class="source-note">Daily forecast is not available.</p>';
    title.textContent = name;
    subtitle.textContent = `${place[1].toFixed(2)}°, ${place[2].toFixed(2)}° · Updated ${stamp(metadata.updated)}`;
    badge.textContent = metadata.stale ? 'STALE SOURCE DATA' : 'LIVE FEED';
    badge.className = `feed-badge ${metadata.stale?'stale':'ready'}`;
    detail.innerHTML = `<section class="detail-card detail-grid"><div class="current-condition"><i class="icon" aria-hidden="true">${icon(hCode)}</i><div><strong>${value(current.temperature_2m ?? hourly.temperature_2m?.[start],'°')}</strong><span>${escapeHtml(condition(hCode))} · current conditions</span></div></div><div class="metric"><span>FEELS LIKE</span><strong>${value(current.apparent_temperature ?? hourly.apparent_temperature?.[start],'°')}</strong><small>Apparent temperature</small></div><div class="metric"><span>HUMIDITY</span><strong>${value(current.relative_humidity_2m ?? hourly.relative_humidity_2m?.[start],'%')}</strong><small>Relative humidity</small></div><div class="metric"><span>WIND</span><strong>${value(current.wind_speed_10m ?? hourly.wind_speed_10m?.[start],' km/h')}</strong><small>Direction ${windDirection}</small></div><div class="metric"><span>TODAY · HIGH / LOW</span><strong>${value(high,'°')} / ${value(low,'°')}</strong><small>Precip ${value(daily.precipitation_sum?.[today],' mm')}</small></div></section><section class="detail-card"><header class="section-head"><div><span class="section-label">HOUR BY HOUR</span><h2>Next 24 hours</h2></div><p>Temperature · feels like · precipitation chance</p></header><div class="hourly-scroll"><div class="hourly-grid">${hourlyCards}</div></div></section><section class="detail-card"><header class="section-head"><div><span class="section-label">EXTENDED OUTLOOK</span><h2>Next 14 days</h2></div><p>Daily high / low · precipitation · weather</p></header><div class="daily-scroll"><div class="daily-grid">${dailyCards}</div></div></section><section class="detail-card" id="weatherHistory"><header class="section-head"><div><span class="section-label">RECENT CONDITIONS</span><h2>30-day history</h2></div><p id="historyRange">Loading historical data…</p></header><div id="historyContents" class="loading-card">Fetching modeled historical weather…</div></section><section class="detail-card"><header class="section-head"><div><span class="section-label">DATA PROVENANCE</span><h2>Sources and coverage</h2></div></header><div class="source-grid"><div class="source-item"><strong>CURRENT CONDITIONS AND FORECAST</strong><span>${escapeHtml(metadata.source || 'Open-Meteo')} feed · refreshed ${escapeHtml(stamp(metadata.updated))}${metadata.stale?' · cached/stale':''}</span><a href="https://open-meteo.com/en/docs" target="_blank" rel="noreferrer">Open-Meteo Forecast API documentation ↗</a></div><div class="source-item"><strong>HISTORICAL WEATHER</strong><span>Open-Meteo Historical Weather API · modeled reanalysis values, not station-observed records.</span><a href="https://open-meteo.com/en/docs/historical-weather-api" target="_blank" rel="noreferrer">Historical API documentation ↗</a></div></div><p class="source-note">Forecast and historical values describe the selected map coordinate. They may differ from a nearby instrument reading.</p></section>`;
    loadHistory(place[1],place[2]);
  }
  async function loadHistory(latitude,longitude) {
    const box=document.querySelector('#historyContents'), range=document.querySelector('#historyRange');
    const endDate=new Date(Date.now()-5*86400000).toISOString().slice(0,10);
    const startDate=new Date(Date.parse(`${endDate}T12:00:00Z`)-29*86400000).toISOString().slice(0,10);
    const params=new URLSearchParams({latitude,longitude,start_date:startDate,end_date:endDate,daily:'weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_hours,wind_speed_10m_max',temperature_unit:'celsius',precipitation_unit:'mm',wind_speed_unit:'kmh',timezone:'auto'});
    try {
      const response=await fetch(`https://archive-api.open-meteo.com/v1/archive?${params}`);
      if(!response.ok)throw new Error(`Historical source returned ${response.status}.`);
      const payload=await response.json(), daily=payload.daily||{}, days=daily.time||[];
      if(!days.length)throw new Error('Historical data is not available for this period.');
      const valid=(daily.temperature_2m_max||[]).filter(Number.isFinite), lows=(daily.temperature_2m_min||[]).filter(Number.isFinite), rain=(daily.precipitation_sum||[]).filter(Number.isFinite), wet=rain.filter(value=>value>0).length;
      const mean=values=>values.length?values.reduce((sum,item)=>sum+item,0)/values.length:null;
      range.textContent=`${dateLabel(days[0])} – ${dateLabel(days.at(-1))} · modeled reanalysis`;
      box.className='';
      box.innerHTML=`<div class="history-summary"><div class="metric"><span>MEAN DAILY HIGH</span><strong>${value(mean(valid),'°')}</strong></div><div class="metric"><span>MEAN DAILY LOW</span><strong>${value(mean(lows),'°')}</strong></div><div class="metric"><span>TOTAL PRECIPITATION</span><strong>${value(rain.reduce((sum,item)=>sum+item,0),' mm')}</strong></div><div class="metric"><span>WET DAYS</span><strong>${wet} / ${days.length}</strong></div></div><div class="history-scroll"><table class="history-table"><thead><tr><th>DATE</th><th>WEATHER</th><th>HIGH</th><th>LOW</th><th>PRECIPITATION</th><th>WET HOURS</th><th>MAX WIND</th></tr></thead><tbody>${days.map((day,index)=>`<tr><td>${escapeHtml(dateLabel(day))}</td><td>${escapeHtml(condition(daily.weather_code?.[index]))}</td><td>${value(daily.temperature_2m_max?.[index],'°')}</td><td>${value(daily.temperature_2m_min?.[index],'°')}</td><td>${value(daily.precipitation_sum?.[index],' mm')}</td><td>${value(daily.precipitation_hours?.[index],' h')}</td><td>${value(daily.wind_speed_10m_max?.[index],' km/h')}</td></tr>`).reverse().join('')}</tbody></table></div><p class="history-note">Historical values use Open-Meteo reanalysis and can be several days behind the current date. They are modeled estimates for this coordinate, not measurements from a local station.</p>`;
    } catch(error) {
      range.textContent='Historical feed unavailable';
      box.className='loading-card'; box.textContent=error.message||'Historical data could not be loaded.';
    }
  }
  if (!place) {
    title.textContent='Location not found'; subtitle.textContent=requested?'This location is not in the weather list.':'Choose a location from the Weather section.'; badge.textContent='';
    detail.innerHTML='<section class="error-card"><h2>No matching location</h2><p>Return to the Weather section and select a location row.</p><a href="northstar-clean.html#weather">Return to all locations</a></section>';
    return;
  }
  title.textContent=place[0];
  fetch(`/api/weather?ts=${Date.now()}`,{cache:'no-store'}).then(response=>{if(!response.ok)throw new Error(`Weather feed returned ${response.status}.`);return response.json()}).then(payload=>{
    const station=(payload.stations||[]).find(item=>item.name===place[0]);
    if(!station)throw new Error('No weather data was returned for this location.');
    renderForecast(place[0],station,{source:payload.source,station:station.station,updated:payload.updated,stale:payload.stale});
  }).catch(error=>{badge.textContent='FEED UNAVAILABLE';fail(`${error.message||'Weather data could not be loaded.'} Sign in to the dashboard session, then retry.`)});
})();
