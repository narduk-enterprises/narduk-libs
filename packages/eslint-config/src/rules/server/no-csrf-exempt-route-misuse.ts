/**
 * Rule: no-csrf-exempt-route-misuse
 *
 * Routes under `server/api/webhooks|cron|callbacks/**` bypass the CSRF
 * middleware entirely. If they read a request body they must authenticate the
 * caller some other way — a shared secret or a signature header.
 *
 * v1 was satisfied by the mere **presence** of a `getHeader` call anywhere in
 * the file. Its own "valid" fixture read a header it never checked and never
 * even named as a secret, so `getHeader(event, 'user-agent')` was enough to
 * silence a rule whose whole point is that the route is unauthenticated.
 *
 * This rebuild inspects the header actually read: the name must look like a
 * secret/signature credential (or be one the project configures), or the file
 * must call a recognisable verification helper. Reading `user-agent` proves
 * nothing and no longer satisfies the rule.
 *
 * A non-literal header name is accepted only when the expression it comes from
 * is itself named like a secret (`getHeader(event, signatureHeader)`); an
 * opaque `getHeader(event, name)` does not satisfy the rule, because that is
 * the presence check all over again.
 *
 * No autofix — the correct check depends on the provider's signing scheme.
 */

import type { Rule } from 'eslint'

import {
  analyzeServerRoutePath,
  getIdentifierName,
  unwrapTsWrappers,
  isExemptTestPath,
} from '../utils/mutation-route'

interface Options {
  /** Header names (lower-case, exact) that count as a credential. */
  secretHeaders?: string[]
  /** Regex sources matched against a header name, in addition to the list. */
  secretHeaderPatterns?: string[]
}

const DEFAULT_SECRET_HEADER_PATTERNS = [
  'secret',
  'signature',
  '^x-hub-signature',
  '^x-signature',
  '^svix-',
  '^stripe-signature',
  '^x-shopify-hmac',
  '^x-slack-signature',
  '^x-twilio-signature',
  'hmac',
  'webhook-token',
  '^authorization$',
  '^x-api-key$',
  '^x-cron-key$',
  '^x-webhook-',
]

const HEADER_READERS = new Set(['getHeader', 'getRequestHeader'])
const BODY_READERS = new Set([
  'readBody',
  'readRawBody',
  'readValidatedBody',
  'readFormData',
  'readMultipartFormData',
])

/** `verifySignature(...)`, `assertWebhookSecret(...)`, `validateHmac(...)`. */
const VERIFY_ACTION = /verif|assert|validate|check|authenticate|authorize/i
const VERIFY_SUBJECT = /signature|secret|webhook|hmac|token|sign|auth|key/i

export default {
  meta: {
    type: 'problem' as const,
    docs: {
      description:
        'CSRF-exempt routes that read a body must verify a named secret or signature header',
      recommended: true,
    },
    schema: [
      {
        type: 'object',
        properties: {
          secretHeaders: { type: 'array', items: { type: 'string' }, uniqueItems: true },
          secretHeaderPatterns: { type: 'array', items: { type: 'string' }, uniqueItems: true },
        },
        additionalProperties: false,
      },
    ],
    messages: {
      missingSecretValidation:
        "This route is under a CSRF-exempt prefix and reads a request body, but never verifies a secret or signature header. Read and check one (e.g. getHeader(event, 'x-hub-signature-256')), or move the route outside the exempt prefix if it is user-facing.",
      headerReadButNotSecret:
        'Reading `{{header}}` does not authenticate this CSRF-exempt route. Verify a secret or signature header instead.',
    },
  },

  create(context: Rule.RuleContext): Rule.RuleListener {
    const filename = context.filename ?? (context as any).getFilename?.() ?? ''
    if (!filename || isExemptTestPath(filename)) return {}

    const pathInfo = analyzeServerRoutePath(filename)
    if (!pathInfo.isServerRoute || !pathInfo.isCsrfExempt) return {}

    const options = (context.options[0] ?? {}) as Options
    const secretHeaders = new Set((options.secretHeaders ?? []).map((name) => name.toLowerCase()))
    const patterns = (options.secretHeaderPatterns ?? DEFAULT_SECRET_HEADER_PATTERNS).map(
      (source) => new RegExp(source, 'i'),
    )

    const isSecretHeaderName = (name: string): boolean => {
      const lower = name.toLowerCase()
      return secretHeaders.has(lower) || patterns.some((pattern) => pattern.test(lower))
    }

    let readsBody = false
    let verified = false
    /** Header names read but not credential-shaped, for the sharper message. */
    const nonSecretHeadersRead: string[] = []
    let reportNode: any = null

    function literalString(node: any): string | null {
      const target = unwrapTsWrappers(node)
      if (!target) return null
      if (target.type === 'Literal' && typeof target.value === 'string') return target.value
      if (target.type === 'TemplateLiteral' && target.expressions.length === 0) {
        return String(target.quasis[0]?.value?.raw ?? '')
      }
      return null
    }

    /** Header argument that is an identifier/member named like a credential. */
    function looksLikeSecretHeaderExpression(node: any): boolean {
      const target = unwrapTsWrappers(node)
      if (!target) return false
      const name =
        target.type === 'Identifier'
          ? target.name
          : target.type === 'MemberExpression'
            ? getIdentifierName(target.property)
            : null
      return name !== null && isSecretHeaderName(name)
    }

    function recordHeaderRead(headerArgument: any): void {
      const literal = literalString(headerArgument)
      if (literal !== null) {
        if (isSecretHeaderName(literal)) verified = true
        else nonSecretHeadersRead.push(literal)
        return
      }
      // Non-literal: only a credential-shaped expression counts.
      if (looksLikeSecretHeaderExpression(headerArgument)) verified = true
    }

    return {
      CallExpression(node: any) {
        const callee = unwrapTsWrappers(node.callee)
        const calleeName = getIdentifierName(callee)

        if (calleeName && BODY_READERS.has(calleeName) && callee?.type === 'Identifier') {
          readsBody = true
          reportNode ??= callee
        }

        if (calleeName && HEADER_READERS.has(calleeName)) {
          recordHeaderRead(node.arguments?.[1])
        }

        // event.headers.get('x-hub-signature-256')
        if (
          callee?.type === 'MemberExpression' &&
          getIdentifierName(callee.property) === 'get' &&
          unwrapTsWrappers(callee.object)?.type === 'MemberExpression' &&
          getIdentifierName(unwrapTsWrappers(callee.object).property) === 'headers'
        ) {
          recordHeaderRead(node.arguments?.[0])
        }

        // A recognisable verification helper: verifyWebhookSignature(event).
        const helperName =
          calleeName ??
          (callee?.type === 'MemberExpression' ? getIdentifierName(callee.property) : null)
        if (helperName && VERIFY_ACTION.test(helperName) && VERIFY_SUBJECT.test(helperName)) {
          verified = true
        }
      },

      'Program:exit'(programNode: any) {
        if (!readsBody || verified) return

        if (nonSecretHeadersRead.length > 0) {
          context.report({
            node: reportNode ?? programNode,
            messageId: 'headerReadButNotSecret',
            data: { header: nonSecretHeadersRead[0] as string },
          })
          return
        }

        context.report({
          node: reportNode ?? programNode,
          messageId: 'missingSecretValidation',
        })
      },
    }
  },
} satisfies Rule.RuleModule
