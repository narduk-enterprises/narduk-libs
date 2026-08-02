# @narduk-enterprises/eslint-config

The estate's ESLint plugin and shared flat-config packs for Nuxt 4, Vue 3,
Tailwind v4, Nuxt UI v4, Nitro, and Cloudflare Workers.

Requires **ESLint 10**, `vue-eslint-parser` 10, and Node >= 22.

## Use it

```js
// app/eslint.config.mjs
import withNuxt from './.nuxt/eslint.config.mjs'
import { createAppLintConfig } from '@narduk-enterprises/eslint-config/eslint-app-config'

export default createAppLintConfig({
  withNuxt,
  capabilityPacks: ['core', 'design-system', 'nuxt-ui', 'server', 'auth'],
})
```

`createAppLintConfig` composes the parser layer, the packs you name, the shared
community layer, and `eslint-config-prettier` (always last), then hands the
result to the app's generated `withNuxt()` wrapper. It also reads the app's
`.nuxt/components.d.ts` and turns it into an exact `vue/no-undef-components`
allowlist, and points the type-aware parser service at the app's generated
tsconfig.

Options: `capabilityPacks`, `contentRelaxedFiles`, `additionalNuxtUiComponents`,
`utilityComposableFiles`, `trustedHtmlFiles`, `appType` (`'admin' | 'content'`),
`extraOverrides`, `appRootDir`, `tailwindEntryPoint`.

Composing by hand, without the Nuxt wrapper:

```js
import { composeSharedConfigs } from '@narduk-enterprises/eslint-config/config'

export default composeSharedConfigs('core', 'server')
```

A single pack can also be imported directly, e.g.
`@narduk-enterprises/eslint-config/config/core`. A directly imported pack is
just that pack — it carries no parser layer, no community layer, and no Prettier
disable. Use `composeSharedConfigs()` unless you are assembling those yourself.

## Capability packs

| Pack            | What it covers                                                                                                                     |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `core`          | Hydration safety, Nuxt data-fetching discipline, Vue 3 composition correctness, Pinia hygiene, client `app/**` perf                |
| `design-system` | Nuxt UI element discipline (`vue/no-restricted-html-elements`) and the Tailwind v4 token tier (`eslint-plugin-better-tailwindcss`) |
| `nuxt-ui`       | Nuxt UI v4 legacy overlay/options API migration                                                                                    |
| `seo`           | Registered, contributes no rules in v2                                                                                             |
| `cloudflare`    | Worker runtime guardrails and the Node-built-in import ban                                                                         |
| `server`        | Nitro handler data discipline, Cloudflare guardrails, server import hygiene                                                        |
| `auth`          | CSRF and rate-limit gates on mutation routes                                                                                       |
| `template`      | Starter/layer structure, file-size budgets, layer-source import ban                                                                |
| `correctness`   | TypeScript hygiene (warn-only) plus type-aware parser wiring                                                                       |
| `a11y`          | `eslint-plugin-vuejs-accessibility`, warn-only                                                                                     |
| `complexity`    | High-signal `sonarjs` rules, warn-only                                                                                             |
| `formatting`    | `eslint-plugin-perfectionist` import/type ordering                                                                                 |
| `e2e`           | `eslint-plugin-playwright`, scoped to Playwright specs                                                                             |
| `monorepo`      | Registered, contributes no rules                                                                                                   |

Both v1 spellings resolve, so `'designSystem'` and `'nuxtUi'` keep working
alongside `'design-system'` and `'nuxt-ui'`.

### Prettier vs Perfectionist

`eslint-config-prettier` is applied last and disables the rules that fight
Prettier's formatting. It deliberately does **not** disable the `formatting`
pack: perfectionist owns _ordering_, Prettier owns _whitespace_. Run
`eslint --fix` first, then Prettier.

## Published contents

`dist/` (the bundled plugin and its types), `configs/` (the fourteen packs),
`eslint-app-config.mjs`, `eslint-nuxt-flat-fragments.mjs`, and this README.
There is no postinstall hook.

## Migrating from v1

New major. A consumer `eslint.config.mjs` that calls `createAppLintConfig` with
capability packs should need only a version bump, an ESLint 10 upgrade, and a
sweep of stale `eslint-disable` comments.

### 1. Move the app to ESLint 10

The peer range is `eslint@^10.0.0` (with `vue-eslint-parser@^10` and Node >=
22). There is no ESLint 9 fallback: v2 is composed on the current `@nuxt/eslint`
foundation and the flat-config-only plugin APIs it depends on.

### 2. Fix stale `eslint-disable` comments — these are the loudest breakage

A disable comment naming a rule that no longer exists is not ignored: ESLint
reports **`Definition for rule 'narduk/<name>' was not found`** as an error on
that line, for every file that carries one. (A rule set to `'off'` in a _config_
file stays quiet, so config overrides fail silently instead — grep for those
separately.)

Rename each comment to its replacement, keeping the original reason text, or
delete it where the rule has no successor:

| v1 rule in the disable comment                                                     | Replace with                                   |
| ---------------------------------------------------------------------------------- | ---------------------------------------------- |
| `narduk/no-await-in-loop-in-server`                                                | `no-await-in-loop`                             |
| `narduk/prefer-import-meta-client`, `…-dev`                                        | `nuxt/prefer-import-meta`                      |
| `narduk/file-size-budget`                                                          | `max-lines`                                    |
| `narduk/no-native-*`, `narduk/prefer-uform`                                        | `vue/no-restricted-html-elements`              |
| `narduk/no-unknown-nuxt-ui-component`                                              | `vue/no-undef-components`                      |
| `narduk/no-relative-server-imports`                                                | `no-restricted-imports`                        |
| `narduk/no-direct-layer-source-imports`                                            | `no-restricted-imports`                        |
| `narduk/no-raw-tailwind-colors`                                                    | `better-tailwindcss/no-restricted-classes`     |
| `narduk/no-tailwind-v3-deprecated`                                                 | `better-tailwindcss/no-deprecated-classes`     |
| `narduk/no-invalid-nuxt-ui-token`                                                  | `better-tailwindcss/no-unknown-classes`        |
| `narduk/prefer-tailwind-var-shorthand`                                             | `better-tailwindcss/enforce-canonical-classes` |
| `vitest/*` (from `eslint-plugin-vitest`)                                           | same ids, now `@vitest/eslint-plugin`          |
| `nuxt-redundant-auto-import/no-redundant-auto-import`                              | **delete** — the plugin is dropped             |
| the three SEO rules, `narduk/lucide-icons-only`, and every other DROP-verdict rule | **delete**                                     |

Then run once more: many renamed comments turn out to be unnecessary, because
several v1 rules gated on `filename.includes('/app/…/')` and never fired under
the relative filenames `eslint .` produces.
`@eslint-community/eslint-comments/no-unused-disable` flags those, so a second
pass tells you which suppressions to drop outright.

The same fix is why **rules that were silently off in v1 start reporting**: the
leading-slash path-gate bug is fixed once in a shared, tested gate.

### 3. The theme-resolving Tailwind rules are opt-in by entry point

`better-tailwindcss/no-unknown-classes`, `no-deprecated-classes` and
`enforce-canonical-classes` resolve classes against the app's _compiled_
Tailwind theme. Without a resolvable entry stylesheet they do not degrade
quietly — the plugin reports a `No tailwind css entry point found` banner per
class. So the `design-system` pack ships all three **off**, and
`createAppLintConfig` enables them only when the entry point exists on disk:

```js
createAppLintConfig({
  withNuxt,
  capabilityPacks: ['design-system'],
  // Default; set it if the app's Tailwind entry stylesheet lives elsewhere.
  tailwindEntryPoint: 'app/assets/css/main.css',
})
```

A standalone consumer composing by hand opts in explicitly:

```js
export default [
  ...composeSharedConfigs('design-system'),
  {
    files: ['**/*.vue'],
    settings: {
      'better-tailwindcss': { entryPoint: 'app/assets/css/main.css' },
    },
    rules: {
      'better-tailwindcss/no-unknown-classes': 'error',
      'better-tailwindcss/no-deprecated-classes': 'error',
      'better-tailwindcss/enforce-canonical-classes': 'warn',
    },
  },
]
```

`better-tailwindcss/no-restricted-classes` (the raw-palette ban) needs no theme
and is on regardless.

### 4. Legacy presets are gone; pack names are not

All v1 presets — `recommended`, `nuxt`, `vue`, `vue-strict`, `app`, `all`,
`styling`, `hydration`, `nuxtCore`, `vueCore`, `pinia`, `serverData`,
`serverRuntime`, `templateVue`, `templateProject`, `templateServer`,
`clientAppPerf` — are removed, and naming one throws with the valid list.
Capability packs are the only composition unit.

The fourteen capability pack names are unchanged, and both v1 camelCase
spellings still resolve (`'designSystem'` → `'design-system'`, `'nuxtUi'` →
`'nuxt-ui'`), so an existing `capabilityPacks` array needs no edit.

### 5. Rules that do not come back

Nine v1 rules are not in v2 and are **not** replaced by a third-party rule:

`valid-useAsyncData`, `no-await-nuxt-async-data-in-spa-surfaces`,
`no-sequential-awaited-data-fetching`, `require-use-seo-on-pages`,
`require-schema-on-pages`, `prefer-use-seo-over-bare-meta`, `no-legacy-head`,
`no-reactive-in-services`, `no-composable-dom-access-without-client-guard`.

Nothing breaks when you upgrade — a rule that no longer exists simply stops
reporting (clear any `eslint-disable` comments naming one; see §2). But if your
app relied on one of them, that check is gone and you should know it. Each is a
rebuild candidate, with the reason it was dropped and what a rebuild would need,
in **DESIGN.md → "Nine review-KEEP rules that did not ship"**.

Two behaviours also tightened in v2 and can surface findings in code that was
previously quiet — both are in DESIGN.md's adversarial-hardening record:

- A route file named like a test (`server/api/x.post.test.ts`) is linted as the
  route Nitro deploys it as. Move route suites under `tests/` or `__tests__/`.
- `no-restricted-imports` no longer depends on the order of your
  `capabilityPacks` array, so its relative-import and layer-source patterns
  apply where a trailing `cloudflare` entry used to erase them. A **portable
  Nuxt layer** — a package, not an app, with no `#server/*` alias for its own
  sources — should assign `PORTABLE_LAYER_RESTRICTED_IMPORTS_RULE` (exported
  from `/config/server`, `/config/cloudflare` and `/config/template`) to its own
  server glob. It drops that one pattern group and keeps the rest; switching the
  rule off instead would silently unban `node:fs` and friends.

### 6. Smaller things

- Also gone: the `@narduk-enterprises/narduk-skills` postinstall coupling, the
  frozen `nuxt-ui-v4.json` spec tier and its spec-driven rules, and the
  `./eslint-nuxt-spa-data-fetch` entry point.
- `./eslint-nuxt-flat-fragments` **still resolves**, as a compat shim:
  `importXVueCoreModuleFragment` is intact (its `import-x/core-modules` setting
  is also inlined in the shared layer now), and
  `redundantNuxtAutoImportFlatConfig` is a valid but rule-less entry, because
  the plugin behind it was dropped. Existing spreads keep working untouched.
- `seoMode`, `internalOnlyPageGlobs`, and `allowedBrandIconFiles` are still
  accepted by `createAppLintConfig` but are inert: the rules they targeted were
  dropped.
- Directly importing a pack (`/config/<pack>`) now yields that pack alone. In v1
  those entry points re-ran the whole composition.
- `license` is `UNLICENSED`; v1 wrongly claimed MIT.

## Develop

```sh
pnpm run build        # tsup — required before the composition tests and typecheck
pnpm run test:unit
pnpm run quality      # build + typecheck + lint + test
```

The packs import the built `dist/index.js`, so `pnpm run build` has to run
before `pnpm run test:unit` on a fresh checkout.
