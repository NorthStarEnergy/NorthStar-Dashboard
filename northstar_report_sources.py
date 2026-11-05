"""Exact-source West Daily_Input retrieval. Never substitutes missing values with zero."""
from datetime import date, datetime, time as dt_time, timedelta, timezone
from html.parser import HTMLParser
import re
import json
import time
from urllib.parse import urlencode
from zoneinfo import ZoneInfo
import northstar_water_sources as water

UTC = timezone.utc
WSC = [(9,'05PA006','Lac LaCroix'),(10,'05PA013','Squirrel Falls'),
       (11,'05PB024','Rainy near Bear Pass'),(12,'05PB007','Rainy near Fort Frances'),(13,'05PC024','Point Park #1')]
USGS = [(6,'05127500','Basswood'),(7,'05129115','Vermilion'),(8,'05129290','Gold Portage')]
CLIMATE = [('D16','6022474','Fort Frances'),('D17','6020LPQ','Atikokan'),('D18','6034076','Kenora'),
           ('D19','6074207','Kirkland'),('D20','7086716','Rouyn'),('F16','6073976','Kapuskasing'),
           ('F17','6061366','Chapleau'),('F18','6085695','North Bay'),('F19','6065252','Monetville')]
QC = [('F20','7011190','Ste-Catherine'),('F21','7033650','Lachute')]
RAFT = dict(address='4815D640', channel=21, group='H20POW',
            endpoint='https://dadds-dcs-api.data.nesdis.noaa.gov/messages')
BLOCKED = [('D23','MNR North-WEST forecast','Ontario SWMC redirects to OPS/BPS secure sign-in.'),
           ('D24','MNR North-EAST forecast','Ontario SWMC redirects to OPS/BPS secure sign-in.'),
           ]

def timmins_value(data,day):
    if data.get('p',{}).get('metric_name')!='precipitation' or data.get('p',{}).get('period_name')!='daily':raise ValueError('Weatherstats product changed')
    cols=data.get('cols',[])
    if len(cols)!=2 or cols[1].get('p',{}).get('units')!='mm':raise ValueError('Weatherstats units changed')
    wanted=[day.year,day.month-1,day.day] # Google Charts uses zero-based months.
    rows=[r['c'][1] for r in data.get('rows',[]) if r.get('c',[{}])[0].get('v')==wanted]
    if len(rows)>1:raise ValueError('Duplicate Weatherstats reporting dates')
    return (water.number(rows[0].get('v')),rows[0].get('f')) if rows else (None,None)

def result(cell,label,station='',**kw):
    return dict(cell=cell,label=label,station=station,value=None,unit='',status='missing',**kw)

def raft_source(day, target=None, fetch=None, now=None):
    """Latest valid transmission; first field is operator-confirmed metres."""
    now=now or datetime.now(UTC);fetch=fetch or water.download
    item=result('D5','Raft Lake',RAFT['address'])
    window=dict(timeFrom=(now-timedelta(days=7)).isoformat(),timeTo=now.isoformat())
    item.update(unit='m',channel=RAFT['channel'],group=RAFT['group'],requestedAt=now.isoformat(),
        sourceUrl='https://dadds-dcs.data.nesdis.noaa.gov/messages?'+urlencode(dict(page=1,
            **{'platforms.address':RAFT['address'],'groupCodes.cd':RAFT['group'],'channels.id':RAFT['channel']},**window)),
        mappingNote='First payload field is elevation in metres; no datum conversion.',
        periodNote='Latest GOOD transmission. Hourly observation time uses the confirmed start-of-hour convention; receipt time is retained.')
    try:
        for page in range(1,13):
            url=RAFT['endpoint']+'?'+urlencode(dict(page=page,pageSize=60,platforms=RAFT['address'],
                groupCodes=RAFT['group'],channels=RAFT['channel'],sortField='time',asc='false',**window))
            data=json.loads(fetch(url));item['apiUrl']=url
            if not isinstance(data.get('data'),list):raise ValueError('NOAA message response changed')
            points=[]
            for r in data['data']:
                if r.get('address')!=RAFT['address'] or r.get('channel')!=RAFT['channel'] or r.get('groupCd')!=RAFT['group']:continue
                if r.get('quality')!='G' or r.get('infoCd')!='G':continue
                at=water.timestamp(r.get('time'))
                if not now-timedelta(days=7)<=at<=now:continue
                payload=str(r.get('externalData','')).strip()
                value=water.number(payload.split(',')[0]) if ',' in payload else None
                if value is None or not 400<=value<500:continue
                points.append((at,value,r.get('id')))
            if points:
                at=max(p[0] for p in points);rows=[p for p in points if p[0]==at]
                if len({p[1] for p in rows})>1:raise ValueError('Conflicting latest Raft Lake transmissions')
                _,value,mid=rows[0]
                item.update(value=value,status='collected',observedAt=at.replace(minute=0,second=0,microsecond=0).isoformat(),
                    receivedAt=at.isoformat(),messageId=mid,quality='G');age(item,now);return item
            if page>=data.get('meta',{}).get('pagingInfo',{}).get('totalPages',1):break
        item['message']='No valid GOOD transmission found in the latest seven days'
    except Exception as exc:item.update(status='error',message=str(exc)[:220])
    return item


def age(item,now):
    if item.get('observedAt'):
        seconds=max(0,(now-water.timestamp(item['observedAt'])).total_seconds())
        item.update(ageMinutes=round(seconds/60,1),stale=seconds>6*3600)
    if item.get('sourceDate'):
        item['ageDays']=max(0,(now.date()-date.fromisoformat(item['sourceDate'])).days)
        item['stale']=item['ageDays']>2


def latest(points,now):
    eligible=[p for p in points if p['value'] is not None and p['at']<=now]
    if len({p.get('series','') for p in eligible})>1:raise ValueError('Multiple provider series; select a verified series before use')
    if not eligible:return None
    at=max(p['at'] for p in eligible);rows=[p for p in eligible if p['at']==at]
    if len({p['value'] for p in rows})>1:raise ValueError('Conflicting latest observations')
    return rows[0]


def newest_features(url,fetch):
    """Descending provider pages; caller stops after finding a valid observation."""
    from urllib.parse import urljoin
    origin=url;seen=set();deadline=time.monotonic()+60
    while url:
        water.validate_url(url,origin)
        if url in seen or len(seen)>=12 or time.monotonic()>deadline:raise ValueError('Latest observation search exceeded provider limit')
        seen.add(url);data=json.loads(fetch(url))
        if not isinstance(data.get('features'),list):raise ValueError('Provider returned invalid feature collection')
        yield data['features']
        links=[r.get('href') for r in data.get('links',[]) if r.get('rel')=='next']
        url=urljoin(url,links[0]) if links and links[0] else None


def nearest(points,target):
    """One series, exact or preceding sample within 15 minutes; no future substitution."""
    eligible=[p for p in points if p['value'] is not None and target-timedelta(minutes=15)<=p['at']<=target]
    if len({p.get('series','') for p in eligible})>1:raise ValueError('Multiple provider series; select a verified series before use')
    if not eligible:return None
    return max(eligible,key=lambda p:p['at'])

def climate_value(features,station,day):
    rows=[f['properties'] for f in features if str(f.get('properties',{}).get('CLIMATE_IDENTIFIER'))==station
          and str(f['properties'].get('LOCAL_DATE',''))[:10]==day.isoformat()]
    if len(rows)>1:raise ValueError('Duplicate daily climate records')
    if not rows:return None,None
    return water.number(rows[0].get('TOTAL_PRECIPITATION')),rows[0].get('TOTAL_PRECIPITATION_FLAG')

class Rows(HTMLParser):
    def __init__(self):super().__init__();self.rows=[];self.row=None;self.cell=None
    def handle_starttag(self,tag,attrs):
        if tag=='tr':self.row=[]
        if tag in ('td','th') and self.row is not None:self.cell=[]
    def handle_data(self,text):
        if self.cell is not None:self.cell.append(text)
    def handle_endtag(self,tag):
        if tag in ('td','th') and self.cell is not None:
            if self.row is not None:self.row.append(' '.join(''.join(self.cell).split()))
            self.cell=None
        if tag=='tr' and self.row is not None:self.rows.append(self.row);self.row=None

def qc_value(text,station,day):
    parser=Rows();parser.feed(text)
    # Guard provider, requested month and exact 24-column daily layout, including flag columns.
    months=['janvier','février','mars','avril','mai','juin','juillet','août','septembre','octobre','novembre','décembre']
    flat=' '.join(' '.join(r) for r in parser.rows)
    if station not in flat or not re.search(months[day.month-1]+r'\s+'+str(day.year),flat,re.I):
        raise ValueError('Climate page returned another station or month')
    if 'Total (mm)' not in flat:raise ValueError('Climate precipitation headings changed')
    matches=[r for r in parser.rows if r and r[0]==f'{day.day:02d}' and len(r)==24]
    if len(matches)!=1:raise ValueError('Climate daily table changed or report date absent')
    raw,flag=matches[0][12:14]
    return water.number(raw),flag or ('trace' if raw.lower() in ('t','tr') else None)

def collect(report_date,reading_timezone='America/New_York',fetch=None,now=None):
    """Latest available station readings as of collection start; daily totals keep their period."""
    now=now or datetime.now(UTC);fetch=fetch or water.download
    day=now.astimezone(ZoneInfo(reading_timezone)).date();previous=day-timedelta(days=1);items=[]
    for row,station,label in WSC+USGS:
        usgs=(row,station,label) in USGS
        item=result(('E' if usgs else 'D')+str(row),label,station)
        item.update(unit='ft gauge height' if usgs else 'm',requestedAt=now.isoformat(),periodNote='Latest valid published observation at collection time.')
        try:
            if usgs:
                url=water.PROVIDERS['usgs']['endpoint'].replace('/continuous/','/latest-continuous/')+'?'+urlencode(dict(f='json',limit=100,monitoring_location_id='USGS-'+station,parameter_code='00065'))
                points=[]
                for features in newest_features(url,fetch):
                    for f in features:
                        p=f.get('properties',{})
                        if p.get('monitoring_location_id')!='USGS-'+station or p.get('parameter_code')!='00065':continue
                        if p.get('unit_of_measure')!='ft':raise ValueError('USGS gauge-height unit changed')
                        points.append(dict(at=water.timestamp(p['time']),value=water.number(p.get('value')),series=p.get('time_series_id'),quality=p.get('qualifier'),datum='Local gauge height; workbook stage offset retained'))
                point=latest(points,now)
            else:
                url=water.PROVIDERS['wsc']['endpoint']+'?'+urlencode(dict(f='json',limit=100,STATION_NUMBER=station,sortby='-DATETIME',datetime='../'+now.isoformat()))
                point=None
                for features in newest_features(url,fetch):
                    points=[]
                    for f in features:
                        p=f.get('properties',{})
                        if p.get('STATION_NUMBER')!=station:continue
                        points.append(dict(at=water.timestamp(p['DATETIME']),value=water.number(p.get('LEVEL')),series='water_level',quality=p.get('LEVEL_SYMBOL_EN'),datum=water.STATIONS[('wsc',station)]['datum']))
                    point=latest(points,now)
                    if point:break
            item['sourceUrl']=url
            if point:item.update(status='collected',value=point['value'],observedAt=point['at'].isoformat(),quality=point.get('quality'),datum=point.get('datum'))
            else:item['message']='No valid observation is published by the source as of collection time'
        except Exception as exc:item.update(status='error',message=str(exc)[:220])
        if row in (9,10):item['mappingNote']='Workbook site alias must be checked before automatic workbook writeback.'
        if usgs:item['mappingNote']='00065 gauge height; preserve workbook stage offsets and conversion.'
        age(item,now);items.append(item)
    for cell,station,label in CLIMATE+QC:
        item=result(cell,label+' precipitation',station);item.update(unit='mm',requestedAt=now.isoformat())
        try:
            value=flag=source_day=None
            if (cell,station,label) in QC:
                # Fetch each month once, then inspect complete source days newest first.
                month=previous.replace(day=1)
                for month_index in range(3):
                    url='https://www.environnement.gouv.qc.ca/climat/donnees/sommaire.asp?'+urlencode(dict(cle=station,date_selection=month.isoformat()))
                    text=fetch(url);candidate=min(previous,(month.replace(day=28)+timedelta(days=4)).replace(day=1)-timedelta(days=1))
                    while candidate>=month:
                        try:v,q=qc_value(text,station,candidate)
                        except ValueError as exc:
                            if 'daily table changed or report date absent' not in str(exc):raise
                            candidate-=timedelta(days=1);continue
                        if v is not None or str(q).lower() in ('t','tr','trace'):value,flag,source_day=v,q,candidate;break
                        candidate-=timedelta(days=1)
                    if source_day:break
                    month=(month-timedelta(days=1)).replace(day=1)
                item['periodNote']='Latest published completed provider day: 08:01 fixed EST to 08:00 EST the following day; search covers three months.'
            else:
                url='https://api.weather.gc.ca/collections/climate-daily/items?'+urlencode(dict(f='json',limit=100,CLIMATE_IDENTIFIER=station,sortby='-LOCAL_DATE'))
                for features in newest_features(url,fetch):
                    candidates=[]
                    for f in features:
                        p=f.get('properties',{})
                        if str(p.get('CLIMATE_IDENTIFIER'))!=station:continue
                        d=date.fromisoformat(str(p.get('LOCAL_DATE'))[:10]);v=water.number(p.get('TOTAL_PRECIPITATION'));q=p.get('TOTAL_PRECIPITATION_FLAG')
                        if d<=previous and (v is not None or str(q).lower() in ('t','trace')):candidates.append((d,v,q))
                    if candidates:
                        source_day=max(c[0] for c in candidates);matches=[c for c in candidates if c[0]==source_day]
                        if len(matches)!=1:raise ValueError('Duplicate latest daily precipitation records')
                        source_day,value,flag=matches[0];break
                item['periodNote']='Latest published completed provider LOCAL_DATE total; not instantaneous rainfall or a rolling 24-hour total.'
            item.update(value=value,quality=flag,sourceUrl=url,status='collected' if value is not None else 'missing')
            if source_day:item['sourceDate']=source_day.isoformat()
            if str(flag).lower() in ('t','tr','trace'):item.update(status='trace',message='Trace precipitation; retain provider flag')
            if item['status']=='missing':item['message']='No published daily precipitation found in the source search'
        except Exception as exc:item.update(status='error',message=str(exc)[:220])
        if cell=='D20':item['mappingNote']='Workbook Rouyn/LaSarre alias requires review.'
        age(item,now);items.append(item)
    item=result('D21','Timmins precipitation','Timmins Weatherstats daily');item.update(unit='mm',requestedAt=now.isoformat(),sourceUrl='https://timmins.weatherstats.ca/data/precipitation-daily.json',periodNote='Latest published completed daily total, not instantaneous precipitation.')
    try:
        data=json.loads(fetch(item['sourceUrl']));timmins_value(data,previous) # Validate product and units even when rows are absent.
        days=[]
        for row in data.get('rows',[]):
            raw=row.get('c',[{}])[0].get('v')
            if isinstance(raw,list) and len(raw)==3:
                d=date(raw[0],raw[1]+1,raw[2])
                if d<=previous:days.append(d)
        for d in sorted(set(days),reverse=True):
            value,flag=timmins_value(data,d)
            if value is not None or str(flag).lower() in ('t','trace'):
                item.update(value=value,quality=flag,sourceDate=d.isoformat(),status='collected' if value is not None else 'trace');break
    except Exception as exc:item.update(status='error',message=str(exc)[:220])
    age(item,now);items.append(item)
    item=result('D26','Rainy River water temperature','05PC021');item.update(unit='°C',requestedAt=now.isoformat(),periodNote='Latest published temperature in the provider 30-day query. Provider timestamps use fixed EST.')
    try:
        axes=json.loads(fetch('https://wateroffice.ec.gc.ca/services/real_time_graph_axes/json/inline?station_id=05PC021'))
        if not any(a.get('stationid')=='05PC021' and a.get('parameterid')=='5' and a.get('units_en')=='°C' for a in axes):raise ValueError('Water temperature parameter or units changed')
        local_day=now.astimezone(timezone(timedelta(hours=-5))).date()
        url='https://wateroffice.ec.gc.ca/services/real_time_graph/json/inline?'+urlencode(dict(station='05PC021',start_date=(local_day-timedelta(days=30)).isoformat(),end_date=local_day.isoformat(),param1='5'))
        data=json.loads(fetch(url)).get('5',{});points=[]
        for p in data.get('provisional',[])+data.get('final',[]):
            at=datetime.fromisoformat(p[0])
            if at.tzinfo is None:at=at.replace(tzinfo=timezone(timedelta(hours=-5)))
            points.append(dict(at=at.astimezone(UTC),value=water.number(p[1]),series='temperature'))
        point=latest(points,now);item['sourceUrl']=url
        if point:item.update(value=point['value'],status='collected',observedAt=point['at'].isoformat(),quality='Not quality controlled by provider')
        else:item['message']='No valid temperature found in the provider 30-day query'
    except Exception as exc:item.update(status='error',message=str(exc)[:220])
    age(item,now);items.append(item);items.append(raft_source(day,fetch=fetch,now=now))
    items.extend(result(cell,label,message=reason,status_override='blocked') for cell,label,reason in BLOCKED)
    for item in items:
        if 'status_override' in item:item['status']=item.pop('status_override')
    return dict(reportDate=report_date,readingTimezone=reading_timezone,collectionMode='latest',collectedAt=now.isoformat(),fields=items,
        deferred='Cogen PDFs, International Falls email and internal unit runtime are not included.')
