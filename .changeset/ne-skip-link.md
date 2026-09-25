---
'@narduk-enterprises/narduk-shell': minor
'@narduk-enterprises/create-narduk-app': patch
---

Add `NeSkipLink` and `NE_MAIN_ID` (narduk-libs#977). `NeSkipLink` is a plain
`<a href="#main-content">`, never a RouterLink, that moves keyboard focus to its
target when followed: it adds `tabindex="-1"` to a target with no tabindex, keeps
one it already has, and leaves native fragment navigation alone. It is hidden
until focused and styled from the NE tokens. `NE_MAIN_ID` (`'main-content'`) is
its default target, auto-imported by the module for `<main :id="NE_MAIN_ID">`
and exported from the package root. `NeAppShell`'s own skip link is now an
`NeSkipLink`, so following it moves focus into the shell's `<main>`.
