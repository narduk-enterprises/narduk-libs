# narduk-charts — agent entry pointer

narduk-charts is the source repo for **NardukCharts**, a Vue 3 SVG charting
library — TypeScript-first, themeable, accessible, built without D3 or
Chart.js. It publishes as `@narduk-enterprises/narduk-charts` to **GitHub
Packages**, not the public npm registry. What lives here is the library itself:
components and composables under [`src/`](./src/), unit tests beside them,
Histoire stories, Playwright e2e, and markdown API notes in
[`docs/`](./docs/). Runnable demos and the marketing narrative live on the
companion site [charts.nard.uk](https://charts.nard.uk), not in this repo.

The estate-wide operating manual for agents lives in
[narduk-enterprises/agent-infrastructure](https://github.com/narduk-enterprises/agent-infrastructure)
(its root `AGENTS.md`). On the Macs it is loaded automatically; in a cloud
container nothing loads it for you — read it first, then return here.

## Fast orientation

| Question | Answer |
|---|---|
| What is this repo? | The NardukCharts Vue 3 SVG charting library, published to GitHub Packages |
| Estate operating manual | [narduk-enterprises/agent-infrastructure](https://github.com/narduk-enterprises/agent-infrastructure) → `AGENTS.md` |
| Install deps | `npm ci --legacy-peer-deps` — the flag is required; histoire 1.0.0-beta's peer ranges make a plain `npm ci` fail |
| Run the checks | `npm run typecheck`, `npm run test`, `npm run build`, `npm run size` |
| Public surface | [`src/index.ts`](./src/index.ts) and the subpath entries in [`src/entries/`](./src/entries/) (`line`, `bar`, `pie`, `candle`, `studies`) |
| API notes / release / migrations | [`docs/API.md`](./docs/API.md), [`docs/RELEASE.md`](./docs/RELEASE.md), [`docs/MIGRATIONS.md`](./docs/MIGRATIONS.md) |
| Cloud-session setup | [narduk-enterprises/agent-infrastructure](https://github.com/narduk-enterprises/agent-infrastructure) → `docs/cloud-sessions.md` |

## Gates

[`.github/workflows/ci.yml`](./.github/workflows/ci.yml) calls the shared
`node-library.yml@v1` callable from
[narduk-enterprises/workflows](https://github.com/narduk-enterprises/workflows)
on the self-hosted `linux-ci` runner group, composing the estate-standard
`ci / Required` check context. That required gate is four lanes — **typecheck,
test, build, and `size`** (size-limit, passed through `extra-scripts` so it runs
after build and can see `dist/`). There is no lint script and the lane is
declared off rather than allowed to claim it ran; `require-scripts: true` makes
a renamed script a failure rather than a silent no-op.

All four are runnable locally from a clean checkout after `npm ci
--legacy-peer-deps`, with no credential: nothing in the dependency tree is
`@narduk-enterprises`-scoped, so the GitHub Packages scope in the root npmrc is
never exercised on install. Two jobs stay outside the callable, deliberately:

- **`e2e`** runs on the isolated `playwright-isolated` pool, whose Chromium is
  preinstalled and immutable and whose visual snapshots were generated there.
  Locally it is **UNKNOWN** — do not read a macOS snapshot diff as a defect.
- **`audit`** (`npm audit --audit-level=high`) is intentionally *not* part of
  `ci / Required`, so an upstream advisory cannot block every PR. It is
  currently red — 4 high-severity advisories, owned by narduk-charts#15.

Publishing is separate: [`publish.yml`](./.github/workflows/publish.yml) fires
on `v*` tags only.

## Cloud sessions

A cloud container starts with none of the Mac-side wiring. Read the estate
operating manual first (root `AGENTS.md` in
[narduk-enterprises/agent-infrastructure](https://github.com/narduk-enterprises/agent-infrastructure)),
then its `docs/cloud-sessions.md` for the container bootstrap and the credential
boundary. The rollout program that added this pointer is tracked in
[company-hq#487](https://github.com/narduk-enterprises/company-hq/issues/487).

## Issue labels

Labels that exist here: GitHub's stock defaults (`bug`, `documentation`,
`duplicate`, `enhancement`, `good first issue`, `help wanted`, `invalid`,
`question`, `wontfix`) plus `triaged-keep` and `area:apps`. The estate
baseline's `P0-critical`–`P3-low` priority axis has not been created here. Label
from that set at issue creation; never invent labels that do not exist in the
repo.
