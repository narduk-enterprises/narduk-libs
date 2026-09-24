import nardukDesign from './plugins/narduk-design.mjs'

/** @type {import('stylelint').Config} */
const config = {
  defaultSeverity: 'warning',
  plugins: nardukDesign,
  rules: {
    'narduk/no-raw-z-index': true,
    'narduk/no-legacy-breakpoints': true,
    'narduk/bs-alias-only': true,
    'media-feature-name-value-allowed-list': {
      width: ['40rem', '64rem'],
    },
  },
}

export default config
