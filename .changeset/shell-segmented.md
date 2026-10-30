---
'@narduk-enterprises/narduk-shell': minor
'@narduk-enterprises/eslint-config': patch
'@narduk-enterprises/narduk-app-tools': patch
'@narduk-enterprises/libs-explorer': patch
'@narduk-enterprises/create-narduk-app': patch
---

narduk-shell adds `NeSegmented`, a control for picking one of a few options. It is a radiogroup with roving focus and keyboard support: arrow keys, Home and End move the choice and skip disabled segments. Disabled segments stay visible and show their reason. It has `track` and `chips` variants and `fill`, `scroll` and `wrap` layouts, and its tap targets are 44px on a phone. It replaces the hand-rolled segmented controls in austin-rising-runners, stonx and narduk-farm. eslint-config and narduk-app-tools register the new shared component name.
