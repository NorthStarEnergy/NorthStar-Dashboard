import unittest
import test_api_workflows as fixture


class WorkerRosterLifecycleTest(unittest.TestCase):
    setUp = fixture.APITest.setUp
    tearDown = fixture.APITest.tearDown
    request = fixture.APITest.request

    def test_manual_arrival_site_safety_and_checkout(self):
        for site in ('Twin Falls', 'Iroquois Falls', 'Iroquois Falls 230 kV'):
            status, visit, _ = self.request('POST', '/api/checkins', {
                'name': 'Synthetic worker', 'company': 'Test crew', 'site': site,
                'kind': 'Contractor', 'source': 'contractor-manual',
                'provisional': True, 'alone': True, 'expectedMinutes': 240})
            self.assertEqual(status, 201)
            status, roster, _ = self.request('GET', '/api/checkins')
            self.assertEqual(status, 200)
            row = next(row for row in roster if row['id'] == visit['id'])
            self.assertEqual(row['site'], site)
            status, resumed, _ = self.request('GET', '/api/checkins/' + visit['id'])
            self.assertEqual(resumed['safetyDueAt'], visit['safetyDueAt'])
            status, safety, _ = self.request('POST', '/api/checkins/' + visit['id'] + '/safety-checkin', {})
            self.assertEqual(status, 200)
            self.assertEqual(safety['site'], site)
            status, closed, _ = self.request('DELETE', '/api/checkins/' + visit['id'])
            self.assertEqual(status, 200)
            _, roster, _ = self.request('GET', '/api/checkins')
            self.assertNotIn(visit['id'], [row['id'] for row in roster])
            _, history, _ = self.request('GET', '/api/checkins?include=all')
            row = next(row for row in history if row['id'] == visit['id'])
            self.assertEqual(row['status'], 'checked-out')
            self.assertEqual(row['site'], site)
