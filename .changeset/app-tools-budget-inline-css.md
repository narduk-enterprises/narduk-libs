---
'@narduk-enterprises/narduk-app-tools': patch
---

`performance-budget` measures inlined CSS. With Nuxt's `features.inlineStyles`, the client build emits no `.css`, so the check failed with "No built CSS files found". When a build has no client CSS, the check now parses the CSS that the SSR `.output/server/chunks/build/*-styles.<hash>.mjs` chunks inline into the HTML, without loading or evaluating them, and gzip-measures it against the same CSS budget. A chunk it cannot parse fails as `metric: 'unreadable'`. It reports a missing build only when there is neither a CSS file nor an inline-style chunk. `checked.inlineCssChunks` counts the chunks, and they are included in `checked.cssFiles` (borderwaitstat-us#167).
