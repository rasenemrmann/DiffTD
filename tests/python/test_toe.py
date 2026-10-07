import json
import stat
import sys

import pytest

import toe_helpers as H
from difftd import snapshot as S
from difftd import toe


def parse(tmp_path, variant="a"):
    return toe.parse_expanded(H.build_project(tmp_path / variant, variant), "demo")


def node(snap, path):
    return next(n for n in snap["nodes"] if n["path"] == path)


# ---- small readers

def test_tokenize_handles_quotes_and_escapes():
    toks = toe.tokenize('name 67108864 "two words" "a \\"q\\" b" plain')
    assert [t[1] for t in toks] == ["name", "67108864", "two words", 'a "q" b', "plain"]
    assert toks[2][0] == "q" and toks[4][0] == "b"


def test_parm_values_expressions_and_types():
    p = toe.parse_parm(
        '?\nfreq 67108864 1\nratio 67108864 0.25\nname 67108864 hello\nlabel 67108864 "two words"\n'
        'empty 67108864 ""\nidx 201326608 396 me.time.frame\nexpr2 201326641 0 "1 - me.par.x.eval()"\n?\n'
    )
    assert p["freq"] == 1 and isinstance(p["freq"], int)
    assert p["ratio"] == 0.25
    assert p["name"] == "hello" and p["label"] == "two words" and p["empty"] == ""
    # expressions: only the expression text is kept, not the last evaluated value (396)
    assert p["idx"] == {"expr": "me.time.frame"}
    assert p["expr2"] == {"expr": "1 - me.par.x.eval()"}


def test_node_header_type_layout_inputs_and_extras():
    info = toe.parse_node_header(
        "TOP:displace\ntile 260 200 130 72\nflags =  picked on current on viewer 1 bypass on parlanguage 0\n"
        "inputs\n{\n0 \t moviefilein1\n1 chopto1\n}\ncolor 0.1 0.2 0.3 \ndock ramp\nend\n"
    )
    assert info["type"] == "displaceTOP"
    assert info["layout"] == {"x": 260, "y": 200, "w": 130, "h": 72}
    assert info["inputs"] == [(0, "moviefilein1"), (1, "chopto1")]
    assert info["extras"] == {"$flag.bypass": "on", "$color": "0.1 0.2 0.3", "$dock": "ramp"}


def test_editor_state_flags_are_ignored():
    info = toe.parse_node_header("COMP:base\nflags =  picked on current on viewer 1 showDocked off parlanguage 0\nend\n")
    assert info["extras"] == {}


def test_text_and_table_blobs_roundtrip():
    assert toe._read_text(H.text_blob("héllo\nwörld")) == "héllo\nwörld"
    assert toe._read_text(H.text_blob("")) == ""
    rows = [["a", "b"], ["ä", ""]]
    assert toe._read_table(H.table_blob(rows)) == rows


def test_truncated_table_is_an_error():
    with pytest.raises(toe.ToeError):
        toe._read_table(H.table_blob([["a", "b"]])[:-3])


def test_bad_node_header():
    with pytest.raises(toe.ToeError):
        toe.parse_node_header("garbage\n")


# ---- whole project

def test_roots_skip_local_and_snapshots_validate(tmp_path):
    roots = parse(tmp_path)
    assert list(roots) == ["project1"]
    snap = roots["project1"]
    assert S.validate(snap) == []
    assert snap["meta"] == {"format_version": 1, "project": "demo", "root": "/project1"}


def test_nodes_types_params_content_layout(tmp_path):
    snap = parse(tmp_path)["project1"]
    wave = node(snap, "/project1/wave1")
    assert wave["type"] == "waveCHOP"
    assert wave["params"]["freq"] == 1 and wave["params"]["wavetype"] == "sine"
    assert wave["params"]["amp"] == {"expr": "absTime.seconds"}
    assert wave["layout"] == {"x": 0, "y": 0, "w": 130, "h": 90}
    assert node(snap, "/project1/math1")["params"]["label"] == "two words"
    assert node(snap, "/project1/script1")["content"] == {"kind": "text", "lines": ["import td", "print(1)", ""]}
    assert node(snap, "/project1/table1")["content"]["rows"] == [["name", "value"], ["a", "1"]]
    assert node(snap, "/project1/geo1")["params"]["$cparm.Port"].startswith("Port 1 1")


def test_children_and_connections(tmp_path):
    snap = parse(tmp_path)["project1"]
    paths = {n["path"] for n in snap["nodes"]}
    assert "/project1/geo1/box1" in paths
    conns = {(c["from"], c["to"]) for c in snap["connections"]}
    assert ("/project1/wave1", "/project1/math1") in conns
    assert ("/project1/geo1/box1", "/project1/geo1/out1") in conns


def test_connection_to_unknown_or_parent_relative_source(tmp_path):
    base = H.build_project(tmp_path / "x")
    H.write_node(base / "project1", "late1", "CHOP:null", inputs=[(0, "ghost"), (1, "../project1/wave1")])
    snap = toe.parse_expanded(base, "demo")["project1"]
    conns = [(c["from"], c["to"]) for c in snap["connections"] if c["to"].endswith("late1")]
    assert conns == [("/project1/wave1", "/project1/late1")]


def test_output_is_canonical_and_serializable(tmp_path):
    snap = parse(tmp_path)["project1"]
    text = S.serialize(snap)
    assert S.serialize(S.parse(text)) == text


def test_two_versions_differ_where_expected(tmp_path):
    a, b = parse(tmp_path, "a")["project1"], parse(tmp_path, "b")["project1"]
    pa = {n["path"]: n for n in a["nodes"]}
    pb = {n["path"]: n for n in b["nodes"]}
    changed = {p for p in pb if p in pa and pa[p] != pb[p]}
    assert changed == {"/project1/wave1", "/project1/script1"}
    assert set(pb) - set(pa) == {"/project1/noise1"}


def test_missing_toeexpand_gives_a_helpful_error(monkeypatch):
    monkeypatch.delenv("DIFFTD_TOEEXPAND", raising=False)
    monkeypatch.setattr(toe.shutil, "which", lambda name: None)
    monkeypatch.setattr(toe.glob, "glob", lambda pattern: [])
    with pytest.raises(toe.ToeError, match="DIFFTD_TOEEXPAND"):
        toe.find_toeexpand()


def test_env_override_must_exist(monkeypatch, tmp_path):
    monkeypatch.setenv("DIFFTD_TOEEXPAND", str(tmp_path / "nope"))
    with pytest.raises(toe.ToeError, match="does not exist"):
        toe.find_toeexpand()


@pytest.fixture
def fake_toeexpand(tmp_path, monkeypatch):
    """A stand-in for toeexpand that 'expands' by copying a prepared directory."""
    src = H.build_project(tmp_path / "prepared", "a")
    script = tmp_path / "toeexpand"
    script.write_text(f'#!/bin/sh\ncp -R "{src}" "$1.dir"\necho "$1 expanded"\nexit 3\n')  # exit code 3 like the real tool
    script.chmod(script.stat().st_mode | stat.S_IEXEC)
    return str(script)


def test_convert_runs_toeexpand_and_cleans_up(tmp_path, fake_toeexpand):
    toe_file = tmp_path / "Demo.toe"
    toe_file.write_bytes(b"binary")
    roots = toe.convert(toe_file, fake_toeexpand)
    assert roots["project1"]["meta"]["project"] == "Demo"
    assert not list(tmp_path.glob("difftd-*"))


def test_convert_reports_a_missing_file(tmp_path, fake_toeexpand):
    with pytest.raises(toe.ToeError, match="does not exist"):
        toe.convert(tmp_path / "nope.toe", fake_toeexpand)


def test_convert_reports_toeexpand_failure(tmp_path):
    bad = tmp_path / "toeexpand"
    bad.write_text("#!/bin/sh\necho broken >&2\nexit 1\n")
    bad.chmod(0o755)
    (tmp_path / "x.toe").write_bytes(b"x")
    with pytest.raises(toe.ToeError, match="broken"):
        toe.convert(tmp_path / "x.toe", str(bad))


def test_tox_layout_with_init_and_def_files(tmp_path):
    H.write_component_node(tmp_path, "template", "COMP:container", tile="tile 49 35 162 130", parm=["w 67108864 640"])
    H.write_component_node(tmp_path / "template", "help", "DAT:text")
    (tmp_path / "template" / "help.text").write_bytes(H.text_blob("hello"))
    snap = toe.parse_expanded(tmp_path, "comp")["template"]
    assert S.validate(snap) == []
    root = node(snap, "/template")
    assert root["type"] == "containerCOMP" and root["params"]["w"] == 640
    assert root["layout"] == {"x": 49, "y": 35, "w": 162, "h": 130}
    assert node(snap, "/template/help")["content"]["lines"] == ["hello"]
