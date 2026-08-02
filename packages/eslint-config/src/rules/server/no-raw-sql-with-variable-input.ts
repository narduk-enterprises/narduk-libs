/**
 * Rule: no-raw-sql-with-variable-input
 *
 * **Polarity fix.** v1 reported drizzle-orm's `` sql`… ${id} …` `` — the safe,
 * documented, idiomatic form — as an injection vector, and its own test suite
 * codified that inversion. Verified against drizzle-orm's source
 * (`sql/sql.cjs`): a plain interpolated chunk becomes
 * `{ sql: escapeParam(paramStartIndex.value++, chunk), params: [chunk] }`, i.e.
 * a **bound parameter** (`$1` / `?`). The value never reaches the SQL text.
 * v1's remedy — "wrap it in `sql.identifier(...)`" — is for identifiers, not
 * values, and produces broken SQL.
 *
 * Meanwhile the *real* vector escaped: `sql.raw(x)` splices its argument into
 * the statement verbatim, and v1 detected it only through a bare
 * `sql`-named local, so `import * as d from 'drizzle-orm'; d.sql.raw(x)` and a
 * barrel re-export both walked straight through.
 *
 * This rebuild therefore:
 *   - never reports a tagged `sql` template (parameter binding is the fix);
 *   - reports `sql.raw(...)` with non-constant input, resolving the receiver
 *     through the **scope manager** so namespace imports, aliases, barrel
 *     re-exports and Nuxt auto-imports are all covered, and a locally-declared
 *     unrelated `sql` object is not.
 *
 * ## Extracted `raw`, which the adversarial pass proved got through
 *
 * Matching only the `<receiver>.raw(…)` *shape* means the call can be moved out
 * of that shape in one line. Both of these were silent:
 *
 * ```ts
 * const { raw: rawSql } = sql   // destructured off the builder
 * const rawSql = sql.raw        // the method, lifted to a local
 * rawSql(requestControlledSql)  // …and neither is a MemberExpression any more
 * ```
 *
 * So the rule now tracks the *binding* rather than the syntax: any local whose
 * single initializer extracts `.raw` from a known drizzle `sql` — by member
 * access or by object pattern — is itself a raw-SQL callee, and an identifier
 * alias of `sql` (`const s = sql`) resolves back to the builder. A local
 * `const sql = { raw }` helper still resolves to an object literal, not to
 * drizzle, and is still deliberately not flagged.
 *
 * No autofix. Choosing between a bound parameter, an allow-list, and
 * `sql.identifier()` is a human decision about the data, not a mechanical
 * rewrite.
 */

import type { Rule } from 'eslint'

import { getIdentifierName, isExemptTestPath, unwrapTsWrappers } from '../utils/mutation-route'

interface Options {
  /** Module specifiers whose `sql` export is drizzle's. */
  drizzleSources?: string[]
  /**
   * Treat a `sql` imported from an unknown module (a project barrel such as
   * `~/server/utils/db`) as drizzle's. On by default: a barrel re-export is
   * the single most common way `sql` reaches a route file, and v1 disabling
   * itself entirely in that case is the bug being fixed.
   */
  treatUnknownSqlImportsAsDrizzle?: boolean
  /** Treat an unresolved global `sql` (Nuxt auto-import) as drizzle's. */
  treatAutoImportedSqlAsDrizzle?: boolean
}

const DEFAULT_DRIZZLE_SOURCES = ['drizzle-orm']

function isDrizzleSource(source: string, configured: readonly string[]): boolean {
  return configured.some((candidate) => source === candidate || source.startsWith(`${candidate}/`))
}

/** A constant SQL fragment: a plain string literal or an expression-free template. */
function isConstantString(node: any): boolean {
  const target = unwrapTsWrappers(node)
  if (!target) return false
  if (target.type === 'Literal' && typeof target.value === 'string') return true
  return target.type === 'TemplateLiteral' && target.expressions.length === 0
}

export default {
  meta: {
    type: 'problem' as const,
    docs: {
      description:
        'disallow sql.raw() with non-constant input; drizzle sql`` template interpolation is parameter-bound and safe',
      recommended: true,
    },
    schema: [
      {
        type: 'object',
        properties: {
          drizzleSources: { type: 'array', items: { type: 'string' }, uniqueItems: true },
          treatUnknownSqlImportsAsDrizzle: { type: 'boolean' },
          treatAutoImportedSqlAsDrizzle: { type: 'boolean' },
        },
        additionalProperties: false,
      },
    ],
    messages: {
      rawWithVariableInput:
        "`sql.raw()` splices its argument into the statement verbatim — a SQL injection vector when the input is not a constant. Interpolate the value with drizzle's sql`` template instead (it binds parameters), or wrap an identifier with sql.identifier().",
    },
  },

  create(context: Rule.RuleContext): Rule.RuleListener {
    const options = (context.options[0] ?? {}) as Options
    const drizzleSources = options.drizzleSources ?? DEFAULT_DRIZZLE_SOURCES
    const treatUnknownSqlImports = options.treatUnknownSqlImportsAsDrizzle !== false
    const treatAutoImportedSql = options.treatAutoImportedSqlAsDrizzle !== false

    const filename = context.filename ?? (context as any).getFilename?.() ?? ''
    if (filename && isExemptTestPath(filename)) return {}

    const sourceCode = context.sourceCode

    /** Resolve an identifier to its variable through the real scope chain. */
    function resolveVariable(identifier: any): any | null {
      let scope: any = sourceCode.getScope(identifier)
      while (scope) {
        const variable = scope.variables.find(
          (candidate: any) => candidate.name === identifier.name,
        )
        if (variable) return variable
        scope = scope.upper
      }
      return null
    }

    /** The import declaration a variable was bound from, if any. */
    function importSourceOf(variable: any): { source: string; kind: string } | null {
      for (const definition of variable?.defs ?? []) {
        if (definition.type !== 'ImportBinding') continue
        const source = definition.parent?.source?.value
        if (typeof source !== 'string') continue
        return { source, kind: definition.node?.type ?? '' }
      }
      return null
    }

    /** The sole `const x = …` initializer of a never-reassigned local. */
    function soleInitializerOf(variable: any): any | null {
      const definitions = variable?.defs ?? []
      if (definitions.length !== 1) return null
      const [definition] = definitions
      if (definition.type !== 'Variable') return null
      const declarator = definition.node
      if (declarator?.type !== 'VariableDeclarator') return null
      const writes = (variable.references ?? []).filter((reference: any) => reference.isWrite?.())
      if (writes.length > 1) return null
      return declarator.init ?? null
    }

    /**
     * Does this identifier denote drizzle's `sql` builder?
     *
     * `depth` bounds the `const s = sql` alias chain; the recursion only ever
     * follows single-assignment locals, so it terminates on any real program.
     */
    function isDrizzleSqlIdentifier(node: any, depth = 0): boolean {
      if (node?.type !== 'Identifier' || depth > 4) return false
      const resolved = resolveVariable(node)
      // A `languageOptions.globals` entry resolves to a Variable with no defs;
      // that is still an ambient auto-import, not a local declaration.
      const variable = resolved && (resolved.defs?.length ?? 0) > 0 ? resolved : null

      if (!variable) {
        // Unresolved: a Nuxt/Nitro auto-import, or a global. Only a binding
        // literally named `sql` is treated as drizzle's.
        return treatAutoImportedSql && node.name === 'sql'
      }

      const imported = importSourceOf(variable)
      if (!imported) {
        // Locally declared (const/let/param/function). An identifier alias of a
        // known `sql` (`const s = sql`) is still that `sql`; anything else —
        // including a local `const sql = { raw }` helper, whose initializer is
        // an object literal — is deliberately not flagged.
        const initializer = unwrapTsWrappers(soleInitializerOf(variable))
        if (initializer?.type === 'Identifier')
          return isDrizzleSqlIdentifier(initializer, depth + 1)
        if (initializer?.type === 'MemberExpression') return isDrizzleNamespaceSql(initializer)
        return false
      }

      if (isDrizzleSource(imported.source, drizzleSources)) return true
      // A project barrel that re-exports drizzle's `sql`. v1 gave up here and
      // disabled the whole rule for the file.
      return treatUnknownSqlImports && node.name === 'sql'
    }

    /** `d.sql` where `d` is `import * as d from 'drizzle-orm'`. */
    function isDrizzleNamespaceSql(node: any): boolean {
      const target = unwrapTsWrappers(node)
      if (target?.type !== 'MemberExpression' || target.computed) return false
      if (getIdentifierName(target.property) !== 'sql') return false

      const object = unwrapTsWrappers(target.object)
      if (object?.type !== 'Identifier') return false

      const variable = resolveVariable(object)
      if (!variable) return false
      const imported = importSourceOf(variable)
      if (!imported) return false
      if (
        imported.kind !== 'ImportNamespaceSpecifier' &&
        imported.kind !== 'ImportDefaultSpecifier'
      ) {
        return false
      }
      return isDrizzleSource(imported.source, drizzleSources)
    }

    /** `<expr>` is drizzle's `sql` builder, by identifier or by namespace member. */
    function isDrizzleSqlExpression(node: any): boolean {
      const target = unwrapTsWrappers(node)
      return isDrizzleSqlIdentifier(target) || isDrizzleNamespaceSql(target)
    }

    /** `<drizzleSql>.raw` as a member expression. */
    function isDrizzleRawMember(node: any): boolean {
      const target = unwrapTsWrappers(node)
      if (target?.type !== 'MemberExpression' || target.computed) return false
      if (getIdentifierName(target.property) !== 'raw') return false
      return isDrizzleSqlExpression(target.object)
    }

    /**
     * A local bound to `<drizzleSql>.raw` — `const rawSql = sql.raw` or
     * `const { raw: rawSql } = sql`. Calling it is calling `sql.raw`.
     */
    function isExtractedRawBinding(node: any): boolean {
      if (node?.type !== 'Identifier') return false

      const variable = resolveVariable(node)
      const definitions = variable?.defs ?? []
      if (definitions.length !== 1) return false

      const [definition] = definitions
      if (definition.type !== 'Variable') return false

      const declarator = definition.node
      if (declarator?.type !== 'VariableDeclarator') return false

      const writes = (variable.references ?? []).filter((reference: any) => reference.isWrite?.())
      if (writes.length > 1) return false

      const initializer = unwrapTsWrappers(declarator.init)

      // const rawSql = sql.raw
      if (declarator.id?.type === 'Identifier') return isDrizzleRawMember(initializer)

      // const { raw } = sql / const { raw: rawSql } = sql
      if (declarator.id?.type !== 'ObjectPattern') return false
      if (!isDrizzleSqlExpression(initializer)) return false

      return (declarator.id.properties ?? []).some((property: any) => {
        if (property.type !== 'Property' || property.computed) return false
        if (getIdentifierName(property.key) !== 'raw') return false
        // `value` is the bound identifier — the same node as the definition's
        // own name — for both `{ raw }` and `{ raw: rawSql }`.
        const bound = unwrapTsWrappers(property.value)
        return bound?.type === 'Identifier' && bound.name === node.name
      })
    }

    return {
      CallExpression(node: any) {
        const callee = unwrapTsWrappers(node.callee)

        const callsRaw =
          callee?.type === 'Identifier' ? isExtractedRawBinding(callee) : isDrizzleRawMember(callee)
        if (!callsRaw) return

        const argument = node.arguments?.[0]
        if (!argument) return
        if (isConstantString(argument)) return

        context.report({ node: argument, messageId: 'rawWithVariableInput' })
      },
    }
  },
} satisfies Rule.RuleModule
