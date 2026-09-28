---
'@narduk-enterprises/narduk-app-tools': patch
'@narduk-enterprises/create-narduk-app': patch
---

`deployment-check` names the `malformed` and `invalid` deployment-block outcomes explicitly when reporting `adoption: invalid`; the reported adoption is unchanged, and a future outcome kind now fails the type check instead of silently reading as invalid.
