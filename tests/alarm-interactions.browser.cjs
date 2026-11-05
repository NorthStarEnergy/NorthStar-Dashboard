/* Read-only browser coverage for the shared fixed dashboard, Event Log, and popout alarm actions. */
const {chromium}=require('playwright');
const http=require('node:http'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..');

(async()=>{
  const server=http.createServer((req,res)=>{
    const file=path.resolve(root,'.'+new URL(req.url,'http://localhost').pathname);
    if(!file.startsWith(root+path.sep)||!['.html','.js','.css','.svg','.png','.ico'].includes(path.extname(file))){res.writeHead(404);return res.end();}
    fs.readFile(file,(error,data)=>{res.writeHead(error?404:200,{'Content-Type':{'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml'}[path.extname(file)]||'application/octet-stream'});res.end(error?'':data);});
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const browser=await chromium.launch({channel:'msedge',headless:true}).catch(()=>chromium.launch({headless:true}));
  const context=await browser.newContext({viewport:{width:1440,height:1000}});
  const now=new Date().toISOString();
  const alarms=[
    {eventId:'fixture-crit',aggregateType:'price_alert',aggregateId:'fixture-market',occurredAt:now,summary:'Critical breaker trip',site:'Iroquois Falls',severity:'critical',source:'SCADA',category:'alarm',status:'active',payload:{details:'Breaker tripped during fixture.'}},
    {eventId:'fixture-warn',occurredAt:now,summary:'Pond level rising',site:'Atikokan',severity:'warning',source:'Hydrometric',category:'alarm',status:'open',payload:{details:'Water level fixture warning.'}},
    {eventId:'fixture-info',occurredAt:now,summary:'Operator note filed',site:'Toronto',severity:'info',source:'logbook',category:'log',status:'',payload:{}}
  ];
  const fixture={
    '/api/auth/session':{required:false},
    '/api/checkins':[], '/api/checkins/history':[], '/api/alerts':[],
    '/api/weather':{stations:[]}, '/api/dispatch/apiroq':{}, '/api/market-prices':{nodes:{}}, '/api/scada':{feeds:[],readings:[]}, '/api/chat/messages':{messages:[]},
    '/api/events/register':{items:alarms,nextCursor:null,total:alarms.length},
    '/api/events/detail':{event:alarms[0],history:{items:[alarms[0],{eventId:'fixture-note',occurredAt:now,summary:'Operator review',source:'logbook',category:'alarm',severity:'info',status:'',actorId:'fixture operator',payload:{details:'Breaker trip reviewed.'}}],total:2,nextCursor:null}}
  };
  await context.route('**/api/**',route=>{
    const key=new URL(route.request().url()).pathname;
    return route.fulfill({status:fixture[key]?200:503,contentType:'application/json',body:JSON.stringify(fixture[key]||{})});
  });
  const page=await context.newPage();
  await page.addInitScript(() => {
    window.alarmToneStarts = 0;
    const Audio = window.AudioContext;
    if (!Audio) return;
    const original = Audio.prototype.createOscillator;
    Audio.prototype.createOscillator = function () {
      const voice = original.call(this), start = voice.start.bind(voice);
      voice.start = (...args) => { window.alarmToneStarts++; return start(...args); };
      return voice;
    };
  });
  try{
    await page.goto(`http://127.0.0.1:${server.address().port}/northstar-clean.html`);
    await page.waitForSelector('#nsStatusBar .ns-status-alarm');
    const events=page.locator('#nsStatusBar [data-status=events]');
    const critical=events.locator('[data-ns-alarm-id="fixture-crit"]');
    await page.waitForFunction(()=>document.querySelector('[data-ns-alarm-id="fixture-crit"]')?.hasAttribute('data-alarm-new'));
    assert.equal(await critical.getAttribute('data-alarm-severity'),'critical');
    assert.equal(await critical.locator('.ns-alarm-new-badge').innerText(),'NEW · UNACK');
    assert.equal(await critical.evaluate(node=>getComputedStyle(node).animationName),'ns-alarm-attention');
    await page.emulateMedia({reducedMotion:'reduce'});
    assert.equal(await critical.evaluate(node=>getComputedStyle(node).animationName),'none');
    await page.emulateMedia({reducedMotion:'no-preference'});
    await events.locator('[data-alarm-audio]').click();
    await events.locator('[data-filter="warning"]').click();
    await page.waitForFunction(()=>window.alarmToneStarts>=2);
    await events.locator('[data-filter="all"]').click();
    await page.evaluate(()=>{
      openAlerts=[{id:'fixture-market',state:'active',actions:['sound']}];
      notifiedAlerts.add('fixture-market');
      soundTimer=setInterval(()=>{},2500);
    });
    await critical.click();
    await page.waitForSelector('#nsAlarmHistoryDialog[open]');
    assert.equal(await page.locator('#nsAlarmHistoryDialog [data-alarm-full]').getAttribute('href'),'event-detail.html?id=fixture-crit');
    await page.locator('#nsAlarmHistoryDialog [data-alarm-minimize]').click();
    assert.equal(await page.locator('#nsAlarmHistoryDialog').evaluate(node=>node.classList.contains('ns-alarm-minimized')),true);
    await page.locator('#nsAlarmHistoryDialog [data-alarm-maximize]').click();
    assert.equal(await page.locator('#nsAlarmHistoryDialog').evaluate(node=>node.classList.contains('ns-alarm-maximized')),true);
    await page.locator('#nsAlarmHistoryDialog [data-alarm-maximize]').click();
    await page.locator('#nsAlarmHistoryDialog [data-alarm-close]').click();
    await page.waitForFunction(()=>NorthstarAlarmInteractions.state('fixture-crit').acknowledged);
    assert.equal(await critical.evaluate(node=>node.classList.contains('ns-alarm-acknowledged')),true,'single click acknowledges and retains an active alarm');
    assert.equal(await critical.getAttribute('data-alarm-new'),null,'acknowledgement stops attention');
    assert.equal(await page.evaluate(()=>soundTimer),null,'acknowledgement stops the existing market sound timer');
    const tonesAfterAck=await page.evaluate(()=>window.alarmToneStarts);
    await page.waitForTimeout(2700);
    assert.equal(await page.evaluate(()=>window.alarmToneStarts),tonesAfterAck,'critical tone stops after acknowledgement');
    await page.evaluate(()=>NorthstarAlarmInteractions.observe([{eventId:'resolved-critical',category:'alarm',severity:'critical',status:'resolved'}]));
    assert.equal(await page.evaluate(()=>window.alarmToneStarts),tonesAfterAck,'resolved critical history does not sound');
    await critical.click({button:'right'});
    await page.waitForSelector('#nsAlarmHistoryDialog[open]');
    assert.ok((await page.locator('#nsAlarmHistoryDialog').innerText()).includes('Breaker trip reviewed.'),'right click shows detailed recorded history');
    assert.equal(await page.locator('#nsAlarmHistoryDialog [data-alarm-close]').count(),1,'history popup has an X close control');
    await page.locator('#nsAlarmHistoryDialog [data-alarm-pin]').click();
    assert.equal(await page.evaluate(()=>NorthstarAlarmInteractions.state('fixture-crit').pinned),true,'popup pin action is stored');
    await page.locator('#nsAlarmHistoryDialog [data-alarm-open]').click();
    await page.waitForFunction(()=>document.querySelector('[data-el-category="ALARMS"]')?.getAttribute('aria-pressed')==='true');
    await page.locator('[data-el-category="ALL"]').click();
    assert.equal(await page.locator('#elRows [data-ns-alarm-id]').first().getAttribute('data-ns-alarm-id'),'fixture-crit','pinned alarm is first in the module All screen');

    const popoutPromise=page.waitForEvent('popup');
    await page.evaluate(()=>NorthstarModules.popOut('logbook:eventLogs'));
    const popout=await popoutPromise;
    await popout.waitForSelector('#elRows [data-ns-alarm-id="fixture-warn"]');
    assert.equal(await popout.locator('#elRows [data-ns-alarm-id]').first().getAttribute('data-ns-alarm-id'),'fixture-crit','module popout receives the pinned All ordering');
    await popout.locator('#elRows [data-ns-alarm-id="fixture-warn"]').click({button:'right'});
    await popout.waitForSelector('#nsAlarmHistoryDialog[open]');
    assert.equal(await popout.locator('#nsAlarmHistoryDialog [data-alarm-close]').count(),1,'popout module has the same alarm history popup');
    await popout.locator('#nsAlarmHistoryDialog [data-alarm-close]').click();
    await popout.waitForFunction(()=>!document.querySelector('#nsAlarmHistoryDialog')?.open);

    await events.locator('[data-filter="all"]').click();
    await events.locator('[data-ns-alarm-id="fixture-warn"]').dblclick();
    await page.waitForFunction(()=>NorthstarAlarmInteractions.state('fixture-warn').cleared);
    assert.equal(await events.locator('[data-ns-alarm-id="fixture-warn"]').count(),0,'double click clears and removes the alarm from the active fixed list');
    await popout.waitForFunction(()=>NorthstarAlarmInteractions.state('fixture-warn').cleared);
    assert.equal(await popout.locator('[data-ns-alarm-id="fixture-warn"][data-alarm-new]').count(),0,'received state stops popout attention');
    await popout.close();
    console.log('PASS shared fixed dashboard, Event Log module, and popout alarm interactions');
  } finally {
    await context.close();
    await browser.close();
    await new Promise(resolve=>server.close(resolve));
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
