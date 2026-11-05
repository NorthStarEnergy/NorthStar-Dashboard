const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const path = require('node:path');
const root = path.join(__dirname, '..');
const migration = fs.readFileSync(path.join(root, 'overview-layout-migration.js'), 'utf8');
const values = new Map([
  ['northstarModuleLayout', JSON.stringify({overview:{position:{staff:{x:500,y:0,h:1683}}},switching:{order:['kept']}})],
  ['northstarClosedOverviewModules', JSON.stringify(['overview-field-tracker','unrelated'])]
]);
const context = {window:{},localStorage:{getItem:k=>values.get(k)??null,setItem:(k,v)=>values.set(k,v)}};
vm.runInNewContext(migration, context);
assert.deepEqual(JSON.parse(values.get('northstarModuleLayout')).overview.position, {});
assert.deepEqual(JSON.parse(values.get('northstarModuleLayout')).switching.order, ['kept']);
assert.deepEqual(JSON.parse(values.get('northstarClosedOverviewModules')), ['unrelated']);
const once = values.get('northstarModuleLayout');
vm.runInNewContext(migration, context);
assert.equal(values.get('northstarModuleLayout'), once);
assert.ok(values.has('northstarModuleLayout:before-flow-1'));
vm.runInNewContext(migration, {window:{},localStorage:{getItem(){throw Error('blocked');}}});
const malformed = new Map([['northstarModuleLayout','broken'],['northstarClosedOverviewModules','{}']]);
vm.runInNewContext(migration,{window:{},localStorage:{getItem:k=>malformed.get(k)??null,setItem:(k,v)=>malformed.set(k,v)}});
assert.deepEqual(JSON.parse(malformed.get('northstarClosedOverviewModules')),[]);
let count = 0;
const html = fs.readFileSync(path.join(root, 'northstar-clean.html'), 'utf8');
for (const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
  const src = match[1].match(/src="([^"]+)"/);
  if (src) {
    const filename = path.join(root,src[1].split('?')[0]);
    if (fs.existsSync(filename)) new vm.Script(fs.readFileSync(filename,'utf8'),{filename});
  } else new vm.Script(match[2],{filename:'inline-'+count});
  count++;
}
console.log('Layout migration regressions passed; '+count+' dashboard script blocks compile.');
