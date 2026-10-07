"""Read .toe / .tox files without starting TouchDesigner, via TouchDesigner's own `toeexpand`.

`toeexpand` unpacks a project into a directory of text files:
  <name>.n      node header: `FAMILY:type`, `tile x y w h`, `flags ...`, `inputs {..}`, `color ..`
  <name>.parm   parameters that differ from the default: `name flags value [expression]`
  <name>.text / <name>.table   DAT content (small binary container, see _read_text / _read_table)
  <name>/       children of a COMP

The result is converted to the same snapshot format the exporter writes (schema/snapshot.schema.json)
plus an optional `layout` per node, so one viewer and one diff cover both sources.
"""

import glob
import hashlib
import os
import posixpath
import shutil
import struct
import subprocess
import sys
import tempfile
from pathlib import Path

from . import snapshot as S

# roots that exist in every project and are not user work
DEFAULT_SKIP_ROOTS = ("local", "perform")
# `flags` entries that only describe the editor state (selection, viewer), not the project
_EDITOR_FLAGS = {"picked", "current", "viewer", "parlanguage", "showDocked"}


class ToeError(RuntimeError):
    """toeexpand missing or failing, or the expanded data is not understood."""


# --------------------------------------------------------------------------- locating toeexpand


def find_toeexpand():
    env = os.environ.get("DIFFTD_TOEEXPAND")
    if env:
        if not Path(env).is_file():
            raise ToeError(f"DIFFTD_TOEEXPAND points to {env}, which does not exist")
        return env
    on_path = shutil.which("toeexpand")
    if on_path:
        return on_path
    candidates = []
    if sys.platform == "darwin":
        candidates += glob.glob("/Applications/TouchDesigner*.app/Contents/MacOS/toeexpand")
    elif sys.platform.startswith("win"):
        for base in (os.environ.get("ProgramFiles", r"C:\Program Files"),):
            candidates += glob.glob(os.path.join(base, "Derivative", "TouchDesigner*", "bin", "toeexpand.exe"))
    if candidates:
        return sorted(candidates)[-1]
    raise ToeError(
        "toeexpand not found. It ships with TouchDesigner; set DIFFTD_TOEEXPAND to its full path "
        "(macOS: /Applications/TouchDesigner.app/Contents/MacOS/toeexpand)."
    )


def expand(toe_path, out_dir, toeexpand=None):
    """Run toeexpand on a copy of the file inside out_dir; returns the directory with the expanded files."""
    toeexpand = toeexpand or find_toeexpand()
    src = Path(toe_path)
    if not src.is_file():
        raise ToeError(f"{src} does not exist")
    work = Path(out_dir) / "in"
    work.mkdir(parents=True, exist_ok=True)
    copy = work / f"project{src.suffix.lower()}"
    shutil.copyfile(src, copy)  # toeexpand writes next to its input
    try:
        proc = subprocess.run([toeexpand, copy.name], cwd=work, capture_output=True, text=True, timeout=300)
    except (OSError, subprocess.TimeoutExpired) as exc:
        raise ToeError(f"toeexpand failed: {exc}") from exc
    expanded = work / f"{copy.name}.dir"
    # toeexpand reports success with a non-zero exit code on some builds, so trust the output directory
    if not expanded.is_dir():
        lines = [ln.strip() for ln in (proc.stderr or proc.stdout).splitlines() if ln.strip()]
        raise ToeError(f"toeexpand could not read {src.name}: {lines[-1] if lines else 'no output'}")
    return expanded


# --------------------------------------------------------------------------- small format readers


def tokenize(line):
    """Split on spaces; double-quoted tokens may contain spaces and \\" or \\\\ escapes."""
    tokens, i, n = [], 0, len(line)
    while i < n:
        c = line[i]
        if c in " \t":
            i += 1
        elif c == '"':
            i += 1
            buf = []
            while i < n and line[i] != '"':
                if line[i] == "\\" and i + 1 < n:
                    i += 1
                buf.append(line[i])
                i += 1
            i += 1
            tokens.append(("q", "".join(buf)))
        else:
            j = i
            while j < n and line[j] not in " \t":
                j += 1
            tokens.append(("b", line[i:j]))
            i = j
    return tokens


def _scalar(kind, text):
    if kind == "q":
        return text
    try:
        number = float(text)
    except ValueError:
        return text
    if number != number or number in (float("inf"), float("-inf")):
        return text
    return int(number) if number.is_integer() and "." not in text and "e" not in text.lower() else number


def parse_parm(text):
    """name -> value | {"expr": ...}. Only parameters that differ from the default are listed in the file.

    The stored value of an expression parameter is its last evaluated result (e.g. a frame number)
    and changes constantly, so for expressions only the expression text is kept.
    """
    params = {}
    for line in text.splitlines():
        line = line.strip()
        if not line or line == "?":
            continue
        tokens = tokenize(line)
        if len(tokens) < 3 or tokens[1][0] != "b" or not tokens[1][1].isdigit():
            continue
        name = tokens[0][1]
        if len(tokens) >= 4:
            params[name] = {"expr": tokens[3][1]}
        else:
            params[name] = _scalar(*tokens[2])
    return params


def parse_node_header(text):
    """-> {type, layout?, inputs: [(index, source_name)], extras: {...}} from a `.n` file."""
    lines = text.splitlines()
    if not lines or ":" not in lines[0]:
        raise ToeError("unexpected node file (no FAMILY:type header)")
    family, kind = lines[0].strip().split(":", 1)
    info = {"type": f"{kind}{family}", "inputs": [], "extras": {}}
    i = 1
    while i < len(lines):
        line = lines[i].strip()
        i += 1
        if line.startswith("tile "):
            parts = line.split()[1:]
            try:
                x, y, w, h = (float(p) for p in parts[:4])
                info["layout"] = {"x": x, "y": y, "w": w, "h": h}
            except ValueError:
                pass
        elif line.startswith("flags"):
            toks = line.replace("=", " ").split()[1:]
            for k in range(0, len(toks) - 1, 2):
                if toks[k] not in _EDITOR_FLAGS:
                    info["extras"][f"$flag.{toks[k]}"] = _scalar("b", toks[k + 1])
        elif line.startswith("color "):
            info["extras"]["$color"] = " ".join(line.split()[1:])
        elif line.startswith("dock "):
            info["extras"]["$dock"] = line.split(None, 1)[1].strip()
        elif line == "inputs":
            while i < len(lines) and lines[i].strip() != "{":
                i += 1
            i += 1
            while i < len(lines) and lines[i].strip() != "}":
                parts = lines[i].split()
                if len(parts) >= 2 and parts[0].isdigit():
                    for src in parts[1:]:
                        info["inputs"].append((int(parts[0]), src))
                i += 1
            i += 1
        elif line == "end":
            break
    return info


def node_names(directory):
    """Node names in a directory: `X.n` (projects) or `X.init` (component files)."""
    names = {f.name[:-2] for f in directory.glob("*.n")} | {f.name[:-5] for f in directory.glob("*.init")}
    return sorted(names)


def read_node(directory, name):
    """Parse the header of node `name` from `name.n`, or from `name.init` + `name.def` (.tox files)."""
    n_file = directory / f"{name}.n"
    if n_file.is_file():
        return parse_node_header(n_file.read_text(encoding="utf-8", errors="replace"))
    init = (directory / f"{name}.init").read_text(encoding="utf-8", errors="replace").strip()
    if not init.startswith("type = ") or ":" not in init:
        raise ToeError(f"unexpected component file {name}.init")
    body = ""
    def_file = directory / f"{name}.def"
    if def_file.is_file():
        body = def_file.read_text(encoding="utf-8", errors="replace")
    return parse_node_header(init[len("type = "):].split("\n", 1)[0].strip() + "\n" + body)


def _read_text(data):
    """`.text`: b"2\\n*" + 5 big-endian uint32 + uint32 length + utf-8 text."""
    if not data.startswith(b"2\n*") or len(data) < 27:
        return data.decode("utf-8", "replace")
    (length,) = struct.unpack(">I", data[23:27])
    body = data[27:]
    if length != len(body):
        body = body[:length] if length < len(body) else body
    return body.decode("utf-8", "replace")


def _read_table(data):
    """`.table`: b"1\\n*" + uint32 version, rows, cols, 0, then per cell: uint32 2, uint32 length, bytes."""
    if not data.startswith(b"1\n*") or len(data) < 19:
        raise ToeError("unknown table format")
    _version, rows, cols, _zero = struct.unpack(">4I", data[3:19])
    pos, cells = 19, []
    for _ in range(rows * cols):
        if pos + 8 > len(data):
            raise ToeError("table data is shorter than its header says")
        _flag, length = struct.unpack(">II", data[pos:pos + 8])
        pos += 8
        cells.append(data[pos:pos + length].decode("utf-8", "replace"))
        pos += length
    return [cells[r * cols:(r + 1) * cols] for r in range(rows)]


def _content(directory, name):
    text_file = directory / f"{name}.text"
    if text_file.is_file():
        text = _read_text(text_file.read_bytes())
        return {"kind": "text", "lines": text.split("\n") if text else []}
    table_file = directory / f"{name}.table"
    if table_file.is_file():
        try:
            return {"kind": "table", "rows": _read_table(table_file.read_bytes())}
        except ToeError:
            return None
    return None


def _custom_parameter_defs(directory, name):
    path = directory / f"{name}.cparm"
    defs = {}
    if not path.is_file():
        return defs
    for line in path.read_text(encoding="utf-8", errors="replace").splitlines():
        tokens = tokenize(line)
        if len(tokens) >= 3 and tokens[0][1].isdigit():
            defs[f"$cparm.{tokens[1][1]}"] = " ".join(t[1] for t in tokens[2:])
    return defs


# --------------------------------------------------------------------------- expanded dir -> snapshots


def _read_nodes(directory, parent_path, nodes, raw_inputs):
    for name in node_names(directory):
        path = f"{parent_path}/{name}"
        info = read_node(directory, name)
        parm_file = directory / f"{name}.parm"
        params = parse_parm(parm_file.read_text(encoding="utf-8", errors="replace")) if parm_file.is_file() else {}
        params.update(info["extras"])
        params.update(_custom_parameter_defs(directory, name))
        node = {"path": path, "name": name, "type": info["type"], "params": params}
        content = _content(directory, name)
        if content:
            node["content"] = content
        if "layout" in info:
            node["layout"] = info["layout"]
        nodes.append(node)
        for index, source in info["inputs"]:
            raw_inputs.append((parent_path, source, path, index))
        child_dir = directory / name
        if child_dir.is_dir():
            _read_nodes(child_dir, path, nodes, raw_inputs)


def parse_expanded(expanded_dir, project_name, skip_roots=DEFAULT_SKIP_ROOTS):
    """-> {root_name: snapshot} for each top-level node of the expanded project."""
    base = Path(expanded_dir)
    roots = {}
    for root_name in node_names(base):
        if root_name in skip_roots:
            continue
        nodes, raw_inputs = [], []
        # parse just this root (and its directory) by treating "/" as parent
        info_dir = base
        path = f"/{root_name}"
        info = read_node(base, root_name)
        parm_file = base / f"{root_name}.parm"
        params = parse_parm(parm_file.read_text(encoding="utf-8", errors="replace")) if parm_file.is_file() else {}
        params.update(info["extras"])
        params.update(_custom_parameter_defs(info_dir, root_name))
        root_node = {"path": path, "name": root_name, "type": info["type"], "params": params}
        if "layout" in info:
            root_node["layout"] = info["layout"]
        nodes.append(root_node)
        child_dir = base / root_name
        if child_dir.is_dir():
            _read_nodes(child_dir, path, nodes, raw_inputs)
        known = {n["path"] for n in nodes}
        connections = []
        for parent, source, target, index in raw_inputs:
            src = source if source.startswith("/") else posixpath.normpath(posixpath.join(parent, source))
            if src in known and target in known and src != target:
                conn = {"from": src, "to": target}
                if index:
                    conn["toIndex"] = index
                connections.append(conn)
        roots[root_name] = S.canonicalize({
            "meta": {"format_version": S.SUPPORTED_FORMAT_VERSION, "project": project_name, "root": path},
            "nodes": nodes,
            "connections": connections,
        })
    return roots


# --------------------------------------------------------------------------- public API


def convert(toe_path, toeexpand=None, skip_roots=DEFAULT_SKIP_ROOTS):
    """Read a .toe/.tox and return {root_name: snapshot dict}. Does not start TouchDesigner."""
    toe_path = Path(toe_path)
    with tempfile.TemporaryDirectory(prefix="difftd-") as tmp:
        expanded = expand(toe_path, tmp, toeexpand)
        roots = parse_expanded(expanded, toe_path.stem, skip_roots)
    if not roots:
        raise ToeError(f"{toe_path.name} contains no top-level nodes")
    return roots


def cache_key(path):
    st = Path(path).stat()
    return hashlib.sha256(f"{Path(path).resolve()}|{st.st_mtime_ns}|{st.st_size}".encode()).hexdigest()[:20]
