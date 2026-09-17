---
'@narduk-enterprises/narduk-app-tools': minor
---

Add the declaration half of the Narduk deployment standard: the
`Config/cloudflare-app.json` `deployment` block schema and
`narduk-app foundation:check:deployment` (item 12,
`deployment-standard-conformance`) — company-hq#745, deployment-standard design
§2.1/§2.2 tier 1; Logan approved every recommended option on 2026-09-17.

The promote half already shipped: a build uploads a version, a GitHub Actions
job deploys it at 100% after the gate check is green, and `verify --live` proves
it. What was missing was the place an app says so, and anything that checks it.
`Config/cloudflare-app.json` is the right home — `foundation:check` items 1 and
3 already read it — and the block is validated with zod, projected to JSON
Schema by `deploymentBlockJsonSchema()` so an estate sweep or an editor reads
one definition rather than a second hand-written copy.

**Rollout mode is the default, and it is deliberate.** An app with no
`deployment` block reports `NOT ADOPTED` and exits **0**. Publishing this
command therefore turns no app's CI red on the day it ships; apps adopt one at a
time. `--strict` makes a missing block a failure and is what CI passes once
adoption is complete. A block declaring a `standard` other than `narduk-v1` is
reported `not-applicable` — an exempt app is not claiming conformance, so
reporting it as twenty schema violations would be noise, not a finding.

**One rule fails even in rollout mode.** A Worker version captures its binding
_configuration_, but the state behind D1, KV and R2 is not versioned, and
`preview_database_id` / `preview_id` / `preview_bucket_name` apply to
`wrangler dev` only — they do nothing for a Workers Builds preview. An app that
sets `nonProductionBranchBuilds: true` while its wrangler config binds
production D1, KV or R2 would read and write production data from every pull
request branch. The check refuses that combination unless `previewBindings`
names a replacement for each binding, reading every `env.*` scope of the
wrangler config (JSON, JSONC and TOML) so a binding hidden under an environment
still counts.

**What the verdict is honest about.** This is a repository read with no
credential, so it cannot see the deploy commands actually configured on the
Workers Builds connection — the exact edit that would silently undo the standard
— nor whether branch builds are enabled there, nor a second Worker on another
account serving the same hostname. Those need the live read (design §2.2 tier
2). Every run prints that limitation beside its verdict and the artefact carries
it in `limitations`, so a green repository check is not mistaken for a green
deployment.

Two additions to the design's literal §2.1 sketch, both additive: a
`previewBindings` entry may be a bare binding name or an object carrying the
preview resource's ids (§3.3 option A has to generate a preview wrangler config
from this block, which needs them), and `previewChecks` is accepted and optional
— it is the shared workflow's `preview-checks` input, and declaring it here is
what lets a sweep see which apps still run the default.

## Review round 1

- **`staging` now accepts the design's own enabled shape.** The schema modelled
  `staging` as `{ enabled: boolean }` under `strictObject`, so design §5.2's
  staging-enabled block — `workerName`, `hostname`, `approval`, `environment`,
  `bindings` — was five unknown keys and the first app to follow the approved
  design verbatim would have failed 12.0. The enabled shape is modelled, and an
  enabled stage must name its Worker, the hostname its proof reads and its gate
  (`environment`, which then has to name the GitHub Environment carrying
  `required_reviewers`, or `auto-after-proof`). Configuration left on a
  **disabled** stage is rejected rather than ignored: it reads as a live staging
  setup and is not one.
- **12.5 reads TOML and compares the account it was told to expect.** It read
  `account_id` from JSON only, so it was `not-applicable` on exactly the two
  committed personal-account Workers the standard was written to catch — both
  are `.toml`. TOML is now read, and an app may declare `deployment.accountId`;
  every wrangler config in the checkout must then name that account. Without a
  declared `accountId` the verdict says plainly that it checked internal
  consistency **only** and cannot decide whether the account is the right one.
- **Every wrangler config is scanned, not just the app's own.** 12.4 and 12.5
  resolved one config by candidate path, so a second Worker under `services/*` —
  the shape both personal-account offenders have — had its bindings and its
  account unread. Both now read every wrangler config in the checkout.
- **New 12.6: the app and its wrangler config must agree about exposure.**
  Design §2.2 tier 1 asks that `preview_urls`/`workers_dev` agree between
  `Config/cloudflare-app.json` and the wrangler config; nothing implemented it.
  12.6 compares `worker.workersDev` / `worker.previewUrls` against every scope
  of the wrangler config, **including by silence** — Cloudflare defaults both to
  `true`, so an app that records `workersDev: false` and never says so in
  wrangler ships a live `*.workers.dev` hostname it believes it does not have.
- **The block a generated app pastes is pinned to this schema.**
  `fixtures/default-deployment-block.json` is asserted here to equal
  `defaultDeploymentBlock()` and to be accepted by `readDeploymentBlock`, and
  `create-narduk-app`'s generator test asserts its runbook emits exactly that
  file. Neither package depends on the other, and a schema change cannot reach a
  newly generated app without turning a test red first.
