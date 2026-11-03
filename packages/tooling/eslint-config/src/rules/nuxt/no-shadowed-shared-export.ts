/**
 * Rule: no-shadowed-shared-export
 *
 * A top-level function, const or class an app declares under the name a
 * released `@narduk-enterprises/*` package already exports is usually a local
 * copy that stops receiving fixes (narduk-libs#2126, from the #2120 survey of
 * 60 apps: `median`, `plural`, `slugify`, `formatNumber`, `sha256Hex`). The
 * component twin is `no-shadowed-shared-component`.
 *
 * A name match is a candidate, not proof, so the rule warns and has three ways
 * to say "kept on purpose":
 *
 * - a `// LIBS-KEEP: <name> <reason>` comment on the declaration's line or in
 *   the three lines above it (the marker agent-infrastructure `libs-find`
 *   honours; the rule is stricter, requiring the name to match);
 * - the `allow` option, a list of names;
 * - an `eslint-disable` comment with a reason.
 *
 * The names are a generated list (`utils/shared-exports.ts`), for the reason
 * `shared-components.ts` is a static list: a lint rule cannot resolve an app's
 * installed packages. The app's own `package.json` is not read either, so the
 * rule does not narrow to the packages the app depends on; the message names
 * the owning package and the shared names are specific enough (six characters
 * or more, no generic words) that an unrelated owner is rare.
 */

import type { Rule } from 'eslint'

import { SHARED_EXPORT_OWNERS } from '../utils/shared-exports'
import { getFilename, isTestOrFixturePath } from './_internal'

/** The owning packages' own sources are the export, not a copy of it. */
const OWNER_SOURCE = /(?:^|\/)packages\/(?:modules|design|contracts)\//

const NOT_APP_CODE =
  /\.d\.[cm]?ts$|\.config\.[cm]?[jt]s$|(?:^|\/)(?:node_modules|\.nuxt|\.output|dist|coverage|generated)\//

const KEEP_MARKER = /LIBS-KEEP:?\s+([\w$]+)/

/** Comment lines above a declaration that still count as annotating it. */
const KEEP_REACH_LINES = 3

interface Options {
  allow?: string[]
}

function ownersOf(name: string): readonly string[] | undefined {
  return Object.hasOwn(SHARED_EXPORT_OWNERS, name) ? SHARED_EXPORT_OWNERS[name] : undefined
}

export default {
  meta: {
    type: 'suggestion',
    docs: {
      description:
        'disallow an app-local function, const or class that shadows a released @narduk-enterprises export',
      recommended: true,
    },
    schema: [
      {
        type: 'object',
        properties: {
          allow: { type: 'array', items: { type: 'string' }, uniqueItems: true },
        },
        additionalProperties: false,
      },
    ],
    messages: {
      shadowed:
        '`{{name}}` is already exported by @narduk-enterprises/{{pkg}}. Import it, fix or extend it in narduk-libs, or mark a copy kept on purpose with `// LIBS-KEEP: {{name}} <reason>`.',
    },
  },
  create(context: Rule.RuleContext): Rule.RuleListener {
    const filename = getFilename(context)
    if (isTestOrFixturePath(filename) || NOT_APP_CODE.test(filename)) return {}
    if (OWNER_SOURCE.test(filename)) return {}

    const options = (context.options[0] ?? {}) as Options
    const allowed = new Set(options.allow ?? [])
    const sourceCode = context.sourceCode

    /** A `LIBS-KEEP: <name>` comment on the statement's line or just above it. */
    function isKept(statement: any, name: string): boolean {
      const firstLine = statement.loc.start.line
      return sourceCode.getAllComments().some((comment) => {
        const match = KEEP_MARKER.exec(comment.value)
        if (match?.[1] !== name) return false
        const endLine = comment.loc?.end.line ?? 0
        return endLine <= firstLine && endLine >= firstLine - KEEP_REACH_LINES
      })
    }

    function check(statement: any, id: any): void {
      if (id?.type !== 'Identifier') return
      const owners = ownersOf(id.name)
      if (!owners || allowed.has(id.name) || isKept(statement, id.name)) return
      context.report({
        node: id,
        messageId: 'shadowed',
        data: { name: id.name, pkg: owners.join(', @narduk-enterprises/') },
      })
    }

    function checkDeclaration(statement: any, declaration: any): void {
      if (!declaration) return
      if (declaration.type === 'FunctionDeclaration' || declaration.type === 'ClassDeclaration') {
        check(statement, declaration.id)
      } else if (declaration.type === 'VariableDeclaration') {
        for (const declarator of declaration.declarations) check(statement, declarator.id)
      }
    }

    return {
      Program(program: any) {
        for (const statement of program.body) {
          if (statement.type === 'ExportNamedDeclaration') {
            checkDeclaration(statement, statement.declaration)
          } else if (statement.type === 'ExportDefaultDeclaration') {
            checkDeclaration(statement, statement.declaration)
          } else {
            checkDeclaration(statement, statement)
          }
        }
      },
    }
  },
} satisfies Rule.RuleModule
