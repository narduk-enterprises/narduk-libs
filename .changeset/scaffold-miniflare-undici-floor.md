---
'@narduk-enterprises/create-narduk-app': patch
'@narduk-enterprises/narduk-testkit': patch
---

Generated apps now override `miniflare>undici` to `^7.29.1`. Miniflare pins
undici exactly, and below 7.29.1 each D1 call a test makes through the testkit
harness costs about 6.5ms instead of about 2ms. That is enough to push
seed-heavy suites past their CI timeouts (narduk-libs#740). The testkit README
documents the override for existing apps.
