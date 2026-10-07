# Feature Specification: Import Project Versions in the Page (upload or folder)

**Feature Branch**: `003-import-versions-ui`

**Created**: 2026-10-04

**Status**: Draft

**Input**: User description: "wäre es aber nicht besser Older Version und Newer Version via ein Upload Button zu vergleichen? Oder einfach einen Ordner zu importieren in der Oberfläche, wo man dann auf older und newer version auswählen kann und vergleichen kann?" — plus, added at planning: "zusätzlich dazu auch die jetzige GUI noch mehr sophisticated machen, sieht noch teilweise komisch bzw. wackelig aus" (with a screenshot showing a stale "needs the local helper" message above a still-filled version list, and unevenly aligned controls).

## Context

Feature 002 compares saved TouchDesigner project versions, but the folder must be named in a terminal command when the helper is started. The user finds it simpler to hand the versions to the page itself: pick files with an upload button, or import a whole folder, then choose "older" and "newer" in the page.

## Clarifications

### Session 2026-10-04

- Q: Reading a project file needs TouchDesigner's native file reader, which a web page cannot run. Is it acceptable that a small local helper still has to be started once, as long as it needs no folder name? → A: Yes (default assumed, see Assumptions); the helper is started once without any path and the page does everything else.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Import a folder of versions in the page (Priority: P1)

The artist opens the comparison page, presses "Import folder", picks the folder with their saved project versions, and the page lists every project version in it. They choose "older" and "newer" from the lists and see the comparison. No folder name is typed anywhere.

**Why this priority**: This is the request: choosing the versions where the work happens, in the page.

**Independent Test**: Start the helper without a folder, open the page, import a folder containing three versions, pick two, and see their differences.

**Acceptance Scenarios**:

1. **Given** the page is open, **When** the artist imports a folder, **Then** all project files in it (and one level of sub-folders) are listed with name and date; other files are ignored.
2. **Given** a list of imported versions, **When** the artist picks any older and any newer version, **Then** the comparison is shown without further steps.
3. **Given** the folder content changed (a new save was added), **When** the artist presses "Refresh", **Then** the new version appears without importing the folder again.
4. **Given** the artist imported a folder before, **When** they open the page again, **Then** they can re-open the same folder with one click (permission is asked again by the browser if needed).

---

### User Story 2 - Add individual files with an upload button (Priority: P2)

The artist presses "Add files" (or drops files on the page) and selects one or more project files from anywhere, for example files received by e-mail. Those appear in the same lists and can be compared with imported ones.

**Why this priority**: Works in every browser and for files that are not together in one folder.

**Independent Test**: Add two project files from two different folders; compare them.

**Acceptance Scenarios**:

1. **Given** the page is open, **When** the artist adds two files, **Then** both appear in the older/newer lists.
2. **Given** a file was already added or is already part of an imported folder with identical content, **When** it is added again, **Then** it is not listed twice.
3. **Given** a file is not a project file or is damaged, **When** it is added, **Then** a message names the file and the problem, and the other versions stay usable.

---

### User Story 3 - Start once, nothing else on the command line (Priority: P3)

The artist starts the helper with one command that needs no folder, opens the page, and from then on only uses the page. If the helper is not running, the page says exactly what to run.

**Independent Test**: Start the helper with no arguments; import and compare without touching the terminal again. Stop the helper; the page explains what is missing.

**Acceptance Scenarios**:

1. **Given** the helper was started without a folder, **When** the page opens, **Then** it offers import/upload instead of a version list.
2. **Given** the helper is not running, **When** the page opens, **Then** it shows the one command to start it.
3. **Given** the helper was started with a folder (feature 002), **When** the page opens, **Then** that folder's versions are listed as before, and import/upload still work.

---

### User Story 4 - A calm, polished interface (Priority: P2)

The artist works in an interface that looks finished and stays still: controls are aligned and consistently styled, messages never push the content around, the page never shows leftovers from an earlier state, and every situation (nothing imported yet, loading, helper missing, file damaged, no differences) has a deliberate look.

**Why this priority**: The current page works but looks unfinished and "wobbly"; the artist will judge the tool by how it feels every day.

**Independent Test**: Go through the situations (empty, loading, helper stopped, damaged file, identical versions, large network) and check that the layout does not jump, nothing stale remains visible, and each state shows a clear message and next step.

**Acceptance Scenarios**:

1. **Given** the helper stops while a comparison is open, **When** the artist refreshes, **Then** the stale comparison is replaced by a clear "helper not running" state with the start command, not shown together with it.
2. **Given** any status or error message appears or disappears, **When** it does, **Then** the controls and the graph do not move.
3. **Given** a comparison is being prepared, **When** it takes more than a moment, **Then** a progress indication is shown in place, and the previous result is visibly marked as outdated or removed.
4. **Given** two identical versions, **When** compared, **Then** a clear "no differences" state is shown instead of an unexplained graph.
5. **Given** a narrow or very wide window, **When** the page is used, **Then** nothing is cut off or overlaps, and the graph uses the available height.
6. **Given** a keyboard-only user, **When** they use the page, **Then** every control can be reached and operated and shows a visible focus.
7. **Given** a dark or light system setting, **When** the page opens, **Then** colors, status markers and text stay readable in both.

---

### Edge Cases

- Many versions (50+): the lists stay usable (newest first, searchable by name).
- A very large project file: a clear size limit message instead of a hang.
- Same file name in different folders: both listed with their folder name.
- The browser does not support folder import: upload remains available and the page says so.
- The page is closed: imported versions are forgotten (nothing is stored on the helper's disk beyond temporary conversion).
- Files never leave the computer: the page only talks to the helper on the same machine.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The page MUST let the user import a folder and list all project versions in it (one level of sub-folders), newest first, with name, folder and date.
- **FR-002**: The page MUST let the user add individual project files by an upload button and by dropping files onto the page.
- **FR-003**: The page MUST let the user choose any listed version as "older" and any as "newer", and show the comparison immediately.
- **FR-004**: The page MUST list versions from all sources together (imported folder, uploaded files, and the helper's own folder if one was given).
- **FR-005**: The user MUST be able to refresh an imported folder to pick up new saves without importing it again.
- **FR-006**: Identical file content MUST be listed once and converted once.
- **FR-007**: Non-project files MUST be ignored when importing a folder; damaged or unsupported project files MUST produce a message naming the file without blocking others.
- **FR-008**: The helper MUST start without a folder argument and MUST accept project files sent by the page for conversion, only from the local machine.
- **FR-009**: Project files MUST NOT leave the computer and MUST NOT be stored by the helper after conversion.
- **FR-010**: If the helper is not reachable, the page MUST show the exact command to start it.
- **FR-011**: Folder import MUST be offered only where the browser supports it; file upload MUST work in all supported browsers.
- **FR-012**: The list MUST allow filtering by name, and show a clear message for oversized files.
- **FR-013**: The existing way of starting the helper with a folder (feature 002) MUST keep working.
- **FR-014**: The page MUST show exactly one coherent state at a time: empty, loading, ready, no differences, or error with its cause and next step; leftovers of a previous state MUST NOT remain visible.
- **FR-015**: Status and error messages MUST NOT change the position or size of the controls or the graph.
- **FR-016**: Controls MUST be consistently styled, aligned and labelled, in the user's language setting of the browser where practical, and operable by keyboard with visible focus.
- **FR-017**: The comparison view MUST use the available window height, keep text readable at the default zoom for typical networks, and show the helper connection status at all times.
- **FR-018**: Advanced modes (Git history, merge review, two loose snapshot files) MUST remain available but MUST NOT compete with the main "compare versions" flow for attention.
- **FR-019**: Colors and status markers MUST stay readable in light and dark appearance and MUST NOT rely on color alone.

### Key Entities

- **Version source**: Where a version came from: imported folder, uploaded file, or the helper's folder; identified by display name, origin folder (if known), size, date and content fingerprint.
- **Version list**: All known versions from all sources, de-duplicated by content.
- **Comparison selection**: The chosen older and newer version and the network being compared.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: From a freshly opened page, a user can import a folder and see a comparison of two versions in under 30 seconds, without typing a folder name.
- **SC-002**: Adding two files with the upload button and seeing their comparison takes under 20 seconds for typical projects (tens of nodes).
- **SC-003**: Re-adding or re-importing unchanged files does not add duplicate entries (0 duplicates in a test of 10 repeated imports).
- **SC-004**: With the helper stopped, 100% of attempts show the start command rather than an unexplained error.
- **SC-005**: No project file content is found on disk after conversion completes, other than the user's originals.
- **SC-006**: Across the tested situations (empty, loading, helper stopped, damaged file, identical versions, large network, narrow and wide window) there is no layout shift of the controls when messages change and no stale content visible: 0 violations in a checklist walk-through.
- **SC-007**: 100% of controls are reachable and operable by keyboard with a visible focus, and text meets a contrast ratio of at least 4.5:1 in both light and dark appearance.

## Assumptions

- Reading project files needs TouchDesigner's own file reader, which a web page cannot run; therefore the small local helper from feature 002 is still started once. Removing that step (for example with a double-click launcher) is out of scope here.
- Folder import relies on the browser's folder access (Chromium-based browsers); file upload works everywhere.
- The browser's own permission prompt is the consent step for reading an imported folder.
- Imported and uploaded versions exist only while the page is open; a restart of the helper or closing the page clears them, except that a previously imported folder can be re-opened with one click.
- A size limit of 200 MB per project file is reasonable for typical projects.
- Who made a change cannot be read from a project file (as in feature 002).
