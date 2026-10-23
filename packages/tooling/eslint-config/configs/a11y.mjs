// @ts-check
/**
 * `a11y` capability pack.
 *
 * Wraps `eslint-plugin-vuejs-accessibility`'s `flat/recommended` preset and
 * downgrades every enabled rule to `warn` (narduk-lint fails any warning), then
 * teaches the rules that look at element names about Nuxt and Nuxt UI:
 * `NuxtImg`/`NuxtPicture` are images and `NuxtLink`/`ULink`/`RouterLink` are
 * anchors. The upstream rules only inspect native elements, so a PascalCase
 * component such as `<UButton @click>` or `<UCard @click>` is never reported;
 * `tests/composition/a11y-nuxt-ui.test.ts` pins both directions.
 */

import vuejsAccessibility from 'eslint-plugin-vuejs-accessibility'

import narduk from '../dist/index.js'

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

/** Router links render an `<a>`; an empty one is an unnamed link. */
const LINK_COMPONENTS = ['NuxtLink', 'ULink', 'RouterLink']

/** Nuxt UI form controls: a `<label>` wrapping one is associated by nesting. */
const CONTROL_COMPONENTS = [
  'UCheckbox',
  'UCheckboxGroup',
  'UColorPicker',
  'UFileUpload',
  'UInput',
  'UInputDate',
  'UInputMenu',
  'UInputNumber',
  'UInputTags',
  'UInputTime',
  'UPinInput',
  'URadioGroup',
  'USelect',
  'USelectMenu',
  'USlider',
  'USwitch',
  'UTextarea',
]

/** @type {import('eslint').Linter.Config[]} */
const a11yConfigs = recommended.map((entry, index) => {
  if (index === 0 || !entry?.rules) {
    return entry
  }

  return {
    ...entry,
    files: entry.files ?? ['**/*.vue'],
    plugins: { ...entry.plugins, narduk },
    rules: {
      ...warnify(entry.rules),
      'vuejs-accessibility/alt-text': [
        'warn',
        {
          img: ['img', 'NuxtImg', 'NuxtPicture'],
          object: ['object'],
        },
      ],
      'vuejs-accessibility/anchor-has-content': ['warn', { components: LINK_COMPONENTS }],
      // Upstream's default demands nesting AND `for`; either one associates
      // the label (HTML 4.10.4), so `<label for="x">` beside its input is fine.
      'vuejs-accessibility/label-has-for': [
        'warn',
        { controlComponents: CONTROL_COMPONENTS, required: { some: ['nesting', 'id'] } },
      ],
      // Components stay in scope: `<UInput autofocus>` renders a native
      // autofocus. Nuxt UI overlays already move focus into themselves on open.
      'vuejs-accessibility/no-autofocus': ['warn', { ignoreNonDOM: false }],
      // One precise rule in place of these two; see its header for the
      // findings upstream reported on a dialog, a drop zone and a capture.
      'vuejs-accessibility/click-events-have-key-events': 'off',
      'vuejs-accessibility/no-static-element-interactions': 'off',
      'narduk/no-static-element-interactions': 'warn',
    },
  }
})

export { a11yConfigs }
export default a11yConfigs
