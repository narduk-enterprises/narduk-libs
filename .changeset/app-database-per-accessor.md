---
'@narduk-enterprises/narduk-core': patch
'@narduk-enterprises/create-narduk-app': patch
---

Each `createAppDatabase()` accessor now memoizes its own per-request Drizzle instance. They used to share one `event.context._appDb` slot, so whichever accessor ran first on a request fixed the schema for every later one. On signed-in requests that was narduk-auth's `useAuthBridgeDatabase`, from its session middleware, so the app's `useAppDatabase(event)` got auth's schema and its relational queries could not see the app's tables (#919). `event.context._appDb` is no longer written; the type stays, marked deprecated.
