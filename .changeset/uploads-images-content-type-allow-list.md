---
'@narduk-enterprises/narduk-uploads': patch
---

Serve `GET /images/**` only for the same raster MIME allow-list as
`POST /api/upload`.

`X-Content-Type-Options: nosniff` does not stop a stored `text/html` or
`application/javascript` object from executing on the first-party origin. The
public image route now fail-closes on any stored content type outside
`image/jpeg|png|webp|gif|avif` (including missing metadata and SVG).

`POST /api/upload` now fail-closes on a missing or non-finite `Content-Length`
(411) and hard-stops the Node request stream at the 100 MB request cap so a
lying header cannot buffer the whole body.
