"""Behavior and provenance checks for the recovered draft, separate from legacy exercises."""
import copy
import hashlib
import importlib.util
import json
import tempfile
import unittest
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

    def test_all_96_targets_have_provenance_and_21_units(self):
        s=session();snap=s.snapshot()
        self.assertEqual(snap['modelId'],MODEL_ID)
        self.assertEqual(s.events[0]['detail']['modelId'],MODEL_ID)
        self.assertEqual(len(snap['drawingBindings']),96)
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

    def test_all_18_connected_units_start_sync_load_and_stop(self):
        s=session();gens=[d for d in s._generators() if not d['controlBlocked']]
        self.assertEqual(len(gens),18)
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
        for id,action in [('IR-G11','start'),('IR-52G11','close_dead'),('UNRESOLVED-IS-TSS1','close'),('CTS-T4-LV','open'),('CTS-ISL1','open')]:
            before=copy.deepcopy(s.states[id])
            choice=s.select('operator',dict(equipmentId=id,action=action,expectedControlRevision=s.control_revision))
            self.assertEqual(choice['permissives'][0]['code'],'UNVERIFIED_TOPOLOGY')
            with self.assertRaises(SimError):s.execute('operator',dict(selectionToken=choice['selectionToken'],expectedControlRevision=s.control_revision,idempotencyKey=id))
            self.assertEqual(s.states[id],before)
        for i in [11,12,13]:self.assertEqual(s._node(f'IR-G{i}-UNRESOLVED-600V')['voltagePu'],0)
        self.assertEqual(s._device('UNRESOLVED-IS-TSS1')['terminals'],[])

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
