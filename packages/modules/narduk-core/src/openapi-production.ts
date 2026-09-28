/** How the production build serves the OpenAPI document. `false` disables it. */
export type OpenApiProductionMode = false | 'runtime' | 'prerender'

/**
 * `NUXT_OPENAPI_PRODUCTION` to the production OpenAPI mode.
 *
 * Unset is the common case and prerenders the spec, like any unrecognised
 * value: a typo must not silently drop the route or switch it to runtime
 * generation.
 */
export function resolveOpenApiProductionMode(value: string | undefined): OpenApiProductionMode {
  switch (value) {
    case 'false':
    case 'disabled':
      return false
    case 'runtime':
      return 'runtime'
    case undefined:
    default:
      return 'prerender'
  }
}
