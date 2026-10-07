import json
import logging

from difftd.config import DEFAULTS, load_config


def write(tmp_path, content):
    (tmp_path / "difftd.config.json").write_text(content if isinstance(content, str) else json.dumps(content))


def test_missing_file_gives_defaults(tmp_path):
    assert load_config(tmp_path) == DEFAULTS


def test_partial_file_overrides_only_given_keys(tmp_path):
    write(tmp_path, {"reloadPort": 12345})
    cfg = load_config(tmp_path)
    assert cfg["reloadPort"] == 12345
    assert cfg["snapshotDir"] == "snapshots"


def test_unknown_key_ignored_with_warning(tmp_path, caplog):
    write(tmp_path, {"bogus": 1})
    with caplog.at_level(logging.WARNING, logger="difftd"):
        cfg = load_config(tmp_path)
    assert "bogus" not in cfg
    assert "unknown config key" in caplog.text


def test_invalid_values_fall_back(tmp_path, caplog):
    write(tmp_path, {"reloadPort": "80", "snapshotDir": "../x", "exportOnSave": "yes"})
    with caplog.at_level(logging.WARNING, logger="difftd"):
        cfg = load_config(tmp_path)
    assert cfg["reloadPort"] == DEFAULTS["reloadPort"]
    assert cfg["snapshotDir"] == "snapshots"
    assert cfg["exportOnSave"] is True


def test_port_out_of_range_and_bool_port(tmp_path):
    write(tmp_path, {"reloadPort": 70000})
    assert load_config(tmp_path)["reloadPort"] == DEFAULTS["reloadPort"]
    write(tmp_path, {"reloadPort": True})
    assert load_config(tmp_path)["reloadPort"] == DEFAULTS["reloadPort"]


def test_broken_json_gives_defaults(tmp_path):
    write(tmp_path, "{ nope")
    assert load_config(tmp_path) == DEFAULTS


def test_defaults_not_mutated(tmp_path):
    cfg = load_config(tmp_path)
    cfg["allowedOrigins"].append("x")
    assert "x" not in DEFAULTS["allowedOrigins"]
