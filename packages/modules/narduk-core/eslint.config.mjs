// @ts-check
import withNuxt from './.nuxt/eslint.config.mjs'
import {
  NODE_BUILTIN_IMPORT_RESTRICTIONS,
  PORTABLE_LAYER_RESTRICTED_IMPORTS_OPTION,
  PORTABLE_LAYER_RESTRICTED_IMPORTS_RULE,
} from '@narduk-enterprises/eslint-config/config/server'
import { nardukTemplateStrictCapabilityPacks } from './eslint-capability-packs.mjs'
import { createAppLintConfig } from './eslint-app-config.mjs'

/**
 * eslint-config v2 made the server and cloudflare pack globs nesting-safe, so
 * this layer's `runtime/server/` tree is linted for the first time. That is the
 * point of the change — it is Nitro code that ships to every consuming app —
 * and the three exceptions below are the pre-existing conditions it surfaced,
 * each scoped to the files that actually have it rather than switched off
 * layer-wide.
 */

/**
 * 1. Layer-internal relative imports.
 *
 * The shared rule tells server code to import through the `#server/*` alias.
 * A published layer has no such alias for its own sources, so its handlers and
 * middleware reach `../utils/logger` and friends relatively and no other
 * spelling exists. The shared constant drops exactly that pattern group; the
 * Node-built-in ban and the other-layer-source ban both survive.
 */
const portableLayerServerImports = {
  name: 'narduk-core/portable-layer-internal-server-imports',
  files: ['runtime/server/**/*.{ts,mts,js,mjs}'],
  rules: {
    'no-restricted-imports': PORTABLE_LAYER_RESTRICTED_IMPORTS_RULE,
  },
}

/**
 * 2. `node:net` in the SSRF validator.
 *
 * `runtime/server/utils/urlValidator.ts` imports `node:dns/promises` and
 * `node:net` to resolve and classify hostnames before fetching them — the whole
 * point of the module. Its own header states the contract: apps deploying to
 * Workers must enable the `nodejs_compat` flag before importing
 * `resolveAndAssertPublicHost` or `fetchWithValidatedRedirects`. The pack's ban
 * ("net is not available in Cloudflare Workers") is true without that flag and
 * is the correct default; this file is the documented exception to it, so the
 * allowance is one file wide and removes one specifier.
 */
const ssrfValidatorNodeNet = {
  name: 'narduk-core/ssrf-validator-node-net',
  files: ['runtime/server/utils/urlValidator.ts'],
  rules: {
    'no-restricted-imports': [
      'error',
      {
        ...PORTABLE_LAYER_RESTRICTED_IMPORTS_OPTION,
        paths: NODE_BUILTIN_IMPORT_RESTRICTIONS.filter(
          (entry) => entry.name !== 'net' && entry.name !== 'node:net',
        ),
      },
    ],
  },
}

/**
 * 3. Deliberately sequential awaits.
 *
 * `no-await-in-loop` is right about a loop that could be a `Promise.all`. Both
 * files below are the other case: `runD1ChunksSequentially()` is named for its
 * ordering guarantee and attaches per-chunk error context, and the redirect
 * walk in `urlValidator` re-validates each hop against the previous hop's
 * result — parallelising either would change behaviour, and in the SSRF walk it
 * would defeat the check. Scoped to these two files so a new parallelisable
 * loop elsewhere in the layer is still reported.
 */
const sequentialByDesign = {
  name: 'narduk-core/sequential-server-loops',
  files: ['runtime/server/utils/urlValidator.ts', 'runtime/server/utils/d1Query.ts'],
  rules: {
    'no-await-in-loop': 'off',
  },
}

export default createAppLintConfig({
  withNuxt,
  capabilityPacks: [...nardukTemplateStrictCapabilityPacks],
  extraOverrides: [portableLayerServerImports, ssrfValidatorNodeNet, sequentialByDesign],
  seoMode: 'required',
})
