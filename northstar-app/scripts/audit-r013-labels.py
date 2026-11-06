"""Audit browser-exported SVG bounds and wire paths; input is a JSON scene file.

Bounds must be in SVG viewBox coordinates. Export labels, symbols, markers and
non-symbol stroked paths (d plus rendered bounds) from the rendered browser DOM.
Only absolute M/L/H/V/C commands are accepted; unsupported geometry fails closed.
"""
import json
import math
import re
import sys
from pathlib import Path


def overlaps(a,b,pad=2):
    return (a['x'] < b['x']+b['w']+pad and a['x']+a['w'] > b['x']-pad
        and a['y'] < b['y']+b['h']+pad and a['y']+a['h'] > b['y']-pad)


def points(path):
    tokens=re.findall(r'[A-Za-z]|[-+]?(?:[0-9]*\.)?[0-9]+(?:[eE][-+]?[0-9]+)?',path)
    i=0;x=y=0;out=[];command=None
    while i<len(tokens):
        if tokens[i].isalpha():command=tokens[i];i+=1
        if command not in {'M','L','H','V','C'}:raise ValueError('Unsupported path command: '+str(command))
        n={'M':2,'L':2,'H':1,'V':1,'C':6}[command]
        a=list(map(float,tokens[i:i+n]));i+=n
        if command=='M':x,y=a;out.append((x,y));command='L';continue
        if command=='C':
            x1,y1,x2,y2,endx,endy=a
            steps=max(2,math.ceil((math.hypot(x1-x,y1-y)+math.hypot(x2-x1,y2-y1)+math.hypot(endx-x2,endy-y2))/.5))
            for k in range(steps+1):
                t=k/steps;u=1-t
                out.append((u**3*x+3*u*u*t*x1+3*u*t*t*x2+t**3*endx,u**3*y+3*u*u*t*y1+3*u*t*t*y2+t**3*endy))
        else:
            endx,endy=a if command=='L' else (a[0],y) if command=='H' else (x,a[0])
            steps=max(1,math.ceil(math.hypot(endx-x,endy-y)/.5))
            out.extend((x+(endx-x)*k/steps,y+(endy-y)*k/steps) for k in range(steps+1))
        x,y=endx,endy
    return out


def audit(scene):
    issues=[];labels=scene['labels']
    wires=[]
    for path in scene['paths']:
        pts=points(path['d'])
        dx=path['b']['x']-min(p[0] for p in pts);dy=path['b']['y']-min(p[1] for p in pts)
        wires.append([(x+dx,y+dy) for x,y in pts])
    for i,a in enumerate(labels):
        b=a['b']
        for kind in ['symbols','markers','captions']:
            for other in scene.get(kind,[]):
                if overlaps(b,other['b']):issues.append(dict(label=a['id'],text=a['text'],kind=kind,other=other['id']))
        for other in labels[i+1:]:
            if overlaps(b,other['b']):issues.append(dict(label=a['id'],text=a['text'],kind='label',other=other['id'],otherText=other['text']))
        for index,wire in enumerate(wires):
            if any(b['x']-2<=x<=b['x']+b['w']+2 and b['y']-2<=y<=b['y']+b['h']+2 for x,y in wire):
                issues.append(dict(label=a['id'],text=a['text'],kind='wire',other=index))
    return dict(labels=len(labels),symbols=len(scene['symbols']),markers=len(scene.get('markers',[])),wirePaths=len(wires),captions=len(scene.get('captions',[])),clearanceSvgUnits=2,issues=issues)


if __name__=='__main__':
    result=audit(json.loads(Path(sys.argv[1]).read_text(encoding='utf-8')))
    print(json.dumps(result,indent=2))
    sys.exit(bool(result['issues']))
