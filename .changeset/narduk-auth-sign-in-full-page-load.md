---
'@narduk-enterprises/narduk-auth': minor
---

narduk-auth: every successful sign-in (password, passkey, register, email link,
reset-password recovery, callback exchange) now ends in a full page load
(`navigateTo(path, { external: true, replace: true })`) instead of a client-side
navigation, with the target re-validated as a same-origin path. A script from an
edge-cached public page (narduk-core `htmlCache`, D-HTML-CACHE-PUBLIC-1) therefore
cannot survive into a signed-in session.
