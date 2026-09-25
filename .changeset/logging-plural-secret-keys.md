---
'@narduk-enterprises/narduk-logging': patch
'@narduk-enterprises/create-narduk-app': patch
---

Redact plural secret keys (`tokens`, `secrets`, `passwords`, `accessTokens`, `dbPasswords`, …) in the TypeScript, Python, Go and Swift sanitizers. LLM usage counts such as `inputTokens` and `total_tokens` stay visible (narduk-libs#872).
