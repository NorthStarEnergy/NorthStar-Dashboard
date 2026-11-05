/* Render this checkout with synthetic API records; no production backend access. */
const {chromium}=require('playwright');
const http=require('node:http'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..');
const out=path.join(root,'outputs');fs.mkdirSync(out,{recursive:true});
const own=new Set(['northstar-clean.html','module-workspace.js','spill-workspace.js','spill-workspace.css']);
(async()=>{
 const server=http.createServer((req,res)=>{
  const name=decodeURIComponent(new URL(req.url,'http://local').pathname).slice(1),base=own.has(name)?root:root,file=path.resolve(base,name);
  if(!file.startsWith(base+path.sep)||!['.html','.js','.css','.svg','.png','.ico','.json'].includes(path.extname(file))){res.writeHead(404);return res.end();}
  fs.readFile(file,(error,data)=>{res.writeHead(error?404:200,{'Content-Type':{'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json'}[path.extname(file)]||'application/octet-stream'});res.end(error?'':data);});
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const browser=await chromium.launch({channel:'msedge',headless:true});const errors=[];let checks=0;
 const check=(value,message)=>{assert.ok(value,message);checks++;};
 try{
  const page=await browser.newPage({viewport:{width:1440,height:1000}});page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/api/**',async route=>{
   const url=new URL(route.request().url());let data={},status=200;
   if(url.pathname==='/api/auth/session')data={required:false,authenticated:true,username:'spill-fixture'};
   else if(url.pathname==='/api/sites')data={stations:[]};
   else if(url.pathname==='/api/scada')data={readings:[],feeds:[]};
   else if(url.pathname==='/api/market-prices')data={nodes:{}};
   else if(url.pathname==='/api/weather')data={stations:[]};
   else if(url.pathname==='/api/checkins')data=[];
   else if(url.pathname==='/api/events/register')data={items:[],total:0};
   else if(url.pathname==='/api/profile/crew-layout')data={positions:{}};
   else if(url.pathname==='/api/chat/messages')data={messages:[]};
   else{data={};status=503;}
   await route.fulfill({status,contentType:'application/json',body:JSON.stringify(data)});
  });
  const url=`http://127.0.0.1:${server.address().port}/northstar-clean.html#operations`;
  await page.goto(url);await page.waitForFunction(()=>window.NorthstarModules?.registry.has('operations:spill:sluice-gates'));
  await page.waitForTimeout(1500);await page.mouse.move(0,0);
  check(await page.evaluate(()=>['operations:spill:raft-lake','operations:spill:namakan-lake','operations:spill:sluice-gates'].every(id=>window.NorthstarModules.registry.get(id).parent==='operations:spill')),'Spill owns three child modules');
  await page.evaluate(()=>window.NorthstarModules.open('operations:spill'));await page.locator('#spillHome').waitFor({state:'visible'});
  check(await page.locator('#spillHome [data-spill-open]').count()===3,'three location links');
  await page.locator('#spillHome [data-spill-open="operations:spill:raft-lake"]').click();await page.mouse.move(0,0);await page.locator('#spillRaftLake [data-record-spill]').first().waitFor({state:'visible'});
  check(await page.locator('#spillRaftLake .spill-device').count()===4,'four Raft bays');
  check(await page.locator('#spillRaftLake .spill-log.installed').count()===48,'12 installed logs per bay');
  check(await page.locator('#spillRaftLake .spill-history').count()===5,'device and location histories');
  await page.mouse.move(0,0);await page.screenshot({path:path.join(out,'raft-lake-desktop.png'),fullPage:true});
  // A full-page capture can trigger viewport/landing restoration on hosted Edge.
  // Start the movement scenario in its explicit view after the capture completes.
  await page.evaluate(()=>window.NorthstarModules.open('operations:spill:raft-lake'));
  await page.locator('#spillRaftLake [data-record-spill]').first().waitFor({state:'visible'});
  await page.locator('#spillRaftLake [data-record-spill]').first().click();await page.locator('#spillMovementDialog [name="logs"]').fill('10');
  await page.locator('#spillMovementDialog [name="operator"]').fill('Fixture recorder');await page.locator('#spillMovementDialog [name="notes"]').fill('Removed two logs');await page.locator('#spillMovementDialog [type="submit"]').click();
  check(await page.locator('#spillRaftLake .spill-log.installed').count()===46,'log visualization reflects movement');
  check(await page.locator('#spillRaftLake').getByText('Removed two logs',{exact:true}).count()===2,'entry in bay and location logs');
  await page.reload();await page.waitForFunction(()=>window.NorthstarModules?.registry.has('operations:spill:raft-lake'));await page.evaluate(()=>window.NorthstarModules.open('operations:spill:raft-lake'));
  check(await page.locator('#spillRaftLake .spill-log.installed').count()===46,'log count survives reload');
  await page.evaluate(()=>window.NorthstarModules.open('operations:spill:namakan-lake'));check(await page.locator('#spillNamakanLake .spill-log.installed').count()===48,'Namakan separate 12-log bays');
  await page.setViewportSize({width:390,height:844});await page.waitForTimeout(500);await page.locator('#nsPhoneLineup button').first().click();await page.locator('#nsPhonePicker input[value="operations:spill:namakan-lake"]').check();await page.locator('#nsPhonePicker ol button').filter({hasText:'Namakan Lake'}).first().click();await page.locator('#spillNamakanLake [data-record-spill]').first().waitFor({state:'visible'});await page.mouse.move(0,0);await page.screenshot({path:path.join(out,'namakan-lake-mobile.png'),fullPage:true});
  check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'mobile page has no horizontal overflow');
  await page.setViewportSize({width:1440,height:1000});await page.evaluate(()=>window.NorthstarModules.open('operations:spill:sluice-gates'));
  const stations=await page.locator('#spillStation option').evaluateAll(nodes=>nodes.map(node=>node.value));
  check(stations.length===18,'all 18 generating stations in root catalog');
  for(const station of stations){await page.locator('#spillStation').selectOption(station);check(await page.locator('#spillSluiceGates .spill-device').count()===2,'two illustrative gates per station');check(await page.locator('#spillSluiceGates .spill-history').count()===3,'station and each gate history');}
  await page.locator('#spillStation').selectOption(stations[0]);await page.locator('#spillSluiceGates [data-record-spill]').first().click();
  await page.locator('#spillMovementDialog [name="position"]').fill('50');await page.locator('#spillMovementDialog [name="flow"]').fill('15.5');
  await page.locator('#spillMovementDialog [name="status"]').selectOption('Closed');await page.locator('#spillMovementDialog [name="operator"]').fill('Gate recorder');await page.locator('#spillMovementDialog [name="notes"]').fill('<script>movement</script>');await page.locator('#spillMovementDialog [type="submit"]').click();
  check(await page.locator('#spillMovementDialog').evaluate(el=>el.open),'inconsistent gate status rejected');
  await page.locator('#spillMovementDialog [name="status"]').selectOption('Part open');await page.locator('#spillMovementDialog [type="submit"]').click();
  check(await page.locator('#spillSluiceGates').getByText('15.5 m³/s',{exact:true}).count()===1,'new gate flow visible');
  check(await page.locator('#spillSluiceGates').getByText('<script>movement</script>',{exact:true}).count()===2,'escaped notes in both histories');
  await page.mouse.move(0,0);await page.screenshot({path:path.join(out,'sluice-gates-desktop.png'),fullPage:true});
  await page.reload();await page.waitForFunction(()=>window.NorthstarModules?.registry.has('operations:spill:sluice-gates'));await page.evaluate(()=>window.NorthstarModules.open('operations:spill:sluice-gates'));
  check(await page.locator('#spillSluiceGates').getByText('15.5 m³/s',{exact:true}).count()===1,'gate state and history survive reload');
  await page.locator('#spillSluiceGates [data-record-spill]').first().click();await page.locator('#spillMovementDialog [name="position"]').fill('75');await page.locator('#spillMovementDialog [name="operator"]').fill('Gate recorder');await page.locator('#spillMovementDialog [name="notes"]').fill('Storage failure example');
  await page.evaluate(()=>{window.originalSpillSetItem=Storage.prototype.setItem;Storage.prototype.setItem=function(key,value){if(key.startsWith('northstarMockSpill'))throw new Error('fixture storage failure');return window.originalSpillSetItem.call(this,key,value);};});
  await page.locator('#spillMovementDialog [type="submit"]').click();check((await page.locator('#spillMovementDialog [role="alert"]').innerText()).includes('could not be saved'),'failed storage surfaces error');
  await page.evaluate(()=>{Storage.prototype.setItem=window.originalSpillSetItem;});await page.locator('#spillMovementDialog [data-spill-close]').click();
  check(await page.locator('#spillSluiceGates').getByText('50% open',{exact:true}).count()===1,'failed storage does not update device state');
  await page.setViewportSize({width:390,height:844});await page.waitForTimeout(500);await page.locator('#nsPhoneLineup button').first().click();await page.locator('#nsPhonePicker input[value="operations:spill:sluice-gates"]').check();await page.locator('#nsPhonePicker ol button').filter({hasText:'Sluice Gates'}).first().click();await page.locator('#spillSluiceGates [data-record-spill]').first().waitFor({state:'visible'});await page.mouse.move(0,0);await page.screenshot({path:path.join(out,'sluice-gates-mobile.png'),fullPage:true});check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'gate mobile page has no overflow');
  check(errors.length===0,'no page errors');
  fs.writeFileSync(path.join(out,'spill-verification.json'),JSON.stringify({checks,stations:stations.length,gates:stations.length*2,raftBays:4,namakanBays:4,logsPerBay:12,fixtureOnly:true,errors},null,2));console.log(`PASS ${checks} Spill browser checks`);
 }finally{await browser.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});
