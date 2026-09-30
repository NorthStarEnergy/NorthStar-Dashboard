/* Demo composition: retain the original feed anchors and operator-log handlers. */
(() => {
  'use strict';
  if (!window.NORTHSTAR_DEMO_HOME) return;
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const temperature = value => value != null && Number.isFinite(Number(value)) ? Math.round(Number(value))+'°C' : '—';
  function init() {
    const root = document.getElementById('overviewModules');
    if (!root) return;
    root.insertAdjacentHTML('beforeend', '<section id="demoWeather" class="panel" data-overview-module data-module-id="demo-weather"><header><h2>Weather</h2><small data-weather-status></small></header><div class="demo-weather-locations"></div></section><section id="demoMarket" class="panel" data-overview-module data-module-id="demo-market"><header><h2>Market prices</h2><small>IESO / APIROQ · $/MWh</small></header><div id="demoMarketChart"></div></section><section id="demoRecentEvents" class="panel" data-overview-module data-module-id="demo-recent-events"><header><h2>Recent events of note</h2><button type="button" data-demo-events>All events →</button></header><div class="demo-recent-list"></div><small data-events-status></small></section>');
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
      const chart=document.getElementById('demoMarketChart');
      window.NorthstarMarketTrends?.mount(chart,data,'IESO',()=>window.loadMarket?.(),{compare:['APIROQ'],showBoundary:true,compact:true});
      if(chart.querySelector('canvas') && !chart.querySelector('.demo-chart-options')){
        const options=document.createElement('details');options.className='demo-chart-options';options.innerHTML='<summary>Chart filters &amp; details</summary>';
        const ranges=document.createElement('div');ranges.className='demo-chart-ranges';
        for(const [value,label] of [['6','6H'],['24','24H'],['all','RT + Forward DA']]){
          const button=document.createElement('button');button.type='button';button.textContent=label;
          button.onclick=()=>{const select=chart.querySelector('[data-setting="range"]');select.value=value;select.dispatchEvent(new Event('change',{bubbles:true}));};ranges.append(button);
        }
        chart.prepend(ranges);
        for(const selector of ['.mt-controls','.mt-dates','.mt-selectors','.mt-status','.mt-help','.mt-inspection']){const el=chart.querySelector(selector);if(el)options.append(el);}
        chart.append(options);
      }
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
