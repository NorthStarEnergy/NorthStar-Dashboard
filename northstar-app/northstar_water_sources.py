"""Existing public gauge registry and bounded, read-only collection adapters."""
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
import csv
import io
import json
import math
import time
from itertools import islice
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode, urljoin, urlsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener
import northstar_flows as flows
import northstar_water_elevations as elevations

UTC = timezone.utc
EST = timezone(timedelta(hours=-5))
PROVIDERS = {
    'wsc': dict(name='Water Survey of Canada / ECCC', endpoint=elevations.WSC+'hydrometric-realtime/items',
                reference='https://wateroffice.ec.gc.ca/', metrics=['water_level','discharge'],
                legacyEndpoint=flows.WSC_ENDPOINT),
    'cehq': dict(name='Québec CEHQ', endpoint=flows.CEHQ_ENDPOINT,
                 reference='https://www.cehq.gouv.qc.ca/hydrometrie/', metrics=['discharge'],
                 note='The configured text reports provide discharge only; timestamps use fixed Eastern Standard Time (UTC−5).'),
    'usgs': dict(name='USGS Water Data', endpoint=elevations.USGS+'continuous/items',
                 reference='https://api.waterdata.usgs.gov/docs/ogcapi/', metrics=['water_surface_elevation'],
                 note='Reported water-surface elevation: feet converted to metres, with the provider datum retained.'),
}
STATIONS = {}
for station in elevations.STATIONS + elevations.LOCATION_STATIONS:
    key=station['provider'].lower()
    STATIONS[(key,station['id'])]=dict(station,source=key,active=station.get('realTime') is not False)
for station in flows.CEHQ_STATIONS:
    STATIONS[('cehq',station['stationId'])]=dict(id=station['stationId'],name=station['name'],source='cehq',
        provider='CEHQ',datum='Not applicable to discharge',active=True)

class SourceError(RuntimeError):
    def __init__(self,message,retry_seconds=0):
        super().__init__(message)
        self.retry_seconds=retry_seconds

def timestamp(value):
    try:
        dt=datetime.fromisoformat(str(value).replace('Z','+00:00'))
        if dt.tzinfo is None:raise ValueError()
        return dt.astimezone(UTC)
    except (ValueError,TypeError):
        raise SourceError('Provider returned an invalid observation timestamp') from None

def number(value):
    if value is None or value=='' or isinstance(value,bool):return None
    try:n=float(str(value).replace(',','.'))
    except (TypeError,ValueError):return None
    return n if math.isfinite(n) and abs(n)<1e15 else None

def validate_url(url,origin):
    target,expected=urlsplit(url),urlsplit(origin)
    if target.scheme!='https' or target.netloc!=expected.netloc or target.path!=expected.path or target.username or target.password:
        raise SourceError('Provider returned an unsafe continuation URL')
    return url

def retry_delay(value,now=None):
    try:seconds=int(value)
    except (ValueError,TypeError):
        try:seconds=(parsedate_to_datetime(value)-(now or datetime.now(UTC))).total_seconds()
        except (ValueError,TypeError,OverflowError):seconds=300
    return max(60,min(86400,int(seconds)))

class PublicRedirect(HTTPRedirectHandler):
    def redirect_request(self,req,fp,code,msg,headers,newurl):
        validate_url(newurl,req.full_url)
        return super().redirect_request(req,fp,code,msg,headers,newurl)

def download(url):
    """No credentials or arbitrary endpoints; retries never defeat Retry-After."""
    for attempt in range(2):
        try:
            req=Request(url,headers={'Accept':'application/json,text/plain;q=0.8','User-Agent':'NorthStar-Water-Collection/1.0'})
            with build_opener(PublicRedirect()).open(req,timeout=15) as response:
                chunks=[];size=0;deadline=time.monotonic()+45
                while True:
                    if time.monotonic()>deadline:raise SourceError('Provider response exceeded the download time limit',300)
                    chunk=response.read1(min(65536,8_000_001-size))
                    if not chunk:break
                    chunks.append(chunk);size+=len(chunk)
                    if size>8_000_000:raise SourceError('Provider response exceeded eight megabytes')
                raw=b''.join(chunks)
                encoding=response.headers.get_content_charset() or 'utf-8'
            return raw.decode(encoding,errors='replace')
        except HTTPError as exc:
            if exc.code==429:raise SourceError('Provider rate limit; collection deferred',retry_delay(exc.headers.get('Retry-After'))) from None
            if exc.code in (401,403):raise SourceError('Provider refused access; check its public API access requirements',3600) from None
            if exc.code<500 or attempt:raise SourceError('Provider HTTP request failed',300) from None
        except (URLError,TimeoutError,OSError):
            if attempt:raise SourceError('Provider connection failed',300) from None
        time.sleep(1)
    raise SourceError('Provider request failed',300)

def pages(url,fetch,deadline):
    origin=url;seen=set();result=[]
    while url:
        validate_url(url,origin)
        if url in seen or len(seen)>=12 or time.monotonic()>deadline:raise SourceError('Provider range exceeded the collection limit; no partial station data saved')
        seen.add(url)
        try:data=json.loads(fetch(url))
        except (ValueError,TypeError):raise SourceError('Provider returned invalid JSON') from None
        if not isinstance(data,dict) or not isinstance(data.get('features'),list):raise SourceError('Provider returned an invalid feature collection')
        result.extend(data['features'])
        if len(result)>10000:raise SourceError('Too many provider observations; no partial station data saved')
        links=[x.get('href') for x in data.get('links',[]) if isinstance(x,dict) and x.get('rel')=='next']
        url=urljoin(url,links[0]) if links and links[0] else None
    return result

def point(station,series,metric,observed,value,raw,raw_unit,quality,url):
    return dict(source=station['source'],station=station['id'],series=series,metric=metric,observed_at=observed,
                value=value,unit='m³/s' if metric=='discharge' else 'm',datum=station['datum'] if metric!='discharge' else '',
                raw_value=raw,raw_unit=raw_unit,quality=quality,source_url=url)

def collect_station(source,station,start,end,fetch=None,deadline=None):
    """Only existing configured gauges. Fetch a complete bounded station window."""
    if (source,station['id']) not in STATIONS or not station['active']:raise ValueError('Unknown or historical-only gauge')
    fetch=fetch or download
    deadline=deadline or time.monotonic()+180
    base=PROVIDERS[source]['endpoint']
    result=[]
    if source=='cehq':
        url=base+'?'+urlencode({'NoStation':station['id']})
        text=fetch(url)
        rows=list(islice(csv.reader(io.StringIO(text.lstrip('\ufeff')),delimiter='\t'),20001))
        if len(rows)>20000:raise SourceError('CEHQ report exceeded the row limit; no partial station data saved')
        rows=[r for r in rows if any(x.strip() for x in r)]
        if not rows:raise SourceError('CEHQ returned an empty report')
        headers={flows._header_key(x):i for i,x in enumerate(rows[0])}
        if not {'date','heure','debit'}<=headers.keys():raise SourceError('CEHQ report columns changed')
        for row in rows[1:]:
            if len(row)<=max(headers.values()):continue
            try:observed=datetime.fromisoformat(row[headers['date']].strip()+'T'+row[headers['heure']].strip()).replace(tzinfo=EST).astimezone(UTC)
            except ValueError:raise SourceError('CEHQ returned an invalid timestamp') from None
            if not start<=observed<=end:continue
            raw=row[headers['debit']].strip();value=number(raw)
            result.append(point(station,'discharge','discharge',observed,value,raw,'m³/s',{'status':'Provisional','sourceTimezone':'UTC-05:00'},url))
        return result
    params=dict(f='json',limit=1000,datetime=start.isoformat()+'/'+end.isoformat())
    if source=='wsc':params.update(STATION_NUMBER=station['id'],sortby='DATETIME')
    else:params.update(monitoring_location_id='USGS-'+station['id'],parameter_code='63160')
    url=base+'?'+urlencode(params)
    for feature in pages(url,fetch,deadline):
        p=feature.get('properties',{})
        if not isinstance(p,dict):raise SourceError('Provider returned invalid observation properties')
        if source=='wsc':
            if p.get('STATION_NUMBER')!=station['id']:continue
            observed=timestamp(p.get('DATETIME'))
            if not start<=observed<=end:continue
            for key,metric,unit in [('LEVEL','water_level','m'),('DISCHARGE','discharge','m³/s')]:
                if key in p:
                    result.append(point(station,metric,metric,observed,number(p[key]),p[key],unit,
                        {'status':'Provisional','symbol':p.get(key+'_SYMBOL_EN'),'providerIdentifier':p.get('IDENTIFIER')},url))
        else:
            if p.get('monitoring_location_id')!='USGS-'+station['id'] or p.get('parameter_code')!='63160':continue
            observed=timestamp(p.get('time'))
            if not start<=observed<=end:continue
            if p.get('unit_of_measure')!='ft':raise SourceError('Unexpected USGS elevation unit; no conversion applied')
            raw=p.get('value');value=number(raw);series=p.get('time_series_id') or p.get('timeseries_id') or '63160'
            result.append(point(station,str(series),'water_surface_elevation',observed,value*0.3048 if value is not None else None,raw,'ft',
                {'status':p.get('approval_status') or p.get('approvals_status'),'qualifier':p.get('qualifier'),
                 'parameterCode':'63160','statisticId':p.get('statistic_id'),'lastModified':p.get('last_modified')},url))
    return result
