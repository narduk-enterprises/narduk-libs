# Generator pin refresh

`Refresh generator pins` runs on Sunday at 11:17 UTC, ahead of generated apps'
Monday 06:00 America/Chicago Dependabot window. It also supports manual dispatch
on `main`. It refreshes only this repository's generator; generated apps remain
independent repositories.

The refresh selects the highest stable, non-deprecated version in each current
third-party package major whose npm publication timestamp is at least 14 days
old. Missing timestamps are not eligible. A registry failure fails the run
before source is written. Current pins are never downgraded. Internal packages
remain owned by `versions:sync`; Node and pnpm runtime changes and dependency
majors remain deliberate changes. TypeScript, Node-types and Playwright ceilings
come from `src/dependency-policy.ts`, which also emits Dependabot's ignore
rules.

The shared workflow pin advances to `narduk-enterprises/workflows` main only if
the old pin is its ancestor. The complete parent graph ships with the generator,
so `upgrade` can still compare pins without network access. Workflow-pin tests
read the current pin rather than requiring a hand edit on each refresh.

Before opening a PR, the job runs the refresh regression tests, generator
quality and build, then generates an external consumer against published
packages. The consumer must install with strict peer checking, survive
Dependabot-style recursive pnpm resolution, pass item 11 and typecheck, and
build a Cloudflare Worker. Only the validated pin and Changeset diff crosses
into the PR-writing job. That job installs and runs no dependency code. It opens
a new branch without force-pushing or auto-merging. If a refresh PR is already
open, the next run leaves it for review.

The PR uses `GITHUB_TOKEN`, like the release PR. GitHub may hold its ordinary PR
CI for approval; the refresh run's tests do not replace required PR checks.
Approve that run through the repository's normal route before landing the PR.
After merge, the normal Changesets release and publication proof deliver the new
generator. The refresh never publishes packages itself.

## Run locally

Use a full, fetched checkout of workflows main and Node 24. From narduk-libs:

```sh
node scripts/refresh-generator-pins.mjs --workflows-checkout /path/to/workflows
pnpm exec prettier --write packages/tooling/create-narduk-app/src/{manifest,workflow-pin,workflow-history}.ts
node --test scripts/refresh-generator-pins.test.mjs
pnpm --filter @narduk-enterprises/create-narduk-app run quality
pnpm --filter @narduk-enterprises/create-narduk-app run build
node scripts/generator-pin-smoke.mjs
```

`--check` reports proposed updates without writing and exits 1 if any are due.
The smoke retains a failed fixture at the path it prints; it removes a
successful fixture. A change to the scheduled workflow or repository CI scripts
also requires the repository's full preflight before pushing.

## Why Dependabot has a one-day cooldown

The refresh's 14-day selection window is separate from Dependabot's resolver
cooldown. Setting `cooldown.default-days: 14` was tested on 2026-10-08 for
[issue #1707](https://github.com/narduk-enterprises/narduk-libs/issues/1707) and
failed: pnpm reported `ERR_PNPM_NO_MATURE_MATCHING_VERSION` for
`@img/sharp-libvips-linux-ppc64@1.3.4`, published 11 days earlier and required by
`sharp@0.35.5`. That extends [company-hq#737](https://github.com/narduk-enterprises/company-hq/issues/737).

A zero cooldown fails the other way. The generated workspace sets
`minimumReleaseAge: 1440`, which pnpm applies inside Dependabot's updater too, so
with cooldown 0 Dependabot proposed versions under a day old (`nuxt-og-image`
7.0.6, `@cloudflare/workers-types`) and every npm job failed with
`ERR_PNPM_NO_MATURE_MATCHING_VERSION`, reported only as `unknown_error`.
`DEPENDABOT_COOLDOWN_DAYS = 1` matches the pnpm window. Proven on ai-api
(2026-10-14): all five Dependabot runs succeeded after the change. A transitive
pin published under a day ago can still fail a run; that is self-healing within
a day.
