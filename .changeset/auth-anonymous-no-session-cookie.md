---
'@narduk-enterprises/create-narduk-app': patch
'@narduk-enterprises/narduk-auth': patch
'@narduk-enterprises/narduk-core': patch
---

Anonymous requests no longer get a session cookie. Since narduk-auth 1.28.0 the global session-refresh middleware read the session on every page, 404 and API request through h3's `useSession`, which seals and sets a new 30-day `nuxt-session` cookie whenever the request has none (narduk-libs#1214). The middleware now skips a request that carries no session cookie (or h3 session header): there is nothing to revalidate. It also answers nuxt-auth-utils' `GET /api/_auth/session` as signed out (`{}`) in that case, so the client's session fetch on load does not mint one either. A request that carries a session is revalidated as before, and a revoked one is still rejected and cleared (#442).

A session cookie that does not unseal (tampered, a rotated password, or older than `maxAge`) is replaced with a fresh empty session, so every later read in the request sees signed out, and `/api/_auth/session` answers `{}` for it.

narduk-core now seeds `runtimeConfig.session.name` (`nuxt-session`) and `runtimeConfig.session.maxAge` (30 days), and its session helpers read both keys from `runtimeConfig.session`. nuxt-auth-utils reads the same config, so the two agree on the cookie name and lifetime. Before, nuxt-auth-utils had no `maxAge` and would still serve the user of a replayed cookie that core had refused as too old. An app-set `runtimeConfig.session.name` or `maxAge`, or a `NUXT_SESSION_NAME` / `NUXT_SESSION_MAX_AGE` override, now applies to both.

narduk-core adds `peekLayerUserSession(event)`, which reads the session without ever writing a cookie (`null` when there is none or it does not unseal), and `hasLayerUserSession(event)`. `requireAuth` and narduk-auth's `getCurrentSessionUser` now read through the peek, so an anonymous 401 or a pure session read no longer sets a cookie. `getLayerUserSession`, `setLayerUserSession` and `replaceLayerUserSession` are unchanged: sign-in still creates the session. The generator release picks up the new package pins.
