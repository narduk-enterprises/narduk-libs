---
'@narduk-enterprises/narduk-shell': minor
'@narduk-enterprises/create-narduk-app': patch
---

`bounce-guard.css` (desktop overscroll guards, ported from harbor#801) now loads
by default with `@narduk-enterprises/narduk-shell`, so every shell app gets no
rubber-band, no swipe-to-history and no scroll chaining without opting in. It
only makes the page unscrollable on a document that contains a `[data-app-shell]`
element; a page with no shell keeps natural scrolling. An app that wants page
scrolling inside a shell opts out with `nardukShell: { bounceGuard: false }`.
