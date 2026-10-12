/** @type {import("prettier").Config} */
// A found package-local config REPLACES the root one wholesale (Prettier
// resolves to the nearest config file only; it does not merge configs), so
// this restates the root monorepo settings and adds the one override this
// package's extracted source actually needs: `arrowParens: 'avoid'`. Preserves
// the extracted source style (byte-identical) rather than reformatting a
// large, actively-published library on the move -- same rationale as
// packages/design/narduk-ui's local override.
export default {
  semi: false,
  singleQuote: true,
  jsxSingleQuote: false,
  trailingComma: 'all',
  printWidth: 100,
  tabWidth: 2,
  useTabs: false,
  endOfLine: 'lf',
  bracketSpacing: true,
  bracketSameLine: false,
  vueIndentScriptAndStyle: false,
  arrowParens: 'avoid',
  overrides: [
    {
      files: ['*.json', '*.jsonc', '*.json5'],
      options: {
        trailingComma: 'none',
      },
    },
    {
      files: ['*.md', '*.mdx'],
      options: {
        proseWrap: 'always',
        printWidth: 80,
      },
    },
    {
      files: ['*.yaml', '*.yml'],
      options: {
        singleQuote: false,
        trailingComma: 'none',
      },
    },
  ],
}
