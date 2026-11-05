const $ = (selector) => document.querySelector(selector);
const weatherCodes = {0:'Clear',1:'Mostly clear',2:'Partly cloudy',3:'Overcast',45:'Fog',48:'Fog',51:'Light drizzle',53:'Drizzle',55:'Heavy drizzle',61:'Light rain',63:'Rain',65:'Heavy rain',71:'Light snow',73:'Snow',75:'Heavy snow',80:'Showers',81:'Showers',82:'Heavy showers',95:'Thunderstorm',96:'Thunderstorm',99:'Thunderstorm'};
const iconFor = (code) => code >= 95 ? '⛈' : code >= 80 ? '🌧' : code >= 70 ? '❄' : code >= 45 ? '☁' : code >= 1 ? '⛅' : '☀';
const timeLabel = (iso) => iso ? new Date(iso).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'}) : '—';
const setMeta = (selector, text) => { $(selector).textContent = text; };

async function loadWeather() {
  try {
    const data = await fetch('/api/weather?ts='+Date.now(), {cache:'no-store'}).then(r => r.json());
    $('#weatherGrid').innerHTML = data.stations?.length ? data.stations.map(({name,current}) => `<article class="weather-card"><header><h3>${name}</h3><span class="weather-icon">${iconFor(current.weather_code)}</span></header><strong class="temperature">${Math.round(current.temperature_2m ?? 0)}°C</strong><div class="weather-detail">${weatherCodes[current.weather_code] || 'Current conditions'} · Feels ${Math.round(current.apparent_temperature ?? 0)}°C</div><div class="weather-detail">Wind ${Math.round(current.wind_speed_10m ?? 0)} km/h</div></article>`).join('') : '<div class="loading">Weather unavailable.</div>';
    setMeta('#weatherMeta', `${data.stale ? 'STALE · ' : ''}UPDATED ${timeLabel(data.updated)}`);
  } catch { $('#weatherGrid').innerHTML = '<div class="loading">Weather feed unavailable.</div>'; setMeta('#weatherMeta','UNAVAILABLE'); }
}

async function loadMarket() {
  try {
    const data = await fetch('/api/market-prices?ts='+Date.now(), {cache:'no-store'}).then(r => r.json());
    const labels = {APIROQ:'Island Falls / Iroquois Falls',M1S:'Calm Lake / Sturgeon Falls',F2B:'Fort Frances','K2M CCTS':'Kenora / Norman GS'};
    $('#marketGrid').innerHTML = Object.entries(data.nodes || {}).map(([key,node]) => `<article class="market-card"><header><span>${key}</span><em>${node.location || 'IESO node'}</em></header><strong>${node.rt == null ? '—' : '$'+Number(node.rt).toFixed(2)}</strong><small>REAL-TIME · ${timeLabel(node.rtTimestamp)}</small><div class="weather-detail">${labels[key] || ''}</div></article>`).join('') || '<div class="loading">Market feed unavailable.</div>';
    setMeta('#marketMeta', `${data.stale ? 'STALE · ' : ''}IESO · UPDATED ${timeLabel(data.updated)}`);
  } catch { $('#marketGrid').innerHTML = '<div class="loading">Market feed unavailable.</div>'; setMeta('#marketMeta','UNAVAILABLE'); }
}

async function loadStaff() {
  try {
    const rows = await fetch('/api/checkins?ts='+Date.now(), {cache:'no-store'}).then(r => r.json());
    $('#staffGrid').innerHTML = rows.length ? rows.map(row => `<article class="staff-card"><div class="staff-name">${row.name}</div><div class="staff-status status-${row.status}">${row.status.replace('-', ' ').toUpperCase()}</div><div class="staff-site">${row.site}${row.alone ? ' · WORKING ALONE' : ''}</div><div class="staff-time">LAST HEARD ${timeLabel(row.lastHeard)} · ${row.minutesSinceHeard} MIN AGO</div></article>`).join('') : '<div class="status-empty">NO ACTIVE FIELD CHECK-INS</div>';
  } catch { $('#staffGrid').innerHTML = '<div class="status-empty">FIELD STATUS UNAVAILABLE</div>'; }
}

$('#checkinForm').addEventListener('submit', async (event) => { event.preventDefault(); const reply = $('#checkinReply'); reply.textContent = 'CHECKING IN…'; const body = {name:$('#workerName').value.trim(), site:$('#workerSite').value, kind:'Ops Beta', company:'Ops Team', alone:$('#workerAlone').checked}; const response = await fetch('/api/checkins',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}); reply.textContent = response.ok ? 'CHECKED IN · STATUS IS NOW VISIBLE TO THE OPS TEAM' : 'CHECK-IN FAILED'; if(response.ok){$('#workerName').value='';$('#workerAlone').checked=false;loadStaff();} });
$('#refreshStaff').onclick = loadStaff;
async function refresh(){ await Promise.all([loadWeather(),loadMarket(),loadStaff()]); setMeta('#lastUpdate','LAST REFRESH '+new Date().toLocaleTimeString()); }
refresh(); setInterval(refresh, 30000);
