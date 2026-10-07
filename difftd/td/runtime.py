"""Glue between the pure DiffTD package and the live TouchDesigner session.

Imported only from inside TD. `build_runtime()` collects everything the exporter,
importer and reload code need from the running project.
"""

from pathlib import Path

from .. import config as config_mod


class TDApi:
    """The slice of the `td` module the importer needs."""

    def __init__(self, td_module):
        self._td = td_module
        self.ParMode = td_module.ParMode

    def resolve_type(self, name):
        return getattr(self._td, name, None)


class Runtime:
    def __init__(self, repo_root, config, project_comp, project_name, api):
        self.repo_root = repo_root
        self.config = config
        self.project_comp = project_comp
        self.project_name = project_name
        self.api = api


def build_runtime():
    import td  # noqa: PLC0415 - only available inside TouchDesigner

    repo_root = Path(td.project.folder)
    config = config_mod.load_config(repo_root)
    project_comp = td.op(config["projectRoot"])
    if project_comp is None:
        raise RuntimeError(f"projectRoot {config['projectRoot']} does not exist in this project")
    project_name = Path(td.project.name).stem
    return Runtime(repo_root, config, project_comp, project_name, TDApi(td))


def notify(message):
    """Show a short message in TD's status bar (best effort) and in the textport."""
    print(f"DiffTD: {message}")
    try:
        import td  # noqa: PLC0415

        td.ui.status = f"DiffTD: {message}"
    except Exception:  # noqa: BLE001
        pass
