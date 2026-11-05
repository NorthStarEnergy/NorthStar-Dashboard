const {chromium}=require('playwright');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch({channel:'msedge',headless:true});
 const page=await browser.newPage({viewport:{width:1400,height:900}});
 try{
 await page.setContent('<body class="layout-edit"><main><article data-ns-module="test" style="position:fixed;left:100px;top:100px;width:400px;height:250px"><button class="canvas-move-handle">Move</button><span>Test</span></article></main></body>');
 await page.addScriptTag({path:path.resolve(__dirname,'../module-layout.js')});
 await page.evaluate(()=>{
   const el=document.querySelector('article'),handle=el.querySelector('button');let box={x:100,y:100,w:400,h:250};window.commits=0;
   NorthstarWindowLayout.bind(el,handle,'move',()=>box,b=>{box=b;el.style.left=b.x+'px';el.style.top=b.y+'px';},()=>document.body.classList.contains('layout-edit'),()=>{window.saved={...box};window.commits++;});
 });
 await page.addScriptTag({path:path.resolve(__dirname,'../module-asset-editor.js')});
 await page.selectOption('#nsAssetEditor [name="mode"]','assets');
 await page.mouse.click(300,250);
 assert.equal(await page.locator('#nsAssetSelection').getAttribute('data-whole-module'),'true');
 for(const [key,x,y] of [['ArrowRight',101,100],['ArrowDown',101,101],['ArrowLeft',100,101],['ArrowUp',100,100],['Shift+ArrowRight',101,100]]){
   await page.keyboard.press(key);
   const b=await page.locator('article').boundingBox();assert.equal(b.x,x);assert.equal(b.y,y);
   assert.deepEqual(await page.evaluate(()=>[saved.x,saved.y]),[x,y]);
 }
 assert.equal(await page.evaluate(()=>commits),5);
 await page.evaluate(()=>document.body.classList.remove('layout-edit'));
 await page.keyboard.press('ArrowRight');assert.equal((await page.locator('article').boundingBox()).x,101);
 console.log('PASS: whole-module selection, four directions, exact one-unit Shift movement, persistence callback, edit-mode guard');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
