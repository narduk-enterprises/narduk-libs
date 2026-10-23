---
'@narduk-enterprises/narduk-shell': patch
---

Fix shell edge cases: `formatRelative` no longer reads 30 days as "this month"; `NeDataTable` prints a raw Date cell as an ISO instant; `useRowLimit` treats an undefined cap as no cap; `useCursorCollection` refuses reserved filter keys and checks its initial sort against `sortable`; `useCollection` stops its loop after disposal; client table sort pins `en-US`; `useTimeAgo` no longer rewrites a running clock on each join; `useUndoToast` swallows a throwing callback; `useConfirm` ignores a second Confirm click while running.
