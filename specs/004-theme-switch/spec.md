# Feature Specification: Switch Between Light and Dark Appearance

**Feature Branch**: `004-theme-switch`

**Created**: 2026-10-04

**Status**: Draft

**Input**: User description: "gerne noch die Möglichkeit zwischen hell und dunkel zu wechseln"

## Context

The comparison page currently follows the computer's light/dark setting and offers no way to change it. The user wants to choose the appearance in the page itself.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Choose light or dark in the page (Priority: P1)

The artist opens the page, finds an appearance control in the header, and switches between light and dark. The whole page changes at once, including the graph, details, dialogs and status markers.

**Why this priority**: It is the whole request.

**Independent Test**: Open the page, switch to the other appearance, and check that every visible area changed and stays readable, without reloading.

**Acceptance Scenarios**:

1. **Given** the page is shown in dark appearance, **When** the artist chooses light, **Then** the whole page, including an open comparison, switches immediately and nothing is reloaded or reset (selected versions, zoom, selected node stay).
2. **Given** the artist chose an appearance, **When** they reload the page or open it another day, **Then** the same appearance is shown.
3. **Given** the page is opened for the first time, **When** no choice was made yet, **Then** the appearance follows the computer's setting.
4. **Given** the artist chose "follow system", **When** the computer's setting changes, **Then** the page follows it without a reload.

---

### User Story 2 - Always reachable, always clear (Priority: P2)

The control is visible in the header in every mode, shows which appearance is active, can be operated with the keyboard, and has a text that says what it does in the page language.

**Independent Test**: Reach and operate the control by keyboard only; check its label in German and English; check it in each mode.

**Acceptance Scenarios**:

1. **Given** any mode of the page, **When** the page is shown, **Then** the appearance control is in the same place in the header.
2. **Given** keyboard-only use, **When** the artist tabs to the control and presses Enter or Space, **Then** the appearance changes and the new state is announced to assistive technology.
3. **Given** the page language is German or English, **When** the control is shown, **Then** its label and the names of the options are in that language.

---

### Edge Cases

- The browser cannot remember settings (private window, blocked storage): the choice still works for the current visit and the page falls back to the computer's setting next time, without an error message.
- Switching while a comparison is loading or a message is shown: the content does not move and no state is lost.
- Very first paint: the page does not flash the wrong appearance before applying the remembered choice.
- Printing or screenshots are not part of this feature.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The page MUST offer three choices: follow the computer's setting (default), light, and dark.
- **FR-002**: Choosing an option MUST change the appearance of the entire page immediately, without reloading and without losing the current selection, zoom, selected node or open comparison.
- **FR-003**: The chosen option MUST be remembered between visits on the same computer and browser; if it cannot be remembered, the page MUST silently use the computer's setting.
- **FR-004**: With "follow system" active, the page MUST follow later changes of the computer's setting live.
- **FR-005**: The control MUST be present in the header in every mode, show the active choice, and be operable by keyboard with a visible focus and an accessible name.
- **FR-006**: All text, status markers, graph elements and details MUST keep the required contrast in both appearances (text at least 4.5:1, borders and markers at least 3:1).
- **FR-007**: The control's texts MUST be available in German and English like the rest of the page.
- **FR-008**: Applying the remembered choice MUST NOT cause a visible flash of the other appearance on page load.

### Key Entities

- **Appearance preference**: One of system, light, dark; remembered per browser; default system.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: The appearance changes in under 100 ms and in a single step for the whole page, in a walk-through of all modes and states (empty, loading, ready, identical, error, helper missing): 0 areas left in the old appearance.
- **SC-002**: A remembered choice is applied on 100% of reloads with no visible flash of the other appearance in 10 consecutive reloads.
- **SC-003**: All text meets 4.5:1 contrast and all borders/markers 3:1 in both appearances (checked for every token pair).
- **SC-004**: The control can be reached and operated using only the keyboard in every mode.
- **SC-005**: Switching during an open comparison keeps the selected versions, zoom and selected node in 100% of tested cases.

## Assumptions

- The two appearances already exist and are correct (feature 003); this feature adds choosing and remembering, not new colors.
- A single control with three choices is enough; no per-mode or scheduled switching.
- The preference is stored only in the user's own browser; nothing is sent to the helper.
- The browser's own remembered-settings storage is acceptable for this; users who block it get the system default.
