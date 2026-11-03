/**
 * Generates `packages/tooling/eslint-config/src/rules/utils/shared-exports.ts`,
 * the function, const and class names the shared app-family packages export,
 * for `narduk/no-shadowed-shared-export` (narduk-libs#2126).
 *
 * A lint rule cannot resolve an app's installed packages, so the names are
 * baked in at build time -- the way `shared-components.ts` is for components --
 * and DERIVED from each package's `exports` map rather than hand-typed. A
 * hand-kept list stops describing the packages the first time one adds,
 * renames or drops an export.
 *
 * Derivation: for every non-private package in `packages/{modules,design,
 * contracts}`, resolve each `exports` target to its source file (a `dist/`
 * target maps to `src/`), then collect the top-level function, const and class
 * names that module exports, following `export *` and `export { x } from`
 * through relative paths. Types, interfaces and `default` are not shadowing
 * candidates. A target that cannot be resolved throws: dropping it silently
 * would let the list lose a package without a failing test.
 *
 * Filters, matching agent-infrastructure `scripts/libs_find.py` so the lint
 * rule and `libs-find --scan` agree on what a candidate is: names under six
 * characters, SCREAMING_CASE constants, the generic words in `GENERIC_NAMES`,
 * and exports defined under `database/`, a `drizzle` directory, `shims/` or a path
 * naming `schema` (tables and dependency shims share names by convention, not
 * by copying).
 *
 * `--check` re-derives and compares against the committed file, exiting 1 on
 * drift. `scripts/generate-shared-exports.test.mjs` runs inside `pnpm run
 * scripts:test` and fails only when the committed list names an export a
 * package no longer has (a stale name is a false warning); a package gaining a
 * new export is picked up at the next regeneration rather than failing every
 * unrelated pull request.
 */

import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import prettier from 'prettier'
import ts from 'typescript'

import { loadWorkspace } from './compute-affected-packages.mjs'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

export const SHARED_EXPORTS_MODULE_RELATIVE_PATH =
  'packages/tooling/eslint-config/src/rules/utils/shared-exports.ts'

const ESTATE_SCOPE = '@narduk-enterprises/'

/** Families whose exports app code would otherwise write; tooling (eslint,
 * the generator, testkit) is never a duplicate finding. */
const APP_FAMILIES = ['packages/modules/', 'packages/design/', 'packages/contracts/']

export const MIN_NAME_LENGTH = 6

/** Names too generic to call a copy: each is ordinary local vocabulary in any
 * app. Copied from agent-infrastructure `scripts/libs_find.py` `GENERIC`. */
export const GENERIC_NAMES = new Set([
  'config',
  'handler',
  'default',
  'options',
  'schema',
  'client',
  'router',
  'routes',
  'request',
  'response',
  'context',
  'logger',
  'plugin',
  'setup',
  'state',
  'render',
  'parse',
  'format',
  'create',
  'update',
  'remove',
  'delete',
  'items',
  'value',
  'values',
  'result',
  'error',
  'errors',
  'fetcher',
  'loader',
  'module',
  'service',
  'store',
  'theme',
  'colors',
  'labels',
  'columns',
  'filters',
  'messages',
  'metadata',
  'version',
  'headers',
  'isRecord',
  'isObject',
  'isString',
  'isNumber',
  'noop',
  'sleep',
  'assert',
  'invariant',
  'identity',
  'useHead',
  'useSeoMeta',
  'defineConfig',
  'getConfig',
  'normalize',
  'validate',
  'serialize',
  'toJSON',
])

const SKIPPED_SOURCE = /\/(database|drizzle[^/]*|shims)\/|schema/
const SOURCE_SUFFIX = /\.(?:[cm]?[jt]s)$/
const NON_SOURCE_TARGET = /\.(?:vue|css|json|md|sql|d\.[cm]?ts)$/
const TEST_FILE = /\.(?:test|spec)\./

/** Built targets whose source is not the `src/` mirror of their path. */
const SOURCE_OVERRIDES = {
  '@narduk-enterprises/narduk-charts': { './dist/narduk-charts.js': 'src/index.ts' },
}

const toPosix = (value) => value.split('\\').join('/')

/** The first candidate that is a file, or `undefined`. */
function firstFile(candidates) {
  return candidates.find((candidate) => existsSync(candidate) && statSync(candidate).isFile())
}

/** A `./`-relative module specifier, written the TypeScript way (`./x.js` for
 * `x.ts`), resolved from `fromFile`. */
function resolveRelative(fromFile, specifier) {
  const base = resolve(dirname(fromFile), specifier)
  const stem = base.replace(/\.(?:[cm]?js)$/, '')
  return firstFile([
    base,
    `${stem}.ts`,
    `${stem}.mts`,
    `${base}.ts`,
    `${base}.mts`,
    `${base}.js`,
    `${base}.mjs`,
    join(base, 'index.ts'),
    join(base, 'index.mts'),
    join(base, 'index.js'),
  ])
}

/** Every file a `*` in an exports target can stand for. */
function expandWildcard(packageDir, target) {
  const [head, tail] = target.split('*')
  const root = resolve(packageDir, dirname(head + 'x'))
  if (!existsSync(root)) return []
  const prefix = resolve(packageDir, head)
  return readdirSync(root, { recursive: true, encoding: 'utf8' })
    .map((entry) => resolve(root, entry))
    .filter((file) => file.startsWith(prefix) && file.endsWith(tail ?? ''))
    .filter((file) => statSync(file).isFile())
    .sort()
}

/** Where a published `exports` target's source lives: the target itself, or,
 * for a built `dist/` target, the `src/` module that produces it. */
function sourceForTarget(packageDir, target, override) {
  if (override) return firstFile([resolve(packageDir, override)])
  const direct = resolve(packageDir, target)
  const candidates = [direct, direct.replace(/\.(?:[cm]?js)$/, '.ts')]
  if (target.startsWith('./dist/')) {
    const stem = target.slice('./dist/'.length).replace(/\.(?:[cm]?js)$/, '')
    candidates.push(
      join(packageDir, 'src', `${stem}.ts`),
      join(packageDir, 'src', `${stem}.mts`),
      join(packageDir, 'src', stem, 'index.ts'),
      join(packageDir, 'src', 'entries', `${stem}.ts`),
    )
  }
  return firstFile(candidates)
}

/** `{ subpath key: target }` from a package.json `exports`, preferring
 * import/default over types. */
function exportTargets(exports) {
  if (exports == null) return {}
  if (typeof exports === 'string') return { '.': exports }
  const entries =
    Object.keys(exports).length > 0 && !Object.keys(exports).every((key) => key.startsWith('.'))
      ? { '.': exports }
      : exports
  const out = {}
  for (const [key, value] of Object.entries(entries)) {
    let target = value
    while (target !== null && typeof target === 'object') {
      const condition = ['import', 'default', 'node', 'require', 'types'].find(
        (name) => name in target,
      )
      target = condition ? target[condition] : undefined
    }
    if (typeof target === 'string') out[key] = target
  }
  return out
}

function isExported(node) {
  return (
    ts.canHaveModifiers(node) &&
    (ts.getModifiers(node) ?? []).some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)
  )
}

/**
 * The value names (function, const, class) a module exports, with the file
 * each is defined in. `export { x } from` and `export *` follow relative
 * specifiers; a bare specifier is another package and not this one's export.
 */
function moduleExports(file, seen = new Set()) {
  if (seen.has(file)) return new Map()
  seen.add(file)
  const text = readFileSync(file, 'utf8')
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true)
  const found = new Map()
  const add = (name, definedIn) => {
    if (!found.has(name)) found.set(name, definedIn)
  }
  const follow = (specifier) => {
    if (!specifier?.startsWith('.')) return undefined
    const next = resolveRelative(file, specifier)
    if (!next) {
      if (NON_SOURCE_TARGET.test(specifier)) return undefined
      throw new Error(`${file} re-exports ${specifier}, which does not resolve.`)
    }
    return next
  }

  for (const node of source.statements) {
    if (ts.isFunctionDeclaration(node) && isExported(node) && node.name) {
      if (!(ts.getModifiers(node) ?? []).some((m) => m.kind === ts.SyntaxKind.DefaultKeyword)) {
        add(node.name.text, file)
      }
    } else if (ts.isClassDeclaration(node) && isExported(node) && node.name) {
      if (!(ts.getModifiers(node) ?? []).some((m) => m.kind === ts.SyntaxKind.DefaultKeyword)) {
        add(node.name.text, file)
      }
    } else if (ts.isVariableStatement(node) && isExported(node)) {
      for (const declaration of node.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name)) add(declaration.name.text, file)
      }
    } else if (ts.isExportDeclaration(node)) {
      const specifier =
        node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)
          ? node.moduleSpecifier.text
          : undefined
      const next = follow(specifier)
      if (node.isTypeOnly) continue
      if (!node.exportClause) {
        // `export * from './x'`
        if (next && SOURCE_SUFFIX.test(next)) {
          for (const [name, definedIn] of moduleExports(next, seen)) add(name, definedIn)
        }
      } else if (ts.isNamedExports(node.exportClause)) {
        const reexported = next && SOURCE_SUFFIX.test(next) ? moduleExports(next, new Set()) : null
        for (const element of node.exportClause.elements) {
          if (element.isTypeOnly) continue
          const local = (element.propertyName ?? element.name).text
          const exportedAs = element.name.text
          if (exportedAs === 'default') continue
          if (specifier) {
            // Only a re-export of a value counts; a re-exported type has no
            // entry in the target module's value exports.
            if (reexported) {
              if (reexported.has(local)) add(exportedAs, reexported.get(local))
            } else if (!specifier.startsWith('.')) {
              continue
            }
          } else if (isValueName(source, local)) {
            add(exportedAs, file)
          }
        }
      }
    }
  }

  return found
}

/** Whether `name` is declared as a value (function, class, variable) at the
 * top level of `source`, as opposed to a type or interface. */
function isValueName(source, name) {
  for (const node of source.statements) {
    if (
      (ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node)) &&
      node.name?.text === name
    ) {
      return true
    }
    if (ts.isVariableStatement(node)) {
      for (const declaration of node.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name) && declaration.name.text === name) return true
      }
    }
    if (ts.isImportDeclaration(node) && node.importClause && !node.importClause.isTypeOnly) {
      const bindings = node.importClause.namedBindings
      if (
        bindings &&
        ts.isNamedImports(bindings) &&
        bindings.elements.some((element) => element.name.text === name && !element.isTypeOnly)
      ) {
        return true
      }
    }
  }
  return false
}

/** Whether a name is a shadowing candidate at all. */
export function isCandidateName(name) {
  return name.length >= MIN_NAME_LENGTH && !GENERIC_NAMES.has(name) && !/^[A-Z0-9_]+$/.test(name)
}

/**
 * `{ name: ['narduk-core', ...] }` for every candidate name, plus the packages
 * read. Names exported by several packages list every owner, sorted.
 */
export function deriveSharedExports(root = repoRoot) {
  const workspace = loadWorkspace(root)
  const owners = new Map()
  const packages = []
  for (const { directory, manifest, relativeDirectory } of workspace.packages) {
    if (!manifest.name.startsWith(ESTATE_SCOPE) || manifest.private === true) continue
    if (!APP_FAMILIES.some((family) => `${relativeDirectory}/`.startsWith(family))) continue
    const pkg = manifest.name.slice(ESTATE_SCOPE.length)
    packages.push(pkg)

    const files = new Set()
    for (const [key, target] of Object.entries(exportTargets(manifest.exports))) {
      if (!target.startsWith('./') || /(^|\/)internal(\/|$)/.test(key)) continue
      if (NON_SOURCE_TARGET.test(target) || !/\.[cm]?[jt]s\*?$|\*/.test(target)) continue
      if (target.includes('*')) {
        for (const file of expandWildcard(directory, target)) files.add(file)
        continue
      }
      const file = sourceForTarget(directory, target, SOURCE_OVERRIDES[manifest.name]?.[target])
      if (!file) {
        throw new Error(
          `${manifest.name} exports ${key} -> ${target}, which resolves to no source file. ` +
            'Teach scripts/generate-shared-exports.mjs the layout; do not skip it silently.',
        )
      }
      files.add(file)
    }

    for (const file of [...files].sort()) {
      const path = toPosix(relative(root, file))
      if (!SOURCE_SUFFIX.test(path) || /\.d\.[cm]?ts$/.test(path) || TEST_FILE.test(path)) continue
      if (/(^|\/)internal\//.test(path)) continue
      for (const [name, definedIn] of moduleExports(file)) {
        if (!isCandidateName(name) || SKIPPED_SOURCE.test(toPosix(relative(root, definedIn)))) {
          continue
        }
        if (!owners.has(name)) owners.set(name, new Set())
        owners.get(name).add(pkg)
      }
    }
  }
  if (packages.length === 0 || owners.size === 0) {
    throw new Error('Derived an empty shared-export list; the workspace read must have failed.')
  }
  const names = Object.fromEntries(
    [...owners]
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([name, set]) => [name, [...set].sort()]),
  )
  return { names, packages: packages.sort() }
}

/** Renders the module and runs it through the repository's own Prettier
 * configuration, so the generated file satisfies `format:check`. */
export async function renderSharedExportsModule({ names, packages }) {
  const entries = Object.entries(names)
    .map(([name, owners]) => `  ${name}: [${owners.map((o) => `'${o}'`).join(', ')}],`)
    .join('\n')
  const source = `/**
 * GENERATED FILE -- do not edit by hand.
 *
 * Regenerate with \`node scripts/generate-shared-exports.mjs\`; \`--check\`
 * fails when this file falls out of step with the workspace.
 *
 * The function, const and class names the ${packages.length} shared app-family
 * packages export, by owning package, for
 * \`narduk/no-shadowed-shared-export\` (narduk-libs#2126). Derived from each
 * package's \`exports\` map; names under six characters, SCREAMING_CASE
 * constants and generic words are left out (see the generator).
 */

export const SHARED_EXPORT_OWNERS: Readonly<Record<string, readonly string[]>> = {
${entries}
}
`
  const config =
    (await prettier.resolveConfig(join(repoRoot, SHARED_EXPORTS_MODULE_RELATIVE_PATH))) ?? {}
  return prettier.format(source, { ...config, parser: 'typescript' })
}

async function main(argv) {
  const check = argv.includes('--check')
  const rendered = await renderSharedExportsModule(deriveSharedExports(repoRoot))
  const target = join(repoRoot, SHARED_EXPORTS_MODULE_RELATIVE_PATH)
  if (check) {
    if (!existsSync(target) || readFileSync(target, 'utf8') !== rendered) {
      process.stderr.write(
        `${SHARED_EXPORTS_MODULE_RELATIVE_PATH} is stale. Run \`node scripts/generate-shared-exports.mjs\` and commit the result.\n`,
      )
      return 1
    }
    return 0
  }
  writeFileSync(target, rendered)
  process.stdout.write(`wrote ${SHARED_EXPORTS_MODULE_RELATIVE_PATH}\n`)
  return 0
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await main(process.argv.slice(2))
}
