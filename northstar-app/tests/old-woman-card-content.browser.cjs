const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const http=require('node:http');
const fs=require('node:fs');
const path=require('node:path');

const source=fs.readFileSync(path.join(__dirname,'..','module-asset-editor.js'),'utf8');
const fixture=`<!doctype html><html><body><section id="overview"><article data-module-id="site:old-woman-falls"><strong class="gs-name"><span>Old Woman</span><span>Falls</span></strong><svg class="gs-generator"></svg></article><article data-module-id="site:twin-falls"><strong class="gs-name"><span>Twin Falls</span></strong></article></section><script>window.NorthstarAssetLayout={styles:(record)=>{const result={};if('x' in record||'y' in record)result.translate=(record.x||0)+'px '+(record.y||0)+'px';return result}};</script><script src="/module-asset-editor.js"></script></body></html>`;
const server=http.createServer((request,response)=>{
  response.setHeader('Content-Type',request.url==='/module-asset-editor.js'?'application/javascript':'text/html');
  response.end(request.url==='/module-asset-editor.js'?source:fixture);
});

(async()=>{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const browser=await chromium.launch({channel:'msedge',headless:true});
  try{
    const page=await browser.newPage();
    const state={version:1,roots:{'overview:site:old-woman-falls':{assets:{'strong.gs-name > span:first-child':{x:0,y:-21,color:'#eee'},'strong.gs-name > span:nth-child(2)':{x:0,y:-62},'svg.gs-generator':{x:0,y:-135}}},'overview:site:twin-falls':{assets:{'strong.gs-name > span':{x:3,y:4}}}}};
    await page.addInitScript(value=>{localStorage.setItem('northstarAssetEditorV1',JSON.stringify(value));localStorage.setItem('northstarAssetEditorV1Saved',JSON.stringify(value));},state);
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    await page.waitForFunction(()=>!!window.NorthstarAssetEditor);
    const result=await page.evaluate(()=>({
      draft:JSON.parse(localStorage.getItem('northstarAssetEditorV1')),
      saved:JSON.parse(localStorage.getItem('northstarAssetEditorV1Saved')),
      titleTranslate:getComputedStyle(document.querySelector('[data-module-id="site:old-woman-falls"] .gs-name span')).translate,
      titleInside:(()=>{const card=document.querySelector('[data-module-id="site:old-woman-falls"]').getBoundingClientRect(),title=document.querySelector('[data-module-id="site:old-woman-falls"] .gs-name span').getBoundingClientRect();return title.top>=card.top&&title.bottom<=card.bottom})()
    }));
    for(const snapshot of [result.draft,result.saved]){
      assert.equal(snapshot.oldWomanContentRepairV1,true);
      const assets=snapshot.roots['overview:site:old-woman-falls'].assets;
      assert.ok(Object.values(assets).every(asset=>!('x' in asset)&&!('y' in asset)));
      assert.equal(assets['strong.gs-name > span:first-child'].color,'#eee');
      assert.deepEqual(snapshot.roots['overview:site:twin-falls'].assets['strong.gs-name > span'],{x:3,y:4});
    }
    assert.equal(result.titleTranslate,'none');
    assert.equal(result.titleInside,true);
    console.log('PASS Old Woman Falls content offsets repaired; other station layout retained');
  } finally {await browser.close();server.close();}
})().catch(error=>{console.error(error);server.close();process.exitCode=1;});
