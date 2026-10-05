---
'@narduk-enterprises/narduk-shell': minor
'@narduk-enterprises/create-narduk-app': patch
'@narduk-enterprises/libs-explorer': patch
---

Add the shared Cmd/Ctrl+K search palette: `NeCommandPalette` and
`NeCommandPaletteTrigger`, with `useCommandPalette()`,
`useCommandPaletteShortcuts()` and `createSharedSearch()` auto-imported.

An app hands the palette groups (a fixed list, a function of the query, or an
async `search(query, { signal })` provider) and gets Cmd/Ctrl+K and "/"
shortcuts, grouped results with an icon, a secondary line, a status badge and
row actions, keyboard navigation, recent items, a debounced provider runner
that cancels and drops stale answers, an empty state, a failed-provider state
that is not mistaken for "no matches", a full-screen sheet on a phone and
accessible dialog, combobox and listbox semantics on a native `<dialog>`. The
trigger is small and stays in the first bundle; the palette mounts lazily
behind `useCommandPalette().armed`.

New apps pin the `@narduk-enterprises/narduk-shell` release that carries it.
The libs-explorer gains the two components' demo pages.
