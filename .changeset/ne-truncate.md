---
'@narduk-enterprises/narduk-shell': minor
'@narduk-enterprises/eslint-config': patch
'@narduk-enterprises/narduk-app-tools': patch
---

Add `NeTruncate`, middle truncation for long URLs, paths and ids (head shrinks with an ellipsis, tail stays whole, full value as text and tooltip, focusable and click-to-expand, SSR-safe), and its pure `splitTruncate` helper in the `./format` subpath. The shared-component lists in eslint-config and narduk-app-tools know the new name.
