---
'@narduk-enterprises/narduk-app-tools': patch
'@narduk-enterprises/create-narduk-app': patch
---

development deploy now reconciles Worker crons and routes after promote. Version upload and `POST {script}/deployments` carry code only, so a trigger change in wrangler.jsonc previously never applied. The deploy path now runs `wrangler triggers deploy` from the artifact's resolved config (`.output/server/wrangler.json`, falling back to the source Wrangler file when the artifact omits those keys).
