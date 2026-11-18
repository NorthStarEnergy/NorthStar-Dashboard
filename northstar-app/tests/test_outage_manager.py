import io
import uuid

import pytest
from pypdf import PdfReader, PdfWriter

import northstar_outage_manager as manager
import northstar_store as store
import northstar_uwpc_desk as desk


@pytest.fixture
def db(tmp_path, monkeypatch):
    monkeypatch.setattr(store, "DB_PATH", tmp_path / "manager.sqlite")
    store.init_db()


def request(**values):
    return {"requestKey":str(uuid.uuid4()), "title":"Feeder inspection", "site":"North",
            "asset":"Feeder A","scope":"Verify the planned outage boundaries.", "severity":"Degraded",
            "start":"2030-09-08T12:00:00Z","end":"2030-09-08T15:00:00Z",
            "affectedSites":["South"],"reviewTrigger":"crew dependency",**values}


def test_create_once_and_query_shared_register(db):
    data = request()
    record = manager.create_request(data, "manager")
    assert manager.create_request(data, "manager") == record
    with pytest.raises(desk.Conflict):
        manager.create_request({**data,"title":"Changed"}, "manager")
    r = manager.query_register({"q":"inspection feeder","site":"South","severity":"Degraded"})
    assert r["total"] == 1 and r["rows"][0]["id"]==record["id"]
    assert r["rows"][0]["packageId"] == record["packageId"]
    plan = desk.get(record["packageId"])
    assert plan["registerOutage"] == record["id"] and plan["reviewTrigger"]=="multi-site"
    assert manager.details(record["id"])["documents"][0]["id"]==plan["id"]
    assert not manager.query_register({"q":"' OR 1=1 --"})["total"]
    assert not manager.query_register({"from":"2030-10-01T00:00:00Z"})["total"]
    assert manager.query_register({"offset":"999"})["offset"] == 0


def test_tags_and_read_state_belong_to_the_recipient(db):
    oid=manager.create_request(request(),"manager")["id"]
    payload={"outage":oid,"recipient":"field","note":"Check the site schedule"}
    accounts=["manager","field","area"]
    with pytest.raises(ValueError):
        manager.tag_person({**payload,"recipient":"unknown"},"manager",accounts)
    manager.tag_person(payload,"manager",accounts)
    [item]=manager.inbox("field")["items"]
    assert item["unread"] and item["outage"]==oid
    assert not manager.inbox("area")["items"]
    with pytest.raises(LookupError):
        manager.inbox("area",item["key"])
    manager.inbox("field",item["key"])
    manager.tag_person(payload,"manager",accounts)
    items=manager.inbox("field")["items"]
    assert [i["unread"] for i in items]==[True,False]
    assert len([e for e in manager.outage_report(oid)["events"] if e["event"]=="person-tagged"])==2


def test_area_sort_and_cross_area_filter_before_pagination(db):
    primary = ["Island Falls GS", "KAP", "CL", "Bird GS", "Unmapped"]
    for site in primary:
        manager.create_request(request(site=site, affectedSites=["OKI"] if site=="CL" else []),"manager")
    for _ in range(30):
        manager.create_request(request(site="IS",affectedSites=[]),"manager")
    first=manager.query_register({"sort":"area"})
    assert first["total"]==35 and first["rows"][0]["areas"]==["West","KAP / OKI"]
    assert first["rows"][1]["areas"]==["KAP / OKI"]
    assert manager.query_register({"sort":"area","offset":"30"})["rows"][-1]["areas"]==["Unassigned"]
    assert manager.query_register({"sort":"area","direction":"desc"})["rows"][0]["areas"]==["Quebec"]
    assert manager.query_register({"area":"IR / TW / IS"})["total"]==31
    assert manager.query_register({"area":"KAP / OKI"})["total"]==2


def test_site_device_union_uses_location_boundaries_and_real_references(db,monkeypatch):
    import northstar_maximo as maximo
    assets=[{"site":"FFO","location":"FFO-NOG-1","assetNum":f"N{i}","description":"Fixture asset"} for i in range(122)]
    assets.extend([{**assets[0],"location":"FFO-KEG","assetNum":"K1"},
                   {**assets[0],"location":"FFO-NOG2","assetNum":"WRONG"}])
    monkeypatch.setattr(maximo,"_load_equipment_snapshot",lambda:{"assets":assets})
    monkeypatch.setattr(maximo,"config",lambda:{"sites":{}})
    store.create_one_line_document({"name":"Fixture","record":{"symbols":[
        {"id":"s","type":"breaker","assetTag":"Drawing tag","siteCode":"Kenora GS","label":"Fixture breaker"}]}}, "operator")
    devices=manager.site_devices(["Norman GS","Kenora"])["devices"]
    assert len(devices)==124 and {d["site"] for d in devices}=={"Norman","Kenora"}
    assert {d["ref"] for d in devices if d["site"]=="Kenora"}=={"Drawing tag","K1"}
    assert not manager.site_devices(["Other site"])["devices"]


def test_register_preserves_closed_and_unlinked_records(db):
    old=store.create_outage({"title":"Past outage","site":"East"})
    assert manager.query_register({"tab":"active"})["rows"][0]["id"]==old["id"]
    store.close_outage(old["id"])
    assert manager.query_register({"tab":"past"})["rows"][0]["id"]==old["id"]
    doc={"title":"Existing PC17A","site":"East","outageId":"PRE-4","template":"pc17a","kind":"SWITCHING_PLAN",
         "switchingPlan":{"purpose":"An existing order","steps":[{"device":"Ref","operation":"Record"}]}}
    for _ in range(2):
        desk.create(doc,"manager")
    assert manager.query_register({})["total"]==1
    assert len(manager.details("PRE-4")["documents"])==2
    with pytest.raises(ValueError):
        manager.create_request(request(start="2030-09-09T12:00:00Z"),"manager")


def test_failed_package_rolls_back_request(db, monkeypatch):
    def fail(*a,**kw):
        raise RuntimeError("storage failure")
    monkeypatch.setattr(desk,"create",fail)
    with pytest.raises(RuntimeError):
        manager.create_request(request(),"manager")
    assert not store.list_outages()


def test_checkout_fences_all_package_documents_and_records_handoff(db, monkeypatch):
    outage = manager.create_request(request(), "manager")
    plan = outage["packageId"]
    other = desk.create({"kind":"REQUEST_GUARANTEE","template":"pc10c-sg","title":"Guarantee",
                         "outageId":outage["id"],"site":"North","scope":"Inspection"}, "field")
    a,b = str(uuid.uuid4()),str(uuid.uuid4())
    desk.checkout(plan,"check-out","manager",a)
    state=desk.checkout(other["id"],None,"field",b)
    assert state["owner"]=="manager" and not state["mine"]
    with pytest.raises(desk.Conflict):
        desk.checkout(other["id"],"check-out","field",b)
    for actor,token in [("field",a),("manager",b),("manager","")]:
        with pytest.raises(desk.Conflict):
            desk.add_source(other["id"],other["version"],"drawing.txt","diagram",b"fixture",actor,checkout_token=token)
        with pytest.raises(ValueError):
            desk.checkout(plan,"check-in",actor,token)
    saved=desk.add_source(other["id"],other["version"],"drawing.txt","diagram",b"fixture","manager",checkout_token=a)
    with pytest.raises(desk.Conflict):
        desk.add_source(other["id"],other["version"],"drawing.txt","diagram",b"stale","manager",checkout_token=a)
    due=desk.checkout(plan,None,"manager",a)["expires"]
    monkeypatch.setattr(desk.time,"time",lambda:due+1)
    desk.checkout(other["id"],"check-out","field",b)
    with pytest.raises(desk.Conflict):
        desk.change(other["id"],"remove-source",{"version":saved["version"],"sourceId":saved["sources"][0]["id"]},"manager",checkout_token=a)
    desk.checkout(other["id"],"check-in","field",b)
    with pytest.raises(desk.Conflict):
        desk.add_source(other["id"],saved["version"],"drawing.txt","diagram",b"fixture","field",checkout_token=b)
    report=manager.outage_report(outage["id"])
    assert {doc["id"] for doc in report["documents"]} == {plan,other["id"]}
    assert {e["event"] for e in report["events"]} >= {"opened","checked-out","checkout-expired","checked-in"}
    assert {r["id"] for r in manager.report_options()} == {outage["id"]}


def test_concurrent_checkout_has_one_owner_and_reports_are_read_only(db):
    from concurrent.futures import ThreadPoolExecutor
    from threading import Barrier
    outage=manager.create_request(request(),"author")
    barrier=Barrier(2)
    def acquire(actor):
        token=str(uuid.uuid4())
        barrier.wait(timeout=5)
        try:
            desk.checkout(outage["packageId"],"check-out",actor,token)
        except desk.Conflict:
            return None
        return actor
    with ThreadPoolExecutor(max_workers=2) as pool:
        owners=[o for o in pool.map(acquire,["first","second"]) if o]
    assert len(owners)==1
    before=manager.outage_report(outage["id"])
    assert [e["actor"] for e in before["events"] if e["event"]=="checked-out"]==owners
    assert manager.outage_report(outage["id"])["events"]==before["events"]


def test_library_preserves_source_pages_and_refuses_another_edition(monkeypatch):
    pdf=PdfWriter()
    for _ in range(145):
        pdf.add_blank_page(width=300,height=460)
    pdf.add_outline_item("Contents",3)
    buffer=io.BytesIO()
    pdf.write(buffer)
    doc={"filename":"code.pdf","sha256":manager.BOOK_HASH,"title":"UWPC","status":"REFERENCE_ONLY","revision":"2024"}
    monkeypatch.setattr(manager,"source",lambda actor:{"id":"book"})
    monkeypatch.setattr(manager.knowledge,"read_file",lambda ident,actor:(doc,buffer.getvalue(),"application/pdf"))
    monkeypatch.setattr(manager.knowledge,"get_source",lambda ident,actor:{"passages":[{"page":95,"text":"Find a permit application"}]})
    lib=manager.library("operator","permit")
    assert lib["pages"]==145 and lib["hits"][0]["page"]==95
    assert lib["topics"][0]["page"]==4 and lib["questions"]
    for item in lib["forms"]:
        content, name=manager.library_file("operator",item["id"])
        assert len(PdfReader(io.BytesIO(content)).pages)==len(item["pages"]) and name.endswith(".pdf")
    doc["sha256"]="other"
    assert manager.library("operator","")["forms"]==[]
    with pytest.raises(LookupError):
        manager.library_file("operator","pc2")
