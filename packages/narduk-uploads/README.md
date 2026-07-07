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

- `POST /api/upload` accepts authenticated multipart image uploads.
- `GET /images/uploads/*` streams uploaded image objects from R2.
- `useUpload()` uploads files through the route with CSRF support when
  available.

The package currently expects the Narduk core layer to provide mutation,
rate-limit, logger, and Worker environment helpers. The contract for app/control
tooling lives in `capability-contract.json`.
