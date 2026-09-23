/**
 * Item 5 -- shared CI (spec §3 item 5, `[decided]` -- D-WF-1, both halves).
 *
 * 5.1's adoption-matrix fallback lives in company-hq
 * (`Config/workflow-adoption-matrix.json`), which an app's own CI cannot
 * read: spec §3 says so explicitly ("The app-side check cannot see the
 * matrix and must report that half `unknown`"). Everything else mirrors
 * `check-web-foundation.py`'s static evaluator.
 */

import { parse as parseYaml } from 'yaml'

import { check } from '../schema.js'
import { isRecord, parseJson, type AppRepo } from '../source.js'
import { STATUS_FAIL, STATUS_PASS, STATUS_UNKNOWN, type FoundationSubCheck } from '../types.js'

const CALLABLE_PIN_RE =
  /narduk-enterprises\/workflows\/\.github\/workflows\/[\w.-]+\.yml@(?:v1|[0-9a-f]{40})/

function evaluate51(repo: AppRepo): FoundationSubCheck {
  const workflows = repo.listWorkflows()
  const pinned: string[] = []
  let unpinned = false
  for (const name of workflows) {
    const text = repo.read(`.github/workflows/${name}`) ?? ''
    if (text.includes('narduk-enterprises/workflows/.github/workflows/')) {
      if (CALLABLE_PIN_RE.test(text)) pinned.push(name)
      else unpinned = true
    }
  }
  if (pinned.length > 0) {
    return check(
      '5.1',
      'class callable pinned @v1 or a 40-char SHA',
      STATUS_PASS,
      `calls the class callable from ${JSON.stringify(pinned)}`,
      '.github/workflows',
    )
  }
  if (unpinned) {
    return check(
      '5.1',
      'class callable pinned @v1 or a 40-char SHA',
      STATUS_FAIL,
      'a workflow calls narduk-enterprises/workflows but not at @v1 or a 40-character SHA',
      '.github/workflows',
    )
  }
  return check(
    '5.1',
    'class callable, or recorded in the adoption matrix',
    STATUS_UNKNOWN,
    "no callable found in .github/workflows, and company-hq Config/workflow-adoption-matrix.json is cross-repo -- an app's own CI cannot read it (spec §3 item 5)",
  )
}

const ITEM_5_2_NAME = 'Dependabot (preferred) or Renovate rule targeting @narduk-enterprises/**'

/** Parse `.github/dependabot.yml` (the only path Dependabot itself reads,
 * plus the `.yaml` spelling for symmetry with the two `renovate.json`
 * candidate paths below). Invalid YAML parses to `null`, same as
 * `parseJson` does for invalid JSON. */
function readDependabotConfig(repo: AppRepo): unknown {
  const text = repo.read('.github/dependabot.yml') ?? repo.read('.github/dependabot.yaml')
  if (!text) return null
  try {
    return parseYaml(text)
  } catch {
    return null
  }
}

/** D-TOOLCHAIN-1's two Dependabot-native equivalents of a Renovate
 * `packageRules[].enabled: false` / grouping rule naming the scope: a
 * `groups.*.patterns` entry matching it (grouping), or an
 * `ignore[].dependency-name` entry matching it (delegation -- narduk-libs#233,
 * mirroring borderwaitstat-us PR #19's `ignore` block). Either satisfies
 * "the scope be addressed", same as item 5.2's Renovate half only asks
 * whether a rule names the scope, not how it handles it. */
function dependabotAddressesScope(config: unknown): boolean {
  if (!isRecord(config)) return false
  const updates = config.updates
  if (!Array.isArray(updates)) return false
  const scopedRegistries = registriesNamingScope(config.registries)
  for (const update of updates) {
    if (!isRecord(update)) continue
    // The canonical coding-standards recipe (D-TOOLCHAIN-1) updates the scope
    // ungrouped, through a registry declared for it. That is a deliberate,
    // reviewed choice, not an unaddressed scope (narduk-libs#241).
    const registries = update.registries
    if (
      update['package-ecosystem'] === 'npm' &&
      Array.isArray(registries) &&
      registries.some((name) => typeof name === 'string' && scopedRegistries.has(name))
    ) {
      return true
    }
    const ignore = update.ignore
    if (Array.isArray(ignore) && JSON.stringify(ignore).includes('narduk-enterprises')) {
      return true
    }
    const groups = update.groups
    if (isRecord(groups) && JSON.stringify(groups).includes('narduk-enterprises')) {
      return true
    }
  }
  return false
}

/** Names of the top-level `registries` entries whose `scope` is the estate's. */
function registriesNamingScope(registries: unknown): Set<string> {
  const names = new Set<string>()
  if (!isRecord(registries)) return names
  for (const [name, registry] of Object.entries(registries)) {
    if (isRecord(registry) && String(registry.scope ?? '').includes('narduk-enterprises')) {
      names.add(name)
    }
  }
  return names
}

function renovateAddressesScope(renovate: unknown): boolean {
  if (!isRecord(renovate)) return false
  const rules = renovate.packageRules
  const blob = Array.isArray(rules) ? JSON.stringify(rules) : ''
  return blob.includes('narduk-enterprises')
}

function evaluate52(repo: AppRepo): FoundationSubCheck {
  const renovate =
    parseJson(repo.read('renovate.json')) ?? parseJson(repo.read('.github/renovate.json'))
  if (renovateAddressesScope(renovate)) {
    return check(
      '5.2',
      ITEM_5_2_NAME,
      STATUS_PASS,
      'renovate.json packageRules name the @narduk-enterprises scope',
      'renovate.json',
    )
  }

  const dependabot = readDependabotConfig(repo)
  if (dependabotAddressesScope(dependabot)) {
    return check(
      '5.2',
      ITEM_5_2_NAME,
      STATUS_PASS,
      'dependabot.yml groups, ignores or updates the @narduk-enterprises scope through its registry',
      '.github/dependabot.yml',
    )
  }

  if (isRecord(renovate)) {
    return check(
      '5.2',
      ITEM_5_2_NAME,
      STATUS_FAIL,
      'renovate.json has no packageRule naming the @narduk-enterprises scope, and no ' +
        '.github/dependabot.yml groups or ignores it either',
      'renovate.json',
    )
  }
  if (isRecord(dependabot)) {
    return check(
      '5.2',
      ITEM_5_2_NAME,
      STATUS_FAIL,
      'dependabot.yml has no group, ignore or scoped registry naming the @narduk-enterprises ' +
        'scope, and no renovate.json names it either',
      '.github/dependabot.yml',
    )
  }
  return check(
    '5.2',
    ITEM_5_2_NAME,
    STATUS_FAIL,
    'no renovate.json or .github/dependabot.yml at a known path',
  )
}

export function evaluateItem5(repo: AppRepo): FoundationSubCheck[] {
  return [evaluate51(repo), evaluate52(repo)]
}

/**
 * True when a `.github/dependabot.yml` npm-ecosystem update's `groups` block
 * has at least one lane whose `update-types` is exactly minor+patch (the
 * `safe` shape) and a separate lane whose `update-types` includes `major`
 * (the `majors` shape) -- the split narduk-libs#U2 / gonogo#104 introduced.
 * A group with no `update-types` at all (the old single `dependencies`
 * group) satisfies neither side.
 */
function npmGroupsSplitByUpdateType(update: Record<string, unknown>): boolean {
  const groups = update.groups
  if (!isRecord(groups)) return false
  const updateTypeSets = Object.values(groups)
    .filter(isRecord)
    .map((group) =>
      Array.isArray(group['update-types'])
        ? group['update-types'].filter((type): type is string => typeof type === 'string')
        : [],
    )
  const hasSafeLane = updateTypeSets.some(
    (types) => types.length > 0 && types.every((type) => type === 'minor' || type === 'patch'),
  )
  const hasMajorLane = updateTypeSets.some((types) => types.includes('major'))
  return hasSafeLane && hasMajorLane
}

/**
 * Advisory-only stacking-shape check for the npm ecosystem update (D-ORG-1
 * follow-up, narduk-libs#U2). This is deliberately NOT a `FoundationSubCheck`
 * folded into {@link evaluateItem5}: `types.ts` documents "No warning tier
 * (D-WEBFOUND-2 Q9 (a))" and `schema.ts`'s `rollUp()` treats anything other
 * than `pass`/`not-applicable` as gating -- even `unknown` fails CI (see
 * `commands/foundation-check.ts`'s exit-code table). Folding this in as a
 * sub-check would therefore redden CI for every app that has not yet
 * migrated to the two-lane shape, the opposite of the "start as a warning"
 * intent. It is surfaced instead as a printed advisory alongside the
 * artefact (see `runFoundationCheckCommand`), which never touches
 * `score`/`result`/`exitCode`.
 *
 * TODO(narduk-libs#U2): once the estate rollout to the two-lane shape
 * completes, fold this into a real `5.3` FAIL sub-check instead of an
 * advisory print.
 */
export function evaluateDependabotStackingShape(repo: AppRepo): string | null {
  const config = readDependabotConfig(repo)
  if (!isRecord(config)) return null
  const updates = config.updates
  if (!Array.isArray(updates)) return null

  const reasons: string[] = []
  for (const update of updates) {
    if (!isRecord(update) || update['package-ecosystem'] !== 'npm') continue
    const limit = update['open-pull-requests-limit']
    if (typeof limit === 'number' && limit > 2) {
      reasons.push(`open-pull-requests-limit is ${limit} (> 2) on the npm update`)
    }
    if (!npmGroupsSplitByUpdateType(update)) {
      reasons.push(
        'the npm update has no pair of groups split by update-types into a minor+patch ' +
          '"safe" lane and a "major" lane',
      )
    }
  }
  if (reasons.length === 0) return null
  return (
    '.github/dependabot.yml may reproduce the PR-stacking failure mode two lanes fixed ' +
    `(narduk-libs#U2, gonogo#104): ${reasons.join('; ')}`
  )
}
