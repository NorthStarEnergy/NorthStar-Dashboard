const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

async function menuClick(session, tab = 'switching') {
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
  const button = {dataset:{tab},closest:()=>true,classList:{contains:()=>false}};
  let blocked = false;
  handlers.click({target:{closest:()=>button},preventDefault:()=>{blocked=true;},stopImmediatePropagation(){}});
  return blocked;
}
test('Engineering opens for the Ryan operator even when demo-preview styling is disabled',async()=>{
  assert.equal(await menuClick({username:'Ryan',role:'operator'}),false);
});
test('Engineering stays restricted for demo and site-only sessions',async()=>{
  for(const role of ['platform_demo','site_viewer']){
    assert.equal(await menuClick({username:'Ryan',role}),true);
  }
});
test('Outages opens for operator sessions and stays unavailable to restricted viewers',async()=>{
  for(const username of ['Ryan','scheduled-ssc']){
    assert.equal(await menuClick({username,role:'operator'},'outages'),false);
  }
  for(const role of ['platform_demo','site_viewer']){
    assert.equal(await menuClick({role},'outages'),true);
  }
});
