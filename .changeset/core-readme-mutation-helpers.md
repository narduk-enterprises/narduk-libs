---
'@narduk-enterprises/narduk-core': patch
'@narduk-enterprises/create-narduk-app': patch
---

Documentation only: the README now documents the mutation wrappers (`definePublicMutation`, `defineUserMutation`, `defineAdminMutation`, `defineCronMutation`, `defineUserQuery`, `defineAdminQuery`) and the body helpers (`withValidatedBody`, `withOptionalValidatedBody`, `requireMutationBody`), with an example. It covers the fixed order (rate limit, then auth, then body parse, then handler), the options, how a validation failure is answered, and when to use `defineValidatedHandler` instead. No code changes. The generator release picks up the new package pin.
