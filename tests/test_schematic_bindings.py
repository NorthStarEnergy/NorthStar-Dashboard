import northstar_store as store


def test_bindings_survive_server_normalization_without_telemetry():
    record = {"symbols": [{"id": "CB1", "type": "breaker", "assetTag": "52-A",
        "siteCode": "TEST", "voltage": "115 kV", "description": "Main breaker",
        "scada": {"feedCode": "plant", "tagName": "CB1.POS", "openValue": "OFF", "closedValue": "ON", "staleAfterSeconds": 120, "value": 1},
        "measurements": [{"feedCode": "plant", "tagName": "CB1.A", "label": "Current", "unit": "A", "numericValue": 50}]}], "edges": []}
    first = store._normalise_one_line_record(record)
    assert store._normalise_one_line_record(first) == first
    symbol = first["symbols"][0]
    assert symbol["assetTag"] == "52-A"
    assert symbol["siteCode"] == "TEST"
    assert symbol["scada"] == {"feedCode": "plant", "tagName": "CB1.POS", "openValue": "OFF", "closedValue": "ON", "staleAfterSeconds": 120}
    assert symbol["measurements"][0]["tagName"] == "CB1.A"
    assert "numericValue" not in symbol["measurements"][0]


def test_legacy_and_malformed_bindings_are_bounded():
    record = store._normalise_one_line_record({"symbols": [{"id":"CB1", "type":"breaker", "scada":[], "measurements":[None] + [{"tagName":"x"*1000,"staleAfterSeconds":-4}]*10}], "edges":[]})
    symbol = record["symbols"][0]
    assert symbol["scada"]["tagName"] == ""
    assert len(symbol["measurements"]) <= 6
    assert len(symbol["measurements"][0]["tagName"]) == 160
    assert symbol["measurements"][0]["staleAfterSeconds"] == 10
