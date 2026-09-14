# been-sober-for — component-usage survey (L7)

SHA `37d1e8d` on `main`. apps/web: 49 .vue, 15 components, 29 pages, 3 layouts,
6 composables. Nuxt 4.4.8. The **only** L7 repo with `tailwindcss` (^4.2.1) as a
direct dependency and **without** `@nuxt/ui` as a direct dependency (own
`UI_PLAN.md`-driven design system) — though `app.vue` wraps everything in
`<UApp>`, so Nuxt UI is present and used transitively (almost certainly pulled
in via narduk-core/narduk-auth). Deps: narduk-core 1.23.2, narduk-auth 1.25.4,
narduk-analytics 1.19.33, narduk-seo 2.0.10, narduk-uploads 1.19.19. No
@tanstack/vue-table.

## Standout finding: possible shadowed/dead narduk-auth duplicates

`apps/web/app/components/auth/{LoginCard,RegisterCard,ExchangePanel}.vue` (263 +
245 + 98 = **606 LOC**) are full local reimplementations of narduk-auth's
`AuthLoginCard`, `AuthRegisterCard`, and `AuthExchangePanel` — own zod schemas,
own `useAuth()` calls. **Zero** usage found anywhere in this app's `.vue`/`.ts`
source under either `<LoginCard>` or `<AuthLoginCard>` (and the equivalent pairs
for the other two). This app's own `bsf/` folder proves Nuxt's default
folder-prefix convention is active here (`bsf/SiteHeader.vue` →
`<BsfSiteHeader>`, 1 consumer; `bsf/MilestonePage.vue` → `<BsfMilestonePage>`, 8
consumers) — so `auth/LoginCard.vue` almost certainly registers globally as
`<AuthLoginCard>`, the **same tag name** narduk-auth's own layer assigns its
shared component. Two possibilities, neither good: (a) this is 606 LOC of dead
code nobody deleted, or (b) it silently shadows/replaces narduk-auth's shared
login/register/exchange UI wherever the library's own auto-served login/register
pages render those tags — meaning this app is quietly running its own auth-card
UI, undetectable by tag search, while every other consumer assumes narduk-auth's
cards are what's live. **This needs a direct build/component-manifest check, not
another grep** — flagged for the orchestrator.

## Most reusable hand-rolled things

1. **auth/LoginCard, RegisterCard, ExchangePanel** — see above. 606 LOC,
   `duplicates_lib`: AuthLoginCard/AuthRegisterCard/AuthExchangePanel.
2. **sobrietyTime.ts** — `apps/web/app/utils/sobrietyTime.ts` (135 LOC, 8
   exported functions, **9 consumers**). Duration/date formatting for the app's
   core sobriety-day-count feature. Directly implicated in issue #7 (below).
3. **BsfPublicProfileBody** —
   `apps/web/app/components/bsf/BsfPublicProfileBody.vue` (156 LOC, 3
   consumers). Renders a public profile including the live day-counter.
4. **BsfDashboardShell** — `apps/web/app/components/bsf/BsfDashboardShell.vue`
   (84 LOC, 1 consumer). Dashboard layout shell; narduk-core's
   `LayerDashboardShell` is unused here.
5. **BsfPublicProfilesGrid** —
   `apps/web/app/components/bsf/BsfPublicProfilesGrid.vue` (95 LOC, 1 consumer).
   Public-profile card grid backed by a limit-only (max 20) list endpoint.
6. **PrivateCounterPanel** —
   `apps/web/app/components/bsf/PrivateCounterPanel.vue` (115 LOC, 1 consumer).
   Live counter/KPI panel.
7. **BsfQrCode** — `apps/web/app/components/bsf/BsfQrCode.vue` (89 LOC, 2
   consumers). QR + share-link UI; narduk-core `AppCopyButton` is unused (0
   hits) despite the overlap.
8. **AvatarCropDialog** — `apps/web/app/components/bsf/AvatarCropDialog.vue`
   (107 LOC, 1 consumer). Crop UI in front of narduk-uploads, which ships no
   crop dialog of its own.
9. **BsfMilestonePage** — `apps/web/app/components/bsf/MilestonePage.vue` (50
   LOC, **8 consumers** — highest reuse in this app), templating the 8 static
   `(milestones)/*.vue` SEO landing pages.

## The table story

**No table exists in this app** (0 hits for
`<table>`/`<UTable>`/`role="table"`). The nearest list-shaped surface is
`BsfPublicProfilesGrid` (a card grid, not rows/columns) backed by
`server/api/public/profiles.get.ts`, which enforces `limit` (max 20, default 20)
but has **no offset/cursor for a second page** — past 20 public profiles, the
rest are simply invisible.

## What's broken

Issue **#7** (closed, filed by `[repo-bug-finder]`): SSR/hydration mismatch —
the day counter showed the wrong value for UTC+ timezone users during early
local hours. Root cause: `atLocalMidnight()` uses JS local-time getters
(`getFullYear/getMonth/getDate`), which resolve to **UTC** on the Cloudflare
Worker (SSR) but **user-local time** on the client, so
`BsfPublicProfileBody.vue` and `dashboard/index.vue` disagreed across hydration
for roughly `offset` hours every day. Exactly the class of bug a shared, audited
date/duration formatter should prevent from recurring per-app. Issue #95
(closed) separately flagged "dead narduk-auth Postgres bridge scaffold" as
cleanup debt tied to a narduk-auth version bump — a different (server-side)
area, but the same-genre signal that stale narduk-auth-adjacent code accumulates
here.

## Gaps / not measured

`__sitemap__/indexed-public-profiles.get.ts` and `users.get.ts` param/response
shapes not read in detail. The `<AuthLoginCard>` collision hypothesis above is
evidence-backed but not build-confirmed. `git -C` clone/SHA/branch all measured
directly.
