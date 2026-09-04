// @ts-check
import { composeSharedConfigs } from '@narduk-enterprises/eslint-config/config'

export default [
  ...composeSharedConfigs('core', 'correctness', 'complexity', 'formatting'),
  {
    ignores: [
      '.nuxt/**',
      '.output/**',
      'artifacts/**',
      'node_modules/**',
      'output/**',
      'packages/*/*/dist/**',
      'playwright-report/**',
      'vendor/**',
      // narduk-charts's Playwright e2e harness and Histoire setup file sit
      // outside its tsconfig.json `include` (deliberately -- they aren't
      // part of the published library and `histoire.config.ts` is already
      // excluded there). Typed linting needs every linted file inside SOME
      // typescript-eslint project; adding them to the real tsconfig would
      // risk pulling Playwright/Histoire-only types into the build's own
      // typecheck. Ignoring them here is lint-only and does not touch the
      // build.
      'packages/design/narduk-charts/e2e/**',
      'packages/design/narduk-charts/histoire.setup.ts',
    ],
  },
  {
    files: ['packages/**/*.{ts,mjs}', 'tools/**/*.{ts,mjs}'],
    rules: {
      'import-x/extensions': 'off',
      'import-x/named': 'off',
      'no-console': 'off',
      '@typescript-eslint/consistent-type-definitions': 'off',
      'sonarjs/cognitive-complexity': 'off',
      'sonarjs/no-duplicate-string': 'off',
      'perfectionist/sort-imports': 'off',
      'perfectionist/sort-interfaces': 'off',
      'perfectionist/sort-named-imports': 'off',
      'perfectionist/sort-object-types': 'off',
      'unicorn/prefer-at': 'off',
    },
  },
  {
    // narduk-charts is the first plain-Vite (non-Nuxt) package in this
    // workspace, and its root-level Vite/Vitest/Histoire config files are
    // the first source files anywhere here to import the bare `vite`
    // package directly. Under vite@7.3.6 (this workspace's forced
    // pnpm.overrides pin -- charts itself still declares ^6.0.0, unaffected
    // in practice: typecheck/build/test:unit all pass unchanged), tracing
    // `import-x/no-cycle` through vite's own module graph from these entry
    // files hits an eslint-plugin-import-x@4.17.1 legacy-resolver fallback
    // bug ("node with invalid interface loaded as resolver") and crashes
    // the whole lint run rather than reporting a normal lint error. These
    // are build-tool entry points, not part of the library's own module
    // graph, so cycle detection through them has no product value anyway.
    // Scoped to this package's config files only -- no other current
    // package imports `vite` directly.
    files: [
      'packages/design/narduk-charts/histoire.config.ts',
      'packages/design/narduk-charts/vite.config.ts',
      'packages/design/narduk-charts/vite.entries.config.ts',
      'packages/design/narduk-charts/vite.e2e.config.ts',
      'packages/design/narduk-charts/vitest.config.ts',
    ],
    rules: {
      'import-x/no-cycle': 'off',
      // vite-plugin-dts genuinely has a default export (the build's dts
      // generation step runs fine); import-x's ESM/CJS interop detection
      // mis-reads it as missing one. Same false-positive family as the
      // no-cycle exception above, same file.
      'import-x/default': 'off',
    },
  },
  {
    // Pre-existing narduk-charts debt, unchanged by the move: these three
    // rules are refactor SUGGESTIONS (cognitive complexity, duplicate
    // literals, complex template expressions), not defects, and the repo
    // already disables the first two for every other package's .ts/.mjs
    // files above -- this extends the same policy to narduk-charts's .vue
    // components, which the broader override's `.{ts,mjs}` glob does not
    // reach. Tracked for an eventual cleanup pass, not fixed by the fold
    // (narduk-libs#131); "fix nothing in charts' behaviour" for the move PR.
    files: ['packages/design/narduk-charts/**/*.{ts,vue}'],
    rules: {
      'sonarjs/cognitive-complexity': 'off',
      'sonarjs/no-duplicate-string': 'off',
      'narduk/no-template-complex-expressions': 'off',
      // charts' published dist targets ES2020 (tsconfig `target`/`lib`);
      // `String#replaceAll` needs ES2021+ and vue-tsc fails the build if the
      // autofix for this rule is applied. Off for the whole package rather
      // than 8 individual inline suppressions.
      'unicorn/prefer-string-replace-all': 'off',
    },
  },
  {
    // Histoire's `<Story>`/`<Variant>` wrapper components are registered as
    // ambient globals by the Histoire Vite plugin at story-run time, not
    // imported -- eslint-plugin-vue's static analysis has no visibility into
    // that registration and reports every one as undefined.
    files: ['packages/design/narduk-charts/src/stories/**/*.story.vue'],
    rules: {
      'vue/no-undef-components': 'off',
    },
  },
]
