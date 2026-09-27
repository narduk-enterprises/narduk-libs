---
'@narduk-enterprises/narduk-auth': patch
'@narduk-enterprises/narduk-core': patch
---

Anonymous requests no longer get a session cookie. Since narduk-auth 1.28.0 the global session-refresh middleware read the session on every page, 404 and API request through h3's `useSession`, which seals and sets a new 30-day `nuxt-session` cookie whenever the request has none (narduk-libs#1214). The middleware now skips a request that carries no session cookie (or h3 session header): there is nothing to revalidate. It also answers nuxt-auth-utils' `GET /api/_auth/session` as signed out (`{}`) in that case, so the client's session fetch on load does not mint one either. A request that carries a session is revalidated as before, and a revoked one is still rejected and cleared (#442).

narduk-core adds `peekLayerUserSession(event)`, which reads the session without ever writing a cookie (`null` when there is none or it does not unseal), and `hasLayerUserSession(event)`. `requireAuth` and narduk-auth's `getCurrentSessionUser` now read through the peek, so an anonymous 401 or a pure session read no longer sets a cookie. `getLayerUserSession`, `setLayerUserSession` and `replaceLayerUserSession` are unchanged: sign-in still creates the session.
