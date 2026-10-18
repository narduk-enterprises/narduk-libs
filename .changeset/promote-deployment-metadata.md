---
'@narduk-enterprises/narduk-app-tools': patch
'@narduk-enterprises/create-narduk-app': patch
---

Read promotion deployment metadata through the existing bounded Cloudflare API
client when an account and deploy token are available, avoiding Wrangler startup
for eligibility and supersede checks. Preserve the CLI fallback and all guards.
