"""Builds expanded-project directories in the toeexpand text format (decoded from real output)."""

import struct
from pathlib import Path


def text_blob(text):
    body = text.encode("utf-8")
    return b"2\n*" + struct.pack(">5I", 1, 1, 1, 1, 2) + struct.pack(">I", len(body)) + body


def table_blob(rows):
    cols = len(rows[0]) if rows else 0
    out = b"1\n*" + struct.pack(">4I", 1, len(rows), cols, 0)
    for row in rows:
        for cell in row:
            data = cell.encode("utf-8")
            out += struct.pack(">II", 2, len(data)) + data
    return out


def write_node(directory, name, header, parm=None, inputs=(), text=None, table=None, cparm=None, tile="tile 0 0 130 72"):
    directory = Path(directory)
    directory.mkdir(parents=True, exist_ok=True)
    lines = [header, tile, "flags =  picked on current on viewer 1 parlanguage 0"]
    if inputs:
        lines += ["inputs", "{"] + [f"{i} \t {src}" for i, src in inputs] + ["}"]
    lines += ["color 0.55 0.55 0.55 ", "end", ""]
    (directory / f"{name}.n").write_text("\n".join(lines), encoding="utf-8")
    if parm is not None:
        (directory / f"{name}.parm").write_text("?\n" + "\n".join(parm) + "\n?\n", encoding="utf-8")
    if text is not None:
        (directory / f"{name}.text").write_bytes(text_blob(text))
    if table is not None:
        (directory / f"{name}.table").write_bytes(table_blob(table))
    if cparm is not None:
        (directory / f"{name}.cparm").write_text("?\npages 1 params\n" + "\n".join(cparm) + "\n?\n", encoding="utf-8")


def build_project(base, variant="a"):
    """Expanded project with a root `project1` (+ `local` that must be skipped). Variant b differs from a."""
    base = Path(base)
    write_node(base, "local", "COMP:base")
    write_node(base, "project1", "COMP:container", parm=["w 67108864 1280", 'resizecomp 201326609 "" me'], tile="tile 200 100 400 244")
    p = base / "project1"
    freq = "1" if variant == "a" else "2"
    write_node(p, "wave1", "CHOP:wave", parm=[f"freq 67108864 {freq}", "wavetype 67108864 sine", 'amp 201326608 0.5 "absTime.seconds"'], tile="tile 0 0 130 90")
    write_node(p, "math1", "CHOP:math", parm=["gain 67108864 2.5", 'label 67108864 "two words"'], inputs=[(0, "wave1")], tile="tile 200 0 130 90")
    write_node(p, "script1", "DAT:text", text="import td\nprint(1)\n" if variant == "a" else "import td\nprint(2)\n", tile="tile 0 -150 130 72")
    write_node(p, "table1", "DAT:table", table=[["name", "value"], ["a", "1"]], tile="tile 200 -150 130 72")
    if variant == "b":
        write_node(p, "noise1", "CHOP:noise", parm=["seed 67108864 7"], inputs=[(0, "math1")], tile="tile 400 0 130 90")
    g = p / "geo1"
    write_node(p, "geo1", "COMP:geo", parm=["material 67108864 ./phong1"], cparm=["772804866 Port Port 1 1 0 0 1 1 9999 2 0 \"\" \"\" params 0"], tile="tile 400 -150 160 130")
    write_node(g, "box1", "SOP:box", parm=["sizex 67108864 1"], tile="tile 0 0 100 60")
    write_node(g, "out1", "SOP:out", inputs=[(0, "box1")], tile="tile 200 0 100 60")
    return base


def write_component_node(directory, name, kind, tile="tile 0 0 130 72", parm=None):
    """Node in the .tox layout: `X.init` (type) + `X.def` (tile, flags, color)."""
    directory = Path(directory)
    directory.mkdir(parents=True, exist_ok=True)
    (directory / f"{name}.init").write_text(f"type = {kind}\n", encoding="utf-8")
    (directory / f"{name}.def").write_text(f"{tile}\nflags =  picked on current on viewer 1\ncolor UT_Color RGB 0.7 0.7 0.7 \nend\n", encoding="utf-8")
    if parm is not None:
        (directory / f"{name}.parm").write_text("?\n" + "\n".join(parm) + "\n?\n", encoding="utf-8")
