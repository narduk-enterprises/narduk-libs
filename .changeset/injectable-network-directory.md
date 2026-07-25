---
'@narduk-enterprises/narduk-seo': major
'@narduk-enterprises/create-narduk-app': patch
---

seo: make the Narduk network directory endpoint injectable with no default

The network directory endpoint is now supplied by the consuming app through
`nardukSeo.networkDirectoryUrl` (or `NUXT_PUBLIC_NARDUK_NETWORK_DIRECTORY_URL`
at runtime) and has **no built-in default**. When it is unset the feature
disables itself: `/api/narduk-network/sites` performs no outbound fetch,
`useNardukNetworkDirectory()` skips its request, `/narduk-network` renders an
empty directory, and `LayerNetworkFooter` omits the directory link. Failing
quiet is deliberate — the directory is a marketing cross-link surface, not a
gate.

Previously the endpoint was derived from a package-owned catalog hostname, so
every app installing this package polled a host it never chose. A published
library must not pin its consumers to one origin.

BREAKING CHANGES:

- `NARDUK_DEFAULT_CATALOG_BASE_URL` is no longer exported.
- `resolveNardukNetworkDirectoryUrl(value)` now takes the full directory URL
  (not a catalog base URL) and returns `null | string` instead of `string`.
- `resolveNardukCatalogBaseUrl(value)` returns `null | string` instead of
  falling back to a hardcoded hostname.
- `/api/narduk-network/sites` responses gained `configured: boolean`, and
  `catalogUrl` / `directoryUrl` may now be `null`.
- Apps that want `/narduk-network` populated must set the new option; upgrading
  without setting it turns the directory off rather than repointing it.
