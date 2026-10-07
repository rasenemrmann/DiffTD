import json
import threading
from pathlib import Path
from types import SimpleNamespace

import pytest

import fake_td
from difftd import api, exporter, reload as R
from difftd.config import DEFAULTS
from difftd.store import Store

FIX = Path(__file__).resolve().parents[1] / "fixtures"
NAMES = ["simple", "nested", "dat", "empty", "before", "after"]
REL = "snapshots/project1/net1.json"


def load_text(name):
    return (FIX / f"{name}.json").read_text(encoding="utf-8")


def setup(tmp_path, start="before"):
    registry = fake_td.types_from_snapshots([json.loads(load_text(n)) for n in NAMES])
    project = fake_td.make_project(registry)
    fake_td.build_network(project, json.loads(load_text(start)))
    config = dict(DEFAULTS)
    rt = SimpleNamespace(
        repo_root=tmp_path, config=config, project_comp=project, project_name="project1",
        api=fake_td.FakeAPI(registry),
    )
    exporter.export_project(project, "project1", tmp_path, config)
    return rt


def checkout(tmp_path, name):
    (tmp_path / REL).write_text(load_text(name), encoding="utf-8")


def live_text(rt):
    return exporter.snapshot_text(rt.project_comp.op("net1"), "project1")


def test_reload_rebuilds_container_from_new_snapshot(tmp_path):
    rt = setup(tmp_path)
    checkout(tmp_path, "after")
    result = R.reload_files([REL], rt, "post-checkout")
    assert result["reloaded"] == ["/project1/net1"] and result["errors"] == [] and result["backups"] == []
    assert live_text(rt) == load_text("after")


def test_already_in_sync_is_not_rebuilt(tmp_path):
    rt = setup(tmp_path)
    result = R.reload_files([REL], rt)
    assert result["unchanged"] == ["/project1/net1"] and result["reloaded"] == []


def test_unsaved_edits_are_backed_up_before_rebuild(tmp_path):
    rt = setup(tmp_path)
    rt.project_comp.op("net1").op("wave1")._pars["freq"].val = 77  # unsaved edit
    edited = live_text(rt)
    checkout(tmp_path, "after")
    result = R.reload_files([REL], rt)
    assert len(result["backups"]) == 1
    backup = tmp_path / result["backups"][0]["file"]
    assert backup.read_text(encoding="utf-8") == edited
    assert ".difftd/backups/" in result["backups"][0]["file"]
    assert live_text(rt) == load_text("after")


def test_backup_is_written_before_the_network_is_cleared(tmp_path, monkeypatch):
    rt = setup(tmp_path)
    rt.project_comp.op("net1").op("wave1")._pars["freq"].val = 77
    checkout(tmp_path, "after")
    order = []
    orig_backup = Store.backup
    monkeypatch.setattr(Store, "backup", lambda self, *a, **k: (order.append("backup"), orig_backup(self, *a, **k))[1])
    orig_destroy = fake_td.Op.destroy
    monkeypatch.setattr(fake_td.Op, "destroy", lambda self: (order.append("destroy"), orig_destroy(self))[1])
    R.reload_files([REL], rt)
    assert order[0] == "backup" and "destroy" in order


def test_never_exported_container_is_treated_as_unsaved(tmp_path):
    rt = setup(tmp_path)
    (tmp_path / ".difftd" / "last-export.json").unlink()
    checkout(tmp_path, "after")
    assert len(R.reload_files([REL], rt)["backups"]) == 1


def test_second_reload_after_reload_makes_no_backup(tmp_path):
    rt = setup(tmp_path)
    checkout(tmp_path, "after")
    R.reload_files([REL], rt)
    checkout(tmp_path, "before")
    assert R.reload_files([REL], rt)["backups"] == []
    assert live_text(rt) == load_text("before")


def test_unknown_type_reported_but_reload_succeeds(tmp_path):
    rt = setup(tmp_path)
    snap = json.loads(load_text("after"))
    next(n for n in snap["nodes"] if n["name"] == "noise1")["type"] = "fooCHOP"
    from difftd import snapshot as S
    (tmp_path / REL).write_text(S.serialize(snap), encoding="utf-8")
    result = R.reload_files([REL], rt)
    assert result["reloaded"] and result["skippedNodes"][0]["path"].endswith("noise1")


def test_invalid_file_is_an_error_but_other_files_still_reload(tmp_path):
    rt = setup(tmp_path)
    other = fake_td.Op(rt.project_comp, "bad", "baseCOMP", {})
    rt.project_comp.children.append(other)
    (tmp_path / "snapshots/project1/bad.json").write_text("{ nope", encoding="utf-8")
    checkout(tmp_path, "after")
    result = R.reload_files(["snapshots/project1/bad.json", REL], rt)
    assert result["errors"][0]["file"].endswith("bad.json")
    assert result["reloaded"] == ["/project1/net1"]


def test_future_version_is_reported(tmp_path):
    rt = setup(tmp_path)
    (tmp_path / REL).write_text(load_text("future-version"), encoding="utf-8")
    assert "newer than supported" in R.reload_files([REL], rt)["errors"][0]["message"]


def test_snapshot_root_mismatch_is_reported(tmp_path):
    rt = setup(tmp_path)
    (tmp_path / "snapshots/project1/renamed.json").write_text(load_text("after"), encoding="utf-8")
    result = R.reload_files(["snapshots/project1/renamed.json"], rt)
    assert "does not match" in result["errors"][0]["message"]


def test_deleted_snapshot_removes_container_after_backup_when_unsaved(tmp_path):
    rt = setup(tmp_path)
    rt.project_comp.op("net1").op("wave1")._pars["freq"].val = 5
    (tmp_path / REL).unlink()
    result = R.reload_files([REL], rt)
    assert result["removed"] == ["/project1/net1"] and len(result["backups"]) == 1
    assert rt.project_comp.op("net1") is None


def test_deleted_snapshot_for_missing_container_is_a_noop(tmp_path):
    rt = setup(tmp_path)
    assert R.reload_files(["snapshots/project1/ghost.json"], rt)["removed"] == []


@pytest.mark.parametrize(
    "bad",
    ["/etc/passwd", "../x.json", "snapshots/../x.json", "other/project1/net1.json", "snapshots/net1.json",
     "snapshots/project1/net1.txt", "snapshots/project1/sub/net1.json", "snapshots\\project1\\net1.json", "", "./snapshots/project1/net1.json"],
)
def test_illegal_paths_rejected(tmp_path, bad):
    rt = setup(tmp_path)
    with pytest.raises(R.ReloadError):
        R.reload_files([bad], rt)


def test_files_must_be_a_list_of_strings(tmp_path):
    rt = setup(tmp_path)
    for bad in (None, "x", [1], {"a": 1}):
        with pytest.raises(R.ReloadError):
            R.reload_files(bad, rt)


def test_concurrent_request_is_busy(tmp_path):
    rt = setup(tmp_path)
    assert R._lock.acquire(blocking=False)
    try:
        with pytest.raises(R.Busy):
            R.reload_files([REL], rt)
    finally:
        R._lock.release()


# ---- HTTP layer

def call(rt, method, uri, body="", headers=None):
    status, hdrs, text = api.handle_request(method, uri, headers or {}, body, rt)
    return status, hdrs, (json.loads(text) if text else None)


def test_health(tmp_path):
    rt = setup(tmp_path)
    status, _, body = call(rt, "GET", "/health")
    assert status == 200 and body == {"status": "ok", "formatVersion": 1, "project": "project1"}


def test_reload_over_http_roundtrip(tmp_path):
    rt = setup(tmp_path)
    checkout(tmp_path, "after")
    payload = json.dumps({"files": [REL], "source": "post-merge"})
    status, _, body = call(rt, "POST", "/reload", payload, {"Content-Type": "application/json"})
    assert status == 200 and body["reloaded"] == ["/project1/net1"]


def test_reload_http_errors(tmp_path):
    rt = setup(tmp_path)
    ct = {"Content-Type": "application/json"}
    assert call(rt, "POST", "/reload", "{ nope", ct)[0] == 400
    assert call(rt, "POST", "/reload", json.dumps({"files": ["/etc/passwd"]}), ct)[0] == 400
    assert call(rt, "POST", "/reload", json.dumps({"files": [REL]}), {"Content-Type": "text/plain"})[0] == 415
    assert call(rt, "GET", "/nope")[0] == 404
    assert R._lock.acquire(blocking=False)
    try:
        assert call(rt, "POST", "/reload", json.dumps({"files": [REL]}), ct)[0] == 409
    finally:
        R._lock.release()


def test_cors_allows_only_configured_origins(tmp_path):
    rt = setup(tmp_path)
    ok = call(rt, "GET", "/health", headers={"Origin": "http://localhost:8080"})
    assert ok[0] == 200 and ok[1]["Access-Control-Allow-Origin"] == "http://localhost:8080"
    pre = call(rt, "OPTIONS", "/reload", headers={"Origin": "http://localhost:8080"})
    assert pre[0] == 204 and "POST" in pre[1]["Access-Control-Allow-Methods"]
    bad = call(rt, "POST", "/reload", json.dumps({"files": []}), {"Origin": "http://evil.example", "Content-Type": "application/json"})
    assert bad[0] == 403 and "Access-Control-Allow-Origin" not in bad[1]


def test_no_origin_header_is_allowed_for_hooks(tmp_path):
    rt = setup(tmp_path)
    assert call(rt, "POST", "/reload", json.dumps({"files": []}), {"content-type": "application/json"})[0] == 200
