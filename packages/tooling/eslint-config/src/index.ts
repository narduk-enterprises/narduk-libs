/**
 * `@narduk-enterprises/eslint-config` — the `narduk` ESLint plugin.
 *
 * v2 ships **only** the rules the rule-by-rule deep review gave a KEEP verdict
 * (DESIGN.md "Ported" and "Rebuilt"). Everything a maintained third-party rule
 * covers is gone from this manifest and wired in `configs/*.mjs` instead; see
 * DESIGN.md "Replaced by maintained third-party".
 *
 * ## Tier layout
 *
 * Rules live in `src/rules/<tier>/<rule-name>.ts` under six tiers. A tier is a
 * *file location*, not a scope: `configs/*.mjs` decides which globs each rule
 * runs against, which is why, for instance, `no-blocking-io-in-server-plugin`
 * sits in `nuxt/` but is enabled by the `server` pack.
 *
 * | Tier         | Holds |
 * | ------------ | ----- |
 * | `general/`   | the thirteen DESIGN.md "Ported (KEEP)" rules, carried over intact |
 * | `hydration/` | the four rebuilt SSR/hydration rules |
 * | `vue/`       | rebuilt Vue/Pinia composition and store rules |
 * | `nuxt/`      | rebuilt Nuxt data-fetch and app-structure rules |
 * | `server/`    | the rebuilt Nitro mutation-route security tier |
 * | `cloudflare/`| the four Worker runtime rules |
 *
 * Shared gates live in `src/rules/utils/` (`path-scope`, `mutation-route`,
 * `cloudflare-runtime`) and are not part of this manifest. Per-tier `_internal`
 * helpers are likewise not rules.
 *
 * ## Dropped in scope
 *
 * DESIGN.md allowed the server lane to drop `prefer-drizzle-operators` and
 * `require-validated-body` if they could not be hardened in scope, and record
 * which. Neither shipped, so neither is registered here or referenced by
 * `configs/server.mjs`. `tests/composition/packs.test.ts` fails if a rule module
 * exists on disk without a manifest entry, so re-adding one cannot be forgotten.
 */

// ── general — the DESIGN.md "Ported (KEEP)" rules ───────────────────────────
import noBarrelAutoImports from './rules/general/no-barrel-auto-imports'
import noBlockingTopLevelIoInNuxtPlugin from './rules/general/no-blocking-top-level-io-in-nuxt-plugin'
import noLegacyFetchHook from './rules/general/no-legacy-fetch-hook'
import noLegacyOptionsProp from './rules/general/no-legacy-options-prop'
import noLegacyOverlayApi from './rules/general/no-legacy-overlay-api'
import noLegacyOverlayModel from './rules/general/no-legacy-overlay-model'
import noMapAsyncInServer from './rules/general/no-map-async-in-server'
import noMultiStatementInlineHandler from './rules/general/no-multi-statement-inline-handler'
import noStaticMermaidImport from './rules/general/no-static-mermaid-import'
import noTightInterval from './rules/general/no-tight-interval'
import piniaRequireDefineStoreId from './rules/general/pinia-require-defineStore-id'
import preferSafeParseInEventHandlers from './rules/general/prefer-safe-parse-in-event-handlers'
import preferShallowWatch from './rules/general/prefer-shallow-watch'

// ── hydration ───────────────────────────────────────────────────────────────
import noLocaleDateFormatInSsrText from './rules/hydration/no-locale-date-format-in-ssr-text'
import noSsrDomAccess from './rules/hydration/no-ssr-dom-access'
import requireClientOnlyHydrationSensitive from './rules/hydration/require-client-only-hydration-sensitive'
import requireClientOnlySwitch from './rules/hydration/require-client-only-switch'

// ── vue ─────────────────────────────────────────────────────────────────────
import noAttrsOnFragment from './rules/vue/no-attrs-on-fragment'
import noComposableConditionalHooks from './rules/vue/no-composable-conditional-hooks'
import noModuleScopeRef from './rules/vue/no-module-scope-ref'
import noNonSerializableStoreState from './rules/vue/no-non-serializable-store-state'
import noSetupTopLevelSideEffects from './rules/vue/no-setup-top-level-side-effects'
import noTemplateComplexExpressions from './rules/vue/no-template-complex-expressions'

// ── nuxt ────────────────────────────────────────────────────────────────────
import componentDirectoryStructure from './rules/nuxt/component-directory-structure'
import composablePrimaryExport from './rules/nuxt/composable-primary-export'
import noBlockingIoInServerPlugin from './rules/nuxt/no-blocking-io-in-server-plugin'
import noFetchCreateBypass from './rules/nuxt/no-fetch-create-bypass'
import noFetchInOnmounted from './rules/nuxt/no-fetch-in-onmounted'
import noFetchInWatch from './rules/nuxt/no-fetch-in-watch'
import noRawFetch from './rules/nuxt/no-raw-fetch'
import noRawFetchInStores from './rules/nuxt/no-raw-fetch-in-stores'
import noSequentialAwaitedIoInEventHandler from './rules/nuxt/no-sequential-awaited-io-in-event-handler'
import requireUsePrefixForComposables from './rules/nuxt/require-use-prefix-for-composables'

// ── server — the Nitro mutation-route security tier ─────────────────────────
import noCsrfExemptRouteMisuse from './rules/server/no-csrf-exempt-route-misuse'
import noRawDefineEventHandlerInMutationRoutes from './rules/server/no-raw-define-event-handler-in-mutation-routes'
import noRawSqlWithVariableInput from './rules/server/no-raw-sql-with-variable-input'
import requireCsrfHeaderOnMutations from './rules/server/require-csrf-header-on-mutations'
import requireEnforceRateLimitOnMutations from './rules/server/require-enforce-rate-limit-on-mutations'
import requireImmediateMutationBodyValidation from './rules/server/require-immediate-mutation-body-validation'
import requireLimitOnDrizzleListQueries from './rules/server/require-limit-on-drizzle-list-queries'
import requireValidatedQuery from './rules/server/require-validated-query'

// ── cloudflare ──────────────────────────────────────────────────────────────
import noProcessEnvInWorkerRuntime from './rules/cloudflare/no-process-env-in-worker-runtime'
import noSupabaseClientInGlobalScope from './rules/cloudflare/no-supabase-client-in-global-scope'
import noWorkerGlobalScopeDbClients from './rules/cloudflare/no-worker-global-scope-db-clients'
import noWorkerGlobalScopeOperations from './rules/cloudflare/no-worker-global-scope-operations'

/** Injected at build time by tsup — see tsup.config.ts. */
declare const __PKG_VERSION__: string

/**
 * The `narduk` plugin.
 *
 * Capability packs live in `configs/*.mjs` and attach this object as
 * `plugins: { narduk }`. They are intentionally **not** re-exported here: the
 * packs import the built `dist/index.js`, so exporting them back through this
 * module would create an import cycle between the bundle and the packs.
 */
const plugin = {
  meta: {
    name: '@narduk-enterprises/eslint-config',
    version: __PKG_VERSION__,
  },

  rules: {
    // general
    'no-barrel-auto-imports': noBarrelAutoImports,
    'no-blocking-top-level-io-in-nuxt-plugin': noBlockingTopLevelIoInNuxtPlugin,
    'no-legacy-fetch-hook': noLegacyFetchHook,
    'no-legacy-options-prop': noLegacyOptionsProp,
    'no-legacy-overlay-api': noLegacyOverlayApi,
    'no-legacy-overlay-model': noLegacyOverlayModel,
    'no-map-async-in-server': noMapAsyncInServer,
    'no-multi-statement-inline-handler': noMultiStatementInlineHandler,
    'no-static-mermaid-import': noStaticMermaidImport,
    'no-tight-interval': noTightInterval,
    'pinia-require-defineStore-id': piniaRequireDefineStoreId,
    'prefer-safe-parse-in-event-handlers': preferSafeParseInEventHandlers,
    'prefer-shallow-watch': preferShallowWatch,

    // hydration
    'no-locale-date-format-in-ssr-text': noLocaleDateFormatInSsrText,
    'no-ssr-dom-access': noSsrDomAccess,
    'require-client-only-hydration-sensitive': requireClientOnlyHydrationSensitive,
    'require-client-only-switch': requireClientOnlySwitch,

    // vue
    'no-attrs-on-fragment': noAttrsOnFragment,
    'no-composable-conditional-hooks': noComposableConditionalHooks,
    'no-module-scope-ref': noModuleScopeRef,
    'no-non-serializable-store-state': noNonSerializableStoreState,
    'no-setup-top-level-side-effects': noSetupTopLevelSideEffects,
    'no-template-complex-expressions': noTemplateComplexExpressions,

    // nuxt
    'component-directory-structure': componentDirectoryStructure,
    'composable-primary-export': composablePrimaryExport,
    'no-blocking-io-in-server-plugin': noBlockingIoInServerPlugin,
    'no-fetch-create-bypass': noFetchCreateBypass,
    'no-fetch-in-onmounted': noFetchInOnmounted,
    'no-fetch-in-watch': noFetchInWatch,
    'no-raw-fetch': noRawFetch,
    'no-raw-fetch-in-stores': noRawFetchInStores,
    'no-sequential-awaited-io-in-event-handler': noSequentialAwaitedIoInEventHandler,
    'require-use-prefix-for-composables': requireUsePrefixForComposables,

    // server
    'no-csrf-exempt-route-misuse': noCsrfExemptRouteMisuse,
    'no-raw-define-event-handler-in-mutation-routes': noRawDefineEventHandlerInMutationRoutes,
    'no-raw-sql-with-variable-input': noRawSqlWithVariableInput,
    'require-csrf-header-on-mutations': requireCsrfHeaderOnMutations,
    'require-enforce-rate-limit-on-mutations': requireEnforceRateLimitOnMutations,
    'require-immediate-mutation-body-validation': requireImmediateMutationBodyValidation,
    'require-limit-on-drizzle-list-queries': requireLimitOnDrizzleListQueries,
    'require-validated-query': requireValidatedQuery,

    // cloudflare
    'no-process-env-in-worker-runtime': noProcessEnvInWorkerRuntime,
    'no-supabase-client-in-global-scope': noSupabaseClientInGlobalScope,
    'no-worker-global-scope-db-clients': noWorkerGlobalScopeDbClients,
    'no-worker-global-scope-operations': noWorkerGlobalScopeOperations,
  },
}

export default plugin

export const rules: Record<string, unknown> = plugin.rules
export const meta = plugin.meta
