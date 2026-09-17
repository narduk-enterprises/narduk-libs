/**
 * Generates `packages/tooling/narduk-app-tools/src/foundation/capability-catalog.ts`
 * from the monorepo's own package list.
 *
 * `foundation:check:coverage` (item 9) reports which shared capabilities an app
 * has adopted. That question needs the catalog of capabilities the estate
 * actually publishes, and the checker runs inside an app checkout that has no
 * narduk-libs source underneath it -- so the catalog is baked into the package
 * at build time rather than discovered at run time.
 *
 * It is DERIVED, never hand-typed: a hand-maintained list silently stops
 * describing the estate the first time a package is added, renamed or
 * unpublished, and an app would then be scored against a catalog that is
 * quietly wrong. `loadWorkspace()` resolves package directories from
 * `pnpm-workspace.yaml` (the four families, company-hq D-WEBFOUND-2 Q2 (a)), so
 * a new `packages/<family>/<name>` is picked up with no edit here.
 *
 * `--check` re-derives and compares against the committed file, exiting 1 on
 * drift. `scripts/generate-capability-catalog.test.mjs` runs that comparison
 * inside `pnpm run scripts:test`, which required CI runs on every pull request.
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import prettier from 'prettier'

import { loadWorkspace } from './compute-affected-packages.mjs'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

export const CATALOG_MODULE_RELATIVE_PATH =
  'packages/tooling/narduk-app-tools/src/foundation/capability-catalog.ts'

const ESTATE_SCOPE = '@narduk-enterprises/'

/** The capability id for a package name: the scope, and a leading `narduk-`,
 * carry no information once every entry is an `@narduk-enterprises` package.
 * `@narduk-enterprises/narduk-seo` -> `seo`; `@narduk-enterprises/eslint-config`
 * -> `eslint-config`. */
export function capabilityIdFor(packageName) {
  return packageName.slice(ESTATE_SCOPE.length).replace(/^narduk-/, '')
}

/**
 * Every published `@narduk-enterprises/*` workspace package, as one capability.
 *
 * `private: true` packages are excluded: an app cannot depend on one, so
 * offering it as a capability an app could adopt would be a lie. The excluded
 * names are returned too, so the drift test can assert the exclusion happened
 * for the reason stated rather than because a package went missing.
 */
export function deriveCapabilityCatalog(root = repoRoot) {
  const workspace = loadWorkspace(root)
  const capabilities = []
  const excluded = []
  for (const { manifest, relativeDirectory } of workspace.packages) {
    if (!manifest.name.startsWith(ESTATE_SCOPE)) continue
    if (manifest.private === true) {
      excluded.push(manifest.name)
      continue
    }
    capabilities.push({
      id: capabilityIdFor(manifest.name),
      package: manifest.name,
      family: relativeDirectory.split('/')[1],
      description: (manifest.description ?? '').trim(),
    })
  }
  capabilities.sort((left, right) => left.package.localeCompare(right.package))
  excluded.sort()
  const ids = new Set(capabilities.map((capability) => capability.id))
  if (ids.size !== capabilities.length) {
    throw new Error('Capability ids must be unique; two packages collapsed to the same id.')
  }
  if (capabilities.length === 0) {
    throw new Error('Derived an empty capability catalog; the workspace read must have failed.')
  }
  return { capabilities, excluded }
}

const quote = (value) => `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`

/** Renders the module and runs it through the repository's own Prettier
 * configuration, so the generated file satisfies `format:check` without a
 * `.prettierignore` entry that would also hide real drift from the formatter. */
export async function renderCatalogModule({ capabilities, excluded }) {
  const entries = capabilities
    .map(
      (capability) =>
        `  {\n` +
        `    id: ${quote(capability.id)},\n` +
        `    package: ${quote(capability.package)},\n` +
        `    family: ${quote(capability.family)},\n` +
        `    description: ${quote(capability.description)},\n` +
        `  },`,
    )
    .join('\n')
  const source = `/**
 * GENERATED FILE -- do not edit by hand.
 *
 * Regenerate with \`node scripts/generate-capability-catalog.mjs\`;
 * \`--check\` fails when this file falls out of step with the workspace, and
 * runs inside \`pnpm run scripts:test\`.
 *
 * The catalog of shared capabilities item 9 (\`foundation:check:coverage\`)
 * scores an app against: every published \`@narduk-enterprises/*\` package in
 * the narduk-libs workspace, derived from \`pnpm-workspace.yaml\` rather than
 * hand-typed. Private workspace packages are excluded because an app cannot
 * depend on one.
 */

export interface SharedCapability {
  /** Stable capability id: the package name without its scope or \`narduk-\` prefix. */
  id: string
  /** The published package name an app depends on to adopt this capability. */
  package: string
  /** The \`packages/<family>/\` directory the package lives in. */
  family: string
  /** The package's own \`description\`, verbatim. */
  description: string
}

export const SHARED_CAPABILITY_CATALOG: readonly SharedCapability[] = [
${entries}
]

/** Private workspace packages deliberately left out of the catalog. */
export const CATALOG_EXCLUDED_PRIVATE_PACKAGES: readonly string[] = [
${excluded.map((name) => `  ${quote(name)},`).join('\n')}
]

const BY_PACKAGE = new Map(
  SHARED_CAPABILITY_CATALOG.map((capability) => [capability.package, capability]),
)

/** The catalog entry for a package name, or \`undefined\` for a package the
 * estate does not publish from this workspace (a retired or renamed pin). */
export function capabilityForPackage(packageName: string): SharedCapability | undefined {
  return BY_PACKAGE.get(packageName)
}
`
  const modulePath = join(repoRoot, CATALOG_MODULE_RELATIVE_PATH)
  const config = await prettier.resolveConfig(modulePath)
  return prettier.format(source, { ...config, filepath: modulePath, parser: 'typescript' })
}

async function main(argv) {
  const checkOnly = argv.includes('--check')
  const modulePath = join(repoRoot, CATALOG_MODULE_RELATIVE_PATH)
  const rendered = await renderCatalogModule(deriveCapabilityCatalog(repoRoot))
  let current = null
  try {
    current = readFileSync(modulePath, 'utf8')
  } catch {
    current = null
  }
  if (current === rendered) {
    console.log(`[capability-catalog] ${CATALOG_MODULE_RELATIVE_PATH} is up to date.`)
    return 0
  }
  if (checkOnly) {
    console.error(
      `[capability-catalog] ${CATALOG_MODULE_RELATIVE_PATH} is stale.\n` +
        'Run `node scripts/generate-capability-catalog.mjs` and commit the result.',
    )
    return 1
  }
  writeFileSync(modulePath, rendered, 'utf8')
  console.log(`[capability-catalog] wrote ${CATALOG_MODULE_RELATIVE_PATH}.`)
  return 0
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  process.exitCode = await main(process.argv.slice(2))
}
