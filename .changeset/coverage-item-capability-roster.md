---
'@narduk-enterprises/narduk-app-tools': minor
---

Add `narduk-app foundation:check:coverage` — foundation item 9,
`shared-capability-coverage`.

**What it reports.**

_(a) Inventory._ Every `@narduk-enterprises/*` dependency the app pins, with its
version, the manifest it came from and the dependency block it sat in — one row
per `(package, manifest, block)` across the root manifest and the workspace
manifests at the monorepo-candidate paths item 1 already reads. Beside it, the
catalog of shared capabilities the estate publishes, each marked adopted or not.
The catalog is **derived from narduk-libs' own `pnpm-workspace.yaml`**, not
hand-typed: `scripts/generate-capability-catalog.mjs` writes
`src/foundation/capability-catalog.ts`, private workspace packages are excluded
because an app cannot depend on one, and `pnpm run scripts:test` fails in
required CI when the committed file falls out of step with the workspace. The
whole inventory is a first-class `inventory` block in the `--json` artefact so
the estate roster consumes it as data rather than parsing sub-check prose.

_(b) Reimplementation detection._ Five detectors for app-local code doing a
shared package's job — an app-local `createLogger`/`logger.ts` with a console
transport (`@narduk-enterprises/narduk-logging`), a local `useSeo` /
`defaultSocialMeta` twin (`narduk-seo`), a direct `posthog-js` import
(`narduk-analytics`), a `server/api/**/health*` route that never references
`registerHealthCheck` (`narduk-core`), and a Nitro plugin that hooks
`error`/`afterResponse` or attaches a response `finish` listener and logs from
it (narduk-logging adoption guide step 5). Each detector asks one further
question: is the owning shared package a dependency? If yes the match is
**confirmed** and reported as a **FAIL** naming the exact file path and the
owning package; if no it is **heuristic** and reported as a **WARN**, which
carries the existing `unknown` status (exit 2) plus `confidence: 'heuristic'` in
the artefact. The four verdicts read as _proven_ (`pass`), _gap_ (`fail`),
_unknown_ and _not-applicable_; there is no fifth status and no new vocabulary.

**Shape.** Its own command and its own artefact
(`tool: '@narduk-enterprises/narduk-app-tools/capability-coverage'`), exactly as
item 8 `shared-ui-pinned` is: `foundation-check.json` stays the precise 7-item
contract company-hq `check-web-foundation.py` `validate_artefact()` consumes,
and an `id` outside `1..7` would be a rollup-red F3 ARTEFACT finding on every
app. No registry credential is required — every verdict comes from the app's own
manifests and source.

**Zero false positives** is the acceptance bar, proven against
`narduk-enterprises/buoys` at `cc72c3d` (PASS, exit 0, 13 estate pins, 112 files
scanned, 0 detections) and a freshly generated `create-narduk-app@0.6.3`
scaffold (PASS, exit 0, 11 pins, 7 files scanned, 0 detections). Both shapes are
committed as fixtures.

Also: `AppRepo.walk()` now skips `.output`, `.nuxt`, `.nitro`, `.wrangler`,
`.turbo` and `coverage` alongside `node_modules`, `.git` and `dist`. A built
Nitro bundle inlines every dependency, so a conformant app's
`.output/server/chunks` contains `createLogger`, `posthog-js` and a health route
— a content scan that reached it would report the whole estate as forking
itself.
