"""Snapshot model: canonical serialization, parsing and validation.

Pure Python (stdlib only, no TouchDesigner imports). The JSON Schema in
schema/snapshot.schema.json is the single source of truth for the structure;
the extra rules from data-model.md are checked in `validate`.
"""

import json
import re
from decimal import Decimal
from pathlib import Path

SUPPORTED_FORMAT_VERSION = 1
SCHEMA_PATH = Path(__file__).resolve().parent.parent / "schema" / "snapshot.schema.json"


class SnapshotError(ValueError):
    """Raised for unparsable or invalid snapshots. `errors` holds validation details."""

    def __init__(self, message, errors=None):
        super().__init__(message)
        self.errors = errors or []


# --------------------------------------------------------------------------- numbers


def format_number(value):
    """Format a number exactly like ECMAScript Number.prototype.toString.

    Integral floats print without a fraction, so Python and the JavaScript viewer
    emit identical bytes.
    """
    if isinstance(value, bool):
        raise TypeError("bool is not a number")
    if isinstance(value, int):
        return str(value)
    if value != value or value in (float("inf"), float("-inf")):
        raise SnapshotError("NaN and Infinity cannot be stored in a snapshot")
    if value == 0:
        return "0"
    sign = "-" if value < 0 else ""
    d = Decimal(repr(abs(value)))
    parts = d.as_tuple()
    digits = "".join(str(x) for x in parts.digits).rstrip("0") or "0"
    # ECMAScript: value = digits * 10**(n - k), k = len(digits)
    n = len(parts.digits) + parts.exponent
    k = len(digits)
    if k <= n <= 21:
        return sign + digits + "0" * (n - k)
    if 0 < n <= 21:
        return sign + digits[:n] + "." + digits[n:]
    if -6 < n <= 0:
        return sign + "0." + "0" * (-n) + digits
    e = n - 1
    exp = ("+" if e >= 0 else "-") + str(abs(e))
    if k == 1:
        return sign + digits + "e" + exp
    return sign + digits[0] + "." + digits[1:] + "e" + exp


# --------------------------------------------------------------------------- serialization


def _encode(value, indent):
    pad = "  " * indent
    inner = "  " * (indent + 1)
    if isinstance(value, dict):
        if not value:
            return "{}"
        items = [
            f"{inner}{json.dumps(k, ensure_ascii=False)}: {_encode(value[k], indent + 1)}"
            for k in sorted(value)
        ]
        return "{\n" + ",\n".join(items) + "\n" + pad + "}"
    if isinstance(value, (list, tuple)):
        if not value:
            return "[]"
        items = [f"{inner}{_encode(v, indent + 1)}" for v in value]
        return "[\n" + ",\n".join(items) + "\n" + pad + "]"
    if isinstance(value, bool):
        return "true" if value else "false"
    if value is None:
        return "null"
    if isinstance(value, (int, float)):
        return format_number(value)
    if isinstance(value, str):
        return json.dumps(value, ensure_ascii=False)
    raise TypeError(f"cannot serialize {type(value).__name__}")


def _conn_key(c):
    return (c["to"], c.get("toIndex", 0), c["from"], c.get("fromIndex", 0))


def canonicalize(snapshot):
    """Return a copy with canonical ordering and zero indices omitted."""
    nodes = sorted(snapshot["nodes"], key=lambda n: n["path"])
    conns = []
    for c in sorted(snapshot["connections"], key=_conn_key):
        out = {"from": c["from"], "to": c["to"]}
        if c.get("fromIndex", 0):
            out["fromIndex"] = c["fromIndex"]
        if c.get("toIndex", 0):
            out["toIndex"] = c["toIndex"]
        conns.append(out)
    return {"meta": snapshot["meta"], "nodes": nodes, "connections": conns}


def serialize(snapshot):
    """Canonical text: sorted keys, 2-space indent, LF, trailing newline."""
    return _encode(canonicalize(snapshot), 0) + "\n"


def snapshot_path(project, root_name, snapshot_dir="snapshots"):
    """Relative file path (POSIX style) for a top-level COMP snapshot."""
    return f"{snapshot_dir}/{project}/{root_name}.json"


# --------------------------------------------------------------------------- validation


def _type_ok(value, name):
    if name == "object":
        return isinstance(value, dict)
    if name == "array":
        return isinstance(value, list)
    if name == "string":
        return isinstance(value, str)
    if name == "boolean":
        return isinstance(value, bool)
    if name == "integer":
        return isinstance(value, int) and not isinstance(value, bool)
    if name == "number":
        return isinstance(value, (int, float)) and not isinstance(value, bool)
    return False


def _check(schema, value, root, path, errors):
    """Minimal JSON Schema subset: $ref, type, const, required, properties,
    additionalProperties, items, oneOf, minimum, minLength, pattern."""
    if "$ref" in schema:
        node = root
        for part in schema["$ref"].lstrip("#/").split("/"):
            node = node[part]
        _check(node, value, root, path, errors)
        return
    if "oneOf" in schema:
        matches = 0
        for sub in schema["oneOf"]:
            sub_errors = []
            _check(sub, value, root, path, sub_errors)
            if not sub_errors:
                matches += 1
        if matches != 1:
            errors.append(
                {"code": "schema", "path": path, "message": "does not match any allowed form"}
            )
        return
    if "const" in schema and value != schema["const"]:
        errors.append({"code": "schema", "path": path, "message": f"must be {schema['const']!r}"})
        return
    if "type" in schema:
        types = schema["type"] if isinstance(schema["type"], list) else [schema["type"]]
        if not any(_type_ok(value, t) for t in types):
            errors.append(
                {"code": "schema", "path": path, "message": f"must be of type {'/'.join(types)}"}
            )
            return
    if isinstance(value, str):
        if len(value) < schema.get("minLength", 0):
            errors.append({"code": "schema", "path": path, "message": "must not be empty"})
        if "pattern" in schema and not re.search(schema["pattern"], value):
            errors.append({"code": "schema", "path": path, "message": "has an invalid format"})
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        if "minimum" in schema and value < schema["minimum"]:
            errors.append(
                {"code": "schema", "path": path, "message": f"must be >= {schema['minimum']}"}
            )
    if isinstance(value, dict):
        for key in schema.get("required", []):
            if key not in value:
                errors.append(
                    {"code": "schema", "path": path, "message": f"missing required '{key}'"}
                )
        props = schema.get("properties", {})
        extra = schema.get("additionalProperties", True)
        for key, sub in value.items():
            if key in props:
                _check(props[key], sub, root, f"{path}/{key}", errors)
            elif extra is False:
                errors.append(
                    {"code": "schema", "path": path, "message": f"unexpected property '{key}'"}
                )
            elif isinstance(extra, dict):
                _check(extra, sub, root, f"{path}/{key}", errors)
    if isinstance(value, list) and "items" in schema:
        for i, item in enumerate(value):
            _check(schema["items"], item, root, f"{path}/{i}", errors)


_schema_cache = None


def _schema():
    global _schema_cache
    if _schema_cache is None:
        _schema_cache = json.loads(SCHEMA_PATH.read_text(encoding="utf-8"))
    return _schema_cache


def validate(obj):
    """Return a list of errors ({code, path, message}); empty list means valid."""
    meta = obj.get("meta") if isinstance(obj, dict) else None
    version = meta.get("format_version") if isinstance(meta, dict) else None
    if isinstance(version, int) and not isinstance(version, bool) and version > SUPPORTED_FORMAT_VERSION:
        return [
            {
                "code": "unsupported_version",
                "path": "/meta/format_version",
                "message": f"format version {version} is newer than supported "
                f"version {SUPPORTED_FORMAT_VERSION}",
            }
        ]
    schema = _schema()
    errors = []
    _check(schema, obj, schema, "", errors)
    if errors:
        return errors

    paths = [n["path"] for n in obj["nodes"]]
    if len(set(paths)) != len(paths):
        seen = set()
        for p in paths:
            if p in seen:
                errors.append(
                    {"code": "duplicate_path", "path": "/nodes", "message": f"duplicate node path {p}"}
                )
            seen.add(p)
    root = obj["meta"]["root"]
    if root not in paths:
        errors.append(
            {"code": "root_missing", "path": "/meta/root", "message": f"root {root} is not a node"}
        )
    for p in paths:
        if p != root and not p.startswith(root + "/"):
            errors.append(
                {"code": "outside_root", "path": "/nodes", "message": f"{p} is outside root {root}"}
            )
    known = set(paths)
    for i, c in enumerate(obj["connections"]):
        for end in ("from", "to"):
            if c[end] not in known:
                errors.append(
                    {
                        "code": "dangling_connection",
                        "path": f"/connections/{i}/{end}",
                        "message": f"connection endpoint {c[end]} is not a node",
                    }
                )
    return errors


def parse(text):
    """Parse and validate snapshot text. Raises SnapshotError with a readable message."""
    try:
        obj = json.loads(text)
    except json.JSONDecodeError as exc:
        raise SnapshotError(f"not valid JSON: {exc}") from exc
    errors = validate(obj)
    if errors:
        first = errors[0]
        raise SnapshotError(f"invalid snapshot: {first['message']} ({first['path'] or '/'})", errors)
    return obj
