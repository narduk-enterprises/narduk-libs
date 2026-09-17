---
'@narduk-enterprises/narduk-seo': minor
---

Add opt-in RFC 9116 `security.txt` and an `aiCrawlers` policy on top of the
existing `@nuxtjs/robots` groups.

`nardukSeo.securityTxt` stays off until the app sets `contact` — the package
never invents a reporting address. When contact is set, the module bakes
`Expires` as build time plus `expiresDays` (default 365, max 365) and serves the
body at `/.well-known/security.txt` and `/security.txt` as
`text/plain; charset=utf-8`. Enabling the option without a contact is a
build-time error.

`nardukSeo.aiCrawlers` defaults to `'allow'` and emits no extra robots groups,
so existing apps keep the same robots.txt. `'disallow'` and
`{ allow, disallow }` add groups for the exported `AI_CRAWLERS` list (GPTBot,
ChatGPT-User, OAI-SearchBot, ClaudeBot, Claude-Web, anthropic-ai,
Google-Extended, PerplexityBot, CCBot, Bytespider, Amazonbot, Applebot-Extended,
meta-externalagent, cohere-ai).

`securityTxt` field values (`contact`, `canonical`, `policy`, `acknowledgments`,
`preferredLanguages`) reject embedded `\r`/`\n` with a build-time error —
security.txt is one field per line, so a line break could otherwise inject an
extra field. The served route also logs one `console.warn` per isolate when
`Expires` is at or within 30 days of passing, since the value is baked in at
build time and never refreshes on its own.
