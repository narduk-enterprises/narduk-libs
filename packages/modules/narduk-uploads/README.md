# @narduk-enterprises/narduk-uploads

R2 upload and image delivery Nuxt module for Narduk Cloudflare apps.

## Install

```ts
export default defineNuxtConfig({
  modules: ['@narduk-enterprises/narduk-uploads/nuxt'],
})
```

Apps must provide a Cloudflare R2 bucket binding named `BUCKET`.

## Runtime Surface

- `POST /api/upload` accepts authenticated multipart image uploads
  (`image/jpeg`, `image/png`, `image/webp`, `image/gif`, `image/avif`). Requests
  without a finite `Content-Length` are rejected with 411 before the body is
  read. Declared length above 100 MB is 413. The 100 MB cap is then enforced
  again while the body is read, before the multipart parse: a web
  `ReadableStream` is counted through a reader and aborted with 413 the moment
  it passes the cap (the source is cancelled, so a Worker stops reading), and a
  body the runtime already materialised is measured and refused the same way. A
  live Node request stream is hard-stopped by destroying it. A lying
  `Content-Length` therefore cannot buffer past the cap on any of the three
  paths. The part's declared type is a client header, so each file is also
  identified from its magic bytes (`sniffUploadImageType`). A file that is not
  one of the five allow-listed rasters is refused with 415 and nothing in the
  request is stored. The stored content type and key extension come from the
  bytes, never from the label.
- `GET /images/uploads/*` streams those objects from R2 when the stored content
  type is on the same allow-list (parameters stripped, lowercased). Other types
  — including missing metadata, SVG, HTML, and JavaScript — return 415.
  `uploadToR2` still writes any prefix and type; non-allow-listed objects under
  `uploads/` are stored but not served.
- `useUpload()` uploads files through the route with CSRF support when
  available.
- Both routes write through narduk-core's request logger (`useLogger(event)`),
  so records carry the request ID and reach the app's Worker logs. Every refusal
  is one `warn` `Upload rejected` with `statusCode` and a `reason`
  (`content_length_missing`, `content_length_invalid`, `request_too_large`,
  `body_too_large`, `no_file`, `no_valid_file`, `unsupported_type`,
  `file_too_large`, `content_not_image`). A failed R2 write is an `error`
  `Upload storage write failed` and a failed R2 read an `error`
  `Image storage read failed`, each with the error (narduk-logging sanitizes it;
  production drops the stack). Records hold sizes, counts, keys and normalized
  types, never the client's file name or the bytes.

The package currently expects the Narduk core layer to provide mutation,
rate-limit, logger, and Worker environment helpers. The contract for app/control
tooling lives in `capability-contract.json`.
