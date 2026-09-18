---
'@narduk-enterprises/narduk-uploads': patch
---

`POST /api/upload` identifies each file from its magic bytes instead of trusting
the multipart part's client-supplied type (DR-DATA-7). A file whose bytes are
not PNG, JPEG, GIF, WebP or AVIF, such as HTML or SVG labelled `image/png`, is
refused with 415 before anything is written to R2. The stored content type and
key extension come from the bytes. New export: `sniffUploadImageType` from
`./server/utils/upload`.
