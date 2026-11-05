"""Research correctness, authority, privacy and budget regressions; no live providers."""
import base64
import json
import math
import os
import tempfile
from pathlib import Path
from unittest import mock

import pytest
import northstar_ai as ai
import northstar_ai_tools as tools
import northstar_operator_knowledge as registry
import northstar_store as store


@pytest.fixture
def library(monkeypatch):
    with tempfile.TemporaryDirectory() as tmp:
        monkeypatch.setattr(store, 'DB_PATH', Path(tmp) / 'test.db')
        monkeypatch.setenv('NORTHSTAR_AI_SITE_ACCESS', '')
        store.init_db()
        def create(status='CURRENT_CONTROLLED', site='', key='fixture'):
            source = registry.upload({'title': 'Fixture generator reference', 'filename': 'fixture.md',
                'sourceKey': key, 'siteId': site, 'revision': '1', 'owner': 'Fixture owner',
                'contentBase64': base64.b64encode(('Generator excitation reference.\n' * 200).encode()).decode()}, 'fixture-reviewer')
            if status != 'PENDING_REVIEW':
                registry.review(source['id'], {'status': status, 'reason': 'Synthetic test source',
                    'confirmed': True, 'effective_from': '2020-01-01', 'review_due': '2099-01-01'}, 'fixture-reviewer')
            return source
        yield create


def session(**kwargs):
    return tools.ResearchSession({'actor': 'fixture', 'scope': 'dashboard', **kwargs})


def test_passages_recheck_approval_integrity_and_site(library, monkeypatch):
    source = library(site='site:kenora')
    s = session(siteId='site:kenora')
    rows = s.execute('search_evidence', '{"query":"excitation"}')['records']
    ordinal = int(rows[0]['path'].split(':')[-1])
    assert s.execute('read_passage', json.dumps({'source_id': source['id'], 'ordinal': ordinal}))['records']
    with pytest.raises(LookupError):
        registry.read_passages(source['id'], ordinal, site_id='site:iroquois-falls')
    monkeypatch.setenv('NORTHSTAR_AI_SITE_ACCESS', '{"fixture":["site:iroquois-falls"]}')
    assert 'error' in s.execute('read_passage', json.dumps({'source_id': source['id'], 'ordinal': ordinal + 1}))


def test_pending_reference_expired_and_tampered_sources(library):
    pending = library(status='PENDING_REVIEW')
    with pytest.raises(LookupError):
        registry.read_passages(pending['id'], 1)
    registry.review(pending['id'], {'status':'REFERENCE_ONLY','reason':'Study only'}, 'fixture')
    rows = registry.read_passages(pending['id'], 1)
    assert rows[0]['authorityStatus'] == 'REFERENCE_ONLY'
    with pytest.raises(LookupError):
        registry.read_passages(pending['id'], 1, current_only=True)
    current = library(key='current')
    with store._session() as con:
        con.execute("UPDATE operator_knowledge_sources SET review_due='2021-01-01' WHERE id=?", (current['id'],))
        path = con.execute('SELECT file_path FROM operator_knowledge_sources WHERE id=?',(pending['id'],)).fetchone()[0]
    with pytest.raises(LookupError):
        registry.read_passages(current['id'], 1)
    registry._path(path).write_text('tampered')
    with pytest.raises(ValueError, match='checksum'):
        registry.read_passages(pending['id'], 1)


@pytest.mark.parametrize('kind,inputs,key,expected', [
    ('hydro_power', {'flow_m3s':100,'net_head_m':20,'efficiency':0.9}, 'power_mw',17.65197),
    ('energy', {'power_mw':12,'hours':0.25}, 'energy_mwh',3),
    ('water_volume', {'flow_m3s':10,'hours':2}, 'volume_m3',72000),
    ('power_triangle', {'active_mw':3,'reactive_mvar':4}, 'apparent_mva',5),
    ('three_phase_power', {'line_voltage_kv':13.8,'line_current_a':1000,'power_factor':0.9}, 'active_mw',math.sqrt(3)*13.8*.9),
])
def test_calculations_units(kind,inputs,key,expected):
    assert tools.calculate(kind, inputs)['values'][key] == pytest.approx(expected)


@pytest.mark.parametrize('inputs', [
    {'flow_m3s':100,'net_head_m':20,'efficiency':90},
    {'flow_m3s':None,'net_head_m':20,'efficiency':.9},
    {'flow_m3s':float('nan'),'net_head_m':20,'efficiency':.9},
    {'flow_m3s':True,'net_head_m':20,'efficiency':.9},
    {'flow_m3s':-1,'net_head_m':20,'efficiency':.9},
])
def test_invalid_inputs_never_become_zero(inputs):
    with pytest.raises(ValueError): tools.calculate('hydro_power', inputs)


def test_only_allowlisted_tools_and_bounded_calls():
    s = session()
    assert 'error' in s.execute('run_sql', '{"sql":"SELECT * FROM auth"}')
    assert 'error' in s.execute('calculate', '{"kind":"energy","inputs":[],"actor":"admin"}')
    for _ in range(10): s.execute('dashboard_help', '{}')
    assert 'limit' in s.execute('dashboard_help','{}')['error']
    assert 'inflow_status' not in {t['name'] for t in session(scope='logbook').tools()}


def test_public_queries_are_fixed_and_cannot_receive_private_context():
    callback = mock.Mock(return_value={'briefing':'Official background','citations':[]})
    s = tools.ResearchSession({'actor':'fixture','scope':'dashboard','publicResearch':True}, callback)
    assert 'error' in s.execute('public_research', '{"topic":"secret site outage"}')
    assert 'error' in s.execute('public_research', '{"topic":"ieso_market","query":"private text"}')
    s.execute('public_research', '{"topic":"ieso_market"}')
    assert callback.call_args.args == tools.PUBLIC_TOPICS['ieso_market']


def test_restricted_datasets_never_query_cross_site(monkeypatch):
    monkeypatch.setenv('NORTHSTAR_AI_SITE_ACCESS','{"fixture":["site:kenora"]}')
    with mock.patch('northstar_data_workspace.query_rows') as read:
        result = session().execute('dataset_rows', '{"dataset":"water","since":"","until":""}')
        assert 'error' in result
        read.assert_not_called()
        read.return_value = {'rows':[{'site':'Iroquois Falls','flow_m3s':99},{'site':'Kenora','flow_m3s':None,'_actor':'private name'}], 'hasMore': True}
        result = session(siteId='site:kenora').execute('dataset_rows','{"dataset":"water","since":"","until":""}')
        assert result['rows'] == [{'site':'Kenora','flow_m3s':None}]
        assert result['hasMore'] is True
        assert {'field':'site','op':'eq','value':'Kenora'} in read.call_args.args[1]['filters']


def test_tool_failures_do_not_leak_secrets():
    with mock.patch('northstar_inflow.request', side_effect=RuntimeError('password=private-dsn')):
        result = session().execute('inflow_status','{}')
        assert 'private-dsn' not in json.dumps(result)
        assert 'unavailable' in result['error']


def test_model_roundtrip_preserves_reasoning_and_tool_citations(monkeypatch):
    responses = [
        {'status':'completed','output':[{'type':'reasoning','id':'reason','encrypted_content':'encrypted-fixture','summary':[]},
            {'type':'function_call','call_id':'call_1','name':'calculate','arguments':json.dumps({'kind':'energy','inputs':[{'name':'power_mw','value':12},{'name':'hours','value':.25}]})}]},
    ]
    requests = []
    def send(req, **kw):
        payload = json.loads(req.data); requests.append(payload)
        if len(requests) == 1: result = responses[0]
        else:
            output = json.loads(payload['input'][-1]['output'])
            result = {'status':'completed','output':[{'type':'message','content':[{'type':'output_text','text':f"The energy is 3 MWh [{output['id']}]."}]}]}
        response = mock.MagicMock(); response.__enter__.return_value.read.return_value = json.dumps(result).encode(); return response
    context = {'scope':'dashboard','controlledRetrieval':True,'citations':[], 'records':[],
               '_tool_policy': {'actor':'fixture','scope':'dashboard','publicResearch':False},'sourceMode':'internal'}
    with mock.patch.object(ai,'_openai_api_key',return_value='fixture'), mock.patch.object(ai,'validate_model_settings',return_value=('fixture','low')), mock.patch.object(ai.urllib.request,'urlopen',side_effect=send):
        answer, _ = ai._run_openai_engine('12 MW for 15 minutes?',context)
    assert '3 MWh' in answer
    assert requests[1]['input'][1]['encrypted_content'] == 'encrypted-fixture'
    assert requests[1]['input'][-1]['call_id'] == 'call_1'
    assert context['citations'][0]['authorityStatus'] == 'CALCULATION'
    assert context['researchSteps'] == [{'tool':'calculate','status':'ok'}]
    assert all(t['type']=='function' for t in requests[0]['tools'])
    assert 'public_research' not in {t['name'] for t in requests[0]['tools']}
    assert requests[0]['store'] is False


def test_general_explanation_and_procedure_intents():
    assert not ai._procedure_question('Explain the difference between a work permit and supporting guarantee')
    assert ai._procedure_question('What does our current approved procedure require?')
    assert ai._operational_action('Give the switching sequence to open breaker 52-1')


def test_repeated_passage_read_observes_withdrawal(library):
    source = library()
    s = session()
    s.execute('search_evidence','{"query":"excitation"}')
    args = json.dumps({'source_id':source['id'],'ordinal':1})
    assert s.execute('read_passage',args)['records']
    registry.review(source['id'],{'status':'WITHDRAWN','reason':'Fixture withdrawal'},'fixture')
    assert 'error' in s.execute('read_passage',args)


def test_operational_lookup_not_available_to_restricted_actor(monkeypatch):
    monkeypatch.setenv('NORTHSTAR_AI_SITE_ACCESS','{"fixture":["site:kenora"]}')
    callback = mock.Mock()
    s = tools.ResearchSession({'actor':'fixture','scope':'dashboard','siteId':'site:kenora'}, operational_lookup=callback)
    assert 'error' in s.execute('operational_lookup','{"query":"all sites"}')
    callback.assert_not_called()


def test_unknown_source_id_fails_closed_even_with_no_initial_evidence(monkeypatch):
    monkeypatch.setattr(ai,'_build_context',lambda *a,**k:{'scope':'general','records':[],'citations':[],'summary':'No matching evidence'})
    monkeypatch.setattr(ai,'engine_name',lambda:'openai')
    monkeypatch.setattr(ai,'_run_openai_engine',lambda *a,**k:('Claim [oks_deadbeef:1]',[]))
    result=ai.query('Explain',persist=False)
    assert result['label']=='Retrieved evidence (citation check)'
    assert 'Claim' not in result['answer']


def test_stale_empty_market_is_not_a_fresh_citation():
    assert ai._retrieve_market(None)[1] == []
    assert ai._retrieve_market({'stale':True,'nodes':{'node':{'rt':1}}})[1] == []


def test_large_inflow_archive_is_projected_without_losing_freshness_or_daily_target():
    payload={'latest':{'issued_at':'2026-01-01T00:00:00Z','targets':[{'target':'Fixture','status':'stale','days':[{'date':'2026-01-02','flow_m3s':None}]}]},
             'validation':{'independent_validation':False,'summary':['large archive']*20000},'integration':{'enabled':False}}
    with mock.patch('northstar_inflow.request',return_value=payload) as read:
        s=session()
        status=s.execute('inflow_status','{}')
        detail=s.execute('inflow_target','{"target":"Fixture"}')
    assert len(json.dumps(status)) < 32000
    assert status['saved']['integration']['enabled'] is False
    assert status['saved']['validation']['independent_validation'] is False
    assert detail['saved']['latest']['targets'][0]['days'][0]['flow_m3s'] is None
    assert all(call.args[0]=='GET' for call in read.call_args_list)


def test_inflow_age_across_utc_and_eastern_midnight():
    # Regression: the model previously reported 38.5 h for this 46.5 h interval.
    payload = {'latest': {'issued_at': '2026-10-28T04:13:00Z', 'targets': []},
               'refresh_status': {'finished_at': '2026-10-28T04:13:00+00:00'}}
    with mock.patch('northstar_inflow.request', return_value=payload), mock.patch.object(registry, 'now', return_value='2026-10-29T22:43:00-04:00'):
        result = session().execute('inflow_status', '{}')
    freshness = result['saved']['freshness']
    assert freshness['issuance']['age_hours'] == 46.5
    assert freshness['last_refresh']['age_hours'] == 46.5
    assert freshness['issuance']['status'] == 'elapsed'


@pytest.mark.parametrize('stamp', [None, '', 'bad-date', '2026-10-28', '2026-10-28T04:13:00'])
def test_unknown_or_offsetless_time_does_not_invent_freshness(stamp):
    assert tools.timestamp_age(stamp, '2026-10-29T22:43:00-04:00')['age_hours'] is None


def test_future_issuance_is_flagged_instead_of_clamped_to_fresh():
    result = tools.timestamp_age('2026-10-30T01:00:00Z', '2026-10-30T00:00:00Z')
    assert result['status'] == 'future_timestamp'
    assert result['age_hours'] == -1
