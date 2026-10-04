// @ts-check
/**
 * Keep the TypeScript program steady while a run lints `.vue` files
 * (narduk-libs#1393).
 *
 * `.vue` files already join the app program: the project service finds the
 * generated `.nuxt/tsconfig.app.json` for them, and `extraFileExtensions` is
 * set. What makes them slow is what they open the file *with*. `vue-eslint-parser`
 * hands the TypeScript parser the `<script>` text, which is not what the
 * program holds (the whole SFC on disk), so opening each `.vue` file replaces
 * the program. Every replacement builds a new type checker, which throws away
 * the types the last file resolved, and the type-aware rules pay the warm-up
 * again for every file: measured in operator-portal, ~4 s per `.vue` file that
 * contains a call, against ~0.02 s per `.ts` file, which never changes the
 * program and shares one checker for the whole run.
 *
 * The fix is to put every `.vue` file's script text into the project service
 * before the type-aware rules start asking questions. Opening a file with the
 * text it is already open with changes nothing, so after this pass the program
 * is stable for the rest of the run, one checker serves every file, and the
 * warm-up is paid once. No rule is turned off or down, and no file is skipped:
 * the same rules see the same files. A `.vue` file that imports another `.vue`
 * file now sees that file's script types instead of the raw SFC text.
 *
 * The pass runs inside the process, through the same parser and the same
 * options the run is using, so it needs no knowledge of `typescript-eslint`
 * internals. It starts once a run has parsed {@link WARM_AFTER_FILES} distinct
 * `.vue` files, so a one-to-three file run (an editor, `lint-staged`) never
 * pays for the walk. `NARDUK_LINT_VUE_PROGRAM_WARM=0` switches it off.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

/** `.vue` files a run parses before the pass starts; below it the walk costs more than it saves. */
export const WARM_AFTER_FILES = 3

/** Directories that never hold lintable app sources. */
const SKIPPED_DIRECTORIES = new Set(['node_modules', 'dist', 'build', 'coverage', 'out'])

/**
 * Every `.vue` file under `rootDir`, skipping dot-directories (`.nuxt`,
 * `.output`, `.git`, `.wrangler`) and {@link SKIPPED_DIRECTORIES}.
 *
 * @param {string}   rootDir
 * @param {string[]} [found]
 * @returns {string[]}
 */
export function listVueFiles(rootDir, found = []) {
  let entries
  try {
    entries = readdirSync(rootDir, { withFileTypes: true })
  } catch {
    return found
  }

  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (!entry.name.startsWith('.') && !SKIPPED_DIRECTORIES.has(entry.name)) {
        listVueFiles(join(rootDir, entry.name), found)
      }
    } else if (entry.name.endsWith('.vue')) {
      found.push(join(rootDir, entry.name))
    }
  }

  return found
}

/**
 * Wrap a `vue-eslint-parser` so a run that lints several `.vue` files opens
 * them all in the type-aware program up front.
 *
 * @param {import('eslint').Linter.Parser & { parseForESLint: Function }} inner
 * @param {object} options
 * @param {string} options.appRootDir      root walked for `.vue` files
 * @param {number} [options.warmAfter]      distinct `.vue` files parsed before the pass starts
 * @param {(rootDir: string) => string[]} [options.listFiles] test seam
 * @returns {import('eslint').Linter.Parser & { parseForESLint: Function }}
 */
export function createProgramWarmingVueParser(
  inner,
  { appRootDir, warmAfter = WARM_AFTER_FILES, listFiles = listVueFiles },
) {
  /** @type {Set<string>} */
  const seen = new Set()
  let warmed = false

  /**
   * @param {string} code
   * @param {Record<string, any>} [parserOptions]
   */
  function parseForESLint(code, parserOptions) {
    const filePath = parserOptions?.filePath

    if (
      !warmed &&
      typeof filePath === 'string' &&
      process.env.NARDUK_LINT_VUE_PROGRAM_WARM !== '0' &&
      // Only a parse that asks for type information has a program to steady.
      (parserOptions?.projectService || parserOptions?.project || parserOptions?.programs)
    ) {
      seen.add(filePath)

      if (seen.size > warmAfter) {
        warmed = true

        for (const vueFile of listFiles(appRootDir)) {
          if (seen.has(vueFile)) {
            continue
          }

          try {
            // The result is discarded: the parse is what opens the file in the
            // project service. A file the project does not contain, or one that
            // does not parse, throws here and is reported when it is linted.
            inner.parseForESLint(readFileSync(vueFile, 'utf8'), {
              ...parserOptions,
              filePath: vueFile,
            })
          } catch {
            // Reported, with its location, by the lint run that reaches the file.
          }
        }
      }
    }

    return inner.parseForESLint(code, parserOptions)
  }

  return {
    ...(inner.meta ? { meta: inner.meta } : {}),
    parseForESLint,
  }
}
