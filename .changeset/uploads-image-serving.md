---
'@narduk-enterprises/narduk-uploads': minor
---

The image route can serve an app's own bucket and key prefixes: `images.binding`, `images.prefixes` (each with its own `Cache-Control` and opt-in `typeFromExtension`), and `uploadRoute: false` to leave `POST /api/upload` out. `HEAD /images/**` is answered from metadata and a matching `If-None-Match` gets a 304. With no options set, behaviour is unchanged: `uploads/` from `BUCKET` with a one-year immutable cache. The content-type allow-list still applies to every response, so SVG stays refused (narduk-libs#1828).
