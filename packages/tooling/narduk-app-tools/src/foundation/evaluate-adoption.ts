/**
 * `narduk-app doctor --adoption` -- the adoption report (company-hq#745, standard
 * company-hq#746).
 *
 * THE STATUS IS THE SIX CHECKS (D-NAC-STATUS-1, narduk-libs#1409). The fifteen
 * requirements below are rolled up into six by `evaluate-nac-status.ts`, which
 * adds `checks`, `status`, `upToDate`, `waivers`, `dependabot` and `freshness`.
 * R1-R15 stay at the top level for one minor because the portal's ingest reads
 * them; they are deprecated, and what decides the status is `checks`.
 *
 * THIS COMPOSES, IT DOES NOT REIMPLEMENT. Every requirement that an existing
 * foundation check already decides is answered by running that check and
 * reading its verdict. Two requirements had no check at all and are the only
 * new evaluators: requirement 2 (`evaluate-package-currency.ts`) and the
 * repository half of requirement 9 (`evaluate-mapkit-provenance.ts`).
 *
 * THE SEVEN-ITEM ARTEFACT IS UNTOUCHED. `foundation:check` keeps emitting
 * exactly the document its consumers already parse; this report is a separate
 * artefact with its own tool name and schema. Growing the ratified contract to
 * carry adoption would break every existing reader, which is the same reason
 * items 8-12 are separate commands rather than items 8-12 of that file.
 *
 * HONESTY ABOUT ENFORCEMENT. Each requirement carries the tier it is actually
 * decided at:
 *
 *   `enforced`            this command decided it from evidence it gathered.
 *   `partially-enforced`  it decided part of the claim; the rest needs
 *                         evidence this command cannot produce.
 *   `manual`             it cannot decide it at all, and says so.
 *
 * A `manual` requirement reports `unknown` and names who decides it. It is NOT
 * quietly passed, and there is no flag that turns one into a pass: a report
 * that let an operator assert "tests are meaningful" would be a worse artefact
 * than one that admits the gap. `result` is therefore the verdict over the
 * machine-decidable requirements only, and `manualReview` lists the rest, so a
 * declaration can never be read as proving more than was actually checked.
 */

import {
  coverFailingItems,
  createPortalFoundationExceptionReality,
  type FoundationCoverage,
  type FoundationExceptionReality,
} from './foundation-exception.js'
import { primeAppCheckoutConfig, type AppConfigOptions } from '../app-config/resolve.js'
import { resolveAppInfo, runFoundationCheck } from './evaluate.js'
import { runSharedUiPinnedCheck, type SharedUiPinnedArtefact } from './evaluate-shared-ui-pinned.js'
import {
  runCapabilityCoverageCheck,
  type CapabilityCoverageArtefact,
} from './evaluate-capability-coverage.js'
import {
  createFetchProbe,
  runSecurityHeadersCheck,
  type HeaderProbe,
  type SecurityHeadersArtefact,
} from './evaluate-security-headers.js'
import { runToolchainCheck, type ToolchainArtefact } from './evaluate-toolchain.js'
import {
  runDeploymentCheck,
  type DeclaredLiveProof,
  type DeploymentArtefact,
} from './evaluate-deployment.js'
import {
  GRACE_PERIOD_DAYS,
  runPackageCurrencyCheck,
  type PackageCurrencyReport,
  type PackageCurrencyRow,
} from './evaluate-package-currency.js'
import {
  runMapKitProvenanceCheck,
  type MapKitProvenanceReport,
} from './evaluate-mapkit-provenance.js'
import {
  buildNacStatus,
  createGithubDependabotReality,
  formatNacStatus,
  readWaiverConfig,
  summariseDependabot,
  NAC_STATUS_DECISION,
  type DependabotReality,
  type NacStatus,
} from './evaluate-nac-status.js'
import {
  createChallengeFallbackProbe,
  formatEgress,
  isCloudflareChallenge,
  type EgressRoute,
  type EgressSummary,
} from '../egress-fallback.js'
import { createLiveProbe, type FetchTransport, type LiveProbe } from '../live-probe.js'
import { cacheBustedUrl, DEFAULT_VERIFY_FLAGS } from '../verify-live.js'
import { FilesystemRegistryReality, type RegistryReality } from './npm-registry.js'
import type {
  FoundationAppInfo,
  FoundationCheckArtefact,
  FoundationItemResult,
  FoundationStatus,
} from './types.js'

export const ADOPTION_TOOL_NAME = '@narduk-enterprises/narduk-app-tools/adoption'
export const ADOPTION_STANDARD_SOURCE =
  'narduk-enterprises/agent-infrastructure docs/standards/NARDUK-APP-COMPLIANCE.md (D-NAC-STATUS-1)'
export const ADOPTION_REQUIREMENT_COUNT = 15
export const ADOPTION_CHECK_COUNT = 6

export type AdoptionVerdict = 'pass' | 'fail' | 'unknown' | 'not-applicable' | 'deviation'

export type AdoptionEnforcement = 'enforced' | 'partially-enforced' | 'manual'

export interface AdoptionRequirement {
  /** `R1` .. `R15`. */
  id: string
  title: string
  verdict: AdoptionVerdict
  enforcement: AdoptionEnforcement
  detail: string
  /** Commands, artefact paths, and URLs a reader can re-run or re-read. */
  evidence: string[]
  /** The repository that owns a fix when this requirement fails. */
  owner: string
}

export interface AdoptionLiveReading {
  /** The origin the caller named with `--live`. */
  url: string
  /** The route the build stamp was actually read from: the declared smoke
   * path resolved against `url`. */
  smokeUrl: string
  /** The route the health reading was actually taken from: the declared
   * health path resolved against `url`. */
  healthUrl: string
  /** The header the app declares carries its build stamp. */
  buildVersionHeader: string
  reachable: boolean
  /** The declared build-version header, or null when absent/unreachable. */
  buildVersion: string | null
  /** The commit the caller said should be live, or null when not supplied. */
  expectSha: string | null
  /** null when `expectSha` was not supplied. */
  matched: boolean | null
  /** The health route's status string, or null. */
  health: string | null
  healthOk: boolean | null
  /** The smoke route was still a Cloudflare challenge after the egress fallback,
   * so its headers describe the challenge page, not the app. */
  smokeChallenged: boolean
  /** The health route was still a Cloudflare challenge after the fallback. */
  healthChallenged: boolean
  /** `residential` when a challenged request was answered through
   * `NARDUK_APP_EGRESS_PROXY`; `direct` otherwise. */
  egress: EgressRoute
  /** The fallback's own account, present only when Cloudflare challenged a request. */
  egressDetail?: EgressSummary
}

export interface AdoptionArtefact extends NacStatus {
  /** Stays 1: the portal ingest refuses any other value and reads the R*
   * fields below. The six-check status is additive (`statusSchemaVersion`). */
  schemaVersion: 1
  tool: typeof ADOPTION_TOOL_NAME
  toolVersion: string
  generated: string
  app: FoundationAppInfo
  standard: {
    source: string
    /** The R1..R15 list, kept for one minor beside the six checks. */
    requirements: typeof ADOPTION_REQUIREMENT_COUNT
    checks: typeof ADOPTION_CHECK_COUNT
    decision: typeof NAC_STATUS_DECISION
  }
  /** Null when no `--live` was given. */
  live: AdoptionLiveReading | null
  /** Requirement 2's evidence, kept as data so a reader does not parse prose. */
  packages: PackageCurrencyRow[]
  /** Requirement 9's repository evidence. */
  mapkit: MapKitProvenanceReport
  requirements: AdoptionRequirement[]
  score: {
    pass: number
    fail: number
    unknown: number
    notApplicable: number
    deviation: number
  }
  /** Requirement ids this command cannot decide. A declaration must carry
   * separate evidence for each one. */
  manualReview: string[]
  result: 'PASS' | 'FAIL' | 'UNKNOWN' | 'DEVIATION'
  exitCode: 0 | 1 | 2 | 3
}

/** Seam for the tests: real runs fetch. */
export interface AdoptionLiveReality {
  read(url: string): Promise<{
    status: number | null
    headers: Record<string, string>
    /** True when the answer is a Cloudflare managed challenge: nothing about the app. */
    challenged?: boolean
  }>
}

export function createFetchLiveReality(probe: LiveProbe = createLiveProbe()): AdoptionLiveReality {
  return {
    async read(url) {
      const response = await probe(url)
      return {
        challenged: isCloudflareChallenge(response),
        headers: response.headers ?? {},
        status: response.status ?? null,
      }
    },
  }
}

/**
 * What to probe when the app declares nothing.
 *
 * These are only a fallback. An app that declares `deployment.liveProof`
 * -- which `foundation:check:deployment` item 12.3 already REQUIRES of an
 * adopted app -- has its own paths honoured instead. Probing these
 * regardless was narduk-libs#632: an authenticated app whose root correctly
 * refuses an anonymous request was reported as having a broken delivery path
 * and health contract, and the check rewarded the app that left its health
 * route open to anonymous callers over the one that did not.
 */
export const FALLBACK_BUILD_VERSION_HEADER = 'x-build-version'
export const FALLBACK_HEALTH_PATH = '/api/health'
export const FALLBACK_SMOKE_PATH = '/'

/** The resolved probe contract: always populated, declaration first. */
export interface LiveProofContract {
  buildVersionHeader: string
  healthAuth: 'anonymous' | 'authenticated'
  healthPath: string
  smokePath: string
  /** Same bound `verify --live --attempts` uses. Declaration, else verify's default. */
  attempts: number
  /** Seconds between those attempts. */
  intervalSeconds: number
}

/**
 * The app's declared live-proof contract, falling back to the standard's
 * defaults only where it declares nothing.
 *
 * The header name is lower-cased because that is how a response header set is
 * keyed here; `readLive` compares case-insensitively regardless.
 */
export function resolveLiveProofContract(
  declared: DeclaredLiveProof | null | undefined,
): LiveProofContract {
  return {
    buildVersionHeader: (
      declared?.buildVersionHeader ?? FALLBACK_BUILD_VERSION_HEADER
    ).toLowerCase(),
    healthAuth: declared?.healthAuth ?? 'anonymous',
    healthPath: declared?.healthPath ?? FALLBACK_HEALTH_PATH,
    smokePath: declared?.smokePath ?? FALLBACK_SMOKE_PATH,
    attempts: declared?.attempts ?? DEFAULT_VERIFY_FLAGS.attempts,
    intervalSeconds: declared?.intervalSeconds ?? DEFAULT_VERIFY_FLAGS.intervalSeconds,
  }
}

/** Header sets arrive lower-cased in practice, but a probe that did not
 * normalise would silently read every stamp as absent. */
function headerValue(headers: Record<string, string>, name: string): string | null {
  const wanted = name.toLowerCase()
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === wanted) return value
  }
  return null
}

/** A declared path resolved against the live origin. A path the app declared
 * cannot normally fail to resolve -- the schema constrains it -- so a throw
 * here falls back to the origin rather than taking down the whole report. */
function resolveAgainst(liveUrl: string, path: string): string {
  try {
    return new URL(path, liveUrl).toString()
  } catch {
    return liveUrl
  }
}

function statusToVerdict(status: FoundationStatus): AdoptionVerdict {
  if (status === 'pass') return 'pass'
  if (status === 'fail') return 'fail'
  if (status === 'not-applicable') return 'not-applicable'
  return 'unknown'
}

function subCheck(item: FoundationItemResult, id: string): FoundationStatus | null {
  return item.checks.find((check) => check.id === id)?.status ?? null
}

/** A stamp shorter than this is not evidence of anything: a one-character
 * `x-build-version` prefixes most commits, and a truncated or placeholder
 * header must not be able to produce a proof. */
export const MIN_BUILD_STAMP_LENGTH = 7

/**
 * Does the live stamp identify the expected commit?
 *
 * A deployment stamps an abbreviated SHA and the caller passes the full one,
 * so this is a prefix comparison rather than equality -- in whichever
 * direction is the abbreviation. Both sides must be long enough to mean
 * something, so a degenerate header cannot match by accident.
 */
export function matchesCommit(expectSha: string, buildVersion: string): boolean {
  const stamp = buildVersion.trim().toLowerCase()
  const commit = expectSha.trim().toLowerCase()
  if (stamp.length < MIN_BUILD_STAMP_LENGTH || commit.length < MIN_BUILD_STAMP_LENGTH) return false
  return commit.startsWith(stamp) || stamp.startsWith(commit)
}

function egressFields(
  summary: EgressSummary,
): Pick<AdoptionLiveReading, 'egress' | 'egressDetail'> {
  return {
    egress: summary.route,
    ...(summary.challenged > 0 ? { egressDetail: summary } : {}),
  }
}

export interface LiveRetry {
  /** Reads of the smoke route before a stale `--expect-sha` stamp is graded. */
  attempts: number
  intervalMs: number
  /** Overall budget, including sleeps. The same ceiling `verify --live` uses. */
  deadlineMs: number
  sleep: (ms: number) => Promise<void>
  now: () => number
  /**
   * Per-attempt cache-bust token. A fresh value each attempt: reusing the
   * first attempt's key lets a cached copy of the previous release answer
   * the whole window, which is the failure `verify --live` cache-busts.
   */
  cacheBustToken: (attempt: number) => string
}

const DEFAULT_LIVE_RETRY: LiveRetry = {
  attempts: DEFAULT_VERIFY_FLAGS.attempts,
  intervalMs: DEFAULT_VERIFY_FLAGS.intervalSeconds * 1000,
  deadlineMs: DEFAULT_VERIFY_FLAGS.deadlineMs,
  sleep: (ms) => new Promise((done) => setTimeout(done, ms)),
  now: () => performance.now(),
  cacheBustToken: (attempt) =>
    `${Date.now().toString(36)}-${String(attempt)}-${Math.random().toString(36).slice(2, 8)}`,
}

/** The URL this attempt actually fetches. With `--expect-sha`, each attempt
 * gets its own cache key; without one, the URL is unchanged. */
function attemptUrl(url: string, attempt: number, bust: boolean, retry: LiveRetry): string {
  return cacheBustedUrl(url, retry.cacheBustToken(attempt), bust)
}

async function readLive(
  liveUrl: string,
  expectSha: string | null,
  reality: AdoptionLiveReality,
  contract: LiveProofContract,
  retry: LiveRetry,
): Promise<AdoptionLiveReading> {
  const smokeUrl = resolveAgainst(liveUrl, contract.smokePath)
  const healthUrl = resolveAgainst(liveUrl, contract.healthPath)
  // R5's two reads are this one response: the build-version header and the
  // smoke document. `verify --live` retries its build-version read and its
  // smoke read together, up to `--attempts`, and busts the cache each time.
  // Grade the header on the smoke URL -- the detail names that URL -- and
  // re-read it on the same bound. Only a readable, mismatched stamp is
  // re-read: an absent header stays unknown, and no `--expect-sha` stays one
  // read of the plain URL (narduk-libs#1768, #1780, #1810, #1889).
  const bust = expectSha !== null
  const deadline = retry.now() + retry.deadlineMs
  let attempt = 1
  let smoke = await reality.read(attemptUrl(smokeUrl, attempt, bust, retry))
  while (expectSha !== null && attempt < retry.attempts) {
    const stamp =
      smoke.challenged === true ? null : headerValue(smoke.headers, contract.buildVersionHeader)
    if (stamp === null || matchesCommit(expectSha, stamp)) break
    const remaining = deadline - retry.now()
    if (remaining <= 0) break
    await retry.sleep(Math.min(retry.intervalMs, remaining))
    if (retry.now() >= deadline) break
    attempt += 1
    smoke = await reality.read(attemptUrl(smokeUrl, attempt, true, retry))
  }
  const smokeChallenged = smoke.challenged === true
  // A challenge page carries no build stamp of the app's: never read one off it.
  const buildVersion = smokeChallenged
    ? null
    : headerValue(smoke.headers, contract.buildVersionHeader)
  const base = {
    buildVersion,
    buildVersionHeader: contract.buildVersionHeader,
    egress: 'direct' as EgressRoute,
    expectSha,
    healthUrl,
    matched:
      expectSha === null || buildVersion === null ? null : matchesCommit(expectSha, buildVersion),
    reachable: smoke.status !== null && smoke.status < 500,
    smokeUrl,
    smokeChallenged,
    url: liveUrl,
  }

  let health: string | null = null
  let healthOk: boolean | null = null
  // An authenticated health route answers an anonymous read with 401 by
  // design; reading it would report that refusal as an unhealthy app
  // (narduk-libs#585). Both stay null, so R12 says why it is unknown.
  let healthChallenged = false
  if (contract.healthAuth === 'authenticated') {
    return { ...base, health, healthChallenged, healthOk }
  }
  try {
    const response = await reality.read(healthUrl)
    healthChallenged = response.challenged === true
    if (response.status !== null && !healthChallenged) {
      healthOk = response.status === 200
      health = String(response.status)
    }
  } catch {
    // A health route that cannot even be addressed leaves both null, which
    // reports as unknown rather than as a failure of a route that may not
    // exist on this app at all.
  }

  return { ...base, health, healthChallenged, healthOk }
}

/**
 * The process exit for each outcome. `0`, `1` and `2` are the convention every
 * `foundation:check:*` already uses; `3` is this report's own, for an app that
 * declares a departure from the standard rather than failing it.
 */
const EXIT_CODE: Record<AdoptionArtefact['result'], AdoptionArtefact['exitCode']> = {
  DEVIATION: 3,
  FAIL: 1,
  PASS: 0,
  UNKNOWN: 2,
}

export interface RunAdoptionCheckOptions {
  root: string
  toolVersion: string
  liveUrl?: string
  expectSha?: string
  reality?: RegistryReality
  liveReality?: AdoptionLiveReality
  appOverrides?: Partial<FoundationAppInfo>
  generated?: string
  /** Routes for requirement 8's probe. Defaults to the app's declared
   * `deployment.liveProof.smokePath` -- probing `/` on an authenticated app
   * reads the one route that refuses the request (narduk-libs#632). */
  headerPaths?: readonly string[]
  /** Item 10's probe. Injectable for the same reason `liveReality` is: without
   * it a test that passes `liveUrl` reaches the real origin, and a green
   * requirement 8 would then be evidence about production rather than about
   * this code. */
  headerProbe?: HeaderProbe
  /** Re-reads of a stale build stamp; tests shorten it. */
  liveRetry?: Partial<LiveRetry>
  /** Where `NARDUK_APP_EGRESS_PROXY` is read from; `process.env` by default. */
  env?: Record<string, string | undefined>
  /** Tests: the direct transport the default live probes send through. */
  liveTransport?: FetchTransport
  /** Tests: stands in for the CONNECT tunnel to the egress proxy. */
  egressProxyFetch?: FetchTransport
  /** The Dependabot alerts read behind check 3. Injectable like the other
   * probes: a test that reached GitHub would be evidence about GitHub. The
   * default answers `unknown` when the run's token cannot read alerts. */
  dependabotReality?: DependabotReality
  /** The portal `foundation_exception` row R4 honours for the items it names.
   * Injectable like the other probes; the default reads the portal and covers
   * nothing without a credential. */
  foundationException?: FoundationExceptionReality
  /** Portal resolution of the two app-config documents (env, fetch, timeout). */
  appConfig?: Pick<
    AppConfigOptions,
    'env' | 'fetch' | 'timeoutMs' | 'maxAttempts' | 'sleep' | 'random' | 'repo'
  >
}

export async function runAdoptionCheck(
  options: RunAdoptionCheckOptions,
): Promise<AdoptionArtefact> {
  const { root, toolVersion } = options
  await primeAppCheckoutConfig(root, options.appConfig)
  const reality = options.reality ?? new FilesystemRegistryReality(root)
  const generated = options.generated ?? new Date().toISOString()
  const app = resolveAppInfo(root, options.appOverrides)
  const shared = { appOverrides: options.appOverrides, generated, root, toolVersion }

  const foundation = await runFoundationCheck({ ...shared, reality, appConfig: options.appConfig })
  const sharedUi = await runSharedUiPinnedCheck({ ...shared, reality })
  const coverage = runCapabilityCoverageCheck(shared)
  const toolchain = runToolchainCheck(shared)
  const deployment = runDeploymentCheck(shared)
  // The grace window is measured on the report's own clock, the same instant
  // freshness and waivers read, so one artefact never mixes two "nows".
  const currency = await runPackageCurrencyCheck({ now: new Date(generated), reality, root })
  const mapkit = runMapKitProvenanceCheck(root)

  // The app's own declaration decides what gets probed. `deployment` is
  // already resolved above, so this costs no extra read.
  const liveProof = resolveLiveProofContract(deployment.declaration.liveProof)

  // The same challenge fallback `verify --live` uses: a Cloudflare challenge on
  // the direct request is retried once through NARDUK_APP_EGRESS_PROXY, and
  // fails closed to the original answer, which is then read as UNKNOWN.
  const fallback = createChallengeFallbackProbe({
    env: options.env,
    proxyFetch: options.egressProxyFetch,
  })
  const probe = fallback.wrap(createLiveProbe({}, options.liveTransport))

  const live = options.liveUrl
    ? await readLive(
        options.liveUrl,
        options.expectSha ?? null,
        options.liveReality ?? createFetchLiveReality(probe),
        liveProof,
        {
          ...DEFAULT_LIVE_RETRY,
          attempts: liveProof.attempts,
          intervalMs: liveProof.intervalSeconds * 1000,
          ...options.liveRetry,
        },
      )
    : null

  const headers = options.liveUrl
    ? await runSecurityHeadersCheck({
        ...shared,
        baseUrl: options.liveUrl,
        paths: options.headerPaths ?? [liveProof.smokePath],
        probe: options.headerProbe ?? createFetchProbe(undefined, probe),
      })
    : null
  // The headers read after the live reading; report the whole run's route.
  if (live) Object.assign(live, egressFields(fallback.summary()))

  const failingIds = [...foundation.items, sharedUi.item, coverage.item]
    .filter((item) => item.status === 'fail')
    .map((item) => item.id)
  const exceptionRow =
    failingIds.length === 0
      ? null
      : await (
          options.foundationException ?? createPortalFoundationExceptionReality({ root })
        ).read(app.repo)
  const exceptionCover = coverFailingItems(exceptionRow, app.repo, failingIds, generated)

  const requirements: AdoptionRequirement[] = [
    requirement1(deployment),
    requirement2(currency),
    requirement3(toolchain),
    requirement4(foundation, sharedUi, coverage, exceptionCover),
    requirement5(deployment, live),
    requirement6(deployment),
    requirement7(deployment),
    requirement8(headers),
    requirement9(mapkit),
    requirement10(coverage, foundation),
    requirement11(),
    requirement12(live, liveProof),
    requirement13(),
    requirement14(),
    requirement15(),
  ]

  const score = {
    deviation: requirements.filter((r) => r.verdict === 'deviation').length,
    fail: requirements.filter((r) => r.verdict === 'fail').length,
    notApplicable: requirements.filter((r) => r.verdict === 'not-applicable').length,
    pass: requirements.filter((r) => r.verdict === 'pass').length,
    unknown: requirements.filter((r) => r.verdict === 'unknown').length,
  }

  const manualReview = requirements
    .filter((r) => r.enforcement === 'manual' || r.verdict === 'unknown')
    .map((r) => r.id)

  // `result` is the verdict over what this command actually decided. A
  // requirement it cannot decide is in `manualReview`, never folded into a
  // pass -- see the header note.
  //
  // `deviation` gets its own outcome rather than collapsing into either
  // neighbour. It is not a failure: an app may declare a different deployment
  // standard deliberately, and the vocabulary exists to say so. But it is not
  // a PASS either -- PASS means "conformant to the standard as written", and
  // an automation keying on exit 0 to mean "adopted narduk-v1" would read a
  // declared departure as adoption. That is the false capability claim the
  // standard forbids, so a deviating app exits 3 and an operator decides
  // whether the departure is accepted.
  //
  // UNKNOWN outranks DEVIATION: an undecided requirement means the report
  // could not establish the facts, which has to be resolved before anyone can
  // weigh the departure.
  const decidable = requirements.filter((r) => r.enforcement !== 'manual')
  const result: AdoptionArtefact['result'] = decidable.some((r) => r.verdict === 'fail')
    ? 'FAIL'
    : decidable.some((r) => r.verdict === 'unknown')
      ? 'UNKNOWN'
      : decidable.some((r) => r.verdict === 'deviation')
        ? 'DEVIATION'
        : 'PASS'

  const dependabot = summariseDependabot(
    await (options.dependabotReality ?? createGithubDependabotReality()).read(app.repo),
  )
  const status = buildNacStatus({
    dependabot,
    generated,
    requirements,
    toolVersion,
    waiverEntries: readWaiverConfig(root),
  })

  return {
    ...status,
    app,
    exitCode: EXIT_CODE[result],
    generated,
    live,
    manualReview,
    mapkit,
    packages: currency.rows,
    requirements,
    result,
    schemaVersion: 1,
    score,
    standard: {
      checks: ADOPTION_CHECK_COUNT,
      decision: NAC_STATUS_DECISION,
      requirements: ADOPTION_REQUIREMENT_COUNT,
      source: ADOPTION_STANDARD_SOURCE,
    },
    tool: ADOPTION_TOOL_NAME,
    toolVersion,
  }
}

const OWNER_APP = 'the app repository'
const OWNER_LIBS = 'narduk-enterprises/narduk-libs'

/**
 * Item 12 reports `not-applicable` for TWO different facts, and an adoption
 * report must not confuse them:
 *
 *   - `not-adopted`: the app declares no `deployment` block. Rollout mode
 *     reports that as N/A and exits 0, which is right for a rollout gate and
 *     wrong here -- "the app never declared how it ships" is undecided, not
 *     inapplicable, and an adoption report that passed over it would be
 *     asserting a delivery path nobody wrote down.
 *   - `exempt`: the block declares a different standard. That is a deliberate,
 *     recorded departure, which is what the `deviation` verdict is for.
 *   - `invalid`: the block is present and does not parse. R1 carries check
 *     12.0. R5, R6, and R7 each say what they could not decide. R6 and R7 are
 *     not-applicable when the wrangler config has no D1 binding, or no D1, KV,
 *     or R2 binding, so one parse error is not copied onto every row.
 *
 * Every deployment-backed requirement routes through this first, so none of
 * them can read a rollout N/A as an answer.
 */
function gateOnDeploymentAdoption(
  deployment: DeploymentArtefact,
  id: string,
  title: string,
  owner: string,
): AdoptionRequirement | null {
  const evidence = ['narduk-app foundation:check:deployment', deployment.declaration.file]
  if (deployment.adoption === 'adopted') return null
  if (deployment.adoption === 'exempt') {
    return {
      detail: `${deployment.declaration.file} declares standard ${JSON.stringify(deployment.declaration.standard)}, not ${JSON.stringify('narduk-v1')}; the departure must be recorded where exemptions are`,
      enforcement: 'enforced',
      evidence,
      id,
      owner,
      title,
      verdict: 'deviation',
    }
  }
  if (deployment.adoption === 'invalid') {
    const bindings = deployment.productionBindings
    if (id === 'R6' && bindings.d1.length === 0) {
      return {
        detail: 'no D1 binding is declared',
        enforcement: 'enforced',
        evidence,
        id,
        owner,
        title,
        verdict: 'not-applicable',
      }
    }
    if (
      id === 'R7' &&
      bindings.d1.length === 0 &&
      bindings.kv.length === 0 &&
      bindings.r2.length === 0
    ) {
      return {
        detail: 'no production D1, KV, or R2 binding to isolate',
        enforcement: 'enforced',
        evidence,
        id,
        owner,
        title,
        verdict: 'not-applicable',
      }
    }
    const distinct: Record<string, string> = {
      R5: 'the delivery path is not decided because the deployment block is not a valid narduk-v1 declaration',
      R6: 'database ownership cannot be decided because the deployment block is not a valid narduk-v1 declaration',
      R7: 'preview isolation cannot be decided because the deployment block is not a valid narduk-v1 declaration',
    }
    return {
      detail:
        distinct[id] ??
        deployment.item.checks
          .filter((check) => check.id === '12.0')
          .map((check) => check.detail)
          .join('; '),
      enforcement: 'enforced',
      evidence,
      id,
      owner,
      title,
      verdict: 'fail',
    }
  }
  return {
    detail: `${deployment.declaration.file} declares no "deployment" block, so this cannot be decided from the repository`,
    enforcement: 'enforced',
    evidence,
    id,
    owner,
    title,
    verdict: 'unknown',
  }
}

/** The detail of the sub-check that actually decided an item, so a verdict
 * never travels with prose describing a different outcome. */
function decidingDetail(item: FoundationItemResult, fallback: string): string {
  const deciding = item.checks.filter((check) => check.status === item.status)
  if (deciding.length === 0) return fallback
  return deciding
    .map((check) => check.detail)
    .join('; ')
    .slice(0, 600)
}

function requirement1(deployment: DeploymentArtefact): AdoptionRequirement {
  const title = 'Truthful app contract'
  const gated = gateOnDeploymentAdoption(deployment, 'R1', title, OWNER_APP)
  if (gated) return gated
  // The repository half is decided here. Whether the declaration matches the
  // provider -- the deploy command actually configured on the Workers Builds
  // connection -- needs a live Cloudflare read this command does not make, and
  // item 12 says the same about itself.
  return {
    detail: `${deployment.declaration.file} declares ${deployment.declaration.standard} and satisfies its schema; whether the provider is configured to match is not read from here`,
    enforcement: 'partially-enforced',
    evidence: ['narduk-app foundation:check:deployment (12.0)', deployment.declaration.file],
    id: 'R1',
    owner: OWNER_APP,
    title,
    verdict: 'pass',
  }
}

function requirement2(currency: PackageCurrencyReport): AdoptionRequirement {
  const behind = currency.failures.filter((row) => row.status === 'behind')
  const grace = currency.withinGrace
  // A passing R2 is what check 5 shows on a pass, so the grace rows are named
  // here with their due dates: a pin inside the window passes, but the lag is
  // never hidden. Kept compact -- the check detail is cut at 600 characters.
  const graceNote = grace
    .map(
      (row) =>
        `${row.package.replace(/^@narduk-enterprises\//u, '')} ${row.declared} -> ${row.latest ?? '?'} (due ${row.graceDue?.slice(0, 10) ?? '?'})`,
    )
    .join(', ')
  const cleanDetail =
    grace.length === 0
      ? `all ${currency.rows.length} estate pin(s) exact, agreed and latest`
      : `all ${currency.rows.length} estate pin(s) exact and agreed; ${grace.length} behind within the ${GRACE_PERIOD_DAYS}-day grace: ${graceNote}`
  return {
    detail: (currency.clean
      ? cleanDetail
      : currency.failures.map((row) => `${row.package}: ${row.detail}`).join('; ')
    ).slice(0, 600),
    enforcement: 'enforced',
    evidence: [
      'narduk-app doctor --adoption (package table)',
      behind.length > 0
        ? `${behind.length} package(s) behind the registry outside the ${GRACE_PERIOD_DAYS}-day grace`
        : grace.length > 0
          ? `${grace.length} package(s) behind the registry within the ${GRACE_PERIOD_DAYS}-day grace`
          : 'registry comparison',
    ],
    id: 'R2',
    owner: OWNER_APP,
    title: 'Current, reproducible dependencies',
    verdict: currency.clean ? 'pass' : currency.undecided ? 'unknown' : 'fail',
  }
}

function requirement3(toolchain: ToolchainArtefact): AdoptionRequirement {
  return {
    detail: decidingDetail(
      toolchain.item,
      'one declared Node/pnpm source; every other site reads or mirrors it',
    ),
    enforcement: 'enforced',
    evidence: ['narduk-app foundation:check:toolchain'],
    id: 'R3',
    owner: OWNER_APP,
    title: 'Approved toolchain',
    verdict: statusToVerdict(toolchain.item.status),
  }
}

function requirement4(
  foundation: FoundationCheckArtefact,
  sharedUi: SharedUiPinnedArtefact,
  coverage: CapabilityCoverageArtefact,
  exception: FoundationCoverage,
): AdoptionRequirement {
  const items = [...foundation.items, sharedUi.item, coverage.item]
  const allFailed = items.filter((item) => item.status === 'fail')
  // A recorded, unexpired portal exception covers a failing item it names. The
  // item's own status is untouched; only this requirement stops counting it.
  const failed = allFailed.filter((item) => !exception.covered.includes(item.id))
  const unknown = items.filter((item) => item.status === 'unknown')
  const row = exception.row
  const coveredNote =
    row && exception.covered.length > 0
      ? `covered by foundation_exception ${row.decision} (${row.issue}) through ${row.expiresOn}: ${exception.covered.map((id) => `item ${id}`).join(', ')}`
      : null
  const expiredNote = exception.expired
    ? `foundation_exception ${exception.expired.decision} expired ${exception.expired.expiresOn}`
    : null
  const notes = [coveredNote, expiredNote].filter((note): note is string => note !== null)
  const suffix = notes.length > 0 ? `; ${notes.join('; ')}` : ''
  return {
    detail:
      failed.length > 0
        ? `failing: ${failed.map((item) => `item ${item.id}`).join(', ')}${suffix}`
        : unknown.length > 0
          ? `undecided: ${unknown.map((item) => `item ${item.id}`).join(', ')}${suffix}`
          : coveredNote
            ? `items 1-9 only; ${coveredNote}; the rest pass or are not applicable`
            : 'items 1-9 only; all pass or are not applicable',
    enforcement: 'enforced',
    evidence: [
      'narduk-app foundation:check',
      'narduk-app foundation:check:shared-ui-pinned',
      'narduk-app foundation:check:coverage',
      ...(row && exception.covered.length > 0 ? [`portal foundation_exception ${row.issue}`] : []),
    ],
    id: 'R4',
    owner: OWNER_APP,
    // Items 10-12 are R8, R3, and the deployment rows. This requirement does
    // not include them, so the label must not say the foundation evidence is complete.
    title: 'Foundation evidence (items 1-9)',
    verdict: failed.length > 0 ? 'fail' : unknown.length > 0 ? 'unknown' : 'pass',
  }
}

function requirement5(
  deployment: DeploymentArtefact,
  live: AdoptionLiveReading | null,
): AdoptionRequirement {
  const title = 'One production delivery path'
  const gated = gateOnDeploymentAdoption(deployment, 'R5', title, OWNER_APP)
  if (gated) return gated

  const repoHalf = ['12.1', '12.2', '12.3'].map((id) => subCheck(deployment.item, id))
  const evidence = [
    'narduk-app foundation:check:deployment (12.1, 12.2, 12.3)',
    ...(live
      ? [`${live.smokeUrl} ${live.buildVersionHeader}: ${live.buildVersion ?? '(absent)'}`]
      : []),
  ]
  const base = { enforcement: 'enforced' as const, evidence, id: 'R5', owner: OWNER_APP, title }

  if (repoHalf.includes('fail')) {
    return {
      ...base,
      detail: decidingDetail(
        deployment.item,
        'the declared delivery path does not upload-then-promote behind a gated check',
      ),
      verdict: 'fail',
    }
  }
  if (repoHalf.some((status) => status !== 'pass')) {
    return {
      ...base,
      detail: 'the deployment declaration does not decide the delivery path',
      verdict: 'unknown',
    }
  }
  if (live === null) {
    return {
      ...base,
      detail:
        'the declared path uploads then promotes behind a gated check; no --live given, so the deployed commit is unverified',
      enforcement: 'partially-enforced',
      verdict: 'unknown',
    }
  }
  if (live.smokeChallenged) {
    return {
      ...base,
      detail: `${live.smokeUrl} answered a Cloudflare challenge (403, cf-mitigated: challenge)${egressNote(live)}, so the deployed commit is unverified`,
      enforcement: 'partially-enforced',
      verdict: 'unknown',
    }
  }
  if (live.matched === null) {
    return {
      ...base,
      detail: live.buildVersion
        ? `live serves ${live.buildVersion}; no --expect-sha given to compare it against`
        : `${live.smokeUrl} served no ${live.buildVersionHeader} header`,
      enforcement: 'partially-enforced',
      verdict: 'unknown',
    }
  }
  return {
    ...base,
    detail: live.matched
      ? `live ${live.smokeUrl} serves ${live.buildVersion}, which is the expected commit`
      : `live ${live.smokeUrl} serves ${live.buildVersion}, which is NOT the expected commit`,
    enforcement: 'partially-enforced',
    verdict: live.matched ? 'pass' : 'fail',
  }
}

/** Why a challenged answer stayed a challenge, for a requirement's detail. */
function egressNote(live: AdoptionLiveReading): string {
  return live.egressDetail ? ` (egress ${formatEgress(live.egressDetail)})` : ''
}

function requirement6(deployment: DeploymentArtefact): AdoptionRequirement {
  const title = 'Explicit database ownership'
  const gated = gateOnDeploymentAdoption(deployment, 'R6', title, OWNER_APP)
  if (gated) return gated

  const ownership = subCheck(deployment.item, '12.8')
  return {
    detail:
      ownership === 'not-applicable'
        ? 'no D1 binding is declared'
        : ownership === 'pass'
          ? 'every declared D1 binding has exactly one schema owner'
          : decidingDetail(deployment.item, 'a declared D1 binding is uncovered or multiply owned'),
    enforcement: 'enforced',
    evidence: ['narduk-app foundation:check:deployment (12.8)'],
    id: 'R6',
    owner: OWNER_APP,
    title,
    verdict: ownership === null ? 'unknown' : statusToVerdict(ownership),
  }
}

function requirement7(deployment: DeploymentArtefact): AdoptionRequirement {
  const title = 'Isolated previews'
  const gated = gateOnDeploymentAdoption(deployment, 'R7', title, OWNER_APP)
  if (gated) return gated

  const isolated = subCheck(deployment.item, '12.4')
  return {
    detail:
      isolated === 'pass'
        ? 'a non-production branch build binds no production resource'
        : isolated === 'not-applicable'
          ? 'this app builds no non-production branch'
          : decidingDetail(
              deployment.item,
              'a non-production branch build would bind production data',
            ),
    enforcement: 'enforced',
    evidence: ['narduk-app foundation:check:deployment (12.4)'],
    id: 'R7',
    owner: OWNER_APP,
    title,
    verdict: isolated === null ? 'unknown' : statusToVerdict(isolated),
  }
}

function requirement8(headers: SecurityHeadersArtefact | null): AdoptionRequirement {
  if (headers === null) {
    return {
      detail: 'no --live given; a deployed origin is the only thing that can answer this',
      enforcement: 'enforced',
      evidence: ['narduk-app foundation:check:security-headers --base-url <url>'],
      id: 'R8',
      owner: OWNER_APP,
      title: 'Enforced security posture',
      verdict: 'unknown',
    }
  }
  return {
    detail:
      headers.item.status === 'pass'
        ? `${headers.probed.length} route(s) serve the expected headers under a nonce CSP`
        : decidingDetail(headers.item, 'the live headers could not be decided'),
    enforcement: 'enforced',
    evidence: [
      'narduk-app foundation:check:security-headers',
      ...headers.probed.map((route) => route.url),
    ],
    id: 'R8',
    owner: OWNER_APP,
    title: 'Enforced security posture',
    verdict: statusToVerdict(headers.item.status),
  }
}

function requirement9(mapkit: MapKitProvenanceReport): AdoptionRequirement {
  if (mapkit.provenance === 'not-applicable') {
    return {
      detail: mapkit.detail,
      enforcement: 'enforced',
      evidence: ['narduk-app doctor --adoption (mapkit provenance)'],
      id: 'R9',
      owner: OWNER_APP,
      title: 'Functional MapKit adoption',
      verdict: 'not-applicable',
    }
  }
  return {
    detail:
      mapkit.provenance === 'current'
        ? `${mapkit.detail}; a rendered map still needs real-SDK browser evidence`
        : mapkit.detail,
    // Provenance is decided here. "Maps function with the actual SDK and under
    // production CSP" is browser evidence this command does not produce, and
    // inferring it from a dependency line would be a false capability claim.
    enforcement: 'partially-enforced',
    evidence: [
      'narduk-app doctor --adoption (mapkit provenance)',
      'real-SDK E2E evidence: supplied by the app',
    ],
    id: 'R9',
    owner: mapkit.provenance === 'current' ? OWNER_APP : OWNER_LIBS,
    title: 'Functional MapKit adoption',
    verdict: mapkit.provenance === 'current' ? 'pass' : 'fail',
  }
}

function requirement10(
  coverage: CapabilityCoverageArtefact,
  foundation: FoundationCheckArtefact,
): AdoptionRequirement {
  const noForks = foundation.items.find((item) => item.id === 4)
  const items = [coverage.item, ...(noForks ? [noForks] : [])]
  const failed = items.filter((item) => item.status === 'fail')
  const unknown = items.filter((item) => item.status === 'unknown')
  return {
    detail:
      failed.length > 0
        ? decidingDetail(failed[0], 'a reimplementation of a shared capability was detected')
        : unknown.length > 0
          ? decidingDetail(unknown[0], 'the reimplementation scan could not be decided')
          : 'no reimplementation signal above the reporting threshold',
    // Item 9's reimplementation scan is a signal scan, not a proof of absence:
    // it reports what it recognises. A duplicated implementation it has no
    // signal for is invisible to it, which is why this is not `enforced`.
    enforcement: 'partially-enforced',
    evidence: ['narduk-app foundation:check:coverage', 'narduk-app foundation:check (item 4)'],
    id: 'R10',
    owner: OWNER_APP,
    title: 'Shared implementation ownership',
    verdict: failed.length > 0 ? 'fail' : unknown.length > 0 ? 'unknown' : 'pass',
  }
}

function requirement11(): AdoptionRequirement {
  return {
    detail:
      'read and cache ceilings, oversized-artefact refusal, and manifest-size preflight are app-specific; no shared check decides them yet',
    enforcement: 'manual',
    evidence: ["the app's own data-client tests and declared route budgets"],
    id: 'R11',
    owner: OWNER_APP,
    title: 'Bounded data reads',
    verdict: 'unknown',
  }
}

function requirement12(
  live: AdoptionLiveReading | null,
  contract: LiveProofContract,
): AdoptionRequirement {
  if (live !== null && live.healthChallenged) {
    return {
      detail: `GET ${live.healthUrl} answered a Cloudflare challenge (403, cf-mitigated: challenge)${egressNote(live)}; the app's health is unverified`,
      enforcement: 'manual',
      evidence: [live.healthUrl, "the app's own capability contract tests"],
      id: 'R12',
      owner: OWNER_APP,
      title: 'Honest capabilities and health',
      verdict: 'unknown',
    }
  }
  if (live === null || live.healthOk === null) {
    return {
      detail:
        contract.healthAuth === 'authenticated'
          ? `liveProof.healthAuth is authenticated, so ${contract.healthPath} is not read anonymously; counts, filters and freshness are checked by the app`
          : 'no live health reading; counts, filters and freshness are checked by the app',
      enforcement: 'manual',
      evidence: [`GET ${contract.healthPath}`, "the app's own capability contract tests"],
      id: 'R12',
      owner: OWNER_APP,
      title: 'Honest capabilities and health',
      verdict: 'unknown',
    }
  }
  return {
    detail: live.healthOk
      ? `GET ${live.healthUrl} answered ${live.health}; agreement between advertised and served data is the app's own contract tests`
      : `GET ${live.healthUrl} answered ${live.health}`,
    // The health route answering is decided here; whether its counts and
    // freshness agree with the data actually served is the app's contract
    // tests, which this command does not run.
    enforcement: 'partially-enforced',
    evidence: [live.healthUrl, "the app's own capability contract tests"],
    id: 'R12',
    owner: OWNER_APP,
    title: 'Honest capabilities and health',
    verdict: live.healthOk ? 'pass' : 'fail',
  }
}

function requirement13(): AdoptionRequirement {
  return {
    detail:
      'whether a test exercises the behaviour it names, and whether a skip hides required functionality, is a reading of the suite rather than a count of it',
    enforcement: 'manual',
    evidence: ["the app's own quarantine ownership and negative-probe evidence"],
    id: 'R13',
    owner: OWNER_APP,
    title: 'Meaningful tests',
    verdict: 'unknown',
  }
}

function requirement14(): AdoptionRequirement {
  return {
    detail:
      'build-versus-runtime variable classification, withheld-release visibility, uptime enrolment and recovery evidence need provider metadata this command does not read',
    enforcement: 'manual',
    evidence: ['provider build-trigger metadata', 'detector enrolment', 'recovery exercise record'],
    id: 'R14',
    owner: OWNER_APP,
    title: 'Operational readiness',
    verdict: 'unknown',
  }
}

function requirement15(): AdoptionRequirement {
  return {
    detail:
      'this artefact is the record: it carries the app SHA, checker version, package snapshot, per-requirement verdicts and evidence references',
    enforcement: 'enforced',
    evidence: ['this artefact'],
    id: 'R15',
    owner: OWNER_APP,
    title: 'Durable adoption record',
    verdict: 'pass',
  }
}

const VERDICT_LABEL: Record<AdoptionVerdict, string> = {
  deviation: 'DEV ',
  fail: 'FAIL',
  'not-applicable': 'N/A ',
  pass: 'PASS',
  unknown: 'UNK ',
}

export function formatAdoptionSummary(artefact: AdoptionArtefact): string {
  const lines: string[] = [
    `doctor --adoption -- ${artefact.app.repo}`,
    `  standard   ${artefact.standard.source}`,
    `  checker    ${artefact.toolVersion}`,
    `  commit     ${artefact.app.commit || '(unknown)'}`,
  ]
  if (artefact.live) {
    lines.push(
      `  live       ${artefact.live.smokeUrl} -> ${artefact.live.buildVersion ?? '(no header)'}`,
      `  egress     ${artefact.live.egressDetail ? formatEgress(artefact.live.egressDetail) : artefact.live.egress}`,
    )
  }
  lines.push(...formatNacStatus(artefact), '')
  lines.push(
    '  Legacy requirements R1-R15 (kept for one minor; the six checks above are the status)',
    `  score      ${artefact.score.pass}P ${artefact.score.fail}F ${artefact.score.unknown}U ${artefact.score.notApplicable}N/A` +
      (artefact.score.deviation > 0 ? ` ${artefact.score.deviation}DEV` : ''),
    '',
  )
  for (const requirement of artefact.requirements) {
    lines.push(
      `  [${VERDICT_LABEL[requirement.verdict]}] ${requirement.id} ${requirement.title} (${requirement.enforcement})`,
      `         ${requirement.detail}`,
    )
  }
  if (artefact.manualReview.length > 0) {
    lines.push(
      '',
      `  Not decided here, and a declaration needs separate evidence for each: ${artefact.manualReview.join(', ')}`,
    )
  }
  lines.push('', `RESULT: ${artefact.result}`)
  return lines.join('\n')
}
