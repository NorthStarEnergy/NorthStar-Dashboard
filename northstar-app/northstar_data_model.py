"""Typed, empty dataset layouts for the PostgreSQL data workspace."""
from __future__ import annotations

def field(key, label, kind='text', unit='', required=False):
    return dict(key=key, label=label, type=kind, unit=unit, required=required)

SITE = field('site', 'Station', required=True)
EQUIPMENT = field('equipment', 'Equipment')
TIME = field('observed_at', 'Observed at', 'datetime', required=True)
QUALITY = field('quality', 'Quality')
SOURCE = field('source', 'Source reference')
NOTES = field('notes', 'Notes')
DATASETS = {
 'runtime': dict(name='Unit runtime', description='Operating intervals and running hours', icon='◷', fields=[SITE,EQUIPMENT,field('started_at','Started at','datetime',required=True),field('ended_at','Ended at','datetime'),field('state','State'),field('running_hours','Running hours','number','h'),SOURCE,NOTES]),
 'power': dict(name='Power & energy',description='Generation, demand and electrical readings',icon='ϟ',fields=[SITE,EQUIPMENT,TIME,field('power_mw','Active power','number','MW'),field('energy_mwh','Energy','number','MWh'),field('interval_hours','Interval duration','number','h'),field('voltage_kv','Voltage','number','kV'),QUALITY,SOURCE]),
 'water': dict(name='Water & flows',description='Levels, discharge and water conditions',icon='≈',fields=[SITE,field('gauge','Gauge'),TIME,field('level_m','Water level','number','m'),field('flow_m3s','Flow','number','m³/s'),field('temperature_c','Water temperature','number','°C'),field('datum','Level datum'),QUALITY,SOURCE]),
 'weather': dict(name='Weather',description='Observed weather and separately identified forecasts',icon='☁',fields=[SITE,TIME,field('kind','Observed / forecast',required=True),field('issued_at','Forecast issued at','datetime'),field('temperature_c','Temperature','number','°C'),field('precipitation_mm','Precipitation','number','mm'),field('wind_kmh','Wind speed','number','km/h'),QUALITY,SOURCE]),
 'operations': dict(name='Operations',description='Operational records and maintenance references',icon='≡',fields=[SITE,EQUIPMENT,field('occurred_at','Occurred at','datetime',required=True),field('category','Category'),field('status','Status'),field('summary','Summary',required=True),SOURCE,NOTES]),
 'generators': dict(name='Generators',description='Generator ratings and equipment specifications',icon='◎',fields=[SITE,field('equipment','Generator',required=True),field('manufacturer','Manufacturer'),field('model','Model'),field('rated_mw','Rated power','number','MW'),field('rated_mva','Rated apparent power','number','MVA'),field('voltage_kv','Rated voltage','number','kV'),field('speed_rpm','Rated speed','number','rpm'),SOURCE,NOTES]),
 'equipment': dict(name='Equipment',description='Asset details and reference information',icon='▧',fields=[SITE,field('equipment','Designation',required=True),field('kind','Equipment type'),field('manufacturer','Manufacturer'),field('model','Model'),field('serial_number','Serial number'),field('commissioned_on','Commissioned on','date'),field('status','Status'),SOURCE,NOTES]),
 'ecology': dict(name='Fish & environment',description='Spawning observations and survey context',icon='◇',fields=[SITE,field('reach','River reach'),TIME,field('species','Species',required=True),field('life_stage','Life stage'),field('spawning_stage','Spawning stage'),field('measure','Fish / redd / egg / presence',required=True),field('count','Count','integer'),field('presence','Presence'),field('method','Survey method'),field('effort_hours','Survey effort','number','h'),SOURCE,NOTES]),
}

BASE_FIELDS = [field('_id','Record ID'),field('_version','Revision','integer'),field('_created_at','Created at','datetime'),field('_updated_at','Updated at','datetime'),field('_actor','Last edited by')]
SQL_TYPES = {'text':'text','number':'double precision','integer':'bigint','datetime':'timestamptz','date':'date'}

def dataset(name):
    if name not in DATASETS:
        raise ValueError('Unknown dataset')
    return DATASETS[name]

def fields(name):
    return {f['key']:f for f in dataset(name)['fields'] + BASE_FIELDS}
