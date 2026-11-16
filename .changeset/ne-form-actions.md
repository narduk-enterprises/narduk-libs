---
'@narduk-enterprises/narduk-shell': minor
'@narduk-enterprises/eslint-config': patch
'@narduk-enterprises/narduk-app-tools': patch
'@narduk-enterprises/create-narduk-app': patch
'@narduk-enterprises/libs-explorer': patch
---

narduk-shell: `NeFormActions`, the one action row of a form or dialog:
right-aligned, the primary last, Cancel to its left, a destructive action alone
at the far left in `#lead`; below 40rem it stacks full width with the primary on
top. `NeForm`'s save bar and `NeConfirmDialog`'s footer are now this row, so
both stack on a phone (the save bar's gap goes from 0.75rem to 0.5rem). The rule
is written down in the package's new `docs/DESIGN.md`. eslint-config and
narduk-app-tools know the new component name, and libs-explorer shows it.
