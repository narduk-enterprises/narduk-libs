/**
 * Item 8 -- shared-ui-pinned (components-library-plan.md §2 item 6,
 * narduk-libs#253).
 *
 * Not one of the seven ratified D-WEBFOUND-2 Q9 (a) items. The evaluator
 * matches items 1-7 (`check()` sub-checks, no warn tier, applicability via
 * `not-applicable`) so it reads and tests the same way; it is invoked by
 * `foundation:check:shared-ui-pinned` rather than folded into the
 * `foundation-check.json` artefact. That artefact is the exact contract
 * company-hq `check-web-foundation.py` validates (`FOUNDATION_ITEM_COUNT` is
 * 7; an `id` outside `1..7` is a rollup-red F3 ARTEFACT finding). Widening
 * it here would break every other app's weekly rollup on upgrade. Folding
 * this in as artefact item 8 needs a company-hq script change.
 *
 * Presence policy (truthful for apps today): only exactness of the pins
 * that are present. narduk-shell is not yet published, so requiring it
 * would fail every UI app for a package that cannot be installed.
 * narduk-ui and narduk-charts are capability-specific (status apps vs
 * dashboards); the later adoption items decide who needs them. A missing
 * package is `not-applicable`, never `fail`. Consequence: a UI app that
 * has adopted none of the three still passes this item. When any of the
 * three is added, its pin must be exact (no `^`, `~`, or `workspace:`).
 *
 * "Has UI" reuses `hasNuxtUiSurface()` from `../source.js` -- item 1.1's
 * `NUXT_CONFIG_CANDIDATES` plus the pages/components directories at those
 * same monorepo prefixes (the paths item 3 / Wave-1 already walk). No
 * second detector (a `nuxt` dependency alone does not count). An app with
 * no UI surface is `not-applicable` in full (API-only).
 */

import { check } from '../schema.js'
import { collectPackages, hasNuxtUiSurface, mergedDeps, type AppRepo } from '../source.js'
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
/** Same exact-pin regex as item 2.2 -- a literal semver, optional prerelease,
 * never a range or a `workspace:` / `file:` specifier. */
const EXACT_PIN_RE = /^\d+\.\d+\.\d+(?:-[0-9A-Z.-]+)?$/i

const ITEM_8_GATE_NAME = 'app has UI'
const ITEM_8_SHELL_NAME = 'narduk-shell is an exact pin when present'
const ITEM_8_UI_NAME = 'narduk-ui is an exact pin when present'
const ITEM_8_CHARTS_NAME = 'narduk-charts is an exact pin when present'

function evaluatePresentPin(
  id: '8.1' | '8.2' | '8.3',
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
      `${pkgName} is not a dependency -- presence is not required (only an ` +
        'exact pin is, when the package is present)',
    )
  }
  if (!EXACT_PIN_RE.test(spec)) {
    return check(
      id,
      name,
      STATUS_FAIL,
      `${pkgName} is pinned as ${JSON.stringify(spec)}, not an exact version -- ` +
        'pin it to an exact version, e.g. "1.2.3", with no range and no workspace: specifier',
    )
  }
  return check(id, name, STATUS_PASS, `${pkgName} is an exact pin (${spec})`)
}

export function evaluateItem8(repo: AppRepo): FoundationSubCheck[] {
  const packages = collectPackages(repo)
  if (packages.length === 0) {
    return [
      check('8.0', ITEM_8_GATE_NAME, STATUS_UNKNOWN, 'no package.json readable at a known path'),
    ]
  }
  if (!hasNuxtUiSurface(repo)) {
    return [
      check(
        '8.0',
        ITEM_8_GATE_NAME,
        STATUS_NA,
        'no nuxt.config.* at a known path, or no pages/components directory at the ' +
          'same monorepo prefixes -- read as an API-only app',
      ),
    ]
  }

  const merged = mergedDeps(packages)
  return [
    check('8.0', ITEM_8_GATE_NAME, STATUS_PASS, 'Nuxt config and a pages/components directory exist'),
    evaluatePresentPin('8.1', ITEM_8_SHELL_NAME, NARDUK_SHELL_PACKAGE, merged),
    evaluatePresentPin('8.2', ITEM_8_UI_NAME, NARDUK_UI_PACKAGE, merged),
    evaluatePresentPin('8.3', ITEM_8_CHARTS_NAME, NARDUK_CHARTS_PACKAGE, merged),
  ]
}
