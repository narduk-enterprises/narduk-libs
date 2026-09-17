---
'@narduk-enterprises/create-narduk-app': minor
---

Document the shared error page and exception capture in generated apps, and
prove a generated app never shadows them.

narduk-core supplies the error page through Nuxt's `app:resolve` hook only when
the app has not provided one, so a generated `apps/web/app/error.vue` — even a
placeholder — would silently take the estate page out of every new app. A
generator test now asserts that no generated file is an `error.vue` and that no
generated source registers a `vue:error`, `app:error` or Nitro `error` listener.

New `docs/error-page.md` in the generated repository covers what the page shows,
its E2E selectors, where exceptions are reported, how to subscribe another
destination, and how to override or wrap the page; README links to it.
