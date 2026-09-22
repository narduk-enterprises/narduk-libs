// @ts-check
/**
 * Class names an app defines in its own CSS, for `better-tailwindcss/no-unknown-classes`.
 *
 * The plugin checks classes against the compiled Tailwind theme. It also accepts, via
 * `detectComponentClasses`, classes declared inside `@layer components`. It cannot see
 * two other places where apps define classes:
 *
 * - **bare selectors** in the entry stylesheet or anything it imports.
 *   `@narduk-enterprises/narduk-ui/tokens.css` itself defines `.ns-title-m` this way.
 * - **Vue SFC `<style>` blocks**, scoped or not.
 *
 * The first consumer that enabled the rule got 103 errors, and 101 of them were those
 * two cases (narduk-libs#55, borderwaitstat-us#11). This module collects both sets so
 * the rule can ignore them by exact name and keep reporting the real unknowns.
 *
 * Deliberate limits:
 *
 * - The match is exact. `hover:ns-title-m` is still reported, because Tailwind generates
 *   no variant for a class it did not define.
 * - SFC classes form one app-wide set. A class defined only in `A.vue`'s scoped style is
 *   accepted in `B.vue` too. The alternative is one config entry per component with a
 *   `files` glob tied to the lint cwd.
 * - Selectors are read with a small tokenizer rather than a CSS parser, because the
 *   plugin's parser is not a dependency of this package. A class that only appears
 *   inside an at-rule prelude (`@custom-variant`) is not collected.
 * - Package imports are followed only when they resolve to a `.css` file, so
 *   `@import "tailwindcss"` and `@import "@nuxt/ui"` are not walked.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, extname, isAbsolute, join, resolve } from 'node:path'

/** Directories that hold generated or third-party code, never the app's own components. */
const SKIPPED_DIRECTORIES = new Set(['coverage', 'dist', 'node_modules'])

const CLASS_SELECTOR = /\.(-?[_a-z][\w-]*)/gi
const IMPORT_SPECIFIER = /@import\s+(?:url\(\s*)?["']([^"']+)["']/g
const STYLE_BLOCK = /<style\b[^>]*>([\s\S]*?)<\/style>/gi

/**
 * Remove comments, strings and `url(...)` bodies. Each can hold a `.name` or a brace
 * that is not a selector.
 *
 * @param {string} css
 */
function stripNonSelectorText(css) {
  return css
    .replaceAll(/\/\*[\s\S]*?\*\//g, ' ')
    .replaceAll(/url\([^)]*\)/gi, 'url()')
    .replaceAll(/"[^"\n]*"|'[^'\n]*'/g, '""')
}

/**
 * Class names used in the selectors of a stylesheet. A selector is the text before
 * a `{`, back to the previous `;`, `{` or `}`. At-rule preludes (`@media`,
 * `@layer`, `@utility`) are skipped.
 *
 * @param {string} css
 * @returns {string[]}
 */
export function classSelectorsIn(css) {
  const text = stripNonSelectorText(css)
  const names = []
  let preludeStart = 0
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index]
    if (character === '{') {
      const prelude = text.slice(preludeStart, index).trim()
      if (!prelude.startsWith('@')) {
        for (const match of prelude.matchAll(CLASS_SELECTOR)) names.push(match[1])
      }
    }
    if (character === '{' || character === '}' || character === ';') preludeStart = index + 1
  }
  return names
}

/**
 * @param {string} specifier
 * @param {string} fromFile
 * @returns {string | undefined}
 */
function resolveCssImport(specifier, fromFile) {
  if (specifier.startsWith('.') || isAbsolute(specifier)) {
    const candidate = resolve(dirname(fromFile), specifier)
    return existsSync(candidate) ? candidate : undefined
  }
  try {
    return createRequire(fromFile).resolve(specifier)
  } catch {
    return undefined
  }
}

/**
 * Class selectors in a stylesheet and every `.css` file it imports.
 *
 * @param {string} entryPath absolute path
 * @returns {Set<string>}
 */
export function classesInCssImportGraph(entryPath) {
  const names = new Set()
  const visited = new Set()
  const pending = [entryPath]
  while (pending.length > 0) {
    const file = /** @type {string} */ (pending.pop())
    if (visited.has(file)) continue
    visited.add(file)
    let css
    try {
      css = readFileSync(file, 'utf8')
    } catch {
      continue
    }
    for (const name of classSelectorsIn(css)) names.add(name)
    for (const match of css.replaceAll(/\/\*[\s\S]*?\*\//g, ' ').matchAll(IMPORT_SPECIFIER)) {
      const imported = resolveCssImport(match[1], file)
      if (imported && extname(imported) === '.css') pending.push(imported)
    }
  }
  return names
}

/**
 * Class selectors in the `<style>` blocks of every `.vue` file under `rootDir`.
 * Dot-directories (`.nuxt`, `.output`, `.git`) and generated or dependency
 * directories are skipped.
 *
 * @param {string} rootDir absolute path
 * @returns {Set<string>}
 */
export function classesInSfcStyles(rootDir) {
  const names = new Set()
  const pending = [rootDir]
  while (pending.length > 0) {
    const directory = /** @type {string} */ (pending.pop())
    let entries
    try {
      entries = readdirSync(directory, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue
      const entryPath = join(directory, entry.name)
      if (entry.isDirectory()) {
        if (!SKIPPED_DIRECTORIES.has(entry.name)) pending.push(entryPath)
        continue
      }
      if (!entry.isFile() || !entry.name.endsWith('.vue')) continue
      const source = readFileSync(entryPath, 'utf8')
      for (const block of source.matchAll(STYLE_BLOCK)) {
        for (const name of classSelectorsIn(block[1])) names.add(name)
      }
    }
  }
  return names
}

/**
 * One `ignore` pattern for `no-unknown-classes` that matches exactly the classes the
 * app defines itself, or `undefined` when it defines none.
 *
 * @param {object} options
 * @param {string} options.appRootDir absolute path
 * @param {string} options.entryPoint absolute path to the Tailwind entry stylesheet
 * @returns {string | undefined}
 */
export function appDefinedClassesPattern({ appRootDir, entryPoint }) {
  const names = new Set([...classesInCssImportGraph(entryPoint), ...classesInSfcStyles(appRootDir)])
  if (names.size === 0) return undefined
  // Every collected name is `-?[_a-z][\w-]*`, which has no regex metacharacter
  // outside a character class, so the names join without escaping.
  return `^(?:${[...names].sort().join('|')})$`
}
