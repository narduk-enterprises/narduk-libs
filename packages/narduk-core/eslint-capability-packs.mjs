// @ts-check
/**
 * Strict capability preset for independent Narduk apps and shared packages.
 * Import this everywhere so `eslint .` matches consumer apps using the full
 * Narduk preset (correctness, a11y, complexity, formatting, e2e, …).
 *
 * @type {const}
 */
export const nardukTemplateStrictCapabilityPacks = [
  'core',
  'designSystem',
  'nuxtUi',
  'seo',
  'server',
  'auth',
  'template',
  'cloudflare',
  'correctness',
  'a11y',
  'complexity',
  'formatting',
  'e2e',
]
