#!/usr/bin/env node
/**
 * The N-1 support window, stated for every published package (narduk-libs#1034).
 *
 * company-hq `docs/PACKAGE-STRATEGY.md` §2 defines the window for narduk-core
 * only: when a package ships a new major N, the prior major N-1 keeps security
 * and critical-bugfix backports until every then-current consumer has migrated,
 * or for 90 days, whichever is longer. narduk-libs#124 item 8 asked for the same
 * statement for every published package, and nothing in this repository
 * recorded one.
 *
 * `docs/package-support-window.json` is that statement, one entry per published
 * workspace package, in a form a checker can read. Each entry is either
 * `"n-and-n-minus-1"` -- the value `project-lifecycle.json`'s
 * `release.compatibility` enum already names -- or `"not-applicable"` with a
 * written reason.
 *
 * This script is the enforcement. `scripts/package-support-window.test.mjs`
 * runs it against the live workspace inside `pnpm run scripts:test`, which the
 * required `contracts` job (and `pnpm run preflight`) already runs, so a new
 * published package without an entry, or an entry for a package that is gone,
 * fails CI with the exact line to add or remove. Run it directly with
 * `node scripts/package-support-window.mjs`.
 */

import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { loadWorkspace } from './compute-affected-packages.mjs'

export const SUPPORT_WINDOW_FILE = 'docs/package-support-window.json'
export const N_MINUS_1 = 'n-and-n-minus-1'
export const NOT_APPLICABLE = 'not-applicable'
export const MINIMUM_DAYS = 90

const scriptRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

export function loadSupportWindow(root = scriptRoot) {
  return JSON.parse(readFileSync(join(root, SUPPORT_WINDOW_FILE), 'utf8'))
}

/** Workspace packages that publish: every package not marked `private`. */
export function publishedPackageNames(root = scriptRoot) {
  return loadWorkspace(root)
    .packages.filter((workspacePackage) => workspacePackage.manifest.private !== true)
    .map((workspacePackage) => workspacePackage.name)
}

/** Every problem with the declaration, as one line each. Empty means it holds. */
export function checkSupportWindow(declaration, publishedNames) {
  const problems = []
  const rule = declaration?.rule ?? {}
  if (rule.id !== N_MINUS_1) problems.push(`rule.id must be "${N_MINUS_1}" (got "${rule.id}").`)
  if (rule.minimumDays !== MINIMUM_DAYS) {
    problems.push(`rule.minimumDays must be ${MINIMUM_DAYS} (got ${rule.minimumDays}).`)
  }
  if (typeof rule.statement !== 'string' || rule.statement.trim() === '') {
    problems.push('rule.statement must say what the window keeps.')
  }

  const entries = declaration?.packages ?? {}
  const published = new Set(publishedNames)
  for (const name of [...published].sort()) {
    if (!Object.hasOwn(entries, name)) {
      problems.push(
        `${name} has no entry. Add it under "packages" in ${SUPPORT_WINDOW_FILE}: ` +
          `"${name}": { "compatibility": "${N_MINUS_1}" }`,
      )
    }
  }
  for (const [name, entry] of Object.entries(entries).sort(([a], [b]) => a.localeCompare(b))) {
    if (!published.has(name)) {
      problems.push(`${name} is listed but is not a published workspace package; remove its entry.`)
      continue
    }
    const compatibility = entry?.compatibility
    if (compatibility === NOT_APPLICABLE) {
      if (typeof entry.reason !== 'string' || entry.reason.trim() === '') {
        problems.push(
          `${name} is ${NOT_APPLICABLE} with no reason; say why (for example, which single consumer it has).`,
        )
      }
    } else if (compatibility !== N_MINUS_1) {
      problems.push(
        `${name} has compatibility "${compatibility}"; use "${N_MINUS_1}" or "${NOT_APPLICABLE}".`,
      )
    }
  }
  return problems
}

function main() {
  const problems = checkSupportWindow(loadSupportWindow(), publishedPackageNames())
  if (problems.length > 0) {
    console.error(`${SUPPORT_WINDOW_FILE}: ${problems.length} problem(s)`)
    for (const problem of problems) console.error(`  ${problem}`)
    process.exitCode = 1
    return
  }
  const count = publishedPackageNames().length
  console.log(`${SUPPORT_WINDOW_FILE}: all ${count} published packages state their support window.`)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main()
