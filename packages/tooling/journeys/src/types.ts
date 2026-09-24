/**
 * The journey-runner declaration contract.
 *
 * The normative source is the spec this package implements:
 * agent-infrastructure `skills/visual-qa/references/journey-runner-spec.md`
 * (agent-infrastructure#851, PR #852). Where a comment here disagrees with the
 * spec, the spec wins and the divergence is a bug.
 *
 * The core is deliberately runtime-neutral: no Playwright, no simulator, no
 * test-runner imports. Narrative consumers import prose from a catalog with no
 * browser installed (the spec's import-safety rule, §2.3).
 */

/** A named, reproducible world (§2.1). Mechanics stay in the repository. */
export interface Scenario {
  /** URL-safe, stable; the id a load must confirm back by name. */
  id: string
  /** What a person calls it. */
  name: string
  /** One sentence, in the presenter's own words. */
  blurb: string
  /** Narrative grouping only; never used for execution. */
  tags?: string[]
}

/** Capture-mode hints; ignored entirely in test mode (§2.3). */
export interface StepCaptureHints {
  dwell?: number
}

/**
 * The declaration-only step shape shared by every surface (§2.3).
 * Apple journeys carry exactly this; web steps extend it with `do`.
 */
export interface DeclaredStep {
  /** Stable slug, unique within the journey. Artefact identity derives from it. */
  id: string
  /** Presenter prose. The walkthrough prints it; capture names frames with it. */
  say: string
  /**
   * Static conditionality: the step is not part of this journey under the named
   * scenarios. The only conditionality Apple steps may declare (§2.4 computes
   * expected marker sequences per scenario before the suite runs).
   */
  skipWhen?: { scenarios: string[] }
  capture?: StepCaptureHints
}

/**
 * The probe's verdict is auditable, not a bare boolean: `reason` is the world
 * fact that justified a skip, recorded verbatim in run.json and required by
 * promotion (§4.3).
 */
export type Applicability = { applicable: true } | { applicable: false; reason: string }

/**
 * GET only, same-origin, JSON only — by signature, not convention: an
 * applicability probe must be unable to mutate the world it is probing. The
 * adapter throws on non-2xx, on `text/html` (fetching the rendered page and
 * string-matching the control is the forbidden UI probe through a side door),
 * and on a body that does not parse as JSON. A throw anywhere inside
 * `appliesIf` FAILS the step — never a skip, never applicability (§2.3).
 */
export interface WorldQuery {
  base: string
  get(path: string): Promise<unknown>
}

/**
 * What a web step's `do` receives. `page` is typed loosely here so the core
 * stays free of Playwright types; the `./web` adapter narrows it.
 */
export interface WebJourneyContext {
  /** The raw Playwright page. Never wrapped away; the escape hatch is the API. */
  page: unknown
  base: string
  /** Click by accessible name or THROW naming what was missing. */
  must(name: string | RegExp, opts?: { role?: string; nth?: number }): Promise<void>
  /**
   * Wait until this exact text is visible on the page. A string is matched
   * exactly — `see('VERIFIED')` does not pass on `PENDING VERIFICATION` — and
   * the helper waits, it does not read once (narduk-libs#67). A match that is
   * only in the DOM (hidden, `aria-hidden`, a template node) is not enough.
   * Throws naming the text, the URL and the timeout. Prefer `hasControl` when
   * the claim is about a control.
   */
  see(text: string | RegExp, opts?: { timeout?: number }): Promise<void>
  /**
   * Wait until a control with this accessible name is visible. Never body
   * text: `hasControl('Cancel')` does not pass on a `Cancelled` label. A
   * hidden match is not "offered".
   */
  hasControl(name: string | RegExp, opts?: { role?: string; timeout?: number }): Promise<void>
  /**
   * Poll until no control with this accessible name remains. Never body text,
   * and never `waitFor({ state: 'detached' })` — that resolves immediately
   * against a locator matching nothing (narduk-libs#67). Succeeds immediately
   * if the control was never in the tree; call `hasControl` first when you
   * mean it disappeared after an action.
   */
  noControl(name: string | RegExp, opts?: { role?: string; timeout?: number }): Promise<void>
  /**
   * Wait until a distinctive sentence that *was visible* on the page is no
   * longer visible. Fails if the text was never seen: a hidden-only or
   * zero-count first sample is not evidence it went away. Hidden template
   * nodes do not count as seen (narduk-libs#67).
   */
  gone(text: string | RegExp, opts?: { timeout?: number }): Promise<void>
  /**
   * Fill a field (CSS selector or accessible label) and read the value back.
   * A write that lands in the wrong box, or not at all, fails the step.
   * Labels may contain `:` or brackets (`Email:`, `Quantity [kg]`); pass an
   * explicit `input[…]` / `#id` / `.class` when you mean a selector.
   */
  fill(target: string, value: string, opts?: { timeout?: number; nth?: number }): Promise<void>
  /** Set files on a file input. `page` stays the escape hatch for everything else. */
  attach(
    selector: string,
    file: string | { name: string; mimeType: string; buffer: Uint8Array },
    opts?: { timeout?: number },
  ): Promise<void>
  goto(path: string): Promise<void>
  /** Capture: dwell. Test: no-op. */
  beat(ms: number): Promise<void>
  /** Capture: slow read-through scroll. Test: no-op. */
  read(screens?: number): Promise<void>
  /** Capture: rest the cursor on the thing being narrated. Test: no-op. */
  point(text: string): Promise<void>
}

export interface WebStep extends DeclaredStep {
  /**
   * Acts AND asserts — a step that cannot find its control THROWS. There is no
   * separate `expect` field: assertions live wherever in the flow they are
   * natural (§2.3).
   */
  do(context: WebJourneyContext): Promise<void>
  /**
   * Dynamic conditionality, web only, decided by a DOMAIN signal — never by
   * probing the UI (§2.3, the two-round history lives in the spec).
   */
  appliesIf?(world: WorldQuery): Promise<Applicability>
}

/**
 * A fidelity compromise this journey deliberately makes, and what it costs.
 *
 * Declared so a reviewer meets it in the catalog, the rehearsal and the
 * walkthrough — never made ad hoc at capture time. narduk-libs#70 recorded the
 * finding this exists for: a consumer reached for a launch argument that
 * withdrew a whole class of on-screen checks in order to cross a gate, which
 * was the right call and was invisible to everyone downstream of the video.
 */
export interface Compromise {
  /** What was done. */
  what: string
  /** Why the journey could not be walked without it. */
  why: string
  /** What the viewer is therefore NOT seeing. */
  cost: string
}

interface JourneyBase {
  /** kebab-case, stable; artefact identity derives from it. */
  id: string
  /** What a person says out loud. */
  title: string
  /** Key into the audience table — the seat this journey is performed as. */
  role: string
  /** Declared, reviewable fidelity compromises (see `Compromise`). */
  compromises?: Compromise[]
  /**
   * Precondition worlds, by Scenario id — one or more. A journey is
   * parameterised across every scenario it declares; capture uses the FIRST as
   * its default world. A single-scenario journey with a `skipWhen` is dead
   * weight and `defineCatalog` rejects it (§2.2).
   */
  scenarios: [string, ...string[]]
  /** What the viewer should believe afterwards — including "the app refuses" (§7). */
  outcome: string
  tags?: string[]
}

export interface WebJourney extends JourneyBase {
  surface: 'web'
  steps: WebStep[]
}

/**
 * The FULL XCTest identifier of the one test method that performs this journey
 * (the `-only-testing:Target/Class/method` unit). A class is not enough (§2.2).
 */
export interface AppleBinding {
  xcTarget: string
  xcClass: string
  xcMethod: string
}

/**
 * A journey whose execution lives in a bound XCTest method (§2.4, §6.3): the
 * runner runs the method, harvests the `.xcresult`, and verifies the executed
 * marker sequence against this declaration. Drift is DETECTED, not impossible.
 */
export interface XcTestAppleJourney extends JourneyBase {
  surface: 'ios' | 'macos'
  /** The default; state it or leave it out. */
  drive?: 'xctest'
  /** Prose + id only; execution lives behind the binding (§2.4). */
  steps: DeclaredStep[]
  binding: AppleBinding
}

/**
 * The hardware-keyboard keys a beat may press. Each is a key a typed run cannot
 * reach with text: `backspace` clears a pre-filled field (typing appends to it),
 * `tab` reaches a field another element's frame occludes, and `return` commits
 * a decimal pad that has no Done (narduk-libs#75).
 */
export const APPLE_KEYS = [
  'return',
  'tab',
  'backspace',
  'delete',
  'escape',
  'space',
  'up',
  'down',
  'left',
  'right',
] as const
export type AppleKey = (typeof APPLE_KEYS)[number]

/**
 * One gesture. A coordinate is in DEVICE POINTS, and the adapter never invents
 * one: a point comes from a screenshot of the exact screen the previous beat
 * landed on, and `lands` is what stops a drifted one from quietly shifting every
 * beat after it (narduk-libs#70, requirement 5). Prefer `element` wherever the
 * control carries an accessibility identifier: it is resolved on the screen the
 * press happens on, so a layout change cannot move it (narduk-libs#75).
 */
export type AppleGesture =
  | { kind: 'tap'; x: number; y: number }
  /**
   * Tap the centre of the ONE control whose accessibility identifier is `id`,
   * read from the hierarchy immediately before the press. No match, or more
   * than one, fails the beat and names the identifiers that were on screen.
   */
  | { kind: 'element'; id: string }
  | {
      kind: 'swipe'
      from: { x: number; y: number }
      to: { x: number; y: number }
      /** Seconds; the injector's own default when absent. */
      duration?: number
    }
  | { kind: 'type'; text: string }
  /** Press a hardware-keyboard key, `repeat` times (default 1). */
  | { kind: 'key'; key: AppleKey; repeat?: number }
  /** No gesture: dwell on what the previous beat produced (an animation, a toast). */
  | { kind: 'wait' }

/**
 * What a beat must land on — the Apple analogue of "a step that cannot find its
 * control THROWS" (§2.3, narduk-libs#70 requirement 5).
 *
 * The predicate reads the accessibility hierarchy the injector reports, as
 * text. Honest scope: that is a HIERARCHY check, not a visibility check — an
 * element the app renders off-screen still reads as present. Tighten it, where
 * a repository needs to, by giving the injector a `describe` template that
 * filters to what is on screen; the contract here is deliberately the raw text
 * so no injector's JSON schema is baked in.
 */
export interface AppleLanding {
  /** Prose: the screen this beat lands on. Failure messages quote it. */
  screen: string
  /** Every one of these must be readable on the landing. */
  requires: [string, ...string[]]
  /**
   * None of these may be readable. This is the guard for a control that pops
   * FURTHER than the beat expected — the case that shifted three tail beats
   * one step out of phase in the run narduk-libs#70 was written from, while
   * every screen still changed and nothing failed.
   */
  forbids?: string[]
  /**
   * Rare, and declared rather than assumed: this beat's gesture is expected to
   * leave the screen exactly as it was.
   *
   * By default a landing must also prove the screen MOVED, because a predicate
   * that was already true before the gesture proves nothing about the gesture —
   * the first live run had a scroll beat pass instantly on text that was
   * readable both before and after, and the beat after it then pressed a
   * coordinate the scroll had not reached. Set this only where standing still
   * is genuinely the expected outcome.
   */
  unchanged?: boolean
}

export interface AppleDrivenStep extends DeclaredStep {
  /** What the beat does. */
  press: AppleGesture
  /** What it must land on, verified before the next beat runs. */
  lands: AppleLanding
}

/**
 * A journey the adapter drives itself: ONE launch, then presses (§6.3 as the
 * first Apple consumer actually performs it — narduk-libs#70). The launch
 * arguments select the world (requirement 1), an injector performs the
 * gestures (requirement 2), `simctl io recordVideo` films it (requirement 3),
 * and every beat verifies its landing (requirement 5).
 *
 * This is not a substitute for the XCTest binding: a bound method asserts from
 * inside the app and belongs in the test suite; a driven journey walks the
 * shipping build from outside and is what a continuous, uncut capture needs.
 */
export interface DrivenAppleJourney extends JourneyBase {
  surface: 'ios' | 'macos'
  drive: 'driven'
  /**
   * Journey-level launch arguments — the situation this walk starts from, on
   * top of whatever the world hook contributes for the scenario.
   */
  launchArgs: string[]
  /**
   * What the launched world must show before a single press happens. This is
   * the run's own evidence that the launch arguments produced the world the
   * journey is about.
   */
  start: AppleLanding
  steps: AppleDrivenStep[]
  binding?: never
}

export type AppleJourney = XcTestAppleJourney | DrivenAppleJourney

/** Discriminated by surface: invalid combinations are unrepresentable (§2.2). */
export type Journey = WebJourney | AppleJourney

export type Surface = Journey['surface']

/** Web sign-in hook. Repo-owned; drives or POSTs the REAL sign-in (§2.5). */
export type WebAuthHook = (page: unknown, base: string) => Promise<void>

/**
 * Discriminated by credentialClass, like Journey is by surface (§2.5).
 * 'secret' entries carry a `secretRef` selector only; the repo-owned hook
 * resolves it process-locally, and the tool never RECORDS the value. No
 * approved Apple channel exists yet, so `apple` is `never` on secret entries —
 * a secret-class Apple audience is a load-time error (§13.8).
 */
export type AudienceEntry =
  | {
      credentialClass: 'public-synthetic'
      web?: WebAuthHook
      /** Role SELECTOR the app-side fixture auth resolves internally. */
      apple?: { role: string }
    }
  | {
      credentialClass: 'secret'
      secretRef: string
      web: WebAuthHook
      apple?: never
    }

export type Audience = Record<string, AudienceEntry>

/** Narrative grouping; may mix surfaces (§6.1). */
export interface Story {
  id: string
  title: string
  /** Narrative audience — the seats worth opening. */
  audience: string[]
  /** Journeys in presentation order, any mix of surfaces. */
  journeys: string[]
}

/**
 * An EXECUTION grouping, deliberately not a Story: cumulative execution only
 * makes sense inside one world, so a Sequence pins one scenario and one
 * surface, and membership is validated (§6.1).
 */
export interface Sequence {
  id: string
  scenario: string
  surface: Surface
  journeys: [string, ...string[]]
}

/** A named capture profile; the name joins the artefact path (§4.2, §4.3). */
export interface WebProfile {
  kind: 'web'
  viewport: { width: number; height: number }
  dpr?: number
  colorScheme?: 'light' | 'dark'
}

export interface AppleProfile {
  kind: 'apple'
  device: string
  orientation?: 'portrait' | 'landscape'
  /**
   * The handset's size in DEVICE POINTS. Declaring it lets the catalog reject
   * a gesture aimed off the screen at load time rather than at 2 a.m. on a
   * capture night.
   */
  points?: { width: number; height: number }
}

export type Profile = WebProfile | AppleProfile

/** Everything a repository declares, in one place (§2). */
export interface Catalog {
  scenarios: Scenario[]
  journeys: Journey[]
  audience: Audience
  stories?: Story[]
  sequences?: Sequence[]
  profiles: Record<string, Profile>
}

export type Mode = 'test' | 'capture'

export type StepStatus = 'passed' | 'failed' | 'skipped-not-applicable'

/** One executed (or dynamically skipped) step in the run manifest (§4.2). */
export interface RunStep {
  id: string
  ordinal: number
  status: StepStatus
  say: string
  startedMs?: number
  endedMs?: number
  shot?: string
  shotSha256?: string
  /** Required when status is 'skipped-not-applicable': the appliesIf reason, verbatim. */
  skipReason?: string
  /** Present when status is 'failed'. */
  error?: string
}

export const RUN_SCHEMA = 'njr-run/1' as const

/** The run manifest — the machine-readable record every consumer reads (§4.2). */
export interface RunManifest {
  schema: typeof RUN_SCHEMA
  journey: string
  surface: Surface
  mode: Mode
  base: string
  commit: string
  declarationDigest: string
  /**
   * Digest of this journey's declared shape (see `digestJourney`). When
   * present, verify/promote/walkthrough use it — not the catalog-wide
   * `declarationDigest` — so adding a sibling journey does not stale this
   * run (narduk-libs#66). Absent on manifests written before that field
   * existed; those still compare `declarationDigest` to the catalog digest.
   */
  journeyDigest?: string
  appRevision: string
  profile: { name: string } & Record<string, unknown>
  startedAt: string
  scenario: {
    id: string
    confirmed: boolean
    generation: string
    generationAfter: string
    preparedBy: string
  }
  verdict: 'passed' | 'failed'
  steps: RunStep[]
  video?: { file: string; seconds: number | null; sha256: string }
}

/**
 * Repo-owned world hooks (§5). `prepare` loads the scenario behind the
 * loader's own fail-closed environment gate and target-scoped lease, confirms
 * it by name, and returns the loader-stamped generation token; `generation`
 * re-reads the token so the runner can detect loader-mediated replacement
 * after every journey. The lease and the gate live in the LOADER — the runner
 * is a client of them, never the enforcement point.
 */
export interface WorldHooks {
  prepare(scenarioId: string): Promise<{ scenarioId: string; generation: string }>
  generation(): Promise<string>
  /** What the target itself reports (e.g. /version). Recorded in run.json. */
  appRevision(): Promise<string>
  /** Release the lease at session end, when the loader issued one. */
  release?(): Promise<void>
}
