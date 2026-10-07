# Feature Specification: TouchDesigner Version Control (DiffTD)

**Feature Branch**: `001-td-version-control`

**Created**: 2026-10-03

**Status**: Draft

**Input**: User description: "alles umsetzen bzw den plan für die TD Diff applikation" (implement the full plan from "TouchDesigner Versionskontrolle – Plan")

## Clarifications

### Session 2026-10-03

- Q: Which parameters does a snapshot capture? → A: All parameters with all values, including defaults
- Q: Where does the viewer read commits from? → A: Local project folder, access granted by the user; viewer reads repo history directly (no server, Chromium browsers only)
- Q: What happens to unsaved changes when an automatic reload hits? → A: Unsaved edits in affected containers are exported to a backup snapshot first, then reload proceeds and the user is notified
- Q: What is a "conflicting item" the artist resolves in a merge? → A: Per parameter, plus per node and connection for add/remove clashes (including edit-vs-delete); non-clashing changes in the same node merge automatically
- Q: Does a snapshot include DAT content (scripts, tables, text)? → A: Yes for text and table DATs; content is part of the snapshot, shown in the diff and restored on import

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Automatic text snapshots on save (Priority: P1)

A TouchDesigner artist saves their project as usual. Without any extra step, the network is written to human-readable, version-friendly snapshot files, one per top-level container, in a folder structure that mirrors the network hierarchy.

**Why this priority**: Without text snapshots nothing else works. This alone makes projects diffable in Git and is the MVP.

**Independent Test**: Build a small network, save the project, and check that snapshot files appear. Save again with no changes and confirm the files are byte-identical.

**Acceptance Scenarios**:

1. **Given** a project with two top-level containers, **When** the artist saves, **Then** one snapshot file per container exists, listing every node (path, type, parameters) and connection.
2. **Given** an unchanged project, **When** the artist saves twice, **Then** both exports are byte-identical.
3. **Given** one parameter was changed, **When** the artist saves, **Then** only that container's snapshot changes, and only on the lines for that parameter.
4. **Given** a manual export is requested, **When** triggered, **Then** the same snapshots are produced without a save.

---

### User Story 2 - Restore a network from a snapshot (Priority: P2)

An artist checks out an old version or receives a merged version and wants the live network rebuilt from the snapshot files.

**Why this priority**: Makes snapshots useful for rollback and collaboration, not just archival.

**Independent Test**: Export a network, import it into an empty project, export again, and compare snapshots.

**Acceptance Scenarios**:

1. **Given** a snapshot, **When** imported into an empty container, **Then** all nodes, parameter values and connections are recreated.
2. **Given** a snapshot containing an operator type not installed here, **When** imported, **Then** that node is skipped, a warning is logged, and the rest imports.
3. **Given** a snapshot with a parameter unknown to the node, **When** imported, **Then** that parameter is skipped and the import continues.
4. **Given** a snapshot with connections, **When** imported, **Then** connections are made only after all nodes exist, with none lost to ordering.

---

### User Story 3 - Visual diff of two versions (Priority: P3)

A reviewer opens a browser-based viewer, loads two snapshots (before/after), and sees the network graph with nodes and connections colored as added, removed, changed or unchanged. Clicking a node shows its parameter differences.

**Why this priority**: Core review value. A prototype exists for manual file upload; this story is to make it dependable on real exports.

**Independent Test**: Load two real exports differing by one added node and one changed parameter; verify colors and parameter details.

**Acceptance Scenarios**:

1. **Given** two snapshots, **When** loaded, **Then** the graph is laid out automatically and each node and connection is shown with its status.
2. **Given** a changed node, **When** clicked, **Then** old and new value of each differing parameter are shown, and for a DAT the changed lines of its content.
3. **Given** a malformed snapshot file, **When** loaded, **Then** a clear error names the problem and no partial graph is shown.

---

### User Story 4 - Compare commits directly (Priority: P4)

The reviewer picks two commits of the project repository in the viewer and sees the diff without exporting or uploading files by hand.

**Why this priority**: Removes the manual upload step that blocks everyday use.

**Independent Test**: Select two commits touching one container; verify the shown diff matches that container's change.

**Acceptance Scenarios**:

1. **Given** a repository with several commits and folder access granted, **When** the reviewer selects two, **Then** the diff for a chosen container is displayed.
2. **Given** a container added in the later commit, **When** compared, **Then** all its nodes show as added.

---

### User Story 5 - Automatic reload after Git operations (Priority: P5)

After pulling, checking out or merging, the running TouchDesigner project reloads the changed containers automatically.

**Why this priority**: Closes the loop so artists never touch Git internals or import manually.

**Independent Test**: Check out an older commit while the project is open; the network reflects that commit without manual steps.

**Acceptance Scenarios**:

1. **Given** a running project, **When** a checkout or merge changes snapshot files, **Then** the affected containers are rebuilt from them.
2. **Given** no running project, **When** a checkout occurs, **Then** the Git operation succeeds and the missing reload is reported as a notice, not an error.
3. **Given** unsaved edits in an affected container, **When** a reload is triggered, **Then** those edits are first written to a backup snapshot, the reload proceeds, and the user is told where the backup is.

---

### User Story 6 - Review and resolve merge conflicts (Priority: P6)

When two artists changed the same container, conflicts are shown in the viewer as a visual review (base, theirs, ours). The artist decides per conflicting item and the result is saved as the merged snapshot, then loaded into TouchDesigner.

**Why this priority**: Needed for real parallel work, but depends on all earlier stories.

**Independent Test**: Create two branches changing the same parameter differently, merge, and resolve in the viewer.

**Acceptance Scenarios**:

1. **Given** changes in different nodes, **When** merged, **Then** no manual review is needed.
2. **Given** both sides changed the same parameter, **When** reviewed, **Then** both values are shown and the artist picks one.
3. **Given** two sides changed different parameters of the same node, **When** merged, **Then** both changes are kept without review.
4. **Given** one side deleted a node the other side edited, **When** reviewed, **Then** the artist chooses to keep the edited node or delete it.
5. **Given** all conflicts resolved, **When** confirmed, **Then** the merged snapshot is written and loaded only after that explicit confirmation.

---

### Edge Cases

- Very large networks (thousands of nodes): export and diff must stay usable.
- Node renamed or moved: shown as removed plus added, since identity is the node path.
- DAT with very large content: stored as-is; the diff must stay responsive.
- Parameters with expressions or non-numeric values: preserved as written.
- Export fails mid-save: the previous snapshot stays intact and the save is not blocked.
- Snapshot written by a newer, unknown format version: refused with a clear message.
- Connections to nodes with multiple inputs/outputs: index preserved.
- Empty container: snapshot with no nodes, not an error.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST export a network as a text snapshot containing, for each node, its path, type and the values of all its parameters (built-in and custom, including default values), the content of text and table DATs, plus all connections.
- **FR-002**: System MUST produce byte-identical snapshots for an unchanged network (stable ordering, formatting).
- **FR-003**: System MUST write one snapshot file per top-level container, in a directory structure mirroring the network hierarchy.
- **FR-004**: System MUST export automatically on every project save, and MUST also offer a manual export action.
- **FR-005**: A failed export MUST NOT block or corrupt the project save or existing snapshots, and MUST report the failure.
- **FR-006**: System MUST use a single snapshot format shared by export, import and the viewer, including a format version.
- **FR-007**: System MUST rebuild a network from snapshots, creating all nodes before any connections.
- **FR-008**: Import MUST restore text and table DAT content, and MUST skip unknown operator types and unknown parameters with a logged warning and continue.
- **FR-009**: Exporting an imported network SHOULD reproduce the source snapshot; any differences MUST be documented.
- **FR-010**: The viewer MUST load two snapshots and show nodes and connections by status: added, removed, changed, unchanged.
- **FR-011**: The viewer MUST lay out the graph automatically and show per-parameter old/new values, and a line-based text diff of DAT content, on node selection.
- **FR-012**: The viewer MUST run fully client-side, with no server needed to view snapshots.
- **FR-013**: The viewer MUST load snapshots from two commits of a local repository, reading the project folder directly after the user grants access once per session, without manual file upload.
- **FR-014**: The viewer MUST reject malformed or unsupported snapshots with a clear error.
- **FR-015**: System MUST reload affected containers in a running project after checkout, pull or merge, and MUST NOT fail the Git operation if no project is running.
- **FR-016**: Before a reload overwrites a container with unsaved edits, System MUST write those edits to a backup snapshot and notify the user of its location.
- **FR-017**: System MUST support a conflict review showing base, ours and theirs per conflicting item, with the artist choosing the result per conflicting parameter, and per node or connection for add/remove clashes (including edit-vs-delete). Non-clashing changes within one node MUST merge automatically.
- **FR-018**: Merged results MUST be imported into the live project only after explicit user confirmation.
- **FR-019**: The binary project file MUST NOT be required in version control; archiving it is optional.
- **FR-020**: The viewer MUST NOT modify snapshots except through an explicit user action.

### Key Entities

- **Snapshot**: Text description of one top-level container's network, with format version and metadata (project, export time).
- **Node**: An operator identified by unique path; has type and parameters.
- **DAT Content**: Text or table content held by a DAT node, stored with the node and compared line by line.
- **Parameter**: Name-value pair (built-in or custom) belonging to a node; value always stored, even when default.
- **Connection**: Link from one node (optional output index) to another (optional input index).
- **Diff Result**: Per node, parameter and connection status (added, removed, changed, unchanged) between two snapshots.
- **Conflict**: A parameter, node or connection changed differently on both sides of a merge, holding base, ours, theirs and the chosen resolution.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Saving a project with 500 nodes adds no more than 2 seconds to the save.
- **SC-002**: 100% of repeated exports of an unchanged network are byte-identical.
- **SC-003**: Changing one parameter changes exactly one line in one snapshot file.
- **SC-004**: Export → import → export reproduces the original snapshot for 100% of test networks that use only installed operators.
- **SC-005**: A reviewer can see what changed between two commits in under 1 minute, without manual file handling.
- **SC-006**: Diffing two 1,000-node snapshots displays within 5 seconds.
- **SC-007**: After a checkout or merge, a running project reflects the new state within 10 seconds with no manual action.
- **SC-008**: In a test with two artists editing different nodes of one container, 100% of merges complete without manual conflict review.
- **SC-009**: A test group of artists resolves a deliberate same-parameter conflict on first attempt in at least 90% of trials.

## Assumptions

- Defaults chosen for the three open decisions in the source plan; each can be changed during clarification:
  - Export trigger: automatic on every save, plus manual action.
  - Granularity: one snapshot file per top-level container.
  - Binary project file: treated as a build artifact, not versioned by default; optional archiving via large-file storage.
- Users are TouchDesigner artists with basic familiarity with Git, working on local repositories.
- All parameters are captured with their values, including defaults; non-parameter state (e.g., node positions) is out of scope for v1.
- Node identity is its path; renames appear as remove plus add.
- Reload uses the project's own local communication channel to the running TouchDesigner instance.
- The existing viewer prototype is the starting point for the diff story.
- The viewer needs a browser that can grant read access to a local folder (Chromium-based); other browsers can still diff uploaded files.
- Hosted multi-user services and non-TouchDesigner tools are out of scope.
- Constitution v1.0.0 principles apply (single schema, deterministic export, text as source of truth, graceful import, review before import).
