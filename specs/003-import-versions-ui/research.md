# Research: Import Project Versions + Polished GUI

## R1. Sending a project file to the helper

- **Decision**: `POST /api/convert?sha256=<hex>&name=<file name>` with the raw bytes as body (`application/octet-stream`). The page first asks `GET /api/snapshot?sha256=<hex>`; a hit returns the converted networks without re-sending bytes. The helper checks that the body hashes to `sha256`, converts via `toeexpand` in a temporary directory (already how `toe.convert` works), keeps the result in an in-memory LRU (30 entries), and deletes the temporary files.
- **Rationale**: Content hash identifies a version independent of its name or location (dedupe, FR-006), makes repeated comparison instant, and avoids re-uploading. Raw body avoids multipart parsing code.
- **Alternatives**: multipart form (more code, no benefit); base64 JSON (+33% size); the page reading files by path (needs the helper to read the user's disk — what feature 002 does and this feature wants to avoid).

## R2. Protecting the upload endpoint

- **Decision**: Besides the existing localhost `Host` check: POST requires the header `X-DiffTD: 1` (forces a CORS preflight for any other origin, which the helper never answers positively) and, when an `Origin` header exists, it must equal `http://<Host>`. `Content-Length` above 200 MB → 413 before reading. Only `.toe`/`.tox` names are accepted. The sha256 must match the body.
- **Rationale**: A web page on another site must not be able to make the helper run `toeexpand` on arbitrary bytes. These checks are cheap and standard for localhost tools.
- **Alternatives**: random token printed at start and required in a header (stronger, but the page would have to be opened with it); not worth it for a read-only converter bound to localhost.

## R3. Folder import and re-opening

- **Decision**: `showDirectoryPicker({ mode: 'read' })`, walk the folder and one level of sub-folders, keep entries with `.toe`/`.tox`, ignore hidden names. The directory handle is stored in IndexedDB; on the next visit a "Re-open <folder>" button calls `queryPermission`/`requestPermission`. "Refresh" rescans the same handle.
- **Rationale**: Matches FR-001, FR-004, FR-005 and the user's request ("einen Ordner importieren"). File System Access handles are storable in IndexedDB in Chromium.
- **Alternatives**: `<input webkitdirectory>` (works in more browsers, but no handle to refresh or re-open, and lists every file in the tree); kept as the fallback for browsers without `showDirectoryPicker` is not planned — upload covers them.

## R4. Add files / drop

- **Decision**: A visible "Add files" button (`<input type=file multiple accept=".toe,.tox">`) and a page-wide drop target with a clear overlay. Dropped folders are expanded when the browser provides entries (Chromium), otherwise files only.
- **Rationale**: FR-002; works in every supported browser.

## R5. Version list and selection

- **Decision**: A sidebar list sorted by modification time (newest first, ties by natural name order). Each item shows name, folder (if known), date, size and the two assignment buttons "Older" / "Newer"; the current pair is shown above the canvas with a Swap button. Default pair: the two newest. A filter box narrows by name.
- **Rationale**: Selecting from one list is faster and clearer than two long drop-downs that repeat the same entries; scales to 50 versions (FR-012). The two-select layout is what looked uneven in the screenshot.
- **Alternatives**: keep two selects (rejected: repeated long labels, misalignment); drag to slots (more effort, poor keyboard story).

## R6. View-state model (why the page looked "wobbly")

- **Findings from the screenshot and code**:
  1. A failed refresh showed the "needs the helper" message while the old list stayed (stale state).
  2. Messages are inserted above the content, so the controls jump.
  3. Selects, buttons and labels have different heights and baselines; native file inputs show system-language text.
  4. The graph box has a fixed height and shrinks wide networks to unreadable text.
  5. All four modes have equal weight in the header.
  6. "Reading project files…" is a banner that flashes.
- **Decision**: A pure reducer `state.js` with exactly these phases: `helper-missing`, `empty`, `loading`, `ready`, `identical`, `error`. The comparison area renders only the current phase; a status area with reserved height holds short messages; errors that concern one file attach to that file's list item. Transitions drop the old result before showing a new phase (or mark it "outdated" during `loading`).
- **Rationale**: Makes "one coherent state at a time" (FR-014) true by construction and testable without a browser.

## R7. Layout and visual design

- **Decision**: App shell as CSS grid: header (brand, helper status pill, main nav, theme follows system) / sidebar (versions) / main (pair bar, toolbar, canvas filling remaining height) / detail drawer (right, collapsible below ~1100 px). Spacing scale 4-8-12-16-24, one control height (34 px), one radius, system font stack with tabular numbers for dates, tokens for light/dark, `prefers-reduced-motion` respected, visible focus ring, status never by color alone. Secondary modes (Two files, Git repository, Resolve merge) move into a "More" menu in the header.
- **Rationale**: Directly addresses FR-015–FR-019. Visual direction is chosen during implementation with the project's `frontend-design` guidance; this plan fixes structure and invariants, not pixels.
- **Alternatives**: introduce a UI framework (rejected: build step and dependency for a small tool; constitution favors simplicity).

## R8. Graph readability

- **Decision**: Default "Fit changes" (zoom to the changed nodes plus context) when a comparison has changes, "Fit all" otherwise; both reachable from the toolbar, plus zoom ± and mouse wheel as now. Minimum node text size of 11 px at fit; if fitting everything would go below, fit changes instead. "Hide unchanged" stays.
- **Rationale**: In the screenshot case (wide network, one changed node) fit-all makes text unreadable. FR-017.

## R9. Language

- **Decision**: A small string table (`de`, `en`) chosen from `navigator.language`, with `en` fallback; a test asserts both tables have identical keys. Parameter names, node names and values are never translated.
- **Rationale**: The user works in German; FR-016 "where practical". Tiny cost.

## R10. Helper without a folder

- **Decision**: `python3 -m difftd serve` works with no folder; `/api/versions` then returns `{folder: null, versions: []}`; `/api/info` adds `uploadLimitBytes`. With a folder it behaves as in feature 002 and those versions appear in the same list as a third source.
- **Rationale**: FR-008, FR-013.

## R11. Testing the interface

- **Decision**: Pure modules are unit-tested; the shell is checked in a real Chromium through the Playwright tools using a written walk-through (empty, loading, helper stopped, damaged file, identical, large network, narrow/wide, dark/light, keyboard) recorded in the quickstart log. No browser test framework is added.
- **Rationale**: Keeps the repository dependency-free; the walk-through still catches the problems that prompted this work. A scripted e2e suite is a possible later addition.

## R12. Visual direction (task T022)

Subject: people who build node networks in TouchDesigner and want to see what changed between saved versions. Job of the page: make the changed nodes obvious in a network that looks like the one in the editor.

- **Concept**: a workbench. The network canvas is the hero; chrome is flat and quiet (1 px lines, no shadows except the slide-over drawer).
- **The one memorable element**: the version list is a **timeline rail**. Each version is a dot on a vertical line; "older" is a ring, "newer" a filled dot, and the span between them is highlighted. It encodes real information (order in time) and replaces the two repeated drop-downs.
- **Color** (dark is primary because the audience works in dark editors; a light set exists): graphite `#202225`, slate `#2a2d31`, line `#3a3e44`, chalk `#e6e8eb`, selection blue `#4c8dff`; status added `#3fb97a`, removed `#f0716b`, changed `#e8b04a` (light set darker for contrast). Status is always also a glyph (+, −, ~) and an outline style, never color alone. Operator families (TOP, CHOP, SOP, DAT, MAT, COMP) appear as small dots like in TouchDesigner.
- **Type**: system font stack (works offline, no font download), weights 400/500/600, sentence case, tabular numerals for dates and sizes. Monospace only for real code-like content: parameter values, expressions, paths, the start command.
- **Layout**: header / status bar of reserved height / [sidebar | workspace(pair bar, toolbar, canvas + drawer)]. Chrome left-aligned; empty and error states centered in the canvas as an invitation to act.
- **Rejected as generic**: card grids with shadows, uppercase eyebrow labels, dot-joined meta strings (replaced by separate aligned fields), arrows on buttons, gradient washes, scattered entrance animations (only drag-over overlay and state fades).
