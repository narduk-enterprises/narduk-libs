---
'@narduk-enterprises/create-narduk-app': patch
---

Refresh stable same-major dependency pins after a 14-day cooldown and advance the bundled workflow pin and ancestry.

- @cloudflare/workers-types: 5.20260922.1 → 5.20260924.1
- @iconify-json/lucide: 1.2.108 → 1.2.136
- @nuxt/eslint: 1.15.2 → 1.17.0
- @nuxt/test-utils: 4.0.3 → 4.3.2
- @tailwindcss/vite: 4.3.2 → 4.3.3
- @types/node: 22.19.19 → 22.20.4
- @typescript-eslint/utils: 8.64.0 → 8.70.1
- drizzle-kit: 0.31.10 → 0.31.11
- drizzle-orm: 0.45.2 → 0.45.3
- esbuild: 0.28.1 → 0.28.2
- eslint: 10.8.0 → 10.11.0
- happy-dom: 20.9.0 → 20.14.5
- knip: 6.14.1 → 6.38.0
- prettier: 3.8.3 → 3.9.9
- tailwindcss: 4.3.2 → 4.3.3
- vitest: 4.1.6 → 4.1.11
- vue-tsc: 3.2.5 → 3.3.11
- wrangler: 4.136.3 → 4.138.0
- zod: 4.4.3 → 4.6.5
- nuxt-cloudflare workflow: 59825ef09ce484e8189c1932d0ac18f3892dd8d0 → 77cd64d734ea80b84ff9860a8c0492a759183736

Declare h3 1 directly in generated workspaces so fresh resolution does not select incompatible h3 2 types for the application or testkit.
