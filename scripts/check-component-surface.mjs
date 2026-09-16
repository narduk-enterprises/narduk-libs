/**
 * Component surface check — components backlog item 3 (narduk-libs#250).
 *
 * The plan's standard done-when (docs/plans/components-library-plan.md §1) says
 * every component in the shared suite ships a README section, a mount test, an
 * SSR test and an NE Base design card. Until something fails when one of those
 * is missing, all four are a claim rather than a rule, and nothing in this
 * repository checked any of them.
 *
 * This script is that rule. It reads the surface a package actually exports —
 * the `NE_SHELL_COMPONENTS` registry and the named exports of the `./format`
 * subpath — and requires the evidence for each entry to exist on disk.
 *
 * ## How the surface is read
 *
 * By **importing the TypeScript sources directly** (`import('…/registry.ts')`),
 * not by parsing them. Node >= 22.18 strips types natively, the repository pins
 * Node 24.21.0 through Volta and `actions/setup-node`, and the registry and
 * `format` modules are plain erasable TypeScript. Importing gives the real
 * export list rather than whatever a regex happens to match, so a component
 * built by a helper, re-exported, or spread into the array is still seen. The
 * import is fail-closed: if a module cannot be loaded the check exits non-zero
 * with the loader error instead of reporting an empty, trivially passing
 * surface.
 *
 * ## Requirements, by kind
 *
 * A registered **component** must have all four:
 *
 * | Rule     | Satisfied by                                                       |
 * | -------- | ------------------------------------------------------------------ |
 * | `readme` | a Markdown heading in the package README naming the component       |
 * | `mount`  | a `*.test.ts` under the package containing `mount(<Name>`           |
 * | `ssr`    | an SSR test file (`<Name>.ssr.test.ts`, or any `*.ssr.test.ts` /    |
 * |          | `ssr.test.ts`) that names the component and calls `renderToString`  |
 * | `card`   | `src/design-cards/<Name>.card.vue` carrying                         |
 * |          | `data-design-card="<kebab-name>"`                                   |
 *
 * A **`format` export** must have two: `readme`, and `unit` — a `*.test.ts`
 * under the package that imports from the `format` module and names the export.
 *
 * *Deviation, stated on purpose.* The plan's sentence applies the same four
 * rules to "every component narduk-shell registers and every `format` export".
 * Three of the four cannot exist for a pure function: `mount()` takes a
 * component, an SSR render needs something to render, and a design card is a
 * rendered preview. Requiring them would make item 5 (#252) satisfy a gate by
 * writing fictions. The `format` kind therefore keeps the two rules that do
 * mean something for a function, and the deviation is recorded here, in the
 * package README and in narduk-libs#250's pull request rather than left
 * implicit.
 *
 * ## Scope
 *
 * `CHECKED_PACKAGE_DIRS` lists every package this check owns (backlog item 22,
 * narduk-libs#269): `narduk-shell`, `narduk-charts` and `narduk-ui`. Naming an
 * unlisted package with `--package`/`--package-dir` is an error rather than a
 * silent pass — joining is a deliberate edit to that array plus, when the
 * package reads its surface from a barrel (below), a `PACKAGE_SURFACE_CONFIG`
 * entry.
 *
 * With no `--package`/`--package-dir` at all, the check runs every directory
 * in `CHECKED_PACKAGE_DIRS` and reports each, so `pnpm run surface:check`
 * (which CI calls with no arguments) actually enforces the whole list rather
 * than only the first entry.
 *
 * ## Two ways a package declares its surface
 *
 * `narduk-shell` (the "shell" shape) declares components through an explicit
 * `{ name, filePath }` registry (`src/registry.ts`'s `NE_SHELL_COMPONENTS`),
 * read by **importing the TypeScript directly** — see above.
 *
 * `narduk-charts` and `narduk-ui` instead re-export each component from a
 * plain ESM barrel (`export { default as Name } from './Name.vue'` in
 * `src/index.ts` / `instruments/index.ts`, alongside many non-component
 * exports — composables, utils, types — that are not part of this check's
 * surface). Node's native type-stripping cannot `import()` a module whose
 * specifiers include `.vue` files, so a barrel package's surface is read by
 * **parsing** that one file's re-export lines instead (`parseComponentBarrel`)
 * — a deliberate, narrower exception to the "import, don't parse" rule above,
 * made only for the one line that names each component, not for evidence.
 * `PACKAGE_SURFACE_CONFIG` maps a barrel package's directory to its barrel
 * file and its design-cards directory (`src/design-cards` unless overridden).
 * Neither barrel package declares a `format`-shaped module today, so barrel
 * surfaces carry only `component` entries — the `format` kind stays specific
 * to the shell shape until a barrel package needs it.
 *
 * A test file that imports a barrel-shaped component by a **named import from
 * the barrel** (`import { Name } from './index'` / `from '../instruments'`),
 * rather than by the component's own file path, still satisfies `mount`/`ssr`/
 * `card`'s "real import" check — see `importsArtefact` below.
 *
 * Usage:
 *   node scripts/check-component-surface.mjs [--json]                     (all of CHECKED_PACKAGE_DIRS)
 *   node scripts/check-component-surface.mjs --package <name> [--json]
 *   node scripts/check-component-surface.mjs --package-dir <dir> [--json]
 */

import { readFile, readdir, stat } from 'node:fs/promises'
import { basename, dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { PENDING_CARDS as SHELL_PENDING_CARDS } from '../packages/design/narduk-shell/src/pending-cards.ts'

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/**
 * Package directories this check owns (backlog item 22, narduk-libs#269).
 */
export const CHECKED_PACKAGE_DIRS = [
  'packages/design/narduk-shell',
  'packages/design/narduk-charts',
  'packages/design/narduk-ui',
]

/**
 * Re-export of `packages/design/narduk-shell/src/pending-cards.ts`. Empty that
 * array in the follow-up card PR. Only the `card` rule is waived, and only
 * when this check (or `shellCardPlan`) is looking at a directory in
 * `CHECKED_PACKAGE_DIRS`. README, mount and SSR still fail closed.
 */
export const PENDING_CARDS = Object.freeze([...SHELL_PENDING_CARDS])

/** CLI aliases (`--package narduk-shell` or the scoped name) for the dirs above. */
export const CHECKED_PACKAGES = new Map(
  CHECKED_PACKAGE_DIRS.flatMap((directory) => {
    const short = directory.slice(directory.lastIndexOf('/') + 1)
    return [
      [`@narduk-enterprises/${short}`, directory],
      [short, directory],
    ]
  }),
)

export const DEFAULT_PACKAGE = '@narduk-enterprises/narduk-shell'

/**
 * Non-shell packages: where their component barrel lives, and (when it is not
 * `src/design-cards`) where their design cards live. A directory absent from
 * this map reads the shell shape (`src/registry.ts` + `src/format.ts`).
 */
export const PACKAGE_SURFACE_CONFIG = {
  'packages/design/narduk-charts': {
    componentsBarrel: 'src/index.ts',
    designCardsDir: 'src/design-cards',
  },
  'packages/design/narduk-ui': {
    componentsBarrel: 'instruments/index.ts',
    designCardsDir: 'design-cards',
  },
}

/** The barrel config for a package directory, or `null` for the shell shape. */
export function surfaceConfigFor(packageDirectory) {
  const relativeDirectory = relative(ROOT, resolve(packageDirectory))
  return PACKAGE_SURFACE_CONFIG[relativeDirectory] ?? null
}

/**
 * The pending-card waiver applies only to a checked package directory, never
 * to a throwaway fixture, so the fixture tests can still fail the card rule.
 */
export function pendingCardsFor(packageDirectory) {
  const relativeDirectory = relative(ROOT, resolve(packageDirectory))
  return CHECKED_PACKAGE_DIRS.includes(relativeDirectory) ? [...PENDING_CARDS] : []
}

/** `NeStatePanel` -> `ne-state-panel`. The card id a design card must declare. */
export function kebabCase(name) {
  return name
    .replaceAll(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replaceAll(/([A-Z]+)([A-Z][a-z])/g, '$1-$2')
    .toLowerCase()
}

const escapeRegExp = (text) => text.replaceAll(/[$()*+.?[\\\]^{|}]/g, String.raw`\$&`)

/** A word-boundary match for an identifier, with regex metacharacters escaped. */
function names(source, name) {
  return new RegExp(String.raw`\b${escapeRegExp(name)}\b`).test(source)
}

/**
 * Strip `//` and `/* *\/` comments before a rule's regex looks for real usage,
 * so a `mount(Name`, a `renderToString`, or a name that exists only in a
 * comment cannot satisfy that rule. String and template literals are
 * respected — a `//` inside a URL or an import specifier is not a comment —
 * by copying quoted spans verbatim instead of scanning through them; a naive
 * strip would truncate a line at the first `//` inside a string. This does
 * not touch Vue template (`<!-- -->`) comments, only `//` and `/* *\/`.
 */
function stripComments(source) {
  let out = ''
  let index = 0
  while (index < source.length) {
    const char = source[index]
    if (char === '"' || char === "'" || char === '`') {
      let end = index + 1
      while (end < source.length && source[end] !== char) {
        end += source[end] === '\\' ? 2 : 1
      }
      end = Math.min(end + 1, source.length)
      out += source.slice(index, end)
      index = end
      continue
    }
    if (char === '/' && source[index + 1] === '/') {
      const end = source.indexOf('\n', index)
      index = end === -1 ? source.length : end
      continue
    }
    if (char === '/' && source[index + 1] === '*') {
      const end = source.indexOf('*/', index + 2)
      index = end === -1 ? source.length : end + 2
      continue
    }
    out += char
    index += 1
  }
  return out
}

/**
 * Every specifier the source imports, statically (`from '<spec>'`) or
 * dynamically (`import('<spec>')`) — several of this package's own tests use
 * dynamic `await import(...)` after a `vi.mock(...)` call, so a check that
 * only recognised static imports would fail on real, already-shipped tests.
 */
function importSpecifiers(source) {
  return [
    ...source.matchAll(/\bfrom\s+['"]([^'"]+)['"]/g),
    ...source.matchAll(/\bimport\s*\(\s*['"]([^'"]+)['"]/g),
  ].map(([, specifier]) => specifier)
}

/**
 * A real import of `name`'s own artefact — not merely the identifier
 * appearing somewhere in the file. This is what tells a genuine
 * `mount(NeThing…)` / SSR render / design card apart from a fixture that
 * mentions the name in a comment or an unrelated string while actually
 * exercising something else entirely. Two shapes count:
 *
 * - a specifier ending in the component's own module (`.../Name.vue` or
 *   `.../Name`) — the shell package's per-file convention; or
 * - a named import of `name` from the package's own components barrel
 *   (`import { Name } from './index'`) — the convention `narduk-charts`'s
 *   `ssr.test.ts` and `narduk-ui`'s `instruments.test.ts`/`ssr.test.ts` use,
 *   since both packages re-export every component through one barrel file
 *   rather than having every test import a component by its own path.
 *
 * The named-import shape is accepted only for a package that declares a
 * `componentsBarrel` in `PACKAGE_SURFACE_CONFIG`, and only when that import's
 * own specifier resolves to that barrel file. Both halves carry weight.
 * Accepting a named import from *any* specifier would let a file satisfy the
 * rule by importing `name` from an unrelated module — a binding that need not
 * be the real component at all — and would apply that looser criterion to
 * `narduk-shell` too, which imports every component by its own path and needs
 * none of it. `import type` is excluded for the same reason: it is erased at
 * build time, so it supplies no runtime binding for `mount` or `renderToString`
 * to exercise. The barrel's own shape is already checked once, by
 * `parseComponentBarrel` reading `componentsBarrel` to build the surface, so a
 * name reaching this check really is exported by the barrel; what this
 * constrains is that the evidence file reads it from there.
 *
 * @param source the file's text, comments already stripped
 * @param name the component's name
 * @param options `barrel`: the package-relative components barrel, or `null`
 *   for the per-file shell shape; `from`: the package-relative path of the
 *   file `source` came from, which `barrel` is resolved against
 */
function importsArtefact(source, name, { barrel = null, from = '' } = {}) {
  const pathPattern = new RegExp(`(?:^|/)${escapeRegExp(name)}(?:\\.vue)?$`)
  if (importSpecifiers(source).some((specifier) => pathPattern.test(specifier))) return true
  if (barrel === null) return false

  const namedImportPattern = new RegExp(
    String.raw`\bimport\s*\{[^}]*\b${escapeRegExp(name)}\b[^}]*\}\s*from\s*['"]([^'"]+)['"]`,
    'g',
  )
  return [...source.matchAll(namedImportPattern)].some(([, specifier]) =>
    resolvesToBarrel(specifier, from, barrel),
  )
}

/**
 * Does `specifier`, written inside `from`, name the package-relative `barrel`
 * file? Extensions are ignored on both sides and a directory resolves to its
 * `index`, so `'./index'`, `'./index.ts'` and `'../src'` all name `src/index.ts`
 * — the shapes `narduk-charts` (`from './index'`) and `narduk-ui`
 * (`from '../instruments'`) actually use. A bare or absolute specifier never
 * matches: a package's own barrel is always reached by a relative path.
 */
function resolvesToBarrel(specifier, from, barrel) {
  if (!specifier.startsWith('.')) return false
  const withoutExtension = (path) => path.replace(/\.(?:vue|m?[jt]sx?)$/, '')
  const target = withoutExtension(barrel)
  const resolved = withoutExtension(join(dirname(from), specifier))
  return resolved === target || (basename(target) === 'index' && resolved === dirname(target))
}

/** A real import of the package's `format` module, by path (`.../format`). */
function importsFormatModule(source) {
  return importSpecifiers(source).some((specifier) => /(?:^|\/)format$/.test(specifier))
}

/** Every file under `directory` matching `predicate`, as paths relative to it. */
async function walk(directory, predicate, prefix = '') {
  let entries
  try {
    entries = await readdir(join(directory, prefix), { withFileTypes: true })
  } catch {
    return []
  }
  const groups = await Promise.all(
    entries
      .filter((entry) => entry.name !== 'node_modules' && !entry.name.startsWith('.'))
      .map(async (entry) => {
        const path = prefix ? `${prefix}/${entry.name}` : entry.name
        if (entry.isDirectory()) return walk(directory, predicate, path)
        return predicate(path) ? [path] : []
      }),
  )
  return groups.flat().sort()
}

const isTest = (path) => path.endsWith('.test.ts')
// `readEvidence`'s walk only ever collects `.test.ts` files (`isTest`, above),
// so a `basename(path) === 'ssr.spec.ts'` arm here would be dead: no `.spec.ts`
// file is ever read into `evidence.tests` for it to match against. This
// package's convention is `.test.ts` uniformly (there is no `.spec.ts` file
// anywhere in it today), so the fix is removing the unreachable arm rather
// than widening `isTest` to collect a file kind nothing here writes.
const isSsrTest = (path) => path.endsWith('.ssr.test.ts') || basename(path) === 'ssr.test.ts'

/**
 * Every `export { default as Name } from './Name.vue'` line in a barrel
 * module's source, as the names it re-exports as components. Comments are
 * stripped first so a re-export mentioned only in a comment (or inside a
 * docblock example) is not mistaken for a real one. Deliberately narrow: it
 * does not match a bare `export { Name } from …` (no `default as`) or a
 * `export * from …`, because every barrel this repository has today spells a
 * component re-export exactly this way — see the module docblock's "Two ways
 * a package declares its surface" section for why this is a parse rather
 * than an import.
 */
export function parseComponentBarrel(source) {
  const stripped = stripComments(source)
  const pattern = /export\s*\{\s*default\s+as\s+(\w+)\s*\}\s*from\s*['"][^'"]+\.vue['"]/g
  return [...stripped.matchAll(pattern)].map((match) => match[1])
}

/**
 * Load the package's declared surface — the shell shape (`src/registry.ts` +
 * `src/format.ts`, read by importing) for a package absent from
 * `PACKAGE_SURFACE_CONFIG`, or the barrel shape (a `parseComponentBarrel` of
 * `componentsBarrel`, components only) for one present in it.
 *
 * @returns {Promise<{ kind: 'component' | 'format', name: string }[]>}
 */
export async function readSurface(packageDirectory) {
  const config = surfaceConfigFor(packageDirectory)
  if (config) {
    const barrelPath = config.componentsBarrel
    const path = join(packageDirectory, barrelPath)
    let source
    try {
      source = await readFile(path, 'utf8')
    } catch (error) {
      throw new Error(
        `Cannot read the component barrel (${barrelPath}): ${error instanceof Error ? error.message : error}`,
        { cause: error },
      )
    }
    const names = parseComponentBarrel(source)
    if (names.length === 0) {
      throw new Error(
        `${barrelPath} exports no \`export { default as Name } from './Name.vue'\` lines. ` +
          'The surface check fails closed rather than reporting an empty surface — fix the ' +
          'barrel, or its PACKAGE_SURFACE_CONFIG entry, in scripts/check-component-surface.mjs.',
      )
    }
    return names.map((name) => ({ kind: 'component', name }))
  }

  const load = async (relativePath, describe) => {
    const path = join(packageDirectory, relativePath)
    try {
      return await import(pathToFileURL(path).href)
    } catch (error) {
      throw new Error(
        `Cannot read ${describe} (${relativePath}): ${error instanceof Error ? error.message : error}\n` +
          'The surface check imports the package TypeScript directly and fails closed rather ' +
          'than reporting an empty surface. Fix the module, or make it erasable TypeScript ' +
          'that Node can type-strip.',
        { cause: error },
      )
    }
  }

  const registry = await load('src/registry.ts', 'the component registry')
  const entries = registry.NE_SHELL_COMPONENTS
  if (!Array.isArray(entries)) {
    throw new TypeError(
      'src/registry.ts must export NE_SHELL_COMPONENTS as an array of { name, filePath }.',
    )
  }

  const surface = entries.map((entry) => {
    if (!entry || typeof entry.name !== 'string' || typeof entry.filePath !== 'string') {
      throw new TypeError(
        `Invalid NE_SHELL_COMPONENTS entry: ${JSON.stringify(entry)}. Expected { name, filePath }.`,
      )
    }
    return { kind: 'component', name: entry.name }
  })

  const format = await load('src/format.ts', 'the ./format subpath')
  for (const name of Object.keys(format).sort()) {
    if (name !== 'default') surface.push({ kind: 'format', name })
  }
  return surface
}

/**
 * Everything a rule needs to look at, read once for the whole package.
 * `designCardsDir` is `src/design-cards` for the shell shape, or a
 * `PACKAGE_SURFACE_CONFIG` override for a barrel package whose cards do not
 * live under `src/` (narduk-ui ships no `src/` directory at all).
 */
async function readEvidence(
  packageDirectory,
  designCardsDir = 'src/design-cards',
  componentsBarrel = null,
) {
  const readme = await readFile(join(packageDirectory, 'README.md'), 'utf8').catch(() => '')
  const testPaths = await walk(packageDirectory, isTest)
  const tests = await Promise.all(
    testPaths.map(async (path) => ({
      path,
      source: await readFile(join(packageDirectory, path), 'utf8'),
    })),
  )
  const cardPaths = await walk(
    packageDirectory,
    (path) => path.startsWith(`${designCardsDir}/`) && path.endsWith('.card.vue'),
  )
  const cards = new Map(
    await Promise.all(
      cardPaths.map(
        async (path) =>
          /** @type {[string, string]} */ ([
            path,
            await readFile(join(packageDirectory, path), 'utf8'),
          ]),
      ),
    ),
  )
  return { readme, tests, cards, designCardsDir, componentsBarrel }
}

/**
 * Markdown ATX headings, as their text. A component's README section is a
 * heading naming it, at any level: `## NeStatePanel`, `### NeStatePanel` or
 * `### `NeStatePanel`` all count, and a mention in a paragraph or a table row
 * does not.
 */
function headings(markdown) {
  return [...markdown.matchAll(/^#{1,6}[ \t]+(.+?)[ \t]*#*$/gm)].map((match) => match[1])
}

const RULES = {
  readme: {
    kinds: ['component', 'format'],
    check: ({ name, evidence }) => headings(evidence.readme).some((text) => names(text, name)),
    miss: ({ name, path }) =>
      `missing README section — add a heading naming ${name} (for example \`### ${name}\`) to ${path('README.md')}`,
  },
  mount: {
    kinds: ['component'],
    check: ({ name, evidence }) =>
      evidence.tests.some((test) => {
        if (isSsrTest(test.path)) return false
        const source = stripComments(test.source)
        return (
          new RegExp(String.raw`\bmount\(\s*${escapeRegExp(name)}\b`).test(source) &&
          importsArtefact(source, name, { barrel: evidence.componentsBarrel, from: test.path })
        )
      }),
    miss: ({ name, path }) =>
      `missing mount test — add ${path(`src/runtime/components/${name}.test.ts`)} importing and mounting the component with \`mount(${name}…)\` via @vue/test-utils`,
  },
  ssr: {
    kinds: ['component'],
    check: ({ name, evidence }) =>
      evidence.tests.some((test) => {
        if (!isSsrTest(test.path)) return false
        const source = stripComments(test.source)
        return (
          names(source, name) &&
          source.includes('renderToString') &&
          importsArtefact(source, name, { barrel: evidence.componentsBarrel, from: test.path })
        )
      }),
    miss: ({ name, path }) =>
      `missing SSR test — add ${path(`src/runtime/components/${name}.ssr.test.ts`)} (or name ${name} in a shared \`ssr.test.ts\`) importing it and rendering it with \`renderToString\` in vitest's node environment`,
  },
  card: {
    kinds: ['component'],
    check: ({ name, evidence }) => {
      const path = `${evidence.designCardsDir}/${name}.card.vue`
      const source = evidence.cards.get(path)
      if (source === undefined) return false
      const stripped = stripComments(source)
      return (
        stripped.includes(`data-design-card="${kebabCase(name)}"`) &&
        importsArtefact(stripped, name, { barrel: evidence.componentsBarrel, from: path })
      )
    },
    miss: ({ name, path, evidence }) =>
      `missing design card — add ${path(`${evidence.designCardsDir}/${name}.card.vue`)}, import the component and set \`data-design-card="${kebabCase(name)}"\``,
  },
  unit: {
    kinds: ['format'],
    check: ({ name, evidence }) =>
      evidence.tests.some((test) => {
        const source = stripComments(test.source)
        return /\bformat\b/.test(source) && names(source, name) && importsFormatModule(source)
      }),
    miss: ({ name, path }) =>
      `missing unit test — add a \`*.test.ts\` under ${path('')} importing ${name} from the \`format\` module and asserting its output`,
  },
}

/** The rule ids a surface entry of this kind must satisfy, in report order. */
export function rulesFor(kind) {
  return Object.entries(RULES)
    .filter(([, rule]) => rule.kinds.includes(kind))
    .map(([id]) => id)
}

/**
 * Run every rule over a package's declared surface.
 *
 * @returns {Promise<{ package: string, directory: string, entries: object[],
 *   misses: { name: string, kind: string, rule: string, message: string }[],
 *   waived: string[] }>}
 */
export async function checkComponentSurface({
  packageName,
  packageDirectory,
  pendingCards = pendingCardsFor(packageDirectory),
  designCardsDir = surfaceConfigFor(packageDirectory)?.designCardsDir ?? 'src/design-cards',
  componentsBarrel = surfaceConfigFor(packageDirectory)?.componentsBarrel ?? null,
}) {
  const surface = await readSurface(packageDirectory)
  const evidence = await readEvidence(packageDirectory, designCardsDir, componentsBarrel)
  const pending = new Set(pendingCards)
  // Report repository-relative paths so a failure can be pasted into an editor.
  // A fixture package outside the repository keeps its absolute path instead of
  // becoming a wall of `../`.
  const path = (suffix) => {
    const absolute = join(packageDirectory, suffix)
    const inside = relative(ROOT, absolute)
    return inside && !inside.startsWith('..') ? inside : absolute
  }

  const entries = []
  const misses = []
  const waived = []
  for (const { kind, name } of surface) {
    const required = rulesFor(kind).filter((rule) => !(rule === 'card' && pending.has(name)))
    const satisfied = []
    for (const rule of required) {
      if (RULES[rule].check({ name, evidence })) {
        satisfied.push(rule)
      } else {
        misses.push({
          name,
          kind,
          rule,
          message: `${name}: ${RULES[rule].miss({ name, path, evidence })}`,
        })
      }
    }
    if (kind === 'component' && pending.has(name) && !required.includes('card')) {
      waived.push(name)
    }
    entries.push({ name, kind, required, satisfied })
  }
  return { package: packageName, directory: path(''), entries, misses, waived }
}

/**
 * @returns {{ json: boolean, targets: { package: string, packageDirectory: string }[] }}
 */
function parseArguments(argv) {
  const options = { package: undefined, packageDirectory: undefined, json: false }
  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index]
    if (argument === '--json') options.json = true
    else if (argument === '--package') options.package = argv[++index]
    else if (argument.startsWith('--package='))
      options.package = argument.slice('--package='.length)
    else if (argument === '--package-dir') options.packageDirectory = argv[++index]
    else if (argument.startsWith('--package-dir='))
      options.packageDirectory = argument.slice('--package-dir='.length)
    else throw new Error(`Unknown argument: ${argument}`)
  }

  if (options.packageDirectory || options.package) {
    if (!options.packageDirectory) {
      const directory = CHECKED_PACKAGES.get(options.package)
      if (!directory) {
        throw new Error(
          `${options.package} is not in the component surface check yet. Checked today: ` +
            `${[...new Set(CHECKED_PACKAGES.values())].join(', ')}. The existing design packages ` +
            'join in components backlog item 22.',
        )
      }
      options.packageDirectory = join(ROOT, directory)
    }
    return {
      json: options.json,
      targets: [
        { package: options.package ?? DEFAULT_PACKAGE, packageDirectory: options.packageDirectory },
      ],
    }
  }

  // Neither `--package` nor `--package-dir`: check everything this script
  // owns. `pnpm run surface:check` (CI's step, and this repo's `quality`
  // chain) calls the script with no arguments at all, so this is the path
  // that must actually enforce every entry in CHECKED_PACKAGE_DIRS rather
  // than silently covering only the first one.
  return {
    json: options.json,
    targets: CHECKED_PACKAGE_DIRS.map((directory) => ({
      package: `@narduk-enterprises/${directory.slice(directory.lastIndexOf('/') + 1)}`,
      packageDirectory: join(ROOT, directory),
    })),
  }
}

export async function main(argv = process.argv.slice(2), out = process.stdout) {
  const { json, targets } = parseArguments(argv)

  const reports = []
  for (const target of targets) {
    const directoryStat = await stat(target.packageDirectory).catch(() => null)
    if (!directoryStat?.isDirectory()) {
      throw new Error(`Not a package directory: ${target.packageDirectory}`)
    }
    reports.push(
      await checkComponentSurface({
        packageName: target.package,
        packageDirectory: resolve(target.packageDirectory),
      }),
    )
  }

  const ok = reports.every((report) => report.misses.length === 0)

  if (json) {
    // A single target keeps the original flat `{ ok, ...report }` shape so an
    // existing `--package-dir … --json` caller sees no change. Multiple
    // targets (the no-args, check-everything path) wrap each report the same
    // way inside `reports`, since one flat object cannot hold more than one
    // package's `entries`/`misses`/`directory`.
    const payload =
      reports.length === 1
        ? { ok, ...reports[0] }
        : { ok, reports: reports.map((report) => ({ ok: report.misses.length === 0, ...report })) }
    out.write(`${JSON.stringify(payload, undefined, 2)}\n`)
    return ok ? 0 : 1
  }

  for (const report of reports) {
    if (report.misses.length > 0) {
      for (const miss of report.misses) out.write(`${report.directory}: ${miss.message}\n`)
      out.write(
        `\n${report.misses.length} surface requirement(s) missing across ${report.entries.length} ` +
          `registered name(s). See ${report.directory}/README.md "Component surface check".\n`,
      )
      continue
    }

    const components = report.entries.filter((entry) => entry.kind === 'component').length
    const formats = report.entries.length - components
    const waiver =
      report.waived.length > 0
        ? ` (${report.waived.length} card(s) waived via pendingCards: ${report.waived.join(', ')})`
        : ''
    out.write(
      `${report.package}: ${components} component(s) and ${formats} format export(s) have a README ` +
        `section, tests and a design card.${waiver}\n`,
    )
  }
  return ok ? 0 : 1
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    process.exitCode = await main()
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : error}\n`)
    process.exitCode = 1
  }
}
