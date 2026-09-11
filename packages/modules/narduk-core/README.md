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

## Deprecations

### `AppConfirmModal` — deprecated, removed in the next major

Superseded by `NeConfirmDialog` and `useConfirm()` in
[`@narduk-enterprises/narduk-shell`](../../design/narduk-shell/README.md#neconfirmdialog--useconfirm)
(components backlog item 16,
[narduk-libs#263](https://github.com/narduk-enterprises/narduk-libs/issues/263);
decision D4, 2026-09-11: deprecate now, remove in the next narduk-core major).

Behaviour is unchanged in this release — the component still works exactly as it
did. New code should use the suite; existing call sites can migrate at their own
pace before the next major.

**Migration mapping**

| `AppConfirmModal`              | `NeConfirmDialog`                | Notes                                                                                                         |
| ------------------------------ | -------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `v-model`                      | `v-model:open`                   | Nuxt UI v4's overlay model; the `narduk/no-legacy-overlay-model` lint rule already wants this spelling.       |
| `title`                        | `title`                          | Same default (`Are you sure?`).                                                                               |
| `message`                      | `message`                        | Now also the dialog's `aria-describedby` target.                                                              |
| `confirmLabel` / `cancelLabel` | `confirmLabel` / `cancelLabel`   | Same defaults.                                                                                                |
| `confirmColor="error"`         | `tone="danger"`                  | Also moves initial focus to Cancel. `confirmColor` was `error` by default; `tone` is `default` by default.    |
| `confirmColor` (other values)  | `tone="default"`                 | The suite offers two tones deliberately. A one-off colour is a sign the dialog is doing more than confirming. |
| `loading`                      | `pending`                        | Additionally disables cancel and turns off Escape / outside-click dismissal (`preventClose`).                 |
| `dismissible`                  | — (derived)                      | Dismissal is on unless `pending`; there is no separate switch.                                                |
| `icon` / icon tone             | — (dropped)                      | The tone colours the confirm button instead. Put an icon in the body if a call site genuinely needs one.      |
| default slot                   | `#body` slot, or the `body` prop | `AppConfirmModal`'s default slot landed in `UModal`'s trigger slot; `#body` puts it in the dialog body.       |
| `@confirm` / `@cancel`         | `@confirm` / `@cancel`           | Unchanged, including that `@confirm` deliberately leaves the dialog open.                                     |

Most call sites are better off dropping the markup entirely:

```ts
const confirm = useConfirm()
if (
  !(await confirm({
    title: 'Delete invoice?',
    message: 'This cannot be undone.',
    tone: 'danger',
  }))
) {
  return
}
```
