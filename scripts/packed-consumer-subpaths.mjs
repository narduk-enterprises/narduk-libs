/**
 * Export-subpath enumeration for the packed-consumer smoke gate.
 *
 * AGENTS.md § Validation: "New package releases must be installable from their
 * packed artifact by a consumer fixture outside the workspace." Until
 * narduk-libs#248 that was only half true. release-packages.mjs installed every
 * packed tarball in an external consumer, but the only package whose `exports`
 * subpaths were ever exercised there was narduk-testkit, by name, in a hardcoded
 * block. Every other package's exports map -- narduk-ui's `./tokens.css`,
 * narduk-charts's five entry points and `./style.css`, narduk-core's six plain
 * subpaths -- was believed, not proven: a subpath naming a file the `files`
 * allowlist does not ship installs cleanly and only fails in the app that
 * imports it.
 *
 * This module turns that into a per-package plan the gate runs for EVERY packed
 * package that declares an exports map. It is pure so `node --test` can cover
 * it; release-packages.mjs is an executable script with top-level side effects
 * and cannot be imported by a test.
 *
 * What the tier proves, and what it deliberately does not:
 *
 *  - Every non-pattern subpath RESOLVES from the external consumer with native
 *    Node ESM, and the file it resolves to EXISTS inside the installed tarball.
 *    The existence half is not redundant: `import.meta.resolve()` is a pure
 *    specifier-mapping operation and happily returns a URL for a target the
 *    package never shipped (verified against Node 22.22.3 -- a `"./missing":
 *    "./missing.js"` entry with no `missing.js` on disk resolves without
 *    throwing). Resolution alone would therefore pass the exact bug this tier
 *    exists to catch.
 *  - It does NOT evaluate arbitrary subpaths. Evaluation stays narduk-testkit's
 *    existing two import groups, unchanged, because they are the regression
 *    baseline for this gate. Generalising `import()` here is not safe as a
 *    blanket rule: most other subpaths are Nuxt module entries or Vue
 *    components whose evaluation needs `nuxt`, `vue`, `@nuxt/ui` or `h3` peers
 *    the fixture deliberately does not install, and several packages ship raw
 *    TypeScript (`./src/module.ts`) that native Node ESM will not run. A tier
 *    that green-lit those by accident, or that failed on an unmet peer rather
 *    than on a packaging defect, would be worse than no tier.
 *
 * `*` pattern subpaths are skipped rather than guessed at: expanding one means
 * enumerating the package's shipped files and re-implementing Node's pattern
 * matching, and a wrong expansion fails the release for a file nobody exports.
 * They are reported by name so the skip is visible in the gate's own log.
 */

/** True for an exports key Node treats as a pattern (`./app/components/*`). */
export function isPatternSubpath(subpath) {
  return subpath.includes('*')
}

/**
 * The subpath keys an `exports` field declares.
 *
 * `exports` has three legal shapes: a bare string or array (sugar for `.`), a
 * conditions object with no subpath keys (also sugar for `.`), and a subpath
 * map whose keys all start with `.`. Node rejects a mixture, and so does this:
 * a manifest that mixes them is a packaging bug the gate should name, not
 * silently half-check.
 */
export function exportSubpaths(exportsField) {
  if (exportsField === null || exportsField === undefined) return []
  if (typeof exportsField === 'string' || Array.isArray(exportsField)) return ['.']
  if (typeof exportsField !== 'object') return []

  const keys = Object.keys(exportsField)
  if (keys.length === 0) return []

  const subpathKeys = keys.filter((key) => key.startsWith('.'))
  if (subpathKeys.length === 0) return ['.']
  if (subpathKeys.length !== keys.length) {
    throw new Error(
      `exports mixes subpath keys with condition keys: ${keys.filter((key) => !key.startsWith('.')).join(', ')}`,
    )
  }
  return subpathKeys
}

/**
 * True when an exports entry offers at least one condition Node uses at
 * RUNTIME, and is therefore something `import.meta.resolve()` can be asked
 * about.
 *
 * A types-only entry -- `"./shared/types/native-auth": { "types":
 * "./shared/types/native-auth.ts" }`, which both narduk-auth and narduk-ai
 * ship -- is correct and deliberate: it exists for TypeScript's `types`
 * condition and for nothing else. Node never selects `types` when resolving,
 * so it answers ERR_PACKAGE_PATH_NOT_EXPORTED, and a tier that probed those
 * would fail the release for two manifests that are not wrong. Their target
 * files are still proven to ship, by the `publint --strict` run this gate
 * performs on each package immediately before packing it: publint packs the
 * `files` allowlist first and then reports an exports target that is not in
 * the tarball.
 */
export function hasRuntimeCondition(entry) {
  if (entry === null || entry === undefined) return false
  if (typeof entry === 'string') return true
  if (Array.isArray(entry)) return entry.some((value) => hasRuntimeCondition(value))
  if (typeof entry !== 'object') return false
  return Object.entries(entry).some(([condition, value]) =>
    condition === 'types' ? false : hasRuntimeCondition(value),
  )
}

/** `@scope/name` for `.`, `@scope/name/thing` for `./thing`. */
export function subpathSpecifier(packageName, subpath) {
  return subpath === '.' ? packageName : `${packageName}${subpath.slice(1)}`
}

/**
 * The exports entry a subpath maps to. In the two sugar shapes -- a bare
 * string/array, and a condition object with no subpath keys -- the whole field
 * IS the `.` entry, so a naive `exports['.']` lookup would read `undefined`
 * and misfile a perfectly good root export as types-only.
 */
export function exportEntry(exportsField, subpath) {
  if (typeof exportsField === 'string' || Array.isArray(exportsField)) return exportsField
  if (exportsField === null || typeof exportsField !== 'object') return exportsField
  if (Object.keys(exportsField).some((key) => key.startsWith('.'))) return exportsField[subpath]
  return exportsField
}

/**
 * The resolution plan for one manifest: the specifiers an external consumer
 * must be able to resolve, and the subpaths this tier deliberately skips.
 */
export function packageSubpathPlan(manifest) {
  const name = manifest?.name
  if (!name) throw new Error('A packed package manifest has no name.')

  const specifiers = []
  const skipped = []

  for (const subpath of exportSubpaths(manifest.exports)) {
    if (isPatternSubpath(subpath)) {
      skipped.push({ subpath, reason: 'pattern subpath' })
      continue
    }
    // `"./internal/*": null` (and its non-pattern equivalent) blocks a subpath
    // on purpose. There is nothing to resolve.
    const entry = exportEntry(manifest.exports, subpath)
    if (entry === null) {
      skipped.push({ subpath, reason: 'blocked by a null exports entry' })
      continue
    }
    if (!hasRuntimeCondition(entry)) {
      skipped.push({ subpath, reason: 'types-only exports entry (publint proves the file ships)' })
      continue
    }
    specifiers.push(subpathSpecifier(name, subpath))
  }

  return { name, specifiers, skipped }
}

/**
 * Plans for every packed package that declares an exports map, in the order the
 * caller supplied. `packages` is release-packages.mjs's `[{ manifest }]` shape.
 */
export function subpathResolutionPlans(packages) {
  return packages
    .filter(({ manifest }) => manifest?.exports !== undefined && manifest.exports !== null)
    .map(({ manifest }) => packageSubpathPlan(manifest))
    .filter(({ specifiers, skipped }) => specifiers.length > 0 || skipped.length > 0)
}

/**
 * The program the gate runs inside the external consumer, once per package.
 * Every failure names the package and the exact specifier that broke, so a red
 * release says which tarball to fix rather than "a subpath failed".
 */
export function subpathProbeProgram(packageName, specifiers) {
  if (specifiers.length === 0) throw new Error(`${packageName}: no subpaths to probe.`)
  return [
    "import { existsSync } from 'node:fs'",
    "import { fileURLToPath } from 'node:url'",
    `const packageName = ${JSON.stringify(packageName)}`,
    `const specifiers = ${JSON.stringify(specifiers)}`,
    'for (const specifier of specifiers) {',
    '  let resolved',
    '  try {',
    '    resolved = import.meta.resolve(specifier)',
    '  } catch (cause) {',
    '    throw new Error(',
    '      `${packageName}: export subpath "${specifier}" does not resolve from an external ' +
      'consumer: ${cause?.message ?? cause}`,',
    '    )',
    '  }',
    "  if (!resolved.startsWith('file:')) continue",
    '  if (!existsSync(fileURLToPath(resolved))) {',
    '    throw new Error(',
    '      `${packageName}: export subpath "${specifier}" resolves to ${resolved}, which the ' +
      'packed artifact does not contain. Check the package\\u0027s files allowlist.`,',
    '    )',
    '  }',
    '}',
    'console.log(',
    '  `Resolved ${specifiers.length} ${packageName} export subpath(s) from the packed external consumer.`,',
    ')',
  ].join('\n')
}
