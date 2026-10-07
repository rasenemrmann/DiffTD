import json
from pathlib import Path

import pytest

import fake_td
from difftd import exporter, importer

FIX = Path(__file__).resolve().parents[1] / "fixtures"
NAMES = ["simple", "nested", "dat", "empty", "before", "after"]


def load(name):
    return json.loads((FIX / f"{name}.json").read_text(encoding="utf-8"))


@pytest.mark.parametrize("name", NAMES)
def test_export_import_export_is_identical(name):
    registry = fake_td.types_from_snapshots([load(n) for n in NAMES])
    source = fake_td.make_project(registry)
    fake_td.build_network(source, load(name))
    first = exporter.snapshot_text(source.children[0], "project1")

    target = fake_td.make_project(registry)
    importer.import_root(target, json.loads(first), fake_td.FakeAPI(registry))
    second = exporter.snapshot_text(target.children[0], "project1")
    assert second == first
    assert first == (FIX / f"{name}.json").read_text(encoding="utf-8")
