"""Local helper: serves the viewer and converts .toe/.tox files on demand (127.0.0.1 only).

    python3 -m difftd serve [folder with your .toe versions]

API (JSON): GET /api/info, GET /api/versions, GET /api/snapshot?file=<relative path>|sha256=<hex>,
POST /api/convert?sha256=<hex>&name=<file name> (raw bytes sent by the page, see
specs/003-import-versions-ui/contracts/helper-api.md). From disk only files below the served folder are
read; uploaded bytes are never stored. The viewer itself stays a static app and still
works without this helper in its "Two files" mode.
"""

import hashlib
import json
import re
import shutil
import tempfile
import threading
import webbrowser
from collections import OrderedDict
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlparse

from . import toe

REPO_ROOT = Path(__file__).resolve().parent.parent
EXTENSIONS = {".toe", ".tox"}
MAX_DEPTH = 2
UPLOAD_LIMIT_BYTES = 200 * 1024 * 1024
CACHE_SIZE = 30
API_VERSION = 3
SHA256_RE = re.compile(r"^[0-9a-f]{64}$")
CONTENT_TYPES = {
    ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
    ".json": "application/json", ".md": "text/plain; charset=utf-8", ".svg": "image/svg+xml",
}


class Library:
    """Converts project files; optionally knows a folder of versions (feature 002).

    Results are cached in memory: by content hash (uploads) and by path+mtime+size (folder files).
    """

    def __init__(self, folder=None, toeexpand=None, upload_limit=UPLOAD_LIMIT_BYTES, cache_size=CACHE_SIZE):
        self.folder = Path(folder).resolve() if folder else None
        self.toeexpand = toeexpand
        self.upload_limit = upload_limit
        self.cache_size = cache_size
        self._cache = OrderedDict()
        self._lock = threading.Lock()
        self._hashes = {}  # (path, mtime_ns, size) -> sha256 of the content

    def _sha256(self, path, st):
        key = (str(path), st.st_mtime_ns, st.st_size)
        if key not in self._hashes:
            digest = hashlib.sha256()
            with open(path, "rb") as handle:
                for chunk in iter(lambda: handle.read(1 << 20), b""):
                    digest.update(chunk)
            self._hashes[key] = digest.hexdigest()
        return self._hashes[key]

    # -- folder mode (feature 002)
    def versions(self):
        if self.folder is None:
            return []
        found = []
        for path in self.folder.rglob("*"):
            rel = path.relative_to(self.folder)
            if (
                path.suffix.lower() in EXTENSIONS
                and path.is_file()
                and len(rel.parts) <= MAX_DEPTH + 1
                and not any(part.startswith(".") for part in rel.parts)
            ):
                st = path.stat()
                found.append({
                    "path": rel.as_posix(),
                    "name": path.name,
                    "size": st.st_size,
                    "sha256": self._sha256(path, st),
                    "mtime": datetime.fromtimestamp(st.st_mtime, timezone.utc).isoformat(timespec="seconds"),
                })
        return sorted(found, key=lambda v: v["mtime"], reverse=True)

    def resolve(self, rel):
        if self.folder is None:
            raise FileNotFoundError("no folder was given when the helper was started; import or add files in the page")
        path = (self.folder / rel).resolve()
        if self.folder != path and self.folder not in path.parents:
            raise PermissionError("file is outside the served folder")
        if path.suffix.lower() not in EXTENSIONS or not path.is_file():
            raise FileNotFoundError(f"{rel} is not a .toe/.tox file in the served folder")
        return path

    # -- cache
    def _get(self, key):
        with self._lock:
            if key in self._cache:
                self._cache.move_to_end(key)
                return self._cache[key]
        return None

    def _put(self, key, roots):
        with self._lock:
            self._cache[key] = roots
            self._cache.move_to_end(key)
            while len(self._cache) > self.cache_size:
                self._cache.popitem(last=False)

    def snapshots(self, rel):
        path = self.resolve(rel)
        key = "file:" + toe.cache_key(path)
        roots = self._get(key)
        if roots is None:
            roots = toe.convert(path, self.toeexpand)
            self._put(key, roots)
        return roots

    # -- content mode (feature 003)
    def cached(self, sha256):
        return self._get("sha:" + sha256)

    def convert_bytes(self, data, name, sha256):
        """Convert uploaded bytes. Nothing is stored beyond the in-memory result."""
        key = "sha:" + sha256
        roots = self._get(key)
        if roots is not None:
            return roots
        safe = re.sub(r"[^A-Za-z0-9._ -]", "_", Path(name).name) or "upload.toe"
        tmp = tempfile.mkdtemp(prefix="difftd-upload-")
        try:
            target = Path(tmp) / safe
            target.write_bytes(data)
            try:
                roots = toe.convert(target, self.toeexpand)
            except toe.ToeError as exc:
                raise toe.ToeError(f"{name}: {exc}") from exc
        finally:
            shutil.rmtree(tmp, ignore_errors=True)
        self._put(key, roots)
        return roots


def make_handler(library, static_root=REPO_ROOT):
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass

        def _send(self, status, body, content_type="application/json"):
            data = body if isinstance(body, bytes) else body.encode("utf-8")
            self.send_response(status)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(data)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(data)

        def _json(self, status, payload):
            self._send(status, json.dumps(payload))

        def _host_ok(self):
            host = (self.headers.get("Host") or "").rsplit(":", 1)[0].strip("[]")
            return host in ("localhost", "127.0.0.1", "::1")

        def _origin_ok(self):
            origin = self.headers.get("Origin")
            return origin is None or origin == f"http://{self.headers.get('Host')}"

        def do_POST(self):  # noqa: N802
            url = urlparse(self.path)
            if not self._host_ok() or not self._origin_ok():
                self.close_connection = True
                return self._json(403, {"error": "request not allowed from this origin"})
            if url.path != "/api/convert":
                self.close_connection = True
                return self._json(404, {"error": "unknown endpoint"})
            if self.headers.get("X-DiffTD") != "1":
                self.close_connection = True
                return self._json(403, {"error": "missing X-DiffTD header"})
            query = parse_qs(url.query)
            sha256 = (query.get("sha256") or [""])[0].lower()
            name = unquote((query.get("name") or [""])[0])
            if not SHA256_RE.match(sha256) or not name:
                self.close_connection = True
                return self._json(400, {"error": "sha256 and name are required"})
            if Path(name).suffix.lower() not in EXTENSIONS:
                self.close_connection = True
                return self._json(415, {"error": f"{name} is not a .toe/.tox file"})
            try:
                length = int(self.headers.get("Content-Length", ""))
            except ValueError:
                self.close_connection = True
                return self._json(400, {"error": "Content-Length is required"})
            if length > library.upload_limit:
                self.close_connection = True
                return self._json(413, {"error": f"{name} is larger than {library.upload_limit // (1024 * 1024)} MB"})
            data = self.rfile.read(length)
            if hashlib.sha256(data).hexdigest() != sha256:
                return self._json(400, {"error": "content does not match sha256"})
            try:
                roots = library.convert_bytes(data, name, sha256)
            except toe.ToeError as exc:
                return self._json(422, {"error": str(exc)})
            except Exception as exc:  # noqa: BLE001
                return self._json(500, {"error": f"unexpected error: {exc}"})
            return self._json(200, {"sha256": sha256, "name": name, "roots": roots})

        def do_GET(self):  # noqa: N802
            if not self._host_ok():
                return self._json(403, {"error": "only localhost is served"})
            url = urlparse(self.path)
            if url.path.startswith("/api/"):
                return self._api(url)
            return self._static(url.path)

        def _api(self, url):
            query = parse_qs(url.query)
            try:
                if url.path == "/api/info":
                    try:
                        expander = toe.find_toeexpand()
                    except toe.ToeError as exc:
                        expander = None
                        problem = str(exc)
                    else:
                        problem = None
                    return self._json(200, {
                        "folder": str(library.folder) if library.folder else None,
                        "toeexpand": expander,
                        "problem": problem,
                        "uploadLimitBytes": library.upload_limit,
                        "version": API_VERSION,
                    })
                if url.path == "/api/versions":
                    return self._json(200, {"folder": str(library.folder) if library.folder else None, "versions": library.versions()})
                if url.path == "/api/snapshot":
                    rel = unquote((query.get("file") or [""])[0])
                    sha = (query.get("sha256") or [""])[0].lower()
                    if bool(rel) == bool(sha):
                        return self._json(400, {"error": "give exactly one of file or sha256"})
                    if sha:
                        roots = library.cached(sha) if SHA256_RE.match(sha) else None
                        if roots is None:
                            return self._json(404, {"error": "not converted yet"})
                        return self._json(200, {"sha256": sha, "roots": roots})
                    return self._json(200, {"file": rel, "roots": library.snapshots(rel)})
                return self._json(404, {"error": "unknown endpoint"})
            except PermissionError as exc:
                return self._json(403, {"error": str(exc)})
            except FileNotFoundError as exc:
                return self._json(404, {"error": str(exc)})
            except toe.ToeError as exc:
                return self._json(500, {"error": str(exc)})
            except Exception as exc:  # noqa: BLE001
                return self._json(500, {"error": f"unexpected error: {exc}"})

        def _static(self, path):
            if path in ("", "/"):
                self.send_response(302)
                self.send_header("Location", "/viewer/")
                self.end_headers()
                return
            if path.endswith("/"):
                path += "index.html"
            target = (static_root / unquote(path.lstrip("/"))).resolve()
            allowed = [static_root / "viewer", static_root / "schema"]
            if not any(a.resolve() in target.parents for a in allowed) or not target.is_file():
                return self._json(404, {"error": "not found"})
            self._send(200, target.read_bytes(), CONTENT_TYPES.get(target.suffix, "application/octet-stream"))

    return Handler


def serve(folder=None, port=8080, open_browser=False, toeexpand=None):
    library = Library(folder, toeexpand)
    try:
        server = ThreadingHTTPServer(("127.0.0.1", port), make_handler(library))
    except OSError as exc:
        raise toe.ToeError(f"cannot listen on port {port} ({exc.strerror}); choose another with --port") from exc
    url = f"http://localhost:{server.server_address[1]}/viewer/?mode=local"
    if library.folder:
        print(f"DiffTD: serving versions from {library.folder}")
    else:
        print("DiffTD: no folder given. Open the page, then import a folder or add files there.")
    print(f"Open {url}\nCtrl+C to stop.")
    if open_browser:
        webbrowser.open(url)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
