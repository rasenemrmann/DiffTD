import hashlib
import json
from pathlib import Path

import pytest

from difftd import snapshot as S

FIX = Path(__file__).resolve().parents[1] / "fixtures"
VALID = ["simple", "nested", "dat", "empty", "before", "after"]


def read(name):
    return (FIX / f"{name}.json").read_text(encoding="utf-8")


@pytest.mark.parametrize("name", VALID)
def test_valid_fixture_is_canonical_roundtrip(name):
    text = read(name)
    obj = S.parse(text)
    assert S.serialize(obj) == text


@pytest.mark.parametrize("name", VALID)
def test_valid_fixture_matches_json_schema_library(name):
    jsonschema = pytest.importorskip("jsonschema")
    schema = json.loads(S.SCHEMA_PATH.read_text(encoding="utf-8"))
    jsonschema.validate(json.loads(read(name)), schema)


@pytest.mark.parametrize(
    "name,code",
    [
        ("invalid-schema", "schema"),
        ("dangling-connection", "dangling_connection"),
        ("future-version", "unsupported_version"),
    ],
)
def test_invalid_fixtures_rejected_with_code(name, code):
    errors = S.validate(json.loads(read(name)))
    assert errors and errors[0]["code"] == code
    with pytest.raises(S.SnapshotError):
        S.parse(read(name))


def test_malformed_json_rejected():
    with pytest.raises(S.SnapshotError, match="not valid JSON"):
        S.parse(read("malformed"))


def test_ordering_is_canonical_regardless_of_input_order():
    obj = json.loads(read("nested"))
    shuffled = json.loads(read("nested"))
    shuffled["nodes"].reverse()
    shuffled["connections"].reverse()
    assert S.serialize(obj) == S.serialize(shuffled)


def test_zero_indices_omitted_and_nonzero_kept():
    obj = json.loads(read("simple"))
    obj["connections"][0]["fromIndex"] = 0
    obj["connections"][0]["toIndex"] = 0
    out = json.loads(S.serialize(obj))
    assert "fromIndex" not in out["connections"][0]
    obj["connections"][0]["toIndex"] = 2
    out = json.loads(S.serialize(obj))
    assert out["connections"][0]["toIndex"] == 2


@pytest.mark.parametrize(
    "value,expected",
    [(1.0, "1"), (2, "2"), (0.5, "0.5"), (1e-7, "1e-7"), (1e21, "1e+21"), (1e16, "10000000000000000"),
     (-3.25, "-3.25"), (0.1 + 0.2, "0.30000000000000004"), (0.0, "0")],
)
def test_number_formatting_matches_javascript(value, expected):
    assert S.format_number(value) == expected


def test_nan_rejected():
    with pytest.raises(S.SnapshotError):
        S.format_number(float("nan"))


def test_trailing_newline_lf_only_and_sorted_keys():
    text = S.serialize(json.loads(read("simple")))
    assert text.endswith("}\n") and "\r" not in text
    keys = list(json.loads(text).keys())
    assert keys == sorted(keys)


def test_snapshot_path():
    assert S.snapshot_path("project1", "geo1") == "snapshots/project1/geo1.json"
    assert S.snapshot_path("p", "a", "x") == "x/p/a.json"


def test_duplicate_paths_and_outside_root_rejected():
    obj = json.loads(read("simple"))
    obj["nodes"].append(dict(obj["nodes"][1]))
    assert any(e["code"] == "duplicate_path" for e in S.validate(obj))
    obj = json.loads(read("simple"))
    obj["nodes"][1]["path"] = "/elsewhere/x"
    assert any(e["code"] == "outside_root" for e in S.validate(obj))


def test_unicode_preserved():
    obj = json.loads(read("dat"))
    obj["nodes"][1]["content"]["lines"][0] = "größe ✓ \u0001"
    text = S.serialize(obj)
    assert "größe ✓" in text and "\\u0001" in text
    assert S.parse(text)["nodes"][1]["content"]["lines"][0] == "größe ✓ \u0001"


def test_canonical_hashes_file_is_current():
    hashes = json.loads((FIX / "canonical-hashes.json").read_text())
    for rel, digest in hashes.items():
        assert hashlib.sha256((FIX / rel).read_bytes()).hexdigest() == digest
