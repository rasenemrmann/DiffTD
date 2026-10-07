import hashlib
import json
import os
import stat
import threading
import urllib.error
import urllib.parse
import urllib.request
from http.server import ThreadingHTTPServer
from pathlib import Path

import pytest

import toe_helpers as H
from difftd import server


def sha(data):
    return hashlib.sha256(data).hexdigest()


@pytest.fixture
def helper(tmp_path):
    """Helper started WITHOUT a folder, with a fake toeexpand (first byte 'a'/'b' selects the project variant)."""
    for v in "ab":
        H.build_project(tmp_path / f"prep-{v}", v)
    fake = tmp_path / "toeexpand"
    fake.write_text(
        '#!/bin/sh\n'
        'if grep -q BROKEN "$1"; then echo "Error in file. Possibly corrupt." >&2; exit 1; fi\n'
        'v=$(head -c 1 "$1")\n'
        f'cp -R "{tmp_path}/prep-$v" "$1.dir"\n'
    )
    fake.chmod(fake.stat().st_mode | stat.S_IEXEC)
    library = server.Library(None, str(fake), upload_limit=1000, cache_size=3)
    httpd = ThreadingHTTPServer(("127.0.0.1", 0), server.make_handler(library))
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    yield library, f"http://127.0.0.1:{httpd.server_address[1]}"
    httpd.shutdown()
    httpd.server_close()


def post(base, data, name="Proj.toe", digest=None, headers=None, query_extra=""):
    q = f"sha256={digest or sha(data)}&name={urllib.parse.quote(name)}{query_extra}"
    hdrs = {"X-DiffTD": "1", "Content-Type": "application/octet-stream"}
    hdrs.update(headers or {})
    hdrs = {k: v for k, v in hdrs.items() if v is not None}
    req = urllib.request.Request(f"{base}/api/convert?{q}", data=data, headers=hdrs, method="POST")
    try:
        with urllib.request.urlopen(req) as res:
            return res.status, json.loads(res.read())
    except urllib.error.HTTPError as err:
        return err.code, json.loads(err.read() or b"{}")


def get(base, path, headers=None):
    req = urllib.request.Request(base + path, headers=headers or {})
    try:
        with urllib.request.urlopen(req) as res:
            return res.status, json.loads(res.read())
    except urllib.error.HTTPError as err:
        return err.code, json.loads(err.read() or b"{}")


def temp_dirs():
    import tempfile

    return list(Path(tempfile.gettempdir()).glob("difftd-*"))


def test_info_without_folder(helper):
    _, base = helper
    status, info = get(base, "/api/info")
    assert status == 200 and info["folder"] is None and info["uploadLimitBytes"] == 1000 and info["version"] == 3
    assert get(base, "/api/versions")[1] == {"folder": None, "versions": []}


def test_file_mode_refused_without_folder(helper):
    _, base = helper
    status, body = get(base, "/api/snapshot?file=x.toe")
    assert status == 404 and "import or add files" in body["error"]


def test_upload_converts_and_returns_networks(helper):
    _, base = helper
    status, body = post(base, b"a-first")
    assert status == 200 and body["sha256"] == sha(b"a-first")
    assert list(body["roots"]) == ["project1"]
    assert any(n["path"] == "/project1/wave1" for n in body["roots"]["project1"]["nodes"])


def test_cached_lookup_by_hash_and_repeat_post_does_not_convert_again(helper, monkeypatch):
    _, base = helper
    assert get(base, f"/api/snapshot?sha256={sha(b'a-x')}")[0] == 404
    calls = []
    real = server.toe.convert
    monkeypatch.setattr(server.toe, "convert", lambda *a, **k: (calls.append(1), real(*a, **k))[1])
    post(base, b"a-x")
    post(base, b"a-x")
    assert len(calls) == 1
    status, body = get(base, f"/api/snapshot?sha256={sha(b'a-x')}")
    assert status == 200 and "project1" in body["roots"]


def test_two_variants_give_different_networks(helper):
    _, base = helper
    a = post(base, b"a-1")[1]["roots"]["project1"]
    b = post(base, b"b-2")[1]["roots"]["project1"]
    assert {n["path"] for n in b["nodes"]} - {n["path"] for n in a["nodes"]} == {"/project1/noise1"}


def test_hash_mismatch_is_rejected(helper):
    _, base = helper
    status, body = post(base, b"a-first", digest="0" * 64)
    assert status == 400 and "sha256" in body["error"]


@pytest.mark.parametrize("name,expected", [("notes.txt", 415), ("x", 415), ("", 400)])
def test_wrong_name_or_extension(helper, name, expected):
    _, base = helper
    assert post(base, b"a-first", name=name)[0] == expected


def test_uppercase_extension_is_fine(helper):
    _, base = helper
    assert post(base, b"a-first", name="PROJECT.TOE")[0] == 200


def test_missing_header_and_foreign_origin_and_foreign_host(helper):
    _, base = helper
    assert post(base, b"a-first", headers={"X-DiffTD": None})[0] == 403
    assert post(base, b"a-first", headers={"Origin": "http://evil.example"})[0] == 403
    port = base.rsplit(":", 1)[1]
    assert post(base, b"a-first", headers={"Origin": f"http://127.0.0.1:{port}"})[0] == 200
    assert post(base, b"a-first", headers={"Host": "evil.example"})[0] == 403


def test_oversize_is_rejected_before_reading_the_body(helper):
    _, base = helper
    big = b"a" + b"x" * 2000  # limit is 1000 in this fixture
    status, body = post(base, big)
    assert status == 413 and "larger than" in body["error"]


def test_damaged_file_gives_422_with_file_name_and_other_files_still_work(helper):
    _, base = helper
    status, body = post(base, b"a-BROKEN", name="bad.toe")
    assert status == 422 and "bad.toe" in body["error"]
    assert post(base, b"a-good")[0] == 200


def test_no_temp_directories_left_after_success_or_failure(helper):
    _, base = helper
    before = set(temp_dirs())
    post(base, b"a-ok")
    post(base, b"a-BROKEN", name="bad.toe")
    assert set(temp_dirs()) - before == set()


def test_cache_is_bounded(helper):
    library, base = helper
    for i in range(5):
        post(base, b"a-%d" % i)
    assert len(library._cache) == 3
    assert get(base, f"/api/snapshot?sha256={sha(b'a-0')}")[0] == 404  # evicted
    assert get(base, f"/api/snapshot?sha256={sha(b'a-4')}")[0] == 200


def test_file_and_sha_are_mutually_exclusive(helper):
    _, base = helper
    assert get(base, f"/api/snapshot?file=x.toe&sha256={'0' * 64}")[0] == 400
    assert get(base, "/api/snapshot")[0] == 400


def test_post_to_other_endpoint_is_refused(helper):
    _, base = helper
    req = urllib.request.Request(f"{base}/api/info", data=b"x", headers={"X-DiffTD": "1"}, method="POST")
    with pytest.raises(urllib.error.HTTPError) as err:
        urllib.request.urlopen(req)
    assert err.value.code == 404


def test_uploaded_bytes_are_not_logged_or_stored(helper, tmp_path):
    library, base = helper
    post(base, b"a-secret-content-123")
    for path in tmp_path.rglob("*"):
        if path.is_file() and "prep-" not in str(path) and path.name != "toeexpand":
            assert b"secret-content-123" not in path.read_bytes()
