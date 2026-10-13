/** How the production build serves the OpenAPI document. `false` disables it. */
export type OpenApiProductionMode = false | 'runtime' | 'prerender'

/**
 * `NUXT_OPENAPI_PRODUCTION` to the production OpenAPI mode.
 *
 * Unset is the common case and serves nothing: a public `/_openapi.json` is a
 * route map for scanners, so an app opts in with `prerender` (or `true`) or
 * `runtime`. An unrecognised value also serves nothing, so a typo can never
 * publish the route.
 */
export function resolveOpenApiProductionMode(value: string | undefined): OpenApiProductionMode {
  switch (value) {
    case 'prerender':
    case 'true':
      return 'prerender'
    case 'runtime':
      return 'runtime'
    case undefined:
    default:
      return false
  }
}
