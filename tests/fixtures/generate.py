"""Regenerate canonical fixture files. Run: python3 tests/fixtures/generate.py

Valid fixtures are written with the canonical serializer so they satisfy
serialize(parse(text)) == text. Invalid fixtures are written verbatim.
"""

import copy
import hashlib
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parents[1]))

from difftd.snapshot import serialize  # noqa: E402

P = "/project1/net1"


def node(name, type_, params=None, parent=P, content=None):
    n = {
        "path": f"{parent}/{name}" if parent else name,
        "name": name,
        "type": type_,
        "params": params or {},
    }
    if content:
        n["content"] = content
    return n


def snap(nodes, connections, root=P, project="project1"):
    return {
        "meta": {"format_version": 1, "project": project, "root": root},
        "nodes": nodes,
        "connections": connections,
    }


def conn(a, b, fi=0, ti=0, parent=P):
    c = {"from": f"{parent}/{a}", "to": f"{parent}/{b}"}
    if fi:
        c["fromIndex"] = fi
    if ti:
        c["toIndex"] = ti
    return c


ROOT = node("net1", "baseCOMP", {"w": 800, "h": 600}, parent="/project1")


def wave(freq=1.0, type_="sine", amp=1.0):
    return node("wave1", "waveCHOP", {"amp": amp, "freq": freq, "offset": {"expr": "absTime.seconds"}, "wavetype": type_})


def math(gain=1.0):
    return node("math1", "mathCHOP", {"gain": gain, "postoff": 0})


OUT = node("out1", "nullCHOP", {"cooktype": "Always"})


def simple():
    return snap(
        [ROOT, wave(), math(), OUT],
        [conn("wave1", "math1"), conn("math1", "out1")],
    )


def nested():
    sub = node("sub1", "baseCOMP", {"w": 400, "h": 600})
    inner = node("merge1", "mergeCHOP", {"align": "extend"}, parent=f"{P}/sub1")
    a = node("const1", "constantCHOP", {"value0": 1.5}, parent=f"{P}/sub1")
    b = node("const2", "constantCHOP", {"value0": -2}, parent=f"{P}/sub1")
    s = snap(
        [ROOT, sub, inner, a, b],
        [
            conn("const1", "merge1", parent=f"{P}/sub1"),
            conn("const2", "merge1", fi=1, ti=1, parent=f"{P}/sub1"),
        ],
    )
    return s


def dat():
    text = node("script1", "textDAT", {"language": "python"}, content={"kind": "text", "lines": ["import td", "x = 1", "", "print(x)"]})
    table = node("table1", "tableDAT", {"extension": 0}, content={"kind": "table", "rows": [["name", "value"], ["a", "1"], ["b", "2"]]})
    return snap([ROOT, text, table], [])


def empty():
    return snap([ROOT], [])


def before():
    script = node("script1", "textDAT", {"language": "python"}, content={"kind": "text", "lines": ["a", "b", "c"]})
    return snap(
        [ROOT, wave(), math(), OUT, script],
        [conn("wave1", "math1"), conn("math1", "out1")],
    )


def after():
    script = node("script1", "textDAT", {"language": "python"}, content={"kind": "text", "lines": ["a", "B", "c"]})
    noise = node("noise1", "noiseCHOP", {"seed": 1, "period": 1})
    return snap(
        [ROOT, wave(freq=2.0), OUT, noise, script],
        [conn("wave1", "out1"), conn("noise1", "out1", ti=1)],
    )


def write(path, snapshot):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(serialize(snapshot), encoding="utf-8")


def merge_base():
    s = simple()
    s["nodes"].append(node("script1", "textDAT", {"language": "python"}, content={"kind": "text", "lines": ["l1", "l2", "l3", "l4", "l5"]}))
    return s


def edit(s, path, **changes):
    s = copy.deepcopy(s)
    for n in s["nodes"]:
        if n["path"] == path:
            for k, v in changes.items():
                if k == "params":
                    n["params"].update(v)
                else:
                    n[k] = v
    return s


def merge_scenarios():
    base = merge_base()
    w = f"{P}/wave1"
    m = f"{P}/math1"
    sc = f"{P}/script1"

    out = {}
    # 1. disjoint edits, including two different parameters of the same node
    ours = edit(base, w, params={"freq": 2.0})
    ours["nodes"].append(node("noise1", "noiseCHOP", {"seed": 1}))
    theirs = edit(edit(base, w, params={"wavetype": "square"}), m, params={"gain": 3.0})
    expected = edit(edit(edit(base, w, params={"freq": 2.0, "wavetype": "square"}), m, params={"gain": 3.0}), "none")
    expected["nodes"].append(node("noise1", "noiseCHOP", {"seed": 1}))
    out["disjoint"] = (base, ours, theirs, expected, [])
    # 2. same parameter, different values
    out["param-conflict"] = (
        base,
        edit(base, w, params={"freq": 2.0}),
        edit(base, w, params={"freq": 3.0}),
        None,
        [{"kind": "param", "key": f"{w}#freq"}],
    )
    # 3. identical change on both sides
    same = edit(base, w, params={"freq": 2.0})
    out["identical"] = (base, same, copy.deepcopy(same), same, [])
    # 4. ours deletes a node, theirs edits it
    ours = copy.deepcopy(base)
    ours["nodes"] = [n for n in ours["nodes"] if n["path"] != m]
    ours["connections"] = []
    theirs = edit(base, m, params={"gain": 3.0})
    out["edit-vs-delete"] = (base, ours, theirs, None, [{"kind": "node", "key": m}])
    # 5. both add the same path with different content
    ours = copy.deepcopy(base)
    ours["nodes"].append(node("noise1", "noiseCHOP", {"seed": 1}))
    theirs = copy.deepcopy(base)
    theirs["nodes"].append(node("noise1", "noiseCHOP", {"seed": 2}))
    out["add-add"] = (base, ours, theirs, None, [{"kind": "node", "key": f"{P}/noise1"}])
    # 6. ours deletes a node, theirs only adds a connection to it
    ours = copy.deepcopy(base)
    ours["nodes"] = [n for n in ours["nodes"] if n["path"] != m]
    ours["connections"] = []
    theirs = copy.deepcopy(base)
    theirs["nodes"].append(node("noise1", "noiseCHOP", {"seed": 1}))
    theirs["connections"].append(conn("noise1", "math1", ti=1))
    out["connection-vs-delete"] = (base, ours, theirs, None, [{"kind": "node", "key": m}])
    # 7. DAT: non-overlapping line edits merge, overlapping edits conflict
    ours = edit(base, sc, content={"kind": "text", "lines": ["l1", "OURS", "l3", "l4", "l5"]})
    theirs = edit(base, sc, content={"kind": "text", "lines": ["l1", "l2", "l3", "l4", "THEIRS"]})
    merged = edit(base, sc, content={"kind": "text", "lines": ["l1", "OURS", "l3", "l4", "THEIRS"]})
    out["dat-merge"] = (base, ours, theirs, merged, [])
    theirs2 = edit(base, sc, content={"kind": "text", "lines": ["l1", "THEIRS", "l3", "l4", "l5"]})
    out["dat-conflict"] = (base, ours, theirs2, None, [{"kind": "content", "key": f"{sc}#content:0"}])
    # 8. quickstart step 7: one real conflict, two non-clashing edits to the same node
    qbase = simple()
    qbase["nodes"].append(node("noise1", "noiseCHOP", {"seed": 1, "period": 1}))
    n1 = f"{P}/noise1"
    qours = edit(edit(qbase, w, params={"freq": 2.0}), n1, params={"period": 2})
    qtheirs = edit(edit(qbase, w, params={"freq": 3.0}), n1, params={"seed": 5})
    out["quickstart"] = (qbase, qours, qtheirs, None, [{"kind": "param", "key": f"{w}#freq"}])
    return out


def main():
    valid = {
        "simple.json": simple(),
        "nested.json": nested(),
        "dat.json": dat(),
        "empty.json": empty(),
        "before.json": before(),
        "after.json": after(),
    }
    for name, s in valid.items():
        write(HERE / name, s)

    # invalid fixtures (written verbatim)
    (HERE / "malformed.json").write_text('{"meta": {"format_version": 1,\n  "nodes": [\n', encoding="utf-8")
    bad = simple()
    del bad["nodes"][1]["type"]
    (HERE / "invalid-schema.json").write_text(json.dumps(bad, indent=2) + "\n", encoding="utf-8")
    bad = simple()
    bad["connections"].append({"from": f"{P}/wave1", "to": f"{P}/ghost"})
    (HERE / "dangling-connection.json").write_text(json.dumps(bad, indent=2) + "\n", encoding="utf-8")
    bad = simple()
    bad["meta"]["format_version"] = 99
    (HERE / "future-version.json").write_text(json.dumps(bad, indent=2) + "\n", encoding="utf-8")

    hashes = {}
    for name in valid:
        hashes[name] = hashlib.sha256((HERE / name).read_bytes()).hexdigest()

    for name, (b, o, t, e, conflicts) in merge_scenarios().items():
        d = HERE / "merge" / name
        write(d / "base.json", b)
        write(d / "ours.json", o)
        write(d / "theirs.json", t)
        for f in ("base", "ours", "theirs"):
            hashes[f"merge/{name}/{f}.json"] = hashlib.sha256((d / f"{f}.json").read_bytes()).hexdigest()
        if e is not None:
            write(d / "expected.json", e)
            hashes[f"merge/{name}/expected.json"] = hashlib.sha256((d / "expected.json").read_bytes()).hexdigest()
        (d / "conflicts.json").write_text(json.dumps(conflicts, indent=2) + "\n", encoding="utf-8")

    (HERE / "canonical-hashes.json").write_text(json.dumps(hashes, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(f"wrote {len(valid)} fixtures, {len(hashes)} hashes")


if __name__ == "__main__":
    main()
