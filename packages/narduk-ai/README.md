# @narduk-enterprises/narduk-ai

Reusable AI contracts, xAI chat/model helpers, prompt context resolution, and
the optional admin model/system-prompt UI and routes for Narduk Nuxt apps.

Install the package and add `@narduk-enterprises/narduk-ai/nuxt` to a Nuxt app
when the composable, component, or admin routes should be auto-wired. The module
accepts `app: false` and/or `server: false` for consumers that only want the
explicit imports.

The private `runtimeConfig.xaiApiKey` value is validated as a trimmed string and
is never placed under `runtimeConfig.public`. Set `XAI_API_KEY` at build time or
`NUXT_XAI_API_KEY` through Nitro runtime configuration.

`system_prompts` is a v1 narduk-core-owned table. This package imports the
explicit core SQLite/Postgres table exports and intentionally contains no
Drizzle directory, schema copy, or migration. Core's published migration is the
sole ownership and installation path.

Notable explicit exports include:

- `server/utils/aiContracts`, `aiPromptResolver`, and `aiXmlEscape`
- `server/utils/xai`, `chatModelConfig`, and `app/utils/xaiModels`
- `app/composables/useAdminAi` and `app/components/admin/AdminAiTab`
- the four admin route handlers
