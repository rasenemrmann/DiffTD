# Feature Specification: Compare TouchDesigner Project Versions (no TouchDesigner needed)

**Feature Branch**: `002-toe-version-compare`

**Created**: 2026-10-03

**Status**: Implemented (see tasks.md). Superseded as the main entry point by feature 003 (import folder / add files in the page, polished interface); the folder argument described here still works.

**Input**: User description: "Ich speichere mein TouchDesigner-Projekt als mehrere Versionen lokal (5–6 Dateien) und muss zum Vergleichen mehrere TouchDesigner-Instanzen offen haben, was den Laptop auslastet. Ich möchte eine GUI, in der ich einfach zwei Versionen vergleiche und sehe, wo innerhalb des Projekts Änderungen entstanden sind – Git Best Practices, aber auf TouchDesigner-Ebene."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Compare any two saved versions of my project (Priority: P1)

An artist keeps several saved versions of one project in a folder. They start one command, open the page it prints, pick an older and a newer version, and see the network drawn like in the TouchDesigner editor, with added, removed and changed nodes marked. TouchDesigner is not running.

**Why this priority**: This is the whole problem: today they open every version in its own TouchDesigner instance.

**Independent Test**: Put two versions of a project in a folder that differ by one changed parameter, one added node and one moved node. Compare them. Exactly these three differences are shown.

**Acceptance Scenarios**:

1. **Given** a folder with several `.toe` versions, **When** the artist opens the comparison page, **Then** the versions are listed newest first and the two newest are compared automatically.
2. **Given** a changed parameter, **When** the artist clicks the node, **Then** the old and new value are shown.
3. **Given** an added or removed node, **When** the comparison is shown, **Then** it is marked as added or removed at its position from the project.
4. **Given** a node that was only moved, **When** the comparison is shown, **Then** it is not marked as changed, but its detail says it was moved.
5. **Given** the artist picks another pair of versions, **When** they change the selection, **Then** the comparison updates without restarting anything.
6. **Given** a subnetwork (container) with changes inside, **When** shown at its parent level, **Then** the container shows how many changes it contains and can be opened.

---

### User Story 2 - See what changed inside scripts and tables (Priority: P2)

The artist sees changed lines of text DATs (scripts) and changed cells of table DATs, because that is where much of the real work in a project happens.

**Independent Test**: Edit a script line and a table cell between two versions; both appear in the node details.

**Acceptance Scenarios**:

1. **Given** a changed text DAT, **When** the node is opened, **Then** the removed and added lines are shown.
2. **Given** a changed table cell, **When** the node is opened, **Then** the row, column, old and new value are shown.

---

### User Story 3 - Work with large and imperfect folders (Priority: P3)

The folder may contain TouchDesigner backup and crash-recovery files, empty files, and non-project files.

**Acceptance Scenarios**:

1. **Given** a folder with non-project files and hidden files, **When** the list is built, **Then** only `.toe` and `.tox` files are shown.
2. **Given** a damaged or empty project file, **When** it is selected, **Then** a clear message names the file and the problem, and the other versions stay usable.
3. **Given** TouchDesigner is not installed on the machine, **When** the page is opened, **Then** it explains what is missing and how to point to it.

---

### Edge Cases

- Re-comparing the same pair is instant (no repeated conversion while the file is unchanged).
- A file replaced with a new save is read again.
- Projects with several top-level networks: the artist chooses the network; each shows its change count.
- Expressions that contain time-dependent values do not produce changes on their own.
- Editor state (which node is selected, panel zoom) never counts as a change.
- Only files below the chosen folder can be read; the page is reachable from this computer only.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST read `.toe` and `.tox` files without opening TouchDesigner's user interface.
- **FR-002**: System MUST list the project versions in a chosen folder, newest first, and let the user choose any two.
- **FR-003**: System MUST show the network with the positions and sizes it has in TouchDesigner, and fall back to an automatic layout when positions are unknown.
- **FR-004**: System MUST mark nodes and connections as added, removed, changed or unchanged and show parameter differences per node.
- **FR-005**: System MUST show text DAT line differences and table DAT cell differences.
- **FR-006**: A moved node MUST NOT count as changed; the move MUST be shown in the node detail.
- **FR-007**: Node selection state and other editor-only state MUST NOT count as changes; the evaluated value of an expression parameter MUST NOT count as a change, only the expression itself.
- **FR-008**: System MUST allow drilling into sub-networks and show the number of changes inside each.
- **FR-009**: System MUST give a clear message when a file cannot be read or TouchDesigner's file reader is missing, without affecting other versions.
- **FR-010**: System MUST serve only localhost and only files below the chosen folder.
- **FR-011**: System MUST also offer a command that converts one project file to the snapshot format used by the viewer's file mode.
- **FR-012**: The snapshot format (feature 001) MUST stay the single format; node position is added as an optional, display-only field.

### Key Entities

- **Project version**: A saved `.toe`/`.tox` file in the chosen folder, identified by its path, size and modification time.
- **Network**: A top-level node of a project (for example `project1`) with everything inside it; one is compared at a time.
- **Snapshot**: As in feature 001, with the optional node layout.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Comparing two versions needs no running TouchDesigner instance.
- **SC-002**: After starting the helper, the first comparison appears within 10 seconds for a typical project (tens of nodes) and a repeated comparison of the same pair within 1 second.
- **SC-003**: In a test pair with one changed parameter, one added node and one moved node, exactly the changed and added node are marked changed/added, the move is reported, and nothing else is marked.
- **SC-004**: The artist finds which node changed and what its old and new value were in under 1 minute.

## Assumptions

- TouchDesigner is installed on the same machine (its file reader ships with it); users do not need it to be running.
- Only parameters that differ from the default are stored in project files, so unchanged defaults are not shown; a parameter back at its default shows as removed.
- Who made a change cannot be read from a project file; it can only be derived from version control (feature 001) or from file names/dates.
- Projects are compared one network at a time; comparing a version against itself shows no differences.
- Windows is expected to work (file reader location is searched) but was not tested.
