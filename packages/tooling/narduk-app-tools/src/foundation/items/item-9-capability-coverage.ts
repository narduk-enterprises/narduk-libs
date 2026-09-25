/**
 * Item 9 -- shared-capability coverage (company-hq
 * `docs/NARDUK-APP-COMPLIANCE.md` §3.9 and §3.3; Logan, 2026-09-17: "Coverage
 * item in foundation:check ... The checker lists which @narduk-enterprises
 * packages the app pins and flags known app-local reimplementations (local
 * logger, SEO helpers, analytics wrappers, health routes); result feeds the
 * estate roster.").
 *
 * NOT one of the seven ratified D-WEBFOUND-2 Q9 (a) items, for exactly the
 * reason item 8 is not: `foundation-check.json` is the precise 7-item contract
 * company-hq `check-web-foundation.py` `validate_artefact()` consumes, and an
 * `id` outside `1..7` is a rollup-red F3 ARTEFACT finding that would break every
 * app's weekly rollup on upgrade. 9 is the next free number after item 8
 * `shared-ui-pinned` in the narduk-libs-owned extension series, and it ships the
 * same way: its own command, its own artefact, the same `check()` / `rollUp()`
 * vocabulary.
 *
 * THE VERDICTS
 * ------------
 * The four `FoundationStatus` values carry the brief's vocabulary unchanged:
 * `pass` is *proven* (the app was scanned and no reimplementation was found),
 * `fail` is a *gap*, `unknown` is undecided, `not-applicable` is a surface the
 * app does not have. There is deliberately no fifth status: a heuristic-only
 * match is `unknown` rendered as **WARN**, carrying `confidence: 'heuristic'`
 * in the artefact, because "we found code doing a shared package's job but
 * cannot prove it is a fork" is precisely what `unknown` already means here --
 * never a pass, and never a decided failure. A *confirmed* match is a `fail`
 * rendered as **FAIL**, naming the exact file path and the owning package.
 *
 * TWO PARTS, THE SUB-CHECKS
 * --------------------------
 *   9.0  the app has a readable manifest (gate)
 *   9.1  inventory: every `@narduk-enterprises/*` pin, and catalog coverage
 *   9.2  every estate pin resolves to a published capability
 *   9.3  no app-local logger        -> @narduk-enterprises/narduk-logging
 *   9.4  no copied SEO helpers      -> @narduk-enterprises/narduk-seo
 *   9.5  no direct posthog-js use   -> @narduk-enterprises/narduk-analytics
 *   9.6  no hand-rolled health route-> @narduk-enterprises/narduk-core
 *   9.7  no duplicate error plugin  -> @narduk-enterprises/narduk-logging
 *   9.8  no hand-rolled data.nard.uk reader -> @narduk-enterprises/narduk-core
 */

import {
  collectCapabilityInventory,
  mergedEstateDeps,
  type CapabilityInventory,
  type CapabilityRow,
} from '../capability-inventory.js'
import {
  NARDUK_ANALYTICS,
  NARDUK_CORE,
  NARDUK_LOGGING,
  NARDUK_SEO,
  POSTHOG_PACKAGE,
  detectAppLocalLogger,
  detectCopiedSeoHelpers,
  detectDirectPosthogUse,
  detectDuplicateErrorPlugins,
  detectHandRolledHealthRoute,
  detectHandRolledNardukDataReader,
  hasNitroPluginSurface,
  hasServerApiSurface,
  scanAppSource,
  type Detection,
  type SourceScan,
} from '../reimplementation-signals.js'
import { check } from '../schema.js'
import type { AppRepo } from '../source.js'
import {
  STATUS_FAIL,
  STATUS_NA,
  STATUS_PASS,
  STATUS_UNKNOWN,
  type FoundationSubCheck,
} from '../types.js'

export const CAPABILITY_COVERAGE_ITEM_ID = 9
export const CAPABILITY_COVERAGE_ITEM_NAME = 'shared-capability-coverage'

export type DetectionConfidence = 'confirmed' | 'heuristic'

/** One reported reimplementation, carried verbatim in the artefact so the
 * estate roster reads the file path and the owning package as data rather than
 * parsing them back out of a sentence. */
export interface CoverageDetection {
  /** The sub-check that reported it, e.g. `9.3`. */
  subCheck: string
  /** Catalog capability id the finding belongs to, e.g. `logging`. */
  capability: string
  /** The package that already owns this behaviour. */
  ownedBy: string
  confidence: DetectionConfidence
  /** Repo-relative path of the offending file. For a manifest-level signal (a
   * direct vendor pin with no import in the scanned source) this is the
   * manifest that carries the pin. */
  path: string
  detail: string
}

export interface CapabilityCoverageEvaluation {
  checks: FoundationSubCheck[]
  inventory: CapabilityInventory
  detections: CoverageDetection[]
  /** Directories that were walked, and whether the file ceiling was reached. */
  scan: { directories: string[]; files: number; truncated: boolean }
}

interface DetectorSpec {
  id: string
  name: string
  capability: string
  /** Packages whose presence makes a hit `confirmed` rather than `heuristic`. */
  owners: readonly string[]
  /** The one package named in a finding as the owner of the behaviour. */
  ownedBy: string
  run: (scan: SourceScan) => Detection[]
  /** `false` when the app has no surface this detector could apply to. */
  applicable: boolean
  /** Why it is not applicable, when `applicable` is false. */
  notApplicableDetail?: string
  /** Extra manifest-level hits, always heuristic. */
  manifestHits?: Detection[]
}

const EMPTY_SCAN_DETAIL =
  'no app source directory at a known monorepo path (app/, src/, server/, components/, ...), ' +
  'so no reimplementation could be looked for'

function confidenceFor(merged: Record<string, string>, owners: readonly string[]) {
  return owners.some((owner) => owner in merged) ? 'confirmed' : ('heuristic' as const)
}

function runDetector(
  spec: DetectorSpec,
  scan: SourceScan,
  merged: Record<string, string>,
): { check: FoundationSubCheck; detections: CoverageDetection[] } {
  if (!spec.applicable) {
    return {
      check: check(
        spec.id,
        spec.name,
        STATUS_NA,
        spec.notApplicableDetail ?? 'surface not present',
      ),
      detections: [],
    }
  }
  if (scan.files.length === 0) {
    return { check: check(spec.id, spec.name, STATUS_UNKNOWN, EMPTY_SCAN_DETAIL), detections: [] }
  }

  const confidence = confidenceFor(merged, spec.owners)
  const detections: CoverageDetection[] = spec.run(scan).map((hit) => ({
    subCheck: spec.id,
    capability: spec.capability,
    ownedBy: spec.ownedBy,
    confidence,
    path: hit.path,
    detail: hit.detail,
  }))
  for (const hit of spec.manifestHits ?? []) {
    detections.push({
      subCheck: spec.id,
      capability: spec.capability,
      ownedBy: spec.ownedBy,
      confidence: 'heuristic',
      path: hit.path,
      detail: hit.detail,
    })
  }

  if (detections.length === 0) {
    const suffix = scan.truncated
      ? ` (scan stopped at the ${scan.files.length}-file ceiling, so this is a bounded pass)`
      : ''
    return {
      check: check(
        spec.id,
        spec.name,
        scan.truncated ? STATUS_UNKNOWN : STATUS_PASS,
        `scanned ${scan.files.length} file(s); no ${spec.capability} reimplementation found${suffix}`,
      ),
      detections: [],
    }
  }

  const confirmed = detections.filter((d) => d.confidence === 'confirmed')
  const reported = confirmed.length > 0 ? confirmed : detections
  const detail = reported.map((d) => `${d.path} ${d.detail} -- owned by ${d.ownedBy}`).join('; ')
  return {
    check: check(
      spec.id,
      spec.name,
      confirmed.length > 0 ? STATUS_FAIL : STATUS_UNKNOWN,
      confirmed.length > 0
        ? detail
        : `${detail}; heuristic match (WARN), not a proven fork -- ${
            spec.owners.some((owner) => owner in merged)
              ? 'the signal is a manifest pin with no matching import in the scanned source'
              : `${spec.ownedBy} is not a dependency, so nothing proves this is a fork rather than app-owned code`
          }`,
      reported[0].path,
    ),
    detections,
  }
}

/** `mapkit (7 files, 3738 lines: utils/mapkit/marks.ts, ...)`. */
export function forkList(forked: readonly CapabilityRow[]): string {
  return forked
    .map((capability) => {
      const fork = capability.fork
      if (!fork) return capability.id
      const shown = fork.files.slice(0, 3).join(', ')
      const more = fork.files.length > 3 ? `, +${fork.files.length - 3} more` : ''
      return `${capability.id} (${fork.files.length} file(s), ${fork.lines} line(s): ${shown}${more})`
    })
    .join('; ')
}

function inventoryChecks(inventory: CapabilityInventory): FoundationSubCheck[] {
  const adopted = inventory.capabilities.filter((capability) => capability.adopted)
  const forked = inventory.capabilities.filter((capability) => capability.state === 'forked')
  // A fork is visible here and never counted as adopted, but it is not a
  // failure: some forks are deliberate and tracked (narduk-libs#620).
  const inventoryCheck = check(
    '9.1',
    'estate dependency inventory and capability coverage',
    STATUS_PASS,
    `${inventory.dependencies.length} @narduk-enterprises pin(s) across ` +
      `${inventory.manifests.length} manifest(s) (${inventory.manifests.join(', ')}); ` +
      `${adopted.length}/${inventory.capabilities.length} shared capabilities adopted` +
      (adopted.length > 0 ? `: ${adopted.map((c) => c.id).join(', ')}` : '') +
      (forked.length > 0 ? `; forked (pinned, with an app-local copy): ${forkList(forked)}` : ''),
    inventory.manifests[0],
  )

  const resolvesCheck =
    inventory.unclassified.length === 0
      ? check(
          '9.2',
          'every estate pin resolves to a published shared capability',
          STATUS_PASS,
          'every @narduk-enterprises pin maps to a package this workspace publishes',
        )
      : check(
          '9.2',
          'every estate pin resolves to a published shared capability',
          STATUS_UNKNOWN,
          `${JSON.stringify(inventory.unclassified)} is not published from the narduk-libs ` +
            'workspace -- a retired, renamed, or externally published package the roster ' +
            'cannot classify',
        )

  return [inventoryCheck, resolvesCheck]
}

export function evaluateItem9(repo: AppRepo): CapabilityCoverageEvaluation {
  const { packages, inventory } = collectCapabilityInventory(repo)
  if (packages.length === 0) {
    return {
      checks: [
        check(
          '9.0',
          'app manifest is readable',
          STATUS_UNKNOWN,
          'no package.json readable at a known monorepo-candidate path',
        ),
      ],
      inventory,
      detections: [],
      scan: { directories: [], files: 0, truncated: false },
    }
  }

  const merged = mergedEstateDeps(packages)
  const scan = scanAppSource(repo)
  // A direct `posthog-js` pin with no import anywhere in the scanned source is
  // still worth naming, but only as a heuristic: the code using it may live
  // outside the bounded scan, or the pin may simply be stale.
  const orphanPosthogPin =
    POSTHOG_PACKAGE in merged && detectDirectPosthogUse(scan.files).length === 0

  const specs: DetectorSpec[] = [
    {
      id: '9.3',
      name: 'no app-local logger implementation',
      capability: 'logging',
      owners: [NARDUK_LOGGING, NARDUK_CORE],
      ownedBy: NARDUK_LOGGING,
      run: (s) => detectAppLocalLogger(s.files),
      applicable: true,
    },
    {
      id: '9.4',
      name: 'no app-local copy of narduk-seo helpers',
      capability: 'seo',
      owners: [NARDUK_SEO],
      ownedBy: NARDUK_SEO,
      run: (s) => detectCopiedSeoHelpers(s.files),
      applicable: true,
    },
    {
      id: '9.5',
      name: 'no analytics wrapper around posthog-js',
      capability: 'analytics',
      owners: [NARDUK_ANALYTICS],
      ownedBy: NARDUK_ANALYTICS,
      run: (s) => detectDirectPosthogUse(s.files),
      applicable: true,
      manifestHits: orphanPosthogPin
        ? [
            {
              path: inventory.manifests[0],
              detail: `pins ${POSTHOG_PACKAGE} directly with no import in the scanned source`,
            },
          ]
        : [],
    },
    {
      id: '9.6',
      name: 'no hand-rolled /api/health route',
      capability: 'core',
      owners: [NARDUK_CORE],
      ownedBy: NARDUK_CORE,
      run: (s) => detectHandRolledHealthRoute(s.files),
      applicable: hasServerApiSurface(repo),
      notApplicableDetail: 'no server/api directory at a known monorepo path',
    },
    {
      id: '9.7',
      name: 'no duplicate error plugin or response finish listener',
      capability: 'logging',
      owners: [NARDUK_LOGGING, NARDUK_CORE],
      ownedBy: NARDUK_LOGGING,
      run: (s) => detectDuplicateErrorPlugins(s.files),
      applicable: hasNitroPluginSurface(repo, scan.files),
      notApplicableDetail: 'no server/plugins directory and no defineNitroPlugin in the scan',
    },
    {
      id: '9.8',
      name: 'no hand-rolled narduk-data product reader',
      capability: 'core',
      owners: [NARDUK_CORE],
      ownedBy: NARDUK_CORE,
      run: (s) => detectHandRolledNardukDataReader(s.files),
      applicable: true,
    },
  ]

  const checks: FoundationSubCheck[] = [
    check(
      '9.0',
      'app manifest is readable',
      STATUS_PASS,
      `read ${packages.length} manifest(s): ${inventory.manifests.join(', ')}`,
    ),
    ...inventoryChecks(inventory),
  ]
  const detections: CoverageDetection[] = []
  for (const spec of specs) {
    const result = runDetector(spec, scan, merged)
    checks.push(result.check)
    detections.push(...result.detections)
  }

  return {
    checks,
    inventory,
    detections,
    scan: { directories: scan.directories, files: scan.files.length, truncated: scan.truncated },
  }
}
