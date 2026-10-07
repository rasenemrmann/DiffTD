# Tasks: Switch Between Light and Dark Appearance

**Tests**: included (pure logic and the inline script); the visual result is checked in a real browser.

## Phase 1: Foundation

- [X] T001 Implement `viewer/src/theme.js`: `parsePreference(value)` (unknown → `system`), `resolveTheme(pref, systemDark)`, `loadPreference(storage)` / `savePreference(pref, storage)` (all storage errors swallowed), `applyTheme(root, pref, systemDark)` (sets `data-theme` to the resolved value and `data-theme-pref` to the choice)
- [X] T002 [P] Add the keys `theme.label`, `theme.system`, `theme.light`, `theme.dark` to `viewer/src/i18n.js` (de + en)
- [X] T003 [P] Write `tests/js/theme.test.js`: parsing, resolving for all 6 combinations, storage failing on read and on write, apply sets both attributes, changing the system setting only matters for `system`

## Phase 2: User Story 1 - Choose light or dark (P1) 🎯 MVP

**Independent test**: switch in the page; everything changes at once without reload, state kept; reload keeps the choice.

- [X] T004 [US1] Restructure `viewer/src/style.css`: dark tokens stay the base, the light tokens move into one `:root[data-theme="light"]` block (remove the media-query copy), `color-scheme` follows the attribute
- [X] T005 [US1] Add the inline script to `viewer/index.html` `<head>` before the stylesheet link (+ `<meta name="color-scheme" content="dark light">`) and the control container in the header
- [X] T006 [US1] Implement `mountThemeControl(container)` in `viewer/src/theme.js` (three `aria-pressed` buttons, group label, live follow of `matchMedia` while `system`) and mount it from `viewer/src/app.js`
- [X] T007 [US1] Extend `tests/js/theme.test.js`: run the inline script of `index.html` in a `vm` with fake `localStorage`/`matchMedia` for all combinations and compare with `resolveTheme`; assert the inline script comes before the stylesheet link
- [X] T008 [US1] Verify in Chromium: switch with an open comparison (versions, zoom, selected node unchanged), reload keeps the choice, `system` follows an emulated system change live

## Phase 3: User Story 2 - Always reachable, always clear (P2)

- [X] T009 [US2] Style the control and header tools (`viewer/src/style.css`): same place in every mode, visible focus, active choice distinguishable without color alone
- [X] T010 [US2] Verify keyboard operation (Tab, Enter/Space), German and English labels, the control in every mode, narrow width (400 px) and contrast of both appearances

## Phase 4: Polish

- [X] T011 [P] Update `README.md` and `viewer/README.md` (appearance control), tick the walk-through in `specs/004-theme-switch/quickstart.md`
- [X] T012 Run `pytest`, `npm test`, `sh tests/hooks/run.sh`; run `graphify update .`

## Dependencies

T001 → T006 → T008. T002, T003 parallel with T001. T004 and T005 before T008. US2 after US1.
