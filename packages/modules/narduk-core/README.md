# @narduk-enterprises/narduk-core

Core UI, worker runtime, and shared utilities.

First-class Nuxt package source in this workspace.

Generic shell primitives such as `AppBreadcrumbs` live here; AI runtime and
admin surfaces now belong to `@narduk-enterprises/narduk-ai` in
`packages/modules/narduk-ai/`.

> [!NOTE] Public SEO and Schema.org capabilities have been moved to
> `@narduk-enterprises/narduk-seo` in `packages/modules/narduk-seo/`. Internal
> SPA apps and operator consoles can use only `@narduk-enterprises/narduk-core`
> without loading public formatting dependencies. Public websites should
> explicitly register the SEO package and use `useSeo(...)` for proper
> structured metadata.

Nitro OpenAPI generation is enabled here for all downstream apps. By default,
production builds prerender `/_openapi.json`, while the Scalar and Swagger UI
routes stay disabled unless an app opts into `nitro.openAPI.ui`. Set
`NUXT_OPENAPI_PRODUCTION=runtime` to serve the spec dynamically or
`NUXT_OPENAPI_PRODUCTION=false` to disable the production route entirely.

The core security headers keep browser geolocation disabled by default. Apps
that intentionally need user-location prompts can set
`NUXT_PUBLIC_ALLOW_GEOLOCATION=true` to emit
`Permissions-Policy: geolocation=(self)` while leaving camera and microphone
blocked.

## Deprecated components

### `AppEmptyState` — deprecated, removed in the next major

Use `NeStatePanel` from `@narduk-enterprises/narduk-shell` instead
([narduk-libs#254](https://github.com/narduk-enterprises/narduk-libs/issues/254),
backlog item 7; standing decision D4, Logan 2026-09-11: "Deprecate, remove next
major"). `AppEmptyState` still behaves exactly as it did — this release changes
no runtime behaviour — but it will not survive the next narduk-core major.

`AppEmptyState` can only say "nothing here". It cannot tell **unknown** from
**zero**, which is the distinction the surfaces using it actually need, and the
bug class behind operator-portal
[#183](https://github.com/narduk-enterprises/operator-portal/issues/183),
[#162](https://github.com/narduk-enterprises/operator-portal/issues/162),
[#100](https://github.com/narduk-enterprises/operator-portal/issues/100) and
[#21](https://github.com/narduk-enterprises/operator-portal/issues/21).
`NeStatePanel` carries five readings — `empty`, `loading`, `error`, `blocked`,
`absent` — gives each the right ARIA role by construction, and never signals the
reading with colour alone.

The props map one for one:

| `AppEmptyState`         | `NeStatePanel`                                     |
| ----------------------- | -------------------------------------------------- |
| (implicit empty)        | `state="empty"`                                    |
| `title`                 | `title`                                            |
| `description`           | `message`                                          |
| `icon`                  | `icon`                                             |
| default slot (a button) | `#action` slot                                     |
| `compact`               | no equivalent; pass `class` or `ui` if you need it |

```vue
<!-- before -->
<AppEmptyState
  icon="i-lucide-inbox"
  title="No invoices yet"
  description="Create your first invoice to get started."
>
  <UButton to="/invoices/new" icon="i-lucide-plus">Create invoice</UButton>
</AppEmptyState>

<!-- after -->
<NeStatePanel
  state="empty"
  icon="i-lucide-inbox"
  title="No invoices yet"
  message="Create your first invoice to get started."
>
  <template #action>
    <UButton to="/invoices/new" icon="i-lucide-plus">Create invoice</UButton>
  </template>
</NeStatePanel>
```

A migrating app also gains `loading`, `error`, `blocked` and `absent` for free,
plus the `gaps` / `unblocksOn` vocabulary — see
[narduk-shell's README](../../design/narduk-shell/README.md#nestatepanel).

A one-time, **dev-only** `console.warn` points at `NeStatePanel` the first time
`AppEmptyState` is set up in a development process. Production stays silent, and
the empty-state markup is unchanged. The `@deprecated` JSDoc on the component
gives editors and `vue-tsc` the strike-through and the same pointer.

## Media security policy

Media stays restricted to the application origin by default. Set
`runtimeConfig.public.cspMediaSrc` (or `CSP_MEDIA_SRC` at build time /
`NUXT_PUBLIC_CSP_MEDIA_SRC` at runtime) to a comma-separated list of additional
sources, such as `blob:,https://media.example.com`. Browser MSE players
typically need `blob:` here and the media origin in `cspConnectSrc` for manifest
and segment fetches; native HLS needs the media origin in `cspMediaSrc`. These
options extend only their named directives and leave scripts, frames, and
workers unchanged.

## Database alias contract

Core-owned server code uses two private Nuxt aliases. `#narduk-core/schema`
selects the D1 or PostgreSQL core schema according to `NUXT_DATABASE_BACKEND`,
while `#narduk-core/postgres-runtime` selects the real PostgreSQL adapter or the
D1-safe stub. Capability packages that need core tables may use
`#narduk-core/schema` after registering the core Nuxt module.

Application code must use its own `#narduk-db` dialect selector instead. These
private aliases do not replace Nuxt's native `#server/*` paths, and the former
template-era database aliases are not registered.
