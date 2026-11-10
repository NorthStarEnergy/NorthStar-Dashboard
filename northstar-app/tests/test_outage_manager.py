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
