/**
 * Disallow a named re-export of another auto-imported file, inside a file that
 * Nuxt/Nitro auto-imports.
 *
 * Nitro and Nuxt auto-import every export of `server/utils/**`, `shared/utils/*`,
 * `app/utils/*` and `app/composables/*`. `export { x } from './sibling'` in one of
 * them is a second export of `x`: unimport keeps one, only WARNS ("Duplicated
 * imports"), and `nuxt prepare` still exits 0. When the two files are different
 * functions that share a name (operator-portal's `eventBody` and `utcDay`) a
 * caller silently binds to whichever file unimport kept.
 *
 * Every scope below was measured against Nuxt 4.5.2 / unimport 6.5.0, not assumed:
 *
 *  - Scanned: `server/utils` at ANY depth (Nitro); `shared/utils`, `app/utils`,
 *    `app/composables` at the TOP LEVEL only (a nested file, and a nested
 *    `index.*`, are not auto-imported, so `export { x } from './dir'` and
 *    `./dir/file` are the documented way to expose them and are left alone).
 *  - Two scan contexts: the app (`app/utils`, `app/composables`, `shared/utils`)
 *    and Nitro (`server/utils`, `shared/utils`). Re-exporting across them
 *    (`server/utils` from `~/utils/x`) collides with nothing.
 *  - Named re-exports collide, type-only ones included. `export * from` does NOT:
 *    unimport resolves it to the origin file, finds the same `from` twice and
 *    dedupes silently. `export { a as b } from` and `export * as ns from` only add
 *    a new name. None of those three is reported.
 *  - A source outside the scanned set (`../lib/x`, a package, an unknown alias) adds
 *    no second export.
 *
 * The scope is derived from the filename here, not from the config glob, so the
 * rule is correct under any pack composition and on relative filenames.
 */

import { existsSync, statSync } from 'node:fs'
import { posix, resolve } from 'node:path'
import type { Rule } from 'eslint'
import { inTestOrFixtureDirectory, segmentsAfter, toPosixPath } from '../utils/path-scope'

type Scanned = { app: boolean; nitro: boolean }

const SCRIPT_FILE = /\.[cm]?[jt]sx?$/u
const DECLARATION_FILE = /\.d\.[cm]?ts$/u
const EXTENSIONS = ['', '.ts', '.mts', '.cts', '.tsx', '.js', '.mjs', '.cjs', '.jsx']

/** Which scan contexts auto-import `path`, or null when neither does. */
function scannedBy(path: string): Scanned | null {
  const depth = (...dir: string[]): number | null => segmentsAfter(path, ...dir)?.length ?? null
  if ((depth('server', 'utils') ?? 0) >= 1) return { app: false, nitro: true }
  if (depth('shared', 'utils') === 1) return { app: true, nitro: true }
  if (depth('app', 'utils') === 1 || depth('app', 'composables') === 1) {
    return { app: true, nitro: false }
  }
  return null
}

/** `~`, `@` -> app/; `~~`, `@@` -> the root; `#shared` -> shared/. Others are not ours. */
function aliasToPath(source: string): string | null {
  const alias = /^(~~|@@|~|@|#shared)\/(.+)$/u.exec(source)
  if (!alias) return null
  const [, prefix, rest] = alias
  if (prefix === '~~' || prefix === '@@') return rest ?? null
  return `${prefix === '#shared' ? 'shared' : 'app'}/${rest}`
}

function sourcePath(filename: string, source: string): string | null {
  if (source.startsWith('./') || source.startsWith('../')) {
    return posix.join(posix.dirname(toPosixPath(filename)), source)
  }
  return aliasToPath(source)
}

/** A relative source that names only a directory is its index, which is not scanned. */
function isDirectoryOnly(filename: string, cwd: string, source: string): boolean {
  if (!source.startsWith('.')) return false
  const base = resolve(cwd, posix.dirname(toPosixPath(filename)), source)
  const asFile = EXTENSIONS.some((extension) => {
    const candidate = `${base}${extension}`
    return existsSync(candidate) && statSync(candidate).isFile()
  })
  return !asFile && existsSync(base) && statSync(base).isDirectory()
}

function specifierName(node: any): string | null {
  if (node?.type === 'Identifier') return node.name
  if (node?.type === 'Literal' && typeof node.value === 'string') return node.value
  return null
}

/** Names re-exported under their own name; `default` and `a as b` are new names. */
function sameNameExports(node: any): string[] {
  return (node.specifiers ?? []).flatMap((specifier: any) => {
    const local = specifierName(specifier.local)
    const exported = specifierName(specifier.exported)
    return local !== null && local === exported && local !== 'default' ? [local] : []
  })
}

export default {
  meta: {
    type: 'problem' as const,
    docs: {
      description:
        'disallow re-exporting another auto-imported file from a Nuxt/Nitro auto-imported file',
      recommended: true,
    },
    schema: [],
    messages: {
      noAutoImportReexport:
        'Do not re-export {{names}} from "{{source}}" here: both files are auto-imported, so this is a second export ' +
        'of the same name. unimport keeps one, only warns "Duplicated imports", and a caller can bind to the wrong ' +
        'file. Delete the re-export and rely on the auto-import, or import from the original file.',
    },
  },

  create(context: Rule.RuleContext): Rule.RuleListener {
    const filename = toPosixPath(context.filename)
    if (!SCRIPT_FILE.test(filename) || DECLARATION_FILE.test(filename)) return {}
    if (inTestOrFixtureDirectory(filename)) return {}
    const here = scannedBy(filename)
    if (!here) return {}

    return {
      ExportNamedDeclaration(node: any) {
        const source: unknown = node.source?.value
        if (typeof source !== 'string') return
        const names = sameNameExports(node)
        if (names.length === 0) return
        const target = sourcePath(filename, source)
        const there = target ? scannedBy(target) : null
        if (!there || !((here.app && there.app) || (here.nitro && there.nitro))) return
        if (isDirectoryOnly(filename, context.cwd, source)) return
        context.report({
          node,
          messageId: 'noAutoImportReexport',
          data: { names: names.join(', '), source },
        })
      },
    }
  },
} satisfies Rule.RuleModule
