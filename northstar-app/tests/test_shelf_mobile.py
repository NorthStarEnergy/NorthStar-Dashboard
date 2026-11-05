"""Shelf PIN access stays scoped to the operator host and Shelf namespace."""
import hashlib
import io
import json
import tempfile
import time
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch
import northstar_shelf_mobile as mobile


class ShelfMobileTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory()
        self.root=Path(self.temp.name)
        self.data=patch.object(mobile,'DATA',self.root);self.data.start()
        self.addCleanup(self.temp.cleanup);self.addCleanup(self.data.stop)
        self.responses=[];self.dispatches=[]
        class ShelfError(Exception):pass
        self.shelf=SimpleNamespace(send_json=lambda h,b,s=200:self.responses.append((s,b)),
            dispatch=lambda h:self.dispatches.append(h.path),ShelfError=ShelfError,MAX_BYTES=90*1024*1024)
        self.device='a'*64;self.invite='b'*64
        (self.root/'enrollment.sha256').write_text(hashlib.sha256(self.invite.encode()).hexdigest())
        salt=bytes(range(16))
        (self.root/'pin-auth.json').write_text(json.dumps(dict(salt=salt.hex(),
            verifier=hashlib.scrypt(b'1234',salt=salt,n=16384,r=8,p=1).hex())))

    def request(self,path='/api/shelf/mobile/unlock',method='POST',pin='1234',operator=True,headers=None):
        body=json.dumps({'pin':pin}).encode()
        base={'Host':'ops.example.test','Origin':'https://ops.example.test','X-Shelf-Request':'1',
            'Cookie':f'{mobile.COOKIE}={self.device}; __Secure-shelf-enroll={self.invite}',
            'Content-Length':str(len(body))}
        base.update(headers or {})
        return SimpleNamespace(path=path,command=method,headers=base,rfile=io.BytesIO(body),
            close_connection=False,_is_operator_host=lambda:operator)

    def test_pin_unlock_scope_expiry_and_logout(self):
        h=self.request();self.assertTrue(mobile.handle(h,self.shelf,'demo'))
        self.assertEqual(self.responses[-1],(200,{'unlocked':True}))
        digest=mobile.fingerprint(h.headers);self.assertTrue(mobile.approved(digest))
        self.assertTrue(mobile.handle(self.request('/api/shelf/items','GET'),self.shelf,'demo'))
        self.assertEqual(self.dispatches,['/api/shelf/items'])
        for path in ['/api/training/switching/models','/api/checkins']:
            self.assertFalse(mobile.handle(self.request(path,'GET'),self.shelf,'demo'))
        self.assertFalse(mobile.handle(self.request(operator=False),self.shelf,'demo'))
        self.assertFalse(mobile.handle(self.request(),self.shelf,'off'))
        self.assertTrue(mobile.handle(self.request('/api/shelf/mobile/lock'),self.shelf,'demo'))
        self.assertFalse(mobile.approved(digest))
        with mobile.database() as db:db.execute('INSERT INTO sessions VALUES (?,?)',(digest,time.time()-1))
        self.assertFalse(mobile.approved(digest))

    def test_invitation_and_same_origin_required(self):
        for headers in [{'Origin':'https://elsewhere.test'},{'X-Shelf-Request':''},
                        {'Cookie':f'{mobile.COOKIE}={self.device}'}]:
            self.assertTrue(mobile.handle(self.request(headers=headers),self.shelf,'demo'))
            self.assertEqual(self.responses[-1][0],403)
        self.assertFalse(mobile.approved(hashlib.sha256(self.device.encode()).hexdigest()))

    def test_invalid_pin_rate_limit_and_no_setup(self):
        for i in range(5):
            mobile.handle(self.request(pin='0000'),self.shelf,'demo')
            self.assertEqual(self.responses[-1][0],429 if i==4 else 401)
        mobile.handle(self.request(),self.shelf,'demo');self.assertEqual(self.responses[-1][0],429)
        (self.root/'pin-auth.json').unlink()
        mobile.handle(self.request(),self.shelf,'demo');self.assertEqual(self.responses[-1][0],503)

    def test_uninstalled_extensions_fail_closed(self):
        mobile.handle(self.request(),self.shelf,'demo')
        for path,method in [('/shelf-web/','GET'),('/api/shelf/web/enroll','POST'),
                            ('/api/shelf/push/token','POST'),('/api/shelf/printer/status','GET')]:
            self.assertTrue(mobile.handle(self.request(path,method),self.shelf,'demo'))
            self.assertEqual(self.responses[-1][0],503)
            self.assertEqual(self.responses[-1][1]['status'],'unavailable')
        self.assertFalse(self.dispatches)
