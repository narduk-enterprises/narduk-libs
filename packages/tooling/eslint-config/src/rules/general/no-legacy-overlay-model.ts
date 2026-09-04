/**
 * Nuxt UI v4 overlay components (`UModal`, `UPopover`, `USlideover`, `UDrawer`)
 * control visibility through the `open` model: `v-model:open`, `:open` and
 * `@update:open`. Older docs used the default `modelValue` model.
 *
 * Deep-review verdict: SOLID / KEEP (7 tests) — "correct `VDirectiveKey`
 * handling, modifier-preserving fix".
 *
 * REVIEW FINDING IMPLEMENTED — lowercased `VElement.name`. v1 matched on
 * `element.name`, which vue-eslint-parser lowercases. For these four
 * single-word component names the normalizer happened to round-trip
 * (`umodal` → `UModal`), which is why the review still graded the rule SOLID,
 * but it is the same latent trap that inverted `require-client-only-switch`
 * and `require-client-only-hydration-sensitive` (review proof 1). Matching
 * `rawName` first removes it. The one observable difference is that a
 * mis-cased `<Umodal>` — not a real component, and already
 * `vue/no-undef-components`' job — is no longer reported.
 *
 * THE SAME TRAP, THREE LINES DOWN — fixed in the deep-review pass. The element
 * check took `rawName` and every *attribute* check took `name`, so the rule
 * caught kebab-case `v-model:model-value` and missed the camelCase spelling the
 * Nuxt UI docs actually used: `v-model:modelValue`, `:modelValue` and the plain
 * `modelValue` attribute all arrive as `modelvalue` (HTML attribute names are
 * case-folded by the parser), and `normalizePropName('modelvalue')` is
 * `'modelvalue'`, not `'modelValue'`. Half the legacy bindings this rule exists
 * to find were invisible to it. Every attribute name now reads `rawName` first,
 * which also fixes the report text: `@update:modelValue` used to be echoed back
 * as `"update:modelvalue"`, telling the author to fix a string that is not in
 * their file. Detection of that event was already case-insensitive; only the
 * message was wrong.
 *
 * Autofix KEPT, with one added guard. Every fix replaces the directive key or
 * its argument range only, so modifiers and the bound value survive
 * (`v-model.lazy` → `v-model:open.lazy`, proven by an `output:` assertion).
 * The added guard: a directive that HAS an argument which is not a
 * `VIdentifier` — i.e. a dynamic argument, `v-model:[key]="x"` — used to fall
 * through `getDirectiveArgument()`'s `null` return into the "bare v-model"
 * branch, which reports and then rewrites the whole key range to
 * `v-model:open`, *deleting the dynamic argument*. That is a code-corrupting
 * fixer of exactly the class the review told us never to ship (its five proven
 * corrupting fixers do not survive this port). Dynamic arguments are now
 * skipped before the report, and the case is a `valid` test. The corruption is
 * reproduced against the v1 source, not inferred: v1 turns
 * `<UModal v-model:[key]="open" />` into `<UModal v-model:open="open" />`.
 *
 * Typed against vue-eslint-parser's OWN `VAttribute | VDirective` union.
 * DESIGN.md drops v1's hand-written `types/vue-eslint-parser.d.ts`, which the
 * review proved wrong (it declared `VDirective { type: 'VDirective' }` against
 * the parser's actual `type: 'VAttribute'` + `directive: true` discriminant,
 * and directly caused review proof 8). v1's `range != null` guards existed only
 * because those fake types made `range` look optional; the real `HasLocation`
 * declares it required, so they are gone.
 */

import type { AST } from 'vue-eslint-parser'
import type { Rule } from 'eslint'

const OVERLAY_COMPONENTS = new Set(['UModal', 'UPopover', 'USlideover', 'UDrawer'])

/** v1 `component-utils.normalizeComponentName(name, ['U'])`, behaviour-for-behaviour. */
function normalizeComponentName(name: string): string | null {
  if (name.charAt(0) === name.charAt(0).toUpperCase() && !name.includes('-')) {
    return name.startsWith('U') ? name : null
  }

  let pascalCase: string
  if (name.includes('-')) {
    pascalCase = name
      .split('-')
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
      .join('')
  } else {
    const firstChar = name.charAt(0).toUpperCase()
    const rest = name.slice(1)
    pascalCase =
      name.length > 1 && name.charAt(0).toLowerCase() === name.charAt(0)
        ? firstChar + (rest.charAt(0).toUpperCase() + rest.slice(1).toLowerCase())
        : firstChar + rest
  }

  return pascalCase.startsWith('U') ? pascalCase : null
}

/** v1 `component-utils.normalizePropName` — kebab-case to camelCase. */
function normalizePropName(name: string): string {
  if (!name.includes('-')) {
    return name
  }
  return name
    .split('-')
    .map((part, index) => (index === 0 ? part : part.charAt(0).toUpperCase() + part.slice(1)))
    .join('')
}

type TemplateAttribute = AST.VAttribute | AST.VDirective

function isDirective(attr: TemplateAttribute): attr is AST.VDirective {
  return attr.directive
}

/** The static argument of a directive, or `null` for none / a dynamic one. */
function getDirectiveArgument(key: AST.VDirectiveKey): AST.VIdentifier | null {
  return key.argument?.type === 'VIdentifier' ? key.argument : null
}

/**
 * The attribute/argument name **as written**.
 *
 * `VIdentifier.name` is case-folded (HTML attribute names are), so it reports
 * `modelValue` as `modelvalue` and never round-trips through the camelCase
 * normalizer. `rawName` is the source spelling. See the header.
 */
function rawNameOf(node: { name: string; rawName?: string }): string {
  return node.rawName ?? node.name
}

/** True when the directive carries an argument the rule cannot statically read. */
function hasDynamicArgument(key: AST.VDirectiveKey): boolean {
  return key.argument != null && key.argument.type !== 'VIdentifier'
}

function isLegacyModelValueProp(name: string): boolean {
  return normalizePropName(name) === 'modelValue'
}

function isLegacyUpdateModelValueEvent(name: string): boolean {
  return name.toLowerCase().replaceAll('-', '') === 'update:modelvalue'
}

function getModelDirectiveReplacement(key: AST.VDirectiveKey): string {
  const modifiers = (key.modifiers ?? [])
    .map((modifier) => `.${modifier.rawName ?? modifier.name}`)
    .join('')

  return `v-model:open${modifiers}`
}

export default {
  meta: {
    type: 'problem' as const,
    docs: {
      description: 'disallow legacy overlay model bindings and events from older Nuxt UI docs',
      recommended: true,
    },
    fixable: 'code' as const,
    schema: [],
    messages: {
      preferOpenModel:
        '{{componentName}} controls visibility with `v-model:open`, not bare `v-model`.',
      preferOpenProp:
        '{{componentName}} uses the `open` prop for controlled state. Replace "{{propName}}" with "open" or use `v-model:open`.',
      preferOpenUpdate: '{{componentName}} emits `update:open`, not "{{eventName}}".',
    },
  },

  create(context: Rule.RuleContext): Rule.RuleListener {
    const parserServices = context.sourceCode?.parserServices as any
    if (!parserServices?.defineTemplateBodyVisitor) {
      return {}
    }

    return parserServices.defineTemplateBodyVisitor({
      VElement(node: AST.VElement) {
        const componentName = normalizeComponentName(node.rawName ?? node.name)

        if (!componentName || !OVERLAY_COMPONENTS.has(componentName)) {
          return
        }

        for (const attr of node.startTag.attributes as TemplateAttribute[]) {
          if (isDirective(attr)) {
            const key = attr.key

            // A dynamic argument (`v-model:[key]`, `:[prop]`, `@[evt]`) cannot
            // be read statically. Bailing here is what keeps the fixer from
            // deleting it — see the header note.
            if (hasDynamicArgument(key)) {
              continue
            }

            const directiveName = key.name.name
            const argument = getDirectiveArgument(key)
            const argumentName = argument ? rawNameOf(argument) : null

            if (directiveName === 'model') {
              if (!argument) {
                context.report({
                  node: attr,
                  messageId: 'preferOpenModel',
                  data: { componentName },
                  fix: (fixer) =>
                    fixer.replaceTextRange(key.range, getModelDirectiveReplacement(key)),
                })
                continue
              }

              if (isLegacyModelValueProp(argumentName!)) {
                context.report({
                  node: attr,
                  messageId: 'preferOpenProp',
                  data: { componentName, propName: argumentName! },
                  fix: (fixer) => fixer.replaceTextRange(argument.range, 'open'),
                })
                continue
              }
            }

            if (directiveName === 'bind' && argument && isLegacyModelValueProp(argumentName!)) {
              context.report({
                node: attr,
                messageId: 'preferOpenProp',
                data: { componentName, propName: argumentName! },
                fix: (fixer) => fixer.replaceTextRange(argument.range, 'open'),
              })
              continue
            }

            if (
              directiveName === 'on' &&
              argument &&
              isLegacyUpdateModelValueEvent(argumentName!)
            ) {
              context.report({
                node: attr,
                messageId: 'preferOpenUpdate',
                data: { componentName, eventName: argumentName! },
                fix: (fixer) => fixer.replaceTextRange(argument.range, 'update:open'),
              })
            }

            continue
          }

          const attributeName = rawNameOf(attr.key)

          if (!isLegacyModelValueProp(attributeName)) {
            continue
          }

          const range = attr.key.range
          context.report({
            node: attr,
            messageId: 'preferOpenProp',
            data: { componentName, propName: attributeName },
            fix: (fixer) => fixer.replaceTextRange(range, 'open'),
          })
        }
      },
    }) as Rule.RuleListener
  },
} satisfies Rule.RuleModule
