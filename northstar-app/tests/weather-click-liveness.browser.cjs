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
 const weather={stations:['Iroquois Falls','Atikokan','Kapuskasing','Oshawa','Toronto','Fort Frances','Dokis FN','Kenora'].map(name=>({name,current:{temperature_2m:18,weather_code:2,precipitation:0},hourly:{time:times,temperature_2m:Array(48).fill(18),apparent_temperature:Array(48).fill(17),weather_code:Array(48).fill(2),precipitation_probability:Array(48).fill(10),precipitation:Array(48).fill(0),wind_speed_10m:Array(48).fill(8),wind_direction_10m:Array(48).fill(270)},daily:{time:days,temperature_2m_max:Array(7).fill(20),temperature_2m_min:Array(7).fill(10),weather_code:Array(7).fill(2),precipitation_probability_max:Array(7).fill(10)}}))};
 await page.route('**/api/**',route=>{
  const pathname=new URL(route.request().url()).pathname;
  const fixtures={'/api/auth/session':{required:false},'/api/weather':weather,'/api/market-prices':{nodes:{},ontario:{}},'/api/checkins':[],'/api/alerts':[]};
  route.fulfill({status:pathname in fixtures?200:503,contentType:'application/json',body:JSON.stringify(fixtures[pathname]||{})});
 });
 try{
  await page.goto(`http://127.0.0.1:${server.address().port}/northstar-clean.html`);
  await page.waitForFunction(()=>document.querySelector('#weatherStrip .weather-wind')?.textContent.startsWith('Wind ')===false);
  await page.waitForFunction(()=>document.querySelector('#weatherStrip .weather-card[data-ns-weather-forecast-bound]'));
  const card=page.locator('#weatherStrip .weather-card').first();
  assert.equal(await card.getAttribute('data-module-id'),'Iroquois Falls');
  assert.equal(await page.evaluate(()=>typeof window.openWeather),'function');
  await card.hover();await page.waitForTimeout(800);
  assert.equal(await page.locator('#weatherDialog').isVisible(),false,'Weather hover does not open the forecast dialog');
  await card.click();
  assert.equal(await page.locator('#weatherDialog').isVisible(),true,'Weather click opens the shared extended forecast dialog');
  assert.equal(await page.locator('#weatherDialog .dialog-head h2').textContent(),await card.getAttribute('data-module-id'));
  assert.equal(await page.locator('#weatherDialog > .ns-hover-window-bar').count(),1,'Weather forecast uses the shared popup toolbar');
  assert.equal(await page.locator('#weatherDialog .dialog-close').count(),0,'Weather forecast has no duplicate inline close button');
  const toolbar=page.locator('#weatherDialog > .ns-hover-window-bar');
  await toolbar.hover({position:{x:80,y:12}});
  await page.mouse.down();await page.mouse.move(180,110,{steps:4});await page.mouse.up();
  const moved=await page.locator('#weatherDialog').evaluate(el=>({left:el.style.left,top:el.style.top}));
  assert.notEqual(moved.left,'','Dragging the weather toolbar sets the dialog left position');
  assert.notEqual(moved.top,'','Dragging the weather toolbar sets the dialog top position');
  await page.locator('#weatherDialog .ns-hover-window-bar button').click();
  await page.locator('#sideNav [data-tab="tools"]').click();
  await page.waitForFunction(()=>document.querySelector('#tools')?.classList.contains('active'));
  await page.locator('#sideNav [data-tab="weather"]').click();
  await page.waitForFunction(()=>document.querySelector('#weather')?.classList.contains('active'));
  const tiles=await page.locator('#weatherGridFull>.weather-card').first().evaluate(card=>{
   const rect=element=>element.getBoundingClientRect();
   const first=rect(card.querySelector('header')),forecast=[...card.querySelectorAll('.periods .period')].map(rect);
   return {first:first.width,forecast:forecast.map(tile=>({width:tile.width,height:tile.height,left:tile.left}))};
  });
  assert.ok(tiles.first>tiles.forecast[0].width,'Main station tile keeps its larger width');
  assert.ok(tiles.forecast.every(tile=>tile.width>=114&&tile.width<=118&&tile.height===160),'Forecast tiles match the compact reference size');
  assert.ok(tiles.forecast.slice(1).every((tile,i)=>tile.left-(tiles.forecast[i].left+tiles.forecast[i].width)<=3),'Forecast tiles have minimal horizontal spacing');
  assert.deepEqual(errors,[]);
  console.log('Weather observer settles and dashboard clicks remain responsive.');
 }finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});
