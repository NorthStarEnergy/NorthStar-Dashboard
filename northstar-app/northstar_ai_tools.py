"""Bounded, read-only research tools. Authority comes from server policy, never model arguments."""
from __future__ import annotations

import hashlib
import json
import math
import re
from datetime import datetime
from typing import Any

import northstar_operator_knowledge as registry
import northstar_sites as sites


def function(name, description, properties):
    return {"type": "function", "name": name, "description": description, "strict": True,
            "parameters": {"type": "object", "properties": properties,
                           "required": list(properties), "additionalProperties": False}}


TEXT = {"type": "string"}
PUBLIC_TOPICS = {
    "ieso_market": ("IESO current market rules manuals hydroelectric generation dispatchable facilities market participants offers dispatch settlement Market Renewal", ["ieso.ca"]),
    "ieso_outages": ("IESO current outage management coordination planned forced outages generation reporting market manual", ["ieso.ca"]),
    "hydro_one": ("Hydro One current generation connections transmission connection requirements protection metering generators", ["hydroone.com"]),
    "nerc": ("NERC currently effective reliability standards applicability generation owners operators PRC MOD VAR Ontario", ["nerc.com", "ieso.ca"]),
    "ieee": ("IEEE standards synchronous generators protection grounding current edition IEEE C37 IEEE 80 generator protection", ["standards.ieee.org", "ieeexplore.ieee.org"]),
    "hydrology": ("Environment Canada water hydrometric discharge data quality precipitation snowmelt streamflow forecasts reservoir uncertainty", ["wateroffice.ec.gc.ca", "weather.gc.ca", "canada.ca", "usgs.gov"]),
    "electrical": ("electrical engineering synchronous generator real reactive power excitation governor three phase power transformer protection fundamentals", ["energy.gov", "ocw.mit.edu", "selinc.com"]),
    "uwpc": ("IHSA Utility Work Protection Code 2024 official amendments errata training", ["ihsa.ca"]),
}

CALCULATIONS = {
    "hydro_power": {"flow_m3s", "net_head_m", "efficiency"},
    "three_phase_power": {"line_voltage_kv", "line_current_a", "power_factor"},
    "energy": {"power_mw", "hours"},
    "water_volume": {"flow_m3s", "hours"},
    "power_triangle": {"active_mw", "reactive_mvar"},
}


def timestamp_age(timestamp, as_of):
    """Elapsed time requires explicit offsets; missing/ambiguous dates stay unknown."""
    result = {'timestamp': timestamp, 'age_hours': None, 'status': 'unknown'}
    try:
        issued = datetime.fromisoformat(str(timestamp).replace('Z', '+00:00'))
        observed = datetime.fromisoformat(str(as_of).replace('Z', '+00:00'))
        if issued.utcoffset() is None or observed.utcoffset() is None:
            return result
        hours = (observed - issued).total_seconds() / 3600
    except (TypeError, ValueError, OverflowError):
        return result
    return {**result, 'age_hours': round(hours, 2), 'status': 'future_timestamp' if hours < 0 else 'elapsed'}


def calculate(kind: str, inputs: dict) -> dict:
    if kind not in CALCULATIONS or set(inputs) != CALCULATIONS[kind]:
        raise ValueError("Supply exactly the documented calculation inputs")
    if any(isinstance(x, bool) or not isinstance(x, (int, float)) or not math.isfinite(x) or abs(x) > 1e12 for x in inputs.values()):
        raise ValueError("Inputs must be finite numbers with magnitude at most 1e12")
    x = inputs
    if kind == "hydro_power":
        if x['flow_m3s'] < 0 or x['net_head_m'] < 0 or not 0 < x['efficiency'] <= 1:
            raise ValueError("Flow/head must be nonnegative; efficiency is a fraction in (0,1]")
        values = {"power_mw": 1000 * 9.80665 * x['flow_m3s'] * x['net_head_m'] * x['efficiency'] / 1e6}
        formula = "P_MW = 1000 kg/m³ × 9.80665 m/s² × Q_m³/s × net_H_m × efficiency / 1e6"
    elif kind == "three_phase_power":
        if x['line_voltage_kv'] < 0 or x['line_current_a'] < 0 or not -1 <= x['power_factor'] <= 1:
            raise ValueError("Voltage/current magnitudes must be nonnegative; power factor in [-1,1]")
        s = math.sqrt(3) * x['line_voltage_kv'] * x['line_current_a'] / 1000
        values = {"apparent_mva": s, "active_mw": s * x['power_factor'], "reactive_mvar_magnitude": s * math.sqrt(1 - x['power_factor'] ** 2)}
        formula = "Balanced sinusoidal three-phase: S_MVA=√3 V_LL_kV I_A/1000; P=S×PF; |Q|=S√(1−PF²). Q sign needs leading/lagging convention."
    elif kind in {"energy", "water_volume"}:
        if x['hours'] < 0:
            raise ValueError("Duration must be nonnegative")
        values = {"energy_mwh": x['power_mw'] * x['hours']} if kind == 'energy' else {"volume_m3": x['flow_m3s'] * x['hours'] * 3600}
        formula = "E_MWh=P_MW×hours (constant or interval-average power)" if kind == 'energy' else "Volume_m³=Q_m³/s×hours×3600 (constant or interval-average flow)"
    else:
        s = math.hypot(x['active_mw'], x['reactive_mvar'])
        values = {"apparent_mva": s, "power_factor_magnitude": abs(x['active_mw']) / s if s else None}
        formula = "S_MVA=√(P_MW²+Q_Mvar²); |PF|=|P|/S; undefined at zero S"
    return {"inputs": x, "formula": formula, "values": values,
            "authorityStatus": "CALCULATION", "limitation": "Calculated from supplied inputs; not a measurement, equipment rating, operating limit, or dispatch instruction."}


class ResearchSession:
    MAX_CALLS = 10
    MAX_OUTPUT_CHARS = 32000

    def __init__(self, policy, public_search=None, operational_lookup=None):
        self.actor = policy['actor']
        self.site, self.allowed = registry.access(self.actor, policy.get('siteId', ''))
        self.scope = policy.get('scope', 'dashboard')
        self.current_only = bool(policy.get('currentOnly'))
        self.reference_mode = bool(policy.get('referenceMode'))
        self.public_search = public_search if policy.get('publicResearch') and not self.current_only else None
        self.operational_lookup = operational_lookup if self.allowed is None and not self.current_only and not self.reference_mode else None
        self.calls = 0
        self.public_calls = 0
        self.evidence = []
        self.citations = []
        self.trace = []
        self.seen_sources = set()
        self.cache = {}

    def tools(self):
        result = [
            function('search_evidence', 'Search approved documents and permitted recorded facts. Use focused searches and expand abbreviations. References are labelled background. Never equate no matches with no events.', {'query': TEXT}),
            function('read_passage', 'Read a retrieved source passage and up to two adjacent passages. Exact page/section citations; approval and integrity rechecked.', {'source_id': TEXT, 'ordinal': {'type': 'integer', 'minimum': 0}}),
            function('source_catalog', 'Inspect matching document titles, status, dates and availability. Pending/legacy text stays excluded.', {'query': TEXT}),
            function('calculate', 'Deterministic engineering arithmetic. Inputs: hydro_power(flow_m3s,net_head_m,efficiency fraction); three_phase_power(line_voltage_kv,line_current_a,power_factor); energy(power_mw,hours); water_volume(flow_m3s,hours); power_triangle(active_mw,reactive_mvar).', {
                'kind': {'type': 'string', 'enum': list(CALCULATIONS)},
                'inputs': {'type': 'array', 'items': {'type': 'object', 'properties': {'name': TEXT, 'value': {'type': 'number'}}, 'required': ['name', 'value'], 'additionalProperties': False}}}),
            function('dashboard_help', 'Return supported dashboard areas and assistant limitations; no operational records.', {}),
        ]
        if self.scope in {'general', 'dashboard', 'site'} and not self.reference_mode and not self.current_only:
            result += [function('dataset_rows', 'Read a bounded sample of stored dashboard data. Empty results are not proof no data exist. No writes. Site comes from server policy.', {
                'dataset': {'type': 'string', 'enum': ['water', 'weather', 'power', 'runtime', 'operations', 'generators', 'equipment', 'ecology']},
                'since': TEXT, 'until': TEXT}),
                function('inflow_status', 'Read compact saved forecast/validation status and available target names. Does not run or resume the forecast worker. Unavailable in site-restricted contexts.', {}),
                function('inflow_target', 'Read one exact target from inflow_status, including saved daily forecast, input freshness, assumptions and validation. Does not refresh data.', {'target': TEXT})]
        if self.public_search:
            result.append(function('public_research', 'Research an official public topic in an isolated request. Only a fixed public query is sent, never internal records. Verify edition, effective date and applicability; not internal operating authority.', {'topic': {'type': 'string', 'enum': list(PUBLIC_TOPICS)}}))
        if self.operational_lookup:
            result.append(function('operational_lookup', 'Re-query recorded events, outages and logbook, and the request-time market/weather snapshots. Resolve follow-up subjects from conversation, then search; never assume prior assistant claims remain current.', {'query': TEXT}))
        return result

    def _record(self, row):
        identifier = row.get('path') or row.get('id')
        if not identifier:
            return
        if any(c['id'] == identifier for c in self.citations):
            return
        self.evidence.append(row)
        self.citations.append({**{key: row.get(key) for key in ('source', 'title', 'href', 'revision', 'authorityStatus', 'page', 'section', 'sha256', 'siteId', 'recorded_at', 'retrieved_at')},
                               'id': identifier, 'source_kind': 'reference-file' if row.get('sourceId') else 'dashboard-data'})
        if row.get('sourceId'):
            self.seen_sources.add(row['sourceId'])

    def execute(self, name: str, arguments: str) -> dict:
        self.calls += 1
        if self.calls > self.MAX_CALLS:
            return {'error': 'Research call limit reached. Answer supported parts and identify gaps.'}
        valid = {t['name']: t for t in self.tools()}
        try:
            if name not in valid or len(arguments) > 4000:
                raise ValueError('Tool unavailable in this scope or arguments too large')
            args = json.loads(arguments)
            props = valid[name]['parameters']['properties']
            if not isinstance(args, dict) or set(args) != set(props):
                raise ValueError('Invalid tool arguments')
            for key, prop in props.items():
                if prop['type'] == 'string' and (not isinstance(args[key], str) or len(args[key]) > 500):
                    raise ValueError('Invalid text argument')
            cache_key = name + json.dumps(args, sort_keys=True)
            cacheable = name in {'calculate', 'dashboard_help', 'public_research'}
            if cacheable and cache_key in self.cache:
                return self.cache[cache_key]
            result = getattr(self, '_' + name)(**args)
            if len(json.dumps(result, default=str)) > self.MAX_OUTPUT_CHARS:
                result = {'error': 'Result too large. Narrow the question or inspect the linked dashboard.'}
            if cacheable:
                self.cache[cache_key] = result
            self.trace.append({'tool': name, 'status': 'unavailable' if result.get('error') else 'ok'})
            return result
        except (ValueError, TypeError, LookupError, PermissionError) as exc:
            self.trace.append({'tool': name, 'status': 'refused'})
            return {'error': str(exc)[:240]}
        except Exception:
            # Never expose database DSNs, paths, credentials, raw provider errors or stack traces.
            self.trace.append({'tool': name, 'status': 'unavailable'})
            return {'error': 'This source is unavailable. Do not infer its contents or substitute zero.'}

    def _search_evidence(self, query):
        rows = registry.search(query, 8, actor=self.actor, site_id=self.site,
                               reference_mode=self.reference_mode, current_only=self.current_only)
        if not self.current_only and not self.reference_mode:
            rows += registry.search(query, 4, actor=self.actor, site_id=self.site, reference_mode=True)
        tables = {'outages': {'outages'}, 'logbook': {'logbook'}}.get(self.scope)
        if self.scope in {'market', 'events', 'voice', 'worker-status', 'switching'}:
            rows = [r for r in rows if r.get('sourceId')]
        elif tables:
            rows = [r for r in rows if r.get('sourceId') or str(r.get('source', '')).split(':')[1] in tables]
        for row in rows:
            self._record(row)
        return {'records': rows, 'matched': len(rows), 'notice': 'Search matches, not exhaustive coverage. Reference text is not operating authority.'}

    def _read_passage(self, source_id, ordinal):
        if source_id not in self.seen_sources:
            raise ValueError('Search for this source before reading its passages')
        rows = registry.read_passages(source_id, ordinal, actor=self.actor, site_id=self.site,
                                       reference_mode=self.reference_mode, current_only=self.current_only)
        for row in rows:
            self._record(row)
        return {'records': rows}

    def _source_catalog(self, query):
        terms = registry._terms(query)
        rows = registry.catalog(self.actor, self.site)['sources']
        rows = [r for r in rows if not terms or any(t in r['title'].lower() for t in terms)][:16]
        return {'sources': [{k: r.get(k) for k in ('id', 'title', 'status', 'revision', 'aiEligible', 'review_due', 'effective_from', 'index_state', 'href')} for r in rows],
                'notice': 'Catalog metadata does not establish source contents or current approval.'}

    def _calculate(self, kind, inputs):
        if not isinstance(inputs, list) or len(inputs) > 5 or any(not isinstance(i, dict) or set(i) != {'name', 'value'} for i in inputs):
            raise ValueError('Invalid calculation inputs')
        values = {i['name']: i['value'] for i in inputs}
        if len(values) != len(inputs):
            raise ValueError('Duplicate input names')
        result = calculate(kind, values)
        identifier = 'calc_' + hashlib.sha256(json.dumps([kind, values], sort_keys=True).encode()).hexdigest()[:12]
        self._record({'id': identifier, 'source': 'calculation:' + kind, 'title': 'Calculation: ' + kind,
                      'excerpt': json.dumps(result), 'authorityStatus': 'CALCULATION', 'retrieved_at': registry.now()})
        return {'id': identifier, **result}

    def _dashboard_help(self):
        return {'areas': {
            'Overview': 'Recorded operating picture, market, weather and events.',
            'Events': 'Audit timeline and individual event reports; notes do not acknowledge alarms.',
            'Outages / UWPC': 'Outage records, controlled UWPC sources, draft work protection packages.',
            'Engineering': 'Equipment/Maximo reference, schematics and SCADA-related workspace; diagrams are not live mimics.',
            'Water / Flows': 'Gauge observations, elevations and saved inflow forecasts; preserve datum and station identity.',
            'Data': 'Typed water, weather, power, runtime, operations, equipment and ecology datasets.',
            'Knowledge library': 'Source text, exact passages, approval status, revisions and document review.',
        }, 'assistant': 'Read, explain, compare, calculate and draft. Cannot control equipment, issue permits, acknowledge alarms, update records, or certify compliance.'}

    def _dataset_rows(self, dataset, since, until):
        from northstar_data_model import fields, dataset as definition
        from northstar_data_workspace import query_rows
        columns = fields(dataset)
        time_key = next((x for x in ('observed_at', 'occurred_at', 'started_at') if x in columns), '_updated_at')
        filters = []
        for value, op in ((since, 'gte'), (until, 'lte')):
            if value:
                registry._date(value)
                filters.append({'field': time_key, 'op': op, 'value': value})
        # A restricted operator must select a site. Do not fetch a cross-site page.
        if self.allowed is not None and not self.site:
            raise PermissionError('Select an authorized site before querying datasets')
        if self.site:
            filters.append({'field': 'site', 'op': 'eq', 'value': sites.resolve(self.site)['name']})
        result = query_rows(dataset, {'filters': filters, 'sort': time_key, 'direction': 'desc', 'limit': 30})
        keep = {f['key'] for f in definition(dataset)['fields']} | {'_id', '_version', '_updated_at'}
        rows = []
        for raw in result['rows']:
            resolved = sites.resolve(raw.get('site'))
            if self.site and (not resolved or resolved['id'] != self.site):
                continue
            row = {k: v for k, v in raw.items() if k in keep}
            row = json.loads(registry.redact(json.dumps(row, default=str)))
            rows.append(row)
        evidence = {'dataset': dataset, 'rows': rows, 'hasMore': result.get('hasMore', False),
                    'sampleLimit': 30, 'filteredBy': filters, 'units': {f['key']: f['unit'] for f in definition(dataset)['fields'] if f.get('unit')},
                    'notice': 'Bounded stored sample, not a complete history or live SCADA. Do not derive totals or causal weather relationships from this sample.'}
        identifier = 'data_' + hashlib.sha256(json.dumps(evidence, sort_keys=True, default=str).encode()).hexdigest()[:12]
        self._record({'id': identifier, 'source': 'dataset:' + dataset, 'title': definition(dataset)['name'], 'excerpt': json.dumps(evidence, default=str),
                      'authorityStatus': 'RECORDED_FACT', 'retrieved_at': registry.now()})
        return {'id': identifier, **evidence}

    def _inflow_status(self):
        return self._inflow_read('')

    def _inflow_target(self, target):
        if not target.strip():
            raise ValueError('Select an exact target name from inflow_status')
        return self._inflow_read(target)

    def _inflow_read(self, target):
        if self.site or self.allowed is not None:
            raise PermissionError('Portfolio inflow output is unavailable in a site-restricted context')
        import northstar_inflow
        payload = northstar_inflow.request('GET', '/api/inflows/status', {})
        # Explicit saved-output projections keep a large validation archive bounded.
        latest = payload.get('latest') or {}
        targets = latest.get('targets') or []
        if target:
            targets = [row for row in targets if row.get('target') == target]
            if not targets:
                raise LookupError('Unknown inflow target; use an exact name from inflow_status')
        target_fields = {'target', 'zone', 'status', 'latest_flow_date', 'flow_age_days', 'flow_source', 'quality', 'level_m', 'upstream_m3s', 'weather_retrieved_at', 'flags', 'mean14_m3s', 'operating_assumption', 'wetness'}
        if target:
            target_fields |= {'days', 'state', 'soil_state_date', 'soil_temperature_c', 'snow_depth_m'}
        validation = payload.get('validation') or {}
        scores = payload.get('scores') or {}
        selected_scores = [r for r in scores.get('targets', []) if not target or r.get('target') == target]
        as_of = registry.now()
        payload = {
            'freshness': {'as_of': as_of,
                          'issuance': timestamp_age(latest.get('issued_at'), as_of),
                          'last_refresh': timestamp_age((payload.get('refresh_status') or {}).get('finished_at'), as_of),
                          'note': 'Use these server-calculated elapsed ages, not mental timezone arithmetic. Target flow_age_days is saved at issuance, not recomputed at request time. Retrieval time does not refresh the forecast.'},
            'latest': {**{k: latest.get(k) for k in ('id','issued_at','origin','kind','model_version','weather_provenance','uncertainty')},
                       'targets': [{k:v for k,v in row.items() if k in target_fields} for row in targets[:12]]},
            'validation': {k: validation.get(k) for k in ('kind','independent_validation','note','periods','models_tested')},
            'scores': {'completed_daily_predictions': scores.get('completed_daily_predictions'), 'targets': selected_scores[:30], 'note': scores.get('note')},
            'integration': {k:(payload.get('integration') or {}).get(k) for k in ('enabled','running','error','next_check_at','collection_interval_seconds')},
            'data_inventory': [r for r in payload.get('data_inventory', []) if not target or r.get('target') == target][:12],
            'refresh_status': {k:(payload.get('refresh_status') or {}).get(k) for k in ('started_at','finished_at','run_id','workbook_watermark','live_weather_checked_at')},
            'projection': 'At most 12 targets and 30 score rows. Detailed historical validation tables remain in the inflow dashboard.',
        }
        identifier = 'inflow_' + hashlib.sha256(json.dumps(payload, sort_keys=True, default=str).encode()).hexdigest()[:12]
        self._record({'id': identifier, 'source': 'inflow:saved-status', 'title': 'Saved inflow status', 'excerpt': registry.redact(json.dumps(payload, default=str)),
                      'authorityStatus': 'MODEL_OUTPUT', 'retrieved_at': registry.now()})
        return {'id': identifier, 'saved': json.loads(registry.redact(json.dumps(payload, default=str))),
                'limitations': 'Saved issuance time governs freshness; paused is not live. Gauge discharge is not automatically plant inflow. Historical fits using realized weather do not prove prospective forecast skill. Do not call residual ranges calibrated probabilities or prescribe releases.'}

    def _public_research(self, topic):
        if topic not in PUBLIC_TOPICS or not self.public_search or self.public_calls >= 2:
            raise ValueError('Public research unavailable or its two-topic budget is exhausted')
        self.public_calls += 1
        result = self.public_search(*PUBLIC_TOPICS[topic])
        for citation in result.get('citations', []):
            citation['authorityStatus'] = 'PUBLIC_BACKGROUND'
            if not any(c['id'] == citation['id'] for c in self.citations):
                self.citations.append(citation)
        self.evidence.append({'publicResearch': result})
        return result

    def _operational_lookup(self, query):
        if not self.operational_lookup:
            raise PermissionError('Operational lookup is unavailable in this scope')
        records, citations = self.operational_lookup(query)
        result = {'records': records, 'citations': citations, 'notice': 'Bounded recorded evidence; timestamps govern freshness. Missing matches do not establish equipment state.'}
        if len(json.dumps(result, default=str)) > self.MAX_OUTPUT_CHARS:
            return {'error': 'Too much matching operational evidence; narrow the query.'}
        known = {c['id'] for c in self.citations}
        self.citations.extend(c for c in citations if c['id'] not in known)
        self.evidence.append(result)
        return result
