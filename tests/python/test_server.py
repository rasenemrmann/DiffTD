import json
import os
import stat
import threading
import urllib.error
import urllib.request
from http.server import ThreadingHTTPServer

import pytest

import toe_helpers as H
from difftd import cli, server


@pytest.fixture
def served(tmp_path):
    """A folder with three 'project versions' served by the real handler, with a fake toeexpand."""
    prepared = {v: H.build_project(tmp_path / f"prep-{v}", v) for v in "ab"}
    fake = tmp_path / "toeexpand"
    fake.write_text(
        '#!/bin/sh\n'
        # pick the prepared variant from the file content (first byte 'a' or 'b')
        'v=$(head -c 1 "$1")\n'
        f'cp -R "{tmp_path}/prep-$v" "$1.dir"\n'
    )
    fake.chmod(fake.stat().st_mode | stat.S_IEXEC)
    folder = tmp_path / "versions"
    (folder / "sub").mkdir(parents=True)
    (folder / "Proj_v1.toe").write_bytes(b"a-first")
    (folder / "Proj_v2.toe").write_bytes(b"b-second")
    (folder / "sub" / "Old.tox").write_bytes(b"a-old")
    (folder / "notes.txt").write_text("not a project")
    (folder / ".hidden.toe").write_bytes(b"a")
    os.utime(folder / "Proj_v1.toe", (1_700_000_000, 1_700_000_000))
    os.utime(folder / "Proj_v2.toe", (1_700_100_000, 1_700_100_000))
    os.utime(folder / "sub" / "Old.tox", (1_600_000_000, 1_600_000_000))
    library = server.Library(folder, str(fake))
    httpd = ThreadingHTTPServer(("127.0.0.1", 0), server.make_handler(library))
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    yield library, f"http://127.0.0.1:{httpd.server_address[1]}"
    httpd.shutdown()
    httpd.server_close()


def get(base, path, headers=None):
    req = urllib.request.Request(base + path, headers=headers or {})
    try:
        with urllib.request.urlopen(req) as res:
            return res.status, res.read(), dict(res.headers)
    except urllib.error.HTTPError as err:
        return err.code, err.read(), dict(err.headers)


def test_versions_lists_project_files_newest_first_and_skips_others(served):
    library, base = served
    status, body, _ = get(base, "/api/versions")
    names = [v["path"] for v in json.loads(body)["versions"]]
    assert status == 200
    assert names == ["Proj_v2.toe", "Proj_v1.toe", "sub/Old.tox"]
    assert "notes.txt" not in names and ".hidden.toe" not in names


def test_snapshot_converts_and_differs_between_versions(served):
    _, base = served
    one = json.loads(get(base, "/api/snapshot?file=Proj_v1.toe")[1])
    two = json.loads(get(base, "/api/snapshot?file=Proj_v2.toe")[1])
    assert set(one["roots"]) == {"project1"}
    paths1 = {n["path"] for n in one["roots"]["project1"]["nodes"]}
    paths2 = {n["path"] for n in two["roots"]["project1"]["nodes"]}
    assert paths2 - paths1 == {"/project1/noise1"}


def test_conversion_is_cached_per_file_version(served, monkeypatch):
    library, base = served
    calls = []
    real = server.toe.convert
    monkeypatch.setattr(server.toe, "convert", lambda *a, **k: (calls.append(a[0]), real(*a, **k))[1])
    get(base, "/api/snapshot?file=Proj_v1.toe")
    get(base, "/api/snapshot?file=Proj_v1.toe")
    assert len(calls) == 1
    (library.folder / "Proj_v1.toe").write_bytes(b"a-changed-size")
    get(base, "/api/snapshot?file=Proj_v1.toe")
    assert len(calls) == 2


@pytest.mark.parametrize("bad", ["../../etc/passwd", "/etc/passwd", "notes.txt", "missing.toe", "%2e%2e/x.toe", ""])
def test_files_outside_or_wrong_type_are_refused(served, bad):
    _, base = served
    status, body, _ = get(base, f"/api/snapshot?file={bad}")
    assert status in (400, 403, 404) and "error" in json.loads(body)


def test_foreign_host_header_is_refused(served):
    _, base = served
    assert get(base, "/api/versions", {"Host": "evil.example"})[0] == 403


def test_info_reports_toeexpand_problem(served, monkeypatch):
    _, base = served
    monkeypatch.setattr(server.toe, "find_toeexpand", lambda: (_ for _ in ()).throw(server.toe.ToeError("not installed")))
    info = json.loads(get(base, "/api/info")[1])
    assert info["toeexpand"] is None and info["problem"] == "not installed"


def test_static_files_only_from_viewer_and_schema(served):
    _, base = served
    assert get(base, "/viewer/index.html")[0] == 200
    assert get(base, "/schema/snapshot.schema.json")[0] == 200
    assert get(base, "/difftd/snapshot.py")[0] == 404
    assert get(base, "/viewer/../difftd/snapshot.py")[0] in (403, 404)
    assert get(base, "/viewer/%2e%2e/pyproject.toml")[0] in (403, 404)


def test_cli_convert_writes_snapshot(tmp_path, served, capsys):
    library, _ = served
    out = tmp_path / "out.json"
    cli.main(["--toeexpand", library.toeexpand, "convert", str(library.folder / "Proj_v2.toe"), "-o", str(out)])
    data = json.loads(out.read_text())
    assert data["meta"]["root"] == "/project1" and len(data["nodes"]) > 5


def test_cli_convert_unknown_root_exits(tmp_path, served):
    library, _ = served
    with pytest.raises(SystemExit) as err:
        cli.main(["--toeexpand", library.toeexpand, "convert", str(library.folder / "Proj_v1.toe"), "--root", "nope"])
    assert "no top-level node" in str(err.value)


def test_serve_reports_port_in_use():
    import socket

    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        s.listen()
        with pytest.raises(server.toe.ToeError, match="--port"):
            server.serve(".", port=s.getsockname()[1])


def test_versions_carry_the_content_hash_and_cache_it(served, monkeypatch):
    import hashlib

    library, base = served
    versions = {v["path"]: v for v in json.loads(get(base, "/api/versions")[1])["versions"]}
    assert versions["Proj_v1.toe"]["sha256"] == hashlib.sha256(b"a-first").hexdigest()
    reads = []
    real_open = open
    monkeypatch.setattr("builtins.open", lambda *a, **k: (reads.append(a[0]), real_open(*a, **k))[1])
    get(base, "/api/versions")
    assert not [r for r in reads if str(r).endswith(".toe")], "unchanged files are not hashed again"
