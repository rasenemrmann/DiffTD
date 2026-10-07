# Implementation Plan: Switch Between Light and Dark Appearance

**Branch**: `004-theme-switch` | **Date**: 2026-10-04 | **Spec**: [spec.md](spec.md)

## Summary

A three-way appearance control (System, Light, Dark) in the header. The resolved appearance is written as `data-theme="light|dark"` on the root element; the stylesheet has the dark tokens as base and one `:root[data-theme="light"]` block. A tiny inline script in `<head>` sets the attribute before the first paint (no flash); `viewer/src/theme.js` holds the testable logic, remembers the choice in `localStorage` (failures ignored) and follows the system setting live when "System" is chosen.

## Technical Context

**Language/Version**: JavaScript ES2022 modules, CSS custom properties. **Dependencies**: none. **Storage**: `localStorage` key `opdiff.theme`, values `system | light | dark`; any failure → system. **Testing**: `node --test` for `theme.js` and for the inline script (run in a `vm` with fake `localStorage`/`matchMedia`, compared with `resolveTheme`), real-browser walk-through with the Playwright tools. **Constraints**: no reload, no state loss, no flash, contrast unchanged (≥ 4.5:1 text, ≥ 3:1 borders).

## Constitution Check

Principles I–V concern snapshots and import: unaffected. Technical constraints: viewer stays static and backend-free; nothing is sent to the helper. PASS, no violations.

## Design decisions

1. **Always write a resolved value** (`light`/`dark`) to the root, never rely on the media query in CSS. Rationale: one light token block instead of two copies (media query + attribute); "System" is handled in JS with `matchMedia(...).addEventListener('change')`.
2. **Inline script before the stylesheet** applies the stored/system value synchronously. Rationale: module scripts run after first paint. The script is covered by a test that executes it against `resolveTheme` for all combinations so the two cannot drift.
3. **Segmented control** with three text buttons (`aria-pressed`) in a labelled group, right side of the header next to the connection pill. Rationale: shows the active choice at a glance, keyboard-operable, no menu to open for a one-click action.
4. **`color-scheme`** follows the resolved value so scrollbars and native controls match.
5. **Texts** via `i18n.js` (`theme.label`, `theme.system`, `theme.light`, `theme.dark`).

## Project Structure (changes)

```text
viewer/index.html          # inline theme script in <head> before the stylesheet; control container in the header
viewer/src/theme.js        # parsePreference, resolveTheme, load/save preference, applyTheme, mountThemeControl
viewer/src/style.css       # light tokens move to :root[data-theme="light"]; header tools layout; control styling
viewer/src/app.js          # mount the control
viewer/src/i18n.js         # four new keys
tests/js/theme.test.js     # pure logic + inline-script equivalence + ordering in index.html
```
