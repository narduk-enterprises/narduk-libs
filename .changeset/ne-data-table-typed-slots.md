---
'@narduk-enterprises/narduk-shell': patch
'@narduk-enterprises/create-narduk-app': patch
---

`NeDataTable` now declares its slots (narduk-libs#780). A consumer's `<template #status-cell="{ row }">` type-checks under `vue-tsc` / `nuxt typecheck`, and `row` is the table's own row type, so the local typed wrapper apps wrote to get past TS2339/TS7053 can be deleted. The slot shape is exported as `NeDataTableSlots<T>` (with `NeDataTableCellSlotProps`, `NeDataTableGroupSlotProps` and `NeDataTableBreakSlotProps`) for a wrapper that forwards them.
