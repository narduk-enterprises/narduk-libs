/**
 * Rule: no-static-element-interactions
 *
 * A `<div @click>` is reachable by pointer only: no keyboard focus, no key
 * activation, and nothing a screen reader announces as actionable. This
 * replaces the `a11y` pack's upstream `vuejs-accessibility/no-static-element-
 * interactions` and `click-events-have-key-events`, which together reported 16
 * findings on pacc-trac of which 6 were not defects: a `role="dialog"` with a
 * key handler, a drag-and-drop zone, a `<header>` landmark that routes menu
 * keys, and a `@click.capture` that swallows the click ending a drag.
 *
 *   flagged   <div @click="open">                 — static element, no role
 *             <span @keydown.enter="go">
 *             <div role="button" @click="open">    — widget role, no key handler
 *
 *   allowed   <UCard @click="open">                — components own their semantics
 *             <div role="dialog" @keydown="onKey">  — a non-widget role is a container
 *             <div @dragover.prevent @drop="take">  — pointer-only enhancement
 *             <div @click.capture="swallow">        — intercepts, does not interact
 *             <div @click.stop>                     — no handler at all
 *             <div aria-hidden="true" @click="x">
 *             <div role="button" tabindex="0" @click="x" @keydown.enter="x">
 *
 * Only genuinely static elements are inspected (no implicit ARIA role); a
 * landmark, list item or table cell with a handler is a different question
 * that this rule does not try to answer.
 */

import type { Rule } from 'eslint'

import { templateBodyVisitor } from '../hydration/_internal'

const STATIC_ELEMENTS = new Set(['b', 'div', 'em', 'i', 'p', 'small', 'span', 'strong'])

const POINTER_HANDLERS = new Set(['click', 'mousedown', 'mouseup'])
const KEY_HANDLERS = new Set(['keydown', 'keypress', 'keyup'])

/** ARIA widget roles: these promise keyboard operation. */
const WIDGET_ROLES = new Set([
  'button',
  'checkbox',
  'combobox',
  'gridcell',
  'link',
  'menuitem',
  'menuitemcheckbox',
  'menuitemradio',
  'option',
  'radio',
  'scrollbar',
  'searchbox',
  'slider',
  'spinbutton',
  'switch',
  'tab',
  'textbox',
  'treeitem',
])

function attribute(node: any, name: string): any {
  return node.startTag.attributes.find((attr: any) =>
    attr.directive
      ? attr.key.name?.name === 'bind' && attr.key.argument?.name === name
      : attr.key.name === name,
  )
}

/** The literal role, `''` for no role, `null` for a bound role we cannot read. */
function roleOf(node: any): string | null {
  const attr = attribute(node, 'role')
  if (!attr) return ''
  if (attr.directive) {
    const expression = attr.value?.expression
    return expression?.type === 'Literal' && typeof expression.value === 'string'
      ? expression.value.trim().split(/\s+/)[0]!.toLowerCase()
      : null
  }
  return (attr.value?.value ?? '').trim().split(/\s+/)[0]!.toLowerCase()
}

function isAriaHidden(node: any): boolean {
  const attr = attribute(node, 'aria-hidden')
  if (!attr) return false
  if (attr.directive) return attr.value?.expression?.value === true
  return attr.value === null || attr.value.value !== 'false'
}

/** Event names of `v-on` handlers that actually run code outside capture phase. */
function handledEvents(node: any): Set<string> {
  const events = new Set<string>()
  for (const attr of node.startTag.attributes) {
    if (!attr.directive || attr.key.name?.name !== 'on') continue
    const name = attr.key.argument?.type === 'VIdentifier' ? attr.key.argument.name : null
    if (!name || !attr.value?.expression) continue
    if (attr.key.modifiers?.some((modifier: any) => modifier.name === 'capture')) continue
    events.add(name.toLowerCase())
  }
  return events
}

export default {
  meta: {
    type: 'problem' as const,
    docs: {
      description:
        'disallow pointer and key handlers on static elements, and widget roles without a key handler',
      recommended: true,
    },
    schema: [],
    messages: {
      staticElement:
        '`<{{ element }}>` with `@{{ event }}` cannot be reached by keyboard or announced as actionable. Use `<UButton>` or `<NuxtLink>`, or give it a widget role, `tabindex="0"` and a key handler.',
      missingKeyHandler:
        '`role="{{ role }}"` with `@click` needs a key handler too (`@keydown.enter`, `@keydown.space`), or keyboard users cannot activate it.',
    },
  },

  create(context: Rule.RuleContext): Rule.RuleListener {
    return templateBodyVisitor(context, {
      VElement(node: any) {
        const element = node.rawName
        if (!STATIC_ELEMENTS.has(element) || isAriaHidden(node)) return
        const events = handledEvents(node)
        const pointer = [...events].find((event) => POINTER_HANDLERS.has(event))
        const key = [...events].find((event) => KEY_HANDLERS.has(event))
        if (!pointer && !key) return

        const role = roleOf(node)
        if (role === null || role === 'presentation' || role === 'none') return
        if (role === '') {
          context.report({
            node: node.startTag,
            messageId: 'staticElement',
            data: { element, event: pointer ?? key! },
          })
          return
        }
        if (WIDGET_ROLES.has(role) && events.has('click') && !key) {
          context.report({ node: node.startTag, messageId: 'missingKeyHandler', data: { role } })
        }
      },
    })
  },
} satisfies Rule.RuleModule
