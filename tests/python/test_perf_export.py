import time

import fake_td
from difftd import exporter, snapshot as S


def test_500_node_export_and_write_under_two_seconds(tmp_path):
    registry = {"baseCOMP": {"w": 1}, "constantCHOP": {"value0": 0.0, "name0": "chan1", "const0": 1}, "mathCHOP": {"gain": 1.0}}
    project = fake_td.make_project(registry)
    root = fake_td.Op(project, "net1", "baseCOMP", {"w": 1})
    root.registry = registry
    project.children.append(root)
    prev = None
    for i in range(500):
        op = root.create("constantCHOP" if i % 2 else "mathCHOP", f"n{i:03d}")
        for p in op.pars():
            p.val = p.val if not isinstance(p.val, float) else p.val + i * 0.1
        if prev is not None:
            op.inputConnectors[0].connect(prev.outputConnectors[0])
        prev = op
    cfg = {"snapshotDir": "snapshots", "exclude": []}
    start = time.perf_counter()
    results = exporter.export_project(project, "project1", tmp_path, cfg)
    elapsed = time.perf_counter() - start
    assert results[0]["status"] == "written"
    assert elapsed < 2.0, f"export took {elapsed:.2f}s"
    text = (tmp_path / "snapshots/project1/net1.json").read_text()
    assert len(S.parse(text)["nodes"]) == 501
