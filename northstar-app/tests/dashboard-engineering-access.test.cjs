const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

async function engineeringClick(session) {
  const handlers = {};
  const document = {
    readyState: 'complete',
    querySelector: () => ({querySelector:()=>null,querySelectorAll:()=>[]}),
    getElementById: () => null,
    addEventListener: (type, handler) => { handlers[type] = handler; }
  };
  const window = {northstarOperatorSession: Promise.resolve(session), NORTHSTAR_RYAN_VIEW: false};
  const source = fs.readFileSync(path.join(__dirname,'../library-navigation.js'),'utf8');
  vm.runInNewContext(source,{document,window,MutationObserver:class {observe() {}},URLSearchParams,location:{search:'',pathname:'/northstar-v1.html',hash:''}});
  await new Promise(resolve => setImmediate(resolve));
  const button = {dataset:{tab:'switching'},closest:()=>true,classList:{contains:()=>false}};
  let blocked = false;
  handlers.click({target:{closest:()=>button},preventDefault:()=>{blocked=true;},stopImmediatePropagation(){}});
  return blocked;
}
test('Engineering opens for the Ryan operator even when demo-preview styling is disabled',async()=>{
  assert.equal(await engineeringClick({username:'Ryan',role:'operator'}),false);
});
test('Engineering stays restricted for demo and site-only sessions',async()=>{
  for(const role of ['platform_demo','site_viewer']){
    assert.equal(await engineeringClick({username:'Ryan',role}),true);
  }
});
