---
'@narduk-enterprises/narduk-platform': patch
---

`NUXT_SESSION_PASSWORD` and `NUXT_OG_IMAGE_SECRET` are minted per app (`scope: 'one-app'`), and an app env contract that declares a catalog secret as plain or as a Cloudflare var is rejected.
