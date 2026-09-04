// @ts-check
/**
 * `a11y` capability pack.
 *
 * Wraps `eslint-plugin-vuejs-accessibility`'s `flat/recommended` preset and
 * downgrades every enabled rule to `warn`, then widens the `alt-text` heuristic
 * so Nuxt image components count as `<img>`.
 */

import vuejsAccessibility from 'eslint-plugin-vuejs-accessibility'

const recommended = vuejsAccessibility.configs?.['flat/recommended'] ?? []

/**
 * Force enabled severities in a rules map down to `warn`, preserving options.
 * Rules the upstream preset explicitly disables stay disabled.
 *
 * @param {Record<string, unknown> | undefined} rulesMap
 */
function warnify(rulesMap) {
  if (!rulesMap) return {}

  /** @type {Record<string, unknown>} */
  const result = {}

  for (const [ruleName, setting] of Object.entries(rulesMap)) {
    if (Array.isArray(setting)) {
      const [severity, ...options] = setting
      result[ruleName] = severity === 0 || severity === 'off' ? setting : ['warn', ...options]
    } else {
      result[ruleName] = setting === 0 || setting === 'off' ? setting : 'warn'
    }
  }

  return result
}

/** @type {import('eslint').Linter.Config[]} */
const a11yConfigs = recommended.map((entry, index) => {
  if (index === 0 || !entry?.rules) {
    return entry
  }

  return {
    ...entry,
    files: entry.files ?? ['**/*.vue'],
    rules: {
      ...warnify(entry.rules),
      'vuejs-accessibility/alt-text': [
        'warn',
        {
          img: ['img', 'NuxtImg', 'NuxtPicture'],
          object: ['object'],
        },
      ],
    },
  }
})

export { a11yConfigs }
export default a11yConfigs
