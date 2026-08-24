# @narduk-enterprises/journeys

A repository declares journeys and scenarios; this tool turns them into tests,
screenshots, video and a walkthrough. One declaration, three consumers, so a
demo whose journey no longer runs is a red build.

The contract this package implements — the declaration shapes, the two modes,
world sessions, promotion, and every deliberate limit — is specified in
`agent-infrastructure`:
[`skills/visual-qa/references/journey-runner-spec.md`](https://github.com/narduk-enterprises/agent-infrastructure/blob/main/skills/visual-qa/references/journey-runner-spec.md).
Read it before adopting; this README is mechanics only.

## Why this is not part of `narduk-testkit`

`narduk-testkit`'s charter is dev-only, runner-bound test helpers (Vitest and
Playwright peers). The journeys core must be importable with **no test runner
installed** — a docs build renders the rehearsal script from the catalog — and
the contract spans Apple orchestration outside that charter. The Playwright
layer here is an optional subpath (`./web`) behind an optional peer, per the
package standard's rule that adapters stay optional until consumers converge.

## Declare

```ts
// journeys/catalog.ts — its own package with its own lockfile
import { defineCatalog } from '@narduk-enterprises/journeys'

export const catalog = defineCatalog({
  scenarios: [
    { id: 'walkthrough', name: 'The full yard', blurb: 'The reset world.' },
  ],
  profiles: {
    desktop: { kind: 'web', viewport: { width: 1440, height: 900 } },
  },
  audience: {
    operator: { credentialClass: 'public-synthetic', web: signInAsOperator },
  },
  journeys: [
    {
      id: 'operator-scan-to-ticket',
      title: 'Scan to ticket',
      surface: 'web',
      role: 'operator',
      scenarios: ['walkthrough'],
      outcome: 'One scan carries a trailer from the gate to a ticket.',
      steps: [
        {
          id: 'open-console',
          say: 'Open the operate console',
          do: (c) => c.goto('/operate'),
        },
        // …
      ],
    },
  ],
})
```

`defineCatalog` validates at load: unique kebab-case ids, per-surface required
fields, `skipWhen` only where it can vary, and no secret-class Apple roles.

## Run

```ts
// journeys/journeys.spec.ts — driven by Playwright Test
import { registerJourneys } from '@narduk-enterprises/journeys/web'
import { catalog } from './catalog.js'

registerJourneys({
  catalog,
  world,
  base,
  outRoot,
  environment,
  profileName,
  declarationDigest,
})
```

- `JOURNEYS_MODE=test npx playwright test` — every journey, every declared
  scenario, no artefacts, fail fast.
- `JOURNEYS_MODE=capture npx playwright test` — first declared scenario,
  per-step screenshots, per-journey video, a `run.json` per attempt.

The `world` hooks are repo-owned: `prepare` loads a scenario behind the loader's
own fail-closed gate and lease, and returns the generation token the runner
re-checks after every journey.

## Verify, promote, publish

```sh
journeys verify   --catalog journeys/catalog.mjs --run <attempt-dir>
journeys promote  --catalog journeys/catalog.mjs --run <attempt-dir> --latest <path>
journeys walkthrough --catalog journeys/catalog.mjs --out-root .journeys/out \
  --env local --profile desktop --dest .journeys/out/walkthrough
journeys rehearse --catalog journeys/catalog.mjs   # watermarked, declaration-only
```

Verification derives its expectations from the declaration, never from the
manifest under test. Promotion requires a passed run, hash-verified artefacts,
and digest equality with the catalog as it stands now.

## Apple surfaces

This version ships the bind-and-verify primitives — `appleMarker`,
`parseAppleMarkers`, `verifyAppleSequence` — and the declaration types. The
simulator orchestrator is not built yet; the constraints it must obey live in
`agent-infrastructure`'s `apple-test-execution` reference. macOS is reserved in
the contract and unimplemented, deliberately.
