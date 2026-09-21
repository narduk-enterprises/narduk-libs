---
'@narduk-enterprises/narduk-core': patch
'@narduk-enterprises/create-narduk-app': patch
---

The production error sanitizer can no longer throw. `sanitizeProductionError`
assigned `statusText` unguarded, and `'statusText' in error` is true for a
getter with no setter, so the write threw in strict mode, escaped into Nitro's
error handling, and turned a correct status into a 500 with the original error
discarded. `message`, `statusMessage` and the `delete` of `data` and `cause`
could fail the same way, with worse consequences.

Every field is now scrubbed defensively, falling back to `Object.defineProperty`
so an inherited accessor is shadowed by an own data property and the value is
actually removed rather than merely not throwing. One field that resists both
paths no longer aborts the rest of the pass.
