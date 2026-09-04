/**
 * Item 2 -- mandatory packages (spec §3 item 2).
 *
 * 2.1/2.2/2.4 mirror `check-web-foundation.py`'s static evaluator (same
 * package list, same exact-pin regex, same non-registry-specifier regex).
 * 2.3 (N-1 window) and the P7 eslint-config-major assertion are what this
 * tool owns: both need a RESOLVED version, which only a real install (or a
 * live registry read) can give.
 */

import { check } from '../schema.js'
import { collectPackages, mergedDeps, type AppRepo } from '../source.js'
import type { RegistryReality } from '../npm-registry.js'
import { STATUS_FAIL, STATUS_PASS, STATUS_UNKNOWN, type FoundationSubCheck } from '../types.js'

const ESTATE_SCOPE = '@narduk-enterprises/'
const EXACT_PIN_RE = /^\d+\.\d+\.\d+(?:-[0-9A-Z.-]+)?$/i
const NON_REGISTRY_SPEC_RE = /^(?:workspace:|file:|link:|git\+|git:|github:|https?:|\.{1,2}\/)/

const MANDATORY_PACKAGES = [
  '@narduk-enterprises/narduk-core',
  '@narduk-enterprises/narduk-testkit',
  '@narduk-enterprises/narduk-app-tools',
  '@narduk-enterprises/eslint-config',
] as const

const ESLINT_CONFIG_PACKAGE = '@narduk-enterprises/eslint-config'
const NARDUK_CORE_PACKAGE = '@narduk-enterprises/narduk-core'
/** D-PKG-2: "narduk-core carries an N-1 support window (prior major
 * backported ... until every then-current consumer migrates, or 90 days,
 * whichever is longer)". Read as a version-distance test: the installed
 * major must be within one of the latest published major. */
const N1_WINDOW = 1
/** P7: "eslint-config v2 ... the major-version half of 2.1 ... foundation:check
 * must assert major >= 2." */
const ESLINT_CONFIG_MIN_MAJOR = 2

export async function evaluateItem2(
  repo: AppRepo,
  reality: RegistryReality,
): Promise<FoundationSubCheck[]> {
  const packages = collectPackages(repo)
  if (packages.length === 0) {
    return [
      check(
        '2.0',
        'mandatory packages',
        STATUS_UNKNOWN,
        'no package.json readable at a known path',
      ),
    ]
  }
  const merged = mergedDeps(packages)
  const where = packages.map((p) => p.rel).join(', ')

  const missing = MANDATORY_PACKAGES.filter((p) => !(p in merged))
  const checks: FoundationSubCheck[] = [
    check(
      '2.1',
      'narduk-core, narduk-testkit, narduk-app-tools, eslint-config',
      missing.length > 0 ? STATUS_FAIL : STATUS_PASS,
      missing.length > 0
        ? `missing ${JSON.stringify(missing)}`
        : 'all four mandatory packages are depended on',
      where,
    ),
  ]

  const loose = Object.entries(merged)
    .filter(([name, spec]) => name.startsWith(ESTATE_SCOPE) && !EXACT_PIN_RE.test(spec))
    .map(([name, spec]) => `${name}@${spec}`)
    .sort()
  checks.push(
    check(
      '2.2',
      'every @narduk-enterprises/* pin is exact',
      loose.length > 0 ? STATUS_FAIL : STATUS_PASS,
      loose.length > 0
        ? `non-exact pin(s): ${JSON.stringify(loose)}`
        : `${Object.keys(merged).filter((n) => n.startsWith(ESTATE_SCOPE)).length} estate pin(s), all exact`,
      where,
    ),
  )

  checks.push(await evaluateN1Window(reality, merged))

  const nonRegistry = Object.entries(merged)
    .filter(([name, spec]) => name.startsWith(ESTATE_SCOPE) && NON_REGISTRY_SPEC_RE.test(spec))
    .map(([name, spec]) => `${name}@${spec}`)
    .sort()
  checks.push(
    check(
      '2.4',
      'no workspace:/git/tarball/file: deps on estate packages',
      nonRegistry.length > 0 ? STATUS_FAIL : STATUS_PASS,
      nonRegistry.length > 0
        ? `non-registry specifier(s): ${JSON.stringify(nonRegistry)}`
        : 'every estate dependency resolves from the registry',
      where,
    ),
  )

  checks.push(await evaluateEslintConfigMajor(reality, merged))
  return checks
}

async function evaluateN1Window(
  reality: RegistryReality,
  merged: Record<string, string>,
): Promise<FoundationSubCheck> {
  if (!(NARDUK_CORE_PACKAGE in merged)) {
    return check(
      '2.3',
      'narduk-core inside its N-1 window (D-PKG-2)',
      STATUS_UNKNOWN,
      `${NARDUK_CORE_PACKAGE} is not a dependency`,
    )
  }
  const installed = reality.resolveInstalled(NARDUK_CORE_PACKAGE, merged[NARDUK_CORE_PACKAGE])
  if (!installed) {
    return check(
      '2.3',
      'narduk-core inside its N-1 window (D-PKG-2)',
      STATUS_UNKNOWN,
      `could not resolve the installed ${NARDUK_CORE_PACKAGE} version from node_modules or its manifest pin`,
    )
  }
  const latestMajor = await reality.latestPublishedMajor(NARDUK_CORE_PACKAGE)
  if (latestMajor === null) {
    return check(
      '2.3',
      'narduk-core inside its N-1 window (D-PKG-2)',
      STATUS_UNKNOWN,
      `installed ${NARDUK_CORE_PACKAGE}@${installed.version} (major ${installed.major}), but the published version list could not be read (no registry credential or the registry was unreachable)`,
    )
  }
  const distance = latestMajor - installed.major
  if (distance < 0) {
    return check(
      '2.3',
      'narduk-core inside its N-1 window (D-PKG-2)',
      STATUS_UNKNOWN,
      `installed major ${installed.major} exceeds the highest published major ${latestMajor}; the registry read is inconsistent`,
    )
  }
  return check(
    '2.3',
    'narduk-core inside its N-1 window (D-PKG-2)',
    distance <= N1_WINDOW ? STATUS_PASS : STATUS_FAIL,
    distance <= N1_WINDOW
      ? `installed major ${installed.major} is within N-1 of latest published major ${latestMajor}`
      : `installed major ${installed.major} is ${distance} majors behind latest published major ${latestMajor}, outside the N-1 window (D-PKG-2)`,
  )
}

async function evaluateEslintConfigMajor(
  reality: RegistryReality,
  merged: Record<string, string>,
): Promise<FoundationSubCheck> {
  if (!(ESLINT_CONFIG_PACKAGE in merged)) {
    return check(
      '2.1b',
      'eslint-config resolves to major >= 2 (P7)',
      STATUS_UNKNOWN,
      `${ESLINT_CONFIG_PACKAGE} is not a dependency`,
    )
  }
  const installed = reality.resolveInstalled(ESLINT_CONFIG_PACKAGE, merged[ESLINT_CONFIG_PACKAGE])
  if (!installed) {
    return check(
      '2.1b',
      'eslint-config resolves to major >= 2 (P7)',
      STATUS_UNKNOWN,
      `could not resolve the installed ${ESLINT_CONFIG_PACKAGE} version from node_modules or its manifest pin`,
    )
  }
  return check(
    '2.1b',
    'eslint-config resolves to major >= 2 (P7)',
    installed.major >= ESLINT_CONFIG_MIN_MAJOR ? STATUS_PASS : STATUS_FAIL,
    `resolved ${ESLINT_CONFIG_PACKAGE}@${installed.version} (${installed.source}), major ${installed.major}`,
  )
}
