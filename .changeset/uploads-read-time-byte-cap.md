---
'@narduk-enterprises/narduk-uploads': patch
---

`POST /api/upload` now holds the 100 MB request cap while the body is **read**,
not only against the declared `Content-Length`.

Before this, the cap was enforced in two places that both miss on Cloudflare
Workers — the only runtime Narduk apps deploy to. `rejectOversizedUploadRequest`
trusts the `Content-Length` header, and `capIncomingMessageBytes` listens for
`data` events on `event.node.req`, which on Workers is a `node-mock-http`
`IncomingMessage` that never emits any. A client that declared a small
`Content-Length` and then sent 500 MB passed both and was buffered in full
before the multipart parse.

`enforceUploadBodyByteCap(event, maxBytes)` now runs before that parse and
resolves the body the same way h3 does. A web `ReadableStream` is read through a
counting reader that aborts with 413 the moment the cap is passed — the
overflowing chunk is dropped, no further chunk is pulled, and the source is
cancelled so the Worker stops reading. Bytes the runtime already materialised
(the shape Nitro's `cloudflare_module` handler produces) are measured and
refused with 413 before the parse. A live Node request stream is untouched and
still owned by `capIncomingMessageBytes`.

No behaviour change for uploads inside the cap. The 411 on a missing or
non-finite `Content-Length` and the Node hard-stop from the previous release are
unchanged, and both are now pinned by tests. `enforceUploadBodyByteCap` and
`readCappedWebStream` are additive exports of
`@narduk-enterprises/narduk-uploads/server/utils/upload`; nothing existing
changed shape.
