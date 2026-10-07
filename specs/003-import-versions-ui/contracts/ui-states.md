# Contract: Interface states and invariants (feature 003)

## Layout invariants (checkable)

1. The header, sidebar, pair bar and toolbar keep their position and size in every state; only the comparison area's content changes.
2. Status messages appear in the status area (reserved height) or as a toast overlay; they never push content.
3. The comparison area fills the window height below the pair bar; the page itself does not scroll vertically at ≥ 720 px height with a loaded comparison.
4. At widths ≥ 1100 px the detail drawer is docked on the right; below it becomes a slide-over opened by selecting a node. At ≥ 360 px nothing is cut off horizontally.
5. All interactive controls share one height (34 px) and aligned baselines; labels sit above fields consistently or are placed inline, never mixed in one row.

## State table

| State | Comparison area content | Primary action | Status area |
|-------|------------------------|----------------|-------------|
| `helper-missing` | "The helper is not running" + the command in a copyable field | Try again | "Not connected" pill in header |
| `empty` | Drop zone with "Import folder" and "Add files" | Import folder | "Connected" |
| `loading` | Skeleton of the graph + "Reading <file>…" (progress per file) | — (Cancel not required) | "Reading…" |
| `ready` | Graph (fit to changes) + counts + legend | — | "N changes" |
| `identical` | "No differences" with a short explanation | Swap / choose other pair | "Identical" |
| `error` | Cause, file name, what to try | Choose other version | error text |

## Accessibility

- Every control reachable by Tab in reading order: header → sidebar (filter, buttons per item) → pair bar → toolbar → canvas nodes → drawer.
- Visible focus ring on every control; nodes are buttons with an accessible name `name, type, status`.
- Contrast ≥ 4.5:1 for text, ≥ 3:1 for node borders and status markers; status also by glyph/outline pattern (+, −, ~, dashed).
- `prefers-reduced-motion`: no animated transitions beyond opacity.
- Light and dark follow the system setting.

## Texts

All user-facing strings come from `i18n.js` (`de`, `en`). A test asserts both languages define the same keys.
