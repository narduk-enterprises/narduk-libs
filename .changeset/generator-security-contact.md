---
'@narduk-enterprises/create-narduk-app': minor
---

Scaffold a declared AI-crawler policy, and a `security.txt` only when the app
supplies a contact.

An app generated with the `seo` capability now writes `aiCrawlers: 'allow'` into
its `narduk-seo` block. That is the value narduk-seo already defaulted to, so
nothing about the served site changes; what changes is that the policy is
visible in `nuxt.config.ts` instead of being an unstated default, which is where
an app goes to tighten it to `'disallow'` or to a per-agent
`{ allow, disallow }` split.

The new `--security-contact <uri>` flag (and the `securityContact` option) adds
an RFC 9116 `securityTxt` block. It has **no default on purpose**: a scaffold
cannot know who receives a vulnerability report, and a published
`/.well-known/security.txt` naming an address nobody reads is worse than no file
at all, because a reporter believes they have reported. An app that passes the
flag publishes the file; an app that does not publishes nothing.

The value is checked rather than pasted through. A contact must be a `mailto:`,
`https:` or `tel:` URI, or a bare address, and may not contain a line break --
`security.txt` is a line-oriented format, so an unchecked newline would let a
value inject a second `Contact:` line. A contact passed without the `seo`
capability is refused at the call, not silently dropped, because the option it
would land in does not exist in that generated config.

`create-narduk-app upgrade` does not touch either setting on an existing app:
`apps/web/nuxt.config.ts` is not a managed target, so an app that has tightened
its crawler policy or moved its security contact keeps both.
