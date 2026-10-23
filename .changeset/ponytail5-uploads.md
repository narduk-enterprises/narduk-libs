---
'@narduk-enterprises/narduk-uploads': patch
---

Parse bounded multipart uploads by slicing the buffer instead of h3's per-byte parser, and read a live Node request stream once through the byte cap so the parser still receives the body.
