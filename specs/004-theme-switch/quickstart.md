# Quickstart: Validating the appearance switch

```sh
python3 -m difftd serve --open
```

1. First visit (no choice yet): the page follows the computer's setting.
2. Header: choose **Dark**, then **Light**. Everything changes at once; with a comparison open the selected versions, zoom and selected node stay.
3. Reload: the choice is kept, with no flash of the other appearance (reload ten times).
4. Choose **System**, change the computer's appearance: the page follows without reload.
5. Keyboard: Tab to the control, Enter or Space changes it.
6. German and English labels; narrow window (400 px); each mode (compare, two snapshot files, Git history, merge review).
7. Block site storage in the browser: the choice still works for this visit, the next visit uses the system setting, no error.

## Verification log

Run on 2026-10-04 in Chromium (Playwright tools), system appearance emulated:

| Step | Result |
|------|--------|
| 1 First visit | PASS: no choice stored → follows the (emulated) dark system, control shows "System" active |
| 2 Switch with an open comparison | PASS: choosing Light while the system is dark changed header, sidebar, canvas, drawer, node fills and text at once (0.7 ms for the attribute change); selected versions, selected node, zoom and node count unchanged; `color-scheme` follows |
| 3 Reload | PASS: stored choice applied (Light while system dark); the inline script runs before the stylesheet link (test), so no flash by construction. Ten visual reloads were not filmed |
| 4 System follow | PASS: with "System" chosen, emulated system change dark→light→dark switched the page live without reload |
| 5 Keyboard | PASS: Space on the focused button switched to Dark, `aria-pressed` updated; the focus ring was clipped by the segmented control and is now drawn inside the buttons (fixed, not re-screenshotted) |
| 6 Language, narrow width, modes | PASS: German labels (Darstellung / System / Hell / Dunkel; English keys tested for presence), control at the same header position in all four modes, 400 px: header wraps to two rows, no horizontal scroll. Also fixed: toolbar buttons overflowing at 400 px, empty bordered panel in merge mode before a folder is chosen |
| 7 Blocked storage | PASS (simulated by making `setItem` throw): the choice applies for the visit, no error raised |

