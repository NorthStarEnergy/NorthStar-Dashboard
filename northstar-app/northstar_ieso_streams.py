"""Direct, read-only IESO public catalogue, news API and report adapter."""
import copy
import json
import re
import threading
import time
from datetime import datetime, timezone
from html import unescape
from urllib.request import Request, urlopen

ROOT = 'https://reports-public.ieso.ca/public/'
NEWS = 'https://www.ieso.ca/ieso/api/news/search?r=558F578D-BF1D-4737-B066-A8E1F6581910&ps=100&pi=0&y=0&m=0&q=&c='
_cache = {}
_lock = threading.RLock()

def download(url):
    with urlopen(Request(url, headers={'User-Agent': 'NorthStar-IESO/1.0'}), timeout=20) as response:
        data = response.read(12_000_001)
        if len(data) > 12_000_000:
            raise ValueError('Report exceeds 12 MB; open the original IESO report')
        return data.decode('utf-8-sig')

def cached(key, loader, ttl=300):
    # Serialize cache misses to prevent a refresh stampede; never fabricate values.
    with _lock:
        old = _cache.get(key)
        if old and time.monotonic() - old[0] < ttl:
            return copy.deepcopy(old[1])
        now = datetime.now(timezone.utc).isoformat()
        try:
            value = {**loader(), 'retrieved': now, 'stale': False, 'error': None}
        except Exception as exc:
            value = {**(old[1] if old else {}), 'stale': True, 'error': str(exc)[:240], 'attempted': now}
        _cache[key] = (time.monotonic(), value)
        return copy.deepcopy(value)

def entries(html):
    for href, label, tail in re.findall(r'<a href="([^"]+)">([^<]+)</a>([^\r\n<]*)', html):
        yield unescape(href), unescape(label), unescape(tail).strip()

def category(name):
    if re.search('Outage|TxLimit|Security|Adequacy|ReserveConst|Shortfall', name, re.I): return 'System'
    if re.search('Gen|VG|Demand|Totals|Flow', name, re.I): return 'Supply and demand'
    if re.search('Charge|Uplift|Adjustment|AQEW|LFDA', name, re.I): return 'Settlement'
    return 'Market'

def catalogue():
    def load():
        reports = []
        for href, label, tail in entries(download(ROOT)):
            if not re.fullmatch(r'[A-Za-z0-9_-]+/', href): continue
            parts = re.split(r'\s+-\s+', tail, maxsplit=1)
            reports.append({'id': href[:-1], 'name': parts[-1] if len(parts)>1 else label,
                            'published': parts[0], 'category': category(href), 'url': ROOT+href})
        if not reports: raise ValueError('IESO public catalogue returned no report folders')
        return {'reports': reports, 'source': ROOT}
    return cached('catalogue', load)

def news():
    def load():
        data = json.loads(download(NEWS))
        if not isinstance(data.get('Results'), list): raise ValueError('Unexpected IESO news response')
        return {'items': [{'title': r['Title'], 'issued': r.get('PublishedDate'),
                           'description': r.get('Description', ''),
                           'url': 'https://www.ieso.ca'+r['Link']} for r in data['Results']
                          if r.get('Link', '').startswith('/Sector-Participants/IESO-News/')],
                'total': data.get('TotalHits'), 'source': NEWS}
    return cached('news', load)

def report(identifier):
    known = {r['id'] for r in catalogue().get('reports', [])}
    if identifier not in known: raise ValueError('Unknown IESO public report stream')
    def load():
        url = ROOT + identifier + '/'
        files = [{'name': label, 'url': url+href, 'published': tail} for href,label,tail in entries(download(url))
                 if re.fullmatch(r'PUB_[A-Za-z0-9_.-]+\.(?:xml|csv|txt|pdf|zip)', href, re.I)]
        if not files: raise ValueError('No downloadable reports in this stream')
        latest = [f for f in files if not re.search(r'_\d{4,}', f['name'])]
        choices = latest or sorted(files, key=lambda f:f['name'], reverse=True)
        selected = next((f for f in choices if f['name'].endswith('.xml')), choices[0])
        text = download(selected['url']) if selected['name'].endswith(('.xml','.csv','.txt')) else None
        return {'id': identifier, 'source': selected['url'], 'published': selected['published'],
                'latestAlias': bool(latest), 'files': choices[:30], 'content': text,
                'format': selected['name'].rsplit('.',1)[-1]}
    return cached('report:'+identifier, load)

def snapshot():
    return {'catalogue': catalogue(), 'news': news(),
            'scope': 'All publicly listed report folders, including legacy reports. Reports load on selection. Participant-only feeds require IESO authorization.'}
