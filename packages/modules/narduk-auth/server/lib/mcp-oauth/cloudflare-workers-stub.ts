/**
 * Stand-in for the `cloudflare:workers` import in
 * @cloudflare/workers-oauth-provider. The library uses `WorkerEntrypoint` only
 * to recognise entrypoint-class handlers passed to `OAuthProvider` /
 * `OAuthResourceServer`; narduk-auth uses neither, only
 * `OAuthAuthorizationServer`. Nuxt's Node dev server, Nitro's prerenderer and
 * vitest cannot load the `cloudflare:` scheme, so the module substitutes this
 * class in every build.
 */
export class WorkerEntrypoint {
  /** Only ever an `instanceof` target; never constructed by narduk-auth. */
  readonly stub = true
}
