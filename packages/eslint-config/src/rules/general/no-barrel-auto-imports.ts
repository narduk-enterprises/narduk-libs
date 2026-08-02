/**
 * Disallow `index.*` barrel files inside Nuxt's auto-import / discovery
 * directories. Nuxt should discover `app/components/**`, `app/composables/**`,
 * `app/layouts/**` and `app/pages/**` file-by-file; a barrel both defeats
 * tree-shaking and silently changes route/component naming.
 *
 * Deep-review verdict: SOLID / KEEP (6 tests).
 *
 * REVIEW FINDING IMPLEMENTED — leading-slash path gate. v1 matched with
 * `normalized.includes('/app/components/')` &c., i.e. every blocked directory
 * was spelled with a leading slash. The review proved that gate dead on any
 * relative filename (Tier D: "the leading-slash path gate disables 8 rules on
 * any relative filename"); ESLint reports relative filenames whenever it is
 * invoked with relative paths, which is the normal `pnpm lint` invocation. The
 * gate now goes through the shared, tested `path-scope` util, so
 * `app/composables/index.ts` reports exactly like
 * `/repo/app/composables/index.ts`. That is a widening of what the rule
 * reports and it is intentional: the narrower behaviour was the bug.
 */

import { basename, extname } from 'node:path'
import type { Rule } from 'eslint'
import { inAppScope } from '../utils/path-scope'

/**
 * App-relative directories, spelled WITHOUT a leading slash — `inAppScope`
 * anchors them itself for both absolute and relative filenames.
 */
const BLOCKED_DIRECTORIES = ['app/components', 'app/composables', 'app/layouts', 'app/pages']

const SCRIPT_EXTENSIONS = new Set(['.js', '.cjs', '.mjs', '.ts', '.cts', '.mts'])

export default {
  meta: {
    type: 'problem' as const,
    docs: {
      description: 'disallow index barrel files in Nuxt auto-import and discovery directories',
      recommended: true,
    },
    schema: [],
    messages: {
      noBarrelAutoImports:
        'Do not add {{fileName}} inside {{directory}}. Nuxt should discover files directly instead of routing through barrel files.',
    },
  },

  create(context: Rule.RuleContext): Rule.RuleListener {
    const filename = context.filename
    const normalized = filename.replaceAll('\\', '/')
    const extension = extname(normalized)

    if (!SCRIPT_EXTENSIONS.has(extension)) {
      return {}
    }

    const fileName = basename(normalized)
    if (fileName !== `index${extension}`) {
      return {}
    }

    const matchedDirectory = BLOCKED_DIRECTORIES.find((directory) =>
      inAppScope(filename, directory),
    )
    if (!matchedDirectory) {
      return {}
    }

    return {
      Program(node) {
        context.report({
          node,
          messageId: 'noBarrelAutoImports',
          data: {
            fileName,
            directory: matchedDirectory,
          },
        })
      },
    }
  },
} satisfies Rule.RuleModule
