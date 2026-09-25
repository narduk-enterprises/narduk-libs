# @narduk-enterprises/narduk-ai

Reusable AI contracts, xAI chat/model helpers, prompt context resolution, and
the optional admin model/system-prompt UI and routes for Narduk Nuxt apps.

Install the package and add `@narduk-enterprises/narduk-ai/nuxt` to a Nuxt app
when the composable, component, or admin routes should be auto-wired. The module
accepts `app: false` and/or `server: false` for consumers that only want the
explicit imports.

Package-internal server imports are deliberately relative. Nuxt's native
`#server` alias belongs to the consuming app, so binding packaged route handlers
to it would resolve AI utilities from the wrong repository. The package's scoped
ESLint override permits this portability rule only inside its own `server/`
directory.

The private `runtimeConfig.xaiApiKey` value is validated as a trimmed string and
is never placed under `runtimeConfig.public`. Set `XAI_API_KEY` at build time or
`NUXT_XAI_API_KEY` through Nitro runtime configuration.

`system_prompts` is a v1 narduk-core-owned table. This package imports the
explicit core SQLite/Postgres table exports and intentionally contains no
Drizzle directory, schema copy, or migration. Core's published migration is the
sole ownership and installation path.

Notable explicit exports include:

- `server/utils/aiContracts`, `aiPromptResolver`, and `aiXmlEscape`
- `server/utils/xai`, `chatCompletions`, `chatModelConfig`, and
  `app/utils/xaiModels`
- `app/composables/useAdminAi` and `app/components/admin/AdminAiTab`
- the four admin route handlers

## OpenAI-compatible chat client (`server/utils/chatCompletions`)

`chatCompletion(messages, options)` calls any OpenAI-compatible
`POST {baseUrl}/chat/completions` (xAI by default; OpenAI, Groq and others by
`baseUrl`), for callers that need more than `grokChat`'s fixed request:

```ts
import {
  chatCompletion,
  chatCompletionJson,
} from '@narduk-enterprises/narduk-ai/server/utils/chatCompletions'

const { content, usage } = await chatCompletion(messages, {
  apiKey: config.xaiApiKey,
  model: 'grok-3-mini',
  temperature: 0.2,
  maxTokens: 800,
})

const { data } = await chatCompletionJson(messages, schema.parse, {
  apiKey: openaiKey,
  baseUrl: 'https://api.openai.com/v1',
  model: 'gpt-4o-mini',
})
```

- Options: `apiKey`, `baseUrl` (default `https://api.x.ai/v1`), `model`,
  `temperature`, `maxTokens`, `json` (`response_format: json_object`),
  `timeoutMs` (default 30 000 per attempt), `retries` (default 1: a 5xx, a
  network error or a timeout is retried; a 4xx and a caller abort are not) and
  `signal`. Unset options are left out of the request.
- The result is `{ content, model, usage }`, with `usage` as
  `{ promptTokens, completionTokens, totalTokens }` or `null`.
- Failures throw an H3 error whose message is the provider's structured error
  message (`parseXaiError`) or a fixed fallback, never the raw upstream body,
  which can echo the prompt or account details. A timeout is a 504.
- `chatCompletionJson(messages, parse, options)` forces JSON mode, tolerates a
  ` ```json ` fence, and passes the parsed value to `parse` (a zod schema's
  `.parse` fits). Whether a failure degrades to `null` stays the caller's
  one-line wrapper.

`grokChat` and `grokChatStream` are unchanged.
