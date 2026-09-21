/**
 * Nitro auto-imports this package's published server sources rely on.
 *
 * `createError` is the one `runtime/server/utils/demo.ts` calls without an
 * import: Nitro injects it, and a consumer's server program declares it. The
 * rest of the server sources import h3 helpers themselves.
 *
 * `ImportMeta` build flags and `H3Event.fetch` come from `nitropack`'s own
 * augmentations, pulled in by `consumer-nitropack-runtime.ts`. Declaring them
 * again here would fight that merge.
 */
import type * as h3 from 'h3'

declare global {
  const createError: typeof h3.createError
}

export {}
