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
 * Node 22.22.3 through Volta and `actions/setup-node`, and the registry and
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
 * `--package` is scoped to `@narduk-enterprises/narduk-shell` today. The
 * existing design packages (narduk-ui, narduk-charts) backfill their surface in
 * backlog item 22 and join the check then; naming one of them now is an error
 * rather than a silent pass, so the day they join is a deliberate edit here.
 *
 * Usage:
 *   node scripts/check-component-surface.mjs [--package <name>] [--json]
 *   node scripts/check-component-surface.mjs --package-dir <dir> [--json]
 */

import { readFile, readdir, stat } from 'node:fs/promises'
import { basename, dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { PENDING_CARDS as SHELL_PENDING_CARDS } from '../packages/design/narduk-shell/src/pending-cards.ts'

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/**
 * Package directories this check owns. Item 22 appends narduk-ui and
 * narduk-charts here — one line each — once their surface is backfilled.
 */
export const CHECKED_PACKAGE_DIRS = ['packages/design/narduk-shell']

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
 * A real import of `name`'s own module — its SFC (`.../Name.vue`) or a
 * same-named module — not merely the identifier appearing somewhere in the
 * file. This is what tells a genuine `mount(NeThing…)` / SSR render / design
 * card apart from a fixture that mentions the name in a comment or an
 * unrelated string while actually exercising something else entirely.
 */
function importsArtefact(source, name) {
  const pattern = new RegExp(`(?:^|/)${escapeRegExp(name)}(?:\\.vue)?$`)
  return importSpecifiers(source).some((specifier) => pattern.test(specifier))
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
 * Load the package's declared surface.
 *
 * @returns {Promise<{ kind: 'component' | 'format', name: string }[]>}
 */
export async function readSurface(packageDirectory) {
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

/** Everything a rule needs to look at, read once for the whole package. */
async function readEvidence(packageDirectory) {
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
    (path) => path.startsWith('src/design-cards/') && path.endsWith('.card.vue'),
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
  return { readme, tests, cards }
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
          importsArtefact(source, name)
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
          names(source, name) && source.includes('renderToString') && importsArtefact(source, name)
        )
      }),
    miss: ({ name, path }) =>
      `missing SSR test — add ${path(`src/runtime/components/${name}.ssr.test.ts`)} (or name ${name} in a shared \`ssr.test.ts\`) importing it and rendering it with \`renderToString\` in vitest's node environment`,
  },
  card: {
    kinds: ['component'],
    check: ({ name, evidence }) => {
      const source = evidence.cards.get(`src/design-cards/${name}.card.vue`)
      if (source === undefined) return false
      const stripped = stripComments(source)
      return (
        stripped.includes(`data-design-card="${kebabCase(name)}"`) &&
        importsArtefact(stripped, name)
      )
    },
    miss: ({ name, path }) =>
      `missing design card — copy ${path('src/design-cards/template/NeExample.card.vue')} to ${path(`src/design-cards/${name}.card.vue`)}, import the component and set \`data-design-card="${kebabCase(name)}"\``,
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
}) {
  const surface = await readSurface(packageDirectory)
  const evidence = await readEvidence(packageDirectory)
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
        misses.push({ name, kind, rule, message: `${name}: ${RULES[rule].miss({ name, path })}` })
      }
    }
    if (kind === 'component' && pending.has(name) && !required.includes('card')) {
      waived.push(name)
    }
    entries.push({ name, kind, required, satisfied })
  }
  return { package: packageName, directory: path(''), entries, misses, waived }
}

function parseArguments(argv) {
  const options = { package: DEFAULT_PACKAGE, packageDirectory: undefined, json: false }
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
  return options
}

export async function main(argv = process.argv.slice(2), out = process.stdout) {
  const options = parseArguments(argv)
  const directoryStat = await stat(options.packageDirectory).catch(() => null)
  if (!directoryStat?.isDirectory()) {
    throw new Error(`Not a package directory: ${options.packageDirectory}`)
  }

  const report = await checkComponentSurface({
    packageName: options.package,
    packageDirectory: resolve(options.packageDirectory),
  })

  if (options.json) {
    out.write(`${JSON.stringify({ ok: report.misses.length === 0, ...report }, undefined, 2)}\n`)
    return report.misses.length === 0 ? 0 : 1
  }

  if (report.misses.length > 0) {
    for (const miss of report.misses) out.write(`${report.directory}: ${miss.message}\n`)
    out.write(
      `\n${report.misses.length} surface requirement(s) missing across ${report.entries.length} ` +
        `registered name(s). See ${report.directory}/README.md "Component surface check".\n`,
    )
    return 1
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
  return 0
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    process.exitCode = await main()
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : error}\n`)
    process.exitCode = 1
  }
}
