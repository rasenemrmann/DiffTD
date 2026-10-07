# Building `DiffTD.tox` (to be done inside TouchDesigner)

> **Status: not built yet.** TouchDesigner was not available while the rest of DiffTD was implemented, so no `.tox` exists and nothing below has been run in TouchDesigner. These steps are the recipe; building and testing it is tasks T020, T025, T026 and T054 in `specs/001-td-version-control/tasks.md`. Run `difftd/td/probe.py` first and correct anything below that the probe contradicts.

1. In `/project1` create a Base COMP named **DiffTD** (the name is in the default `exclude` list so it is never exported).
2. Custom parameters on a page "DiffTD":
   - `Packagefolder` (Folder): the path of this repository (the folder that contains `difftd/`).
   - `Exportnow` (Pulse), `Importsnapshot` (Pulse), `Snapshotfile` (String, repo-relative path such as `snapshots/project1/net1.json`).
3. Inside it, an **Execute DAT** `execute1` with the *Project Post Save* callback enabled and this content:

   ```python
   import sys
   _pkg = parent().par.Packagefolder.eval()
   if _pkg and _pkg not in sys.path:
       sys.path.insert(0, _pkg)
   from difftd.td import execute_callbacks as _cb

   def onProjectPostSave():
       _cb.onProjectPostSave()
   ```

4. A **Parameter Execute DAT** `parexec1` watching the Base COMP's `Exportnow` and `Importsnapshot` pulses:

   ```python
   from difftd.td import execute_callbacks as _cb

   def onPulse(par):
       _cb.onPulse(par)
   ```

5. A **Web Server DAT** `webserver1`: Address `127.0.0.1`, Port `9980` (same as `reloadPort` in `difftd.config.json`), Active on. Its callbacks DAT:

   ```python
   from difftd.td.webserver_callbacks import *
   ```

6. Save the component as `td/DiffTD.tox`. After saving, check:
   - `GET http://127.0.0.1:9980/health` answers `{"status":"ok",...}`
   - saving the project creates `snapshots/<project>/<comp>.json` next to the `.toe`.
7. Record what differed from this recipe in `specs/001-td-version-control/research.md` (R1, R5, R6, R13).
