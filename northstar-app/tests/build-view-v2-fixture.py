"""Disposable loopback UI fixture; no production data, authentication, or backend changes."""
import http.server, json, pathlib, urllib.parse, datetime
ROOT=pathlib.Path(__file__).resolve().parents[1]
stamp=lambda:datetime.datetime.now(datetime.timezone.utc).isoformat()
def market_fixture():
    now=datetime.datetime.now(datetime.timezone.utc).replace(second=0,microsecond=0)
    series=lambda values,offset=-75:[{"time":(now+datetime.timedelta(minutes=offset+15*i)).isoformat(),"value":v} for i,v in enumerate(values)]
    return {"updated":stamp(),"stale":False,"nodes":{"IESO":{"rt":28.14,"da":42.5,"history":series([29,31,28,27,30,28.14]),"daHistory":series([42,42,43,43,42.5,42.5])},"APIROQ":{"rt":26.91,"da":41,"history":series([28,30,27,26,29,26.91]),"daHistory":series([40.5,40.5,41.5,41.5,41,41])}},"ontario":{"demand":18920,"forecastDemand":20100,"history":series([18500,18700,19200,19100,19000,18920]),"forecastSeries":series([19500,20100,20200],15)}}
def workers_fixture():
    names=['Sarah Chen','Matt Wilson','Emily Carter','Daniel Roy','Priya Singh','Lucas Moreau']
    sites=['Twin Falls','Iroquois Falls','Island Falls','Kenora','Norman','McDougal']
    return [{"id":"fixture-worker-"+str(i),"name":name,"site":sites[i],"company":"NorthStar" if i%3 else "Field Services","status":"checked-in","checkedIn":stamp(),"lastHeard":stamp()} for i,name in enumerate(names)]
drawing={"id":"fixture-drawing","name":"Twin Falls reviewed drawing","revision":1,"outageId":"","standardApprovalRef":"Fixture only","record":{"version":3,"symbols":[
{"id":"G1","type":"generator","x":180,"y":300,"rotation":0,"operatingState":"closed","assetTag":"G1 manual","label":"Generator","siteCode":"TW","scada":{},"measurements":[]},
{"id":"CB1","type":"breaker","x":420,"y":300,"rotation":0,"operatingState":"open","assetTag":"OLD NAME","label":"Generator breaker","siteCode":"TW","scada":{"feedCode":"plant","tagName":"TW-52G1","openValue":"0","closedValue":"1","staleAfterSeconds":120},"measurements":[]},
{"id":"T1","type":"transformer","x":700,"y":300,"rotation":0,"operatingState":"closed","assetTag":"T1","label":"Main transformer","siteCode":"TW","scada":{},"measurements":[]}
],"edges":[{"id":"e1","from":"G1","to":"CB1"},{"id":"e2","from":"CB1","to":"T1"}]}}
class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self,*a,**kw):super().__init__(*a,directory=str(ROOT),**kw)
    def log_message(self,*a):pass
    def do_GET(self):
        path=urllib.parse.urlparse(self.path).path
        if not path.startswith('/api/'):return super().do_GET()
        d={}
        if path=='/api/auth/session':d={"required":False,"username":"Fixture"}
        elif path=='/api/checkins':d=workers_fixture()
        elif path in ['/api/checkins/history','/api/alerts','/api/logbook']:d=[]
        elif path=='/api/outages':d=[{"site":"Kenora","description":"Unit 2 planned inspection","status":"planned"}]
        elif path=='/api/sites':d={"sites":[]}
        elif path=='/api/profile/crew-layout':d={"positions":{}}
        elif path=='/api/weather':d={"stations":[{"name":"Iroquois Falls","current":{"temperature_2m":9,"weather_code":3,"precipitation_probability":20,"wind_speed_10m":12},"hourly":{"time":[stamp()],"temperature_2m":[9]}}]}
        elif path=='/api/market-prices':d=market_fixture()
        elif path=='/api/scada':d={"feeds":[{"feedCode":"plant","status":"Current"}],"readings":[{"feedCode":"plant","siteCode":"TW","tagName":"TW-52G1","displayName":"Generator breaker","numericValue":1,"sourceQuality":"good","observedAt":stamp()}]}
        elif path=='/api/events/register':d={"items":[{"eventId":"fixture-event","siteId":"site:twin-falls","site":"Twin Falls","summary":"Scheduled inspection recorded","occurredAt":stamp(),"severity":"info"}],"total":1}
        elif path=='/api/chat/messages':d={"messages":[]}
        elif path=='/api/uwpc/requests':d={"requests":[],"operators":[],"actor":"Fixture","correspondence":[]}
        elif path.endswith('/catalog'):d={"available":False,"readOnly":True,"caseCount":0,"recordCount":0,"categories":[],"years":[],"statuses":[],"source":{}}
        elif path in ['/api/incident-library','/api/service-requests']:d={"available":False,"page":1,"limit":60,"total":0,"pages":0,"records":[],"source":{}}
        elif path=='/api/ai/knowledge':d={"sites":[]}
        elif path=='/api/ai/workspace':d={"projects":[],"conversations":[]}
        elif path=='/api/console/status':d={"stations":[],"sites":None,"actor":"Fixture"}
        elif path=='/api/console/feed':d={"tasks":[],"alarms":[],"recent":[]}
        elif path.startswith('/api/console/'):d={"items":[],"nextCursor":None}
        elif path=='/api/schematics':d=[{k:v for k,v in drawing.items() if k!='record'}]
        elif path=='/api/schematics/fixture-drawing':d=drawing
        self.send_response(200);self.send_header('Content-Type','application/json');self.end_headers();self.wfile.write(json.dumps(d).encode())
    def do_POST(self):
        if self.path=='/api/schematics/fixture-drawing':
            d=json.loads(self.rfile.read(int(self.headers.get('Content-Length',0))))
            if d['revision']!=drawing['revision']:
                self.send_response(409);self.end_headers();self.wfile.write(b'{"error":"Revision conflict"}');return
            drawing.update(d);drawing['revision']+=1
            self.send_response(200);self.send_header('Content-Type','application/json');self.end_headers();self.wfile.write(json.dumps(drawing).encode());return
        self.send_response(405);self.end_headers()
server=http.server.ThreadingHTTPServer(('127.0.0.1',0),Handler)
print('Fixture URL: http://127.0.0.1:'+str(server.server_port)+'/northstar-clean.html',flush=True)
server.serve_forever()
