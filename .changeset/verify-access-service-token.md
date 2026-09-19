---
'@narduk-enterprises/narduk-app-tools': minor
---

`narduk-app verify --live` can prove a host behind Cloudflare Access: `--access-client-id-env` / `--access-client-secret-env` name the environment variables holding a service token, sent as `CF-Access-Client-Id` / `CF-Access-Client-Secret` on every probe and never printed (#569).
