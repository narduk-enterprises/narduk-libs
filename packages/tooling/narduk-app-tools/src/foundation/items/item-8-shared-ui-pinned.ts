/**
 * "Shared UI pinned" -- components-library-plan.md §2 item 6, narduk-libs#253.
 *
 * NOT one of `foundation:check`'s seven ratified items (spec §3/§4,
 * D-WEBFOUND-2 Q9 (a)) -- see `../evaluate-shared-ui-pinned.js` for why this
 * ships as its own parallel gate instead of item 8 of that fixed contract.
 * This module only holds the evaluation logic, in the same `item-N-*.ts`
 * shape every other item uses (a `check()` sub-check per condition, no warn
 * tier), so it reads and tests the same way as items 1-7.
 *
 * Rules (plan §2 item 6, narduk-libs#253 deviation record):
 *  - "Has UI" reuses item 1.1's own signal set: a `nuxt.config.*` file at any
 *    `NUXT_CONFIG_CANDIDATES` path, OR a direct `nuxt` dependency. No other
 *    item exposes a single "app kind" boolean, so this is the closest
 *    existing precedent rather than a new heuristic.
 *  - An app with no UI signal is `not-applicable` in full -- it is read as an
 *    API-only app, not a UI app that merely forgot its dependency.
 *  - `@narduk-enterprises/narduk-shell` must be present as an EXACT pin
 *    (never a range, never `workspace:`) once it is known to exist on the
 *    registry. Until a registry read resolves it, presence is `unknown`
 *    rather than a guessed `fail` -- narduk-shell has no published version
 *    yet (plan item 1 is a parallel, unlanded PR).
 *  - `@narduk-enterprises/narduk-ui` and `@narduk-enterprises/narduk-charts`
 *    are NOT required -- status apps adopt narduk-ui, dashboards adopt
 *    narduk-charts, and the later adoption items decide which apps need
 *    which. When either IS a dependency, its pin must still be exact.
 */

import { check } from '../schema.js'
import { collectPackages, mergedDeps, NUXT_CONFIG_CANDIDATES, type AppRepo } from '../source.js'
import type { RegistryReality } from '../npm-registry.js'
import {
  STATUS_FAIL,
  STATUS_NA,
  STATUS_PASS,
  STATUS_UNKNOWN,
  type FoundationSubCheck,
} from '../types.js'

const NARDUK_SHELL_PACKAGE = '@narduk-enterprises/narduk-shell'
const NARDUK_UI_PACKAGE = '@narduk-enterprises/narduk-ui'
const NARDUK_CHARTS_PACKAGE = '@narduk-enterprises/narduk-charts'
const EXACT_PIN_RE = /^\d+\.\d+\.\d+(?:-[0-9A-Z.-]+)?$/i

const ITEM_8_GATE_NAME = 'app has UI'
const ITEM_8_SHELL_NAME = 'narduk-shell is an exact pin'
const ITEM_8_UI_NAME = 'narduk-ui is an exact pin when present'
const ITEM_8_CHARTS_NAME = 'narduk-charts is an exact pin when present'

function hasUiSignal(repo: AppRepo, merged: Record<string, string>): boolean {
  if ('nuxt' in merged) return true
  return NUXT_CONFIG_CANDIDATES.some((rel) => repo.exists(rel))
}

function evaluateShellPin(
  spec: string | undefined,
  latestPublishedMajor: number | null,
): FoundationSubCheck {
  if (latestPublishedMajor === null) {
    return check(
      '8.1',
      ITEM_8_SHELL_NAME,
      STATUS_UNKNOWN,
      `${NARDUK_SHELL_PACKAGE} is not yet published to the registry (or its publication status ` +
        'could not be read from here, e.g. no registry credential); this becomes fail once it is ' +
        'published and this app is missing it or has it on a loose pin',
    )
  }
  if (!spec) {
    return check(
      '8.1',
      ITEM_8_SHELL_NAME,
      STATUS_FAIL,
      `${NARDUK_SHELL_PACKAGE} is published (latest major ${latestPublishedMajor}) but is not a ` +
        'dependency of this UI app -- add it as an exact pin',
    )
  }
  if (!EXACT_PIN_RE.test(spec)) {
    return check(
      '8.1',
      ITEM_8_SHELL_NAME,
      STATUS_FAIL,
      `${NARDUK_SHELL_PACKAGE} is pinned as ${JSON.stringify(spec)}, not an exact version -- ` +
        'pin it to an exact version, e.g. "1.2.3", with no range and no workspace: specifier',
    )
  }
  return check(
    '8.1',
    ITEM_8_SHELL_NAME,
    STATUS_PASS,
    `${NARDUK_SHELL_PACKAGE} is an exact pin (${spec})`,
  )
}

function evaluatePresentPin(
  id: '8.2' | '8.3',
  name: string,
  pkgName: string,
  merged: Record<string, string>,
): FoundationSubCheck {
  const spec = merged[pkgName]
  if (!spec) {
    return check(
      id,
      name,
      STATUS_NA,
      `${pkgName} is not a dependency -- its presence is not required (the adoption items decide ` +
        'which apps need it)',
    )
  }
  if (!EXACT_PIN_RE.test(spec)) {
    return check(
      id,
      name,
      STATUS_FAIL,
      `${pkgName} is pinned as ${JSON.stringify(spec)}, not an exact version -- pin it to an exact ` +
        'version, e.g. "1.2.3", with no range and no workspace: specifier',
    )
  }
  return check(id, name, STATUS_PASS, `${pkgName} is an exact pin (${spec})`)
}

export async function evaluateItem8(
  repo: AppRepo,
  reality: RegistryReality,
): Promise<FoundationSubCheck[]> {
  const packages = collectPackages(repo)
  if (packages.length === 0) {
    return [
      check('8.0', ITEM_8_GATE_NAME, STATUS_UNKNOWN, 'no package.json readable at a known path'),
    ]
  }
  const merged = mergedDeps(packages)
  if (!hasUiSignal(repo, merged)) {
    return [
      check(
        '8.0',
        ITEM_8_GATE_NAME,
        STATUS_NA,
        'no nuxt dependency and no nuxt.config.* file at a known path -- read as an API-only app',
      ),
    ]
  }

  const latestShellMajor = await reality.latestPublishedMajor(NARDUK_SHELL_PACKAGE)
  return [
    evaluateShellPin(merged[NARDUK_SHELL_PACKAGE], latestShellMajor),
    evaluatePresentPin('8.2', ITEM_8_UI_NAME, NARDUK_UI_PACKAGE, merged),
    evaluatePresentPin('8.3', ITEM_8_CHARTS_NAME, NARDUK_CHARTS_PACKAGE, merged),
  ]
}
