"""Behavior tests for the source-inspired, isolated complex trainer."""
import copy
import json
import unittest
import tempfile
from pathlib import Path
from northstar_sim.complex import ComplexSession
from northstar_sim.engine import SimError
from northstar_sim.service import SimulatorService, PREFIX

FIXTURES = Path(__file__).resolve().parents[1] / 'northstar_sim' / 'fixtures'

def session(scenario='COMPLEX-NORMAL'):
    model=json.loads((FIXTURES/'twin-iroquois.model.json').read_text())
    scenarios=json.loads((FIXTURES/'twin-iroquois-scenarios.json').read_text())['scenarios']
    s=ComplexSession(model,next(x for x in scenarios if x['scenarioId']==scenario),'operator',1)
    s.clock('run')
    return s

def advance(s, seconds):
    for _ in range(round(seconds*10)):s.tick()

def command(s, equipment, action, value=None, unit=None, wait=1.6):
    payload=dict(equipmentId=equipment,action=action,expectedControlRevision=s.control_revision)
    if value is not None:payload.update(requestedValue=value,unit=unit)
    chosen=s.select('operator',payload)
    if chosen['permissives']:raise AssertionError((equipment,action,chosen['permissives']))
    result=s.execute('operator',dict(selectionToken=chosen['selectionToken'],expectedControlRevision=s.control_revision,idempotencyKey=str(s.sequence)))
    advance(s,wait)
    if wait and s.commands[result['commandId']]['lifecycle']=='failed':raise AssertionError(s.commands[result['commandId']])
    return result

class ComplexTests(unittest.TestCase):
    def test_all_units_start_independently_and_stop(self):
        s=session()
        for d in s._generators():command(s,d['equipmentId'],'start',wait=.1)
        advance(s,14)
        self.assertEqual(len(s._generators()),17)
        self.assertNotIn('IR-G10',s.states)
        for d in s._generators():
            self.assertEqual(s.states[d['equipmentId']]['sequenceState'],'READY')
            command(s,d['parameters']['breaker'],'close')
        command(s,'TF-G2','setpoint',2,'MW')
        self.assertEqual(s.states['TF-G3']['requestedMW'],1)
        advance(s,3)
        self.assertGreater(s.states['TF-G2']['activeMW'],1.9)
        for d in s._generators():command(s,d['equipmentId'],'stop',wait=.1)
        advance(s,15)
        self.assertTrue(all(s.states[d['equipmentId']]['sequenceState']=='STOPPED' for d in s._generators()))
        self.assertTrue(s.finish()['objectiveAchieved'])

    def test_blackstart_island_restore_and_reconnect(self):
        s=session('COMPLEX-BLACKSTART')
        self.assertEqual(s._node('TF-A')['voltagePu'],0)
        self.assertTrue(s._permissives(s._device('TF-G1'),'start'))
        command(s,'TF-G1','black_start')
        advance(s,6)
        command(s,'TF-52G1','close_dead')
        advance(s,12)
        self.assertEqual(s.states['TF-G1']['sequenceState'],'ONLINE')
        self.assertGreater(s._node('TF-SS1')['voltagePu'],.9)
        self.assertFalse(s._node('TF-A')['gridConnected'])
        self.assertFalse(s.unit['milestones'].get('reconnected',False))
        command(s,'IR-A1L93','close_dead')
        command(s,'TF-52L1','synchronize')
        for _ in range(120):
            advance(s,1)
            if not s._permissives(s._device('TF-52L1'),'close'):break
        command(s,'TF-52L1','close')
        self.assertTrue(s._node('TF-A')['gridConnected'])
        self.assertTrue(s.finish()['objectiveAchieved'])

    def test_running_complex_island_and_reconnect(self):
        s=session('COMPLEX-ISLAND')
        command(s,'IR-A1L93','open')
        advance(s,20)
        self.assertFalse(s._node('IR-12C')['gridConnected'])
        self.assertGreater(s._node('IR-12C')['frequencyHz'],59)
        command(s,'IR-A1L93','synchronize')
        for _ in range(120):
            advance(s,1)
            if not s._permissives(s._device('IR-A1L93'),'close'):break
        command(s,'IR-A1L93','close')
        self.assertTrue(s._node('TF-A')['gridConnected'])

    def test_twin_blackstart_supplies_iroquois_without_grid(self):
        s=session('COMPLEX-BLACKSTART')
        command(s,'TF-G1','black_start');advance(s,6);command(s,'TF-52G1','close_dead');advance(s,8)
        command(s,'TF-G2','start');advance(s,12);command(s,'TF-52G2','close');advance(s,8)
        command(s,'TF-52L1','close_dead');advance(s,20)
        self.assertEqual(s.states['IR-A1L93']['position'],'open')
        self.assertGreater(s._node('IR-SS1')['voltagePu'],.9)
        self.assertFalse(s._node('IR-SS1')['gridConnected'])
        command(s,'IR-G1','start');advance(s,12);command(s,'IR-52G1','close');advance(s,5)
        self.assertEqual(s.states['IR-G1']['sequenceState'],'ONLINE')

    def test_two_independent_twin_islands(self):
        s=session('COMPLEX-BLACKSTART')
        # All three breaks partition the two Twin unit buses.
        command(s,'TF-52BT','open')
        for g in ['TF-G1','TF-G4']:
            command(s,g,'black_start');advance(s,6);command(s,g.replace('-G','-52G'),'close_dead')
        advance(s,10)
        self.assertNotEqual(s._node('TF-A')['islandId'],s._node('TF-B')['islandId'])
        self.assertGreater(s._node('TF-A')['voltagePu'],.9)
        self.assertGreater(s._node('TF-B')['voltagePu'],.9)

    def test_water_balance_and_gate_travel(self):
        s=session();before=s.states['TF-POND']['storageM3']
        command(s,'TF-SPILL1','set_spill',1.5,'m')
        advance(s,12)
        self.assertAlmostEqual(s.states['TF-SPILL1']['positionM'],1.5)
        self.assertGreater(s.states['TF-POND']['spillFlowM3S'],0)
        self.assertLess(s.states['TF-POND']['storageM3'],before)
        self.assertEqual(s.states['IR-SPILL1']['positionM'],0)

    def test_trip_resets_never_restart(self):
        s=session('COMPLEX-ISLAND');command(s,'TF-G1','emergency_stop')
        self.assertEqual(s.states['TF-52G1']['position'],'open')
        self.assertTrue(s.states['TF-G1']['lockout86'])
        command(s,'TF-G1','reset_86');command(s,'TF-G1','reset_94');command(s,'TF-52G1','reset_lockout')
        advance(s,10)
        self.assertEqual(s.states['TF-G1']['sequenceState'],'STOPPED')
        self.assertEqual(s.states['TF-52G1']['position'],'open')

    def test_live_ground_and_isolator_rejected(self):
        s=session()
        self.assertIn('BUS_LIVE',[x['code'] for x in s._permissives(s._device('IR-T4-HV-G'),'close')])
        self.assertIn('LOAD_BREAK_NOT_PERMITTED',[x['code'] for x in s._permissives(s._device('IR-89-T4-HV'),'open')])

    def test_aux_loss_trips_unit(self):
        s=session('COMPLEX-ISLAND')
        command(s,'TF-WATER','stop');advance(s,4)
        self.assertEqual(s.states['TF-G1']['sequenceState'],'LOCKED_OUT')
        self.assertEqual(s.states['TF-G1']['tripCause'],'AUXILIARY_SUPPLY_LOST')

    def test_voltage_levels_and_tap(self):
        s=session()
        self.assertAlmostEqual(s._node('IR-HV')['voltageKVLL'],230)
        self.assertAlmostEqual(s._node('IR-120A')['voltageKVLL'],120,delta=1)
        self.assertAlmostEqual(s._node('TF-A')['voltageKVLL'],12,delta=.1)
        self.assertAlmostEqual(s._node('TF-SS1')['voltageKVLL'],.6,delta=.01)
        before=s._node('IR-T4-LV')['voltagePu'];command(s,'IR-T4','tap_raise')
        self.assertGreater(s._node('IR-T4-LV')['voltagePu'],before)

    def test_automatic_blackstart_has_breaker_travel(self):
        s=session('COMPLEX-BLACKSTART')
        command(s,'TF-G1','blackstart_auto');command(s,'TF-G1','black_start')
        advance(s,4.6)
        self.assertEqual(s.states['TF-52G1']['position'],'open')
        self.assertTrue(any(p['purpose']=='black_start' for p in s.pending))
        advance(s,1)
        self.assertEqual(s.states['TF-52G1']['position'],'closed')
        self.assertGreater(s._node('TF-SS1')['voltagePu'],.9)

    def test_station_service_transfer_break_before_make_and_return(self):
        s=session()
        s.states['TF-TSS1']['healthy']=False;s._settle()
        advance(s,5)
        self.assertEqual(s.states['TF-52SS1']['position'],'open')
        self.assertEqual(s.states['TF-52SSBT']['position'],'closed')
        self.assertGreater(s._node('TF-SS1')['voltagePu'],.9)
        s.states['TF-TSS1']['healthy']=True;s._settle();advance(s,5)
        self.assertEqual(s.states['TF-52SSBT']['position'],'open')
        self.assertEqual(s.states['TF-52SS1']['position'],'closed')

    def test_execution_rechecks_sync_after_breaker_travel(self):
        s=session();command(s,'TF-G1','start');advance(s,12)
        result=command(s,'TF-52G1','close',wait=0)
        s.states['TF-G1'].update(syncMode='manual',frequencyHz=61,speedTrimHz=1)
        s._settle();advance(s,1)
        self.assertEqual(s.states['TF-52G1']['position'],'open')
        self.assertEqual(s.commands[result['commandId']]['failureReason'],'SYNC_CHECK_FAILED')

    def test_no_false_island_from_ready_unit_or_other_grid_unit(self):
        s=session('COMPLEX-ISLAND')
        command(s,'TF-52L1','open');command(s,'TF-52L2','open')
        advance(s,1)
        self.assertTrue(s.unit['milestones']['island_formed'])
        self.assertFalse(s.unit['milestones'].get('reconnected',False))
        s=session();command(s,'TF-G1','start');advance(s,10)
        self.assertFalse(s.unit['milestones'].get('island_formed',False))

    def test_parallel_taps_and_source_control_variants(self):
        s=session();command(s,'IR-T4','parallel_enable');command(s,'IR-T7','tap_raise')
        self.assertEqual(s.states['IR-T4']['tap'],1)
        self.assertEqual(s.states['IR-T7']['tap'],1)
        self.assertNotIn('mode_condense',s.actions(s._device('IR-G1')))
        self.assertNotIn('set_gate',s.actions(s._device('IR-G13')))
        self.assertIn('mode_condense',s.actions(s._device('TF-G5')))

    def test_mechanism_failure_and_unavailable_control_supply(self):
        s=session();s.states['TF-52L1']['mechanismHealthy']=False
        chosen=s.select('operator',dict(equipmentId='TF-52L1',action='open',expectedControlRevision=s.control_revision))
        result=s.execute('operator',dict(selectionToken=chosen['selectionToken'],expectedControlRevision=s.control_revision,idempotencyKey='failed-travel'))
        advance(s,1)
        self.assertEqual(s.states['TF-52L1']['position'],'closed')
        self.assertEqual(s.commands[result['commandId']]['failureReason'],'MECHANISM_FAILED')
        s.states['TF-DC']['available']=False
        self.assertIn('DC_UNAVAILABLE',[r['code'] for r in s._permissives(s._device('TF-52L2'),'open')])
        s.states['IR-120-TIE']['quality']='bad'
        self.assertIn('INDICATION_UNAVAILABLE',[r['code'] for r in s._permissives(s._device('IR-120-TIE'),'close')])

    def test_mesh_flow_and_island_power_balance(self):
        s=session('COMPLEX-ISLAND');command(s,'IR-120-TIE','close');command(s,'IR-A1L93','open');advance(s,10)
        result=s.truth['electrical'];active=next(i for i in result['islands'] if 'TF-G1' in i['generators'])
        power=sum(result['generation'][g]['activeMW'] for g in active['generators'])
        self.assertAlmostEqual(power,active['servedMW'],places=6)
        self.assertEqual(result['quality'],'good')
        self.assertTrue(all(0.8<n['voltagePu']<1.2 for n in result['nodes'].values() if n['energization']=='energized'))

    def test_persistence_ownership_idempotency_and_model_pinning(self):
        with tempfile.TemporaryDirectory() as folder:
            service=SimulatorService(folder,background=False)
            status,snap=service.handle('POST',PREFIX+'/sessions',{'modelId':'SIM-TWIN-IROQUOIS','scenarioId':'COMPLEX-NORMAL'},'operator')
            self.assertEqual(status,201);id=snap['sessionId'];s=service.sessions[id]
            s.clock('run');command(s,'TF-G1','start');advance(s,8);service._save(s)
            restored=SimulatorService(folder,background=False);r=restored.sessions[id]
            self.assertIsInstance(r,ComplexSession);self.assertEqual(r.status,'paused')
            self.assertEqual(r.states['TF-G1']['sequenceState'],'READY')
            self.assertEqual(r.model_hash,s.model_hash)
            self.assertEqual(restored.handle('GET',PREFIX+'/sessions/'+id,None,'intruder')[0],403)
            r.clock('run')
            chosen=r.select('operator',dict(equipmentId='TF-52G1',action='close',expectedControlRevision=r.control_revision))
            payload=dict(selectionToken=chosen['selectionToken'],expectedControlRevision=r.control_revision,idempotencyKey='one-command')
            first=r.execute('operator',payload);second=r.execute('operator',payload)
            self.assertEqual(first,second);self.assertEqual(len(r.pending),1)
            self.assertEqual(restored.handle('POST',PREFIX+'/sessions',{'modelId':'SIM-TWIN-IROQUOIS','scenarioId':'NORMAL-OPEN'},'operator')[0],422)

if __name__=='__main__':unittest.main()
