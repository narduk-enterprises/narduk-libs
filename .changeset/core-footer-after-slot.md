---
'@narduk-enterprises/narduk-core': minor
'@narduk-enterprises/create-narduk-app': patch
---

`LayerAppFooter` has an extension point for extra rows (narduk-libs#743). It
renders an `after` slot below its content, and by default that slot renders the
global components listed in `appConfig.nardukCore.footer.after`. A module can
now add a footer row without shipping its own copy of the footer. The README
documents it.
