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
  paths.
- `GET /images/uploads/*` streams those objects from R2 when the stored content
  type is on the same allow-list (parameters stripped, lowercased). Other types
  — including missing metadata, SVG, HTML, and JavaScript — return 415.
  `uploadToR2` still writes any prefix and type; non-allow-listed objects under
  `uploads/` are stored but not served.
- `useUpload()` uploads files through the route with CSRF support when
  available.

The package currently expects the Narduk core layer to provide mutation,
rate-limit, logger, and Worker environment helpers. The contract for app/control
tooling lives in `capability-contract.json`.
