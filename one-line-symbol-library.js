(() => {
  'use strict';

  const esc = value => String(value ?? '').replace(
    /[&<>"']/g,
    char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[char],
  );
  const path = d => `<path class="node-shape" d="${d}" fill="none"/>`;
  const circle = (cx, cy, r, extra = '') => `<circle class="node-shape ${extra}" cx="${cx}" cy="${cy}" r="${r}"/>`;
  const text = (x, y, value) => `<text class="symbol-letter" x="${x}" y="${y}">${esc(value)}</text>`;

  const definitions = [
    { id:'source', name:'AC source / utility', category:'Network', glyph:'∿', prefix:'SRC', standard:'IEEE/ANSI 315 convention', draw:({x,y}) => circle(x,y,25)+path(`M${x-14} ${y}q7-13 14 0t14 0`) },
    { id:'bus', name:'Bus', category:'Network', glyph:'━', prefix:'BUS', standard:'IEEE/ANSI 315 convention', draw:({x,y}) => `<path class="node-shape symbol-heavy" d="M${x-42} ${y}H${x+42}"/>` },
    { id:'line', name:'Line / cable', category:'Network', glyph:'╱', prefix:'LIN', standard:'IEEE/ANSI 315 convention', draw:({x,y}) => path(`M${x-38} ${y}H${x+38}M${x-8} ${y+9}l8-18m8 18l8-18`) },
    { id:'junction', name:'Connected junction', category:'Network', glyph:'●', prefix:'JCT', standard:'IEEE/ANSI 315 convention', draw:({x,y}) => `<circle class="terminal-dot" cx="${x}" cy="${y}" r="7"/>` },
    { id:'terminal', name:'Terminal', category:'Network', glyph:'○', prefix:'TER', standard:'IEEE/ANSI 315 convention', draw:({x,y}) => circle(x,y,9) },
    { id:'ground', name:'Ground / earth', category:'Network', glyph:'⏚', prefix:'GND', standard:'IEEE/ANSI 315 convention', draw:({x,y}) => path(`M${x} ${y-25}v18M${x-20} ${y-7}h40M${x-14} ${y}h28M${x-7} ${y+7}h14`) },
    { id:'disconnect', name:'Disconnect switch', category:'Primary equipment', glyph:'⫯', prefix:'DSC', functionNumber:'89', standard:'IEEE C37.2-2022 designation', draw:({x,y}) => path(`M${x-34} ${y}h14m26 0h28M${x-20} ${y}L${x+4} ${y-19}`)+circle(x-20,y,3)+circle(x+6,y,3) },
    { id:'breaker', name:'AC circuit breaker', category:'Primary equipment', glyph:'□', prefix:'CBR', functionNumber:'52', standard:'IEEE C37.2-2022 designation', draw:({x,y}) => path(`M${x-38} ${y}h16m44 0h16`)+`<rect class="node-shape" x="${x-22}" y="${y-22}" width="44" height="44" rx="2"/>`+path(`M${x-13} ${y+13}L${x+13} ${y-13}`) },
    { id:'fuse', name:'Fuse', category:'Primary equipment', glyph:'▭', prefix:'FUS', standard:'IEEE/ANSI 315 convention', draw:({x,y}) => path(`M${x-38} ${y}h16m44 0h16`)+`<rect class="node-shape" x="${x-22}" y="${y-10}" width="44" height="20" rx="2"/>`+path(`M${x-16} ${y}q8-12 16 0t16 0`) },
    { id:'transformer', name:'Power transformer', category:'Primary equipment', glyph:'◎', prefix:'XFMR', standard:'IEEE/ANSI 315 convention', draw:({x,y}) => path(`M${x-42} ${y}h15m54 0h15`)+circle(x-10,y,18)+circle(x+10,y,18) },
    { id:'generator', name:'Generator', category:'Primary equipment', glyph:'G', prefix:'GEN', standard:'IEEE/ANSI 315 convention', draw:({x,y}) => circle(x,y,25)+text(x,y+5,'G') },
    { id:'motor', name:'Motor', category:'Primary equipment', glyph:'M', prefix:'MTR', standard:'IEEE/ANSI 315 convention', draw:({x,y}) => circle(x,y,25)+text(x,y+5,'M') },
    { id:'capacitor', name:'Capacitor bank', category:'Primary equipment', glyph:'╫', prefix:'CAP', standard:'IEEE/ANSI 315 convention', draw:({x,y}) => path(`M${x-38} ${y}h28M${x-10} ${y-22}v44M${x+10} ${y-22}v44M${x+10} ${y}h28`) },
    { id:'reactor', name:'Reactor', category:'Primary equipment', glyph:'∿', prefix:'REA', standard:'IEEE/ANSI 315 convention', draw:({x,y}) => path(`M${x-38} ${y}h10q7-18 14 0t14 0t14 0t14 0h10`) },
    { id:'battery', name:'Battery', category:'Primary equipment', glyph:'▯', prefix:'BAT', standard:'IEEE/ANSI 315 convention', draw:({x,y}) => path(`M${x-38} ${y}h24M${x-14} ${y-22}v44M${x+8} ${y-14}v28M${x+8} ${y}h30`) },
    { id:'surge-arrester', name:'Surge arrester', category:'Primary equipment', glyph:'ϟ', prefix:'SA', standard:'IEEE/ANSI 315 convention', draw:({x,y}) => path(`M${x-38} ${y}h17M${x+21} ${y}h17M${x-21} ${y-18}h42v36h-42zM${x+7} ${y-14}l-14 13h10l-10 15`) },
    { id:'load', name:'General load', category:'Primary equipment', glyph:'▽', prefix:'LOD', standard:'IEEE/ANSI 315 convention', draw:({x,y}) => path(`M${x-38} ${y}h18M${x-20} ${y-22}L${x+28} ${y}l-48 22z`) },
    { id:'ct', name:'Current transformer', category:'Measurement & protection', glyph:'CT', prefix:'CT', standard:'IEEE/ANSI 315 convention', draw:({x,y}) => path(`M${x-38} ${y}h76`)+circle(x,y,19)+text(x,y+4,'CT') },
    { id:'vt', name:'Voltage transformer', category:'Measurement & protection', glyph:'VT', prefix:'VT', standard:'IEEE/ANSI 315 convention', draw:({x,y}) => path(`M${x-42} ${y}h15m54 0h15`)+circle(x-10,y,18)+circle(x+10,y,18)+text(x,y+4,'VT') },
    { id:'relay', name:'Protective relay', category:'Measurement & protection', glyph:'51', prefix:'RLY', functionNumber:'51', standard:'IEEE C37.2-2022 designation', draw:({x,y,deviceFunction}) => circle(x,y,25)+text(x,y+5,deviceFunction || '51') },
    { id:'lockout', name:'Lockout relay', category:'Measurement & protection', glyph:'86', prefix:'LOR', functionNumber:'86', standard:'IEEE C37.2-2022 designation', draw:({x,y}) => circle(x,y,25)+text(x,y+5,'86') },
    { id:'edge', name:'Legacy conductor', category:'Legacy compatibility', glyph:'—', prefix:'EDG', hidden:true, standard:'NorthStar legacy alias', draw:({x,y}) => path(`M${x-35} ${y}H${x+35}`) },
  ];

  const functions = [
    ['','None / custom'], ['25','Synchronism-check'], ['27','Undervoltage'],
    ['32','Directional power'], ['46','Negative-sequence current'], ['49','Thermal'],
    ['50','Instantaneous overcurrent'], ['50N','Instantaneous ground overcurrent'],
    ['51','Time overcurrent'], ['51N','Time ground overcurrent'], ['52','AC circuit breaker'],
    ['59','Overvoltage'], ['67','Directional overcurrent'], ['81','Frequency'],
    ['86','Lockout'], ['87','Differential protection'], ['89','Line switch'],
  ];

  const byId = Object.fromEntries(definitions.map(item => [item.id, item]));
  window.NorthStarOneLineSymbols = Object.freeze({
    profile: 'northstar-ieee-compat-2026.1',
    graphicalStandard: 'IEEE/ANSI 315-1975 (inactive-reserved)',
    designationStandard: 'IEEE C37.2-2022 (active)',
    definitions,
    functions,
    get: id => byId[id] || byId.source,
    draw: symbol => (byId[symbol.type] || byId.source).draw(symbol),
  });
})();
