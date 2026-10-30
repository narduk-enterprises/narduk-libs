---
'@narduk-enterprises/narduk-app-tools': patch
---

`performance-budget` measures inlined CSS. With Nuxt's `features.inlineStyles`, the client build emits no `.css`, so the check failed with "No built CSS files found". It now reads the CSS that the SSR `*-styles.*.mjs` chunks inline into the HTML and gzip-measures it against the same CSS budget. It reports a missing build only when there is neither a CSS file nor an inline-style chunk. `checked.inlineCssChunks` counts the chunks, and they are included in `checked.cssFiles` (borderwaitstat-us#167).
