---
'@narduk-enterprises/narduk-core': minor
'@narduk-enterprises/create-narduk-app': patch
---

Three small narduk-core changes.

- `readBoundedBody` and `readBoundedJson` are exported server utils
  (narduk-libs#565). They read an upstream body with a hard size ceiling,
  cancelling the stream once it passes `maxBytes`, and throw
  `BoundedBodyTooLargeError`, or your own error via `tooLarge`. The narduk-data
  client already read its bodies this way. The README documents it. An app with
  its own util of the same name gets a duplicate auto-import warning; delete the
  app's copy.
- `x-build-version` reads `WORKERS_CI_COMMIT_SHA` before it asks `git`
  (narduk-libs#584). A Workers Build no longer depends on its checkout carrying
  `.git` to stamp the commit.
- `defineRateLimitedHandler` given an async handler returns
  `EventHandler<Request, Promise<Response>>`, not `Promise<Promise<Response>>`
  (narduk-libs#653). Runtime behaviour is unchanged, and the cast in
  `definePublishedDataHandler` is gone.
