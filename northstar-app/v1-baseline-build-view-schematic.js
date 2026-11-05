/* Saved single-line geometry, shared symbol catalogue and exact read-only SCADA bindings. */
((scope) => {
  'use strict';
  const esc = v => String(v ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  function deviceName(symbol, readings, available = true) {
    const candidates = [symbol.scada, ...(symbol.measurements || [])].filter(b=>b?.feedCode && b?.tagName);
    for (const b of candidates) {
      const matches = available ? readings.filter(r=>r.feedCode===b.feedCode && r.tagName===b.tagName && (!symbol.siteCode || r.siteCode===symbol.siteCode)) : [];
      if (matches.length === 1) return {name:matches[0].tagName, source:'SCADA', manual:false};
    }
    return {name:symbol.assetTag || symbol.label || symbol.id, source:candidates.length?'Manual fallback · binding unresolved':'Manual', manual:true};
  }
  function render(record, readings = [], available = false) {
    const lib = scope.NorthStarOneLineSymbols, live = scope.NorthStarOneLineLive;
    if (!lib || !live) return '<p>Single-line catalogue unavailable. Reload to retry.</p>';
    const symbols = Array.isArray(record?.symbols) ? record.symbols : [];
    if (!symbols.length) return '<p>No devices in this drawing. Open the schematic builder to configure it.</p>';
    const byId = new Map(symbols.map(s=>[s.id,s]));
    const wires = (record.edges || []).map(edge=>{
      const from=byId.get(edge.from),to=byId.get(edge.to); if(!from || !to)return '';
      const a=lib.snapPoint(from,to.x,to.y,edge.fromTerminal),b=lib.snapPoint(to,from.x,from.y,edge.toTerminal),mid=Math.round((a.x+b.x)/40)*20;
      return '<path class="bv2-wire" d="M'+a.x+' '+a.y+' H'+mid+' V'+b.y+' H'+b.x+'"/>';
    }).join('');
    const devices=symbols.map(s=>{
      const name=deviceName(s,readings,available), info=lib.get(s.type);
      const feedback=live.position(live.binding(s.scada),readings,Date.now(),available,s.siteCode);
      const unknown=info?.switching && !['open','closed'].includes(feedback.state);
      const drawn={...s, operatingState:feedback.state==='closed'?'closed':'open'};
      const geometry=unknown?'<rect class="node-shape" x="'+(s.x-18)+'" y="'+(s.y-18)+'" width="36" height="36"/><text x="'+s.x+'" y="'+(s.y+5)+'">?</text>':lib.draw(drawn);
      const values=(s.measurements || []).map((b,i)=>{
        const v=live.resolve(live.binding(b),readings,Date.now(),available,s.siteCode);
        return '<text class="bv2-reading" x="'+s.x+'" y="'+(s.y+75+i*15)+'">'+esc((b.label || 'Value')+': '+(v.state==='good'?v.value+' '+(b.unit || v.unit):'— '+v.label))+'</text>';
      }).join('');
      return '<g class="bv2-device '+(unknown?'bv2-unknown':'')+'"><title>'+esc(name.source+' · '+(s.description || '')+' · '+feedback.label)+'</title><g transform="rotate('+(Number(s.rotation)||0)+' '+s.x+' '+s.y+')">'+geometry+'</g><text class="bv2-device-name" x="'+s.x+'" y="'+(s.y+43)+'">'+esc(name.name)+'</text><text class="bv2-device-caption" x="'+s.x+'" y="'+(s.y+58)+'">'+esc(info?.switching?feedback.label:(s.voltage || info?.name || s.type))+'</text>'+values+'</g>';
    }).join('');
    const height=Math.max(560,...symbols.map(s=>Number(s.y)+100+(s.measurements?.length || 0)*15));
    return '<svg class="bv2-schematic" viewBox="0 0 1000 '+height+'" role="img" aria-label="Saved single-line drawing with read-only SCADA feedback">'+wires+devices+'</svg>';
  }
  const api={deviceName,render};
  if (typeof module !== 'undefined') module.exports=api;
  else scope.NorthStarBuildSchematic=api;
})(typeof window === 'undefined' ? globalThis : window);
