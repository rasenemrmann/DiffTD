"""Callbacks for the Web Server DAT inside the DiffTD component (127.0.0.1 only).

GET /health and POST /reload; see specs/001-td-version-control/contracts/reload-endpoint.md.
The request/response dict keys follow the Web Server DAT callback API (VERIFY in TD:
`request['method']`, `['uri']`, `['headers']`, `['data']`; `response['statusCode']`, `['data']`).
"""

from ..api import REASONS, handle_request
from .runtime import build_runtime


def onHTTPRequest(webServerDAT, request, response):
    try:
        rt = build_runtime()
        status, headers, body = handle_request(
            request.get("method", "GET"),
            request.get("uri", "/"),
            request.get("headers", {}),
            request.get("data", ""),
            rt,
        )
    except Exception as exc:  # noqa: BLE001
        status, headers, body = 500, {"Content-Type": "application/json"}, f'{{"error": "{exc}"}}'
    response["statusCode"] = status
    response["statusReason"] = REASONS.get(status, "")
    for key, value in headers.items():
        response[key] = value
    response["data"] = body
    return response


def onWebSocketOpen(webServerDAT, client, uri):
    return


def onWebSocketClose(webServerDAT, client):
    return


def onWebSocketReceiveText(webServerDAT, client, data):
    return


def onWebSocketReceiveBinary(webServerDAT, client, data):
    return


def onServerStart(webServerDAT):
    return


def onServerStop(webServerDAT):
    return
