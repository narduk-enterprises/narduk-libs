---
'@narduk-enterprises/narduk-shell': patch
---

Fix ponytail-5 shell findings: zone-less date-times read as UTC in every formatter (one shared `instantOf`), a typed collection search survives a page change inside its debounce, cursor collections keep a cleared sort and the URL cursor on back/forward, the command palette only assigns http(s) targets, `NeStatePanel` only links http(s) `unblocksHref`, prose links carry `noreferrer`, and CSV export neutralises formulas after leading whitespace.
