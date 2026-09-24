---
'@narduk-enterprises/narduk-core': patch
'@narduk-enterprises/create-narduk-app': patch
---

Document in the README that on the `cloudflare-module` preset, nitropack 2.13.4 reads the whole request body into memory before h3 or any route handler runs (narduk-libs#458). Only Cloudflare's edge limit (100 MB on Free and Pro) bounds that read. The package's own ceilings (`defineValidatedHandler` `maxBodyBytes`, the 64 KiB CSP report cap) bound parsing, not the read. The note says why there is no Content-Length gate and when to re-test: when the Nitro pin moves, or on Nitro v3, whose Cloudflare handler does not buffer. No runtime change.
