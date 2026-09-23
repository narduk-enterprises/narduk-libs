---
'@narduk-enterprises/narduk-app-tools': minor
'@narduk-enterprises/create-narduk-app': patch
---

`deployment.liveProof.healthAuth: "anonymous" | "authenticated"` (default
`anonymous`). An authenticated health route stays declared, `deploy hotfix`
and `development deploy` skip the anonymous health assertion, item 12.3 says so,
and the adoption live read reports requirement 12 unknown instead of failing a
401 (#585).
