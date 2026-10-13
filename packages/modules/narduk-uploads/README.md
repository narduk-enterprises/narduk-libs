# @narduk-enterprises/narduk-uploads

R2 upload and image delivery Nuxt module for Narduk Cloudflare apps.

## Install

```ts
export default defineNuxtConfig({
  modules: ['@narduk-enterprises/narduk-uploads/nuxt'],
})
```

Apps must provide a Cloudflare R2 bucket binding named `BUCKET`.

### Serving images from your own bucket and prefixes

An app that only serves R2 images, with no upload surface, can configure the
image route and leave the upload route out:

```ts
export default defineNuxtConfig({
  modules: ['@narduk-enterprises/narduk-uploads/nuxt'],
  nardukUploads: {
    imports: false,
    uploadRoute: false,
    images: {
      binding: 'IMAGES',
      prefixes: [
        // Versioned variants never change under their URL.
        {
          prefix: 'v1/',
          cacheControl: 'public, max-age=31536000, immutable',
          typeFromExtension: true,
        },
        // Replaceable originals.
        {
          prefix: 'products/',
          cacheControl: 'public, max-age=3600, stale-while-revalidate=86400',
          typeFromExtension: true,
        },
      ],
    },
  },
})
```

- `uploadRoute` (default `true`) registers `POST /api/upload`.
- `images.binding` (default `BUCKET`) is the R2 binding `GET`/`HEAD /images/**`
  reads.
- `images.prefixes` (default: `uploads/` with a one-year immutable cache) lists
  the served key prefixes, first match wins. A key outside every prefix is a 404
  before R2 is read. An empty prefix is refused at build time, since it would
  serve the whole bucket.
- `typeFromExtension` takes the type from an allow-listed raster extension
  (`avif`, `gif`, `jpeg`/`jpg`, `png`, `webp`) when there is one, and from the
  stored metadata otherwise. The allow-list still applies, so SVG and non-images
  stay 415 whatever the key or metadata says.

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
  type is on the same allow-list (parameters stripped, lowercased). `HEAD` is
  answered from metadata, and a matching `If-None-Match` gets a 304. Other types
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

This package is for user-uploaded images only. An app whose R2 bucket is
something else (read-only assets, an archive, server-written app data) does not
install it: it declares `"role"` on that `bindings.r2[]` entry in
`Config/cloudflare-app.json` instead, and `foundation:check` 3.3 applies only to
`uploads` buckets (vocabulary in the narduk-app-tools README, "R2 bucket
roles").
