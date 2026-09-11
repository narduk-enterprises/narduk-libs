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
 * Presence is registry-gated so this item enforces what item 2.2 cannot
 * (item 2.2 only fails a loose pin that is already a dependency). For each
 * of narduk-shell / narduk-ui / narduk-charts, when the app has a UI
 * surface: unpublished → `not-applicable` (presence is not yet required
 * because nothing is published); registry unreadable → `unknown`;
 * published and absent → `fail`; published and present → the exact-pin
 * check. Today that means narduk-shell (0.0.0, unpublished) is N/A and
 * narduk-ui / narduk-charts (published) are required exact pins on every
 * UI app.
 *
 * "Has UI" reuses `hasNuxtUiSurface()` from `../source.js` -- item 1.1's
 * `NUXT_CONFIG_CANDIDATES` plus the pages/components directories at those
 * same monorepo prefixes. A `nuxt` dependency alone does not count. An
 * app with no UI surface is `not-applicable` in full (API-only).
 */

import { check } from '../schema.js'
import type { RegistryReality } from '../npm-registry.js'
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
const ITEM_8_SHELL_NAME = 'narduk-shell is published and an exact pin'
const ITEM_8_UI_NAME = 'narduk-ui is published and an exact pin'
const ITEM_8_CHARTS_NAME = 'narduk-charts is published and an exact pin'

async function evaluatePublishedPin(
  id: '8.1' | '8.2' | '8.3',
  name: string,
  pkgName: string,
  merged: Record<string, string>,
  reality: RegistryReality,
): Promise<FoundationSubCheck> {
  const publication = await reality.publicationOf(pkgName)
  if (publication.status === 'unpublished') {
    return check(
      id,
      name,
      STATUS_NA,
      `${pkgName} has no published versions -- presence is not yet required because nothing is published`,
    )
  }
  if (publication.status === 'unreadable') {
    return check(
      id,
      name,
      STATUS_UNKNOWN,
      `${pkgName} publication status could not be read (no registry credential or the registry was unreachable)`,
    )
  }

  const spec = merged[pkgName]
  if (!spec) {
    return check(
      id,
      name,
      STATUS_FAIL,
      `${pkgName} is published (latest ${publication.latest}) and this app has UI but does not depend on it — add an exact pin`,
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
  return check(
    id,
    name,
    STATUS_PASS,
    `${pkgName} is an exact pin (${spec}); latest published is ${publication.latest}`,
  )
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
    check(
      '8.0',
      ITEM_8_GATE_NAME,
      STATUS_PASS,
      'Nuxt config and a pages/components directory exist',
    ),
    await evaluatePublishedPin('8.1', ITEM_8_SHELL_NAME, NARDUK_SHELL_PACKAGE, merged, reality),
    await evaluatePublishedPin('8.2', ITEM_8_UI_NAME, NARDUK_UI_PACKAGE, merged, reality),
    await evaluatePublishedPin('8.3', ITEM_8_CHARTS_NAME, NARDUK_CHARTS_PACKAGE, merged, reality),
  ]
}
