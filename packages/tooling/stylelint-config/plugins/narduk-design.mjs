// @ts-nocheck — stylelint's Rule type requires ruleName/messages on the function.
import stylelint from 'stylelint'

const { createPlugin, utils } = stylelint

const RAW_Z_INDEX = 'narduk/no-raw-z-index'
const LEGACY_BREAKPOINTS = 'narduk/no-legacy-breakpoints'
const BS_ALIAS_ONLY = 'narduk/bs-alias-only'

/** @type {(name: string, impl: import('stylelint').Rule) => import('stylelint').Plugin} */
const plugin = createPlugin

const rawZIndex = plugin(RAW_Z_INDEX, (enabled) => (root, result) => {
  if (!enabled) return
  const valid = utils.validateOptions(result, RAW_Z_INDEX, { actual: enabled })
  if (!valid) return
  root.walkDecls('z-index', (decl) => {
    if (/^var\(--ns-z-[a-z0-9-]+\)$/u.test(decl.value.trim())) return
    utils.report({
      result,
      ruleName: RAW_Z_INDEX,
      node: decl,
      message: `Expected z-index to be var(--ns-z-*), not "${decl.value}"`,
    })
  })
})

const LEGACY_WIDTH = /\b(?:620|820|1080)px\b/u

const noLegacyBreakpoints = plugin(LEGACY_BREAKPOINTS, (enabled) => (root, result) => {
  if (!enabled) return
  const valid = utils.validateOptions(result, LEGACY_BREAKPOINTS, { actual: enabled })
  if (!valid) return
  root.walkAtRules('media', (rule) => {
    if (!LEGACY_WIDTH.test(rule.params)) return
    utils.report({
      result,
      ruleName: LEGACY_BREAKPOINTS,
      node: rule,
      message: `Expected Tailwind 40rem/64rem media, not "${rule.params.trim()}"`,
    })
  })
})

const bsAliasOnly = plugin(BS_ALIAS_ONLY, (enabled) => (root, result) => {
  if (!enabled) return
  const valid = utils.validateOptions(result, BS_ALIAS_ONLY, { actual: enabled })
  if (!valid) return
  root.walkDecls((decl) => {
    const name = decl.prop
    if (!name.startsWith('--bs-')) return
    const stem = name.slice('--bs-'.length)
    if (decl.value.trim() === `var(--ns-${stem})`) return
    utils.report({
      result,
      ruleName: BS_ALIAS_ONLY,
      node: decl,
      message: `Expected ${name} to be var(--ns-${stem}), not "${decl.value}"`,
    })
  })
})

export default [rawZIndex, noLegacyBreakpoints, bsAliasOnly]
