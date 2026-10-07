import json
import os
from pathlib import Path

import fake_td
from difftd import exporter
from difftd.store import Store

FIX = Path(__file__).resolve().parents[1] / "fixtures"
CFG = {"snapshotDir": "snapshots", "exclude": ["DiffTD"]}


def load(name):
    return json.loads((FIX / f"{name}.json").read_text(encoding="utf-8"))


def project_with(*names):
    reg = fake_td.types_from_snapshots([load(n) for n in ("simple", "dat", "nested")])
    project = fake_td.make_project(reg)
    for n in names:
        fake_td.build_network(project, load(n))
    return project


def test_unchanged_content_is_not_rewritten(tmp_path):
    project = project_with("simple")
    first = exporter.export_project(project, "project1", tmp_path, CFG)
    target = tmp_path / "snapshots/project1/net1.json"
    inode = target.stat().st_ino
    second = exporter.export_project(project, "project1", tmp_path, CFG)
    assert first[0]["status"] == "written" and second[0]["status"] == "unchanged"
    assert target.stat().st_ino == inode


def test_failed_write_keeps_old_file_and_leaves_no_temp(tmp_path, monkeypatch):
    project = project_with("simple")
    exporter.export_project(project, "project1", tmp_path, CFG)
    target = tmp_path / "snapshots/project1/net1.json"
    old = target.read_text()
    project.children[0].op("wave1")._pars["freq"].val = 99

    def boom(*a, **k):
        raise OSError("disk full")

    monkeypatch.setattr(os, "replace", boom)
    results = exporter.export_project(project, "project1", tmp_path, CFG)
    assert results[0]["status"] == "error" and "disk full" in results[0]["error"]
    assert target.read_text() == old
    assert [p.name for p in target.parent.iterdir()] == ["net1.json"]
    assert "disk full" in (tmp_path / ".difftd/log.txt").read_text()


def test_hash_updated_only_on_success(tmp_path, monkeypatch):
    project = project_with("simple")
    exporter.export_project(project, "project1", tmp_path, CFG)
    store = Store(tmp_path)
    good = store.get_hash("/project1/net1")
    assert good
    project.children[0].op("wave1")._pars["freq"].val = 99
    monkeypatch.setattr(os, "replace", lambda *a, **k: (_ for _ in ()).throw(OSError("x")))
    exporter.export_project(project, "project1", tmp_path, CFG)
    assert store.get_hash("/project1/net1") == good


def test_one_failing_root_does_not_block_the_others(tmp_path, monkeypatch):
    project = project_with("simple", "dat")
    real = exporter.snapshot_text

    def flaky(root, name):
        if root.name == "net1" and len(root.children) == 3:
            raise RuntimeError("cannot read")
        return real(root, name)

    # both roots are called net1; make failure depend on first call instead
    calls = {"n": 0}

    def flaky2(root, name):
        calls["n"] += 1
        if calls["n"] == 1:
            raise RuntimeError("cannot read")
        return real(root, name)

    monkeypatch.setattr(exporter, "snapshot_text", flaky2)
    results = exporter.export_project(project, "project1", tmp_path, CFG)
    assert [r["status"] for r in results] == ["error", "written"]


def test_listing_failure_returns_error_not_exception(tmp_path):
    class Broken:
        path = "/project1"

        @property
        def children(self):
            raise RuntimeError("boom")

    results = exporter.export_project(Broken(), "project1", tmp_path, CFG)
    assert results[0]["status"] == "error"


def test_read_only_target_dir_reports_error(tmp_path):
    project = project_with("simple")
    snap_dir = tmp_path / "snapshots"
    snap_dir.mkdir()
    snap_dir.chmod(0o500)
    try:
        results = exporter.export_project(project, "project1", tmp_path, CFG)
    finally:
        snap_dir.chmod(0o700)
    if os.geteuid() != 0:
        assert results[0]["status"] == "error"
