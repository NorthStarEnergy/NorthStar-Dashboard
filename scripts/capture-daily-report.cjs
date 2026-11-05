/* Actual provider screenshots. No synthetic weather or flow data. */
const fs = require('node:fs');
const path = require('node:path');
const cities = new Set(['lachute','smooth-rock-falls','dokis','la-sarre','fort-frances','kenora','atikokan','iroquois-falls','pont-rouge','kapuskasing']);
function validForecastDays(labels, now=new Date()) {
  const localDay=new Date(now.toLocaleString('en-US',{timeZone:'America/Toronto'}));
  localDay.setHours(0,0,0,0);
  const dates=labels.map(s=>Date.parse(s.trim()+', '+localDay.getFullYear()));
  if (localDay.getMonth()===11) for(let i=0;i<dates.length;i++)if(dates[i]<localDay.getTime()-86400000)dates[i]=Date.parse(labels[i].trim()+', '+(localDay.getFullYear()+1));
  const tomorrow=new Date(localDay);tomorrow.setDate(tomorrow.getDate()+1);
  return dates.length===5 && !dates.some(x=>!Number.isFinite(x)) && dates[0]>=localDay.getTime() && dates[0]<=tomorrow.getTime() && !dates.slice(1).some((d,i)=>Math.abs(d-dates[i]-86400000)>3600000);
}
function validate(target) {
  const u = new URL(target.url);
  const weather = cities.has(target.id) && u.hostname === 'www.theweathernetwork.com' && u.pathname === `/en/city/ca/${['lachute','la-sarre','pont-rouge'].includes(target.id)?'quebec':'ontario'}/${target.id}/current`;
  const kap = target.id === 'flow-kapuskasing' && u.href === 'https://wateroffice.ec.gc.ca/report/real_time_e.html?stn=04LF001';
  const qc = {'flow-du-nord':'040110','flow-jacques-cartier':'050801'}[target.id];
  if (u.protocol !== 'https:' || u.username || u.password || !(weather || kap || (qc && u.href === `https://www.cehq.gouv.qc.ca/suivihydro/graphique.asp?NoStation=${qc}`))) throw Error('Unapproved capture target');
}
async function unavailable(page, target, file) {
  await page.setContent('<html><body style="margin:0;background:#f5f7fa;font:24px Arial;color:#243348"><main style="padding:45px;width:850px;height:260px"><h1>Source image unavailable</h1><p id="name"></p><p>Refresh again or check the provider. No previous image has been reused.</p><small id="time"></small></main></body></html>');
  await page.locator('#name').evaluate((e,s)=>e.textContent=s,target.id);
  await page.locator('#time').evaluate((e,s)=>e.textContent=s,new Date().toISOString());
  await page.locator('main').screenshot({path:file});
}
async function fitForecast(crop) {
  await crop.locator('[data-testid="14day-date-label"]').first().evaluate(label=>{
    const row=label.parentElement.parentElement;
    const cards=[...row.children].filter(e=>e.querySelector('[data-testid="14day-date-label"]'));
    if(cards.length<5)throw Error('Forecast card structure changed');
    for(const e of row.children)if(!cards.slice(0,5).includes(e))e.style.setProperty('display','none','important');
    for(const card of cards.slice(0,5)) {
      // Compact report tiles without scaling down forecast text or artwork.
      const width=100;
      for(const [k,v] of Object.entries({'box-sizing':'border-box','padding-left':'6px','padding-right':'6px',width:width+'px','min-width':width+'px',flex:'0 0 '+width+'px',height:'auto','max-height':'none',overflow:'visible'}))card.style.setProperty(k,v,'important');
    }
    for(const [k,v] of Object.entries({display:'flex','flex-wrap':'nowrap',width:'max-content','max-width':'none',height:'auto','max-height':'none',overflow:'visible',transform:'none',padding:'8px'}))row.style.setProperty(k,v,'important');
    row.dataset.northstarForecastCrop='true';
    // Release carousel clipping all the way to the document, preserving provider content.
    for(let e=row.parentElement;e;e=e.parentElement){
      for(const [k,v] of Object.entries({overflow:'visible','max-height':'none',height:'auto',transform:'none'}))e.style.setProperty(k,v,'important');
      e.scrollLeft=0;
    }
  });
  const row=crop.locator('[data-northstar-forecast-crop="true"]');
  await row.page().evaluate(()=>document.fonts.ready);
  await row.locator('img').evaluateAll(async imgs=>{
    // Hidden days can retain unloaded lazy images; only the five captured cards matter.
    const visible=imgs.filter(i=>i.getClientRects().length && getComputedStyle(i).visibility!=='hidden');
    await Promise.all(visible.map(i=>i.decode().catch(()=>{})));
    for(const i of visible.filter(i=>!i.complete||!i.naturalWidth)){
      // The provider's decorative POP cloud sometimes returns 403. Preserve its
      // own accessible label instead of a broken-image glyph; never invent data.
      if(i.alt==='POP' && i.currentSrc==='https://j.theweathernetwork.com/icons/cloud.svg'){
        const label=document.createElement('span');label.textContent=i.alt;label.style.cssText='font:10px sans-serif;margin-right:3px;white-space:nowrap';i.replaceWith(label);
      }else throw Error('Forecast artwork has not loaded');
    }
  });
  const good=await row.evaluate(e=>{
    const r=e.getBoundingClientRect();
    const cards=[...e.children].filter(c=>getComputedStyle(c).display!=='none');
    return cards.length===5 && cards.every(c=>{
      const b=c.getBoundingClientRect();
      return b.left>=r.left && b.right<=r.right+1 && b.top>=r.top && b.bottom<=r.bottom+1 && c.scrollHeight<=c.clientHeight+1 && c.scrollWidth<=c.clientWidth+1;
    });
  });
  if(!good)throw Error('Forecast crop does not contain five complete cards');
  return row;
}
async function capture(page, target, file) {
  // Disable browser HTTP caching: the provider sets cookies on a cacheable 302,
  // then removes its query flag, which otherwise replays that same redirect.
  if(cities.has(target.id))await page.route('**/*',route=>route.continue());
  await page.goto(target.url,{waitUntil:'domcontentloaded',timeout:45000});
  if (new URL(page.url()).hostname !== new URL(target.url).hostname) throw Error('Provider redirected to another host');
  let crop, details={};
  if (cities.has(target.id)) {
    const dismiss = page.getByRole('button',{name:/Don.t ask again/i});
    if (await dismiss.count()) await dismiss.first().click({timeout:2000}).catch(()=>{});
    crop=page.locator('a[aria-labelledby="fourteen-days-widget-link"]');
    await crop.waitFor({state:'visible',timeout:25000});
    const cards=crop.locator('[data-testid="14day-date-label"]');
    if ((await cards.count())<5) throw Error('Expected at least five forecast days; provider layout changed');
    details.days=(await cards.allTextContents()).slice(0,5);
    if (!validForecastDays(details.days)) throw Error('Forecast dates are stale or nonconsecutive');
    if ((await crop.locator('[data-testid="period-temperature"]').count())<5) throw Error('Forecast temperatures not loaded');
    details.product='Five-day forecast from The Weather Network';
  } else if (target.id==='flow-kapuskasing') {
    const agree=page.getByRole('button',{name:/I Agree|Accept/i});
    if (await agree.count()) await agree.first().click();
    // Parameter changes update the plot directly. The page's Apply button resets the search form.
    await page.waitForFunction(()=>{
      const c=document.querySelector('#graph');
      return c && c.width>100 && c.getContext('2d').getImageData(0,0,c.width,c.height).data.some(v=>v>0);
    },null,{timeout:25000});
    await page.locator('#y2-type').selectOption('-1');
    await page.waitForTimeout(1800);
    const response=page.waitForResponse(r=>r.url().includes('/services/real_time_graph/json/inline?') && new URL(r.url()).searchParams.get('param1')==='6' && !new URL(r.url()).searchParams.has('param2'),{timeout:25000});
    await page.locator('#y1-type').selectOption('6');
    const data=await (await response).json();
    const samples=[...(data['6']?.provisional||[]),...(data['6']?.final||[])].filter(r=>r[1]!=null);
    if (samples.length<2) throw Error('Daily-mean discharge has insufficient data');
    details={product:'Discharge (daily mean values)',start:samples[0][0],end:samples.at(-1)[0],note:'Provider may include a flagged partial current day.'};
    if (Date.now()-Date.parse(details.end.slice(0,10)+'T00:00:00-05:00')>3*86400000) throw Error('Discharge plot is stale');
    await page.waitForTimeout(1800);
    crop=page.locator('.graph-container');
  } else {
    crop=page.locator('#highchartsContainer3');
    await crop.waitFor({state:'visible',timeout:20000});
    await page.waitForFunction(()=>{
      const c=globalThis.Highcharts?.charts.find(c=>c?.renderTo.id==='container3');
      return c && c.series.some(s=>s.points.length>1);
    },null,{timeout:20000});
    details=await page.evaluate(()=>{
      const c=Highcharts.charts.find(c=>c?.renderTo.id==='container3');
      const xs=c.series.flatMap(s=>s.points.filter(p=>p.y!==null).map(p=>p.x));
      return {product:c.title.textStr,start:new Date(Math.min(...xs)).toISOString(),end:new Date(Math.max(...xs)).toISOString()};
    });
    if (Date.parse(details.end)<Date.now()) throw Error('Provider forecast has expired');
  }
  await crop.evaluate(e=>e.scrollIntoView({block:'center'}));
  await crop.locator('img').evaluateAll(async imgs=>{await Promise.all(imgs.map(i=>i.decode().catch(()=>{})));});
  await page.waitForTimeout(800);
  if (cities.has(target.id)) {
    const row=await fitForecast(crop);
    await row.screenshot({path:file,animations:'disabled',timeout:20000});
  } else {
    await crop.evaluate(e=>{
      e.style.setProperty('max-height','none','important');
      e.style.setProperty('height',Math.ceil(Math.max(e.scrollHeight,e.getBoundingClientRect().height))+'px','important');
      e.style.setProperty('overflow','visible','important');
    });
    await crop.screenshot({path:file,animations:'disabled',timeout:20000});
  }
  return details;
}
async function main() {
  const {chromium} = require(process.env.NORTHSTAR_PLAYWRIGHT_MODULE || 'playwright');
  const input=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
  if (!Array.isArray(input.targets) || input.targets.length!==13 || new Set(input.targets.map(t=>t.id)).size!==13) throw Error('Expected thirteen unique targets');
  input.targets.forEach(validate);
  const out=path.resolve(input.output);fs.mkdirSync(out,{recursive:true});
  const browser=await chromium.launch({headless:true,channel:process.env.NORTHSTAR_BROWSER_CHANNEL || 'msedge'});
  const results=[];let cursor=0;
  try {
    await Promise.all([0,1].map(async()=>{
      const context=await browser.newContext({viewport:{width:1440,height:1100},deviceScaleFactor:1,locale:'en-CA',timezoneId:'America/Toronto'});
      try {while(cursor<input.targets.length){
        const target=input.targets[cursor++];let page=await context.newPage();
        page.setDefaultTimeout(20000);const file=path.join(out,target.id+'.png');
        const record={reportOrder:input.targets.indexOf(target),id:target.id,url:target.url,capturedAt:new Date().toISOString(),file:target.id+'.png'};
        try {
          let details;
          for(let attempt=0;attempt<2;attempt++){
            try{details=await capture(page,target,file);break;}
            catch(error){
              if(attempt || !/ERR_TOO_MANY_REDIRECTS|ERR_CONNECTION_RESET|Timeout|timeout|Forecast artwork has not loaded/.test(error.message))throw error;
              await page.close();page=await context.newPage();page.setDefaultTimeout(20000);
            }
          }
          Object.assign(record,{status:'captured',details});
        }
        catch(e){record.status='unavailable';record.message=String(e.message).slice(0,220);await page.close();page=await context.newPage();await unavailable(page,target,file);}
        results.push(record);results.sort((a,b)=>a.reportOrder-b.reportOrder);fs.writeFileSync(path.join(out,'captures.json'),JSON.stringify(results,null,2));
        await page.close();
      }} finally {await context.close();}
    }));
  } finally {await browser.close();}
  process.stdout.write(JSON.stringify({captured:results.filter(r=>r.status==='captured').length,total:results.length}));
}
if (require.main===module) main().catch(e=>{console.error(e.message);process.exitCode=1;});
module.exports={validate,validForecastDays,fitForecast};
