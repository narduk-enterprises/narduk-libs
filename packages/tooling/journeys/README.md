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

`base` and `world` may each be today's scalar or a function of `workerIndex`
(`test.info().parallelIndex` / `TEST_PARALLEL_INDEX`). Resolve happens inside
the registered `test()` body; the run manifest records the resolved `base`.

```ts
registerJourneys({
  catalog,
  base: (workerIndex) => `http://localhost:${3241 + workerIndex}`,
  world: (workerIndex) => createWorld({ base: baseFor(workerIndex) }),
  outRoot,
  environment,
  profileName,
  declarationDigest,
})
```

A Playwright worker pool (`workers > 1`) is refused unless **both** are
functions. A scalar `base` or a scalar `world` would share one origin and one
database across the pool — the wrong-but-green overwrite the contract exists
to kill. `workers: 1` with today's scalars stays the correct setting for a
single world.

- `JOURNEYS_MODE=test npx playwright test` — every journey, every declared
  scenario, no artefacts, fail fast.
- `JOURNEYS_MODE=capture npx playwright test` — first declared scenario,
  per-step screenshots, per-journey video, a `run.json` per attempt. Each
  attempt also records `journeyDigest` (`digestJourney` of that journey) so a
  later sibling does not stale it.

The `world` hooks are repo-owned: `prepare` loads a scenario behind the loader's
own fail-closed gate and lease, and returns the generation token the runner
re-checks after every journey.

`must` clicks. The rest of the assertion vocabulary waits; it does not read
once, and it does not match body-text substrings (narduk-libs#67):

- `see(text)` — this exact text is visible on the page. `see('VERIFIED')` does
  not pass on `PENDING VERIFICATION`, and a hidden-only match (off-screen,
  `aria-hidden`, a template node) is not enough. Prefer `hasControl` when the
  claim is about a control.
- `hasControl(name, { role })` — a control with that accessible name is visible.
  Never body text.
- `noControl(name, { role })` — polls `count()` to zero. Succeeds immediately if
  the control was never in the tree; call `hasControl` first when you mean it
  disappeared after an action. Do not assert absence by scanning the page
  (`Record as sent` matching `Records that the invoice was sent.`), and do not
  use `waitFor({ state: 'detached' })` — that resolves immediately against a
  locator matching nothing.
- `gone(text)` — a distinctive sentence that was visible has left (including
  hidden-but-still-in-the-tree). A first sample of nothing, or of a hidden
  template node, is not evidence it went away.
- `fill(target, value)` — writes, then reads the value back. Labels may contain
  `:` or brackets (`Email:`, `Quantity [kg]`); pass `input[name=…]`, `#id`, or
  `.class` when you mean a selector. A missing field fails naming the target and
  URL, not as a generic Playwright fill timeout.
- `attach(selector, file)` — a file input.

`page` stays the escape hatch. Do not assert the absence of a control by body
text. Timeouts must be a positive finite number of milliseconds;
`JOURNEYS_ASSERT_TIMEOUT=0` is refused (Playwright would wait forever).

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
and digest equality with the **journey** as it stands now. Adding another
journey — or any other file under the catalog directory — does not move that
digest, so a promoted capture of journey N stays current when journey N+1 lands
(`digestJourney`; narduk-libs#66). Manifests written before that field existed
still compare the catalog-wide `declarationDigest`.

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
- **Presses.** `tap` takes a device point. `element` takes an accessibility
  identifier (`{ kind: 'element', id: 'yard.action.markArrived' }`) and presses
  the centre of the one control carrying it, located on the screen as it is at
  the press. No match, or more than one, fails the beat and names the
  identifiers that were on screen. Prefer it to a coordinate wherever the app
  ships identifiers. `key` presses a hardware-keyboard key (`return`, `tab`,
  `backspace`, `delete`, `escape`, `space`, and the arrows), with an optional
  `repeat`: `backspace` clears a pre-filled field, `tab` reaches an occluded
  one, and `return` commits a decimal pad. An unknown gesture kind is refused
  when the catalog loads.
- **World.** `world.prepare({ control, scenarioId })` makes a server-backed
  world before the app launches into it: load the scenario, apply configuration,
  sync media. `world.generation({ control, scenarioId })` returns the world's
  own token, recorded beside the app's pid and re-read at the end, so a reseed
  under a take fails the run the way a replaced binary does.
- **Confirmation.** The declared `start` landing is always checked. With
  `world.confirm` the world must also name the scenario it loaded, recorded as
  `fresh-launch:named`. Without it, the landing is the only confirmation: real,
  weaker than a name, and recorded as `fresh-launch:start-landing` so a reader
  can tell the two apart.
- **Injector.** Any command template works (`JOURNEYS_TAP_CMD` /
  `JOURNEYS_SWIPE_CMD` / `JOURNEYS_DESCRIBE_CMD` / `JOURNEYS_TEXT_CMD` /
  `JOURNEYS_KEY_CMD`, whose `{hid}` is the USB HID usage code `idb ui key`
  takes); `fb-idb` is the documented default because it works headless and at a
  locked login screen, and it is adopted only when `idb` is actually on PATH. An
  `element` press reads the `describe` output as idb's JSON; an injector whose
  hierarchy is some other shape supplies its own `elements()`.
- **Not yet:** cumulative Apple sequences (every journey gets a fresh launch),
  the XCTest execution path (declare those journeys and run them through the
  test suite), and macOS, which the contract reserves and nothing implements.
- The execution constraints this obeys — one `xcodebuild` per host, the totals
  line as the verdict, per-lane devices — are `agent-infrastructure`'s
  `apple-test-execution` reference.
