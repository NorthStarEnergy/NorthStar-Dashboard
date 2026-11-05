import pytest
import northstar_store as store
import northstar_crew_profile as profile

def test_account_isolation_and_validation(tmp_path, monkeypatch):
    monkeypatch.setattr(store, 'DB_PATH', tmp_path/'test.db')
    positions={code:{'x':25,'y':32} for code in profile.CODES}
    assert profile.layout('alice',positions)['positions']==positions
    assert profile.layout('bob')['positions']=={}
    assert profile.layout('alice')['positions']==positions
    with pytest.raises(ValueError):
        profile.layout('alice',{'TW':{'x':0,'y':0}})
    positions['TW']['x']=float('nan')
    with pytest.raises(ValueError):
        profile.layout('alice',positions)
