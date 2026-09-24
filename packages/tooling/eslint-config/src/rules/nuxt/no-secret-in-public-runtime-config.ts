/**
 * Rule: no-secret-in-public-runtime-config
 *
 * Everything under `runtimeConfig.public` in `nuxt.config` is serialized into
 * every server-rendered page and shipped to every browser. A key there named
 * like a credential is either a leak or a naming accident, and both need a
 * human to look. Separately, a credential-named key anywhere in
 * `runtimeConfig` with a non-empty string literal default commits the value to
 * the repository (and, when public, to the client bundle); defaults for those
 * belong in the environment (`NUXT_*`), never in source.
 *
 *   flagged   runtimeConfig: { public: { stripeSecretKey: '' } }
 *             runtimeConfig: { public: { auth: { apiToken: '' } } }
 *             runtimeConfig: { sessionPassword: 'hunter2-but-longer' }
 *             runtimeConfig: { githubToken: process.env.GH_TOKEN || 'ghp_x' }
 *
 *   allowed   runtimeConfig: { stripeSecretKey: '' }        — server-only, empty
 *             runtimeConfig: { apiKey: process.env.API_KEY } — from the env
 *             runtimeConfig: { public: { siteUrl: '' } }     — not a credential name
 *
 * Credential-shaped names: /secret|token|password|private|api[_-]?key/i.
 *
 * ## Why this and not an entropy scanner
 *
 * `eslint-plugin-no-secrets` (Shannon-entropy string scanning) was measured
 * against this repository on 2026-09-18: 222 reports in 104 files, every one a
 * false positive (env-catalog selectors such as
 * `"doppler:narduk/tokens/TURNSTILE_SECRET_KEY"`, hashes and base64 test
 * fixtures). At error severity that is unshippable. This rule reported zero on
 * the same tree, because it only looks where Nuxt actually publishes values.
 * See DESIGN.md "Secrets rule choice".
 */

import type { Rule } from 'eslint'

import { getIdentifierName, unwrapTsWrappers } from '../utils/mutation-route'
import { toPosixPath } from '../utils/path-scope'

const CREDENTIAL_NAME = /secret|token|password|private|api[_-]?key/i
const NUXT_CONFIG_FILE = /(?:^|\/)nuxt\.config\.[cm]?[jt]s$/

function propertyKeyName(property: any): string | null {
  if (property?.type !== 'Property') return null
  if (property.computed && property.key?.type !== 'Literal') return null
  return getIdentifierName(property.key)
}

function isNonEmptyStringLiteral(node: any): boolean {
  const target = unwrapTsWrappers(node)
  if (target?.type === 'Literal') return typeof target.value === 'string' && target.value.length > 0
  if (target?.type === 'TemplateLiteral' && target.expressions.length === 0) {
    return (target.quasis[0]?.value?.cooked ?? '').length > 0
  }
  return false
}

/** `'x'`, or a fallback: `process.env.X || 'x'`, `process.env.X ?? 'x'`. */
function hasLiteralDefault(node: any): boolean {
  const target = unwrapTsWrappers(node)
  if (isNonEmptyStringLiteral(target)) return true
  if (
    target?.type === 'LogicalExpression' &&
    (target.operator === '||' || target.operator === '??')
  ) {
    return hasLiteralDefault(target.right)
  }
  if (target?.type === 'ConditionalExpression') {
    return hasLiteralDefault(target.consequent) || hasLiteralDefault(target.alternate)
  }
  return false
}

export default {
  meta: {
    type: 'problem' as const,
    docs: {
      description:
        'disallow credential-named keys under runtimeConfig.public and literal credential defaults in nuxt.config',
      recommended: true,
    },
    schema: [],
    messages: {
      publicSecret:
        '`runtimeConfig.public.{{ path }}` is named like a credential, and everything under `public` ships to the browser. Move it out of `public` (server-only runtimeConfig), or rename it if it is genuinely public.',
      literalDefault:
        '`runtimeConfig.{{ path }}` is named like a credential and has a string literal default, which commits the value to source. Default it to an empty string and set it through the environment (`NUXT_*`).',
    },
  },

  create(context: Rule.RuleContext): Rule.RuleListener {
    if (!NUXT_CONFIG_FILE.test(toPosixPath(context.filename ?? ''))) return {}

    function walk(object: any, path: string[], underPublic: boolean): void {
      for (const property of object.properties ?? []) {
        const name = propertyKeyName(property)
        if (!name) continue
        const nextPath = [...path, name]
        const value = unwrapTsWrappers(property.value)
        const isCredential = CREDENTIAL_NAME.test(name)

        if (underPublic && isCredential) {
          context.report({
            node: property.key,
            messageId: 'publicSecret',
            data: { path: nextPath.slice(1).join('.') },
          })
          continue
        }
        if (isCredential && hasLiteralDefault(value)) {
          context.report({
            node: property.value,
            messageId: 'literalDefault',
            data: { path: nextPath.join('.') },
          })
          continue
        }
        if (value?.type === 'ObjectExpression') {
          walk(value, nextPath, underPublic || (path.length === 0 && name === 'public'))
        }
      }
    }

    return {
      Property(node: any) {
        if (propertyKeyName(node) !== 'runtimeConfig') return
        const value = unwrapTsWrappers(node.value)
        if (value?.type === 'ObjectExpression') walk(value, [], false)
      },
    }
  },
} satisfies Rule.RuleModule
