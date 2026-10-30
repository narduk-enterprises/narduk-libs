---
'@narduk-enterprises/narduk-shell': minor
'@narduk-enterprises/eslint-config': patch
'@narduk-enterprises/narduk-app-tools': patch
'@narduk-enterprises/libs-explorer': patch
'@narduk-enterprises/create-narduk-app': patch
---

narduk-shell adds `NeBottomTabBar`, the phone's bottom navigation. Exactly one tab is lit: an exact path wins, then the longest prefix, then an optional `fallback`. `aria-current` is honest, safe-area padding is included, and a spacer plus `--ne-bottom-bar-h` keep content clear of the bar. `resolveBottomTabs` exposes the same lit-tab rule as a pure function. It replaces the hand-rolled tab bars in buoys, float-forecast, music, mybo-at-v2, riverstatus and operator-portal. eslint-config and narduk-app-tools register the new shared component name.
