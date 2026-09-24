# @narduk-enterprises/eslint-config

The estate's ESLint plugin and shared flat-config packs for Nuxt 4, Vue 3,
Tailwind v4, Nuxt UI v4, Nitro, and Cloudflare Workers.

Requires **ESLint 10**, `vue-eslint-parser` 10, and Node >= 24.

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

Options: `capabilityPacks`, `communityLayer` (default `true`),
`contentRelaxedFiles`, `additionalNuxtUiComponents`, `utilityComposableFiles`,
`trustedHtmlFiles`, `appType` (`'admin' | 'content'`), `extraOverrides`,
`appRootDir`, `tailwindEntryPoint`.

Composing by hand, without the Nuxt wrapper:

```js
import { composeSharedConfigs } from '@narduk-enterprises/eslint-config/config'

export default composeSharedConfigs('core', 'server')
```

A single pack can also be imported directly, e.g.
`@narduk-enterprises/eslint-config/config/core`. A directly imported pack is
just that pack — it carries no parser layer, no community layer, and no Prettier
disable. Use `composeSharedConfigs()` unless you are assembling those yourself.

Existing callers keep the community tail (`import-x`, `unicorn`, `promise`,
`security`, `regexp` recommended, `eslint-comments`, `vitest`, Vue house style).
That layer is a reasonable default for a new app. For an existing app that is
not ready for it, pass `communityLayer: false` so a pack can land without that
finding wave (narduk-libs#167):

```js
export default createAppLintConfig({
  withNuxt,
  capabilityPacks: ['a11y'],
  communityLayer: false,
})

// or, without the Nuxt wrapper:
export default composeSharedConfigs({ packs: ['a11y'], communityLayer: false })
```

Parser layer, `eslint-config-prettier`, and the baseline tail still apply:
`narduk/ignores` (`.nuxt/**`, `.output/**`, `dist/**`, …), the
`@typescript-eslint` project rules, console hygiene, rule-authoring relaxations,
and the composable-helpers bypass. Turning the plugin tail back on later is when
those `error`-severity community rules (`import-x/no-cycle`, `import-x/named`,
`unicorn/no-instanceof-builtins`, `unicorn/throw-new-error`,
`promise/no-return-wrap`, `regexp` recommended,
`@eslint-community/eslint-comments/no-unused-disable`) will surface pre-existing
findings; budget triage then, not on the first pack.

## Capability packs

| Pack            | What it covers                                                                                                              |
| --------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `core`          | Hydration safety, Nuxt data-fetching discipline, Vue 3 composition correctness, Pinia hygiene, client `app/**` perf         |
| `design-system` | Nuxt UI element discipline (`vue/no-restricted-html-elements`), shared-component use (below) and the Tailwind v4 token tier |
| `nuxt-ui`       | Nuxt UI v4 legacy overlay/options API migration                                                                             |
| `seo`           | Registered, contributes no rules in v2                                                                                      |
| `cloudflare`    | Worker runtime guardrails and the Node-built-in import ban                                                                  |
| `server`        | Nitro handler data discipline, Cloudflare guardrails, server import hygiene, type-aware promise errors                      |
| `auth`          | CSRF and rate-limit gates on mutation routes                                                                                |
| `template`      | Starter/layer structure, file-size budgets, layer-source import ban                                                         |
| `correctness`   | TypeScript hygiene and type-aware checks (warn-only) plus type-aware parser wiring                                          |
| `a11y`          | `eslint-plugin-vuejs-accessibility`, warn-only                                                                              |
| `complexity`    | High-signal `sonarjs` rules, warn-only                                                                                      |
| `formatting`    | `eslint-plugin-perfectionist` import/type ordering                                                                          |
| `e2e`           | `eslint-plugin-playwright`, scoped to Playwright specs                                                                      |
| `monorepo`      | Registered, contributes no rules                                                                                            |

Both v1 spellings resolve, so `'designSystem'` and `'nuxtUi'` keep working
alongside `'design-system'` and `'nuxt-ui'`.

### Declared CSRF exemptions (`auth`)

`narduk/no-csrf-exempt-route-misuse` and
`narduk/require-csrf-header-on-mutations` know the built-in exempt prefixes
(`webhooks/`, `cron/`, `callbacks/`). A route an app exempts through
`nardukCore.csrf.exemptPaths` is exempt to the CSRF middleware as well, so pass
the same list to both rules as `exemptPaths`, from one constant that
`nuxt.config` also reads (narduk-libs#510):

```js
// csrf-exempt-paths.mjs, imported by nuxt.config.ts and eslint.config.mjs
export const csrfExemptPaths = ['/api/devices/ingest', '/api/sensors/*']

// eslint.config.mjs
const csrf = { exemptPaths: csrfExemptPaths }
export default [
  ...config,
  {
    rules: {
      'narduk/no-csrf-exempt-route-misuse': ['warn', csrf],
      'narduk/require-csrf-header-on-mutations': ['error', csrf],
    },
  },
]
```

A declared route then has to verify a credential header, like a webhook does,
instead of the browser CSRF header. Matching is narduk-core's: an exact path
with one trailing slash tolerated, or a `/*` prefix, which is the only form that
covers a dynamic `[id]` segment.

### Shared components (`design-system`, warn)

These two rules are the lint half of the component suite's "use the shared one"
rule (narduk-libs#260, `docs/plans/components-library-plan.md` §2 item 13).
narduk-app-tools' `foundation:check:no-local-copy` and
`foundation:check:list-routes` are the repository half.

- `narduk/no-shadowed-shared-component` warns on a `.vue` file under
  `components/` whose name matches a component that narduk-shell, narduk-core,
  narduk-auth, narduk-ui or narduk-charts publishes. It checks both the file
  name and the name Nuxt registers from the path, so `shared/AppTabs.vue` and
  `ne/StatePanel.vue` are both reported. The names are a static list in
  `src/rules/utils/shared-components.ts`. A drift test reads each owner's real
  component files, so the list cannot go stale unnoticed. The owners' own source
  directories are skipped.
- `narduk/prefer-shared-collection` warns on a bare `<UTable>` anywhere except
  narduk-shell's `NeDataTable.vue`. A native `<table>` is still an error from
  `vue/no-restricted-html-elements`, whose message now points at
  `<NeDataTable>`. It is an app-tier rule. A narduk-libs Nuxt module sits below
  narduk-shell and does not depend on it, so a module that renders tables turns
  the rule off in its own `eslint.config.mjs`, as narduk-analytics does
  (narduk-libs#744).

### Prettier vs Perfectionist

`eslint-config-prettier` is applied last and disables the rules that fight
Prettier's formatting. It deliberately does **not** disable the `formatting`
pack: perfectionist owns _ordering_, Prettier owns _whitespace_. Run
`eslint --fix` first, then Prettier.

## Warning budgets: `narduk-lint`

`narduk-lint` runs ESLint and holds warnings to a checked-in `lint-budget.json`
instead of `--max-warnings 0`. Use it as the lint script:

```json
{ "scripts": { "lint": "narduk-lint" } }
```

```json
{
  "strict": true,
  "rules": {
    "narduk/require-fetch-timeout": 3
  }
}
```

- **Errors always fail.**
- **A rule over its budget fails.** The output names the rule, its count, its
  budget, and the top five `file:line` locations.
- **In a strict budget, a rule with no entry fails.** With `"strict": true`, a
  warning in any rule the file does not list is a failure, locally and in CI,
  with the rule and its locations printed. Fix the warnings, or adopt the
  current count on purpose with `narduk-lint --accept-new-rules`, which records
  it and leaves the change for review to see. That flag is refused in CI and
  with `--no-write`. Every package in this repository is strict, and
  `scripts/lint-budget-strict.test.mjs` keeps it that way.
- **A budget without `strict` records instead of gating.** An unbudgeted rule
  passes: a local run records its count as the rule's budget, and CI prints a
  notice. Every run says the file is not strict. With no `lint-budget.json` at
  all, warnings are not gated at all and the run says that too.
- **Local runs ratchet down, never up.** Outside CI, `narduk-lint` lowers an
  entry to the current count, deletes an entry that reaches zero, and rewrites
  the file (keys sorted, trailing newline, `strict` kept). A recorded budget is
  never raised automatically: to accept more warnings, edit the file by hand and
  let review see it.
- **CI never writes.** With `--ci` or `CI=true`, a count below its budget (or,
  in a non-strict file, an unbudgeted rule) prints a notice asking for a local
  `pnpm lint` and a commit.

The budget file is read from the directory `narduk-lint` runs in (the package
root under `pnpm run lint`), not from next to the ESLint config, so packages
that share one config still keep separate budgets. Run it over the same paths
the lint script uses: counting a subset would lower the budget for the rest.
`--no-write` counts without rewriting.

Paths are positional (default `.`). `--fix`, `--cache`, `--cache-location` and
`--ignore-pattern` pass through to ESLint. `--max-warnings` is refused.
`--budget <path>` points at another file, `--verbose` prints every warning.

Exit codes: `0` pass; `1` a lint error, a rule over budget, or an unbudgeted
rule in a strict budget; `2` a usage or configuration error, or ESLint itself
crashed.

If Turbo caches the lint task, declare `lint-budget.json` as an output so a
cache hit restores it.

## Rules added in the budget release

| Rule                                                   | Severity | Pack        | Scope                                        |
| ------------------------------------------------------ | -------- | ----------- | -------------------------------------------- |
| `@typescript-eslint/no-floating-promises`              | error    | server      | `server/**` TS, type-aware                   |
| `@typescript-eslint/no-misused-promises`               | error    | server      | `server/**` TS, type-aware                   |
| `narduk/no-render-clock`                               | error    | core        | `.vue`                                       |
| `narduk/no-secret-in-public-runtime-config`            | error    | core        | `nuxt.config.*`                              |
| `narduk/require-limit-on-drizzle-list-queries` (wider) | error    | server      | now also `.where(eq(<non-key column>))`      |
| `@typescript-eslint/no-floating-promises`              | warn     | correctness | outside `server/**`, type-aware              |
| `@typescript-eslint/no-misused-promises`               | warn     | correctness | outside `server/**`, type-aware              |
| `@typescript-eslint/await-thenable`                    | warn     | correctness | type-aware                                   |
| `@typescript-eslint/switch-exhaustiveness-check`       | warn     | correctness | type-aware                                   |
| `narduk/require-fetch-timeout`                         | warn     | server      | `fetch`/`$fetch`/`ofetch` in server code     |
| `narduk/prefer-db-batch`                               | warn     | server      | consecutive awaited drizzle writes           |
| `sonarjs/sql-queries`                                  | warn     | server      | server code, not tests                       |
| `no-console`                                           | warn     | shared tail | `server/**`                                  |
| unused `eslint-disable` directives                     | warn     | shared tail | everywhere (`reportUnusedDisableDirectives`) |

- **`narduk/no-render-clock`** reports `Date.now()`, `new Date()` and
  `performance.now()` read while a component renders: in a template expression
  (not `v-on`, not inside `<ClientOnly>`), a `computed` getter, or top-level
  `<script setup>`. Server and client read different times and the page hydrates
  with mismatches (buoys PR #202). Read the clock once and hydrate it
  (`useSsrNow(key)` from narduk-core, or `useState(key, () => Date.now())`), or
  read it after mount: lifecycle hooks, handlers, `import.meta.client` guards,
  or a mounted flag (`useMounted()`, or a ref set to `true` in `onMounted`).
- **`narduk/no-secret-in-public-runtime-config`** reports a credential-named key
  (`secret`, `token`, `password`, `private`, `apiKey`) anywhere under
  `runtimeConfig.public`, which ships to every browser, and a credential-named
  key anywhere in `runtimeConfig` with a string literal default. Credentials
  come from the environment (`NUXT_*`). See DESIGN.md, "Secrets rule choice".
- **`narduk/require-limit-on-drizzle-list-queries`** now also reports
  `.where(eq(column, value))` on a column that is not the primary key when
  nothing bounds it. Add `.limit(n)`, or mark a set that is bounded by
  construction with a comment on the statement: `// narduk-bounded: <reason>`
  (the reason is required).
- **`narduk/require-fetch-timeout`** reports an outbound `fetch`, `$fetch` or
  `ofetch` call in server code with no `signal` or `timeout`. Internal `'/…'`
  paths through `$fetch`/`ofetch`, and option objects it cannot see into
  (variables, spreads), are not reported.
- **`narduk/prefer-db-batch`** reports two or more consecutive awaited
  `db.insert|update|delete` statements that do not depend on each other, and
  `Promise.all(items.map(… db.insert …))`. Use `db.batch([...])`, one round trip
  and one transaction on D1. Option: `receivers` (default `['db']`).

## Upgrading to the budget release

**This release turns consumer lint red on purpose.** The error-severity rules
above (`no-floating-promises` and `no-misused-promises` in `server/**`,
`narduk/no-render-clock`, `narduk/no-secret-in-public-runtime-config`, and the
wider `require-limit-on-drizzle-list-queries`) report real defects, and an app
that has them fails lint after the bump. That is the design: warnings are
budgeted, and the super offenders go red and get fixed.

1. Switch the lint script from `eslint . --max-warnings 0` to `narduk-lint`
   (keep any `nuxt prepare &&` prefix).
2. Run `pnpm lint` locally once. It writes `lint-budget.json` with the current
   warning counts; commit it.
3. Fix the errors it prints. For a list query that is bounded by construction,
   add `// narduk-bounded: <reason>` instead of a `.limit()`.

`createAppLintConfig()` also now uses the `@typescript-eslint` plugin that ships
with this package's parser in place of the copy `withNuxt()` registers, so
type-aware rules and the program they read come from one TypeScript.

## Published contents

`bin/narduk-lint.mjs` and `lint-budget.mjs` (the budget runner, also exported as
`@narduk-enterprises/eslint-config/lint-budget`), `dist/` (the bundled plugin
and its types), `configs/` (the fourteen packs), `eslint-app-config.mjs`,
`eslint-nuxt-flat-fragments.mjs`, and this README. There is no postinstall hook.

## Migrating from v1

New major. A consumer `eslint.config.mjs` that calls `createAppLintConfig` with
capability packs should need only a version bump, an ESLint 10 upgrade, and a
sweep of stale `eslint-disable` comments.

v1's `recommended` / `app` presets did not compose this community plugin layer.
Adopting v2 one pack at a time on an existing app is therefore
`communityLayer: false` (above) or a direct
`@narduk-enterprises/eslint-config/config/<pack>` import — not "name one pack
and inherit the plugin wave." Baseline ignores and housekeeping still apply. The
default stays on for callers that omit the flag.

### 1. Move the app to ESLint 10

The peer range is `eslint@^10.0.0` (with `vue-eslint-parser@^10` and Node >=
24). There is no ESLint 9 fallback: v2 is composed on the current `@nuxt/eslint`
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
`createAppLintConfig` enables them only when the app **declares** Tailwind by
passing `tailwindEntryPoint` and that file exists (narduk-libs#665). A
conventional `app/assets/css/main.css`, or `tailwindcss` happening to resolve
from a stale or transitive install, is not a declaration:

```js
createAppLintConfig({
  withNuxt,
  capabilityPacks: ['design-system'],
  // Required to opt in. Omit it on a non-Tailwind app.
  tailwindEntryPoint: 'app/assets/css/main.css',
})
```

**`tailwindEntryPoint` requires the `design-system` pack.** That pack is the
only one that registers the `better-tailwindcss` plugin, and ESLint does not
tolerate an enabled rule whose plugin is absent — it throws
`Could not find plugin "better-tailwindcss" in configuration` while normalising
the config and lints nothing at all. So the theme override attaches only when
the pack is selected (`'designSystem'` counts) _and_ `tailwindEntryPoint` is set
_and_ that file exists. An app that selects `design-system` but never passes
`tailwindEntryPoint` gets no override, even when the conventional stylesheet is
on disk. Passing `tailwindEntryPoint` without the pack throws a named
configuration error at compose time rather than at plugin resolution.
`capabilityPacks` left empty selects the default preset order, which does
include `design-system`; that still does not infer Tailwind.

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

**Classes the app defines itself are not unknown.** The plugin resolves classes
against the compiled theme and `@layer components`. It cannot see a class
defined as a bare selector in the app's CSS, as `narduk-ui/tokens.css` defines
`.ns-title-m`, or in a Vue SFC `<style>` block. The first consumer to enable the
rule got 103 errors, and 101 were those two cases (#55). So
`createAppLintConfig` collects them when it composes the config:

- class selectors in the entry stylesheet and every `.css` file it `@import`s,
  following relative paths and package paths that resolve to a `.css` file;
- class selectors in the `<style>` blocks of every `.vue` file under
  `appRootDir`, skipping dot-directories, `node_modules`, `dist` and `coverage`.

They reach `no-unknown-classes` as one exact-match `ignore` pattern. Anything
else is still reported, including a variant on an app class (`hover:ns-label`),
because Tailwind generates no variant for a class it did not define. The SFC set
is app-wide: a class in one component's scoped style is accepted in every
component. Classes built by a preprocessor (SCSS `&__element`) are not
collected. An app that sets its own `no-unknown-classes` options in an override
replaces the collected `ignore`, because flat config does not merge rule
options. There is no per-app workaround to copy: do not turn the rule off.

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
