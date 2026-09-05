---
'@narduk-enterprises/narduk-app': minor
---

Add the HTTP error + requestBody contract (narduk-libs#76 Wave 2): three new
subpath exports, additive only, no existing export changed.

- `@narduk-enterprises/narduk-app/server/errors` — `apiError()` /
  `reasonPhrase()`. h3 carries a refusal's copy in two different fields
  (`statusMessage`, sanitized to printable ASCII and never sent over HTTP/2, vs.
  free-text `message`), and `apiError()` puts a person-facing sentence in the
  one a client actually reads.
- `@narduk-enterprises/narduk-app/server/request-body` — `readJsonBody()` /
  `readQuery()` / `readRawJsonBody()`. Reads a Zod-validated body or query in
  one place: an absent body becomes `{}` rather than refusing an all-optional
  schema, and a refusal is a sentence (an app's own copy, `RequestBodyRefusals`,
  is a required argument) rather than h3's own raw Zod issue-array dump.
- `@narduk-enterprises/narduk-app/client/api-error` — `apiErrorMessage()` /
  `apiErrorCode()` / `apiErrorStatus()` / `describeApiError()`, the client-side
  reader for a caught `$fetch` rejection carrying an error built with
  `apiError()`.

Extracted from pacc-trac `server/utils/apiError.ts` + `requestBody.ts` +
`app/utils/apiError.ts` (~380 LOC, tested) and harmony-hot-sauce
`app/utils/apiError.ts`'s `describeApiError` (the thinner subset), per the
web-foundation-libs-plan §3d cluster and narduk-libs#76's Wave 2 list. This PR
is the library half only; pacc-trac and harmony-hot-sauce keep their local
copies until each migrates in its own follow-up (tracked on each repo's own
web-foundation issue). pacc-trac also keeps its Swift `APIError` mirror with its
own contract tests — that stays local, unaffected by this change.

Adds `h3` as a runtime dependency (`^1.15.11`, already the version this
monorepo's other H3-touching packages use) and `zod` as a type-only
devDependency (the new functions are generic over `z.ZodType`/`z.output`, so no
`zod` import is emitted at runtime).
