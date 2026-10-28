---
'@narduk-enterprises/narduk-app-tools': minor
---

Adoption R4 now works with an app-scoped, foundation-exception-only portal key: when `app_repo`, `repo`, `org` and `app` all answer 403, it trusts the single app-bound `foundation_exception` row instead of joining. The full-token path is unchanged, and any other error or a partial 403 still fails closed.
