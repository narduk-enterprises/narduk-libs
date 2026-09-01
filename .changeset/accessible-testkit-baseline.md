---
'@narduk-enterprises/narduk-testkit': minor
---

Add `playwright/accessibility`: axe-driven WCAG 2.2 AA conformance asserted
against a recorded baseline rather than against zero.

The baseline is a two-directional ledger. A rule that fires and is not listed
fails, so new debt cannot land silently; a listed rule that no longer fires also
fails, asking for the entry to be removed, so debt cannot be re-accrued behind a
stale allowance. A gate that demands zero on an app's first axe run gets
disabled by the first person it blocks, and one that only reports teaches
nothing — this is the shape that survives contact with real debt.

Ships three checks axe has no rule for: text-zoom overflow (scaling the root
font size, because zooming a viewport out passes while real 200% text still
overflows), state-not-by-colour-alone, and reduced-motion, which asserts
transitions are removed rather than shortened.

`@axe-core/playwright` is an OPTIONAL peer. The helpers take axe results rather
than building the scan, so the app keeps control of its `AxeBuilder` options and
this package never imports axe — apps using the other testkit families are not
made to install a runtime they never call.
