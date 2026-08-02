/**
 * Nuxt UI v4's `useOverlay()` dropped the script-side `events` option and the
 * `.result` promise. An overlay resolves from `await modal.open()`, and the
 * overlay component emits `close`.
 *
 * Deep-review verdict: SOLID / KEEP (7 tests) — "real scope resolution,
 * verifies import source". This rule is one of the few in v1 that actually
 * checks WHERE `useOverlay` came from before reporting, so a same-named local
 * helper or a third-party `useOverlay` is left alone. Ported unchanged apart
 * from the ESLint 10 API surface.
 *
 * Known, tested boundary: the factory call must be a bare `Identifier` named
 * `useOverlay`. An aliased import (`import { useOverlay as useOv }`) or a
 * namespace call (`import * as ui; ui.useOverlay()`) is not reported — the
 * review's repo-wide alias/namespace weakness class. Both are asserted as
 * `valid` cases so the boundary is visible rather than assumed. Widening the
 * match is deliberately out of scope for a KEEP port: the import-source check
 * is what makes this rule safe, and it is keyed to the binding name.
 */

import type { Rule } from 'eslint'

const NUXT_UI_OVERLAY_SOURCES = new Set(['#imports', '@nuxt/ui', '@nuxt/ui/runtime/composables'])

function isIdentifier(node: any, name?: string): boolean {
  return node?.type === 'Identifier' && (name == null || node.name === name)
}

function resolveVariable(sourceCode: Rule.RuleContext['sourceCode'], identifier: any) {
  if (!isIdentifier(identifier)) {
    return null
  }

  let scope: ReturnType<typeof sourceCode.getScope> | null = sourceCode.getScope(identifier)
  while (scope) {
    const variable = scope.set.get(identifier.name)
    if (variable) {
      return variable
    }
    scope = scope.upper
  }

  return null
}

type ImportLikeDefinition = { type?: string; parent?: unknown }
type VariableLike = { defs?: ImportLikeDefinition[] }

function isNuxtUiUseOverlayVariable(variable: VariableLike | null | undefined): boolean {
  const defs = Array.isArray(variable?.defs) ? variable.defs : []

  // No definition at all: Nuxt auto-imports `useOverlay` with no import
  // statement, which is the canonical app spelling.
  if (defs.length === 0) {
    return true
  }

  return defs.some((definition) => {
    if (definition?.type !== 'ImportBinding') {
      return false
    }
    const importSource = (definition.parent as { source?: { value?: unknown } } | null | undefined)
      ?.source?.value
    return typeof importSource === 'string' && NUXT_UI_OVERLAY_SOURCES.has(importSource)
  })
}

function isUseOverlayCall(node: any, sourceCode: Rule.RuleContext['sourceCode']): boolean {
  if (node?.type !== 'CallExpression' || !isIdentifier(node.callee, 'useOverlay')) {
    return false
  }
  const variable = resolveVariable(sourceCode, node.callee)
  return variable == null || isNuxtUiUseOverlayVariable(variable)
}

function isOverlayCreateCall(
  node: any,
  overlayFactories: Set<any>,
  sourceCode: Rule.RuleContext['sourceCode'],
): boolean {
  if (node?.type !== 'CallExpression') {
    return false
  }

  const callee = node.callee
  if (callee?.type !== 'MemberExpression' || callee.computed) {
    return false
  }
  if (!isIdentifier(callee.property, 'create')) {
    return false
  }

  if (callee.object?.type === 'Identifier') {
    const variable = resolveVariable(sourceCode, callee.object)
    return variable != null && overlayFactories.has(variable)
  }

  return isUseOverlayCall(callee.object, sourceCode)
}

function getStaticPropertyName(node: any): string | null {
  if (node?.type !== 'Property' || node.computed) {
    return null
  }
  if (node.key?.type === 'Identifier') {
    return node.key.name
  }
  if (node.key?.type === 'Literal' && typeof node.key.value === 'string') {
    return node.key.value
  }
  return null
}

export default {
  meta: {
    type: 'problem' as const,
    docs: {
      description: 'disallow legacy useOverlay patterns from older Nuxt UI docs',
      recommended: true,
    },
    schema: [],
    messages: {
      noEventsOption:
        'Nuxt UI v4 useOverlay does not use an `events` option on overlay.create(). Emit `close` from the overlay component and await `modal.open()` instead.',
      noResultProperty:
        'Nuxt UI v4 overlay instances resolve from `await modal.open()`, not `modal.result`.',
    },
  },

  create(context: Rule.RuleContext): Rule.RuleListener {
    const sourceCode = context.sourceCode
    const overlayFactories = new Set<any>()
    const overlayInstances = new Set<any>()

    return {
      VariableDeclarator(node: any) {
        if (!isIdentifier(node.id)) {
          return
        }

        const declaredVariable = resolveVariable(sourceCode, node.id)
        if (!declaredVariable) {
          return
        }

        if (isUseOverlayCall(node.init, sourceCode)) {
          overlayFactories.add(declaredVariable)
          return
        }

        if (isOverlayCreateCall(node.init, overlayFactories, sourceCode)) {
          overlayInstances.add(declaredVariable)
        }
      },

      CallExpression(node: any) {
        if (!isOverlayCreateCall(node, overlayFactories, sourceCode)) {
          return
        }

        const options = node.arguments[1]
        if (options?.type !== 'ObjectExpression') {
          return
        }

        for (const property of options.properties) {
          if (getStaticPropertyName(property) !== 'events') {
            continue
          }
          context.report({
            node: property.key ?? property,
            messageId: 'noEventsOption',
          })
        }
      },

      MemberExpression(node: any) {
        if (node.computed || !isIdentifier(node.property, 'result')) {
          return
        }

        const object = node.object
        const isTrackedInstance =
          (object?.type === 'Identifier' &&
            (() => {
              const variable = resolveVariable(sourceCode, object)
              return variable != null && overlayInstances.has(variable)
            })()) ||
          isOverlayCreateCall(object, overlayFactories, sourceCode)

        if (!isTrackedInstance) {
          return
        }

        context.report({
          node: node.property,
          messageId: 'noResultProperty',
        })
      },
    }
  },
} satisfies Rule.RuleModule
