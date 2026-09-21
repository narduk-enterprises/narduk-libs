/**
 * The Nitro auto-imports this package's published server sources rely on,
 * declared the way a consumer's Nitro type program declares them: the h3
 * helpers from the real `h3` types, and this package's own `server/utils`
 * exports from their real source, because `src/module.ts` registers that
 * directory with `addServerScanDir`.
 *
 * `useRuntimeConfig` is the load-bearing one. It is declared with the shape a
 * consumer's Nitro program really gives it -- `@nuxt/schema`'s `RuntimeConfig`
 * extends `Record<string, unknown>`, so every key this module's augmentation
 * would have named is `unknown` -- which is the condition narduk-libs#621 was
 * filed for and the reason this project rejects reading a config key straight
 * into a `string`.
 */
import type * as h3 from 'h3'

declare global {
  const createError: typeof h3.createError
  const defineEventHandler: typeof h3.defineEventHandler
  const deleteCookie: typeof h3.deleteCookie
  const getCookie: typeof h3.getCookie
  const getQuery: typeof h3.getQuery
  const getRequestHeader: typeof h3.getRequestHeader
  const getRequestURL: typeof h3.getRequestURL
  const getValidatedQuery: typeof h3.getValidatedQuery
  const readBody: typeof h3.readBody
  const readValidatedBody: typeof h3.readValidatedBody
  const sendNoContent: typeof h3.sendNoContent
  const setCookie: typeof h3.setCookie
  const setResponseHeader: typeof h3.setResponseHeader
  const setResponseStatus: typeof h3.setResponseStatus

  const useRuntimeConfig: (
    event?: h3.H3Event,
  ) => Record<string, unknown> & { public: Record<string, unknown> }

  const cachedAnalyticsFetch: typeof import('../../server/utils/analyticsCache').cachedAnalyticsFetch
  const resolveAnalyticsDateRange: typeof import('../../server/utils/analyticsCache').resolveAnalyticsDateRange

  const GA_SCOPES: typeof import('../../server/utils/google').GA_SCOPES
  const GSC_SCOPES: typeof import('../../server/utils/google').GSC_SCOPES
  const GSC_WRITE_SCOPES: typeof import('../../server/utils/google').GSC_WRITE_SCOPES
  const GoogleApiError: typeof import('../../server/utils/google').GoogleApiError
  const INDEXING_SCOPES: typeof import('../../server/utils/google').INDEXING_SCOPES
  const buildBatchBody: typeof import('../../server/utils/google').buildBatchBody
  const getAccessToken: typeof import('../../server/utils/google').getAccessToken
  const googleApiFetch: typeof import('../../server/utils/google').googleApiFetch
  const parseBatchResponse: typeof import('../../server/utils/google').parseBatchResponse

  /**
   * Nitro's ofetch global. Declared structurally rather than as
   * `typeof import('ofetch').$fetch` because `ofetch` is not a dependency of
   * this package -- Nitro supplies it -- so it is not resolvable from here.
   */
  const $fetch: <T = unknown>(request: string, options?: Record<string, unknown>) => Promise<T>

  /** The Nitro build-condition flags Nuxt adds to `ImportMeta`. */
  interface ImportMeta {
    readonly client: boolean
    readonly dev: boolean
    readonly prerender: boolean
    readonly server: boolean
  }
}

export {}
