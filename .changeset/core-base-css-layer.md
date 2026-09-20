---
'@narduk-enterprises/narduk-core': patch
'@narduk-enterprises/create-narduk-app': patch
---

fix(narduk-core): put the base element styles in `@layer base` so an app's theme
wins

`main.css` is appended to `nuxt.options.css` after the consuming app's own
stylesheets, and its `body` and `h1`–`h4` rules were unlayered. Unlayered CSS
beats every layered rule regardless of source order, so those defaults could not
be overridden by an app at all: measured on lakestat-us, the app's own
`body { color: var(--gs-ink); background: var(--gs-page) }` lost, and the page
computed `#fff`, slate-700 and Inter instead of the app's palette.

Both rules now sit in `@layer base`, which is where Nuxt UI already ships the
same body declarations. `.font-display` stays unlayered, because an app opts
into that class by name rather than inheriting it.
