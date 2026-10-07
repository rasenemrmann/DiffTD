"""HTTP API behind the Web Server DAT (contracts/reload-endpoint.md). Pure: no TD imports."""

import json

from . import reload as reload_mod
from . import snapshot as S

REASONS = {200: "OK", 204: "No Content", 400: "Bad Request", 403: "Forbidden", 404: "Not Found",
           409: "Conflict", 415: "Unsupported Media Type", 500: "Internal Server Error"}


def _cors(headers, config):
    origin = headers.get("origin")
    if origin and origin in config["allowedOrigins"]:
        return {
            "Access-Control-Allow-Origin": origin,
            "Vary": "Origin",
            "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type",
        }
    return {}


def _json(status, payload, extra=None):
    headers = {"Content-Type": "application/json"}
    headers.update(extra or {})
    return status, headers, json.dumps(payload)


def handle_request(method, uri, headers, body, rt):
    """Return (status, headers, body_text). `headers` keys may be any case."""
    headers = {str(k).lower(): v for k, v in (headers or {}).items()}
    path = uri.split("?", 1)[0]
    cors = _cors(headers, rt.config)
    origin = headers.get("origin")
    if origin and not cors:
        return _json(403, {"error": "origin not allowed"})
    if method == "OPTIONS":
        return 204, cors, ""
    if method == "GET" and path == "/health":
        return _json(200, {"status": "ok", "formatVersion": S.SUPPORTED_FORMAT_VERSION, "project": rt.project_name}, cors)
    if method == "POST" and path == "/reload":
        if "application/json" not in headers.get("content-type", ""):
            return _json(415, {"error": "Content-Type must be application/json"}, cors)
        try:
            text = body.decode("utf-8") if isinstance(body, (bytes, bytearray)) else (body or "")
            data = json.loads(text)
            if not isinstance(data, dict):
                raise ValueError("body must be a JSON object")
            source = str(data.get("source", ""))[:40]
            return _json(200, reload_mod.reload_files(data.get("files"), rt, source), cors)
        except (ValueError, reload_mod.ReloadError) as exc:  # json errors are ValueError subclasses
            return _json(400, {"error": str(exc)}, cors)
        except reload_mod.Busy as exc:
            return _json(409, {"error": str(exc)}, cors)
        except Exception as exc:  # noqa: BLE001
            return _json(500, {"error": str(exc)}, cors)
    return _json(404, {"error": "not found"}, cors)
