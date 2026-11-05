const {chromium}=require('playwright');
const assert=require('node:assert/strict'),path=require('node:path');
const root=path.resolve(__dirname,'..');
(async()=>{
 const browser=await chromium.launch({channel:'msedge',headless:true});
 try{
  const page=await browser.newPage({viewport:{width:1200,height:900}});
  await page.setContent('<html><body><div id="target"></div></body></html>');
  await page.addStyleTag({path:path.join(root,'generating-station-cards.css')});
  await page.addScriptTag({path:path.join(root,'station-one-line.js')});
  await page.evaluate(()=>{
   const empty=()=>null,m={site:{id:'site:island-falls',name:'Island Falls'},total:12,current:false,units:Array.from({length:12},(_,i)=>({n:i+1,state:'available'})),reading:empty,value:()=>null};
   document.querySelector('#target').innerHTML=NorthStarStationOneLine.render(m);
  });
  assert.deepEqual(await page.locator('.gs-sld-bus-label').allTextContents(),['Generator Bus 1 · 12.5 kV','Generator Bus 2 · 12.5 kV']);
  const positions=await page.locator('.gs-sld-generator').evaluateAll(nodes=>nodes.map(node=>({n:Number(node.querySelector('.gs-sld-unit').textContent.slice(1)),transform:node.getAttribute('transform')})));
  assert.ok(positions.filter(item=>item.n<=6).every(item=>item.transform.includes(' 245)')));
  assert.ok(positions.filter(item=>item.n>=7).every(item=>item.transform.includes(' 590)')));
  assert.equal(new Set(positions.map(item=>item.transform.match(/translate\([^ ]+ ([^)]+)/)[1])).size,2);
  assert.ok(await page.locator('.gs-sld').evaluate(svg=>svg.getBoundingClientRect().height>350),'stacked diagram should remain readable instead of shrinking into a strip');
  console.log('PASS Island Falls G1-G6 on Bus 1 and G7-G12 on stacked Bus 2');
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
