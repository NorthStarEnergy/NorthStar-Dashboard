/* Demo composition: retain the original feed anchors and operator-log handlers. */
(() => {
  'use strict';
  if (!window.NORTHSTAR_DEMO_HOME) return;
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const temperature = value => value != null && Number.isFinite(Number(value)) ? Math.round(Number(value))+'°C' : '—';
  function init() {
    const root = document.getElementById('overviewModules');
    if (!root) return;
    root.insertAdjacentHTML('beforeend', '<section id="demoWeather" class="panel" data-overview-module data-module-id="demo-weather"><header><h2>Weather</h2><small data-weather-status></small></header><div class="demo-weather-locations"></div></section><section id="demoMarket" class="panel" data-overview-module data-module-id="demo-market"><header><h2>Market price outlook</h2><small>IESO · $/MWh</small></header><div id="demoMarketChart"><nav class="demo-market-tabs" aria-label="Market price node"></nav><div class="demo-market-legend" aria-label="Market price chart legend"><span class="rt">RT IESO</span><span class="da">DA IESO</span><span class="now">NOW</span><span class="forward">UPCOMING DA</span><span class="forecast">RT FORECAST</span></div><div class="demo-market-trend-host"></div><small class="demo-market-note">RT and DA history lead to the current market time. Forecast series are shown only when their source supplies readings.</small></div></section><section id="demoRecentEvents" class="panel" data-overview-module data-module-id="demo-recent-events"><header><h2>Recent events of note</h2><button type="button" data-demo-events>All events →</button></header><div class="demo-recent-list"></div><small data-events-status></small></section>');
    const weather = document.getElementById('demoWeather');
    let local;
    function mountLocalWeather() {
      const bar=document.getElementById('nsStatusBar');
      if(bar && !document.getElementById('demoLocalWeather'))bar.insertAdjacentHTML('beforeend','<section id="demoLocalWeather" class="ns-status-module"><label>Local weather<select aria-label="Local weather location"></select></label><button type="button" data-local-forecast>—</button></section>');
      local=document.getElementById('demoLocalWeather');
    }
    let place = '';
    try { place = localStorage.getItem('northstarDemoWeatherLocation') || ''; } catch {}
    function render() {
      mountLocalWeather();
      const feeds = window.NorthstarOverview?.feeds || {};
      const stations = feeds.weather?.data?.stations || [];
      const names = stations.map(s => s.name);
      if (!names.includes(place)) place = names[0] || '';
      const options = names.map(name => `<option${name===place?' selected':''}>${esc(name)}</option>`).join('');
      const select = local?.querySelector('select');
      if (select && select.dataset.options !== options) {select.innerHTML=options || '<option>No weather feed</option>';select.dataset.options=options;}
      const station = stations.find(s=>s.name===place);
      if(local) local.querySelector('[data-local-forecast]').textContent = temperature(station?.current?.temperature_2m)+(feeds.weather?.error?' · stale':'');
      const markup = stations.map(s=>`<button type="button" data-demo-weather="${esc(s.name)}"><span>${esc(s.name)}</span><strong>${temperature(s.current?.temperature_2m)}</strong></button>`).join('') || '<p class="muted-note">Weather feed unavailable</p>';
      const list = weather.querySelector('.demo-weather-locations');
      if(list.innerHTML!==markup)list.innerHTML=markup;
      weather.querySelector('[data-weather-status]').textContent=feeds.weather?.error?'Source unavailable · last received readings':stations.length?'Select a location for forecast':'';
      const events=feeds.events?.data?.items || [];
      const news = events.map(e=>`<a href="event-detail.html?id=${encodeURIComponent(e.eventId)}"><time>${esc(e.occurredAt?new Date(e.occurredAt).toLocaleString([], {month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'}):'')}</time><strong>${esc(e.summary || e.eventType || 'Event')}</strong><small>${esc([e.site,e.source].filter(Boolean).join(' · '))}</small></a>`).join('') || '<p class="muted-note">No recent events available</p>';
      const recent = document.querySelector('.demo-recent-list');if(recent.innerHTML!==news)recent.innerHTML=news;
      document.querySelector('[data-events-status]').textContent=feeds.events?.error?'Event source unavailable': 'Recorded operational events';
      const data=window.NorthstarMarketModules?.data() || feeds.market?.data || {nodes:{}};
      const chart=document.getElementById('demoMarketChart'), host=chart.querySelector('.demo-market-trend-host');
      const nodeOrder=['IESO','APIROQ','M1S','F2B','K2M CCTS'];
      const nodes=nodeOrder.filter(key=>data.nodes?.[key]);
      if(!nodes.length)nodes.push(...Object.keys(data.nodes||{}).filter(key=>key!=='IESO').slice(0,4));
      let selected=chart.dataset.selectedNode;
      if(!nodes.includes(selected))selected=chart.dataset.selectedNode=nodes[0]||'APIROQ';
      const buttons=nodes.map(key=>`<button type="button" data-market-node="${esc(key)}" class="${key===selected?'active':''}">${esc(key)}</button>`).join('');
      const tabs=chart.querySelector('.demo-market-tabs');
      if(tabs.innerHTML!==buttons)tabs.innerHTML=buttons;
      chart.onclick=event=>{const button=event.target.closest('[data-market-node]');if(!button)return;chart.dataset.selectedNode=button.dataset.marketNode;render();};
      if(window.NorthstarMarketModules?.mountOverviewTrend)window.NorthstarMarketModules.mountOverviewTrend(host,selected);
      else window.NorthstarMarketTrends?.mount(host,data,selected,()=>window.loadMarket?.(),{kinds:['rt','da','forward','rtForecast'],compact:true,symmetricWindowHours:4,overviewWindow:true});
    }
    document.addEventListener('change',event=>{if(!event.target.matches('#demoLocalWeather select'))return;place=event.target.value;try{localStorage.setItem('northstarDemoWeatherLocation',place);}catch{}render();});
    document.addEventListener('click', event => {
      if(event.target.closest('[data-demo-field-status]') || event.target.closest('#openTrackerFromOverview')){const workerRoot=document.getElementById('mobileWorkers');const module=[...(window.NorthstarModules?.registry.values() || [])].find(m=>m.sourceSection==='mobile' && m.el.contains(workerRoot));if(module)window.NorthstarModules.open(module.id);}
      if(event.target.closest('[data-demo-events]'))document.querySelector('#sideNav [data-tab="logbook"]')?.click();
      const weatherButton=event.target.closest('[data-demo-weather]');
      if(weatherButton)window.openWeather?.(weatherButton.dataset.demoWeather);
      if(event.target.closest('[data-local-forecast]') && place)window.openWeather?.(place);
    });
    window.addEventListener('northstar:status-ready',render);
    window.addEventListener('northstar:feed-update',render);
    window.addEventListener('northstar:market-extra-update',render);
    render();
  }
  const start=()=>window.northstarStylesReady?window.northstarStylesReady.then(()=>requestAnimationFrame(init)):requestAnimationFrame(init);
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start);else start();
})();
