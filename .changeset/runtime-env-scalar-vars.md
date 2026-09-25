---
'@narduk-enterprises/narduk-core': patch
'@narduk-enterprises/create-narduk-app': patch
---

The runtime-env readers now accept wrangler `vars` that are JSON booleans or
numbers. Workers expose those on `env` as JS values, not strings, and the
readers used to treat them as empty.

- `"NUXT_PUBLIC_ALLOW_GEOLOCATION": true` now reads as `true`. It used to read
  as `false` and skip the runtime-config fallback.
- A number now reads as its string form.
- An object or array var, or a value `readRuntimeBoolean` cannot recognise,
  now falls through to the runtime-config fallback instead of returning
  `defaultValue` or an empty string.
