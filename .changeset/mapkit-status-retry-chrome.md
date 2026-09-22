---
'@narduk-enterprises/narduk-mapkit': patch
---

`<AppMapKit>`'s default error content no longer draws a bare browser-chrome
button (#614). The title, status code and retry button carry `.mk-status-title`,
`.mk-status-code` and `.mk-status-retry`. The retry button resets its native
appearance and reads `--mk-ink`, `--mk-surface`, `--mk-font-sans` and
`--mk-focus`, with the same neutral fallbacks as the marks stylesheet. The
`#error` and `#loading` slots are unchanged.
