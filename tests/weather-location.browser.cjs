/* Regression: weather formatting must settle instead of starving clicks in its DOM observer. */
const {chromium}=require('playwright');
const http=require('node:http'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..');
(async()=>{
 const server=http.createServer((req,res)=>{
  const target=path.resolve(root,'.'+decodeURIComponent(new URL(req.url,'http://localhost').pathname));
  if(!target.startsWith(root+path.sep)||!['.html','.js','.css','.svg','.png','.ico'].includes(path.extname(target))){res.writeHead(404);res.end();return;}
  fs.readFile(target,(error,data)=>{res.writeHead(error?404:200,{'Content-Type':{'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml'}[path.extname(target)]||'application/octet-stream'});res.end(error?'':data);});
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const browser=await chromium.launch({channel:'msedge',headless:true});
 const page=await browser.newPage({viewport:{width:1440,height:900}}),errors=[];
 page.on('pageerror',error=>errors.push(error.message));
 const times=Array.from({length:48},(_,i)=>new Date(Date.now()+(i-1)*3600000).toISOString());
 const days=Array.from({length:7},(_,i)=>new Date(Date.now()+i*86400000).toISOString().slice(0,10));
 const weather={stations:['Iroquois Falls','Atikokan','Kapuskasing','Oshawa','Toronto','Fort Frances','Dokis FN','Kenora'].map(name=>({name,current:{temperature_2m:12,weather_code:2,precipitation:0},hourly:{time:times,temperature_2m:Array(48).fill(18),apparent_temperature:Array(48).fill(17),weather_code:Array(48).fill(2),precipitation_probability:Array(48).fill(10),precipitation:Array(48).fill(0),wind_speed_10m:Array(48).fill(8),wind_direction_10m:Array(48).fill(270)},daily:{time:days,temperature_2m_max:Array(7).fill(20),temperature_2m_min:Array(7).fill(10),weather_code:Array(7).fill(2),precipitation_probability_max:Array(7).fill(10)}}))};
 await page.route('**/api/**',route=>{
  const pathname=new URL(route.request().url()).pathname;
  const fixtures={'/api/auth/session':{required:false},'/api/weather':weather,'/api/market-prices':{nodes:{},ontario:{}},'/api/checkins':[],'/api/alerts':[]};
  route.fulfill({status:pathname in fixtures?200:503,contentType:'application/json',body:JSON.stringify(fixtures[pathname]||{})});
 });
 try{
  const catalog=JSON.parse(require('node:child_process').execFileSync('python',['-c','import json,northstar_water_elevations as w; print(json.dumps(w.ElevationStore().catalog()))'],{cwd:root,encoding:'utf8'}));
  await page.route('**/api/water-elevations**',route=>{
    const url=new URL(route.request().url());
    if(url.pathname.endsWith('/catalog'))return route.fulfill({json:catalog});
    const id=url.searchParams.get('station'), location=url.searchParams.get('location');
    const ids=id?[id]:catalog.locations[location].gauges;
    return route.fulfill({json:{retrievedAt:new Date().toISOString(),stations:ids.map(id=>({...catalog.stations.find(s=>s.id===id),state:'ok',resolution:'instantaneous',readings:[{observedAt:new Date().toISOString(),waterLevelM:0,dischargeM3s:null,quality:'Provisional'}]}))}});
  });
  await page.route('https://archive-api.open-meteo.com/**',route=>route.fulfill({json:{daily:{time:['2026-09-20'],temperature_2m_max:[null],temperature_2m_min:[null],precipitation_sum:[null],weather_code:[null]}}}));
  await page.goto(`http://127.0.0.1:${server.address().port}/northstar-clean.html`);
  await page.waitForFunction(()=>window.NorthstarModules?.registry.has('weather:location:kenora'));
  assert.equal(await page.locator('iframe[data-location-src][src]').count(),0,'Pages are loaded only when selected');
  await page.locator('#sideNav [data-tab="weather"]').click();
  await page.getByRole('button',{name:'Show later forecast periods for Kenora'}).click();
  assert.equal(await page.locator('iframe[data-location-src][src]').count(),0,'Forecast paging must not navigate');
  const currentHeader=page.locator('#weatherGridFull .weather-card[data-module-id="Kenora"] > header');
  assert.equal(await currentHeader.locator('.weather-current-tile b').textContent(),'12°','Current reading must not use the 18-degree forecast');
  assert.doesNotMatch(await currentHeader.locator('.weather-current-tile').textContent(),/CURRENT WEATHER/,'Location name should lead the module before its current forecast');
  assert.equal(await currentHeader.evaluate(el=>getComputedStyle(el).borderLeftWidth),'2px');
  await page.screenshot({path:path.join(root,'outputs','weather-current-tiles.png'),fullPage:false});
  await currentHeader.click({position:{x:5,y:5}});
  const frame=page.frameLocator('[id="weather:location:kenora"] iframe');
  await frame.locator('#waterCards .gauge-card').first().waitFor();
  assert.equal(await frame.locator('#locationTitle').textContent(),'Kenora');
  assert.equal(await frame.locator('html').evaluate(el=>el.scrollWidth<=el.clientWidth),true,'Forecast tracks must scroll inside the page');
  assert.equal(await frame.locator('.gauge-card').count(),5);
  assert.match(await frame.locator('.gauge-card').first().textContent(),/0.000 m/);
  assert.match(await frame.locator('.gauge-card').first().textContent(),/Flow —/);
  await frame.locator('#weatherHistory .history-summary').waitFor();
  assert.match(await frame.locator('#weatherHistory').textContent(),/TOTAL PRECIPITATION—/);
  assert.doesNotMatch(await frame.locator('#weatherHistory').textContent(),/Clear/);
  await frame.locator('#waterRangeForm button[type="submit"]').click();
  await frame.locator('#waterHistoryRows tr').waitFor();
  assert.equal(await frame.locator('#waterCsv').isEnabled(),true);
  await frame.locator('#waterGauge').selectOption('05PE001');
  assert.equal(await frame.locator('#waterCsv').isDisabled(),true);
  await page.reload();
  await page.waitForFunction(()=>window.NorthstarModules?.registry.has('weather:location:kenora'));
  await page.locator('[data-module-tab="weather:location:kenora"]').click();
  await page.frameLocator('[id="weather:location:kenora"] iframe').locator('#waterCards .gauge-card').first().waitFor();
  for(const name of weather.stations.map(s=>s.name)){
    const id='weather:location:'+name.toLowerCase().replace(/[^a-z0-9]+/g,'-');
    await page.evaluate(id=>window.NorthstarModules.open(id),id);
    const f=page.frameLocator(`[id="${id}"] iframe`);
    await f.locator('#waterCards .gauge-card').first().waitFor();
    assert.equal(await f.locator('#locationTitle').textContent(),name);
  }
  await page.setViewportSize({width:390,height:844});
  await page.goto(`http://127.0.0.1:${server.address().port}/weather-location.html?site=Kenora`);
  await page.locator('#waterCards .gauge-card').first().waitFor();
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'Loaded mobile page must fit');
  await page.setViewportSize({width:1440,height:900});
  await page.screenshot({path:path.join(root,'outputs','location-weather-water.png'),fullPage:false});
  const standalone=await browser.newPage({viewport:{width:390,height:844}});
  await standalone.route('**/api/**',route=>route.fulfill({status:503,json:{error:'offline'}}));
  await standalone.goto(`http://127.0.0.1:${server.address().port}/weather-location.html?site=Kenora`);
  await standalone.locator('#retryWater').waitFor();
  assert.match(await standalone.locator('#weatherDetail').textContent(),/unavailable/);
  assert.equal(await standalone.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  assert.deepEqual(errors,[]);
  console.log('PASS: eight location modules, one-click open, lazy load, restored tab, zero/missing values, historical controls, CSV invalidation, independent feed failures, mobile width.');
 }finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});
