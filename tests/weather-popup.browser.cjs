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
 const now=new Date();now.setUTCMinutes(0,0,0);const times=Array.from({length:505},(_,i)=>new Date(now.getTime()+(i-168)*3600000).toISOString());
 const days=Array.from({length:21},(_,i)=>new Date(now.getTime()+(i-7)*86400000).toISOString().slice(0,10));
 const weather={source:'MSC GeoMet',stations:['Iroquois Falls','Atikokan','Kapuskasing','Oshawa','Toronto','Fort Frances','Dokis FN','Kenora'].map(name=>({name,current:{time:now.toISOString(),temperature_2m:18,weather_code:2,precipitation:0},hourly:{time:times,temperature_2m:Array(505).fill(18),apparent_temperature:Array(505).fill(17),weather_code:Array(505).fill(2),precipitation_probability:Array(505).fill(10),precipitation:Array(505).fill(0.5),wind_speed_10m:Array(505).fill(8),wind_direction_10m:Array(505).fill(270)},daily:{time:days,precipitation_sum:Array(21).fill(12),temperature_2m_max:Array(21).fill(20),temperature_2m_min:Array(21).fill(10),weather_code:Array(21).fill(2),precipitation_probability_max:Array(21).fill(10)}}))};
 await page.route('**/api/**',route=>{
  const pathname=new URL(route.request().url()).pathname;
  const fixtures={'/api/auth/session':{required:false},'/api/weather':weather,'/api/market-prices':{nodes:{},ontario:{}},'/api/checkins':[],'/api/alerts':[]};
  route.fulfill({status:pathname in fixtures?200:503,contentType:'application/json',body:JSON.stringify(fixtures[pathname]||{})});
 });
 try{
  const out=path.join(root,'outputs/change-coordinator/weather-popup-20261013');fs.mkdirSync(out,{recursive:true});
  await page.goto(`http://127.0.0.1:${server.address().port}/northstar-clean.html`);
  await page.waitForFunction(()=>document.querySelector('#weatherStrip .weather-card[data-ns-weather-forecast-bound]'));
  const card=page.locator('#weatherStrip .weather-card').first();
  await card.click();
  const dialog=page.locator('#weatherDialog');await dialog.waitFor();
  assert.equal(await dialog.locator('[data-weather-dialog-range="7d"]').getAttribute('aria-pressed'),'true');
  const header=await dialog.evaluate(el=>{const names=[...el.querySelectorAll('.weather-precip-summary h3')].map(e=>e.firstChild.textContent.trim()),links=[...el.querySelectorAll('.weather-source-link')],css=el.querySelector('.weather-dialog-conditions h2');return {names,links:links.map(a=>({text:a.textContent,href:a.getAttribute('href')})),borders:[...el.querySelectorAll('.weather-precip-summary')].map(e=>getComputedStyle(e).borderLeftWidth),titleSize:parseFloat(getComputedStyle(css).fontSize),sizes:[...el.querySelectorAll('.weather-precip-summary h3,.weather-source-link,.weather-precip-summary small,.weather-precip-summary b')].map(e=>parseFloat(getComputedStyle(e).fontSize))}});
  assert.deepEqual(header.names,['Accumulated Precipitation','Predicted Precipitation']);assert.deepEqual(header.links.map(a=>a.text),['Source - MSC GeoMet','Source - MSC GeoMet']);assert(header.links.every(a=>a.href==='weather-location.html?site=Iroquois%20Falls'));assert(header.borders.every(border=>border==='0px'));assert(header.titleSize>=30);assert(header.sizes.every(size=>size>=15));
  const evidence=[];
  for(const width of [1440,1920,390]){
   await page.setViewportSize({width,height:1000});
   for(const range of ['hourly','48h','7d','14d']){
    await dialog.locator(`[data-weather-dialog-range="${range}"]`).click();
    const result=await dialog.evaluate(el=>{const cards=[...el.querySelectorAll('.forecast-card')],grid=el.querySelector('.forecast-window');return {width:innerWidth,range:el.querySelector('[aria-pressed=true]').dataset.weatherDialogRange,top:el.getBoundingClientRect().top,count:cards.length,rows:new Set(cards.map(c=>c.offsetTop)).size,overflow:el.scrollWidth>el.clientWidth,gridOverflow:grid.scrollWidth>grid.clientWidth,smallFont:parseFloat(getComputedStyle(cards[0].querySelector('small')).fontSize),values:[...el.querySelectorAll('[data-precip-window] b')].map(e=>e.textContent),date:cards[0].querySelector('span').textContent}});
    assert.equal(result.top,width===390?8:16);assert.equal(result.overflow,false);assert.equal(result.gridOverflow,false);
    assert.deepEqual(result.values,['12.0 mm','36.0 mm','84.0 mm','12.0 mm','36.0 mm','84.0 mm']);
    if(range==='14d'){assert.equal(result.count,14);assert.equal(result.rows,width===390?7:2);}
    if(range==='7d'){assert.equal(result.count,7);assert.ok(result.smallFont>=13);}
    evidence.push(result);
    if(width===1440&&['7d','14d'].includes(range))await page.screenshot({path:path.join(out,range+'.png')});
   }
  }
  const totals=await page.evaluate(()=>{
   const data=weatherData['Iroquois Falls'],anchor=weatherPrecipitationAnchor(data),original=data.hourly.precipitation.slice();
   const valid=weatherPrecipitationTotal(data,anchor,7,false);
   data.hourly.precipitation[168]=null;const missing=weatherPrecipitationTotal(data,anchor,1,false);
   data.hourly.precipitation=original.map(()=>0);const dry=weatherPrecipitationTotal(data,anchor,7,true);
   data.hourly.precipitation=original;const noAnchor=weatherPrecipitationTotal(data,NaN,1,false);
   const partial=weatherPrecipitationTotal({hourly:{time:data.hourly.time.slice(169),precipitation:original.slice(169)}},anchor,1,false);
   const local=weatherPrecipitationTime('2026-10-13T10:00')===Date.parse('2026-10-13T10:00Z');
   return {valid,missing,dry,noAnchor,partial,local};
  });assert.deepEqual(totals,{valid:84,missing:null,dry:0,noAnchor:null,partial:null,local:true});
  const missingDaily=await page.evaluate(()=>normalizeWeatherStation({current:{time:'2026-10-13T10:00'},daily:{time:['2026-10-13']}}).daily.precipitation_sum[0]);assert.equal(missingDaily,null);
  await page.setViewportSize({width:1440,height:1000});
  const toolbar=dialog.locator('.ns-hover-window-bar');const before=await dialog.boundingBox();
  await toolbar.hover({position:{x:100,y:12}});await page.mouse.down();await page.mouse.move(before.x+130,before.y+80,{steps:4});await page.mouse.up();
  assert.notEqual(await dialog.evaluate(el=>el.style.top),'');
  await dialog.locator('.ns-hover-window-bar button').click();await card.click();
  assert.equal((await dialog.boundingBox()).y,16);
  await page.reload();await page.waitForFunction(()=>document.querySelector('#weatherStrip .weather-card[data-ns-weather-forecast-bound]'));await card.click();
  assert.equal((await dialog.boundingBox()).y,16);
  await Promise.all([page.waitForURL(url=>url.pathname.endsWith('/weather-location.html')),dialog.locator('[data-weather-station]').click()]);
  assert.equal(new URL(page.url()).searchParams.get('site'),'Iroquois Falls');
  assert.equal(await page.locator('#locationTitle').textContent(),'Iroquois Falls','station title opens its full weather page');
  fs.writeFileSync(path.join(out,'verification.json'),JSON.stringify({evidence,totals,pageErrors:errors},null,2));
  assert.deepEqual(errors,[]);console.log('PASS popup carousel, stable positions, persistent totals, two rows, larger text, missing/zero data, reload and site navigation');
 }finally{await browser.close();server.closeAllConnections();server.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
