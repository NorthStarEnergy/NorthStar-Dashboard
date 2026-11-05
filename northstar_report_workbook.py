"""Lossless XLSM media-only refresh: preserve VBA, links, formulas and object anchors.

The native chart userShapes holding pasted forecasts are not round-tripped through
an XLSX authoring engine. Only identified PNG ZIP entries are replaced.
"""
from pathlib import Path
import hashlib
import posixpath
import struct
import zipfile
import xml.etree.ElementTree as ET

NS={'s':'http://schemas.openxmlformats.org/spreadsheetml/2006/main',
    'x':'http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing',
    'a':'http://schemas.openxmlformats.org/drawingml/2006/main',
    'c':'http://schemas.openxmlformats.org/drawingml/2006/chart'}
RID='{http://schemas.openxmlformats.org/officeDocument/2006/relationships}'

def relations(z,part):
    path=posixpath.dirname(part)+'/_rels/'+posixpath.basename(part)+'.rels'
    if path not in z.namelist():return {}
    return {r.get('Id'):dict(type=r.get('Type'),target=r.get('Target'),
              part=posixpath.normpath(posixpath.join(posixpath.dirname(part),r.get('Target',''))))
            for r in ET.fromstring(z.read(path))}

def inspect_template(path):
    with zipfile.ZipFile(path) as z:
        if len(z.infolist())>10000 or sum(i.file_size for i in z.infolist())>150_000_000:raise ValueError('Template is too large')
        workbook=ET.fromstring(z.read('xl/workbook.xml'));rels=relations(z,'xl/workbook.xml')
        sheet=next((s for s in workbook.find('s:sheets',NS) if s.get('name')=='DR'),None)
        if sheet is None:raise ValueError('Template has no DR worksheet')
        part=rels[sheet.get(RID+'id')]['part'];sr=relations(z,part);xml=ET.fromstring(z.read(part))
        links={h.get('ref'):sr[h.get(RID+'id')]['target'] for h in xml.findall('s:hyperlinks/s:hyperlink',NS) if h.get(RID+'id') in sr}
        dp=sr[xml.find('s:drawing',NS).get(RID+'id')]['part'];dr=relations(z,dp);drawing=ET.fromstring(z.read(dp))
        forecasts=[];graphs={k:[] for k in ('kapuskasing','du-nord','jacques-cartier')}
        for anchor in drawing:
            row=anchor.find('x:from/x:row',NS)
            if row is None:continue
            row=int(row.text)+1
            for chart in anchor.findall('.//c:chart',NS):
                cp=dr[chart.get(RID+'id')]['part'];cr=relations(z,cp)
                for r in cr.values():
                    if not r['type'].endswith('/chartUserShapes'):continue
                    candidates=[(abs(int(cell[2:])-row),url) for cell,url in links.items() if cell.startswith('BC') and cell[2:].isdigit() and 'theweathernetwork.com/en/city/ca/' in url and abs(int(cell[2:])-row)<=3]
                    if not candidates:raise ValueError('Forecast chart has no nearby verified location link')
                    url=min(candidates)[1];city=url.split('/')[-2];rr=relations(z,r['part'])
                    image_parts=[a['part'] for a in rr.values() if a['type'].endswith('/image')]
                    if image_parts:forecasts.append(dict(id=city,url=url,parts=image_parts,row=row))
            for pic in anchor.findall('x:pic',NS):
                blip=pic.find('.//a:blip',NS)
                if blip is None:continue
                # These are the three screen-snipped slots in the inspected DR layout.
                key={176:'kapuskasing',257:'du-nord',285:'jacques-cartier'}.get(row)
                if key:graphs[key].append(dr[blip.get(RID+'embed')]['part'])
        if len(forecasts)!=10 or any(not p for p in graphs.values()):raise ValueError('Daily report image layout changed; review template mapping')
        forecasts.sort(key=lambda target: target['row'])
        targets=forecasts+[dict(id='flow-'+k,parts=v,url=('https://wateroffice.ec.gc.ca/report/real_time_e.html?stn=04LF001' if k=='kapuskasing' else 'https://www.cehq.gouv.qc.ca/suivihydro/graphique.asp?NoStation='+('040110' if k=='du-nord' else '050801'))) for k,v in graphs.items()]
        all_parts=[p for t in targets for p in t['parts']]
        if len(all_parts)!=len(set(all_parts)) or any(not p.startswith('xl/media/') or not p.endswith('.png') for p in all_parts):raise ValueError('Unexpected overlapping/non-PNG image mapping')
        return targets

def refresh(template,output,images):
    template=Path(template);output=Path(output)
    if template.resolve()==output.resolve() or output.exists():raise ValueError('Write a new draft; never overwrite the source or an existing report')
    targets=inspect_template(template);replacements={}
    for target in targets:
        if target['id'] not in images:raise ValueError('Missing capture or explicit unavailable image: '+target['id'])
        raw=Path(images[target['id']]).read_bytes()
        if len(raw)>8_000_000 or raw[:8]!=b'\x89PNG\r\n\x1a\n' or len(raw)<24:raise ValueError('Invalid PNG capture')
        width,height=struct.unpack('>II',raw[16:24])
        if not (100<=width<=6000 and 80<=height<=6000):raise ValueError('Invalid capture dimensions')
        for part in target['parts']:replacements[part]=raw
    output.parent.mkdir(parents=True,exist_ok=True)
    try:
        with zipfile.ZipFile(template) as source,zipfile.ZipFile(output,'w') as dest:
            for info in source.infolist():dest.writestr(info,replacements.get(info.filename,source.read(info.filename)))
        with zipfile.ZipFile(template) as source,zipfile.ZipFile(output) as dest:
            if source.namelist()!=dest.namelist():raise ValueError('Workbook parts changed')
            for name in source.namelist():
                if name not in replacements and source.read(name)!=dest.read(name):raise ValueError('Unrelated workbook content changed')
    except Exception:
        output.unlink(missing_ok=True);raise
    return dict(replacedMediaParts=len(replacements),templateSha256=hashlib.sha256(template.read_bytes()).hexdigest(),
                outputSha256=hashlib.sha256(output.read_bytes()).hexdigest(),preserved='All non-media ZIP entries byte-identical, including VBA, formulas, links, sheet values and anchors')
