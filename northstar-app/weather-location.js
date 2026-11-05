(() => {
  'use strict';
  const title = document.querySelector('#locationTitle');
  const subtitle = document.querySelector('#locationSubtitle');
  const detail = document.querySelector('#weatherDetail');
  const badge = document.querySelector('#feedBadge');
  const rangeControls = document.querySelector('.weather-range-controls');
  let selectedRange = '24h', refreshDaily = () => {};
  const setWeatherRange = range => { selectedRange = range; refreshDaily(true); const root=document.querySelector('#weatherDetail'); root?.classList.remove('weather-detail-range-24h','weather-detail-range-7d','weather-detail-range-14d'); root?.classList.add(`weather-detail-range-${range}`); rangeControls?.querySelectorAll('button').forEach(button => button.setAttribute('aria-pressed',String(button.dataset.weatherRange===range))); };
  rangeControls?.addEventListener('click',event => { const button=event.target.closest('[data-weather-range]'); if(button)setWeatherRange(button.dataset.weatherRange); });
  setWeatherRange('24h');
  const places = window.NorthstarWeatherPlaces || [
    ['Iroquois Falls',48.77,-80.68],['Atikokan',48.76,-91.62],['Kapuskasing',49.42,-82.43],['Oshawa',43.90,-78.86],
    ['Toronto',43.65,-79.38],['Fort Frances',48.61,-93.40],['Dokis FN',46.17,-80.04],['Kenora',49.77,-94.49],['Lachute',45.65,-74.33],['Lake Abitibi',48.66,-79.84]
  ];
  const requested = new URLSearchParams(location.search).get('site') || '';
  const place = places.find(([name]) => name.toLocaleLowerCase() === requested.toLocaleLowerCase());
  const providerLocations = {
    'Iroquois Falls':['ontario/iroquois-falls','iroquois-falls/p0k/54905'],
    Atikokan:['ontario/atikokan','atikokan/p0t/54893'],
    Kapuskasing:['ontario/kapuskasing','kapuskasing/p5n/54903'],
    Oshawa:['ontario/oshawa','oshawa/l1g/93358_poi'],
    Toronto:['ontario/toronto','toronto/m5h/55488'],
    'Fort Frances':['ontario/fort-frances','fort-frances/p9a/1366601'],
    'Dokis FN':['ontario/dokis','dokis-indian-reserve-no-9/p0m/2294709'],
    Kenora:['ontario/kenora','kenora/p9n/54886'],
    Lachute:['quebec/lachute','lachute/j8h/55734'],
    'Lake Abitibi':['ontario/abitibi','abitibi/p0l/3379339']
  };
  if (place) {
    const [networkLocation, accuLocation] = providerLocations[place[0]];
    const links = document.querySelectorAll('.weather-source-links a');
    links[0].href = `https://www.theweathernetwork.com/en/city/ca/${networkLocation}/current`;
    links[1].href = `https://weather.gc.ca/en/location/index.html?coords=${encodeURIComponent(`${place[1]},${place[2]}`)}`;
    const [accuSlug, accuPostal, accuId] = accuLocation.split('/');
    links[2].href = `https://www.accuweather.com/en/ca/${accuSlug}/${accuPostal}/weather-forecast/${accuId}`;
    if (place[0] === 'Lake Abitibi') {
      links[0].title = links[2].title = 'Nearby Abitibi forecast for Lake Abitibi';
    }
  }
  const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const value = (raw, suffix='') => raw!==null && raw!==undefined && raw!=='' && Number.isFinite(Number(raw)) ? `${Number(raw).toFixed(suffix.trim()==='mm'?1:0)}${suffix.trim()==='mm'?'mm':suffix}` : '—';
  const icon = window.NorthstarWeatherIcon;
  const condition = code => { if(code==null || code==='')return 'Not reported'; code=Number(code); return code>=95?'Thunderstorm':code>=71&&code<=86?'Snow':code>=51&&code<=67?'Rain':code>=45&&code<=48?'Fog':code===0?'Clear':code<=3?'Partly cloudy':'Cloudy'; };
  const dateLabel = value => new Date(`${value}T12:00`).toLocaleDateString([], {weekday:'short',month:'short',day:'numeric'});
  const stamp = value => value ? new Date(value).toLocaleString([], {dateStyle:'medium',timeStyle:'short'}) : 'Time not reported';
  function setFeedBadge({label, state, source, updated, stationCount, error}) {
    const detail = error || `${state} · /api/weather · ${source || 'Weather provider'} · ${stationCount ?? '—'} locations · last response ${stamp(updated)}`;
    badge.className = `feed-badge ${state==='CONNECTED'?'ready':state==='STALE CACHE'?'stale':'unavailable'}`;
    badge.tabIndex = 0;
    badge.setAttribute('aria-label', `Weather API ${detail}`);
    badge.innerHTML = `${escapeHtml(label)}<span class="feed-badge-tooltip" role="tooltip"><strong>WEATHER API ${escapeHtml(state)}</strong><span>${escapeHtml(error || `/api/weather · ${source || 'Weather provider'}`)}</span><span>${escapeHtml(error ? 'Retry the weather feed from the dashboard.' : `${stationCount ?? '—'} locations · last response ${stamp(updated)}`)}</span></span>`;
  }
  const fail = message => { detail.innerHTML = `<section class="error-card"><h2>Weather details unavailable</h2><p>${escapeHtml(message)}</p><a href="northstar-clean.html#weather">Return to all locations</a></section>`; };
  function renderForecast(name, data, metadata) {
    const current = data.current || {}, hourly = data.hourly || {}, daily = data.daily || {};
    const accumulatedPrecipitation = end => {
      const endTime = Date.parse(end);
      if (!Number.isFinite(endTime)) return '1d - —<br>7d - —';
      const sum = hours => (hourly.time || []).reduce((total, time, i) => {
        const stamp = Date.parse(time), amount = Number(hourly.precipitation?.[i]);
        return stamp <= endTime && stamp > endTime - hours * 3600000 && Number.isFinite(amount) ? total + amount : total;
      }, 0);
      return `1d - ${sum(24).toFixed(1)}mm<br>7d - ${sum(168).toFixed(1)}mm`;
    };
    const start = Math.max(0,(hourly.time||[]).findIndex(time => new Date(time).getTime() >= Date.now()));
    const hCode = hourly.weather_code?.[start] ?? current.weather_code;
    const stationZone = data.timezone || ({'Kenora':'America/Winnipeg','Fort Frances':'America/Winnipeg','Atikokan':'America/Atikokan'})[name] || 'America/Toronto';
    const dateParts = new Intl.DateTimeFormat('en-CA',{timeZone:stationZone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());
    const datePart = type => dateParts.find(part=>part.type===type).value;
    const localDate = datePart('year')+'-'+datePart('month')+'-'+datePart('day');
    const days = daily.time || [];
    const today = days.indexOf(localDate);
    const firstForecast = days.findIndex(day=>day>=localDate);
    const initialDay = firstForecast < 0 ? days.length : firstForecast;
    let dayOffset = initialDay;
    const high = daily.temperature_2m_max?.[today], low = daily.temperature_2m_min?.[today];
    const windDirection = current.wind_direction_10m == null ? '—' : `${Math.round(current.wind_direction_10m)}°`;
    const hourlyCards = (hourly.time||[]).slice(start,start+24).filter((time,index) => index%2===0).map((time,index) => {
      const i=start+index*2;
      return `<article class="hour-card"><span>${escapeHtml(new Date(time).toLocaleTimeString([], {hour:'numeric'}))}</span><i aria-hidden="true">${icon(hourly.weather_code?.[i],hourly.is_day?.[i],time)}</i><b>${value(hourly.temperature_2m?.[i],'°')}</b><small>Feels ${value(hourly.apparent_temperature?.[i],'°')}<br>Precip ${hourly.precipitation_probability?.[i]??'—'}%<br>${value(hourly.precipitation?.[i],' mm')}</small></article>`;
    }).join('') || '<p class="source-note">Hourly forecast is not available.</p>';
    title.textContent = name;
    subtitle.textContent = `Updated ${stamp(metadata.updated)}`;
    subtitle.title = `Forecast coordinate ${place[1].toFixed(2)}°, ${place[2].toFixed(2)}°`;
    setFeedBadge({label:metadata.stale?'STALE SOURCE DATA':'LIVE FEED',state:metadata.stale?'STALE CACHE':'CONNECTED',source:metadata.source,updated:metadata.updated,stationCount:metadata.stationCount});
    document.querySelector('#weatherSummary').innerHTML = `<div class="current-condition"><i class="icon" aria-hidden="true">${icon(hCode,current.is_day ?? hourly.is_day?.[start],current.time ?? hourly.time?.[start])}</i><div><strong>${value(current.temperature_2m ?? hourly.temperature_2m?.[start],'°')}</strong><span>${escapeHtml(condition(hCode))} · current conditions</span><small class="precip-accumulation">${accumulatedPrecipitation(current.time ?? hourly.time?.[start])}</small></div></div><div class="metric"><span>FEELS LIKE</span><strong>${value(current.apparent_temperature ?? hourly.apparent_temperature?.[start],'°')}</strong><small>Apparent temperature</small></div><div class="metric"><span>TODAY · HIGH / LOW</span><strong>${value(high,'°')} / ${value(low,'°')}</strong><small>Precip ${value(daily.precipitation_sum?.[today],' mm')}</small></div><div class="metric"><span>HUMIDITY</span><strong>${value(current.relative_humidity_2m ?? hourly.relative_humidity_2m?.[start],'%')}</strong><small>Relative humidity</small></div><div class="metric"><span>WIND</span><strong>${value(current.wind_speed_10m ?? hourly.wind_speed_10m?.[start],' km/h')}</strong><small>Direction ${windDirection}</small></div>`;
    detail.innerHTML = `<section class="detail-card weather-hourly-card"><header class="section-head"><h2>Next 24 hours · 2-hour intervals</h2></header><div class="hourly-scroll"><div class="hourly-grid">${hourlyCards}</div></div></section><section class="detail-card"><header class="section-head"><div><h2 class="weather-forecast-heading">Extended forecast · up to 7 days</h2></div><div class="daily-controls"><p>Daily high / low · precipitation · weather</p><button type="button" class="daily-today">Today</button></div></header><div class="daily-navigation"><button type="button" class="daily-back" aria-label="Show earlier days" title="Previous day">←</button><div class="daily-scroll" tabindex="0" aria-label="Daily weather"><div class="daily-grid"></div></div><button type="button" class="daily-forward" aria-label="Show later days" title="Next day">→</button></div><p class="daily-range-label source-note" aria-live="polite"></p></section><section class="detail-card" id="weatherHistory"><header class="section-head"><div><span class="section-label">RECENT CONDITIONS</span><h2>Historical weather</h2></div><p id="historyRange">Loading historical data…</p></header><form id="weatherHistoryForm" class="data-controls"><label>From<input type="date" name="start" required></label><label>Through<input type="date" name="end" required></label><button type="submit">Load weather history</button></form><div id="historyContents" class="loading-card">Fetching modeled historical weather…</div></section><section class="detail-card"><header class="section-head"><div><span class="section-label">DATA PROVENANCE</span><h2>Sources and coverage</h2></div></header><div class="source-grid"><div class="source-item"><strong>CURRENT CONDITIONS AND FORECAST</strong><span>${escapeHtml(metadata.source || 'Open-Meteo')} feed · refreshed ${escapeHtml(stamp(metadata.updated))}${metadata.stale?' · cached/stale':''}</span><a href="https://open-meteo.com/en/docs" target="_blank" rel="noreferrer">Open-Meteo Forecast API documentation ↗</a></div><div class="source-item"><strong>HISTORICAL WEATHER</strong><span>Open-Meteo Historical Weather API · modeled reanalysis values, not station-observed records.</span><a href="https://open-meteo.com/en/docs/historical-weather-api" target="_blank" rel="noreferrer">Historical API documentation ↗</a></div></div><p class="source-note">Forecast and historical values describe the selected map coordinate. They may differ from a nearby instrument reading.</p></section>`;
    detail.querySelector('.daily-grid').closest('.detail-card').classList.add('weather-daily-card');
    const dailyScroll = detail.querySelector('.daily-scroll');
    const dailyBack = detail.querySelector('.daily-back');
    const dailyForward = detail.querySelector('.daily-forward');
    refreshDaily = (reset=false) => {
      if(reset)dayOffset=initialDay;
      const count=selectedRange==='14d'?14:7;
      const shown=days.slice(dayOffset,dayOffset+count);
      detail.querySelector('.weather-forecast-heading').textContent='Daily weather · '+count+' days';
      detail.querySelector('.daily-grid').innerHTML=shown.map((day,index)=>{
        const i=dayOffset+index;
        const label=day<localDate?'Past conditions':day===localDate?'Today':'Forecast';
        return `<article class="day-card" data-date="${escapeHtml(day)}"><span>${escapeHtml(dateLabel(day))}</span><small class="day-kind">${label}</small><i aria-hidden="true">${icon(daily.weather_code?.[i])}</i><b>${value(daily.temperature_2m_max?.[i],'°')} / ${value(daily.temperature_2m_min?.[i],'°')}</b><small>Rain ${daily.precipitation_probability_max?.[i]??'—'}%<br>Precip ${value(daily.precipitation_sum?.[i],' mm')}</small></article>`;
      }).join('') || '<p class="source-note">No forecast available for today or later. Use the left arrow to view earlier available days.</p>';
      dailyBack.disabled=dayOffset<=0;
      dailyForward.disabled=dayOffset>=days.length-1;
      detail.querySelector('.daily-today').disabled=dayOffset===initialDay;
      detail.querySelector('.daily-range-label').textContent=shown.length?dateLabel(shown[0])+' – '+dateLabel(shown.at(-1))+' · '+shown.length+' available days'+(shown.some(day=>day<localDate)?' · Past conditions are modeled data.':''): 'No current forecast in this feed.';
      dailyScroll.scrollLeft=0;
    };
    dailyBack.onclick=()=>{dayOffset=Math.max(0,dayOffset-1);refreshDaily();};
    dailyForward.onclick=()=>{dayOffset=Math.min(days.length-1,dayOffset+1);refreshDaily();};
    detail.querySelector('.daily-today').onclick=()=>refreshDaily(true);
    refreshDaily();
    const form = document.querySelector('#weatherHistoryForm');
    const end = new Date(Date.now()-5*86400000).toISOString().slice(0,10);
    form.elements.end.value=end; form.elements.end.max=end; form.elements.start.max=end;
    form.elements.start.value=new Date(Date.parse(end)-29*86400000).toISOString().slice(0,10);
    form.onsubmit=event=>{event.preventDefault();loadHistory(place[1],place[2],form.elements.start.value,form.elements.end.value);};
    loadHistory(place[1],place[2],form.elements.start.value,end);
  }
  let historyRequest=0;
  async function loadHistory(latitude,longitude,startDate,endDate) {
    const request=++historyRequest;
    const box=document.querySelector('#historyContents'), range=document.querySelector('#historyRange');
    if (!startDate || !endDate || startDate>endDate || Date.parse(endDate)-Date.parse(startDate)>365*86400000) {range.textContent='Choose an ordered range of up to 366 days.';return;}
    box.textContent='Loading modeled historical weather…';
    const params=new URLSearchParams({latitude,longitude,start_date:startDate,end_date:endDate,daily:'weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_hours,wind_speed_10m_max',temperature_unit:'celsius',precipitation_unit:'mm',wind_speed_unit:'kmh',timezone:'auto'});
    try {
      const response=await fetch(`https://archive-api.open-meteo.com/v1/archive?${params}`);
      if(!response.ok)throw new Error(`Historical source returned ${response.status}.`);
      const payload=await response.json(), daily=payload.daily||{}, days=daily.time||[];
      if(request!==historyRequest)return;
      if(!days.length)throw new Error('Historical data is not available for this period.');
      const valid=(daily.temperature_2m_max||[]).filter(Number.isFinite), lows=(daily.temperature_2m_min||[]).filter(Number.isFinite), rain=(daily.precipitation_sum||[]).filter(Number.isFinite), wet=rain.filter(value=>value>0).length;
      const mean=values=>values.length?values.reduce((sum,item)=>sum+item,0)/values.length:null;
      range.textContent=`${dateLabel(days[0])} – ${dateLabel(days.at(-1))} · modeled reanalysis`;
      box.className='';
      box.innerHTML=`<div class="history-summary"><div class="metric"><span>MEAN DAILY HIGH</span><strong>${value(mean(valid),'°')}</strong></div><div class="metric"><span>MEAN DAILY LOW</span><strong>${value(mean(lows),'°')}</strong></div><div class="metric"><span>TOTAL PRECIPITATION</span><strong>${value(rain.length?rain.reduce((sum,item)=>sum+item,0):null,' mm')}</strong></div><div class="metric"><span>WET DAYS</span><strong>${rain.length?wet:'—'} / ${rain.length} reported</strong></div></div><div class="history-scroll"><table class="history-table"><thead><tr><th>DATE</th><th>WEATHER</th><th>HIGH</th><th>LOW</th><th>PRECIPITATION</th><th>WET HOURS</th><th>MAX WIND</th></tr></thead><tbody>${days.map((day,index)=>`<tr><td>${escapeHtml(dateLabel(day))}</td><td>${escapeHtml(condition(daily.weather_code?.[index]))}</td><td>${value(daily.temperature_2m_max?.[index],'°')}</td><td>${value(daily.temperature_2m_min?.[index],'°')}</td><td>${value(daily.precipitation_sum?.[index],' mm')}</td><td>${value(daily.precipitation_hours?.[index],' h')}</td><td>${value(daily.wind_speed_10m_max?.[index],' km/h')}</td></tr>`).reverse().join('')}</tbody></table></div><p class="history-note">Historical values use Open-Meteo reanalysis and can be several days behind the current date. They are modeled estimates for this coordinate, not measurements from a local station.</p>`;
    } catch(error) {
      if(request!==historyRequest)return;
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
  document.title=place[0]+' · Weather & Water · NorthStar';
  const selector=document.createElement('select');selector.setAttribute('aria-label','Location');
  selector.innerHTML=places.map(([name])=>`<option ${name===place[0]?'selected':''}>${escapeHtml(name)}</option>`).join('');
  selector.onchange=()=>{if(window.parent!==window && window.parent.NorthstarModules){window.parent.NorthstarModules.open('weather:location:'+selector.value.toLowerCase().replace(/[^a-z0-9]+/g,'-'));return;}const next=new URL(location.href);next.searchParams.set('site',selector.value);location.href=next.href;};
  document.querySelector('#locationSelect').append(selector);
  const loadForecast=()=>fetch(`/api/weather?ts=${Date.now()}`,{cache:'no-store'}).then(response=>{if(!response.ok)throw new Error(`Weather feed returned ${response.status}.`);return response.json()}).then(payload=>{
    const station=(payload.stations||[]).find(item=>item.name===place[0]);
    if(!station)throw new Error('No weather data was returned for this location.');
    renderForecast(place[0],station,{source:payload.source,station:station.station,updated:payload.updated,stale:payload.stale,stationCount:(payload.stations||[]).length});
    const forecastReady=(station.hourly?.time||[]).length>0&&(station.daily?.time||[]).length>0;
    if(!forecastReady){setFeedBadge({label:'FORECAST WARMING',state:'STALE CACHE',source:payload.source,updated:payload.updated,stationCount:(payload.stations||[]).length});setTimeout(loadForecast,10000);}
  }).catch(error=>{const message=error.message||'Weather data could not be loaded.';setFeedBadge({label:'FEED UNAVAILABLE',state:'UNAVAILABLE',error:message});fail(`${message} Sign in to the dashboard session, then retry.`)});
  loadForecast();
})();
