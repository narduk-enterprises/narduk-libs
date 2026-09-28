---
"@narduk-enterprises/create-narduk-app": minor
---

Default a no-flag scaffold that lands on public exposure to `seo,analytics`
capabilities (Logan, askme 2026-09-28, narduk-libs#1229). Without them, a
public app's `narduk-app foundation:check` failed item 3.1 (missing
narduk-seo/narduk-analytics) on day one; the fix is additive and does not
change any explicit `--capabilities`/`--capability` invocation, including an
explicit empty or otherwise different list, or an authenticated app's
(unchanged, empty) default. `upgrade` is unaffected: it always infers an
existing app's capabilities from its own manifests/dependencies rather than
applying this default.

Minor, not patch: this changes generated output for the common no-flag CLI
invocation, which is user-visible behavior a consumer may reasonably pin
against, even though no public API signature changed.
