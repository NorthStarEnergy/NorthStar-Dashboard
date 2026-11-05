/* Read-only schematic bindings. Saved drawings contain configuration, never telemetry. */
((scope) => {
  'use strict';
  const text = (value, max = 160) => String(value ?? '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, max);
  function binding(value = {}) {
    return {
      feedCode: text(value?.feedCode, 80), tagName: text(value?.tagName),
      openValue: text(value?.openValue ?? '0', 80), closedValue: text(value?.closedValue ?? '1', 80),
      staleAfterSeconds: Math.max(10, Math.min(86400, Number(value?.staleAfterSeconds) || 1800)),
    };
  }
  function metadata(value) {
    return {
      assetTag: text(value?.assetTag), siteCode: text(value?.siteCode, 80),
      voltage: text(value?.voltage, 80), description: text(value?.description, 320),
      scada: binding(value?.scada),
      measurements: (Array.isArray(value?.measurements) ? value.measurements : []).slice(0, 6).map(item => ({
        ...binding(item), label: text(item?.label, 80), unit: text(item?.unit, 32),
      })),
    };
  }
  function resolve(config, readings, now = Date.now(), available = true, siteCode = '') {
    if (!config.tagName) return {state:'unbound', label:'NOT BOUND'};
    if (!available) return {state:'unknown', label:'UNAVAILABLE'};
    if (!config.feedCode) return {state:'unknown', label:'SELECT FEED'};
    const matches = readings.filter(r => r.tagName === config.tagName && r.feedCode === config.feedCode && (!siteCode || r.siteCode === siteCode));
    if (matches.length !== 1) return {state:'unknown', label:matches.length ? 'AMBIGUOUS' : 'NO DATA'};
    const reading = matches[0], observed = Date.parse(reading.observedAt);
    const info = {observedAt:reading.observedAt, quality:reading.sourceQuality || 'UNQUALIFIED', tagName:reading.tagName};
    if (!Number.isFinite(observed) || observed > now + 60000) return {...info, state:'unknown', label:'INVALID TIME'};
    if (now - observed > config.staleAfterSeconds * 1000) return {...info, state:'unknown', label:'STALE'};
    if (!['good', 'valid', 'ok'].includes(String(reading.sourceQuality || '').trim().toLowerCase())) return {...info, state:'unknown', label:'BAD / UNKNOWN QUALITY'};
    const raw = reading.numericValue ?? reading.textValue;
    if (raw === null || raw === undefined || String(raw).trim() === '' || (typeof raw === 'number' && !Number.isFinite(raw))) return {...info, state:'unknown', label:'NO VALUE'};
    return {...info, state:'good', value:raw, unit:reading.unit || '', label:String(raw)};
  }
  function position(config, readings, now, available, siteCode) {
    const result = resolve(config, readings, now, available, siteCode);
    if (result.state !== 'good') return result;
    const token = value => String(value).trim().toLowerCase();
    if (!config.openValue || !config.closedValue || token(config.openValue) === token(config.closedValue)) return {...result, state:'unknown', label:'INVALID MAPPING'};
    const value = token(result.value);
    if (value === token(config.openValue)) return {...result, state:'open', label:'OPEN'};
    if (value === token(config.closedValue)) return {...result, state:'closed', label:'CLOSED'};
    return {...result, state:'unknown', label:'UNMAPPED VALUE'};
  }
  const api = {binding, metadata, resolve, position};
  if (typeof module !== 'undefined') module.exports = api;
  else scope.NorthStarOneLineLive = api;
})(typeof window !== 'undefined' ? window : globalThis);
