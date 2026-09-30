"""Operator-initiated, read-only Microsoft Graph access for personal accounts."""
from __future__ import annotations

import os
import threading
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

import northstar_store as store


GRAPH_ROOT = "https://graph.microsoft.com/v1.0"
AUTHORITY = "https://login.microsoftonline.com/consumers"
SCOPES = ["User.Read", "Mail.ReadBasic", "offline_access"]
_LOCK = threading.RLock()
_status = {"state": "not_configured", "detail": "Add NORTHSTAR_GRAPH_CLIENT_ID to local runtime configuration."}
_device_flow: dict | None = None
_client = None
_cache = None


class GraphError(RuntimeError):
    pass


def _application():
    global _client, _cache
    if _client is not None:
        return _client
    client_id = os.environ.get("NORTHSTAR_GRAPH_CLIENT_ID", "").strip()
    if not client_id:
        raise GraphError("Microsoft Graph app registration is not configured.")
    if os.name != "nt":
        raise GraphError("Encrypted Graph token storage requires the Windows desktop runtime.")
    try:
        import msal
        from msal_extensions import PersistedTokenCache, build_encrypted_persistence
    except ImportError as exc:
        raise GraphError("Microsoft Graph authentication dependencies are not installed.") from exc
    try:
        cache_path = store.DB_PATH.parent / ".northstar-graph-cache.bin"
        cache_path.parent.mkdir(parents=True, exist_ok=True)
        persistence = build_encrypted_persistence(str(cache_path))
        _cache = PersistedTokenCache(msal.SerializableTokenCache(), persistence)
        _client = msal.PublicClientApplication(client_id, authority=AUTHORITY, token_cache=_cache)
    except Exception as exc:
        raise GraphError("Windows encrypted Graph token storage could not be initialized.") from exc
    return _client


def status() -> dict:
    result = dict(_status)
    result["provider"] = "microsoft_graph"
    result["accountType"] = "personal_microsoft_account"
    result["connected"] = result.get("state") == "connected"
    result["capabilities"] = ["profile.read", "mail.headers.read"]
    result["teamsChatSupported"] = False
    try:
        client = _application()
        if _status.get("state") == "not_configured":
            result.update(state="disconnected", detail="Ready for personal Microsoft account sign-in.")
        accounts = client.get_accounts()
        if accounts and _status.get("state") not in {"authorizing", "error"}:
            result.update(state="connected", connected=True,
                          account=accounts[0].get("username", ""), detail="Personal Microsoft account is connected.")
    except GraphError as exc:
        result.update(state="not_configured", connected=False, detail=str(exc))
    return result


def begin_device_sign_in() -> dict:
    global _device_flow
    with _LOCK:
        if _status.get("state") == "authorizing":
            raise GraphError("Sign-in is already waiting for account approval.")
        client = _application()
        try:
            flow = client.initiate_device_flow(scopes=SCOPES)
        except Exception as exc:
            raise GraphError("Microsoft sign-in could not be started. Check the app registration and network.") from exc
        if not flow or "user_code" not in flow:
            raise GraphError("Microsoft could not start account sign-in.")
        _device_flow = flow
        _status.update(state="authorizing", detail="Complete sign-in in your browser.",
                       userCode=flow["user_code"], verificationUri=flow.get("verification_uri"),
                       expiresAt=flow.get("expires_at"))
        threading.Thread(target=_finish_sign_in, args=(client, flow), name="northstar-graph-signin", daemon=True).start()
        return {"state": "authorizing", "userCode": flow["user_code"],
                "verificationUri": flow.get("verification_uri"), "message": flow.get("message", "")}


def _finish_sign_in(client, flow):
    global _device_flow
    try:
        result = client.acquire_token_by_device_flow(flow)
        with _LOCK:
            if result and result.get("access_token"):
                _status.clear()
                _status.update(state="connected", detail="Personal Microsoft account is connected.")
            else:
                _status.clear()
                _status.update(state="error", detail="Microsoft sign-in did not complete. Start again to retry.")
    except Exception:
        with _LOCK:
            _status.clear()
            _status.update(state="error", detail="Microsoft sign-in failed. Start again to retry.")
    finally:
        with _LOCK:
            _device_flow = None


def _access_token() -> str:
    client = _application()
    accounts = client.get_accounts()
    if not accounts:
        raise GraphError("Connect a Microsoft account first.")
    result = client.acquire_token_silent(SCOPES, account=accounts[0])
    if not result or not result.get("access_token"):
        raise GraphError("Microsoft sign-in expired. Connect the account again.")
    return result["access_token"]


def _get(path: str) -> dict:
    request = Request(GRAPH_ROOT + path, headers={"Authorization": "Bearer " + _access_token(),
                                                  "Accept": "application/json"})
    try:
        with urlopen(request, timeout=20) as response:
            import json
            data = json.loads(response.read().decode("utf-8"))
            if not isinstance(data, dict):
                raise GraphError("Microsoft Graph returned an unexpected response.")
            return data
    except HTTPError as exc:
        raise GraphError("Microsoft Graph rejected the request (HTTP %s)." % exc.code) from exc
    except (URLError, TimeoutError, ValueError, TypeError) as exc:
        raise GraphError("Microsoft Graph is temporarily unavailable.") from exc


def profile() -> dict:
    data = _get("/me?$select=displayName,mail,userPrincipalName,id")
    return {key: data.get(key) for key in ("id", "displayName", "mail", "userPrincipalName")}


def messages(limit: int = 25) -> dict:
    limit = max(1, min(int(limit), 50))
    query = urlencode({"$select": "id,subject,from,receivedDateTime,conversationId,webLink,hasAttachments",
                       "$orderby": "receivedDateTime desc", "$top": str(limit)})
    data = _get("/me/messages?" + query)
    return {"messages": data.get("value", []), "count": len(data.get("value", []))}
