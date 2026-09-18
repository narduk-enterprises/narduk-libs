---
'@narduk-enterprises/narduk-devices': patch
---

`issueApprovalToken` checks the caller's org and resource before it reports
anything about the claim session (narduk-libs#243). A caller naming another org
or resource now gets `forbidden` whatever state the session is in; before, any
authenticated caller holding a claim session id heard whether another tenant's
session was claimed (`conflict`), revoked or expired. The owning org's answers
are unchanged, and an id that does not exist is still `not_found`.
