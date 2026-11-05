"""Controlled evidence and authority boundaries."""
import base64
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import northstar_operator_knowledge as k
import northstar_store as store
import northstar_ai as ai

class KnowledgeSearchTest(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.original=store.DB_PATH
        store.DB_PATH=Path(self.temp.name)/'northstar.db'
        self.env=mock.patch.dict(os.environ,{'NORTHSTAR_AI_SITE_ACCESS':'','NORTHSTAR_AI_ENGINE':'summary'})
        self.env.start();store.init_db()
    def tearDown(self):
        store.DB_PATH=self.original;self.env.stop();self.temp.cleanup()
    def upload(self,site='',revision='1',text='Generator relay documentation. OPENAI_API_KEY=hidden-value',key='relay-guide'):
        return k.upload({'title':'Generator relay guide','filename':'guide.md','revision':revision,'owner':'Document owner','siteId':site,'sourceKey':key,'contentBase64':base64.b64encode(text.encode()).decode()},'reviewer')
    def approve(self,source,**options):
        payload={'status':'CURRENT_CONTROLLED','reason':'Verified controlled original','owner':'Document owner','revision':source['revision'],'effective_from':'2020-01-01','effective_to':'','review_due':'2099-01-01','confirmed':True}
        return k.review(source['id'],payload|options,'reviewer')
    def test_pending_current_cited_redacted(self):
        source=self.upload();self.assertEqual(k.search('relay'),[]);self.approve(source)
        result=k.search('relay')[0];self.assertNotIn('hidden-value',result['excerpt']);self.assertEqual(result['authorityStatus'],'CURRENT_CONTROLLED');self.assertIn(source['id'],result['href']);self.assertEqual(result['sha256'],source['sha256'])
    def test_reference_and_legacy(self):
        source=self.upload();k.review(source['id'],{'status':'REFERENCE_ONLY','reason':'Reference review'},'reviewer');self.assertEqual(k.search('relay'),[]);self.assertTrue(k.search('relay',reference_mode=True))
        with store._session() as con:con.execute("UPDATE operator_knowledge_sources SET status='LEGACY_REFERENCE' WHERE id=?",(source['id'],))
        with self.assertRaises(ValueError):self.approve(source)
        self.assertEqual(k.search('relay',reference_mode=True),[])
    def test_dates(self):
        source=self.upload()
        for options in [{'effective_to':'2021-01-01'},{'effective_from':'2090-01-01'},{'review_due':'2021-01-01'}]:
            self.approve(source,**options);self.assertEqual(k.search('relay'),[])
    def test_scope_and_acl(self):
        first=self.upload('site:kenora');self.approve(first);other=self.upload('site:iroquois-falls',key='other');self.approve(other);self.assertEqual(len(k.search('relay',site_id='site:kenora')),1)
        with mock.patch.dict(os.environ,{'NORTHSTAR_AI_SITE_ACCESS':'{"limited":["site:kenora"]}'}):
            self.assertEqual(len(k.search('relay',actor='limited')),1)
            with self.assertRaises(k.KnowledgeDenied):k.get_source(other['id'],'limited')
            with self.assertRaises(k.KnowledgeDenied):k.search('relay',actor='unknown')
        with mock.patch.dict(os.environ,{'NORTHSTAR_AI_SITE_ACCESS':'invalid'}):
            with self.assertRaises(k.KnowledgeDenied):k.search('relay')
    def test_checksum(self):
        source=self.upload();self.approve(source)
        with store._session() as con:path=con.execute('SELECT file_path FROM operator_knowledge_sources WHERE id=?',(source['id'],)).fetchone()[0]
        k._path(path).write_text('tampered');self.assertEqual(k.search('relay'),[])
        self.assertEqual(k.get_source(source['id'])['passages'],[])
        with self.assertRaises(ValueError):k.read_file(source['id'])
        self.assertEqual(k.review(source['id'],{'status':'WITHDRAWN','reason':'Integrity failure'},'reviewer')['status'],'WITHDRAWN')
    def test_idempotency_and_supersession(self):
        source=self.upload();self.assertEqual(self.upload()['id'],source['id']);self.approve(source);new=self.upload(revision='2',text='Generator relay documentation updated.');self.approve(new);self.assertEqual(k.get_source(source['id'])['status'],'SUPERSEDED');self.assertEqual(k.search('relay')[0]['sourceId'],new['id']);self.assertEqual(len(k.get_source(source['id'])['reviews']),2)
    def test_no_crawl(self):
        (store.DB_PATH.parent/'uncontrolled.md').write_text('secret relay')
        with store._session() as con:con.execute('CREATE TABLE secret_shift_notes(body TEXT)');con.execute("INSERT INTO secret_shift_notes VALUES ('secret relay')")
        self.assertEqual(k.search('relay'),[])
    def test_live_records_not_procedure_authority(self):
        store.add_logbook_entry('Observation','Kenora relay check','Recorded alarm');self.assertTrue(k.search('relay',site_id='site:kenora'));self.assertEqual(ai.query('relay procedure',context_scope='logbook',persist=False)['evidenceStatus'],'no-match')
    def test_missing_initial_evidence_can_be_researched_without_inventing_evidence(self):
        with mock.patch.dict(os.environ,{'NORTHSTAR_AI_ENGINE':'openai'}),mock.patch.object(ai,'_run_openai_engine',return_value=('No matching evidence found.', [])) as engine:
            self.assertEqual(ai.query('quux',context_scope='dashboard',persist=False)['evidenceStatus'],'no-match')
            self.assertTrue(engine.call_args.args[1]['_tool_policy'])
    def test_invalid_inputs(self):
        source=self.upload()
        with self.assertRaises(ValueError):self.approve(source,confirmed=False)
        with self.assertRaises(ValueError):self.approve(source,effective_from='invalid')
        with self.assertRaises(ValueError):k.search('relay',site_id='unknown')
        with self.assertRaises(ValueError):k.upload({'title':'File','filename':'bad.exe','contentBase64':'AAAA'},'reviewer')
        with self.assertRaises(ValueError):k._path('../guide.md')

    def test_actions_skip_model_and_citations_fail_closed(self):
        source=self.upload();self.approve(source)
        with mock.patch.dict(os.environ,{'NORTHSTAR_AI_ENGINE':'openai'}),mock.patch.object(ai,'_run_openai_engine',return_value='Invented statement [oks_deadbeef:1]') as engine:
            response=ai.query('relay documentation',context_scope='dashboard',persist=False)
            self.assertEqual(response['label'],'Retrieved evidence (citation check)')
            engine.reset_mock()
            response=ai.query('How do I reset the relay?',context_scope='dashboard',persist=False)
            self.assertEqual(response['label'],'Qualified operator review required');engine.assert_not_called()
    def test_revision_immutable_and_exact_record_source(self):
        source=self.upload()
        with self.assertRaises(ValueError):self.upload(text='Changed relay text')
        with self.assertRaises(ValueError):self.approve(source,revision='new')
        store.add_logbook_entry('Observation','Kenora relay check','Recorded observation')
        row=k.search('relay',site_id='site:kenora')[0]
        evidence=k.get_record('logbook',row['id'],'reviewer')
        self.assertEqual(evidence['id'],row['id']);self.assertIn('record=',evidence['href'])
        with self.assertRaises(LookupError):k.get_record('auth','anything','reviewer')

    def test_record_citation_can_inspect_the_matching_tail(self):
        store.add_logbook_entry('Observation','Kenora log entry','Context ' * 400 + 'tailkeyword observation')
        row=k.search('tailkeyword',site_id='site:kenora')[0]
        self.assertIn('tailkeyword',row['excerpt'])
        self.assertIn('tailkeyword',k.get_record('logbook',row['id'],'reviewer')['excerpt'])
