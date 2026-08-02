// @ts-check
import withNuxt from './.nuxt/eslint.config.mjs'
import { PORTABLE_LAYER_RESTRICTED_IMPORTS_RULE } from '@narduk-enterprises/eslint-config/config/server'
import { createAppLintConfig } from '@narduk-enterprises/eslint-config/eslint-app-config'
import { nardukTemplateStrictCapabilityPacks } from '@narduk-enterprises/narduk-core/eslint-capability-packs'
import {
  importXVueCoreModuleFragment,
  redundantNuxtAutoImportFlatConfig,
} from '@narduk-enterprises/narduk-core/eslint-nuxt-flat-fragments'

/**
 * eslint-config v2 made the server pack globs nesting-safe, so this layer's
 * `runtime/server/` tree is linted for the first time. The two exceptions below
 * are what that first pass surfaced in `runtime/server/api/upload.post.js`,
 * each scoped to that one file.
 */
const uploadHandlerOverrides = {
  name: 'narduk-uploads/multipart-upload-handler',
  files: ['runtime/server/api/upload.post.js'],
  rules: {
    /**
     * `require-immediate-mutation-body-validation` wants a schema parser on the
     * body reader. `readMultipartFormData()` returns binary parts, not a JSON
     * document, and a zod schema over an ArrayBuffer asserts nothing useful
     * about it. The real validation is `validateUploadFiles()` — allow-listed
     * MIME type and a per-file byte ceiling — plus the request-size rejection
     * in `parseBody` and the `defineUserMutation` rate limit.
     *
     * Narrowed rather than disabled: `readBody`, `readRawBody` and
     * `readFormData` stay guarded in this file, so a JSON body added here later
     * still has to be parsed by a schema.
     */
    'narduk/require-immediate-mutation-body-validation': [
      'error',
      { bodyReaders: ['readBody', 'readRawBody', 'readFormData'] },
    ],

    /**
     * The upload loop awaits `uploadToR2` per file on purpose. Each iteration
     * copies the file into a fresh `ArrayBuffer` before sending it; running the
     * batch concurrently would hold every file in the isolate's memory at once,
     * against a hard Workers memory limit, to save latency on a request that is
     * already dominated by R2. Sequential is the resource-bound choice here.
     */
    'no-await-in-loop': 'off',
  },
}

/**
 * Layer-internal relative imports: a published layer has no `#server/*` alias
 * for its own sources. The shared constant drops that one pattern group and
 * keeps the Node-built-in and other-layer-source bans.
 */
const portableLayerServerImports = {
  name: 'narduk-uploads/portable-layer-internal-server-imports',
  files: ['runtime/server/**/*.{ts,mts,js,mjs}'],
  rules: {
    'no-restricted-imports': PORTABLE_LAYER_RESTRICTED_IMPORTS_RULE,
  },
}

// The sanctioned composition path: createAppLintConfig strips the
// Nuxt-managed plugin registrations (@typescript-eslint, vue, nuxt) from the
// shared packs so withNuxt's own instances stay the only ones. Hand-rolling
// withNuxt(...composeSharedConfigs(...)) double-registers them under v2.
export default createAppLintConfig({
  withNuxt,
  capabilityPacks: [...nardukTemplateStrictCapabilityPacks],
  extraOverrides: [
    redundantNuxtAutoImportFlatConfig,
    importXVueCoreModuleFragment,
    portableLayerServerImports,
    uploadHandlerOverrides,
  ],
})
