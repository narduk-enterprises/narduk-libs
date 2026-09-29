---
'@narduk-enterprises/narduk-platform': minor
'@narduk-enterprises/create-narduk-app': patch
---

The env catalog names nvault, not Doppler, as the home of every shared value:

- **New `nvault:<project>/<environment>/<config>/<key>` source kind.**
- **Rehomed:** `GH_PACKAGES_READ`, the three apple-maps `APPLE_*` keys (the canonical `apple/prd/mapkit-signing`, agent-infrastructure#1657) and the auth authority trio `AUTH_AUTHORITY_URL`, `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` (`narduk-auth/prd/app`) now point at nvault. `TURNSTILE_*` and `XAI_API_KEY` stay on the retired `narduk/tokens` until they have an nvault home (agent-infrastructure#2131), and a test stops that list from growing.
- **Removed:** `GSC_SERVICE_ACCOUNT_JSON` and `POSTHOG_PERSONAL_API_KEY`. The operator portal now reports analytics for every app (agent-infrastructure#1692), so no app Worker holds a shared reporting credential. narduk-core's runtime status no longer lists them as missing.
