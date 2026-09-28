---
'@narduk-enterprises/eslint-config': patch
'@narduk-enterprises/narduk-shell': patch
---

`narduk/require-client-only-hydration-sensitive` no longer flags `UNavigationMenu`: it reads no localStorage or matchMedia state, and its active item comes from the route, which matches on server and client. It may server-render, as NeAppShell's rail does. The `UColorMode*` controls are still required to be in `<ClientOnly>`.
