---
'@narduk-enterprises/narduk-platform': minor
---

The env catalog no longer sources anything from the retired Doppler `narduk/tokens` config (agent-infrastructure#2131). `TURNSTILE_SITE_KEY` and `TURNSTILE_SECRET_KEY` now come from nvault `cloudflare/prd/turnstile-shared`. The every-app `XAI_API_KEY` entry and the `xai` capability are removed; apps that call Grok keep their own per-app value. A test fails if any entry sources `doppler:narduk/tokens`.
