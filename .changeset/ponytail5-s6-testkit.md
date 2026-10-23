---
'@narduk-enterprises/narduk-testkit': patch
---

`waitForVueHydrated` judges a Nuxt page by `#__nuxt` alone, the page fixture waits briefly for a Nuxt page to hydrate before scanning for mismatches, `warmUpApp` retries until the page answers 2xx/3xx, and the R2 and KV fakes copy buffers and metadata and reject a list limit outside 1-1000.
