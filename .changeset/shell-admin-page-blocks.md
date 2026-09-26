---
'@narduk-enterprises/narduk-shell': minor
'@narduk-enterprises/eslint-config': patch
'@narduk-enterprises/narduk-app-tools': patch
'@narduk-enterprises/libs-explorer': patch
'@narduk-enterprises/create-narduk-app': patch
---

Add the admin page blocks (components backlog item 20, narduk-libs#267):
`NeAdminListPage` (page header, search, filters slot, `NeDataTable` and
`NePager`, all reading and writing one `useCollection()`), `NeAdminDetailPage`
(`NeDetailView` under a page header, gated by `NeStatePanel`, with an optional
delete that asks through `useConfirm()` before `onDelete` runs) and
`NeAdminEditPage` (a sticky-save `NeForm` with a cancel action, held behind
`NeStatePanel` until the record has loaded). They compose the existing pieces
with no behaviour of their own. Their prop types are exported from the package
root.

The eslint-config and narduk-app-tools shared-component lists name the three so
the drift and item-13 tests match `narduk-shell`'s registry. Explorer inventory,
catalog and usage ship beside the components.

`create-narduk-app` takes the patch because it pins `narduk-shell` in generated
apps; its `PACKAGE_VERSIONS` literal is not hand-edited. The generator's `admin`
capability scaffold is not part of this change.
