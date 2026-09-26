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
 * WHAT THIS ITEM ENFORCES (narduk-libs#277, #282 review)
 * -----------------------------------------------------
 * Exactly one rule, decided from the app's own manifests:
 *
 *     if the app depends on a shared-UI package, that pin must be exact.
 *
 * It does NOT require an app to take a dependency it does not use. An
 * earlier revision registry-gated presence -- "narduk-charts is published,
 * therefore every UI app must depend on it" -- which conflated *published*
 * with *required* and would have made a charting library mandatory on fleet
 * apps that draw no charts. `PRESENCE_REQUIRED` below is the one place a
 * genuine estate-wide requirement would be recorded, and it is deliberately
 * empty; see its comment for what would have to change first.
 *
 * NO CREDENTIAL IS NEEDED (narduk-libs#282 review, task 2)
 * -------------------------------------------------------
 * Exact-pin discipline is a manifest fact, so this item never needs a
 * registry read to reach a verdict, and a missing `NODE_AUTH_TOKEN` can no
 * longer turn the command into exit 2. That matters because the generated CI
 * in `create-narduk-app`'s `ci-workflow.ts` deliberately scopes the GitHub
 * Packages token to the install step
 * (`NPM_CONFIG_USERCONFIG="$auth_file" ... pnpm install --frozen-lockfile`)
 * so it is not ambient for the rest of the job; a check that demanded an
 * ambient token could not be wired into that workflow at all.
 * `RegistryReality` is still accepted and consulted, but only to ANNOTATE an
 * already-decided sub-check with the latest published version. An unreadable
 * registry drops the annotation and changes no status.
 *
 * "Has UI" reuses `hasNuxtUiSurface()` from `../source.js` -- item 1.1's
 * `NUXT_CONFIG_CANDIDATES` plus the pages/components directories at those
 * same monorepo prefixes. A `nuxt` dependency alone does not count. An app
 * with no UI surface is `not-applicable` in full (API-only).
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

export const NARDUK_SHELL_PACKAGE = '@narduk-enterprises/narduk-shell'
export const NARDUK_UI_PACKAGE = '@narduk-enterprises/narduk-ui'
export const NARDUK_CHARTS_PACKAGE = '@narduk-enterprises/narduk-charts'

/** The shared-UI packages this item knows about, in sub-check order. */
export const SHARED_UI_PACKAGES = [
  { id: '8.1', pkg: NARDUK_SHELL_PACKAGE },
  { id: '8.2', pkg: NARDUK_UI_PACKAGE },
  { id: '8.3', pkg: NARDUK_CHARTS_PACKAGE },
] as const

/**
 * Shared-UI packages the estate requires of EVERY UI app, so that their
 * absence is itself a failure rather than a capability the app did not need.
 *
 * EMPTY, and that is the finding, not an oversight:
 *
 * - `narduk-charts` is a charting library. Nothing makes a chart mandatory on
 *   an app that draws none; requiring it would be inventing a rule out of the
 *   fact that the package happens to be published.
 * - `narduk-ui` is, by its own README, the `Ns*` status instruments "for the
 *   status apps" plus the `--ns-*` token layer. Capability-specific in the
 *   same way.
 * - `narduk-shell` is the only one with estate-wide ambition ("so that no
 *   Nuxt app in the estate writes its own again"). It is still `0.0.0` and
 *   unpublished, and D-WEBFOUND-2's 2026-09-11 amendment says where the `Ne*`
 *   suite LIVES, not that every app must consume it. The plan sentence that
 *   asserted presence for all three (components-library-plan.md §2 item 6) is
 *   exactly the claim narduk-libs#277 found unjustified.
 *
 * Adding an entry here is a policy change: it needs a dated company-hq
 * decision that names the package and "every UI app", cited in the comment
 * beside the entry. `tests/foundation/item-8-shared-ui-pinned.test.ts` pins
 * the set as empty so an addition cannot land silently.
 */
export const PRESENCE_REQUIRED: readonly string[] = []

/** Same exact-pin regex as item 2.2 -- a literal semver, optional prerelease,
 * never a range or a `workspace:` / `file:` specifier. */
const EXACT_PIN_RE = /^\d+\.\d+\.\d+(?:-[0-9A-Z.-]+)?$/i

const ITEM_8_GATE_NAME = 'app has UI'

function subCheckName(pkgName: string): string {
  return `${pkgName.slice(pkgName.indexOf('/') + 1)} is an exact pin if depended on`
}

/** Best-effort "latest published is x.y.z" tail for a sub-check detail. Never
 * changes a status: an unreadable, unpublished, or throwing registry simply
 * contributes nothing. */
async function publishedSuffix(pkgName: string, reality: RegistryReality): Promise<string> {
  try {
    const publication = await reality.publicationOf(pkgName)
    return publication.status === 'published' ? `; latest published is ${publication.latest}` : ''
  } catch {
    return ''
  }
}

async function evaluateSharedUiPin(
  id: string,
  pkgName: string,
  merged: Record<string, string>,
  reality: RegistryReality,
): Promise<FoundationSubCheck> {
  const name = subCheckName(pkgName)
  const spec = merged[pkgName]

  if (spec === undefined) {
    return PRESENCE_REQUIRED.includes(pkgName)
      ? check(
          id,
          name,
          STATUS_FAIL,
          `${pkgName} is required of every UI app and is not a dependency -- add an exact pin`,
        )
      : check(
          id,
          name,
          STATUS_NA,
          `${pkgName} is not a dependency of this app -- it is capability-specific, so its ` +
            'absence is not a finding (see PRESENCE_REQUIRED)',
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
    `${pkgName} is an exact pin (${spec})${await publishedSuffix(pkgName, reality)}`,
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
  const checks: FoundationSubCheck[] = [
    check(
      '8.0',
      ITEM_8_GATE_NAME,
      STATUS_PASS,
      'Nuxt config and a pages/components directory exist',
    ),
  ]
  for (const { id, pkg } of SHARED_UI_PACKAGES) {
    checks.push(await evaluateSharedUiPin(id, pkg, merged, reality))
  }
  return checks
}

export const NUXT_UI_PACKAGE = '@nuxt/ui'

/**
 * Advisories: warnings that never change a status or the exit code
 * (narduk-libs#1033). narduk-auth, narduk-seo, narduk-analytics and narduk-ai
 * render Nuxt UI components and declare `@nuxt/ui` as an exact peer, as
 * narduk-core and narduk-shell pin it. An app that depends on `@nuxt/ui`
 * through a range can resolve a different version from the one those
 * components were built against.
 *
 * Logan, 2026-09-26 (askme, verbatim): "Peers + warn-level check
 * (Recommended)" -- warn first, then ratchet, as his #973 answer set. Statuses
 * keep D-WEBFOUND-2 Q9 (a)'s "no warning tier", so the warning lives beside
 * the sub-checks rather than as one. Ratcheting it means adding
 * `{ id: '8.4', pkg: NUXT_UI_PACKAGE }` to `SHARED_UI_PACKAGES` and dropping
 * this function.
 */
export function nuxtUiPinAdvisories(repo: AppRepo): string[] {
  const packages = collectPackages(repo)
  if (packages.length === 0 || !hasNuxtUiSurface(repo)) return []
  const spec = mergedDeps(packages)[NUXT_UI_PACKAGE]
  if (spec === undefined || EXACT_PIN_RE.test(spec)) return []
  return [
    `${NUXT_UI_PACKAGE} is pinned as ${JSON.stringify(spec)}, not an exact version. ` +
      'Narduk modules render Nuxt UI and peer on an exact version; pin it exactly, ' +
      'e.g. "4.11.1". A warning today; it becomes a failing sub-check later (narduk-libs#1033).',
  ]
}
