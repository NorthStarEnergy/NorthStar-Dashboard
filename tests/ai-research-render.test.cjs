const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
for (const file of ['ai-assistant-workspace.js', 'v1-baseline-ai-assistant-workspace.js']) {
  const source = fs.readFileSync(file, 'utf8').replace(/\}\)\(\);\s*$/, 'window.__renderAnswer=renderAnswer;})();');
  const window = {};
  vm.runInNewContext(source, {window, document:{addEventListener(){}}, URL, location:{href:'https://ops.northstarenergy.ca/northstar-v1.html',origin:'https://ops.northstarenergy.ca'}, console});
  const html = window.__renderAnswer('Short answer [oks_abc:1].\n\n[MORE_DETAILS]\nSupporting detail.', [{id:'oks_abc:1',title:'Controlled <source>',href:'knowledge-library.html?source=oks_abc',authorityStatus:'REFERENCE_ONLY'}]);
  assert.match(html, />\[1\]<\/a>/);
  assert.match(html, /\[1\] Controlled &lt;source&gt;/);
  assert.match(html, /AI answer/);
  assert.doesNotMatch(html, /Reviewed answer/);
  assert.match(html, /aria-expanded="false"/);
  const unsafe = window.__renderAnswer('Text [ref].', [{id:'ref',title:'<script>bad</script>',href:'javascript:alert(1)',source_kind:'web'}]);
  assert.doesNotMatch(unsafe, /href=|<script>/);
  const general = window.__renderAnswer('No supplied reference [unverified].', []);
  assert.match(general, /\[unverified\]/);
}
console.log('Both assistant surfaces: numbered sources, safe links, concise lead and honest labels pass.');
