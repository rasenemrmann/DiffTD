"""Whole loop without TouchDesigner: export -> git commit -> checkout (real hooks, real HTTP) -> reload."""

import json
import subprocess
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from types import SimpleNamespace

import fake_td
from difftd import api, exporter
from difftd.config import DEFAULTS

ROOT = Path(__file__).resolve().parents[2]
FIX = ROOT / "tests" / "fixtures"
NAMES = ["simple", "nested", "dat", "empty", "before", "after"]
PORT = 18981


def run(cwd, *args, check=True):
    return subprocess.run(
        ["git", "-c", "user.name=T", "-c", "user.email=t@example.com", "-c", "commit.gpgsign=false", *args],
        cwd=cwd, check=check, capture_output=True, text=True,
    )


def serve(rt):
    class Handler(BaseHTTPRequestHandler):
        def _go(self):
            length = int(self.headers.get("Content-Length", 0))
            body = self.rfile.read(length).decode() if length else ""
            status, headers, text = api.handle_request(self.command, self.path, dict(self.headers), body, rt)
            data = text.encode()
            self.send_response(status)
            for k, v in headers.items():
                self.send_header(k, v)
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        do_GET = do_POST = do_OPTIONS = _go

        def log_message(self, *a):
            pass

    server = HTTPServer(("127.0.0.1", PORT), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server


def test_checkout_reloads_the_live_network_and_backs_up_unsaved_edits(tmp_path):
    registry = fake_td.types_from_snapshots([json.loads((FIX / f"{n}.json").read_text()) for n in NAMES])
    project = fake_td.make_project(registry)
    fake_td.build_network(project, json.loads((FIX / "before.json").read_text()))
    config = dict(DEFAULTS, reloadPort=PORT)
    rt = SimpleNamespace(repo_root=tmp_path, config=config, project_comp=project, project_name="project1",
                         api=fake_td.FakeAPI(registry))

    run(tmp_path, "init", "-q", "-b", "main")
    (tmp_path / "difftd.config.json").write_text(json.dumps({"reloadPort": PORT}))
    # "save" in TD -> snapshots on disk -> commit as the old state
    exporter.export_project(project, "project1", tmp_path, config)
    subprocess.run(["sh", str(ROOT / "hooks" / "install.sh"), str(tmp_path)], check=True, capture_output=True)
    run(tmp_path, "add", "-A")
    run(tmp_path, "commit", "-q", "-m", "old state")

    # a teammate's newer state on another branch
    run(tmp_path, "checkout", "-q", "-b", "newer")
    (tmp_path / "snapshots/project1/net1.json").write_text((FIX / "after.json").read_text())
    run(tmp_path, "commit", "-qam", "newer state")
    run(tmp_path, "checkout", "-q", "main")  # no server yet -> must not fail

    server = serve(rt)
    try:
        # unsaved edit in the live project, then switch branches
        project.op("net1").op("wave1")._pars["amp"].val = 9
        edited = exporter.snapshot_text(project.op("net1"), "project1")
        result = run(tmp_path, "checkout", "newer")
        assert result.returncode == 0
        assert exporter.snapshot_text(project.op("net1"), "project1") == (FIX / "after.json").read_text()
        backups = list((tmp_path / ".difftd" / "backups").glob("*/net1.json"))
        assert len(backups) == 1 and backups[0].read_text() == edited
        assert "backed up" in result.stderr

        # and back again: nothing unsaved now, no new backup
        run(tmp_path, "checkout", "main")
        assert exporter.snapshot_text(project.op("net1"), "project1") == (FIX / "before.json").read_text()
        assert len(list((tmp_path / ".difftd" / "backups").glob("*/net1.json"))) == 1
    finally:
        server.shutdown()
