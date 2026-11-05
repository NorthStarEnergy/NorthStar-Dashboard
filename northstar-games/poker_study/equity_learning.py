"""Persistent Monte Carlo refinement, not policy training or a GTO certificate.
Only actor-visible cards and inferred public ranges enter this shared store.
"""
from collections import OrderedDict
import hashlib
import json
import math
from pathlib import Path
import queue
import sqlite3
import threading
import time

SCHEMA = 'joint-range-equity-v1'

class EquityLearner:
    def __init__(self, path, start=True, max_samples=8192, max_entries=10000):
        self.path=Path(path);self.path.parent.mkdir(parents=True,exist_ok=True)
        self.max_samples=max(256,max_samples);self.max_entries=max_entries
        self.lock=threading.RLock();self.pending=set();self.queue=queue.Queue(32)
        self.cache=OrderedDict();self.stop=threading.Event();self.worker=None;self.error=''
        with self._db() as db:
            db.execute('CREATE TABLE IF NOT EXISTS equity_learning (key TEXT PRIMARY KEY, n INTEGER, total REAL, squares REAL, updated REAL)')
        if start:
            self.worker=threading.Thread(target=self._run,name='equity-refinement',daemon=True)
            self.worker.start()

    def _db(self):
        # Connection context commits but does not close: explicitly close via helper.
        return _Database(self.path)

    @staticmethod
    def key(hole,board,profiles):
        return hashlib.sha256(json.dumps([SCHEMA,hole,board,profiles],separators=(',',':')).encode()).hexdigest()

    def _read(self,key):
        if key in self.cache:
            self.cache.move_to_end(key);return self.cache[key]
        with self._db() as db:
            row=db.execute('SELECT n,total,squares FROM equity_learning WHERE key=?',(key,)).fetchone()
        if row and (row[0]<256 or not all(math.isfinite(v) for v in row) or not 0<=row[2]<=row[1]<=row[0]):
            return None
        return row

    def _write(self,key,row):
        n,total,squares=row
        if not 0<=squares<=total<=n:raise ValueError('Invalid equity statistics')
        with self._db() as db:
            db.execute('INSERT OR REPLACE INTO equity_learning VALUES (?,?,?,?,?)',(key,n,total,squares,time.time()))
            db.execute('DELETE FROM equity_learning WHERE key IN (SELECT key FROM equity_learning ORDER BY updated DESC LIMIT -1 OFFSET ?)',(self.max_entries,))
        self.cache[key]=row;self.cache.move_to_end(key)
        while len(self.cache)>256:self.cache.popitem(last=False)

    def estimate(self,hole,board,profiles):
        from .bot_policy import equity_batch, sampled_equity
        key=self.key(hole,board,profiles)
        try:
            with self.lock:row=self._read(key)
            if row is None:
                initial=equity_batch(hole,board,profiles)
                with self.lock:
                    row=self._read(key) or initial
                    self._write(key,row)
            with self.lock:
                if row[0]<self.max_samples and key not in self.pending and not self.stop.is_set():
                    try:
                        self.queue.put_nowait((key,hole,board,profiles));self.pending.add(key)
                    except queue.Full:pass
            return row[1]/row[0]
        except (sqlite3.Error,OSError):
            self.error='storage_unavailable'
            return sampled_equity(hole,board,profiles)

    def refine_one(self):
        from .bot_policy import equity_batch
        try:item=self.queue.get_nowait()
        except queue.Empty:return False
        key,hole,board,profiles=item
        updated=None
        try:
            with self.lock:old=self._read(key)
            if old and old[0]<self.max_samples:
                batch=equity_batch(hole,board,profiles,min(512,self.max_samples-old[0]),offset=old[0])
                with self.lock:
                    updated=tuple(a+b for a,b in zip(old,batch))
                    self._write(key,updated)
            self.error=''
        finally:
            with self.lock:
                self.pending.discard(key)
                if updated and updated[0]<self.max_samples and not self.stop.is_set():
                    try:
                        self.queue.put_nowait(item);self.pending.add(key)
                    except queue.Full:pass
            self.queue.task_done()
        return True

    def _run(self):
        while not self.stop.wait(1.):
            try:self.refine_one()
            except Exception as error:self.error=type(error).__name__

    def status(self):
        with self.lock,self._db() as db:
            count,samples=db.execute('SELECT COUNT(*),COALESCE(SUM(n),0) FROM equity_learning').fetchone()
        return {'method':SCHEMA,'situations':count,'samples':samples,'queued':self.queue.qsize(),
                'max_samples_per_situation':self.max_samples,'error':self.error,'gto_certified':False}

    def statistics(self,hole,board,profiles):
        with self.lock:row=self._read(self.key(hole,board,profiles))
        if not row:return None
        n,total,squares=row;mean=total/n
        return {'samples':n,'equity':mean,'standard_error':math.sqrt(max(0,squares-total*total/n)/(n-1)/n)}

    def close(self):
        self.stop.set()
        if self.worker:self.worker.join(timeout=5)

class _Database:
    def __init__(self,path):self.path=path
    def __enter__(self):
        self.db=sqlite3.connect(self.path,timeout=2);return self.db
    def __exit__(self,kind,error,trace):
        try:
            if kind is None:self.db.commit()
            else:self.db.rollback()
        finally:self.db.close()
