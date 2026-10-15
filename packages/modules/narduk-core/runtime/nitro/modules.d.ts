// Specifiers only Nitro's build resolves. `#narduk-core/cloudflare-module-entry`
// is an alias the module adds for the preset's own entry; `#internal/nuxt/app-config`
// is the virtual Nuxt registers for server app config.
declare module '#narduk-core/cloudflare-module-entry' {
  const handler: import('../shared/asset-miss-no-store').WorkerHandlerLike & {
    [key: string]: unknown
  }
  export default handler
}

declare module '#internal/nuxt/app-config' {
  const appConfig: Record<string, unknown>
  export default appConfig
}
