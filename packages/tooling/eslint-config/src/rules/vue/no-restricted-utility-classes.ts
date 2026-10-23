/**
 * Rule: no-restricted-utility-classes
 *
 * The design-system pack's class bans, by name alone. They used to run through
 * `better-tailwindcss/no-restricted-classes`, which disables itself with a stderr
 * line when `tailwindcss` does not resolve from the lint cwd (an app that gets
 * Tailwind only through `@nuxt/ui`), and which matched the whole class, so
 * `hover:text-slate-500`, `text-slate-400/80` and `!text-slate-400` passed.
 *
 *   flagged   class="text-slate-500 md:hover:bg-gray-900/80 !border-red-200"
 *             class="text-[#9aa4b0] bg-[rgb(1_2_3)]"     — arbitrary colour
 *             class="h-screen min-h-[calc(100vh-4rem)]"  — `h-dvh` is the fix
 *             :class="{ 'bg-blue-50': active }"   cn('text-zinc-400', …)
 *
 *   allowed   class="text-muted bg-elevated text-ink"     — semantic tokens
 *             class="bg-[var(--chart-1)] h-dvh"
 *             `text-${tone}-500`                           — not a whole class
 *
 * Read from `class`/`*-class` attributes, `:class`/`:ui` bindings, the usual
 * class-merging callees and `classes`/`className` variables. `allowRawPalette`
 * turns off the palette half for chart and data-viz files.
 */

import type { Rule } from 'eslint'

import { templateBodyVisitor } from '../hydration/_internal'

const PALETTE_COLORS = [
  'amber',
  'blue',
  'cyan',
  'emerald',
  'fuchsia',
  'gray',
  'green',
  'indigo',
  'lime',
  'neutral',
  'orange',
  'pink',
  'purple',
  'red',
  'rose',
  'sky',
  'slate',
  'stone',
  'teal',
  'violet',
  'yellow',
  'zinc',
]

const COLOR_UTILITIES = [
  'accent',
  'bg',
  'border(?:-[xytrblse])?',
  'caret',
  'decoration',
  'divide',
  'fill',
  'from',
  'outline',
  'placeholder',
  'ring-offset',
  'ring',
  'shadow',
  'stroke',
  'text',
  'to',
  'via',
]

/** Any run of variants: `md:`, `group-hover:`, `data-[state=open]:`, `[&>svg]:`. */
const VARIANTS = String.raw`(?:(?:[^\s:[]|\[[^\]]*\])+:)*`
const UTILITY = `(?:${COLOR_UTILITIES.join('|')})`
const MODIFIER = String.raw`(?:/(?:\d+|\[[^\]]+\]|\([^)]+\)))?`

const RAW_PALETTE = new RegExp(
  `^${VARIANTS}!?-?${UTILITY}-(?:${PALETTE_COLORS.join('|')})-\\d{2,3}${MODIFIER}!?$`,
)
const ARBITRARY_COLOR = new RegExp(
  `^${VARIANTS}!?${UTILITY}-\\[(?:color:)?(?:#[\\da-f]{3,8}|(?:rgba?|hsla?|hwb|oklch|oklab|lab|lch|color)\\([^\\]]*\\))\\]${MODIFIER}!?$`,
  'i',
)

const VIEWPORT_FIXES: Array<[RegExp, string]> = [
  [new RegExp(`^(${VARIANTS}!?)h-screen(!?)$`), '$1h-dvh$2'],
  [new RegExp(`^(${VARIANTS}!?)min-h-screen(!?)$`), '$1min-h-dvh$2'],
]
const VIEWPORT_UNFIXABLE = [new RegExp(`^${VARIANTS}!?max-h-screen!?$`), /\[[^\]]*\dvh(?![a-z])/]

const CLASS_ATTRIBUTE = /^(?:class|ui)$|^(?!data-).+(?:-class|Class)$/
const CLASS_CALLEES = new Set([
  'cc',
  'clb',
  'clsx',
  'cn',
  'cnb',
  'ctl',
  'cva',
  'cx',
  'dcnb',
  'objstr',
  'tv',
  'twJoin',
  'twMerge',
])
const CLASS_VARIABLE = /^(?:classNames?|classes|styles?)$/

interface Options {
  allowRawPalette?: boolean
}

export default {
  meta: {
    type: 'suggestion' as const,
    fixable: 'code' as const,
    docs: {
      description:
        'disallow raw Tailwind palette and arbitrary colour classes, and `vh`/`screen` heights',
      recommended: true,
    },
    schema: [
      {
        type: 'object',
        properties: { allowRawPalette: { type: 'boolean' } },
        additionalProperties: false,
      },
    ],
    messages: {
      rawPalette:
        "`{{ name }}` is a raw Tailwind palette class. Use a semantic token from your theme: Nuxt UI (`text-muted`, `bg-elevated`, `border-default`) or the app's own `--color-*` tokens. A chart palette belongs in `allowedRawPaletteFiles`.",
      arbitraryColor:
        '`{{ name }}` hard-codes a colour. Use a semantic token from your theme, or `bg-(--my-token)` for an app-defined `--color-*` variable.',
      viewportHeight:
        '`{{ name }}`: use dvh or svh units, not vh or screen. `h-dvh`/`min-h-dvh` follow the visible viewport, `h-svh` is the smallest one (mobile web QA rule 4).',
    },
  },

  create(context: Rule.RuleContext): Rule.RuleListener {
    const { allowRawPalette = false } = (context.options[0] ?? {}) as Options
    const sourceCode = context.sourceCode
    // `const classes = cn('…')` reaches the same literal through both script visitors.
    const seen = new Set<any>()

    /** `start` is the offset of `text` in the file when its characters are verbatim there. */
    function checkText(
      node: any,
      text: string,
      start: number | null,
      partialEdges = [false, false],
    ) {
      if (seen.has(node)) return
      seen.add(node)
      const tokens = [...text.matchAll(/\S+/g)]
      for (const [index, match] of tokens.entries()) {
        const name = match[0]
        const at = match.index!
        // `text-${tone}-500`: a token touching an interpolation is not a whole class.
        if (partialEdges[0] && index === 0 && at === 0) continue
        if (partialEdges[1] && index === tokens.length - 1 && at + name.length === text.length)
          continue

        const range: [number, number] | null =
          start === null ? null : [start + at, start + at + name.length]
        const where = range
          ? {
              loc: {
                start: sourceCode.getLocFromIndex(range[0]),
                end: sourceCode.getLocFromIndex(range[1]),
              },
            }
          : { node }

        const fix = VIEWPORT_FIXES.find(([pattern]) => pattern.test(name))
        if (fix || VIEWPORT_UNFIXABLE.some((pattern) => pattern.test(name))) {
          context.report({
            ...where,
            messageId: 'viewportHeight',
            data: { name },
            fix:
              fix && range
                ? (fixer) => fixer.replaceTextRange(range, name.replace(fix[0], fix[1]))
                : null,
          })
          continue
        }
        if (allowRawPalette) continue
        if (RAW_PALETTE.test(name))
          context.report({ ...where, messageId: 'rawPalette', data: { name } })
        else if (ARBITRARY_COLOR.test(name))
          context.report({ ...where, messageId: 'arbitraryColor', data: { name } })
      }
    }

    /** Offset of a string literal's value in the file, or null when escapes shift it. */
    function verbatimStart(node: any): number | null {
      const raw = sourceCode.text.slice(node.range[0], node.range[1])
      return raw.length === String(node.value).length + 2 ? node.range[0] + 1 : null
    }

    /** Visit only positions whose value becomes a class: never a test or a comparison. */
    function checkExpression(expression: any): void {
      if (!expression || typeof expression !== 'object') return
      switch (expression.type) {
        case 'Literal':
          if (typeof expression.value === 'string')
            checkText(expression, expression.value, verbatimStart(expression))
          return
        case 'TemplateLiteral': {
          const last = expression.quasis.length - 1
          for (const [index, quasi] of expression.quasis.entries()) {
            checkText(quasi, quasi.value.cooked ?? '', null, [index > 0, index < last])
          }
          for (const inner of expression.expressions) checkExpression(inner)
          return
        }
        case 'ConditionalExpression':
          checkExpression(expression.consequent)
          checkExpression(expression.alternate)
          return
        case 'LogicalExpression':
          // `active && 'x'` yields only its right side as a class.
          if (expression.operator !== '&&') checkExpression(expression.left)
          checkExpression(expression.right)
          return
        case 'ArrayExpression':
          for (const element of expression.elements) checkExpression(element)
          return
        case 'ObjectExpression':
          // `{ 'bg-blue-50': on }` keys are classes; `:ui="{ base: '…' }"` values are.
          for (const property of expression.properties) {
            if (property.type === 'SpreadElement') checkExpression(property.argument)
            else {
              if (!property.computed) checkExpression(property.key)
              checkExpression(property.value)
            }
          }
          return
        case 'CallExpression':
          if (expression.callee.type === 'Identifier' && CLASS_CALLEES.has(expression.callee.name))
            for (const argument of expression.arguments) checkExpression(argument)
          return
        case 'SpreadElement':
        case 'ChainExpression':
        case 'TSAsExpression':
        case 'TSNonNullExpression':
        case 'TSSatisfiesExpression':
          checkExpression(expression.argument ?? expression.expression)
          return
        default:
      }
    }

    return templateBodyVisitor(
      context,
      {
        VAttribute(node: any) {
          if (!node.directive) {
            if (CLASS_ATTRIBUTE.test(node.key.rawName ?? node.key.name) && node.value) {
              checkText(node.value, node.value.value, verbatimStart(node.value))
            }
            return
          }
          if (node.key.name?.name !== 'bind') return
          const argument = node.key.argument
          if (argument?.type !== 'VIdentifier' || !CLASS_ATTRIBUTE.test(argument.rawName)) return
          checkExpression(node.value?.expression)
        },
      },
      {
        CallExpression(node: any) {
          if (node.callee.type === 'Identifier' && CLASS_CALLEES.has(node.callee.name)) {
            for (const argument of node.arguments) checkExpression(argument)
          }
        },
        VariableDeclarator(node: any) {
          if (node.id.type === 'Identifier' && CLASS_VARIABLE.test(node.id.name)) {
            checkExpression(node.init)
          }
        },
      },
    )
  },
} satisfies Rule.RuleModule
