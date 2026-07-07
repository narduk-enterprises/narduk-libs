# @narduk-enterprises/narduk-core

Core UI, worker runtime, and shared utilities.

First-class layer package source in this workspace.

Generic shell primitives such as `AppBreadcrumbs` live here; AI runtime and
admin surfaces now belong in `layers/ai/`.

> [!NOTE] Public SEO and Schema.org capabilities have been moved to
> `layers/seo`. Internal SPA apps and operator consoles run purely on `core`
> without loading public formatting dependencies. Public websites should
> explicitly extend the SEO layer and use `useSeo(...)` for proper structured
> metadata.

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
