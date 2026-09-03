(() => {
  'use strict';

  const esc = value => String(value ?? '').replace(
    /[&<>"']/g,
    char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[char],
  );
  const path = d => `<path class="node-shape" d="${d}" fill="none"/>`;
  const circle = (cx, cy, r, extra = '') => `<circle class="node-shape ${extra}" cx="${cx}" cy="${cy}" r="${r}"/>`;
  const text = (x, y, value) => `<text class="symbol-letter" x="${x}" y="${y}">${esc(value)}</text>`;
  const isOpen = symbol => symbol?.operatingState === 'open';
  const windingKind = (config, index) => String(config || '').toLowerCase()[index] || '';
  const windingMark = (x, y, kind) => {
    if (kind === 'd') return `<path class="node-shape winding-mark" d="M${x-7} ${y+6}l7-14l7 14z" fill="none"/>`;
    if (kind === 'y') return `<path class="node-shape winding-mark" d="M${x} ${y-8}v8M${x-7} ${y+8}L${x} ${y}L${x+7} ${y+8}" fill="none"/>`;
    return '';
  };
  const blade = (x, y, open) => open
    ? `M${x-20} ${y}L${x+4} ${y-19}`
    : `M${x-20} ${y}L${x+16} ${y}`;

  const definitions = [
    {
      id:'source', name:'AC source / utility', category:'Network', glyph:'∿', prefix:'SRC',
      standard:'IEEE/ANSI 315 convention',
      terminals:[{id:'R', dx:25, dy:0}, {id:'L', dx:-25, dy:0}],
      draw:({x,y}) => circle(x,y,25)+path(`M${x-14} ${y}q7-13 14 0t14 0`),
    },
    {
      id:'bus', name:'Bus', category:'Network', glyph:'━', prefix:'BUS',
      standard:'IEEE/ANSI 315 convention',
      terminals:[{id:'span', kind:'segment', dx1:-42, dy1:0, dx2:42, dy2:0}],
      draw:({x,y}) => `<path class="node-shape symbol-heavy" d="M${x-42} ${y}H${x+42}"/>`,
    },
    {
      id:'line', name:'Line / cable', category:'Network', glyph:'╱', prefix:'LIN',
      standard:'IEEE/ANSI 315 convention',
      terminals:[{id:'L', dx:-38, dy:0}, {id:'R', dx:38, dy:0}],
      draw:({x,y}) => path(`M${x-38} ${y}H${x+38}M${x-8} ${y+9}l8-18m8 18l8-18`),
    },
    {
      id:'junction', name:'Connected junction', category:'Network', glyph:'●', prefix:'JCT',
      standard:'IEEE/ANSI 315 convention',
      terminals:[{id:'C', dx:0, dy:0}],
      draw:({x,y}) => `<circle class="terminal-dot" cx="${x}" cy="${y}" r="7"/>`,
    },
    {
      id:'terminal', name:'Terminal', category:'Network', glyph:'○', prefix:'TER',
      standard:'IEEE/ANSI 315 convention',
      terminals:[{id:'C', dx:0, dy:0}],
      draw:({x,y}) => circle(x,y,9),
    },
    {
      id:'ground', name:'Ground / earth', category:'Network', glyph:'⏚', prefix:'GND',
      standard:'IEEE/ANSI 315 convention',
      terminals:[{id:'T', dx:0, dy:-25}],
      draw:({x,y}) => path(`M${x} ${y-25}v18M${x-20} ${y-7}h40M${x-14} ${y}h28M${x-7} ${y+7}h14`),
    },
    {
      id:'disconnect', name:'Disconnect switch', category:'Primary equipment', glyph:'⫯', prefix:'DSC',
      functionNumber:'89', standard:'IEEE C37.2-2022 designation', switching:true,
      terminals:[{id:'L', dx:-34, dy:0}, {id:'R', dx:34, dy:0}],
      draw:symbol => {
        const {x,y} = symbol;
        return path(`M${x-34} ${y}h14m26 0h28${blade(x,y,isOpen(symbol))}`)+circle(x-20,y,3)+circle(x+6,y,3);
      },
    },
    {
      id:'breaker', name:'AC circuit breaker', category:'Primary equipment', glyph:'□', prefix:'CBR',
      functionNumber:'52', standard:'IEEE C37.2-2022 designation', switching:true,
      terminals:[{id:'L', dx:-38, dy:0}, {id:'R', dx:38, dy:0}],
      draw:symbol => {
        const {x,y} = symbol;
        const open = isOpen(symbol);
        const leads = open ? path(`M${x-38} ${y}h12M${x+26} ${y}h12`) : path(`M${x-38} ${y}h16m44 0h16`);
        const slash = open ? '' : path(`M${x-13} ${y+13}L${x+13} ${y-13}`);
        return leads+`<rect class="node-shape${open ? ' device-open' : ''}" x="${x-22}" y="${y-22}" width="44" height="44" rx="2"/>`+slash;
      },
    },
    {
      id:'fuse', name:'Fuse', category:'Primary equipment', glyph:'▭', prefix:'FUS',
      standard:'IEEE/ANSI 315 convention', switching:true,
      terminals:[{id:'L', dx:-38, dy:0}, {id:'R', dx:38, dy:0}],
      draw:symbol => {
        const {x,y} = symbol;
        const open = isOpen(symbol);
        const leads = open ? path(`M${x-38} ${y}h12M${x+26} ${y}h12`) : path(`M${x-38} ${y}h16m44 0h16`);
        const slash = open ? '' : path(`M${x-14} ${y+8}L${x+14} ${y-8}`);
        return leads+`<rect class="node-shape${open ? ' device-open' : ''}" x="${x-22}" y="${y-10}" width="44" height="20" rx="2"/>`+slash;
      },
    },
    {
      id:'load-break', name:'Load-break switch', category:'Primary equipment', glyph:'⊸', prefix:'LBS',
      functionNumber:'89', standard:'IEEE C37.2-2022 designation', switching:true,
      terminals:[{id:'L', dx:-34, dy:0}, {id:'R', dx:34, dy:0}],
      draw:symbol => {
        const {x,y} = symbol;
        return path(`M${x-34} ${y}h14m26 0h28${blade(x,y,isOpen(symbol))}`)+path(`M${x+8} ${y-4}q8-10 16 0`)+circle(x-20,y,3)+circle(x+6,y,3);
      },
    },
    {
      id:'recloser', name:'Recloser', category:'Primary equipment', glyph:'↺', prefix:'RCL',
      functionNumber:'52', standard:'IEEE C37.2-2022 designation', switching:true,
      terminals:[{id:'L', dx:-38, dy:0}, {id:'R', dx:38, dy:0}],
      draw:symbol => {
        const {x,y} = symbol;
        const open = isOpen(symbol);
        const leads = open ? path(`M${x-38} ${y}h12M${x+26} ${y}h12`) : path(`M${x-38} ${y}h16m44 0h16`);
        const slash = open ? '' : path(`M${x-13} ${y+13}L${x+13} ${y-13}`);
        return leads+`<rect class="node-shape${open ? ' device-open' : ''}" x="${x-22}" y="${y-22}" width="44" height="44" rx="2"/>`+slash+path(`M${x-10} ${y-28}q10-10 20 0`)+text(x,y+28,'R');
      },
    },
    {
      id:'sectionalizer', name:'Sectionalizer', category:'Primary equipment', glyph:'S', prefix:'SEC',
      functionNumber:'89', standard:'IEEE C37.2-2022 designation', switching:true,
      terminals:[{id:'L', dx:-34, dy:0}, {id:'R', dx:34, dy:0}],
      draw:symbol => {
        const {x,y} = symbol;
        return path(`M${x-34} ${y}h14m26 0h28${blade(x,y,isOpen(symbol))}`)+circle(x-20,y,3)+circle(x+6,y,3)+text(x,y+22,'S');
      },
    },
    {
      id:'grounding-switch', name:'Grounding switch', category:'Primary equipment', glyph:'⏚', prefix:'GSW',
      functionNumber:'89', standard:'IEEE C37.2-2022 designation', switching:true,
      terminals:[{id:'L', dx:-34, dy:0}],
      draw:symbol => {
        const {x,y} = symbol;
        const open = isOpen(symbol);
        const arm = open ? `M${x-20} ${y}L${x+2} ${y-18}` : `M${x-20} ${y}L${x} ${y+18}`;
        return path(`M${x-34} ${y}h14${arm}`)+circle(x-20,y,3)+path(`M${x} ${y+18}v6M${x-16} ${y+24}h32M${x-10} ${y+30}h20M${x-5} ${y+36}h10`);
      },
    },
    {
      id:'ats', name:'Automatic transfer switch', category:'Primary equipment', glyph:'⇄', prefix:'ATS',
      standard:'IEEE/ANSI 315 convention', switching:true,
      terminals:[{id:'A', dx:-40, dy:0}, {id:'B', dx:40, dy:0}, {id:'LOAD', dx:0, dy:32}],
      draw:symbol => {
        const {x,y} = symbol;
        const open = isOpen(symbol);
        const throwPath = open
          ? path(`M${x} ${y+8}v10`)
          : path(`M${x-28} ${y}L${x} ${y+18}v6`);
        return `<rect class="node-shape${open ? ' device-open' : ''}" x="${x-32}" y="${y-18}" width="64" height="36" rx="3"/>`+path(`M${x-40} ${y}h8M${x+32} ${y}h8M${x} ${y+18}v14`)+throwPath+text(x,y-2,'ATS');
      },
    },
    {
      id:'transformer', name:'Power transformer', category:'Primary equipment', glyph:'◎', prefix:'XFMR',
      standard:'IEEE/ANSI 315 convention', winding:true,
      terminals:[{id:'L', dx:-42, dy:0}, {id:'R', dx:42, dy:0}],
      draw:symbol => {
        const {x,y} = symbol;
        const config = symbol.windingConfig || '';
        return path(`M${x-42} ${y}h15m54 0h15`)+circle(x-10,y,18)+circle(x+10,y,18)+windingMark(x-10,y-30,windingKind(config,0))+windingMark(x+10,y-30,windingKind(config,1));
      },
    },
    {
      id:'transformer-3winding', name:'Three-winding transformer', category:'Primary equipment', glyph:'⊕', prefix:'XF3',
      standard:'IEEE/ANSI 315 convention', winding:true,
      terminals:[{id:'L', dx:-36, dy:-8}, {id:'R', dx:36, dy:-8}, {id:'T', dx:0, dy:36}],
      draw:symbol => {
        const {x,y} = symbol;
        const config = symbol.windingConfig || '';
        return path(`M${x-36} ${y-8}h8M${x+28} ${y-8}h8M${x} ${y+26}v10`)+circle(x-12,y-8,16)+circle(x+12,y-8,16)+circle(x,y+16,16)+windingMark(x-12,y-32,windingKind(config,0))+windingMark(x+12,y-32,windingKind(config,1));
      },
    },
    {
      id:'autotransformer', name:'Autotransformer', category:'Primary equipment', glyph:'⊛', prefix:'ATX',
      standard:'IEEE/ANSI 315 convention', winding:true,
      terminals:[{id:'L', dx:-40, dy:0}, {id:'R', dx:40, dy:0}, {id:'TAP', dx:0, dy:28}],
      draw:symbol => {
        const {x,y} = symbol;
        const config = symbol.windingConfig || '';
        return path(`M${x-40} ${y}h14m52 0h14M${x} ${y+16}v12`)+circle(x-8,y,18)+circle(x+8,y,18)+windingMark(x,y-30,windingKind(config,0) || windingKind(config,1));
      },
    },
    {
      id:'generator', name:'Generator', category:'Primary equipment', glyph:'G', prefix:'GEN',
      standard:'IEEE/ANSI 315 convention',
      terminals:[{id:'T', dx:0, dy:-25}],
      draw:({x,y}) => circle(x,y,25)+text(x,y+5,'G'),
    },
    {
      id:'motor', name:'Motor', category:'Primary equipment', glyph:'M', prefix:'MTR',
      standard:'IEEE/ANSI 315 convention',
      terminals:[{id:'T', dx:0, dy:-25}],
      draw:({x,y}) => circle(x,y,25)+text(x,y+5,'M'),
    },
    {
      id:'capacitor', name:'Capacitor bank', category:'Primary equipment', glyph:'╫', prefix:'CAP',
      standard:'IEEE/ANSI 315 convention',
      terminals:[{id:'L', dx:-38, dy:0}, {id:'R', dx:38, dy:0}],
      draw:({x,y}) => path(`M${x-38} ${y}h28M${x-10} ${y-22}v44M${x+10} ${y-22}v44M${x+10} ${y}h28`),
    },
    {
      id:'reactor', name:'Reactor', category:'Primary equipment', glyph:'∿', prefix:'REA',
      standard:'IEEE/ANSI 315 convention',
      terminals:[{id:'L', dx:-38, dy:0}, {id:'R', dx:38, dy:0}],
      draw:({x,y}) => path(`M${x-38} ${y}h10q7-18 14 0t14 0t14 0t14 0h10`),
    },
    {
      id:'battery', name:'Battery', category:'Primary equipment', glyph:'▯', prefix:'BAT',
      standard:'IEEE/ANSI 315 convention',
      terminals:[{id:'L', dx:-38, dy:0}, {id:'R', dx:38, dy:0}],
      draw:({x,y}) => path(`M${x-38} ${y}h24M${x-14} ${y-22}v44M${x+8} ${y-14}v28M${x+8} ${y}h30`),
    },
    {
      id:'surge-arrester', name:'Surge arrester', category:'Primary equipment', glyph:'ϟ', prefix:'SA',
      standard:'IEEE/ANSI 315 convention',
      terminals:[{id:'L', dx:-38, dy:0}, {id:'R', dx:38, dy:0}],
      draw:({x,y}) => path(`M${x-38} ${y}h17M${x+21} ${y}h17M${x-21} ${y-18}h42v36h-42zM${x+7} ${y-14}l-14 13h10l-10 15`),
    },
    {
      id:'load', name:'General load', category:'Primary equipment', glyph:'▽', prefix:'LOD',
      standard:'IEEE/ANSI 315 convention',
      terminals:[{id:'L', dx:-38, dy:0}],
      draw:({x,y}) => path(`M${x-38} ${y}h18M${x-20} ${y-22}L${x+28} ${y}l-48 22z`),
    },
    {
      id:'ct', name:'Current transformer', category:'Measurement & protection', glyph:'CT', prefix:'CT',
      standard:'IEEE/ANSI 315 convention',
      terminals:[{id:'L', dx:-38, dy:0}, {id:'R', dx:38, dy:0}],
      draw:({x,y}) => path(`M${x-38} ${y}h76`)+circle(x,y,19)+text(x,y+4,'CT'),
    },
    {
      id:'vt', name:'Voltage transformer', category:'Measurement & protection', glyph:'VT', prefix:'VT',
      standard:'IEEE/ANSI 315 convention',
      terminals:[{id:'L', dx:-42, dy:0}, {id:'R', dx:42, dy:0}],
      draw:({x,y}) => path(`M${x-42} ${y}h15m54 0h15`)+circle(x-10,y,18)+circle(x+10,y,18)+text(x,y+4,'VT'),
    },
    {
      id:'pt', name:'Potential transformer', category:'Measurement & protection', glyph:'PT', prefix:'PT',
      standard:'IEEE/ANSI 315 convention',
      terminals:[{id:'L', dx:-42, dy:0}, {id:'R', dx:42, dy:0}],
      draw:({x,y}) => path(`M${x-42} ${y}h15m54 0h15`)+circle(x-10,y,18)+circle(x+10,y,18)+text(x,y+4,'PT'),
    },
    {
      id:'relay', name:'Protective relay', category:'Measurement & protection', glyph:'51', prefix:'RLY',
      functionNumber:'51', standard:'IEEE C37.2-2022 designation',
      terminals:[{id:'C', dx:0, dy:0}],
      draw:({x,y,deviceFunction}) => circle(x,y,25)+text(x,y+5,deviceFunction || '51'),
    },
    {
      id:'lockout', name:'Lockout relay', category:'Measurement & protection', glyph:'86', prefix:'LOR',
      functionNumber:'86', standard:'IEEE C37.2-2022 designation',
      terminals:[{id:'C', dx:0, dy:0}],
      draw:({x,y}) => circle(x,y,25)+text(x,y+5,'86'),
    },
    {
      id:'edge', name:'Legacy conductor', category:'Legacy compatibility', glyph:'—', prefix:'EDG',
      hidden:true, standard:'NorthStar legacy alias',
      terminals:[{id:'L', dx:-35, dy:0}, {id:'R', dx:35, dy:0}],
      draw:({x,y}) => path(`M${x-35} ${y}H${x+35}`),
    },
  ];

  const functions = [
    ['','None / custom'], ['25','Synchronism-check'], ['27','Undervoltage'],
    ['32','Directional power'], ['46','Negative-sequence current'], ['49','Thermal'],
    ['50','Instantaneous overcurrent'], ['50N','Instantaneous ground overcurrent'],
    ['51','Time overcurrent'], ['51N','Time ground overcurrent'], ['52','AC circuit breaker'],
    ['59','Overvoltage'], ['67','Directional overcurrent'], ['79','Reclosing'],
    ['81','Frequency'], ['86','Lockout'], ['87','Differential protection'], ['89','Line switch'],
  ];

  const windingConfigs = [
    ['','Unspecified'],
    ['dy','Delta–Wye (Δ-Y)'],
    ['yd','Wye–Delta (Y-Δ)'],
    ['yy','Wye–Wye (Y-Y)'],
    ['dd','Delta–Delta (Δ-Δ)'],
  ];

  const byId = Object.fromEntries(definitions.map(item => [item.id, item]));

  function rotateOffset(dx, dy, rotation) {
    const turns = ((Number(rotation) || 0) % 360 + 360) % 360;
    if (turns === 90) return { dx: -dy, dy: dx };
    if (turns === 180) return { dx: -dx, dy: -dy };
    if (turns === 270) return { dx: dy, dy: -dx };
    return { dx, dy };
  }

  function projectToSegment(px, py, x1, y1, x2, y2) {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const length = dx * dx + dy * dy || 1;
    const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / length));
    return { x: x1 + t * dx, y: y1 + t * dy, t };
  }

  function terminals(symbol) {
    const info = byId[symbol?.type];
    const list = info?.terminals?.length ? info.terminals : [{ id:'C', dx:0, dy:0 }];
    return list.map(term => {
      if (term.kind === 'segment') {
        const start = rotateOffset(term.dx1, term.dy1, symbol.rotation);
        const end = rotateOffset(term.dx2, term.dy2, symbol.rotation);
        return {
          id: term.id,
          kind: 'segment',
          x1: symbol.x + start.dx,
          y1: symbol.y + start.dy,
          x2: symbol.x + end.dx,
          y2: symbol.y + end.dy,
        };
      }
      const offset = rotateOffset(term.dx, term.dy, symbol.rotation);
      return { id: term.id, x: symbol.x + offset.dx, y: symbol.y + offset.dy };
    });
  }

  function snapPoint(symbol, towardX, towardY, preferredId) {
    const points = terminals(symbol).map(term => {
      if (term.kind === 'segment') {
        const projected = projectToSegment(towardX, towardY, term.x1, term.y1, term.x2, term.y2);
        return { id: term.id, kind: 'segment', x: projected.x, y: projected.y, x1: term.x1, y1: term.y1, x2: term.x2, y2: term.y2 };
      }
      return term;
    });
    if (preferredId) {
      const match = points.find(item => item.id === preferredId);
      if (match) return match;
    }
    return points.reduce((best, item) => {
      const distance = (item.x - towardX) ** 2 + (item.y - towardY) ** 2;
      return distance < best.distance ? { distance, item } : best;
    }, { distance: Infinity, item: points[0] }).item;
  }

  function draw(symbol) {
    const info = byId[symbol?.type];
    if (!info) {
      const x = Number(symbol?.x) || 0;
      const y = Number(symbol?.y) || 0;
      return `<rect class="node-shape device-unknown" x="${x-18}" y="${y-18}" width="36" height="36"/>`+text(x,y+5,'?');
    }
    return info.draw(symbol);
  }

  window.NorthStarOneLineSymbols = Object.freeze({
    profile: 'northstar-ieee-compat-2026.2',
    catalogueVersion: '2026.2',
    graphicalStandard: 'IEEE/ANSI 315-1975 (inactive-reserved)',
    designationStandard: 'IEEE C37.2-2022 (active)',
    definitions,
    functions,
    windingConfigs,
    get: id => byId[id] || null,
    draw,
    terminals,
    snapPoint,
    isSwitching: type => Boolean(byId[type]?.switching),
    isWinding: type => Boolean(byId[type]?.winding),
  });
})();
