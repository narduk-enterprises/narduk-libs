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
  --env local --profile desktop --profile-ios phone --dest .journeys/out/walkthrough
journeys rehearse --catalog journeys/catalog.mjs   # watermarked, declaration-only
```

Verification derives its expectations from the declaration, never from the
manifest under test. Promotion requires a passed run, hash-verified artefacts,
and digest equality with the catalog as it stands now.

`--profile-<surface>` and `--env-<surface>` are what make one walkthrough carry
both surfaces: a web journey runs against a deployment under a web capture
profile and a handset journey against an in-app fixture world under an Apple
one, so the two halves of a story file under different names and the page
assembles them anyway. The mixed-application-revision guard is per surface for
the same reason.

## Apple surfaces

Two execution shapes, one declaration contract.

**Bound to an XCTest method** (`drive: 'xctest'`, the default) — the journey
declares prose and step ids, the Swift test performs them, and `appleMarker` /
`parseAppleMarkers` / `verifyAppleSequence` verify the executed step-id sequence
against the declaration afterwards. Drift is detected, not impossible.

**Driven by this package** (`drive: 'driven'`) — one launch, then presses. This
is what a continuous, uncut capture needs: a relaunch between beats can show two
screens and stay silent about whether one leads to the other.

```ts
import {
  runAppleJourneys,
  createSimctlControl,
  resolveInjector,
} from '@narduk-enterprises/journeys/apple'

await runAppleJourneys({
  catalog,
  world: {
    launchArgs: (scenarioId) => ['-uiFixtures', '1', '-uiScenario', scenarioId],
    appRevision: () => buildNumber,
  },
  control: createSimctlControl(udid),
  injector: resolveInjector({ udid }),
  appPath: process.env.IOS_APP_PATH, // required; never "newest in DerivedData"
  bundleId: 'com.example.app',
  outRoot,
  environment,
  profileName: 'phone',
  declarationDigest,
})
```

A driven journey declares the situation it starts from and, on every beat, what
that beat must land on:

```ts
{
  id: 'gate-to-gate',
  surface: 'ios',
  drive: 'driven',
  launchArgs: ['-uiProceduresOff', '1'],
  compromises: [{
    what: 'procedures are switched off for this walk',
    why: 'the board owns six of the eight signatures and a handset cannot sign them',
    cost: 'no checklist card appears in this recording',
  }],
  start: { screen: 'the yard', requires: ['SCHEDULED FOR TODAY'] },
  steps: [{
    id: 'mark-arrived',
    say: 'Mark it arrived',
    press: { kind: 'tap', x: 201, y: 795 },
    lands: {
      screen: 'arrived, in inbound staging',
      requires: ['inbound staging'],
      forbids: ['SCHEDULED FOR TODAY'],
    },
    capture: { dwell: 5500 },
  }],
}
```

What the adapter guarantees, and what it does not:

| Guarantee                                      | How                                                                                                 |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| The world is chosen, not stumbled into         | `world.launchArgs(scenarioId)` + the journey's own `launchArgs`                                     |
| No video of a screen nobody pressed            | `resolveInjector` THROWS when no injector is configured or installed                                |
| One binary, named in the evidence              | `appPath` is required and hashed into every manifest                                                |
| A wrong landing is a red run                   | every beat polls the accessibility hierarchy for `requires`/`forbids` and fails when it never holds |
| A landing that was already true proves nothing | a beat must also prove the screen MOVED; `lands.unchanged` declares the rare exception              |
| A beat never reads a screen mid-motion         | a landing must hold across two consecutive reads before the beat passes                             |
| Two lanes cannot share a device                | the simulator is leased for the session, and a live rival lease is a hard refusal                   |
| Modes cannot disagree                          | mode changes dwell, video and stills; the gestures and the landing assertions are identical         |

- **`requires`/`forbids` read the hierarchy, not the pixels.** An element the
  app renders off-screen still reads as present. Tighten it where you need to by
  giving the injector a `describe` template that filters to what is on screen.
- **Confirmation.** With no `world.confirm`, the run's confirmation is that the
  launched world renders the journey's declared `start` landing — real, weaker
  than a name, and recorded as `fresh-launch:start-landing` in the manifest so a
  reader can tell the two apart.
- **Injector.** Any command template works (`JOURNEYS_TAP_CMD` /
  `JOURNEYS_SWIPE_CMD` / `JOURNEYS_DESCRIBE_CMD` / `JOURNEYS_TEXT_CMD`);
  `fb-idb` is the documented default because it works headless and at a locked
  login screen, and it is adopted only when `idb` is actually on PATH.
- **Not yet:** cumulative Apple sequences (every journey gets a fresh launch),
  the XCTest execution path (declare those journeys and run them through the
  test suite), and macOS, which the contract reserves and nothing implements.
- The execution constraints this obeys — one `xcodebuild` per host, the totals
  line as the verdict, per-lane devices — are `agent-infrastructure`'s
  `apple-test-execution` reference.
