---
'@narduk-enterprises/create-narduk-app': patch
'@narduk-enterprises/narduk-shell': minor
---

Add an opt-in desktop bounce guard (narduk-libs#1336), ported from harbor#801: the new `./bounce-guard.css` subpath, loaded by `nardukShell: { bounceGuard: true }` or imported by hand. It turns off the elastic overscroll and swipe-to-history on the page, stops scroll chaining from shell panes and Nuxt UI overlays, locks the page to the `[data-app-shell]` shell, and releases it in print, all in `@layer base`. `NeAppShell` now carries `data-app-shell` on its root. Nothing changes for an app that does not opt in.
