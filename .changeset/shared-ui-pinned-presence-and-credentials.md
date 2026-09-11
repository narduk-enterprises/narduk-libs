---
'@narduk-enterprises/narduk-app-tools': minor
---

`foundation:check:shared-ui-pinned` (item 8) stops conflating "published" with
"required", and stops needing a registry credential (narduk-libs#282 review).

- **Presence is no longer derived from publication.** The item now enforces one
  rule from the app's own manifests: _if the app depends on a shared-UI package,
  that pin must be exact_. It no longer fails a UI app for not depending on
  `narduk-ui` or `narduk-charts` — those are capability-specific (a charting
  library is not mandatory on an app that draws no charts, and `narduk-ui` is
  the `Ns*` status instruments "for the status apps"). An unused package is
  `not-applicable`. The new exported `PRESENCE_REQUIRED` is the one place an
  estate-wide requirement would be recorded; it is empty, because no dated
  decision names a shared-UI package as required of _every_ UI app, and a test
  pins it empty so an addition cannot land silently.
- **No registry credential is needed, and exit 2 is no longer reachable for want
  of one.** Exact-pin discipline is a manifest fact. `RegistryReality` is still
  consulted, but only to annotate an already-decided sub-check with the latest
  published version; an unreadable registry drops the annotation and changes no
  status. `UNKNOWN` now means only "no `package.json` at a known monorepo path".
  This is what lets the command run in a generated app's CI, whose install step
  deliberately keeps the GitHub Packages token out of the ambient job
  environment.
- **`FilesystemRegistryReality.publicationOf` fails toward `unknown` on an
  ambiguous 404.** GitHub Packages answers "no such package" and "your token
  cannot see this package" identically, so a mis-scoped token used to report
  every estate package as `unpublished` — a silent pass. A 404 is now
  corroborated with one memoized probe against `SCOPE_PROBE_PACKAGE`
  (`@narduk-enterprises/narduk-core`): only a token proven able to read the
  scope turns a 404 into `unpublished`; otherwise the answer is `unreadable`.
