/* Regression: weather formatting must settle instead of starving clicks in its DOM observer. */
const {chromium}=require('playwright');
const http=require('node:http'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),assetRoot=process.env.NORTHSTAR_WEATHER_ASSET_ROOT||root;
(async()=>{
 const server=http.createServer((req,res)=>{
  const pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname),serveRoot=pathname==='/northstar-clean.html'?root:assetRoot;
  const target=path.resolve(serveRoot,'.'+pathname);
  if(!target.startsWith(serveRoot+path.sep)||!['.html','.js','.css','.svg','.png','.ico'].includes(path.extname(target))){res.writeHead(404);res.end();return;}
  fs.readFile(target,(error,data)=>{res.writeHead(error?404:200,{'Content-Type':{'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml'}[path.extname(target)]||'application/octet-stream'});res.end(error?'':data);});
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const browser=await chromium.launch({channel:'msedge',headless:true});
 const page=await browser.newPage({viewport:{width:1440,height:900}}),errors=[];
 page.on('pageerror',error=>errors.push(error.message));
 const times=Array.from({length:505},(_,i)=>new Date(Math.floor(Date.now()/3600000)*3600000+(i-168)*3600000).toISOString());
 const days=Array.from({length:14},(_,i)=>{const d=new Date();d.setHours(12,0,0,0);d.setDate(d.getDate()+i);return d.toISOString().slice(0,10)});
 const weather={stations:['Iroquois Falls','Atikokan','Kapuskasing','Oshawa','Toronto','Fort Frances','Dokis FN','Kenora','Lake Abitibi','Lachute'].map(name=>({name,current:{time:times[168],temperature_2m:12,weather_code:2,precipitation:0},hourly:{time:times,temperature_2m:Array(505).fill(18),apparent_temperature:Array(505).fill(17),weather_code:Array(505).fill(2),precipitation_probability:Array(505).fill(10),precipitation:Array(505).fill(0),wind_speed_10m:Array(505).fill(8),wind_direction_10m:Array(505).fill(270)},daily:{time:days,temperature_2m_max:Array(16).fill(20),temperature_2m_min:Array(16).fill(10),weather_code:Array(16).fill(2),precipitation_probability_max:Array(16).fill(10)}}))};
 await page.route('**/api/**',route=>{
  const pathname=new URL(route.request().url()).pathname;
  const fixtures={'/api/auth/session':{required:false},'/api/weather':weather,'/api/market-prices':{nodes:{},ontario:{}},'/api/checkins':[],'/api/alerts':[]};
  route.fulfill({status:pathname in fixtures?200:503,contentType:'application/json',body:JSON.stringify(fixtures[pathname]||{})});
 });
 try{
  const out=path.join(root,'outputs/change-coordinator/weather-precip-regression');fs.mkdirSync(out,{recursive:true});
  await page.route('https://api.open-meteo.com/**',route=>route.fulfill({json:{daily:weather.stations[0].daily}}));
  await page.goto(`http://127.0.0.1:${server.address().port}/northstar-clean.html`);
  await page.waitForFunction(()=>window.NorthstarModules?.registry.has('weather:location:kenora'));
  await page.locator('#sideNav [data-tab="weather"]').click();
  const card=page.locator('#weatherGridFull .weather-card[data-module-id="Kenora"]');
  const metrics=[];
  assert.equal(await card.locator('.weather-current-accumulation').count(),0);
  assert.equal(await card.locator('.weather-location-precipitation').count(),1);
  assert.equal(await card.locator('[data-precip-days]').count(),3);assert.deepEqual(await card.locator('[data-precip=chance]').allTextContents(),['10%','10%','10%']);assert.deepEqual(await card.locator('[data-precip=past]').allTextContents(),['0.0 mm','0.0 mm','0.0 mm']);
  const totals=await page.evaluate(()=>{
    const anchor=Date.parse('2026-10-13T12:00:00Z'),time=Array.from({length:337},(_,i)=>new Date(anchor+(i-168)*3600000).toISOString());
    const data={hourly:{time,precipitation:time.map(()=>0.5),precipitation_probability:time.map(()=>35)}};
    const result=[1,3,7].map(days=>[weatherPrecipitationTotal(data,anchor,days,false),weatherPrecipitationTotal(data,anchor,days,true),weatherPrecipitationChance(data,anchor,days)]);
    data.hourly.precipitation[170]=null; data.hourly.precipitation_probability[170]=null;
    return {result,missing:weatherPrecipitationTotal(data,anchor,1,true),missingChance:weatherPrecipitationChance(data,anchor,1),invalid:weatherPrecipitationChance(data,NaN,1)};
  });
  assert.deepEqual(totals.result,[[12,12,35],[36,36,35],[84,84,35]]);assert.equal(totals.missing,null);assert.equal(totals.missingChance,null);assert.equal(totals.invalid,null);

  for(const width of [1440,1920,390]){
    await page.setViewportSize({width,height:1000});
    await page.waitForTimeout(100);
    const m=await card.evaluate(el=>{const h=el.querySelector('header'),periods=[...el.querySelectorAll('.period')],track=el.querySelector('.periods');return {width:innerWidth,headerWidth:h.getBoundingClientRect().width,headerHeight:h.getBoundingClientRect().height,tileHeight:periods[0].getBoundingClientRect().height,gap:getComputedStyle(track).gap,rows:new Set(periods.map(p=>p.offsetTop)).size,count:periods.length,intervals:el.querySelectorAll('[data-forecast-kind="interval"]').length,pagers:el.querySelectorAll('.weather-period-back,.weather-period-forward').length,dailyIcons:el.querySelectorAll('[data-forecast-kind="day"] .weather-icon').length,precipOverflow:el.querySelector(".weather-location-precipitation").scrollWidth>el.querySelector(".weather-location-precipitation").clientWidth, rightGap:track.getBoundingClientRect().right-periods[Math.min(7,periods.length-1)].getBoundingClientRect().right, headerOverflow:h.scrollHeight>h.clientHeight,forecastOverflow:track.scrollWidth>track.clientWidth,badTiles:periods.filter(p=>p.scrollHeight>p.clientHeight||p.scrollWidth>p.clientWidth).map(p=>({text:p.textContent,width:p.clientWidth,sw:p.scrollWidth,height:p.clientHeight,sh:p.scrollHeight})),tileOverflow:periods.some(p=>p.scrollHeight>p.clientHeight||p.scrollWidth>p.clientWidth),frameFits:el.scrollHeight<=el.clientHeight,finalDay:periods.at(-1).dataset.forecastTime}});
    console.log(JSON.stringify(m));await page.screenshot({path:path.join(out,"debug-"+width+".png")});assert.ok(Math.abs(m.headerWidth-116)<1);assert.equal(m.headerHeight,127);assert.equal(m.tileHeight,62);assert.equal(m.gap,'2px');assert.equal(m.rows,2);assert.equal(m.intervals,4);assert.equal(m.pagers,0);assert.equal(m.dailyIcons,0);assert.equal(m.headerOverflow,false);assert.equal(m.precipOverflow,false);if(width>1000)assert.ok(Math.abs(m.rightGap)<2,JSON.stringify(m));assert.equal(m.forecastOverflow,false);assert.equal(m.tileOverflow,false);assert.equal(m.frameFits,true);assert.equal(m.finalDay,days.at(-1));metrics.push(m);
    if(width===390)await page.screenshot({path:path.join(out,'locations-mobile.png')});
  }
  const aggregation=await page.evaluate(()=>{
    const anchor=new Date();anchor.setMinutes(0,0,0);const start=anchor.getTime(),hours=Array.from({length:336},(_,i)=>new Date(start+i*3600000).toISOString());
    const feed={hourly:{time:hours,temperature_2m:hours.map((_,i)=>i%12),precipitation:hours.map(()=>0.2),precipitation_probability:hours.map((_,i)=>(i%12)*5)},daily:{time:Array.from({length:14},(_,i)=>{const d=new Date(start);d.setDate(d.getDate()+i);return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`}),temperature_2m_max:Array(14).fill(15),temperature_2m_min:Array(14).fill(3),precipitation_sum:Array(14).fill(2)}};
    const result=weatherLocationForecast(feed,start);feed.hourly.precipitation[1]=null;const missing=weatherLocationForecast(feed,start)[0].precip;
    return {result,missing,start};
  });
  const bins=aggregation.result.filter(s=>s.kind==='interval');assert.equal(bins.length,4);
  bins.forEach((b,i)=>{assert.equal(b.start,aggregation.start+i*12*3600000);assert.equal(b.end-b.start,12*3600000);assert.equal(b.count,12);assert.ok(Math.abs(b.precip-2.4)<1e-9);assert.equal(b.high,11);assert.equal(b.low,0);assert.equal(b.probability,55);});
  assert.equal(aggregation.missing,null);const remainder=aggregation.result[4];assert.equal(remainder.start,bins.at(-1).end);assert.equal(remainder.end,new Date(remainder.date+'T00:00').getTime()+86400000);
  await page.setViewportSize({width:1788,height:1000});await page.screenshot({path:path.join(out,'locations-two-rows.png')});
  await page.reload();await page.waitForFunction(()=>window.NorthstarModules?.registry.has('weather:location:kenora'));await page.locator('#sideNav [data-tab="weather"]').click();assert.equal(await card.locator('.period').count(),metrics[0].count);assert.equal(await card.locator('.weather-period-forward,.weather-period-back').count(),0);
  fs.writeFileSync(path.join(out,'verification.json'),JSON.stringify({metrics,aggregation,totals,reload:true,errors},null,2));
  console.log('PASS: precipitation totals/chances/missing data, current tile cleanup, right alignment; two rows, four aggregated 12h intervals, gap-free day14, no pagers, daily temp/precip only, responsive fit and reload');
 }finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});
