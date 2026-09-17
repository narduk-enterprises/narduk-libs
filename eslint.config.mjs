// @ts-check
import path from 'node:path'

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
      // narduk-mapkit publishes examples/ in its tarball as documentation
      // snippets. They are deliberately outside the package's tsconfig.json
      // `include` (src + tests only) so that half-written illustration code
      // and its third-party imports never reach the build's own typecheck.
      // Typed linting needs every linted file inside SOME typescript-eslint
      // project, so without this they are 12 parsing errors. Same shape and
      // same reasoning as the narduk-charts e2e/ entry above.
      'packages/modules/narduk-mapkit/examples/**',
      // Flat-config `ignores` resolve from THIS file's directory, so the
      // '.nuxt/**' entry above only covers a repo-root .nuxt. narduk-mapkit-nuxt
      // is the first package here linted through the ROOT config that generates
      // its own .nuxt tree (narduk-core and friends carry package-local eslint
      // configs), so its generated output needs naming explicitly.
      'packages/modules/narduk-mapkit-nuxt/.nuxt/**',
      'packages/modules/narduk-mapkit-nuxt/playground/.nuxt/**',
      'packages/modules/narduk-mapkit-nuxt/dist/**',
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
    // Scoped to the Vite/Vitest config files that import `vite` (or a
    // plugin that does). narduk-shell joins the list because item 9's
    // SFC mount tests need `@vitejs/plugin-vue`.
    files: [
      'packages/design/narduk-charts/histoire.config.ts',
      'packages/design/narduk-charts/vite.config.ts',
      'packages/design/narduk-charts/vite.entries.config.ts',
      'packages/design/narduk-charts/vite.e2e.config.ts',
      'packages/design/narduk-charts/vitest.config.ts',
      'packages/design/narduk-shell/vitest.config.ts',
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
  {
    // narduk-mapkit's tests hand-build doubles for Apple's global `mapkit`
    // browser namespace, which ships no types this workspace can install.
    // Typing those doubles precisely is noisy casting with no added
    // correctness -- the same judgement the shared config already makes for
    // its own rule-authoring sources (`narduk/rule-authoring` in
    // packages/tooling/eslint-config/eslint-app-config.mjs). Scoped to test
    // files; the published sources keep the rule.
    files: [
      'packages/modules/narduk-mapkit/tests/**/*.ts',
      'packages/modules/narduk-mapkit-nuxt/test/**/*.ts',
    ],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
  {
    // Same eslint-plugin-import-x@4.17.1 legacy-resolver crash documented for
    // narduk-charts's vite config files above ("node with invalid interface
    // loaded as resolver"), reached from a different direction: these files
    // import `@nuxt/test-utils/e2e`, `vitest/config` and `@vitejs/plugin-vue`,
    // whose module graphs all bottom out in bare `vite`. The crash aborts the
    // WHOLE lint run rather than reporting a finding, so `import-x/no-cycle`
    // has to be off wherever the graph can reach vite. These are test and
    // build-tool entry points, not part of the published module's own graph,
    // so cycle detection through them has no product value.
    files: [
      'packages/modules/narduk-mapkit-nuxt/test/**/*.ts',
      'packages/modules/narduk-mapkit-nuxt/vitest.config.ts',
    ],
    rules: {
      'import-x/no-cycle': 'off',
    },
  },
  {
    // Third instance of the same eslint-plugin-import-x@4.17.1 legacy-resolver
    // crash documented twice above. narduk-shell's first component
    // (narduk-libs#254) makes its vitest config import `@vitejs/plugin-vue` and
    // its suites import `@vue/test-utils` / `@vue/server-renderer`, whose module
    // graphs bottom out in bare `vite`; tracing a cycle through them aborts the
    // WHOLE lint run instead of reporting a finding. Test and build-tool entry
    // points, not part of the published module's own graph. The globs cover the
    // whole test directory on purpose, so each later component item in this
    // package inherits the exception instead of re-adding it.
    files: [
      'packages/design/narduk-shell/test/**/*.ts',
      'packages/design/narduk-shell/vitest.config.ts',
    ],
    rules: {
      'import-x/no-cycle': 'off',
    },
  },
  {
    // narduk-shell's whole purpose is to WRAP Nuxt UI: every `Ne*` component
    // composes `U*` primitives that `@nuxt/ui` registers globally in the
    // consuming app. They cannot be imported here — their sources resolve
    // `#build/ui/*` and `#imports`, virtual modules that exist only inside a
    // Nuxt build — so eslint-plugin-vue's static analysis reports each one as
    // undefined. Same false-positive family as the Histoire `<Story>` and
    // mapkit playground blocks above, narrowed to a prefix allowlist rather
    // than switched off: a genuinely misspelt or unregistered component is
    // still reported. `Ne*` is allowed for the same reason — this module
    // registers those itself, one explicit addComponent per registry entry.
    // The Nuxt built-ins the shared config's own allowlist covers are named
    // here too, because supplying `ignorePatterns` replaces that list.
    files: ['packages/design/narduk-shell/src/runtime/components/**/*.vue'],
    rules: {
      'vue/no-undef-components': [
        'warn',
        { ignorePatterns: ['^U[A-Z]', '^Ne[A-Z]', '^Nuxt[A-Z]', '^Lazy[A-Z]', '^ClientOnly$'] },
      ],
    },
  },
  {
    // narduk-mapkit's DOM-facing controllers type their element/document
    // parameters as deliberately bivariant structural shims -- the interfaces
    // say so in their own doc comments ("so that passing a real HTMLElement
    // still typechecks"). `any` there is the mechanism, not an oversight, and
    // the same judgement the shared config already makes for its own rule
    // sources (`narduk/rule-authoring`). Scoped to the three shim files;
    // every other published source keeps the rule (narduk-libs#138).
    files: [
      'packages/modules/narduk-mapkit/src/client/callouts.ts',
      'packages/modules/narduk-mapkit/src/client/fullscreen.ts',
      'packages/modules/narduk-mapkit/src/client/probe.ts',
    ],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
  {
    // Pre-existing narduk-mapkit-nuxt debt, unchanged by the move -- the same
    // shape as the narduk-charts `.vue` block above.
    //
    // `import-x/first`: AppMapKit.vue is a DUAL-SCRIPT SFC. Its plain
    // `<script lang="ts">` block declares the ambient `mapkit` global that
    // Apple's CDN injects, and eslint-plugin-vue lints the two blocks as one
    // module -- so every import in the following `<script setup>` looks like
    // an "import in body of module". The autofix relocates that `declare`
    // ACROSS script blocks, which is a real structural rewrite of a published
    // component, so the rule is off here rather than applied.
    //
    // `perfectionist/sort-*`: the repo already disables these for every
    // package's `.ts`/`.mjs` files; this extends the same policy to this
    // package's `.vue` files, which that override's glob does not reach.
    files: ['packages/modules/narduk-mapkit-nuxt/**/*.vue'],
    rules: {
      'import-x/first': 'off',
      'perfectionist/sort-interfaces': 'off',
      'perfectionist/sort-object-types': 'off',
    },
  },
  {
    // The playground is the module's own dev fixture: Nuxt auto-registers
    // `<AppMapKit>`/`<AppMapKitCallout>` from the module under test, which
    // eslint-plugin-vue's static analysis cannot see. Same false-positive
    // family as the Histoire `<Story>`/`<Variant>` block above.
    files: ['packages/modules/narduk-mapkit-nuxt/playground/**/*.vue'],
    rules: {
      'vue/no-undef-components': 'off',
    },
  },
  {
    // AppMapKitCallout.vue's whole job is to teleport slot content to a host
    // element, so `<Teleport v-for>` IS its root. Silencing it needs
    // `defineOptions({ inheritAttrs: false })` or a wrapper element -- both
    // change the component's rendered attribute surface, so the fold defers it
    // (narduk-libs#138). A template-level `<!-- eslint-disable-next-line -->`
    // is not honoured for this rule, hence the file-scoped entry here.
    files: ['packages/modules/narduk-mapkit-nuxt/src/runtime/components/AppMapKitCallout.vue'],
    rules: {
      'narduk/no-attrs-on-fragment': 'off',
    },
  },
  {
    // narduk-testkit's `server/handlers` (the Cloudflare D1/KV/R2 + fake-H3
    // handler test harness) is deliberately excluded from the package's main
    // tsconfig.json: it needs `@cloudflare/workers-types`' ambient globals,
    // which redeclare `Response`/`Headers`/`ReadableStream` incompatibly with
    // the DOM lib the package's Playwright-side helpers need, so it builds
    // and typechecks as its own project (tsconfig.handlers.json). The
    // `narduk/correctness-type-aware` project service (see
    // configs/correctness.mjs) only auto-discovers the nearest literal
    // `tsconfig.json` per file, so without this override these files are in
    // no discovered project at all -- "was not found by the project service".
    //
    // A `projectService.defaultProject` override (matching
    // `patchCorrectnessProjectServiceConfig`'s Nuxt shape in
    // eslint-app-config.mjs) does NOT work here: typescript-eslint's project
    // service is a single process-wide singleton
    // (`TSSERVER_PROJECT_SERVICE` in createParseSettings.js), created once
    // from whichever file ESLint parses first and never reconfigured after.
    // Linting this package's other files (under the shared `projectService:
    // true` from correctness.mjs) always parses one of them first, so the
    // singleton locks in *their* settings -- this override's
    // `allowDefaultProject`/`defaultProject` are silently ignored for the
    // rest of the run. (Linting a `server/handlers` file in isolation "works"
    // only because no other file gets there first to create the singleton
    // with different settings.) Traditional `parserOptions.project` mode has
    // no such singleton -- each listed tsconfig gets its own cached
    // `ts.Program`, so it coexists with the rest of the package's
    // `projectService: true` files in the same run.
    //
    // Note on coverage: `narduk/correctness-type-aware` enables no rules of
    // its own (it is parser wiring so an app can switch type-aware rules on
    // locally), so today the real project buys no extra lint coverage over
    // plain `projectService: false` -- it is here so these files are covered
    // the day a type-aware rule is switched on, and it costs no measurable
    // lint time.
    files: [
      'packages/tooling/narduk-testkit/src/server/handlers/**/*.ts',
      'packages/tooling/narduk-testkit/tests/server/handlers/**/*.ts',
    ],
    languageOptions: {
      parserOptions: {
        // `import.meta.dirname`, not `new URL(...).pathname`: a URL pathname
        // is percent-encoded, so a checkout under a path containing a space
        // (or any non-ASCII character) would hand TypeScript a `%20` it
        // cannot resolve.
        tsconfigRootDir: path.join(import.meta.dirname, 'packages/tooling/narduk-testkit'),
        project: ['./tsconfig.handlers.json'],
        // Cancels the `projectService: true` these files would otherwise
        // inherit from `narduk/correctness-type-aware` -- a file can't use
        // both `project` and `projectService`.
        projectService: false,
      },
    },
  },
]
