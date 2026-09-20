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
  const zigzag = (x, y) => `M${x-38} ${y}h6l7-11 12 22 12-22 12 22 7-11h6`;
  const diodeBody = (x, y) => path(`M${x-38} ${y}h16M${x-22} ${y}L${x+10} ${y-16}L${x+10} ${y+16}Z`)+path(`M${x+10} ${y-16}v32M${x+10} ${y}h28`);
  const powerCells = (x, y) => path(`M${x-38} ${y}h12M${x-22} ${y-20}v40M${x-10} ${y-12}v24M${x+2} ${y-20}v40M${x+14} ${y-12}v24M${x+14} ${y}h24`)+text(x-26,y-26,'+');
  const rotaryLine = (x, y, open, reach = 14) => open
    ? `M${x} ${y-reach}v${reach * 2}`
    : `M${x-reach} ${y}h${reach * 2}`;
  const rotarySwitch = (x, y, open) => circle(x, y, 16)+path(rotaryLine(x, y, open, 14));
  const boxedRotary = (x, y, open, throughSquare = false) => {
    const box = `<rect class="node-shape${open ? ' device-open' : ''}" x="${x-22}" y="${y-22}" width="44" height="44" rx="1"/>`;
    const line = path(rotaryLine(x, y, open, throughSquare ? 22 : 14));
    return box+circle(x, y, 16)+line;
  };
  const fuseArm = (x, y, open) => {
    const dots = circle(x-20, y, 3)+circle(x+20, y, 3);
    const leads = path(`M${x-38} ${y}h18M${x+20} ${y}h18`);
    if (open) {
      return leads+dots+path(`M${x-20} ${y}L${x+12} ${y-22}`)+`<g transform="rotate(-35 ${x-2} ${y-10})"><rect class="node-shape device-open" x="${x-14}" y="${y-16}" width="24" height="12" rx="2"/></g>`;
    }
    return leads+dots+path(`M${x-20} ${y}h40`)+`<rect class="node-shape" x="${x-12}" y="${y-7}" width="24" height="14" rx="2"/>`;
  };
  const meterFace = (x, y, label) => path(`M${x-38} ${y}h13M${x+25} ${y}h13`)+circle(x,y,25)+text(x,y+5,label);
  const xfmrPair = (x, y, config = '') => path(`M${x-42} ${y}h15m54 0h15`)+circle(x-10,y,18)+circle(x+10,y,18)+windingMark(x-10,y-30,windingKind(config,0))+windingMark(x+10,y-30,windingKind(config,1));
  const staticLoad = (x, y) => path(`M${x-38} ${y}h10`)+`<rect class="node-shape" x="${x-28}" y="${y-18}" width="56" height="36"/>`+path(`M${x+28} ${y}h10`)+text(x,y+4,'LOAD');
  const aliases = {
    ldr: 'light-sensor',
    photoresistor: 'light-sensor',
    capacitior: 'capacitor-element',
    'line-switch': 'disconnect',
    'circuit-switching': 'circuit-switcher',
    'circuit-switch': 'circuit-switcher',
    hvi: 'hv-interrupter',
    'high-voltage-interrupter': 'hv-interrupter',
    'vacuum-breaker': 'breaker-vacuum',
    'sf6-breaker': 'breaker-sf6',
    ccvt: 'cvt',
    cutout: 'fuse-dropout',
    'dropout-fuse': 'fuse-dropout',
    'fuse-cutout': 'fuse-dropout',
    mod: 'disconnect-mod',
    'motor-operated-disconnect': 'disconnect-mod',
    gsu: 'transformer-gsu',
    ammeter: 'meter-ammeter',
    voltmeter: 'meter-voltmeter',
    kwh: 'meter-kwh',
    'energy-meter': 'meter-kwh',
    multifunction: 'meter-multifunction',
    'pq-meter': 'meter-multifunction',
  };
  const canonicalType = id => aliases[String(id || '')] || String(id || '');

  const definitions = [
    {
      id:'source', name:'AC source / utility', category:'Network', glyph:'∿', prefix:'SRC',
      standard:'FirstLight static single-line convention',
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
      standard:'FirstLight static single-line convention',
      terminals:[{id:'L', dx:-38, dy:0}, {id:'R', dx:38, dy:0}],
      draw:({x,y}) => path(`M${x-38} ${y}H${x+38}`),
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
      id:'disconnect', name:'Line switch', category:'Primary equipment', glyph:'⊕', prefix:'DSC',
      functionNumber:'89', standard:'FirstLight static single-line convention', switching:true,
      terminals:[{id:'L', dx:-34, dy:0}, {id:'R', dx:34, dy:0}],
      draw:symbol => {
        const {x,y} = symbol;
        return fuseArm(x,y,isOpen(symbol));
      },
    },
    {
      id:'breaker', name:'AC circuit breaker', category:'Primary equipment', glyph:'▣', prefix:'CBR',
      functionNumber:'52', standard:'Workplace one-line convention', switching:true,
      terminals:[{id:'L', dx:-38, dy:0}, {id:'R', dx:38, dy:0}],
      draw:symbol => {
        const {x,y} = symbol;
        return path(`M${x-38} ${y}h16M${x+22} ${y}h16`)+boxedRotary(x,y,isOpen(symbol),false);
      },
    },
    {
      id:'breaker-vacuum', name:'Vacuum circuit breaker', category:'Primary equipment', glyph:'V', prefix:'VCB',
      functionNumber:'52', standard:'Workplace one-line convention', switching:true,
      terminals:[{id:'L', dx:-38, dy:0}, {id:'R', dx:38, dy:0}],
      draw:symbol => {
        const {x,y} = symbol;
        const open = isOpen(symbol);
        return path(`M${x-38} ${y}h10M${x+28} ${y}h10`)+
          `<ellipse class="node-shape${open ? ' device-open' : ''}" cx="${x}" cy="${y}" rx="12" ry="22"/>`+
          path(open ? `M${x-6} ${y-6}L${x+8} ${y-14}` : `M${x-8} ${y}h16`)+
          text(x,y+36,'V');
      },
    },
    {
      id:'breaker-sf6', name:'SF₆ circuit breaker', category:'Primary equipment', glyph:'SF', prefix:'SF6',
      functionNumber:'52', standard:'Workplace one-line convention', switching:true,
      terminals:[{id:'L', dx:-38, dy:0}, {id:'R', dx:38, dy:0}],
      draw:symbol => {
        const {x,y} = symbol;
        return path(`M${x-38} ${y}h16M${x+22} ${y}h16`)+boxedRotary(x,y,isOpen(symbol),false)+text(x,y+36,'SF6');
      },
    },
    {
      id:'hv-interrupter', name:'HV interrupter', category:'Primary equipment', glyph:'⬡', prefix:'HVI',
      functionNumber:'89', standard:'Workplace one-line convention', switching:true,
      terminals:[{id:'L', dx:-38, dy:0}, {id:'R', dx:38, dy:0}],
      draw:symbol => {
        const {x,y} = symbol;
        const open = isOpen(symbol);
        return path(`M${x-38} ${y}h12M${x+26} ${y}h12`)+
          `<ellipse class="node-shape${open ? ' device-open' : ''}" cx="${x-2}" cy="${y}" rx="14" ry="20"/>`+
          (open ? path(`M${x+12} ${y}L${x+22} ${y-16}`)+circle(x+12,y,3) : path(`M${x+12} ${y}h14`)+circle(x+12,y,3)+circle(x+26,y,3))+
          text(x,y+36,'HVI');
      },
    },
    {
      id:'circuit-switcher', name:'Circuit switcher', category:'Primary equipment', glyph:'⊞', prefix:'CS',
      functionNumber:'52', standard:'Workplace one-line convention', switching:true,
      terminals:[{id:'L', dx:-38, dy:0}, {id:'R', dx:38, dy:0}],
      draw:symbol => {
        const {x,y} = symbol;
        return path(`M${x-38} ${y}h16M${x+22} ${y}h16`)+boxedRotary(x,y,isOpen(symbol),true);
      },
    },
    {
      id:'fuse', name:'Fuse', category:'Primary equipment', glyph:'▭', prefix:'FUS',
      standard:'Workplace one-line convention', switching:true,
      terminals:[{id:'L', dx:-38, dy:0}, {id:'R', dx:38, dy:0}],
      draw:symbol => fuseArm(symbol.x, symbol.y, isOpen(symbol)),
    },
    {
      id:'fuse-dropout', name:'Dropout fuse / cutout', category:'Primary equipment', glyph:'ꜜ', prefix:'CUT',
      standard:'Workplace one-line convention', switching:true,
      terminals:[{id:'L', dx:-38, dy:0}, {id:'R', dx:38, dy:0}],
      draw:symbol => {
        const {x,y} = symbol;
        const open = isOpen(symbol);
        const hinge = circle(x-18, y, 3)+path(`M${x-38} ${y}h20`);
        if (open) {
          return hinge+path(`M${x+20} ${y}h18`)+circle(x+20,y,3)+
            `<g transform="rotate(70 ${x-18} ${y})"><rect class="node-shape device-open" x="${x-14}" y="${y-7}" width="28" height="14" rx="2"/>`+
            path(`M${x+14} ${y}h8`)+`</g>`+text(x,y+36,'DO');
        }
        return hinge+path(`M${x-18} ${y}h38`)+circle(x+20,y,3)+path(`M${x+20} ${y}h18`)+
          `<rect class="node-shape" x="${x-10}" y="${y-8}" width="28" height="16" rx="2"/>`+text(x,y+36,'DO');
      },
    },
    {
      id:'disconnect-mod', name:'Motor-operated disconnect', category:'Primary equipment', glyph:'M⊕', prefix:'MOD',
      functionNumber:'89', standard:'Workplace one-line convention', switching:true,
      terminals:[{id:'L', dx:-34, dy:0}, {id:'R', dx:34, dy:0}],
      draw:symbol => {
        const {x,y} = symbol;
        return fuseArm(x,y,isOpen(symbol))+circle(x,y+28,12)+text(x,y+32,'M');
      },
    },
    {
      id:'load-break', name:'Load-break switch', category:'Primary equipment', glyph:'⊗', prefix:'LBS',
      functionNumber:'89', standard:'FirstLight static single-line convention', switching:true,
      terminals:[{id:'L', dx:-34, dy:0}, {id:'R', dx:34, dy:0}],
      draw:symbol => {
        const {x,y} = symbol;
        return fuseArm(x,y,isOpen(symbol))+path(`M${x+10} ${y-22}q10-8 16 4`);
      },
    },
    {
      id:'recloser', name:'Recloser', category:'Primary equipment', glyph:'↺', prefix:'RCL',
      functionNumber:'52', standard:'Workplace one-line convention', switching:true,
      terminals:[{id:'L', dx:-38, dy:0}, {id:'R', dx:38, dy:0}],
      draw:symbol => {
        const {x,y} = symbol;
        return path(`M${x-38} ${y}h16M${x+22} ${y}h16`)+boxedRotary(x,y,isOpen(symbol),false)+text(x,y+34,'R');
      },
    },
    {
      id:'sectionalizer', name:'Sectionalizer', category:'Primary equipment', glyph:'S', prefix:'SEC',
      functionNumber:'89', standard:'FirstLight static single-line convention', switching:true,
      terminals:[{id:'L', dx:-34, dy:0}, {id:'R', dx:34, dy:0}],
      draw:symbol => {
        const {x,y} = symbol;
        return fuseArm(x,y,isOpen(symbol))+text(x,y+30,'S');
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
      id:'transformer-gsu', name:'GSU transformer', category:'Primary equipment', glyph:'G↑', prefix:'GSU',
      standard:'IEEE/ANSI 315 convention', winding:true,
      terminals:[{id:'L', dx:-42, dy:0}, {id:'R', dx:42, dy:0}],
      draw:symbol => {
        const {x,y} = symbol;
        return xfmrPair(x, y, symbol.windingConfig || '')+text(x,y+4,'GSU');
      },
    },
    {
      id:'generator', name:'Generator', category:'Primary equipment', glyph:'G', prefix:'GEN',
      standard:'FirstLight static single-line convention',
      terminals:[{id:'T', dx:0, dy:-25}],
      draw:({x,y}) => circle(x,y,25)+path(`M${x-14} ${y}q7-13 14 0t14 0`),
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
      draw:({x,y}) => powerCells(x,y),
    },
    {
      id:'surge-arrester', name:'Surge arrester', category:'Primary equipment', glyph:'ϟ', prefix:'SA',
      standard:'IEEE/ANSI 315 convention',
      terminals:[{id:'L', dx:-38, dy:0}, {id:'R', dx:38, dy:0}],
      draw:({x,y}) => path(`M${x-38} ${y}h17M${x+21} ${y}h17M${x-21} ${y-18}h42v36h-42zM${x+7} ${y-14}l-14 13h10l-10 15`),
    },
    {
      id:'load', name:'General load', category:'Primary equipment', glyph:'▽', prefix:'LOD',
      standard:'FirstLight static single-line convention',
      terminals:[{id:'L', dx:-38, dy:0}],
      draw:({x,y}) => staticLoad(x,y),
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
      id:'cvt', name:'Capacitive voltage transformer', category:'Measurement & protection', glyph:'CV', prefix:'CVT',
      standard:'IEEE/ANSI 315 convention',
      terminals:[{id:'L', dx:-42, dy:0}, {id:'R', dx:42, dy:0}],
      draw:({x,y}) => path(`M${x-42} ${y}h14M${x-28} ${y-16}v32M${x-18} ${y-16}v32M${x-18} ${y}h8`)+
        circle(x+4,y,16)+circle(x+22,y,16)+path(`M${x+38} ${y}h4`)+text(x+12,y+4,'CVT'),
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
      id:'meter-ammeter', name:'Ammeter', category:'Metering', glyph:'A', prefix:'AM',
      standard:'IEEE/ANSI 315 convention',
      terminals:[{id:'L', dx:-38, dy:0}, {id:'R', dx:38, dy:0}],
      draw:({x,y}) => meterFace(x,y,'A'),
    },
    {
      id:'meter-voltmeter', name:'Voltmeter', category:'Metering', glyph:'V', prefix:'VM',
      standard:'IEEE/ANSI 315 convention',
      terminals:[{id:'L', dx:-38, dy:0}, {id:'R', dx:38, dy:0}],
      draw:({x,y}) => meterFace(x,y,'V'),
    },
    {
      id:'meter-kwh', name:'Kilowatt-hour meter', category:'Metering', glyph:'Wh', prefix:'KWH',
      standard:'IEEE/ANSI 315 convention',
      terminals:[{id:'L', dx:-38, dy:0}, {id:'R', dx:38, dy:0}],
      draw:({x,y}) => meterFace(x,y,'Wh'),
    },
    {
      id:'meter-multifunction', name:'Multifunction meter', category:'Metering', glyph:'M', prefix:'MFM',
      standard:'IEEE/ANSI 315 convention',
      terminals:[{id:'L', dx:-38, dy:0}, {id:'R', dx:38, dy:0}],
      draw:({x,y}) => path(`M${x-38} ${y}h10M${x+28} ${y}h10`)+
        `<rect class="node-shape" x="${x-28}" y="${y-22}" width="56" height="44" rx="2"/>`+text(x,y+5,'M'),
    },
    {
      id:'capacitor-element', name:'Capacitor', category:'Circuit notation', glyph:'||', prefix:'CEL',
      standard:'Workplace Figure A-1 circuit notation',
      terminals:[{id:'L', dx:-38, dy:0}, {id:'R', dx:38, dy:0}],
      draw:({x,y}) => path(`M${x-38} ${y}h24M${x-14} ${y-16}v32M${x+14} ${y-16}v32M${x+14} ${y}h24`),
    },
    {
      id:'resistor', name:'Resistor', category:'Circuit notation', glyph:'Ω', prefix:'RES',
      standard:'Workplace Figure A-1 circuit notation',
      terminals:[{id:'L', dx:-38, dy:0}, {id:'R', dx:38, dy:0}],
      draw:({x,y}) => path(zigzag(x,y)),
    },
    {
      id:'light-sensor', name:'Light resistive sensor', category:'Circuit notation', glyph:'☀', prefix:'LDR',
      standard:'Workplace Figure A-1 circuit notation',
      terminals:[{id:'L', dx:-38, dy:0}, {id:'R', dx:38, dy:0}],
      draw:({x,y}) => path(zigzag(x,y))+path(`M${x-16} ${y+18}L${x+22} ${y-20}M${x+10} ${y-26}L${x-2} ${y-10}M${x+20} ${y-24}L${x+8} ${y-8}`),
    },
    {
      id:'diode', name:'Diode', category:'Circuit notation', glyph:'▷|', prefix:'DIO',
      standard:'Workplace Figure A-1 circuit notation',
      terminals:[{id:'L', dx:-38, dy:0}, {id:'R', dx:38, dy:0}],
      draw:({x,y}) => diodeBody(x,y),
    },
    {
      id:'transistor', name:'Transistor', category:'Circuit notation', glyph:'Q', prefix:'Q',
      standard:'Workplace Figure A-1 circuit notation',
      terminals:[{id:'B', dx:-38, dy:0}, {id:'C', dx:18, dy:-18}, {id:'E', dx:18, dy:18}],
      draw:({x,y}) => circle(x,y,22)+path(`M${x-38} ${y}h20M${x-18} ${y-14}v28M${x-18} ${y-6}L${x+16} ${y-16}M${x-18} ${y+6}L${x+16} ${y+16}M${x+8} ${y+12}L${x+16} ${y+16}L${x+6} ${y+18}`),
    },
    {
      id:'inductor', name:'Inductor', category:'Circuit notation', glyph:'m', prefix:'IND',
      standard:'Workplace Figure A-1 circuit notation',
      terminals:[{id:'L', dx:-38, dy:0}, {id:'R', dx:38, dy:0}],
      draw:({x,y}) => path(`M${x-38} ${y}h6a8 10 0 0 1 16 0a8 10 0 0 1 16 0a8 10 0 0 1 16 0a8 10 0 0 1 16 0h6`),
    },
    {
      id:'switch', name:'Switch', category:'Circuit notation', glyph:'⫯', prefix:'SW',
      standard:'Workplace Figure A-1 circuit notation', switching:true,
      terminals:[{id:'L', dx:-34, dy:0}, {id:'R', dx:34, dy:0}],
      draw:symbol => {
        const {x,y} = symbol;
        return path(`M${x-34} ${y}h14m26 0h28${blade(x,y,isOpen(symbol))}`)+circle(x-20,y,3)+circle(x+6,y,3);
      },
    },
    {
      id:'lamp', name:'Lamp', category:'Circuit notation', glyph:'*', prefix:'LMP',
      standard:'Workplace Figure A-1 circuit notation',
      terminals:[{id:'L', dx:-38, dy:0}, {id:'R', dx:38, dy:0}],
      draw:({x,y}) => path(`M${x-38} ${y}h18M${x+20} ${y}h18`)+circle(x,y,20)+path(`M${x-10} ${y+8}a4 3 0 0 1 0-8c4-8 16-8 20 0a4 3 0 0 1 0 8`),
    },
    {
      id:'power', name:'Power', category:'Circuit notation', glyph:'+', prefix:'PWR',
      standard:'Workplace Figure A-1 circuit notation',
      terminals:[{id:'L', dx:-38, dy:0}, {id:'R', dx:38, dy:0}],
      draw:({x,y}) => powerCells(x,y),
    },
    {
      id:'potentiometer', name:'Potentiometer', category:'Circuit notation', glyph:'⊢', prefix:'POT',
      standard:'Workplace Figure A-1 circuit notation',
      terminals:[{id:'L', dx:-38, dy:0}, {id:'R', dx:38, dy:0}, {id:'WIPER', dx:36, dy:0}],
      draw:({x,y}) => path(`M${x-38} ${y}h22M${x+16} ${y}h22`)+`<rect class="node-shape" x="${x-12}" y="${y-22}" width="24" height="44" rx="1"/>`+path(`M${x+36} ${y}L${x+12} ${y}M${x+20} ${y-6}L${x+12} ${y}L${x+20} ${y+6}`),
    },
    {
      id:'led', name:'LED', category:'Circuit notation', glyph:'▷', prefix:'LED',
      standard:'Workplace Figure A-1 circuit notation',
      terminals:[{id:'L', dx:-38, dy:0}, {id:'R', dx:38, dy:0}],
      draw:({x,y}) => diodeBody(x,y)+path(`M${x-2} ${y-20}l14-12M${x+8} ${y-18}l14-12M${x+8} ${y-32}h5v5M${x+18} ${y-30}h5v5`),
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
    const info = byId[canonicalType(symbol?.type)];
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
    const info = byId[canonicalType(symbol?.type)];
    if (!info) {
      const x = Number(symbol?.x) || 0;
      const y = Number(symbol?.y) || 0;
      return `<rect class="node-shape device-unknown" x="${x-18}" y="${y-18}" width="36" height="36"/>`+text(x,y+5,'?');
    }
    return info.draw(symbol);
  }

  window.NorthStarOneLineSymbols = Object.freeze({
    profile: 'northstar-ieee-compat-2026.4',
    catalogueVersion: '2026.4',
    notationSource: 'Workplace Figure A-1 circuit notation',
    graphicalStandard: 'IEEE/ANSI 315-1975 (inactive-reserved)',
    designationStandard: 'IEEE C37.2-2022 (active)',
    definitions,
    functions,
    windingConfigs,
    aliases,
    get: id => byId[canonicalType(id)] || null,
    draw,
    terminals,
    snapPoint,
    isSwitching: type => Boolean(byId[canonicalType(type)]?.switching),
    isWinding: type => Boolean(byId[canonicalType(type)]?.winding),
  });
})();
