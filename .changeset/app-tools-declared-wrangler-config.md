---
'@narduk-enterprises/narduk-app-tools': patch
---

`foundation:check` reads the wrangler config `Config/cloudflare-app.json` names in `worker.wranglerConfig` before the known candidate paths. A monorepo whose app lives outside them (pacc-trac's `apps/facility/wrangler.jsonc`) no longer reads 1.2 as "no wrangler config found at a known path", which left adoption R4 item 1 undecided. A declared path that is absolute or leaves the checkout is ignored.
