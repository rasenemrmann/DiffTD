import pytest

from difftd import cli, server


@pytest.fixture
def recorded(monkeypatch):
    calls = []
    monkeypatch.setattr(server, "serve", lambda *a, **k: calls.append((a, k)))
    return calls


def test_serve_needs_no_folder(recorded):
    cli.main(["serve"])
    (args, _), = recorded
    assert args[0] is None and args[1] == 8080 and args[2] is False


def test_serve_with_folder_port_and_open(recorded):
    cli.main(["--toeexpand", "/x/toeexpand", "serve", "/some/folder", "--port", "9001", "--open"])
    (args, _), = recorded
    assert args == ("/some/folder", 9001, True, "/x/toeexpand")


def test_serve_without_folder_has_no_versions_and_refuses_file_access(tmp_path):
    library = server.Library(None)
    assert library.versions() == []
    with pytest.raises(FileNotFoundError, match="import or add files"):
        library.snapshots("x.toe")


def test_help_mentions_the_optional_folder(capsys):
    with pytest.raises(SystemExit):
        cli.main(["serve", "--help"])
    assert "optional" in capsys.readouterr().out
