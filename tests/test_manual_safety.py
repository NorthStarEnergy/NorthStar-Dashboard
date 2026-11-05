import importlib
import os
import tempfile
import unittest
from datetime import datetime, timedelta
from pathlib import Path
from unittest.mock import patch
import test_api_workflows as api_fixture
import test_packet20_hostname_separation as host_fixture


class SafetyStoreTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.env = patch.dict(os.environ, {'NORTHSTAR_DB': str(Path(self.temp.name)/'safety.db')})
        self.env.start()
        import northstar_store
        self.store = importlib.reload(northstar_store)
        self.store.init_db()
        self.record = self.store.create_checkin({'name':'Test Worker','site':'Kenora','alone':True})

    def tearDown(self):
        self.env.stop()
        self.temp.cleanup()

    def test_device_activity_cannot_reset_or_clear_overdue(self):
        rec=self.record
        deadline=datetime.fromisoformat(rec['safetyDueAt'])
        self.store.evaluate_overdue(deadline)
        updated=self.store.record_device_heartbeat(rec['id'])
        self.assertEqual(updated['lastHeard'],rec['lastHeard'])
        self.assertEqual(updated['safetyDueAt'],rec['safetyDueAt'])
        self.assertEqual(updated['status'],'overdue')
        self.assertIsNotNone(updated['lastDeviceSeenAt'])

    def test_manual_checkin_resets_without_resolving_emergency(self):
        self.store.request_help(self.record['id'])
        self.store.evaluate_overdue(datetime.fromisoformat(self.record['safetyDueAt']))
        updated=self.store.record_heartbeat(self.record['id'],actor='manual safety check-in')
        self.assertEqual(updated['status'],'on-site')
        self.assertTrue(updated['needsHelp'])
        self.assertEqual(datetime.fromisoformat(updated['safetyDueAt'])-datetime.fromisoformat(updated['lastSafetyCheckinAt']),timedelta(hours=1))
        self.assertEqual(datetime.fromisoformat(updated['safetyReminderAt'])-datetime.fromisoformat(updated['lastSafetyCheckinAt']),timedelta(minutes=55))

    def test_closed_visit_never_reopens(self):
        closed=self.store.check_out(self.record['id'])
        for fn in (self.store.record_heartbeat,self.store.record_device_heartbeat):
            updated=fn(self.record['id'])
            self.assertEqual(updated['status'],'checked-out')
            self.assertEqual(updated['lastHeard'],closed['lastHeard'])

    def test_migration_is_idempotent_and_preserves_safety_time(self):
        with self.store._session() as connection:
            connection.execute('ALTER TABLE checkins DROP COLUMN last_device_seen')
        self.store.init_db()
        self.store.init_db()
        updated=self.store.get_checkin(self.record['id'])
        self.assertEqual(updated['lastHeard'],self.record['lastHeard'])
        self.assertIsNone(updated['lastDeviceSeenAt'])


class SafetyHTTPTest(unittest.TestCase):
    setUp = api_fixture.APITest.setUp
    tearDown = api_fixture.APITest.tearDown
    request = api_fixture.APITest.request
    def test_manual_endpoint_and_legacy_heartbeat(self):
        rec=self.store.create_checkin({'name':'HTTP Fixture','site':'Kenora','alone':True})
        self.store.evaluate_overdue(datetime.fromisoformat(rec['safetyDueAt']))
        status,body,_=self.request('POST',f"/api/checkins/{rec['id']}/heartbeat",{})
        self.assertEqual(status,200)
        self.assertTrue(body['overdue'])
        self.assertEqual(body['lastHeard'],rec['lastHeard'])
        status,body,_=self.request('POST',f"/api/checkins/{rec['id']}/safety-checkin",{})
        self.assertEqual(status,200)
        self.assertFalse(body['overdue'])
        self.assertEqual(body['safetyProtocol'],1)

    def test_call_configuration_is_non_dialable_until_configured(self):
        rec=self.store.create_checkin({'name':'Call Fixture','site':'Kenora'})
        for value in ('','dummy','tel:123','javascript:alert(1)'):
            with patch.dict(os.environ,{'NORTHSTAR_OPERATOR_PHONE':value}):
                result=self.backend.checkin_response(rec)
                self.assertIsNone(result['operatorPhone'])
                self.assertFalse(result['operatorCallingConfigured'])
        with patch.dict(os.environ,{'NORTHSTAR_OPERATOR_PHONE':'+14165550123'}):
            self.assertEqual(self.backend.checkin_response(rec)['operatorPhone'],'+14165550123')

    def test_activation_probe_needs_no_real_worker_record(self):
        status,_,headers=self.request('GET','/api/checkins/safety-protocol-probe-missing')
        self.assertEqual(status,404)
        self.assertEqual(headers.get('X-Northstar-Safety-Protocol'),'1')


class SafetyHostTest(unittest.TestCase):
    setUp = host_fixture.HostnameSeparationTest.setUp
    tearDown = host_fixture.HostnameSeparationTest.tearDown
    use_gate = host_fixture.HostnameSeparationTest.use_gate
    call = host_fixture.HostnameSeparationTest.call

    def test_public_manual_confirmation_cannot_resolve_help_or_read_roster(self):
        for gate in ('access','demo'):
            self.use_gate(gate)
            record=self.store.create_checkin({'name':'Host Fixture','site':'Kenora','alone':True})
            self.store.request_help(record['id'])
            status,body,_=self.call('POST',f"/api/checkins/{record['id']}/safety-checkin",{'actor':'forged operator'})
            self.assertEqual(status,200)
            self.assertTrue(body['needsHelp'])
            self.assertEqual(self.call('GET','/api/checkins')[0],403)
            self.assertEqual(self.call('POST',f"/api/checkins/{record['id']}/help/resolve",{})[0],403)
            self.assertEqual(self.store.history(record['id'])[0]['actor'],'manual safety check-in')
