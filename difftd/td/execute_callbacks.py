"""Callbacks for the Execute DAT / Parameter Execute DAT inside the DiffTD component.

Execute DAT:           onProjectPostSave  -> export all top-level COMPs
Parameter Execute DAT: onPulse            -> manual export / manual import
All entry points swallow exceptions: a DiffTD problem must never block saving.
"""

from .. import exporter, importer, snapshot
from ..store import Store
from .runtime import build_runtime, notify


def export_now():
    try:
        rt = build_runtime()
        results = exporter.export_project(rt.project_comp, rt.project_name, rt.repo_root, rt.config)
    except Exception as exc:  # noqa: BLE001
        notify(f"export failed: {exc}")
        return []
    errors = [r for r in results if r["status"] == "error"]
    written = [r for r in results if r["status"] == "written"]
    if errors:
        notify(f"export failed for {', '.join(r['root'] for r in errors)} (see .difftd/log.txt)")
    else:
        notify(f"exported {len(written)} changed, {len(results) - len(written)} unchanged")
    return results


def import_now(rel_file):
    """Import one snapshot file (path relative to the repo root) into its root COMP."""
    try:
        rt = build_runtime()
        store = Store(rt.repo_root)
        snap = snapshot.parse(store.read_text(rel_file))
        report = importer.import_root(rt.project_comp, snap, rt.api, log=store.log)
        notify(
            f"imported {snap['meta']['root']}: {len(report['skippedNodes'])} nodes and "
            f"{len(report['skippedParams'])} parameters skipped"
        )
        return report
    except Exception as exc:  # noqa: BLE001
        notify(f"import failed: {exc}")
        return None


def onProjectPostSave():
    try:
        rt = build_runtime()
        if not rt.config["exportOnSave"]:
            return
    except Exception as exc:  # noqa: BLE001
        notify(f"export skipped: {exc}")
        return
    export_now()


def onPulse(par):
    if par.name == "Exportnow":
        export_now()
    elif par.name == "Importsnapshot":
        import_now(par.owner.par.Snapshotfile.eval())
