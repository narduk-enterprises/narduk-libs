---
'@narduk-enterprises/narduk-core': patch
'@narduk-enterprises/create-narduk-app': patch
---

defineServerResource: server renders read again. On the server Nuxt's `runWithContext` answers with a promise, so 2.24.0's handler destructured `undefined` and every SSR read failed with "Cannot set properties of undefined (setting 'value')". The handler now awaits the scoped values on the server (the browser path stays synchronous), and keepAlive's `getCachedData` and `invalidateServerResources()` read the freshness stamp each consumer registers rather than calling into a context.
