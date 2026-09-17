---
'@narduk-enterprises/narduk-app-tools': minor
---

Fix the three narduk-app-tools defects the estate's first `narduk-v1` adoption
found (narduk-libs#451).

**`versions-promote --sha` no longer misses a version below the ten-version
window.** `wrangler versions list` returns "the 10 most recent Versions of your
Worker" and takes no paging flag, so with non-production branch builds on, ten
branch uploads landing between a merge build and its promote job buried the
version to promote and production stayed on the old release. The lookup now
walks Cloudflare's own Versions endpoint with `per_page`/`page` up to a bound --
the new `--max-versions` flag, default 500 -- and never paginates unbounded. One
constant `per_page` runs the whole walk, because V4 computes the offset as
`(page - 1) * per_page` and a shrinking last page would re-read rows already
seen instead of reaching the tail; the walk ends only on the bound, an empty
page, or an end-of-collection the response's own `result_info` proves, so an
endpoint that clamps `per_page` cannot make a short first page look like the end
of the history. It needs an account id and `CLOUDFLARE_API_TOKEN`; without both
it falls back to `wrangler versions list` and reports
`versionSearch.source: "wrangler"` so a miss in ten is never mistaken for a miss
in five hundred. A miss still exits 3, never 0 -- a promote that promoted
nothing must be a red job -- and the detail now names the SHA, the count
searched, the bound, and whether the search reached the end of the history (the
build never uploaded this commit) or stopped at the bound (raise
`--max-versions`, or use `--version-id`).

**`--sha` no longer defaults to `GITHUB_SHA` under `on: workflow_run`.** There
`GITHUB_SHA` is the default branch's head at trigger time, not the commit whose
run completed, so the default could promote a commit the gate check never
passed. The command refuses with an exit-2 usage error naming
`${{ github.event.workflow_run.head_sha }}`. Every other event is unchanged, and
`--version-id` is unaffected.

**Foundation item 12.4 no longer reports PASS for `previewBindings` coverage.**
Nothing in this release consumes that field -- `narduk-app deploy` generates
only `.wrangler.deploy.production.json` and a branch build uploads with it -- so
an app listing every binding name gets the identical runtime to one listing
none. Full coverage now reports `unknown` ("declared, not enforced", exit 2)
rather than a green check standing for a preview isolation that does not exist.
`pass` is reserved for `nonProductionBranchBuilds: false` and for an app with no
D1/KV/R2 binding, and the limitation is stated in every run's `limitations`.

**Operator note.** Three behaviours change, all deliberately: `--max-versions`
is new (minor); a `workflow_run` promote with no explicit `--sha` now exits 2
instead of promoting the wrong commit; and an adopted app whose only preview
isolation is a `previewBindings` declaration now exits 2 on
`foundation:check:deployment` instead of 0. No estate app is on `narduk-v1`
today -- every one of them is `malformed` or `absent` on item 12 -- so no green
check turns red from that last change.
