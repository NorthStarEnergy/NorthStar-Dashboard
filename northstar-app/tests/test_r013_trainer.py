"""Behavior and provenance checks for the recovered draft, separate from legacy exercises."""
import copy
import hashlib
import importlib.util
import json
import tempfile
import unittest
import xml.etree.ElementTree as ET
from pathlib import Path
from northstar_sim.r013 import R013Session, MODEL_ID
from northstar_sim.model import load_model
from northstar_sim.engine import SimError
from northstar_sim.service import SimulatorService, PREFIX
from tests.test_complex_trainer import advance, command

ROOT=Path(__file__).resolve().parents[1]
FIX=ROOT/'northstar_sim/fixtures'


def session(scenario='R013-NORMAL'):
    model,_=load_model(FIX/'is-tw-ir-r013.model.json')
    scenarios=json.loads((FIX/'is-tw-ir-r013-scenarios.json').read_text())['scenarios']
    s=R013Session(model,next(x for x in scenarios if x['scenarioId']==scenario),'operator',1)
    s.clock('run')
    return s


class R013Tests(unittest.TestCase):
    def test_original_hashes_and_reproducible_fixture(self):
        assets=ROOT/'trainer-assets/r013'
        manifest=json.loads((assets/'source-manifest.json').read_text())
        self.assertEqual(manifest['sha256']['original.svg'],'67d8ab929f6f9a08b49dfd475884b71e1bbd3cd4ffb3e5756d71a719c069a819')
        for name,digest in manifest['sha256'].items():self.assertEqual(hashlib.sha256((assets/name).read_bytes()).hexdigest(),digest)
        spec=importlib.util.spec_from_file_location('build_r013',ROOT/'scripts/build-r013-fixture.py')
        module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
        model,scenarios=module.build()
        self.assertEqual(model,json.loads((FIX/'is-tw-ir-r013.model.json').read_text()))
        self.assertEqual(scenarios,json.loads((FIX/'is-tw-ir-r013-scenarios.json').read_text()))

    def test_all_99_targets_have_provenance_and_21_units(self):
        s=session();snap=s.snapshot()
        self.assertEqual(snap['modelId'],MODEL_ID)
        self.assertEqual(s.events[0]['detail']['modelId'],MODEL_ID)
        self.assertEqual(len(snap['drawingBindings']),99)
        self.assertEqual(len(s._generators()),21)
        self.assertEqual(s.model['readiness'],'draft_site_model')
        self.assertTrue(all(s._device(id).get('verification') and s._device(id).get('sourceDetails') for id in snap['drawingBindings'].values()))
        for st,count in [('IS',4),('TF',5),('IR',12)]:
            self.assertEqual(sum(g['parameters']['station']==st for g in s._generators()),count)

    def test_t8_loss_only_cuts_tw_l2_and_ir_l1(self):
        s=session('R013-T8-LOSS')
        for n in ['TF-B2','IR-B1']:self.assertEqual(s._node(n)['voltagePu'],0)
        for n in ['TF-B1','IR-B2','IS-B1','IS-B2']:self.assertGreater(s._node(n)['voltagePu'],.9)
        command(s,'CTS-TIE','close_dead')
        for n in ['TF-B2','IR-B1']:self.assertGreater(s._node(n)['voltagePu'],.9)

    def test_t9_loss_only_cuts_tw_l1_and_ir_l2(self):
        s=session('R013-T9-LOSS')
        for n in ['TF-B1','IR-B2']:self.assertEqual(s._node(n)['voltagePu'],0)
        for n in ['TF-B2','IR-B1','IS-B1','IS-B2']:self.assertGreater(s._node(n)['voltagePu'],.9)
        command(s,'TF-52BT','close_dead')
        self.assertGreater(s._node('TF-B1')['voltagePu'],.9)

    def test_m1_parallel_supply_independent_of_t8_t9(self):
        s=session();command(s,'CTS-52-T4','open')
        self.assertGreater(s._node('IS-B1')['voltagePu'],.9)
        command(s,'CTS-52-T7','open')
        for n in ['IS-B1','IS-B2']:self.assertEqual(s._node(n)['voltagePu'],0)
        for n in ['TF-B1','TF-B2','IR-B1','IR-B2']:self.assertGreater(s._node(n)['voltagePu'],.9)

    def test_island_hv_and_lv_are_distinct_and_do_not_cut_twin(self):
        s=session();command(s,'IS-L2-LV','open')
        self.assertEqual(s.states['IS-L2-HV']['position'],'closed')
        self.assertEqual(s._node('IS-B2')['voltagePu'],0)
        for n in ['IS-B1','TF-B1','IR-B1']:self.assertGreater(s._node(n)['voltagePu'],.9)
        command(s,'IS-L2-LV','close_dead');command(s,'IS-L2-HV','open')
        self.assertEqual(s._node('IS-B2')['voltagePu'],0)
        self.assertEqual(s.states['IS-L2-LV']['position'],'closed')

    def test_island_loss_scenario_restores_without_crossfeed(self):
        s=session('R013-IS-L1-LOSS')
        self.assertEqual(s._node('IS-B1')['voltagePu'],0)
        self.assertGreater(s._node('IS-B2')['voltagePu'],.9)
        command(s,'IS-L1-HV','close_dead')
        self.assertGreater(s._node('IS-B1')['voltagePu'],.9)

    def test_all_21_connected_units_start_sync_load_and_stop(self):
        s=session();gens=[d for d in s._generators() if not d['controlBlocked']]
        self.assertEqual(len(gens),21)
        for d in gens:command(s,d['equipmentId'],'start',wait=.1)
        advance(s,16)
        for d in gens:
            self.assertEqual(s.states[d['equipmentId']]['sequenceState'],'READY')
            command(s,d['parameters']['breaker'],'close')
        command(s,'IS-G3','setpoint',5,'MW');advance(s,8)
        self.assertGreater(s.states['IS-G3']['activeMW'],4.9)
        self.assertEqual(s.states['IS-G4']['requestedMW'],1)
        self.assertGreater(s.states['IS-G3']['currentA'],200)
        for d in gens:command(s,d['equipmentId'],'stop',wait=.1)
        advance(s,18)
        self.assertTrue(all(s.states[d['equipmentId']]['sequenceState']=='STOPPED' for d in gens))
        self.assertTrue(s.finish()['objectiveAchieved'])

    def test_unresolved_devices_refused_server_side_and_remain_isolated(self):
        s=session()
        for id,action in [('UNRESOLVED-IS-TSS1','close'),('CTS-T4-LV','open'),('CTS-ISL1','open')]:
            before=copy.deepcopy(s.states[id])
            choice=s.select('operator',dict(equipmentId=id,action=action,expectedControlRevision=s.control_revision))
            self.assertEqual(choice['permissives'][0]['code'],'UNVERIFIED_TOPOLOGY')
            with self.assertRaises(SimError):s.execute('operator',dict(selectionToken=choice['selectionToken'],expectedControlRevision=s.control_revision,idempotencyKey=id))
            self.assertEqual(s.states[id],before)
        self.assertEqual(s._device('UNRESOLVED-IS-TSS1')['terminals'],[])

    def test_common_600v_bus_l3_isolation_and_voltage_ratio(self):
        s=session()
        self.assertEqual(s.model['revision'],2)
        for i in [11,12,13]:
            self.assertEqual(s._device(f'IR-G{i}')['parameters']['bus'],'IR-B600')
            self.assertEqual(s._device(f'IR-52G{i}')['terminals'][1]['nodeId'],'IR-B600')
            self.assertFalse(s._device(f'IR-G{i}')['controlBlocked'])
        self.assertEqual([t['nodeId'] for t in s._device('IR-52L3')['terminals']],['IR-B2','IR-L3-TX-HV'])
        self.assertEqual([t['nodeId'] for t in s._device('IR-T-600V')['terminals']],['IR-L3-TX-HV','IR-B600'])
        self.assertAlmostEqual(s._node('IR-B600')['voltageKVLL'],.6)
        self.assertAlmostEqual(s._node('IR-B2')['voltageKVLL'],12.5)
        command(s,'IR-52L3','open')
        self.assertEqual(s._node('IR-B600')['voltageKVLL'],0)
        self.assertGreater(s._node('IR-B2')['voltageKVLL'],12)
        command(s,'IR-52L3','close_dead')
        self.assertAlmostEqual(s._node('IR-B600')['voltageKVLL'],.6)
        lost=session('R013-T9-LOSS')
        self.assertEqual(lost._node('IR-B600')['voltageKVLL'],0)
        self.assertIn('training assumptions',s._device('IR-T-600V')['verification']['note'])

    def test_low_voltage_units_export_through_l3_transformer(self):
        s=session()
        for i in [11,12,13]:command(s,f'IR-G{i}','start',wait=.1)
        advance(s,16)
        for i in [11,12,13]:command(s,f'IR-52G{i}','close')
        advance(s,8)
        snap=s.snapshot()
        flow=snap['electrical']['branches']['IR-T-600V']
        self.assertLess(flow['activeMW'],-2.5)
        self.assertGreater(flow['secondaryCurrentA'],flow['currentA']*19)
        for i in [11,12,13]:self.assertEqual(s.states[f'IR-G{i}']['sequenceState'],'ONLINE')

    def test_runtime_switch_geometry_and_user_route(self):
        svg=ET.fromstring((ROOT/'trainer-assets/r013/runtime.svg').read_text(encoding='utf-8'))
        ns={'s':'http://www.w3.org/2000/svg'}
        groups={e.get('data-device'):e for e in svg.findall('.//s:g[@data-device]',ns)}
        for key in ['TW-52L1','TW-52L2','IR-52L3']:
            g=groups[key];symbol=g.find('s:g[@data-northstar-symbol="breaker"]',ns)
            self.assertIn('scale(0.62)',symbol.get('transform'))
            self.assertIn('52-L',g.find('s:title',ns).text)
        for bar in svg.findall('.//s:path[@data-position-bar]',ns):
            self.assertEqual(bar.get('d'),'M-13 0 H13')
        self.assertIn('IR-T-600V',groups)
        self.assertIn('IR-B600',groups)
        route=svg.find('s:g[@data-user-confirmed-route="IR-600V"]',ns)
        self.assertIsNotNone(route)
        self.assertGreater(list(svg).index(route),max(i for i,e in enumerate(svg) if e.tag.endswith('rect')))
        self.assertNotIn('step-up routing unresolved',' '.join(svg.itertext()))

    def test_uniform_labels_generator_size_and_straight_transformer_leads(self):
        svg=ET.fromstring((ROOT/'trainer-assets/r013/runtime.svg').read_text(encoding='utf-8'))
        ns={'s':'http://www.w3.org/2000/svg'}
        groups={e.get('data-device'):e for e in svg.findall('.//s:g[@data-device]',ns)}
        for key,g in groups.items():
            for text in g.findall('s:text',ns):
                self.assertIn(text.get('font-size'),['18','22'],key)
            symbol=g.find('s:g[@data-northstar-symbol="generator"]',ns)
            if symbol is not None:
                self.assertIn('scale(0.68)',symbol.get('transform'))
                unit=groups[key+'-52'].find('s:g[@data-northstar-symbol="breaker"]',ns)
                self.assertIn('scale(0.62)',unit.get('transform'))
                self.assertGreaterEqual(50*.68,44*.62)
                self.assertEqual(len(groups[key+'-52'].findall('s:text[@data-device-label="primary"]',ns)),1)
            transformer=g.find('s:g[@data-northstar-symbol="transformer"]',ns)
            if transformer is not None:
                leads=transformer.find('s:path[@data-straight-leads]',ns)
                self.assertEqual(leads.get('d'),'M0 -28 V-19 M0 19 V28')
                self.assertEqual(len(transformer.findall('s:circle',ns)),2)

    def test_disconnector_requires_its_own_breaker_open(self):
        s=session();d=s._device('CTS-89-T8')
        self.assertIn('LOAD_BREAK_NOT_PERMITTED',[x['code'] for x in s._permissives(d,'open')])
        command(s,'CTS-52-T8','open');command(s,'CTS-89-T8','open')
        self.assertEqual(s.states['CTS-89-T8']['position'],'open')

    def test_no_legacy_incomers_or_transformer_aliases(self):
        s=session()
        for id in ['IR-T5','IR-T6','IR-INCOMER2','IR-52-17','IR-52-31','IR-52-30']:
            self.assertNotIn(id,s.states)
        self.assertEqual(s._device('CTS-T4-LV')['type'],'circuit_switcher')
        self.assertEqual(s._device('IS-G4')['parameters']['ratedMW'],11)
        self.assertEqual(s._device('TF-G1')['parameters']['ratedMVA'],5.5)

    def test_api_persistence_reset_and_legacy_coexistence(self):
        with tempfile.TemporaryDirectory() as tmp:
            service=SimulatorService(tmp,background=False)
            code,models=service.handle('GET',PREFIX+'/models',None,'operator')
            self.assertEqual(code,200)
            self.assertIn(MODEL_ID,[m['modelId'] for m in models['models']])
            code,snap=service.handle('POST',PREFIX+'/sessions',dict(modelId=MODEL_ID,scenarioId='R013-T8-LOSS'),'operator')
            self.assertEqual(code,201)
            restored=SimulatorService(tmp,background=False).sessions[snap['sessionId']]
            self.assertIsInstance(restored,R013Session)
            self.assertEqual(restored.snapshot()['drawingBindings'],snap['drawingBindings'])
            self.assertEqual(restored.status,'paused')
            restored.finish();reset=restored.reset()
            self.assertEqual(reset['modelId'],MODEL_ID)
            self.assertEqual(restored._node('TF-B2')['voltagePu'],0)
            code,legacy=service.handle('POST',PREFIX+'/sessions',dict(modelId='SIM-TWIN-IROQUOIS',scenarioId='COMPLEX-NORMAL'),'operator')
            self.assertEqual(code,201);self.assertFalse(legacy.get('r013',False))


if __name__=='__main__':unittest.main()
