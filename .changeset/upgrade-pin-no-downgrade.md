---
'@narduk-enterprises/create-narduk-app': patch
---

`upgrade` no longer re-pins `nuxt-cloudflare.yml` onto an older SHA. A caller moves forward only along pins this generator has shipped; a newer workflows SHA, and its `workflows@` comment, stay where the app put them.
