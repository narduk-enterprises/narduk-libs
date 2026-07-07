// @ts-check
/**
 * Prettier configuration for the narduk-libs monorepo.
 *
 * Notes:
 * - eslint-config-prettier (already in @narduk/eslint-config) disables every ESLint
 *   rule that would conflict with Prettier's output — ESLint catches logic/quality
 *   issues, Prettier owns formatting. They are fully orthogonal.
 * - Prettier 3.x natively handles .vue files via the built-in html/vue parser.
 *   No external plugin is required.
 */

/** @type {import('prettier').Config} */
export default {
  // ── Core style ─────────────────────────────────────────────────────────────
  semi: false, // No trailing semicolons (Nuxt/Vue ecosystem convention)
  singleQuote: true, // 'single' over "double" for JS/TS strings
  jsxSingleQuote: false, // JSX keeps double quotes (HTML attribute convention)
  trailingComma: 'all', // Trailing commas everywhere ES5+ supports them
  printWidth: 100, // Generous line width for modern monitors
  tabWidth: 2, // 2-space indent
  useTabs: false, // Spaces, not tabs

  // ── End of line ────────────────────────────────────────────────────────────
  endOfLine: 'lf', // Always LF — consistent across macOS/Linux/CI

  // ── Bracket style ──────────────────────────────────────────────────────────
  bracketSpacing: true, // { foo } over {foo}
  bracketSameLine: false, // > on its own line for multi-line JSX/HTML

  // ── Vue-specific ───────────────────────────────────────────────────────────
  vueIndentScriptAndStyle: false, // Don't extra-indent <script>/<style> blocks

  // ── Per-file overrides ─────────────────────────────────────────────────────
  overrides: [
    {
      // JSON / JSONC (tsconfig, package.json, etc.)
      files: ['*.json', '*.jsonc', '*.json5'],
      options: {
        trailingComma: 'none', // JSON spec forbids trailing commas
      },
    },
    {
      // Markdown — prose wrap keeps diffs clean
      files: ['*.md', '*.mdx'],
      options: {
        proseWrap: 'always',
        printWidth: 80,
      },
    },
    {
      // YAML — no trailing commas, preserve quotes
      files: ['*.yaml', '*.yml'],
      options: {
        singleQuote: false,
        trailingComma: 'none',
      },
    },
  ],
}
